import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: false, projectRoot: config.projectRoot };
}

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Scenario = {
  name: string;
  description?: string;
  steps?: Array<Record<string, unknown>>;
  input_recording?: string;
  assertions?: Array<{ kind: string; node_path?: string; property?: string; expected?: unknown; min?: number; max?: number }>;
};

export function registerBehaviorReplayTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_replay_behavior_test ─────────────────────────────────────────────
  server.tool(
    "godot_replay_behavior_test",
    "Run a complete behavior test: load scenario → run project → optionally replay input recording → capture runtime state → run assertions → stop project. Returns full report.",
    {
      test_name: z.string().describe("Scenario name in .godot_mcp/tests/<name>.json"),
      hold_ms: z.number().int().min(0).optional().default(2000).describe("Wait after run before capturing/replaying"),
      speed_factor: z.number().positive().optional().default(1).describe("Input replay speed multiplier"),
      capture_after_ms: z.number().int().min(0).optional().default(500).describe("Wait after replay before assertions"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_replay_behavior_test", config), async () => {
          const scenarioPath = path.join(config.projectRoot, ".godot_mcp", "tests", `${params.test_name}.json`);
          let scenario: Scenario;
          try {
            const content = await readFile(scenarioPath, "utf8");
            scenario = JSON.parse(content);
          } catch {
            return createErrorResponse("SCENARIO_NOT_FOUND", `Scenario '${params.test_name}' not found.`, { path: scenarioPath }, []) as ToolResponse;
          }

          const phases: Array<{ phase: string; ok: boolean; data?: unknown; error?: unknown }> = [];

          const runResult = await callRpc(godot, "debug.run_project", {});
          phases.push({ phase: "run_project", ok: runResult.ok, error: runResult.ok ? undefined : runResult.error });
          if (!runResult.ok) {
            return createErrorResponse("RUN_FAILED", "Failed to start project.", { phases }, []) as ToolResponse;
          }

          await sleep(params.hold_ms);

          if (scenario.input_recording) {
            const recordingPath = path.join(config.projectRoot, ".godot_mcp", "recordings", `${scenario.input_recording}.json`);
            try {
              const recContent = await readFile(recordingPath, "utf8");
              const recording = JSON.parse(recContent) as { events: Array<{ type: string; delay_ms: number; params: Record<string, unknown> }> };
              const methodMap: Record<string, string> = {
                press_key: "input.press_key", release_key: "input.release_key", tap_key: "input.tap_key",
                press_action: "input.press_action", release_action: "input.release_action",
                mouse_click: "input.mouse_click", mouse_move: "input.mouse_move", mouse_drag: "input.mouse_drag",
              };
              for (const ev of recording.events) {
                if (ev.delay_ms > 0) await sleep(Math.max(1, Math.round(ev.delay_ms / params.speed_factor)));
                await callRpc(godot, methodMap[ev.type], ev.params);
              }
              phases.push({ phase: "replay_input", ok: true, data: { events: recording.events.length } });
            } catch (e) {
              phases.push({ phase: "replay_input", ok: false, error: e instanceof Error ? e.message : String(e) });
            }
          }

          await sleep(params.capture_after_ms);

          const assertionResults: Array<{ kind: string; ok: boolean; details?: unknown }> = [];
          if (scenario.assertions) {
            for (const a of scenario.assertions) {
              if (a.kind === "node_exists" && a.node_path) {
                const r = await callRpc(godot, "runtime.get_node_properties", { node_path: a.node_path });
                assertionResults.push({ kind: a.kind, ok: r.ok, details: { node_path: a.node_path } });
              } else if (a.kind === "property_equals" && a.node_path && a.property) {
                const r = await callRpc(godot, "runtime.get_node_properties", { node_path: a.node_path });
                if (!r.ok) {
                  assertionResults.push({ kind: a.kind, ok: false, details: { node_path: a.node_path, property: a.property, error: r.error } });
                } else {
                  const props = (r.data as { properties?: Record<string, unknown> })?.properties ?? {};
                  const actual = props[a.property];
                  const matches = JSON.stringify(actual) === JSON.stringify(a.expected);
                  assertionResults.push({ kind: a.kind, ok: matches, details: { node_path: a.node_path, property: a.property, expected: a.expected, actual } });
                }
              } else if (a.kind === "fps_in_range") {
                const r = await callRpc(godot, "runtime.get_fps", {});
                if (!r.ok) {
                  assertionResults.push({ kind: a.kind, ok: false, details: { error: r.error } });
                } else {
                  const fps = (r.data as { fps?: number }).fps ?? 0;
                  const inRange = (a.min === undefined || fps >= a.min) && (a.max === undefined || fps <= a.max);
                  assertionResults.push({ kind: a.kind, ok: inRange, details: { fps, min: a.min, max: a.max } });
                }
              }
            }
          }
          phases.push({ phase: "run_assertions", ok: true, data: { count: assertionResults.length } });

          const stopResult = await callRpc(godot, "debug.stop_project", {});
          phases.push({ phase: "stop_project", ok: stopResult.ok, error: stopResult.ok ? undefined : stopResult.error });

          const passed = assertionResults.every((r) => r.ok);
          const failed = assertionResults.filter((r) => !r.ok).length;

          return createSuccessResponse({
            test_name: params.test_name,
            passed,
            assertions_total: assertionResults.length,
            assertions_failed: failed,
            assertion_results: assertionResults,
            phases,
          }, passed ? `Behavior test passed (${assertionResults.length} assertions).` : `Behavior test failed (${failed}/${assertionResults.length}).`);
        })
      )
  );
}
