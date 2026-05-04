import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { buildDependencyGraph, buildSignalMap, indexProject } from "../indexer/projectIndexer.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) { const c = await godot.connect(); if (!c.ok) return c; }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Walk the scene tree recursively and compute depth + detect design smells. */
type TreeNode = {
  name: string;
  type?: string;
  path?: string;
  script?: string;
  children?: TreeNode[];
};

type SmellReport = {
  kind: string;
  path: string;
  detail: string;
};

function walkTreeForSmells(
  node: TreeNode,
  depth: number,
  maxDepthWarning: number,
  checkNaming: boolean,
  smells: SmellReport[],
  stats: { nodeCount: number; maxDepth: number; scriptsAttached: number }
): void {
  stats.nodeCount += 1;
  if (depth > stats.maxDepth) stats.maxDepth = depth;
  if (node.script && node.script !== "") stats.scriptsAttached += 1;

  const nodePath = node.path ?? node.name ?? "(unknown)";

  // Deep nesting smell
  if (depth > maxDepthWarning) {
    smells.push({
      kind: "deep_nesting",
      path: nodePath,
      detail: `Node is at depth ${depth}, exceeding threshold of ${maxDepthWarning}.`
    });
  }

  // Default-looking names: Node, Node2, Node3, etc.
  if (checkNaming && /^Node\d*$/.test(node.name ?? "")) {
    smells.push({
      kind: "default_name",
      path: nodePath,
      detail: `Node has a default or generated name: "${node.name}". Consider giving it a meaningful name.`
    });
  }

  const children = node.children ?? [];

  // Detect duplicate types among siblings
  const typeCounts: Record<string, number> = {};
  for (const child of children) {
    const t = child.type ?? "Unknown";
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > 3) {
      smells.push({
        kind: "many_same_type_children",
        path: nodePath,
        detail: `Has ${count} children of type "${type}". Consider using a group node or instancing a packed scene.`
      });
    }
  }

  // Detect siblings where some have scripts and one doesn't (inconsistency smell)
  const siblingScriptCount = children.filter(c => c.script && c.script !== "").length;
  if (siblingScriptCount > 0 && siblingScriptCount < children.length && children.length > 2) {
    const noScriptChildren = children.filter(c => !c.script || c.script === "").map(c => c.name ?? "?");
    smells.push({
      kind: "inconsistent_script_coverage",
      path: nodePath,
      detail: `${siblingScriptCount} of ${children.length} children have scripts attached. Nodes without scripts: [${noScriptChildren.slice(0, 5).join(", ")}].`
    });
  }

  for (const child of children) {
    walkTreeForSmells(child, depth + 1, maxDepthWarning, checkNaming, smells, stats);
  }
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerDoctorTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {

  // ── godot_project_doctor ───────────────────────────────────────────────────
  server.tool(
    "godot_project_doctor",
    "Comprehensive project health diagnostic. Analyzes scripts for errors, broken scenes, orphan resources, circular dependencies, missing input actions, missing autoloads, invalid export presets, and convention violations. Returns {critical, warnings, suggestions, auto_fix_available}.",
    {
      include_unused_resources: z.boolean().optional().describe("Scan for unused resources. Default true."),
      include_circular_deps: z.boolean().optional().describe("Detect circular script dependencies. Default true."),
      include_input_map: z.boolean().optional().describe("Check input map vs scripts. Default true."),
      include_autoloads: z.boolean().optional().describe("Check autoloads vs scripts. Default true."),
      include_export: z.boolean().optional().describe("Validate export presets. Default true."),
      auto_fix: z.boolean().optional().describe("Automatically apply available fixes. Default false.")
    },
    async ({
      include_unused_resources = true,
      include_circular_deps = true,
      include_input_map = true,
      include_autoloads = true,
      include_export = true,
      auto_fix = false
    }) => {
      const result = await executeToolSafely(ctx("godot_project_doctor", config), async (): Promise<ToolResponse> => {
        const critical: string[] = [];
        const warnings: string[] = [];
        const suggestions: string[] = [];
        const auto_fix_available: string[] = [];

        // 1. Script parse errors via debugger
        const errorsR = await callAfterConnect(godot, "debug.get_debugger_errors", {});
        if (errorsR.ok && errorsR.data) {
          const errors = ((errorsR.data as Record<string, unknown>).errors ?? []) as unknown[];
          for (const e of errors) {
            const err = e as Record<string, unknown>;
            critical.push(`Script error: ${err.message ?? err.text ?? JSON.stringify(e)}`);
          }
        }

        // 2. Unused resources
        if (include_unused_resources) {
          const unusedR = await callAfterConnect(godot, "batch.find_unused", {});
          if (unusedR.ok && unusedR.data) {
            const unused = ((unusedR.data as Record<string, unknown>).unused ?? []) as unknown[];
            for (const u of unused) {
              const item = u as Record<string, unknown>;
              warnings.push(`Unused resource: ${item.path} (${item.size_bytes} bytes)`);
              auto_fix_available.push(`delete_unused:${item.path}`);
            }
          }
        }

        // 3. Circular dependencies — first try Godot RPC, fall back to local graph analysis
        if (include_circular_deps) {
          const circR = await callAfterConnect(godot, "batch.detect_circular", {});
          if (circR.ok && circR.data) {
            const cycles = ((circR.data as Record<string, unknown>).cycles ?? []) as unknown[];
            for (const c of cycles) {
              const cycle = c as Record<string, unknown>;
              const chain = Array.isArray(cycle.cycle) ? (cycle.cycle as string[]).join(" → ") : JSON.stringify(c);
              critical.push(`Circular dependency: ${chain}`);
            }
          } else {
            // Fallback: local static analysis via dependency graph
            try {
              const graph = await buildDependencyGraph(config.projectRoot);
              // Simple DFS cycle detection
              const adj = new Map<string, string[]>();
              for (const e of graph.edges) {
                if (!adj.has(e.from)) adj.set(e.from, []);
                adj.get(e.from)!.push(e.to);
              }

              const visited = new Set<string>();
              const inStack = new Set<string>();
              const localCycles: string[][] = [];

              function dfs(node: string, stack: string[]): void {
                if (inStack.has(node)) {
                  const idx = stack.indexOf(node);
                  localCycles.push(stack.slice(idx));
                  return;
                }
                if (visited.has(node)) return;
                visited.add(node);
                inStack.add(node);
                stack.push(node);
                for (const neighbor of adj.get(node) ?? []) {
                  dfs(neighbor, stack);
                }
                stack.pop();
                inStack.delete(node);
              }

              for (const node of graph.nodes) {
                if (!visited.has(node)) {
                  dfs(node, []);
                }
              }

              for (const cycle of localCycles.slice(0, 10)) {
                critical.push(`Circular dependency: ${cycle.join(" → ")}`);
              }
            } catch {
              // graph build failed — skip circular check
            }
          }
        }

        // 4. Input map check
        if (include_input_map) {
          const inputR = await callAfterConnect(godot, "project.get_input_map", {});
          const existingActions = new Set<string>();
          if (inputR.ok && inputR.data) {
            const actions = ((inputR.data as Record<string, unknown>).actions ?? []) as unknown[];
            for (const a of actions) {
              const action = a as Record<string, unknown>;
              if (typeof action.name === "string") existingActions.add(action.name);
            }
          }

          // Infer from scripts — dry run first
          const inferR = await callAfterConnect(godot, "infer.input_map_from_scripts", { auto_add: false });
          if (inferR.ok && inferR.data) {
            const missing = ((inferR.data as Record<string, unknown>).missing_actions ?? []) as string[];
            for (const m of missing) {
              warnings.push(`Input action used in script but not registered: "${m}"`);
              auto_fix_available.push(`add_input_action:${m}`);
            }
            if (auto_fix && missing.length > 0) {
              await callAfterConnect(godot, "infer.input_map_from_scripts", { auto_add: true });
            }
          } else if (inputR.ok) {
            // RPC not available — note as suggestion
            suggestions.push("Could not infer missing input actions from scripts. Check that the Godot plugin supports 'infer.input_map_from_scripts'.");
          }
        }

        // 5. Autoloads check
        if (include_autoloads) {
          const inferR = await callAfterConnect(godot, "infer.autoloads_from_scripts", { auto_add: false });
          if (inferR.ok && inferR.data) {
            const missing = ((inferR.data as Record<string, unknown>).missing_singletons ?? []) as string[];
            for (const m of missing) {
              warnings.push(`Singleton used in scripts but not in autoloads: "${m}"`);
              auto_fix_available.push(`add_autoload:${m}`);
            }
          } else {
            // Try local autoload check via project.get_autoloads vs script scan
            const autoloadsR = await callAfterConnect(godot, "project.get_autoloads", {});
            if (autoloadsR.ok && autoloadsR.data) {
              const list = ((autoloadsR.data as Record<string, unknown>).autoloads ?? []) as unknown[];
              if (list.length === 0) {
                suggestions.push("No autoloads registered. If your scripts reference global singletons, add them in Project > Autoloads.");
              }
            }
          }
        }

        // 6. Export presets check
        if (include_export) {
          const presetsR = await callAfterConnect(godot, "export.list_presets", {});
          if (presetsR.ok && presetsR.data) {
            const presets = ((presetsR.data as Record<string, unknown>).presets ?? []) as unknown[];
            if (presets.length === 0) {
              suggestions.push("No export presets configured. Add one via Project > Export.");
            }
            for (const p of presets) {
              const preset = p as Record<string, unknown>;
              if (!preset.export_path || preset.export_path === "") {
                warnings.push(`Export preset "${preset.name}" has no export path set.`);
              }
            }
          } else {
            suggestions.push("Export preset check skipped — 'export.list_presets' RPC not available in current plugin version.");
          }
        }

        // 7. Project summary for additional checks (main scene presence)
        const summaryR = await callAfterConnect(godot, "project.get_info", {});
        if (summaryR.ok && summaryR.data) {
          const info = summaryR.data as Record<string, unknown>;
          if (!info.main_scene || info.main_scene === "") {
            critical.push("No main scene set in Project Settings > Application > Run > Main Scene.");
            auto_fix_available.push("set_main_scene");
          }
        } else {
          // Fallback: read project.godot directly
          try {
            const { readFile } = await import("node:fs/promises");
            const { default: path } = await import("node:path");
            const content = await readFile(path.join(config.projectRoot, "project.godot"), "utf8");
            const match = content.match(/run\/main_scene\s*=\s*"([^"]+)"/);
            if (!match) {
              critical.push("No main scene set in Project Settings > Application > Run > Main Scene.");
              auto_fix_available.push("set_main_scene");
            }
          } catch {
            warnings.push("Could not read project.godot to verify main scene setting.");
          }
        }

        // 8. Convention violations — local static check
        try {
          const { indexProject: idx, checkConventions } = await import("../indexer/projectIndexer.js");
          const files = await idx(config.projectRoot);
          const violations = checkConventions(files);
          for (const v of violations) {
            warnings.push(`Convention violation: ${v.res_path} — ${v.message}`);
            auto_fix_available.push(`rename_convention:${v.res_path}`);
          }
        } catch {
          // projectIndexer may not export checkConventions in all versions — skip silently
        }

        const score = Math.max(0, 100 - critical.length * 20 - warnings.length * 5 - suggestions.length * 1);

        return createSuccessResponse(
          {
            critical,
            warnings,
            suggestions,
            auto_fix_available,
            summary: {
              critical_count: critical.length,
              warning_count: warnings.length,
              suggestion_count: suggestions.length,
              health_score: score,
              auto_fixed: auto_fix
            }
          },
          `Project doctor complete. ${critical.length} critical, ${warnings.length} warnings, ${suggestions.length} suggestions. Health score: ${score}/100.`
        );
      });
      return toMcpResult(result);
    }
  );

  // ── godot_run_validation_pipeline ─────────────────────────────────────────
  server.tool(
    "godot_run_validation_pipeline",
    "Full project validation pipeline: load project info, check editor errors, open main scene, run game for N ms, capture runtime state, check for runtime errors, generate regression test optionally. Returns a structured validation report.",
    {
      hold_ms: z.number().min(500).max(30000).optional().describe("How long to run game (ms). Default 3000."),
      generate_regression: z.boolean().optional().describe("Generate a regression test snapshot after run. Default false."),
      regression_name: z.string().optional().describe("Name for regression scenario. Required if generate_regression=true."),
      open_main_scene: z.boolean().optional().describe("Open and validate main scene before run. Default true.")
    },
    async ({ hold_ms = 3000, generate_regression = false, regression_name, open_main_scene = true }) => {
      const result = await executeToolSafely(ctx("godot_run_validation_pipeline", config), async (): Promise<ToolResponse> => {
        const report: Record<string, unknown> = {
          started_at: new Date().toISOString(),
          hold_ms,
          steps_completed: [] as string[]
        };
        const failedChecks: string[] = [];
        const steps = report.steps_completed as string[];

        // Step 1: Get project info → main scene
        const projectInfoR = await callAfterConnect(godot, "project.get_info", {});
        let mainScene: string | null = null;
        if (projectInfoR.ok && projectInfoR.data) {
          const info = projectInfoR.data as Record<string, unknown>;
          mainScene = typeof info.main_scene === "string" && info.main_scene !== "" ? info.main_scene : null;
          report.project_info = info;
          steps.push("project.get_info");
        } else {
          // Fallback: read project.godot directly
          try {
            const { readFile } = await import("node:fs/promises");
            const { default: path } = await import("node:path");
            const content = await readFile(path.join(config.projectRoot, "project.godot"), "utf8");
            const match = content.match(/run\/main_scene\s*=\s*"([^"]+)"/);
            mainScene = match ? match[1] : null;
            report.project_info = { main_scene: mainScene, source: "project.godot_fallback" };
            steps.push("project.get_info (fallback)");
          } catch {
            report.project_info = null;
            failedChecks.push("project_info: could not retrieve main scene.");
          }
        }

        if (!mainScene) {
          failedChecks.push("main_scene: no main scene configured in project settings.");
        }

        // Step 2: Baseline editor errors (should be empty before run)
        const preRunErrorsR = await callAfterConnect(godot, "debug.get_debugger_errors", {});
        let preRunErrors: unknown[] = [];
        if (preRunErrorsR.ok && preRunErrorsR.data) {
          preRunErrors = ((preRunErrorsR.data as Record<string, unknown>).errors ?? []) as unknown[];
          steps.push("debug.get_debugger_errors (pre-run)");
        }
        report.pre_run_errors = preRunErrors;
        if (preRunErrors.length > 0) {
          failedChecks.push(`pre_run_errors: ${preRunErrors.length} error(s) present before game launch.`);
        }

        // Step 3: Open and validate main scene (optional)
        report.scene_validation = null;
        if (open_main_scene && mainScene) {
          const openR = await callAfterConnect(godot, "scene.open", { path: mainScene });
          if (!openR.ok) {
            failedChecks.push(`scene.open: failed to open main scene "${mainScene}" — ${openR.error.message}`);
          } else {
            steps.push("scene.open");
            const validateR = await callAfterConnect(godot, "scene.validate", { path: mainScene });
            if (validateR.ok) {
              report.scene_validation = validateR.data;
              steps.push("scene.validate");
              const validData = validateR.data as Record<string, unknown>;
              if (validData.valid === false) {
                failedChecks.push(`scene_validation: main scene "${mainScene}" failed validation.`);
              }
            } else {
              report.scene_validation = { error: validateR.error };
              failedChecks.push(`scene_validation: scene.validate RPC failed — ${validateR.error.message}`);
            }
          }
        } else if (open_main_scene && !mainScene) {
          failedChecks.push("scene_open_skipped: no main scene to open.");
        }

        // Step 4: Run the project
        const runR = await callAfterConnect(godot, "debug.run_project", {});
        if (!runR.ok) {
          failedChecks.push(`run_project: failed to start game — ${runR.error.message}`);
          // Cannot continue runtime steps
          report.runtime_tree_snapshot = null;
          report.fps = null;
          report.runtime_errors = [];
          report.regression_scenario = null;
          report.finished_at = new Date().toISOString();
          report.passed = failedChecks.length === 0;
          report.failed_checks = failedChecks;
          return createSuccessResponse(report, `Validation pipeline finished with ${failedChecks.length} failed check(s). Game could not start.`);
        }
        steps.push("debug.run_project");

        // Step 5: Hold — let game run
        await sleep(hold_ms);
        steps.push(`sleep(${hold_ms}ms)`);

        // Step 6: Capture runtime tree
        const treeR = await callAfterConnect(godot, "runtime.get_tree", { max_depth: 5, include_properties: false });
        if (treeR.ok) {
          report.runtime_tree_snapshot = treeR.data;
          steps.push("runtime.get_tree");
        } else {
          report.runtime_tree_snapshot = null;
          failedChecks.push(`runtime_tree: could not capture runtime tree — ${treeR.error.message}`);
        }

        // Step 7: Capture FPS
        const fpsR = await callAfterConnect(godot, "runtime.get_fps", {});
        if (fpsR.ok) {
          report.fps = fpsR.data;
          steps.push("runtime.get_fps");
          const fpsData = fpsR.data as Record<string, unknown>;
          const fpsValue = typeof fpsData.fps === "number" ? fpsData.fps : null;
          if (fpsValue !== null && fpsValue < 10) {
            failedChecks.push(`fps: game running at very low FPS (${fpsValue}). Performance issue likely.`);
          }
        } else {
          report.fps = null;
        }

        // Step 8: Capture runtime errors
        const runtimeErrorsR = await callAfterConnect(godot, "debug.get_debugger_errors", {});
        let runtimeErrors: unknown[] = [];
        if (runtimeErrorsR.ok && runtimeErrorsR.data) {
          runtimeErrors = ((runtimeErrorsR.data as Record<string, unknown>).errors ?? []) as unknown[];
          steps.push("debug.get_debugger_errors (post-run)");
        }
        report.runtime_errors = runtimeErrors;
        if (runtimeErrors.length > 0) {
          failedChecks.push(`runtime_errors: ${runtimeErrors.length} error(s) occurred during game run.`);
        }

        // Step 9: Stop the project
        const stopR = await callAfterConnect(godot, "debug.stop_project", {});
        if (stopR.ok) {
          steps.push("debug.stop_project");
        } else {
          failedChecks.push(`stop_project: could not stop game — ${stopR.error.message}`);
        }

        // Step 10: Optionally generate regression test
        report.regression_scenario = null;
        if (generate_regression) {
          if (!regression_name) {
            failedChecks.push("regression_scenario: generate_regression=true requires regression_name to be set.");
          } else {
            const safe = regression_name.replace(/[^a-zA-Z0-9_-]/g, "_");
            // Capture a snapshot of the tree children as node-exists assertions
            const treeData = report.runtime_tree_snapshot as Record<string, unknown> | null;
            const treeChildren = treeData
              ? ((treeData.tree as Record<string, unknown>)?.children ?? []) as Array<Record<string, unknown>>
              : [];
            const steps_reg: Array<{ name: string; type: string; params: Record<string, unknown> }> = [];

            for (const child of treeChildren.slice(0, 20)) {
              const childPath = typeof child.path === "string" ? child.path : typeof child.name === "string" ? child.name : null;
              if (childPath) {
                steps_reg.push({
                  name: `node ${childPath} exists`,
                  type: "assert_node_exists",
                  params: { node_path: childPath }
                });
              }
            }

            if (steps_reg.length === 0) {
              failedChecks.push("regression_scenario: no runtime nodes captured — runtime tree may have been empty.");
            } else {
              // Write scenario file directly (mirrors testTools.ts logic)
              const { mkdir: mkdirNode, writeFile: writeFileNode, readFile: readFileNode } = await import("node:fs/promises");
              const { default: pathNode } = await import("node:path");
              const dir = pathNode.join(config.projectRoot, ".godot_mcp", "tests");
              await mkdirNode(dir, { recursive: true });
              const filePath = pathNode.join(dir, `${safe}.json`);

              // Check for existing file — do not overwrite silently
              let fileExists = false;
              try { await readFileNode(filePath, "utf8"); fileExists = true; } catch { /* not exists */ }

              if (fileExists) {
                failedChecks.push(`regression_scenario: scenario "${safe}" already exists. Delete the file or choose a different name.`);
              } else {
                const payload = {
                  name: safe,
                  description: `Auto-generated regression test from validation pipeline at ${new Date().toISOString()}`,
                  created_at: new Date().toISOString(),
                  steps: steps_reg
                };
                await writeFileNode(filePath, JSON.stringify(payload, null, 2), "utf8");
                report.regression_scenario = { name: safe, path: filePath, step_count: steps_reg.length };
                steps.push("test.create_scenario");
              }
            }
          }
        }

        report.finished_at = new Date().toISOString();
        report.passed = failedChecks.length === 0;
        report.failed_checks = failedChecks;

        return createSuccessResponse(
          report,
          report.passed
            ? "Validation pipeline passed all checks."
            : `Validation pipeline completed with ${failedChecks.length} failed check(s).`,
          [],
          failedChecks.length > 0 ? ["Inspect failed_checks for details on each failure."] : []
        );
      });
      return toMcpResult(result);
    }
  );

  // ── godot_analyze_scene_architecture ──────────────────────────────────────
  server.tool(
    "godot_analyze_scene_architecture",
    "Deep analysis of the current scene: node tree, scripts attached, signals connected, groups, resource dependencies, naming conventions, potential design smells (deep nesting, nodes without names, suspected duplicates).",
    {
      max_depth_warning: z.number().optional().describe("Warn if node depth exceeds this. Default 8."),
      check_naming: z.boolean().optional().describe("Check node names for conventions. Default true.")
    },
    async ({ max_depth_warning = 8, check_naming = true }) => {
      const result = await executeToolSafely(ctx("godot_analyze_scene_architecture", config), async (): Promise<ToolResponse> => {

        // Step 1: Get full scene tree
        const treeR = await callAfterConnect(godot, "scene.get_tree", { include_properties: false, max_depth: 20 });
        if (!treeR.ok) {
          return treeR;
        }
        const treeData = treeR.data as { tree?: TreeNode; root?: TreeNode };
        const root: TreeNode | null = treeData.tree ?? treeData.root ?? null;

        // Step 2: Audit scene for structural issues
        const auditR = await callAfterConnect(godot, "scene.audit", { path: "" });
        const auditResults: unknown = auditR.ok ? auditR.data : null;

        // Step 3: Build signal map (local static analysis — always available)
        let signalConnections: Array<{ scene: string; from: string; signal: string; to: string; method: string }> = [];
        try {
          const rawConnections = await buildSignalMap(config.projectRoot);
          signalConnections = rawConnections;
        } catch {
          // signal map build failed — continue without it
        }

        // Step 4: Gather project file info for resource dependencies
        let resourceDeps: Array<{ res_path: string; kind: string }> = [];
        try {
          const files = await indexProject(config.projectRoot);
          const graph = await buildDependencyGraph(config.projectRoot);

          // Find what the current scene depends on
          const editorContextR = await callAfterConnect(godot, "project.get_editor_context", {});
          if (editorContextR.ok && editorContextR.data) {
            const ctxData = editorContextR.data as Record<string, unknown>;
            const currentScene = typeof ctxData.current_scene === "string" ? ctxData.current_scene : null;
            if (currentScene) {
              const deps = graph.edges.filter(e => e.from === currentScene).map(e => e.to);
              resourceDeps = deps
                .map(d => {
                  const f = files.find(f => f.res_path === d);
                  return f ? { res_path: f.res_path, kind: f.kind } : { res_path: d, kind: "unknown" };
                });
            }
          }
        } catch {
          // dependency graph unavailable
        }

        // Step 5: Walk tree for smells + stats
        const designSmells: SmellReport[] = [];
        const stats = { nodeCount: 0, maxDepth: 0, scriptsAttached: 0 };

        if (root) {
          walkTreeForSmells(root, 0, max_depth_warning, check_naming, designSmells, stats);
        }

        // Step 6: Summarize signals for this scene
        const signalSummary = {
          total_connections: signalConnections.length,
          unique_signals: [...new Set(signalConnections.map(c => c.signal))],
          connections: signalConnections.slice(0, 50)
        };

        // Step 7: Build tree_summary (top-level node types + depth map)
        const topLevelTypes: Record<string, number> = {};
        if (root?.children) {
          for (const child of root.children) {
            const t = child.type ?? "Unknown";
            topLevelTypes[t] = (topLevelTypes[t] ?? 0) + 1;
          }
        }

        const treeSummary = {
          root_name: root?.name ?? null,
          root_type: root?.type ?? null,
          root_script: root?.script ?? null,
          top_level_children: root?.children?.length ?? 0,
          top_level_types: topLevelTypes,
          total_nodes: stats.nodeCount,
          max_depth_reached: stats.maxDepth
        };

        // Step 8: Generate suggestions from smells
        const suggestions: string[] = [];
        const smellKindCounts: Record<string, number> = {};
        for (const smell of designSmells) {
          smellKindCounts[smell.kind] = (smellKindCounts[smell.kind] ?? 0) + 1;
        }

        if ((smellKindCounts.deep_nesting ?? 0) > 0) {
          suggestions.push(`${smellKindCounts.deep_nesting} node(s) exceed depth threshold ${max_depth_warning}. Consider flattening the hierarchy or splitting into sub-scenes.`);
        }
        if ((smellKindCounts.default_name ?? 0) > 0) {
          suggestions.push(`${smellKindCounts.default_name} node(s) have default names. Give them meaningful names to improve readability.`);
        }
        if ((smellKindCounts.many_same_type_children ?? 0) > 0) {
          suggestions.push("Some nodes have many children of the same type. Consider using a PackedScene instance or a dynamic container.");
        }
        if ((smellKindCounts.inconsistent_script_coverage ?? 0) > 0) {
          suggestions.push("Some sibling nodes inconsistently have scripts. Review whether missing scripts are intentional.");
        }
        if (stats.maxDepth > max_depth_warning + 4) {
          suggestions.push(`Scene is very deep (max depth: ${stats.maxDepth}). Deeply nested scenes can cause performance issues in Godot 4.`);
        }
        if (signalConnections.length > 20) {
          suggestions.push(`High signal connection count (${signalConnections.length}). Ensure connections are intentional and not creating hidden coupling.`);
        }

        return createSuccessResponse(
          {
            tree_summary: treeSummary,
            design_smells: designSmells,
            signal_summary: signalSummary,
            resource_dependencies: resourceDeps,
            audit_results: auditResults,
            node_count: stats.nodeCount,
            max_depth: stats.maxDepth,
            scripts_attached: stats.scriptsAttached,
            suggestions
          },
          `Scene architecture analysis complete. ${stats.nodeCount} nodes, max depth ${stats.maxDepth}, ${designSmells.length} design smell(s), ${signalConnections.length} signal connection(s).`,
          [],
          suggestions
        );
      });
      return toMcpResult(result);
    }
  );
}
