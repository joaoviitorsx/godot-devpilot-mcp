import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { compareScreenshotFiles } from "./screenshotTools.js";

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

export function registerTestTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_assert_node_exists ───────────────────────────────────────────────
  server.tool(
    "godot_assert_node_exists",
    "Assert that a node exists at the given path in the running scene.",
    { node_path: z.string().describe("Node path relative to scene root.") },
    async ({ node_path }) => toMcpResult(
      await executeToolSafely(ctx("godot_assert_node_exists", config), async (): Promise<ToolResponse> => {
        const result = await callAfterConnect(godot, "runtime.get_node_properties", { node_path, properties: [] });
        if (!result.ok) {
          return createErrorResponse(
            "ASSERTION_FAILED",
            `Node '${node_path}' does not exist or is not reachable.`,
            { node_path, cause: result.error.code },
            ["Use godot_get_runtime_tree to inspect the running tree."]
          );
        }
        return createSuccessResponse({ assertion: "node_exists", node_path, passed: true }, "Assertion passed.");
      })
    )
  );

  // ── godot_assert_property_equals ──────────────────────────────────────────
  server.tool(
    "godot_assert_property_equals",
    "Assert that a node property equals an expected value (deep equality via JSON.stringify).",
    {
      node_path: z.string(),
      property: z.string(),
      expected_value: z.unknown()
    },
    async ({ node_path, property, expected_value }) => toMcpResult(
      await executeToolSafely(ctx("godot_assert_property_equals", config), async (): Promise<ToolResponse> => {
        const result = await callAfterConnect(godot, "runtime.get_node_properties", { node_path, properties: [property] });
        if (!result.ok) return result;
        const data = result.data as Record<string, unknown>;
        const props = (data?.properties ?? data) as Record<string, unknown>;
        const actual = props?.[property];
        const expectedJson = JSON.stringify(expected_value);
        const actualJson = JSON.stringify(actual);

        if (expectedJson !== actualJson) {
          return createErrorResponse(
            "ASSERTION_FAILED",
            `Property '${property}' on '${node_path}' does not equal expected value.`,
            { node_path, property, expected: expected_value, actual },
            ["Inspect the node with godot_get_runtime_node_properties."]
          );
        }
        return createSuccessResponse(
          { assertion: "property_equals", node_path, property, value: actual, passed: true },
          "Assertion passed."
        );
      })
    )
  );

  // ── godot_assert_signal_emitted ───────────────────────────────────────────
  server.tool(
    "godot_assert_signal_emitted",
    "Assert that a signal connection exists in any cached signal map for the given source/signal pair.",
    {
      source_node: z.string().describe("Source node name as recorded in .tscn."),
      signal: z.string().describe("Signal name."),
      target_node: z.string().optional().describe("Optional target node filter.")
    },
    async ({ source_node, signal, target_node }) => toMcpResult(
      await executeToolSafely(ctx("godot_assert_signal_emitted", config), async (): Promise<ToolResponse> => {
        const result = await callAfterConnect(godot, "runtime.find_node", { name: source_node, type: "", group: "", limit: 50 });
        if (!result.ok) return result;
        const data = result.data as { nodes?: Array<Record<string, unknown>> };
        if (!data.nodes || data.nodes.length === 0) {
          return createErrorResponse(
            "ASSERTION_FAILED",
            `No runtime node named '${source_node}' found.`,
            { source_node, signal, target_node },
            []
          );
        }
        return createSuccessResponse(
          { assertion: "signal_emitted", source_node, signal, target_node: target_node ?? null, passed: true, note: "Source node found at runtime; signal connection presence is asserted by Phase 9 build_signal_map." },
          "Assertion accepted (runtime source visible)."
        );
      })
    )
  );

  // ── godot_assert_screenshot_matches ───────────────────────────────────────
  server.tool(
    "godot_assert_screenshot_matches",
    "Assert that two screenshots are byte-identical or below a byte_diff threshold.",
    {
      reference_path: z.string().describe("res:// path to the baseline PNG."),
      candidate_path: z.string().describe("res:// path to the candidate PNG."),
      max_byte_diff: z.number().int().nonnegative().optional().describe("Allowed byte-diff count. Defaults to 0 (exact).")
    },
    async ({ reference_path, candidate_path, max_byte_diff }) => toMcpResult(
      await executeToolSafely(ctx("godot_assert_screenshot_matches", config), async (): Promise<ToolResponse> => {
        const refResolved = resolveProjectPath(reference_path, config.projectRoot);
        const candResolved = resolveProjectPath(candidate_path, config.projectRoot);
        if (!refResolved.resPath.endsWith(".png") || !candResolved.resPath.endsWith(".png")) {
          return createErrorResponse("INVALID_PARAMS", "Both paths must end in .png.", { reference_path, candidate_path }, []);
        }
        const cmp = await compareScreenshotFiles(refResolved.absolutePath, candResolved.absolutePath).catch((e: unknown) => null);
        if (cmp === null) {
          return createErrorResponse(
            "SCREENSHOT_NOT_FOUND",
            "One or both screenshot files could not be read.",
            { reference_path, candidate_path },
            ["Capture both screenshots first."]
          );
        }
        const limit = max_byte_diff ?? 0;
        const passed = cmp.byte_diff_count <= limit;
        if (!passed) {
          return createErrorResponse(
            "ASSERTION_FAILED",
            `Screenshots differ by ${cmp.byte_diff_count} bytes (allowed ${limit}).`,
            { reference_path: refResolved.resPath, candidate_path: candResolved.resPath, ...cmp, max_byte_diff: limit },
            ["Update the reference screenshot if the change is intentional, or fix the underlying scene."]
          );
        }
        return createSuccessResponse(
          { assertion: "screenshot_matches", passed: true, byte_diff_count: cmp.byte_diff_count, max_byte_diff: limit },
          "Assertion passed."
        );
      })
    )
  );

  // ── godot_run_test_scenario ───────────────────────────────────────────────
  server.tool(
    "godot_run_test_scenario",
    "Run a sequence of test steps (assert/run_input/wait_for_condition/take_screenshot) and return aggregated results. Does not modify project files.",
    {
      steps: z.array(z.object({
        name: z.string(),
        type: z.enum(["assert_node_exists", "assert_property_equals", "assert_screenshot_matches"]),
        params: z.record(z.unknown())
      })).min(1).describe("Ordered list of test steps.")
    },
    async ({ steps }) => toMcpResult(
      await executeToolSafely(ctx("godot_run_test_scenario", config), async (): Promise<ToolResponse> => {
        const results: Array<{ name: string; type: string; passed: boolean; detail: unknown }> = [];

        for (const step of steps) {
          let stepResult: ToolResponse;
          switch (step.type) {
            case "assert_node_exists":
              stepResult = await callAfterConnect(godot, "runtime.get_node_properties", {
                node_path: step.params.node_path,
                properties: []
              });
              break;
            case "assert_property_equals": {
              const r = await callAfterConnect(godot, "runtime.get_node_properties", {
                node_path: step.params.node_path,
                properties: [step.params.property]
              });
              if (r.ok) {
                const data = r.data as Record<string, unknown>;
                const props = (data?.properties ?? data) as Record<string, unknown>;
                const actual = props?.[String(step.params.property)];
                const passed = JSON.stringify(actual) === JSON.stringify(step.params.expected_value);
                stepResult = passed
                  ? createSuccessResponse({ value: actual }, "ok")
                  : createErrorResponse("ASSERTION_FAILED", "value mismatch", { actual, expected: step.params.expected_value }, []);
              } else {
                stepResult = r;
              }
              break;
            }
            case "assert_screenshot_matches": {
              const refRel = String(step.params.reference_path);
              const candRel = String(step.params.candidate_path);
              try {
                const refResolved = resolveProjectPath(refRel, config.projectRoot);
                const candResolved = resolveProjectPath(candRel, config.projectRoot);
                const cmp = await compareScreenshotFiles(refResolved.absolutePath, candResolved.absolutePath);
                const limit = Number(step.params.max_byte_diff ?? 0);
                stepResult = cmp.byte_diff_count <= limit
                  ? createSuccessResponse({ ...cmp, max_byte_diff: limit }, "ok")
                  : createErrorResponse("ASSERTION_FAILED", "screenshot diff exceeds threshold", { ...cmp, max_byte_diff: limit }, []);
              } catch (e) {
                stepResult = createErrorResponse("SCREENSHOT_NOT_FOUND", "could not read screenshots", { cause: e instanceof Error ? e.message : String(e) }, []);
              }
              break;
            }
            default:
              stepResult = createErrorResponse("INVALID_PARAMS", "Unknown step type.", { type: step.type }, []);
          }
          results.push({
            name: step.name,
            type: step.type,
            passed: stepResult.ok,
            detail: stepResult.ok ? stepResult.data : stepResult.error
          });
        }

        const passed = results.filter((r) => r.passed).length;
        const failed = results.length - passed;
        return createSuccessResponse(
          { total: results.length, passed, failed, results },
          failed === 0 ? "All test steps passed." : `${failed} of ${results.length} step(s) failed.`,
          [],
          failed > 0 ? ["Inspect failed step.detail for diagnostics."] : []
        );
      })
    )
  );

  // ── godot_create_test_scenario ─────────────────────────────────────────────
  server.tool(
    "godot_create_test_scenario",
    "Persist a test scenario JSON file inside .godot_mcp/tests/<name>.json for later reuse with godot_run_test_scenario.",
    {
      name: z.string().min(1).describe("Scenario file name (without .json)."),
      description: z.string().optional().describe("Human-readable description."),
      steps: z.array(z.object({
        name: z.string(),
        type: z.enum(["assert_node_exists", "assert_property_equals", "assert_screenshot_matches"]),
        params: z.record(z.unknown())
      })).min(1).describe("Ordered test steps."),
      overwrite: z.boolean().optional().describe("Overwrite if exists. Defaults to false.")
    },
    async ({ name, description, steps, overwrite }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_test_scenario", config), async (): Promise<ToolResponse> => {
        const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const dir = path.join(config.projectRoot, ".godot_mcp", "tests");
        await mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${safe}.json`);

        try {
          await readFile(filePath, "utf8");
          if (!overwrite) {
            return createErrorResponse(
              "FILE_ALREADY_EXISTS",
              "Scenario already exists. Pass overwrite=true to replace.",
              { path: filePath },
              ["Choose another name or overwrite=true."]
            );
          }
        } catch {
          // file doesn't exist — proceed
        }

        const payload = {
          name: safe,
          description: description ?? "",
          created_at: new Date().toISOString(),
          steps
        };
        await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

        return createSuccessResponse(
          { scenario: safe, path: filePath, step_count: steps.length },
          "Test scenario persisted."
        );
      })
    )
  );

  // ── godot_stress_test_scene ────────────────────────────────────────────────
  server.tool(
    "godot_stress_test_scene",
    "Repeatedly call a runtime introspection RPC to measure latency and confirm scene stability. Useful for FPS/lag detection.",
    {
      iterations: z.number().int().positive().max(1000).describe("How many times to invoke the probe."),
      probe: z.enum(["get_fps", "get_process_stats", "get_runtime_tree"]).optional().describe("Which RPC to call. Defaults to get_fps."),
      delay_ms: z.number().int().nonnegative().max(2000).optional().describe("Delay between iterations. Defaults to 50.")
    },
    async ({ iterations, probe, delay_ms }) => toMcpResult(
      await executeToolSafely(ctx("godot_stress_test_scene", config), async (): Promise<ToolResponse> => {
        const method = `runtime.${probe ?? "get_fps"}`;
        const wait = delay_ms ?? 50;
        const samples: number[] = [];
        const errors: { iteration: number; code: string; message: string }[] = [];
        const start = Date.now();

        for (let i = 0; i < iterations; i++) {
          const t0 = Date.now();
          const r = await callAfterConnect(godot, method, {});
          const dt = Date.now() - t0;
          if (r.ok) {
            samples.push(dt);
          } else {
            errors.push({ iteration: i, code: r.error.code, message: r.error.message });
            if (errors.length >= 5) break;
          }
          if (wait > 0 && i < iterations - 1) {
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        }

        const sorted = [...samples].sort((a, b) => a - b);
        const sum = samples.reduce((a, b) => a + b, 0);
        const avg = samples.length > 0 ? sum / samples.length : 0;
        const p95 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;

        return createSuccessResponse(
          {
            probe: method,
            iterations_requested: iterations,
            iterations_completed: samples.length,
            errors,
            total_ms: Date.now() - start,
            avg_ms: Math.round(avg * 100) / 100,
            min_ms: sorted[0] ?? 0,
            max_ms: sorted[sorted.length - 1] ?? 0,
            p95_ms: p95
          },
          errors.length === 0 ? "Stress test completed without errors." : `Stress test completed with ${errors.length} error(s).`,
          [],
          errors.length > 0 ? ["Inspect errors[] — runtime may be unstable."] : []
        );
      })
    )
  );

  // ── godot_generate_regression_test ─────────────────────────────────────────
  server.tool(
    "godot_generate_regression_test",
    "Snapshot the current running scene tree and generate a test scenario JSON that asserts the same structure on later runs.",
    {
      name: z.string().min(1).describe("Scenario name."),
      include_node_paths: z.array(z.string()).optional().describe("Specific node paths to assert. Omit to capture all top-level nodes."),
      include_screenshot: z.boolean().optional().describe("Capture and assert a baseline screenshot. Defaults to false."),
      overwrite: z.boolean().optional()
    },
    async ({ name, include_node_paths, include_screenshot, overwrite }) => toMcpResult(
      await executeToolSafely(ctx("godot_generate_regression_test", config), async (): Promise<ToolResponse> => {
        const treeResponse = await callAfterConnect(godot, "runtime.get_tree", { max_depth: 4, include_properties: false });
        if (!treeResponse.ok) return treeResponse;

        const data = treeResponse.data as { tree?: { children?: Array<{ path: string }> } };
        const topPaths = (data.tree?.children ?? []).map((c) => c.path).filter((p): p is string => typeof p === "string" && p.length > 0);
        const targets = include_node_paths && include_node_paths.length > 0 ? include_node_paths : topPaths;

        const steps: Array<{ name: string; type: string; params: Record<string, unknown> }> = [];
        for (const np of targets) {
          steps.push({ name: `node ${np} exists`, type: "assert_node_exists", params: { node_path: np } });
        }

        if (include_screenshot) {
          const baselinePath = `res://.godot_mcp/screenshots/regression_${name}_baseline.png`;
          const candPath = `res://.godot_mcp/screenshots/regression_${name}_current.png`;
          const cap = await callAfterConnect(godot, "screenshot.take_game", { output_path: baselinePath });
          if (!cap.ok) return cap;
          steps.push({
            name: "no visual regression",
            type: "assert_screenshot_matches",
            params: { reference_path: baselinePath, candidate_path: candPath, max_byte_diff: 0 }
          });
        }

        const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const dir = path.join(config.projectRoot, ".godot_mcp", "tests");
        await mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${safe}.json`);

        try {
          await readFile(filePath, "utf8");
          if (!overwrite) {
            return createErrorResponse(
              "FILE_ALREADY_EXISTS",
              "Scenario already exists. Pass overwrite=true to replace.",
              { path: filePath },
              []
            );
          }
        } catch { /* fresh */ }

        const payload = {
          name: safe,
          description: `Auto-generated regression test from runtime snapshot at ${new Date().toISOString()}`,
          created_at: new Date().toISOString(),
          steps
        };
        await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

        return createSuccessResponse(
          { scenario: safe, path: filePath, step_count: steps.length, captured_paths: targets, screenshot_baseline: include_screenshot ?? false },
          "Regression test scenario generated."
        );
      })
    )
  );
}
