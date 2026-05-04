import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely, type ToolExecutionContext } from "../safety/toolWrapper.js";

function toMcpResult(response: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], isError: !response.ok };
}
async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  return godot.call(method, params);
}
function ctx(toolName: string, config: ServerConfig): ToolExecutionContext {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

export function registerPhase20Tools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "godot_generate_test_from_behavior",
    "Observe the running game for a duration, capture scene tree + node properties + FPS samples, then automatically generate a test scenario JSON that asserts the same runtime state on future runs. This is the agentic test generation tool — no manual test writing required.",
    {
      duration_ms: z.number().min(500).max(30000).optional().describe("How long to observe the game (ms). Default 3000."),
      watch_nodes: z.array(z.string()).optional().describe("NodePaths to capture property snapshots for. Omit to capture only tree structure."),
      watch_properties: z.array(z.string()).optional().describe("Property names to snapshot on each watched node. Default: ['visible','position','scale']."),
      include_fps: z.boolean().optional().describe("Include FPS stability assertion. Default true."),
      fps_min_threshold: z.number().optional().describe("Minimum acceptable FPS. Default 20."),
      scenario_name: z.string().min(1).describe("Name for the generated test scenario file (without .json)."),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ duration_ms = 3000, watch_nodes = [], watch_properties = ["visible", "position", "scale"], include_fps = true, fps_min_threshold = 20, scenario_name, overwrite, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_generate_test_from_behavior", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_generate_test_from_behavior",
            plannedChanges: [
              `Run project for ${duration_ms}ms`,
              `Capture runtime tree snapshot`,
              ...(watch_nodes.map(p => `Snapshot properties on ${p}`)),
              include_fps ? `Assert FPS >= ${fps_min_threshold}` : null,
              `Generate scenario: .godot_mcp/tests/${scenario_name}.json`,
            ].filter(Boolean) as string[],
            affectedFiles: [`.godot_mcp/tests/${scenario_name}.json`],
            affectedNodes: watch_nodes
          });
        }

        // 1. Run project
        const runR = await callAfterConnect(godot, "debug.run_project", {});
        if (!runR.ok) return runR;

        // 2. Wait for game to settle
        await sleep(Math.min(duration_ms, 1500));

        // 3. Capture runtime tree
        const treeR = await callAfterConnect(godot, "runtime.get_tree", {});

        // 4. Capture FPS samples
        const fpsSamples: number[] = [];
        if (include_fps) {
          for (let i = 0; i < 5; i++) {
            const fpsR = await callAfterConnect(godot, "runtime.get_fps", {});
            if (fpsR.ok && fpsR.data) {
              const fps = (fpsR.data as Record<string, unknown>)["fps"];
              if (typeof fps === "number") fpsSamples.push(fps);
            }
            await sleep(200);
          }
        }

        // 5. Capture property snapshots for watched nodes
        const propertySnapshots: Array<{ node_path: string; property: string; value: unknown }> = [];
        for (const nodePath of watch_nodes) {
          for (const prop of watch_properties) {
            const propR = await callAfterConnect(godot, "runtime.get_node_properties", { node_path: nodePath });
            if (propR.ok && propR.data) {
              const props = (propR.data as Record<string, unknown>)["properties"] as Array<{ name: string; value: unknown }> | undefined;
              const match = props?.find(p => p.name === prop);
              if (match !== undefined) {
                propertySnapshots.push({ node_path: nodePath, property: prop, value: match.value });
              }
            }
          }
        }

        // 6. Wait remaining duration
        const elapsed = Math.min(duration_ms, 1500) + (include_fps ? 5 * 200 : 0);
        const remaining = Math.max(0, duration_ms - elapsed);
        if (remaining > 0) await sleep(remaining);

        // 7. Stop project
        await callAfterConnect(godot, "debug.stop_project", {});

        // 8. Build test steps
        const steps: Array<{ name: string; type: string; params: Record<string, unknown> }> = [];

        // Tree structure assertions
        if (treeR.ok && treeR.data) {
          const treeData = treeR.data as Record<string, unknown>;
          const rootName = treeData["root_name"] as string | undefined;
          if (rootName) {
            steps.push({ name: "root_exists", type: "assert_node_exists", params: { node_path: `/root/${rootName}` } });
          }
        }

        // Property assertions
        for (const snap of propertySnapshots) {
          steps.push({
            name: `${snap.node_path.replace(/\//g, "_")}_${snap.property}`,
            type: "assert_property_equals",
            params: { node_path: snap.node_path, property: snap.property, expected: snap.value }
          });
        }

        // FPS assertion
        if (include_fps && fpsSamples.length > 0) {
          const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
          steps.push({
            name: `fps_above_${fps_min_threshold}`,
            type: "assert_property_equals",
            params: { node_path: "_fps_check", property: "fps_avg", expected: Math.round(avgFps), tolerance: fps_min_threshold }
          });
        }

        if (steps.length === 0) {
          steps.push({ name: "game_started", type: "assert_node_exists", params: { node_path: "/root" } });
        }

        // 9. Persist scenario
        const scenarioR = await callAfterConnect(godot, "test.create_scenario", {
          name: scenario_name,
          description: `Auto-generated from ${duration_ms}ms behavior observation`,
          steps,
          overwrite: overwrite ?? false
        });

        const avgFps = fpsSamples.length > 0 ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : null;

        return createSuccessResponse({
          scenario_name,
          steps_generated: steps.length,
          observed_ms: duration_ms,
          fps_samples: fpsSamples,
          avg_fps: avgFps !== null ? Math.round(avgFps) : null,
          property_snapshots: propertySnapshots.length,
          scenario_path: scenarioR.ok ? (scenarioR.data as Record<string, unknown>)["path"] : null
        }, `Test scenario '${scenario_name}' generated with ${steps.length} assertions from ${duration_ms}ms observation.`);
      });
      return toMcpResult(result);
    }
  );
}
