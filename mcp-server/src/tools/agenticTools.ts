import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { buildDependencyGraph, buildProjectSummary, buildSignalMap } from "../indexer/projectIndexer.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

type PlanStep = { name: string; method: string; params: Record<string, unknown>; required?: boolean };
type StepResult = { name: string; method: string; ok: boolean; result: unknown };

async function executePlan(steps: PlanStep[], godot: GodotClient, stopOnError: boolean): Promise<{ results: StepResult[]; halted: boolean }> {
  const results: StepResult[] = [];
  for (const step of steps) {
    const r = await callAfterConnect(godot, step.method, step.params);
    results.push({ name: step.name, method: step.method, ok: r.ok, result: r.ok ? r.data : r.error });
    if (!r.ok && (step.required ?? true) && stopOnError) {
      return { results, halted: true };
    }
  }
  return { results, halted: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerAgenticTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_build_feature ────────────────────────────────────────────────────
  server.tool(
    "godot_build_feature",
    "Generate a multi-step plan for a feature (scene + script + nodes + memory note). dry_run=true by default returns the plan; dry_run=false executes it.",
    {
      feature_name: z.string().min(1).describe("PascalCase feature name (e.g. 'PlayerHUD')."),
      kind: z.enum(["scene_with_script", "script_only", "ui_panel"]).describe("Feature shape."),
      base_node: z.string().optional().describe("Base node type (default depends on kind)."),
      dry_run: z.boolean().optional().describe("Defaults to true.")
    },
    async ({ feature_name, kind, base_node, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_build_feature", config), async (): Promise<ToolResponse> => {
        const baseDefault = kind === "ui_panel" ? "Control" : kind === "scene_with_script" ? "Node2D" : "Node";
        const baseType = base_node ?? baseDefault;
        const scenePath = `res://scenes/${feature_name}.tscn`;
        const scriptPath = `res://scripts/${feature_name}.gd`;

        const steps: PlanStep[] = [];
        if (kind !== "script_only") {
          steps.push({ name: `Create scene ${scenePath}`, method: "scene.create", params: { scene_path: scenePath, root_type: baseType, root_name: feature_name } });
          steps.push({ name: `Open scene`, method: "scene.open", params: { scene_path: scenePath } });
        }
        steps.push({ name: `Create script ${scriptPath}`, method: "script.create", params: { path: scriptPath, extends: baseType } });
        if (kind !== "script_only") {
          steps.push({ name: `Attach script`, method: "script.attach", params: { node_path: ".", script_path: scriptPath } });
          steps.push({ name: `Save scene`, method: "scene.save", params: {} });
        }

        const plan = steps.map((s) => `${s.name}`);
        if (dry_run !== false) {
          return createDryRunResponse({
            toolName: "godot_build_feature",
            plannedChanges: plan,
            affectedFiles: [scriptPath, ...(kind !== "script_only" ? [scenePath] : [])]
          });
        }

        const exec = await executePlan(steps, godot, true);
        const failed = exec.results.filter((r) => !r.ok).length;
        return createSuccessResponse(
          { feature_name, kind, executed_steps: exec.results.length, failed, halted: exec.halted, results: exec.results },
          failed === 0 ? "Feature built successfully." : `Feature build halted after ${failed} failure(s).`,
          [],
          failed === 0 ? [`Update memory: godot_update_project_memory file=current_task content="Implemented ${feature_name}"`] : []
        );
      })
    )
  );

  // ── godot_create_gameplay_system ──────────────────────────────────────────
  server.tool(
    "godot_create_gameplay_system",
    "Compose a baseline gameplay system using existing toolkits.",
    {
      system: z.enum(["player_2d", "enemy_patrol_2d", "collectible_swarm", "health_hud", "third_person_3d"]).describe("Preset system to scaffold."),
      dry_run: z.boolean().optional().describe("Defaults to true.")
    },
    async ({ system, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_gameplay_system", config), async (): Promise<ToolResponse> => {
        const steps: PlanStep[] = [];
        switch (system) {
          case "player_2d":
            steps.push({ name: "Player 2D", method: "node.add", params: { parent_path: ".", node_type: "Marker2D", node_name: "PlayerSpawn" } });
            break;
          case "enemy_patrol_2d":
            steps.push({ name: "Enemy spawn marker", method: "node.add", params: { parent_path: ".", node_type: "Marker2D", node_name: "EnemySpawn" } });
            break;
          case "collectible_swarm":
            for (let i = 0; i < 5; i++) {
              steps.push({ name: `Collectible ${i + 1}`, method: "node.add", params: { parent_path: ".", node_type: "Marker2D", node_name: `Collectible${i + 1}` } });
            }
            break;
          case "health_hud":
            steps.push({ name: "CanvasLayer HUD", method: "node.add", params: { parent_path: ".", node_type: "CanvasLayer", node_name: "HUD" } });
            steps.push({ name: "Control Root", method: "node.add", params: { parent_path: "HUD", node_type: "Control", node_name: "Root" } });
            steps.push({ name: "Health Label", method: "node.add", params: { parent_path: "HUD/Root", node_type: "Label", node_name: "HealthLabel" } });
            break;
          case "third_person_3d":
            steps.push({ name: "Player3D spawn marker", method: "node.add", params: { parent_path: ".", node_type: "Marker3D", node_name: "PlayerSpawn3D" } });
            break;
        }

        const plan = steps.map((s) => s.name);
        if (dry_run !== false) {
          return createDryRunResponse({
            toolName: "godot_create_gameplay_system",
            plannedChanges: plan,
            affectedNodes: steps.map((s) => `${(s.params.parent_path as string)}/${(s.params.node_name as string)}`)
          });
        }

        const exec = await executePlan(steps, godot, false);
        return createSuccessResponse(
          { system, executed_steps: exec.results.length, results: exec.results },
          "Gameplay system scaffolded.",
          [],
          [`For richer setup use godot_create_player_2d / godot_create_character_body_3d / godot_create_health_system instead.`]
        );
      })
    )
  );

  // ── godot_refactor_safely ──────────────────────────────────────────────────
  server.tool(
    "godot_refactor_safely",
    "Run impact_check before applying a rename/move/delete. Returns plan + impact; with dry_run=false applies changes after impact analysis.",
    {
      change_type: z.enum(["rename_file", "delete_file", "rename_signal"]).describe("Refactor kind."),
      target: z.string().describe("Target res:// path or signal name."),
      new_value: z.string().optional().describe("New name/path (informational)."),
      dry_run: z.boolean().optional().describe("Defaults to true.")
    },
    async ({ change_type, target, new_value, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_refactor_safely", config), async (): Promise<ToolResponse> => {
        const summary = await buildProjectSummary(config.projectRoot);
        const graph = await buildDependencyGraph(config.projectRoot);
        const signals = await buildSignalMap(config.projectRoot);

        const affectedFiles = new Set<string>();
        const affectedSignals = signals.filter((s) => change_type === "rename_signal" && s.signal === target);
        for (const e of graph.edges) {
          if ((change_type === "rename_file" || change_type === "delete_file") && e.to === target) {
            affectedFiles.add(e.from);
          }
        }
        for (const s of affectedSignals) affectedFiles.add(s.scene);

        const impactLevel = affectedFiles.size === 0 ? "none" :
          affectedFiles.size <= 2 ? "low" :
          affectedFiles.size <= 8 ? "medium" : "high";

        if (dry_run !== false) {
          return createSuccessResponse(
            {
              dry_run: true,
              applied: false,
              change_type,
              target,
              new_value: new_value ?? null,
              impact_level: impactLevel,
              affected_files: [...affectedFiles].sort(),
              affected_signals: affectedSignals,
              project_size: summary.total
            },
            "Refactor plan generated. Review impact before executing.",
            [],
            ["Set dry_run=false to apply (only delete_file is destructive — rename/signal still require manual edits)."]
          );
        }

        return createSuccessResponse(
          {
            dry_run: false,
            applied: false,
            note: "Automatic refactor execution intentionally left manual: edit references in affected files yourself.",
            change_type,
            target,
            new_value: new_value ?? null,
            impact_level: impactLevel,
            affected_files: [...affectedFiles].sort(),
            affected_signals: affectedSignals
          },
          "Impact reported. Manual edits required for this refactor type.",
          ["godot_refactor_safely is conservative: it does NOT auto-rename references to avoid silent regressions."],
          ["Use godot_patch_script per affected file to update references, then run godot_validate_script."]
        );
      })
    )
  );

  // ── godot_generate_scene_from_prompt ───────────────────────────────────────
  server.tool(
    "godot_generate_scene_from_prompt",
    "Generate a scene scaffold from keyword tags. Maps tags to node templates (player, enemy, hud, camera, light, collision).",
    {
      scene_name: z.string().min(1).describe("PascalCase scene name."),
      tags: z.array(z.string()).min(1).describe("Tags: 'player', 'enemy', 'hud', 'camera2d', 'camera3d', 'light', 'collision', 'parallax'."),
      dimension: z.enum(["2d", "3d"]).describe("Scene dimension."),
      dry_run: z.boolean().optional().describe("Defaults to true.")
    },
    async ({ scene_name, tags, dimension, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_generate_scene_from_prompt", config), async (): Promise<ToolResponse> => {
        const root = dimension === "3d" ? "Node3D" : "Node2D";
        const scenePath = `res://scenes/${scene_name}.tscn`;
        const steps: PlanStep[] = [
          { name: `Create scene ${scenePath}`, method: "scene.create", params: { scene_path: scenePath, root_type: root, root_name: scene_name } },
          { name: `Open scene`, method: "scene.open", params: { scene_path: scenePath } }
        ];

        const tagSet = new Set(tags.map((t) => t.toLowerCase()));
        if (tagSet.has("player")) {
          const ptype = dimension === "3d" ? "CharacterBody3D" : "CharacterBody2D";
          steps.push({ name: "Add Player", method: "node.add", params: { parent_path: ".", node_type: ptype, node_name: "Player" } });
        }
        if (tagSet.has("enemy")) {
          const etype = dimension === "3d" ? "CharacterBody3D" : "CharacterBody2D";
          steps.push({ name: "Add Enemy", method: "node.add", params: { parent_path: ".", node_type: etype, node_name: "Enemy" } });
        }
        if (tagSet.has("camera2d") || (tagSet.has("camera") && dimension === "2d")) {
          steps.push({ name: "Add Camera2D", method: "node.add", params: { parent_path: ".", node_type: "Camera2D", node_name: "Camera2D" } });
        }
        if (tagSet.has("camera3d") || (tagSet.has("camera") && dimension === "3d")) {
          steps.push({ name: "Add Camera3D", method: "node.add", params: { parent_path: ".", node_type: "Camera3D", node_name: "Camera3D" } });
        }
        if (tagSet.has("light") && dimension === "3d") {
          steps.push({ name: "Add DirectionalLight3D", method: "node.add", params: { parent_path: ".", node_type: "DirectionalLight3D", node_name: "Sun" } });
        }
        if (tagSet.has("hud")) {
          steps.push({ name: "Add CanvasLayer HUD", method: "node.add", params: { parent_path: ".", node_type: "CanvasLayer", node_name: "HUD" } });
        }
        if (tagSet.has("parallax") && dimension === "2d") {
          steps.push({ name: "Add ParallaxBackground", method: "node.add", params: { parent_path: ".", node_type: "ParallaxBackground", node_name: "ParallaxBackground" } });
        }
        steps.push({ name: "Save scene", method: "scene.save", params: {} });

        if (dry_run !== false) {
          return createDryRunResponse({
            toolName: "godot_generate_scene_from_prompt",
            plannedChanges: steps.map((s) => s.name),
            affectedFiles: [scenePath]
          });
        }
        const exec = await executePlan(steps, godot, true);
        return createSuccessResponse(
          { scene_name, scene_path: scenePath, executed_steps: exec.results.length, halted: exec.halted, results: exec.results },
          exec.halted ? "Scene generation halted on first failure." : "Scene generated."
        );
      })
    )
  );

  // ── godot_create_playable_prototype ────────────────────────────────────────
  server.tool(
    "godot_create_playable_prototype",
    "Composed scaffold: scene + player + camera + script (uses existing toolkit2d/3d). dry_run=true by default.",
    {
      name: z.string().min(1).describe("Prototype scene name."),
      dimension: z.enum(["2d", "3d"]).describe("2d → topdown player; 3d → CharacterBody3D + camera pivot."),
      dry_run: z.boolean().optional()
    },
    async ({ name, dimension, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_playable_prototype", config), async (): Promise<ToolResponse> => {
        const scenePath = `res://scenes/${name}.tscn`;
        const root = dimension === "3d" ? "Node3D" : "Node2D";
        const steps: PlanStep[] = [
          { name: `Create scene`, method: "scene.create", params: { scene_path: scenePath, root_type: root, root_name: name } },
          { name: `Open scene`, method: "scene.open", params: { scene_path: scenePath } }
        ];

        const plan = [
          `Create ${scenePath} with root ${root}`,
          dimension === "2d"
            ? "Use godot_create_player_2d to add Player + script"
            : "Use godot_create_character_body_3d to add Player + Camera",
          "Use godot_setup_camera_2d / godot_setup_lighting if needed",
          "Run godot_save_scene"
        ];

        if (dry_run !== false) {
          return createDryRunResponse({
            toolName: "godot_create_playable_prototype",
            plannedChanges: plan,
            affectedFiles: [scenePath]
          });
        }

        const exec = await executePlan(steps, godot, true);
        return createSuccessResponse(
          {
            name,
            scene_path: scenePath,
            scaffold_done: !exec.halted,
            results: exec.results,
            next_steps: dimension === "2d"
              ? ["godot_create_player_2d", "godot_setup_camera_2d {parent_path:'Player'}"]
              : ["godot_create_character_body_3d {include_camera:true}", "godot_setup_lighting"]
          },
          "Prototype scaffold ready. Run the suggested next_steps to populate it."
        );
      })
    )
  );

  // ── godot_run_validation_loop ─────────────────────────────────────────────
  server.tool(
    "godot_run_validation_loop",
    "Run the project, optionally play for N ms, stop, then assert no errors and return the run report.",
    {
      hold_ms: z.number().int().nonnegative().max(60000).optional().describe("Time to keep the project running (ms). Defaults to 2000."),
      scene_path: z.string().optional().describe("Specific scene to run; omit for main scene.")
    },
    async ({ hold_ms, scene_path }) => toMcpResult(
      await executeToolSafely(ctx("godot_run_validation_loop", config), async (): Promise<ToolResponse> => {
        const runRpc = scene_path ? "debug.run_scene" : "debug.run_project";
        const runParams = scene_path ? { scene_path } : {};
        const runResult = await callAfterConnect(godot, runRpc, runParams);
        if (!runResult.ok) return runResult;

        const wait = hold_ms ?? 2000;
        if (wait > 0) await sleep(wait);

        const stopResult = await callAfterConnect(godot, "debug.stop_project", {});
        if (!stopResult.ok) {
          return createErrorResponse(
            "VALIDATION_LOOP_STOP_FAILED",
            "Project did not stop cleanly.",
            { run: runResult.data, stop_error: stopResult.error },
            ["Manually stop via godot_stop_project."]
          );
        }

        return createSuccessResponse(
          { mode: scene_path ? "scene" : "main_scene", scene_path: scene_path ?? null, hold_ms: wait, run: runResult.data, stop: stopResult.data },
          "Validation loop completed. Use godot_assert_no_errors and godot_get_last_run_report for details."
        );
      })
    )
  );

  // ── godot_create_game_jam_prototype ────────────────────────────────────────
  server.tool(
    "godot_create_game_jam_prototype",
    "End-to-end mini scaffold: scene + player + camera + HUD + run report. Always uses dry_run=true unless explicitly opted out.",
    {
      name: z.string().min(1).describe("Prototype name."),
      dimension: z.enum(["2d", "3d"]).describe("2d or 3d prototype."),
      include_hud: z.boolean().optional().describe("Defaults to true."),
      dry_run: z.boolean().optional().describe("Defaults to true.")
    },
    async ({ name, dimension, include_hud, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_game_jam_prototype", config), async (): Promise<ToolResponse> => {
        const root = dimension === "3d" ? "Node3D" : "Node2D";
        const scenePath = `res://scenes/${name}.tscn`;
        const hud = include_hud !== false;

        const steps: PlanStep[] = [
          { name: "Create scene", method: "scene.create", params: { scene_path: scenePath, root_type: root, root_name: name } },
          { name: "Open scene", method: "scene.open", params: { scene_path: scenePath } }
        ];
        if (dimension === "3d") {
          steps.push({ name: "Add WorldEnvironment", method: "node.add", params: { parent_path: ".", node_type: "WorldEnvironment", node_name: "WorldEnvironment" } });
          steps.push({ name: "Add DirectionalLight3D", method: "node.add", params: { parent_path: ".", node_type: "DirectionalLight3D", node_name: "Sun" } });
        }
        if (hud) {
          steps.push({ name: "Add HUD CanvasLayer", method: "node.add", params: { parent_path: ".", node_type: "CanvasLayer", node_name: "HUD" } });
        }
        steps.push({ name: "Save scene", method: "scene.save", params: {} });

        if (dry_run !== false) {
          return createDryRunResponse({
            toolName: "godot_create_game_jam_prototype",
            plannedChanges: steps.map((s) => s.name),
            affectedFiles: [scenePath]
          });
        }

        const exec = await executePlan(steps, godot, true);
        return createSuccessResponse(
          { name, dimension, scene_path: scenePath, executed_steps: exec.results.length, halted: exec.halted, results: exec.results },
          exec.halted ? "Prototype halted on first failure." : "Game jam prototype scaffold complete.",
          [],
          [
            "Use godot_create_player_2d or godot_create_character_body_3d to populate the player.",
            "Use godot_run_validation_loop to verify it boots without errors."
          ]
        );
      })
    )
  );

  // ── godot_explain_project_architecture ────────────────────────────────────
  server.tool(
    "godot_explain_project_architecture",
    "Compose project summary + dependency hubs + signal density + memory architecture notes into a single LLM-friendly markdown report.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_explain_project_architecture", config), async (): Promise<ToolResponse> => {
        const summary = await buildProjectSummary(config.projectRoot);
        const graph = await buildDependencyGraph(config.projectRoot);
        const signals = await buildSignalMap(config.projectRoot);

        const incoming = new Map<string, number>();
        for (const e of graph.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
        const hubs = [...incoming.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

        let architectureNotes = "";
        try {
          architectureNotes = await readFile(path.join(config.projectRoot, ".godot_mcp/memory/architecture.md"), "utf8");
        } catch { /* none */ }

        const lines: string[] = [];
        lines.push(`# Project Architecture — ${path.basename(config.projectRoot)}`);
        lines.push("");
        lines.push(`**Main scene:** ${summary.main_scene ?? "(none)"}  `);
        lines.push(`**Counts:** ${summary.scenes} scenes, ${summary.scripts} scripts, ${summary.assets} assets, ${summary.total} total files.`);
        lines.push("");
        lines.push("## Top dependency hubs");
        if (hubs.length === 0) {
          lines.push("- (none — empty or isolated graph)");
        } else {
          for (const [resPath, count] of hubs) lines.push(`- \`${resPath}\` — ${count} incoming reference(s)`);
        }
        lines.push("");
        lines.push("## Signal density");
        lines.push(`- ${signals.length} \`[connection]\` entries across ${new Set(signals.map((s) => s.scene)).size} scene(s).`);
        lines.push("");
        if (architectureNotes.trim()) {
          lines.push("## Architecture notes (memory)");
          lines.push("");
          lines.push(architectureNotes.trim());
        }

        const report = lines.join("\n");
        return createSuccessResponse(
          { report, summary, hubs: hubs.map(([res, c]) => ({ res_path: res, incoming_refs: c })), signal_count: signals.length },
          "Architecture explanation generated."
        );
      })
    )
  );

  // ── godot_prepare_release_checklist ───────────────────────────────────────
  server.tool(
    "godot_prepare_release_checklist",
    "Generate a release readiness checklist based on project state (main scene set, scripts validated, conventions, etc.) + write it to .godot_mcp/reports/release_checklist.md.",
    {
      write_report: z.boolean().optional().describe("Persist markdown to .godot_mcp/reports/release_checklist.md. Defaults to true.")
    },
    async ({ write_report }) => toMcpResult(
      await executeToolSafely(ctx("godot_prepare_release_checklist", config), async (): Promise<ToolResponse> => {
        const summary = await buildProjectSummary(config.projectRoot);

        const checklist: Array<{ item: string; passed: boolean; note?: string }> = [];
        checklist.push({ item: "Main scene defined in project.godot", passed: summary.main_scene !== null, note: summary.main_scene ?? "set application/run/main_scene" });
        checklist.push({ item: "At least 1 scene exists", passed: summary.scenes > 0 });
        checklist.push({ item: "At least 1 script exists", passed: summary.scripts > 0 });
        checklist.push({ item: "At least 1 asset exists", passed: summary.assets > 0, note: `current: ${summary.assets}` });
        checklist.push({ item: "project_summary.md present in memory", passed: await fileExists(path.join(config.projectRoot, ".godot_mcp/memory/project_summary.md")) });
        checklist.push({ item: "conventions.md present in memory", passed: await fileExists(path.join(config.projectRoot, ".godot_mcp/memory/conventions.md")) });
        checklist.push({ item: "actions.jsonl audit log exists", passed: await fileExists(path.join(config.projectRoot, ".godot_mcp/logs/actions.jsonl")) });
        checklist.push({ item: "At least one run report exists", passed: await dirNotEmpty(path.join(config.projectRoot, ".godot_mcp/logs/run_reports")) });

        const passed = checklist.filter((c) => c.passed).length;
        const failed = checklist.length - passed;

        const lines: string[] = [];
        lines.push(`# Release Checklist — ${new Date().toISOString().slice(0, 10)}`);
        lines.push("");
        lines.push(`**Status:** ${passed}/${checklist.length} checks pass${failed > 0 ? ` (${failed} pending)` : ""}.`);
        lines.push("");
        for (const c of checklist) {
          lines.push(`- [${c.passed ? "x" : " "}] ${c.item}${c.note ? ` — _${c.note}_` : ""}`);
        }

        const report = lines.join("\n");
        let writtenPath: string | null = null;
        if (write_report !== false) {
          const dir = path.join(config.projectRoot, ".godot_mcp", "reports");
          await mkdir(dir, { recursive: true });
          writtenPath = path.join(dir, "release_checklist.md");
          await writeFile(writtenPath, report, "utf8");
        }

        return createSuccessResponse(
          { passed, failed, total: checklist.length, checklist, report, written_to: writtenPath },
          failed === 0 ? "All release checks passed." : `${failed} release check(s) pending.`,
          [],
          failed > 0 ? ["Address pending items before tagging v1.0.0."] : ["Project meets baseline release criteria."]
        );
      })
    )
  );

  // ── godot_fix_errors_agentic (alias / pointer) ────────────────────────────
  server.tool(
    "godot_fix_errors_agentic",
    "Agentic wrapper hint: delegates to godot_fix_errors (Phase 6). Returns guidance for safer multi-pass fix loops.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_fix_errors_agentic", config), async (): Promise<ToolResponse> =>
        createSuccessResponse(
          {
            primary_tool: "godot_fix_errors",
            recommended_loop: [
              "1. godot_get_script_parse_errors  (scan)",
              "2. godot_fix_errors {dry_run:true}  (preview plan)",
              "3. godot_fix_errors {dry_run:false} (apply with backup)",
              "4. godot_validate_script per file   (verify)",
              "5. godot_run_validation_loop        (boot test)"
            ]
          },
          "Use godot_fix_errors directly with the recommended loop above."
        )
      )
    )
  );
}

// ── Local helpers ─────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try {
    const fs = await import("node:fs/promises");
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirNotEmpty(p: string): Promise<boolean> {
  try {
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}
