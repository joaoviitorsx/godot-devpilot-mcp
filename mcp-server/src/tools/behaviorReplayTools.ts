import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { resolveProjectPath, resolveProjectRelativePath, safePathComponent } from "../safety/pathGuard.js";
import { compareScreenshotFiles } from "./screenshotTools.js";

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
  steps?: Array<{ name: string; type: string; params: Record<string, unknown> }>;
  input_recording?: string;
  assertions?: Array<{ kind: string; node_path?: string; property?: string; expected?: unknown; min?: number; max?: number; reference_path?: string; candidate_path?: string; max_byte_diff?: number }>;
};

type Assertion = NonNullable<Scenario["assertions"]>[number];

function normalizeAssertions(scenario: Scenario): Assertion[] {
  const assertions = [...(scenario.assertions ?? [])];
  for (const step of scenario.steps ?? []) {
    const params = step?.params ?? {};
    if (step?.type === "assert_node_exists") assertions.push({ kind: "node_exists", node_path: params.node_path as string });
    else if (step?.type === "assert_property_equals") assertions.push({ kind: "property_equals", node_path: params.node_path as string, property: params.property as string, expected: params.expected_value });
    else if (step?.type === "assert_screenshot_matches") assertions.push({ kind: "screenshot_matches", reference_path: params.reference_path as string, candidate_path: params.candidate_path as string, max_byte_diff: params.max_byte_diff as number | undefined });
    else assertions.push({ kind: step?.type ?? "unknown" });
  }
  return assertions;
}

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
          const scenarioPath = resolveProjectRelativePath(`.godot_mcp/tests/${safePathComponent(params.test_name)}.json`, config.projectRoot).absolutePath;
          let scenario: Scenario;
          try {
            const content = await readFile(scenarioPath, "utf8");
            scenario = JSON.parse(content);
          } catch {
            return createErrorResponse("SCENARIO_NOT_FOUND", `Scenario '${params.test_name}' not found.`, { path: scenarioPath }, []) as ToolResponse;
          }

          if (!scenario || typeof scenario !== "object" || (scenario.assertions !== undefined && !Array.isArray(scenario.assertions)) || (scenario.steps !== undefined && !Array.isArray(scenario.steps))) {
            return createErrorResponse("INVALID_SCENARIO", "Scenario assertions and steps must be arrays.", { path: scenarioPath }, []) as ToolResponse;
          }
          const assertions = normalizeAssertions(scenario);
          if (assertions.length === 0) return createErrorResponse("INVALID_SCENARIO", "Behavior replay requires at least one assertion.", { path: scenarioPath }, []) as ToolResponse;

          const phases: Array<{ phase: string; ok: boolean; data?: unknown; error?: unknown }> = [];
          const assertionResults: Array<{ kind: string; ok: boolean; details?: unknown }> = [];

          const runResult = await callRpc(godot, "debug.run_project", {});
          phases.push({ phase: "run_project", ok: runResult.ok, error: runResult.ok ? undefined : runResult.error });
          if (!runResult.ok) {
            return createErrorResponse("RUN_FAILED", "Failed to start project.", { phases }, []) as ToolResponse;
          }

          try {
          await sleep(params.hold_ms);

          if (scenario.input_recording !== undefined) {
            try {
              if (typeof scenario.input_recording !== "string" || !scenario.input_recording) throw new Error("input_recording must be a non-empty recording name.");
              const recordingPath = resolveProjectRelativePath(`.godot_mcp/recordings/${safePathComponent(scenario.input_recording)}.json`, config.projectRoot).absolutePath;
              const recContent = await readFile(recordingPath, "utf8");
              const recording = JSON.parse(recContent) as { events: Array<{ type: string; delay_ms: number; params: Record<string, unknown> }> };
              if (!Array.isArray(recording.events)) throw new Error("Recording must contain an events array.");
              const methodMap: Record<string, string> = {
                press_key: "input.press_key", release_key: "input.release_key", tap_key: "input.tap_key",
                press_action: "input.press_action", release_action: "input.release_action",
                mouse_click: "input.mouse_click", mouse_move: "input.mouse_move", mouse_drag: "input.mouse_drag",
              };
              for (const [index, ev] of recording.events.entries()) {
                if (!Object.hasOwn(methodMap, ev.type) || !Number.isFinite(ev.delay_ms) || ev.delay_ms < 0 || !ev.params || typeof ev.params !== "object") {
                  throw new Error(`Invalid input event at index ${index}.`);
                }
                if (ev.delay_ms > 0) await sleep(Math.max(1, Math.round(ev.delay_ms / params.speed_factor)));
                const inputResult = await callRpc(godot, methodMap[ev.type], ev.params);
                if (!inputResult.ok) throw new Error(`Input event ${index} failed: ${inputResult.error.code}: ${inputResult.error.message}`);
              }
              phases.push({ phase: "replay_input", ok: true, data: { events: recording.events.length } });
            } catch (e) {
              phases.push({ phase: "replay_input", ok: false, error: e instanceof Error ? e.message : String(e) });
            }
          }

          if (phases.every((phase) => phase.ok)) {
            await sleep(params.capture_after_ms);
            for (const a of assertions) {
              if (a.kind === "node_exists" && a.node_path) {
                const r = await callRpc(godot, "runtime.get_node_properties", { node_path: a.node_path, properties: [] });
                assertionResults.push({ kind: a.kind, ok: r.ok, details: { node_path: a.node_path, error: r.ok ? undefined : r.error } });
              } else if (a.kind === "property_equals" && a.node_path && a.property) {
                const r = await callRpc(godot, "runtime.get_node_properties", { node_path: a.node_path, properties: [a.property] });
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
                  const fps = (r.data as { fps?: number }).fps;
                  const inRange = typeof fps === "number" && Number.isFinite(fps) && (a.min === undefined || fps >= a.min) && (a.max === undefined || fps <= a.max);
                  assertionResults.push({ kind: a.kind, ok: inRange, details: { fps, min: a.min, max: a.max } });
                }
              } else if (a.kind === "screenshot_matches" && typeof a.reference_path === "string" && typeof a.candidate_path === "string") {
                try {
                  const reference = resolveProjectPath(a.reference_path, config.projectRoot);
                  const candidate = resolveProjectPath(a.candidate_path, config.projectRoot);
                  if (!reference.resPath.endsWith(".png") || !candidate.resPath.endsWith(".png")) throw new Error("Screenshot paths must end in .png.");
                  const diff = await compareScreenshotFiles(reference.absolutePath, candidate.absolutePath);
                  const limit = a.max_byte_diff ?? 0;
                  assertionResults.push({ kind: a.kind, ok: Number.isInteger(limit) && limit >= 0 && diff.byte_diff_count <= limit, details: { ...diff, max_byte_diff: limit } });
                } catch (error) {
                  assertionResults.push({ kind: a.kind, ok: false, details: { error: error instanceof Error ? error.message : String(error) } });
                }
              } else {
                assertionResults.push({ kind: a.kind, ok: false, details: { error: "Unsupported or incomplete assertion." } });
              }
            }
            phases.push({ phase: "run_assertions", ok: assertionResults.every((r) => r.ok), data: { count: assertionResults.length } });
          }

          } catch (error) {
            phases.push({ phase: "test_execution", ok: false, error: error instanceof Error ? error.message : String(error) });
          } finally {
            try {
              const stopResult = await callRpc(godot, "debug.stop_project", {});
              phases.push({ phase: "stop_project", ok: stopResult.ok, error: stopResult.ok ? undefined : stopResult.error });
            } catch (error) {
              phases.push({ phase: "stop_project", ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          }

          const passed = phases.every((phase) => phase.ok) && assertionResults.length === assertions.length && assertionResults.every((r) => r.ok);
          const failed = assertionResults.filter((r) => !r.ok).length;

          const report = {
            test_name: params.test_name,
            passed,
            assertions_total: assertions.length,
            assertions_failed: failed,
            assertion_results: assertionResults,
            phases,
          };
          return passed
            ? createSuccessResponse(report, `Behavior test passed (${assertionResults.length} assertions).`)
            : createErrorResponse("BEHAVIOR_TEST_FAILED", "Behavior test failed. Inspect phases and assertion results.", report, []);
        })
      )
  );
}
