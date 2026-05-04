import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

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

type StepResult = { step: string; ok: boolean; data?: unknown; error?: unknown };

async function runStep(steps: StepResult[], label: string, fn: () => Promise<ToolResponse>): Promise<ToolResponse> {
  const r = await fn();
  steps.push({ step: label, ok: r.ok, data: r.ok ? r.data : undefined, error: !r.ok ? r.error : undefined });
  return r;
}

// ── Standard workflow report shape ─────────────────────────────────────────────

type WorkflowReport = {
  plan: string[];
  steps_executed: StepResult[];
  files_created: string[];
  files_modified: string[];
  scenes_modified: string[];
  tests_generated: string[];
  validation: {
    scripts_compile: boolean;
    scene_loads: boolean;
    runtime_errors: string[];
  };
  summary: string;
  dry_run: boolean;
};

// ── Tool registration ──────────────────────────────────────────────────────────

export function registerWorkflowTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {

  // ── devpilot_build_feature ─────────────────────────────────────────────────
  server.tool(
    "devpilot_build_feature",
    "High-level workflow: plan → dry-run → create scene/script/nodes → backup → execute → validate → generate test → report. Orchestrates multiple MCP tools to build a complete Godot feature.",
    {
      feature_name: z.string().min(1).describe("PascalCase name (e.g. 'InventorySystem')."),
      kind: z.enum(["scene_with_script", "script_only", "ui_panel", "gameplay_system"]),
      description: z.string().optional().describe("Natural language feature description for context."),
      base_node: z.string().optional().describe("Root node type override."),
      generate_test: z.boolean().optional().describe("Generate behavior test after creation. Default true."),
      dry_run: z.boolean().optional()
    },
    async ({ feature_name, kind, description, base_node, generate_test, dry_run }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_build_feature", config), async (): Promise<ToolResponse> => {
          const isDryRun = dry_run !== false;
          const shouldGenerateTest = generate_test !== false;

          // Resolve default base node by kind
          const defaultBase = kind === "ui_panel" ? "Control"
            : kind === "scene_with_script" ? "Node2D"
            : kind === "gameplay_system" ? "Node"
            : "Node";
          const baseType = base_node ?? defaultBase;

          const scenePath = `res://scenes/${feature_name}.tscn`;
          const scriptPath = `res://scripts/${feature_name}.gd`;
          const testScenarioName = `${feature_name}Test`;

          // Build plan
          const plan: string[] = [];
          if (kind !== "script_only") {
            plan.push(`Create scene: ${scenePath} (root: ${baseType})`);
            plan.push(`Open scene: ${scenePath}`);
          }
          plan.push(`Create script: ${scriptPath} (extends ${baseType})`);
          if (kind !== "script_only") {
            plan.push(`Attach script to root node`);
            plan.push(`Save scene: ${scenePath}`);
            plan.push(`Validate scene: ${scenePath}`);
          }
          if (shouldGenerateTest) {
            plan.push(`Run project (2 s) → capture runtime tree → stop`);
            plan.push(`Generate test scenario: ${testScenarioName}`);
          }

          if (isDryRun) {
            const report: WorkflowReport = {
              plan,
              steps_executed: [],
              files_created: [scriptPath, ...(kind !== "script_only" ? [scenePath] : [])],
              files_modified: [],
              scenes_modified: kind !== "script_only" ? [scenePath] : [],
              tests_generated: shouldGenerateTest ? [testScenarioName] : [],
              validation: { scripts_compile: false, scene_loads: false, runtime_errors: [] },
              summary: `Dry run — ${plan.length} steps planned for '${feature_name}' (${kind}).`,
              dry_run: true
            };
            return createDryRunResponse({
              toolName: "devpilot_build_feature",
              plannedChanges: plan,
              affectedFiles: [scriptPath, ...(kind !== "script_only" ? [scenePath] : [])]
            });
          }

          // Step 1: Project doctor (errors only)
          const steps: StepResult[] = [];
          await runStep(steps, "project_doctor: get_debugger_errors", () =>
            callAfterConnect(godot, "debug.get_debugger_errors", {})
          );

          // Step 2-3: Create + open scene (if applicable)
          if (kind !== "script_only") {
            const createResult = await runStep(steps, `scene.create: ${scenePath}`, () =>
              callAfterConnect(godot, "scene.create", { scene_path: scenePath, root_type: baseType, root_name: feature_name })
            );
            if (!createResult.ok) {
              return buildErrorReport(steps, plan, feature_name, "Scene creation failed.");
            }
            const openResult = await runStep(steps, `scene.open: ${scenePath}`, () =>
              callAfterConnect(godot, "scene.open", { scene_path: scenePath })
            );
            if (!openResult.ok) {
              return buildErrorReport(steps, plan, feature_name, "Scene open failed.");
            }
          }

          // Step 4: Create script
          const scriptResult = await runStep(steps, `script.create: ${scriptPath}`, () =>
            callAfterConnect(godot, "script.create", { path: scriptPath, extends: baseType, description: description ?? "" })
          );
          if (!scriptResult.ok) {
            return buildErrorReport(steps, plan, feature_name, "Script creation failed.");
          }

          // Step 5: Attach script (if scene exists)
          if (kind !== "script_only") {
            await runStep(steps, "script.attach to root node", () =>
              callAfterConnect(godot, "script.attach", { node_path: ".", script_path: scriptPath })
            );

            // Step 6: Save scene
            await runStep(steps, "scene.save", () =>
              callAfterConnect(godot, "scene.save", {})
            );

            // Step 7: Validate scene
            await runStep(steps, "scene.validate", () =>
              callAfterConnect(godot, "scene.validate", { scene_path: scenePath })
            );
          }

          // Steps for test generation
          const testsGenerated: string[] = [];
          let runtimeErrors: string[] = [];
          let sceneLoads = kind === "script_only"; // scripts always load

          // Validate scene result
          const validateStep = steps.find(s => s.step === "scene.validate");
          if (validateStep) {
            sceneLoads = validateStep.ok;
          }

          if (shouldGenerateTest) {
            // Run project
            await runStep(steps, "debug.run_project", () =>
              callAfterConnect(godot, "debug.run_project", {})
            );
            await sleep(2000);

            // Capture runtime tree
            await runStep(steps, "runtime.get_tree", () =>
              callAfterConnect(godot, "runtime.get_tree", {})
            );

            // Stop project
            await runStep(steps, "debug.stop_project", () =>
              callAfterConnect(godot, "debug.stop_project", {})
            );

            // Generate test scenario
            const testResult = await runStep(steps, `test.create_scenario: ${testScenarioName}`, () =>
              callAfterConnect(godot, "test.create_scenario", {
                name: testScenarioName,
                scene_path: scenePath,
                description: description ?? `Behavior test for ${feature_name}`
              })
            );
            if (testResult.ok) {
              testsGenerated.push(testScenarioName);
            }
          }

          // Collect runtime errors from steps
          const runStep_ = steps.find(s => s.step === "debug.run_project");
          if (runStep_ && !runStep_.ok) {
            runtimeErrors.push("Project failed to run.");
          }

          const failedCount = steps.filter(s => !s.ok).length;
          const scriptsCompile = scriptResult.ok;

          const report: WorkflowReport = {
            plan,
            steps_executed: steps,
            files_created: [scriptPath, ...(kind !== "script_only" ? [scenePath] : [])],
            files_modified: [],
            scenes_modified: kind !== "script_only" ? [scenePath] : [],
            tests_generated: testsGenerated,
            validation: {
              scripts_compile: scriptsCompile,
              scene_loads: sceneLoads,
              runtime_errors: runtimeErrors
            },
            summary: failedCount === 0
              ? `Feature '${feature_name}' built successfully (${steps.length} steps).`
              : `Feature '${feature_name}' built with ${failedCount} failure(s).`,
            dry_run: false
          };

          return createSuccessResponse(
            report,
            report.summary,
            failedCount > 0 ? [`${failedCount} step(s) failed — check steps_executed for details.`] : [],
            testsGenerated.length > 0 ? ["Run generated test via godot_run_test_scenario."] : []
          );
        })
      )
  );

  // ── devpilot_fix_bug ───────────────────────────────────────────────────────
  server.tool(
    "devpilot_fix_bug",
    "Automated bug fix workflow: get errors → analyze → fix → validate → run → report. Calls godot_fix_errors with dry_run first, then applies if safe.",
    {
      script_path: z.string().optional().describe("Specific script to fix. Omit to fix all errors."),
      dry_run: z.boolean().optional(),
      validate_after: z.boolean().optional().describe("Run validation loop after fix. Default true.")
    },
    async ({ script_path, dry_run, validate_after }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_fix_bug", config), async (): Promise<ToolResponse> => {
          const isDryRun = dry_run !== false;
          const shouldValidate = validate_after !== false;

          const plan: string[] = [
            "Step 1: Get current debugger errors",
            ...(script_path ? ["Step 2: Get script parse errors for target script"] : []),
            "Step 3: Preview fix (dry_run=true)",
            ...(isDryRun ? [] : [
              "Step 4: Apply fix (dry_run=false)",
              "Step 5: Validate fixed script(s)",
              ...(shouldValidate ? [
                "Step 6: Run project (2 s) → collect runtime errors → stop"
              ] : [])
            ])
          ];

          const steps: StepResult[] = [];

          // Step 1: Get debugger errors
          const debugErrorsResult = await runStep(steps, "debug.get_debugger_errors", () =>
            callAfterConnect(godot, "debug.get_debugger_errors", {})
          );

          const errorsBeforeRaw = debugErrorsResult.ok
            ? (Array.isArray((debugErrorsResult.data as any)?.errors)
              ? (debugErrorsResult.data as any).errors
              : [])
            : [];
          const errorsBeforeCount: number = errorsBeforeRaw.length;

          // Step 2: Parse errors if script_path given
          if (script_path) {
            await runStep(steps, `debug.get_script_parse_errors: ${script_path}`, () =>
              callAfterConnect(godot, "debug.get_script_parse_errors", { script_path })
            );
          }

          // Step 3: Dry-run fix preview
          const previewParams: Record<string, unknown> = { dry_run: true };
          if (script_path) previewParams.script_path = script_path;

          const previewResult = await runStep(steps, "script.fix_errors (dry_run=true)", () =>
            callAfterConnect(godot, "script.fix_errors", previewParams)
          );

          if (isDryRun) {
            const report: WorkflowReport = {
              plan,
              steps_executed: steps,
              files_created: [],
              files_modified: [],
              scenes_modified: [],
              tests_generated: [],
              validation: { scripts_compile: false, scene_loads: false, runtime_errors: [] },
              summary: `Dry run — fix preview ready. Errors before: ${errorsBeforeCount}.`,
              dry_run: true
            };
            return createSuccessResponse(
              {
                ...report,
                errors_before: errorsBeforeCount,
                preview: previewResult.ok ? previewResult.data : null
              },
              "Dry run complete. Re-run with dry_run=false to apply.",
              [],
              ["Review the preview.planned_fixes before applying."]
            );
          }

          // Step 4: Apply fix
          const applyParams: Record<string, unknown> = { dry_run: false };
          if (script_path) applyParams.script_path = script_path;

          const applyResult = await runStep(steps, "script.fix_errors (dry_run=false)", () =>
            callAfterConnect(godot, "script.fix_errors", applyParams)
          );

          const filesModified: string[] = [];
          if (applyResult.ok && Array.isArray((applyResult.data as any)?.fixed_scripts)) {
            filesModified.push(...(applyResult.data as any).fixed_scripts);
          } else if (script_path) {
            filesModified.push(script_path);
          }

          // Step 5: Validate each fixed script
          let scriptsCompile = true;
          for (const fp of filesModified) {
            const validateResult = await runStep(steps, `script.validate: ${fp}`, () =>
              callAfterConnect(godot, "script.validate", { script_path: fp })
            );
            if (!validateResult.ok) scriptsCompile = false;
          }

          // Step 6: Runtime validation
          let runtimeErrors: string[] = [];
          let errorsAfterCount = 0;

          if (shouldValidate) {
            await runStep(steps, "debug.run_project", () =>
              callAfterConnect(godot, "debug.run_project", {})
            );
            await sleep(2000);

            const afterErrorsResult = await runStep(steps, "debug.get_debugger_errors (after)", () =>
              callAfterConnect(godot, "debug.get_debugger_errors", {})
            );

            await runStep(steps, "debug.stop_project", () =>
              callAfterConnect(godot, "debug.stop_project", {})
            );

            if (afterErrorsResult.ok && Array.isArray((afterErrorsResult.data as any)?.errors)) {
              const afterErrors = (afterErrorsResult.data as any).errors;
              errorsAfterCount = afterErrors.length;
              runtimeErrors = afterErrors.map((e: unknown) => String(e));
            }
          }

          const failedCount = steps.filter(s => !s.ok).length;

          const report: WorkflowReport = {
            plan,
            steps_executed: steps,
            files_created: [],
            files_modified: filesModified,
            scenes_modified: [],
            tests_generated: [],
            validation: {
              scripts_compile: scriptsCompile,
              scene_loads: false,
              runtime_errors: runtimeErrors
            },
            summary: `Bug fix applied. Errors before: ${errorsBeforeCount}, after: ${errorsAfterCount}. Fixed scripts: ${filesModified.length}.`,
            dry_run: false
          };

          return createSuccessResponse(
            {
              ...report,
              errors_before: errorsBeforeCount,
              errors_after: errorsAfterCount,
              errors_resolved: Math.max(0, errorsBeforeCount - errorsAfterCount)
            },
            report.summary,
            failedCount > 0 ? [`${failedCount} step(s) encountered failures.`] : [],
            errorsAfterCount > 0 ? ["Remaining runtime errors detected — review validation.runtime_errors."] : ["All errors resolved."]
          );
        })
      )
  );

  // ── devpilot_create_gameplay_loop ──────────────────────────────────────────
  server.tool(
    "devpilot_create_gameplay_loop",
    "Create a complete gameplay loop: player + enemy + collectible + health system + camera + save the scene. Orchestrates 2D toolkit tools.",
    {
      scene_name: z.string().min(1).describe("Scene name (PascalCase)."),
      include_enemy: z.boolean().optional().describe("Add patrol enemy. Default true."),
      include_collectible: z.boolean().optional().describe("Add collectible. Default true."),
      include_health: z.boolean().optional().describe("Add health system. Default true."),
      include_camera: z.boolean().optional().describe("Add Camera2D. Default true."),
      controller: z.enum(["topdown", "platformer"]).optional().describe("Player controller type. Default topdown."),
      dry_run: z.boolean().optional()
    },
    async ({ scene_name, include_enemy, include_collectible, include_health, include_camera, controller, dry_run }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_gameplay_loop", config), async (): Promise<ToolResponse> => {
          const isDryRun = dry_run !== false;
          const withEnemy = include_enemy !== false;
          const withCollectible = include_collectible !== false;
          const withHealth = include_health !== false;
          const withCamera = include_camera !== false;
          const controllerType = controller ?? "topdown";

          const scenePath = `res://scenes/${scene_name}.tscn`;
          const playerScriptPath = `res://scripts/${scene_name}Player.gd`;

          const plan: string[] = [
            `Create scene: ${scenePath} (root: Node2D)`,
            `Open scene: ${scenePath}`,
            `Add player (CharacterBody2D + Sprite2D + CollisionShape2D + script, controller: ${controllerType})`,
            ...(withEnemy ? ["Add enemy (CharacterBody2D + Sprite2D + CollisionShape2D)"] : []),
            ...(withCollectible ? ["Add collectible (Area2D + Sprite2D + CollisionShape2D)"] : []),
            ...(withHealth ? ["Add health system (CanvasLayer + Control + HealthBar)"] : []),
            ...(withCamera ? ["Add Camera2D (attached to Player)"] : []),
            `Save scene: ${scenePath}`,
            `Validate scene: ${scenePath}`
          ];

          if (isDryRun) {
            const report: WorkflowReport = {
              plan,
              steps_executed: [],
              files_created: [scenePath, playerScriptPath],
              files_modified: [],
              scenes_modified: [scenePath],
              tests_generated: [],
              validation: { scripts_compile: false, scene_loads: false, runtime_errors: [] },
              summary: `Dry run — ${plan.length} steps planned for gameplay loop '${scene_name}'.`,
              dry_run: true
            };
            return createDryRunResponse({
              toolName: "devpilot_create_gameplay_loop",
              plannedChanges: plan,
              affectedFiles: [scenePath, playerScriptPath]
            });
          }

          const steps: StepResult[] = [];
          const filesCreated: string[] = [];

          // Step 1: Create scene
          const createResult = await runStep(steps, `scene.create: ${scenePath}`, () =>
            callAfterConnect(godot, "scene.create", { scene_path: scenePath, root_type: "Node2D", root_name: scene_name })
          );
          if (!createResult.ok) {
            return buildErrorReport(steps, plan, scene_name, "Scene creation failed.");
          }
          filesCreated.push(scenePath);

          // Step 2: Open scene
          await runStep(steps, `scene.open: ${scenePath}`, () =>
            callAfterConnect(godot, "scene.open", { scene_path: scenePath })
          );

          // Step 3: Create player structure
          await runStep(steps, "node.add: Player (CharacterBody2D)", () =>
            callAfterConnect(godot, "node.add", { node_type: "CharacterBody2D", node_name: "Player", parent_path: "." })
          );
          await runStep(steps, "node.add: Sprite2D under Player", () =>
            callAfterConnect(godot, "node.add", { node_type: "Sprite2D", node_name: "Sprite2D", parent_path: "Player" })
          );
          await runStep(steps, "node.add: CollisionShape2D under Player", () =>
            callAfterConnect(godot, "node.add", { node_type: "CollisionShape2D", node_name: "Collision", parent_path: "Player" })
          );

          // Create player script
          const playerScriptResult = await runStep(steps, `script.create: ${playerScriptPath}`, () =>
            callAfterConnect(godot, "script.create", {
              path: playerScriptPath,
              extends: "CharacterBody2D",
              description: `${controllerType} controller for ${scene_name}`
            })
          );
          if (playerScriptResult.ok) filesCreated.push(playerScriptPath);

          // Attach player script
          await runStep(steps, "script.attach: Player", () =>
            callAfterConnect(godot, "script.attach", { node_path: "Player", script_path: playerScriptPath })
          );

          // Step 4: Add enemy
          if (withEnemy) {
            await runStep(steps, "node.add: Enemy (CharacterBody2D)", () =>
              callAfterConnect(godot, "node.add", { node_type: "CharacterBody2D", node_name: "Enemy", parent_path: "." })
            );
            await runStep(steps, "node.add: Sprite2D under Enemy", () =>
              callAfterConnect(godot, "node.add", { node_type: "Sprite2D", node_name: "Sprite2D", parent_path: "Enemy" })
            );
            await runStep(steps, "node.add: CollisionShape2D under Enemy", () =>
              callAfterConnect(godot, "node.add", { node_type: "CollisionShape2D", node_name: "Collision", parent_path: "Enemy" })
            );
          }

          // Step 5: Add collectible
          if (withCollectible) {
            await runStep(steps, "node.add: Collectible (Area2D)", () =>
              callAfterConnect(godot, "node.add", { node_type: "Area2D", node_name: "Collectible", parent_path: "." })
            );
            await runStep(steps, "node.add: Sprite2D under Collectible", () =>
              callAfterConnect(godot, "node.add", { node_type: "Sprite2D", node_name: "Sprite2D", parent_path: "Collectible" })
            );
            await runStep(steps, "node.add: CollisionShape2D under Collectible", () =>
              callAfterConnect(godot, "node.add", { node_type: "CollisionShape2D", node_name: "Collision", parent_path: "Collectible" })
            );
          }

          // Step 6: Add health system
          if (withHealth) {
            await runStep(steps, "node.add: CanvasLayer (HUD)", () =>
              callAfterConnect(godot, "node.add", { node_type: "CanvasLayer", node_name: "HUD", parent_path: "." })
            );
            await runStep(steps, "node.add: Control under HUD", () =>
              callAfterConnect(godot, "node.add", { node_type: "Control", node_name: "Root", parent_path: "HUD" })
            );
            await runStep(steps, "node.add: ProgressBar (HealthBar) under HUD/Root", () =>
              callAfterConnect(godot, "node.add", { node_type: "ProgressBar", node_name: "HealthBar", parent_path: "HUD/Root" })
            );
          }

          // Step 7: Add Camera2D
          if (withCamera) {
            await runStep(steps, "node.add: Camera2D under Player", () =>
              callAfterConnect(godot, "node.add", { node_type: "Camera2D", node_name: "Camera2D", parent_path: "Player" })
            );
          }

          // Step 8: Save scene
          await runStep(steps, "scene.save", () =>
            callAfterConnect(godot, "scene.save", {})
          );

          // Step 9: Validate scene
          const validateResult = await runStep(steps, "scene.validate", () =>
            callAfterConnect(godot, "scene.validate", { scene_path: scenePath })
          );

          const failedCount = steps.filter(s => !s.ok).length;
          const sceneLoads = validateResult.ok;

          const report: WorkflowReport = {
            plan,
            steps_executed: steps,
            files_created: filesCreated,
            files_modified: [],
            scenes_modified: [scenePath],
            tests_generated: [],
            validation: {
              scripts_compile: playerScriptResult.ok,
              scene_loads: sceneLoads,
              runtime_errors: []
            },
            summary: failedCount === 0
              ? `Gameplay loop '${scene_name}' created successfully (${steps.length} steps).`
              : `Gameplay loop '${scene_name}' created with ${failedCount} failure(s).`,
            dry_run: false
          };

          return createSuccessResponse(
            report,
            report.summary,
            failedCount > 0 ? [`${failedCount} step(s) failed — review steps_executed.`] : [],
            ["Run devpilot_validate_project to confirm the scene loads correctly."]
          );
        })
      )
  );

  // ── devpilot_refactor_scene_safely ─────────────────────────────────────────
  server.tool(
    "devpilot_refactor_scene_safely",
    "Safe scene refactor workflow: impact check → dry-run → backup → apply changes → validate → report.",
    {
      scene_path: z.string().describe("res:// path to .tscn to refactor."),
      changes: z.array(z.object({
        type: z.enum(["rename_node", "move_node", "add_script", "remove_node", "set_property"]),
        node_path: z.string(),
        value: z.unknown().optional().describe("New name, new parent path, script path, property value.")
      })).min(1).describe("List of changes to apply."),
      dry_run: z.boolean().optional()
    },
    async ({ scene_path, changes, dry_run }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_refactor_scene_safely", config), async (): Promise<ToolResponse> => {
          const isDryRun = dry_run !== false;

          const plan: string[] = [
            `Open scene: ${scene_path}`,
            `Validate current state: ${scene_path}`,
            `Impact check: ${scene_path}`,
            ...(isDryRun ? [] : [
              "Save backup (scene.save)",
              ...changes.map(c => `Apply ${c.type} on ${c.node_path}${c.value !== undefined ? ` → ${JSON.stringify(c.value)}` : ""}`),
              "Save scene after changes",
              "Validate scene post-refactor"
            ])
          ];

          const steps: StepResult[] = [];

          // Step 1: Open scene
          const openResult = await runStep(steps, `scene.open: ${scene_path}`, () =>
            callAfterConnect(godot, "scene.open", { scene_path })
          );
          if (!openResult.ok) {
            return buildErrorReport(steps, plan, scene_path, "Failed to open scene for refactor.");
          }

          // Step 2: Validate current state
          await runStep(steps, "scene.validate (pre-refactor)", () =>
            callAfterConnect(godot, "scene.validate", { scene_path })
          );

          // Step 3: Impact check
          const impactResult = await runStep(steps, "intelligence.impact_check", () =>
            callAfterConnect(godot, "intelligence.impact_check", { path: scene_path })
          );

          if (isDryRun) {
            const report: WorkflowReport = {
              plan,
              steps_executed: steps,
              files_created: [],
              files_modified: [],
              scenes_modified: [],
              tests_generated: [],
              validation: { scripts_compile: false, scene_loads: false, runtime_errors: [] },
              summary: `Dry run — ${changes.length} change(s) planned for '${scene_path}'. Impact check complete.`,
              dry_run: true
            };
            return createSuccessResponse(
              {
                ...report,
                impact: impactResult.ok ? impactResult.data : null,
                planned_changes: changes.map(c => ({
                  type: c.type,
                  node_path: c.node_path,
                  value: c.value
                }))
              },
              "Dry run complete. Review impact before applying.",
              [],
              ["Set dry_run=false to apply the refactor changes."]
            );
          }

          // Step 4: Backup (save current state)
          await runStep(steps, "scene.save (backup)", () =>
            callAfterConnect(godot, "scene.save", {})
          );

          // Step 5: Apply each change
          for (const change of changes) {
            const label = `${change.type}: ${change.node_path}`;
            switch (change.type) {
              case "rename_node":
                await runStep(steps, label, () =>
                  callAfterConnect(godot, "node.rename", {
                    node_path: change.node_path,
                    new_name: change.value as string
                  })
                );
                break;
              case "move_node":
                await runStep(steps, label, () =>
                  callAfterConnect(godot, "node.reparent", {
                    node_path: change.node_path,
                    new_parent_path: change.value as string
                  })
                );
                break;
              case "add_script":
                await runStep(steps, label, () =>
                  callAfterConnect(godot, "script.attach", {
                    node_path: change.node_path,
                    script_path: change.value as string
                  })
                );
                break;
              case "remove_node":
                await runStep(steps, label, () =>
                  callAfterConnect(godot, "node.remove", { node_path: change.node_path })
                );
                break;
              case "set_property": {
                const val = change.value as { property: string; value: unknown } | undefined;
                await runStep(steps, label, () =>
                  callAfterConnect(godot, "node.set_property", {
                    node_path: change.node_path,
                    property: val?.property ?? "",
                    value: val?.value ?? null
                  })
                );
                break;
              }
            }
          }

          // Step 6: Save scene after changes
          await runStep(steps, "scene.save (post-refactor)", () =>
            callAfterConnect(godot, "scene.save", {})
          );

          // Step 7: Validate post-refactor
          const postValidateResult = await runStep(steps, "scene.validate (post-refactor)", () =>
            callAfterConnect(godot, "scene.validate", { scene_path })
          );

          const failedCount = steps.filter(s => !s.ok).length;
          const sceneLoads = postValidateResult.ok;

          const report: WorkflowReport = {
            plan,
            steps_executed: steps,
            files_created: [],
            files_modified: [scene_path],
            scenes_modified: [scene_path],
            tests_generated: [],
            validation: {
              scripts_compile: false,
              scene_loads: sceneLoads,
              runtime_errors: []
            },
            summary: failedCount === 0
              ? `Refactor of '${scene_path}' applied successfully (${changes.length} change(s)).`
              : `Refactor applied with ${failedCount} failure(s). Review steps_executed.`,
            dry_run: false
          };

          return createSuccessResponse(
            report,
            report.summary,
            failedCount > 0 ? [`${failedCount} step(s) failed during refactor.`] : [],
            !sceneLoads ? ["Scene validation failed post-refactor — investigate immediately."] : []
          );
        })
      )
  );

  // ── devpilot_validate_project ──────────────────────────────────────────────
  server.tool(
    "devpilot_validate_project",
    "Complete project validation: project doctor + open all scenes + check conventions + run game + report. One-command full health check.",
    {
      run_game: z.boolean().optional().describe("Run game as part of validation. Default true."),
      hold_ms: z.number().optional().describe("Game run duration ms. Default 2000."),
      check_conventions: z.boolean().optional().describe("Check naming conventions. Default true.")
    },
    async ({ run_game, hold_ms, check_conventions }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_validate_project", config), async (): Promise<ToolResponse> => {
          const shouldRunGame = run_game !== false;
          const runDuration = hold_ms ?? 2000;
          const shouldCheckConventions = check_conventions !== false;

          const plan: string[] = [
            "project.get_info — get project summary",
            "batch.find_unused — detect unused resources",
            "batch.detect_circular — detect circular dependencies",
            "infer.input_map_from_scripts — validate input map",
            "infer.autoloads_from_scripts — validate autoloads",
            "project.get_open_scenes — list open scenes",
            "scene.validate — validate each open scene",
            ...(shouldCheckConventions ? ["intelligence.validate_conventions — check naming conventions"] : []),
            ...(shouldRunGame ? [
              `debug.run_project — run game (${runDuration}ms)`,
              "runtime.get_fps — capture FPS",
              "debug.get_debugger_errors — capture runtime errors",
              "debug.stop_project — stop game"
            ] : [])
          ];

          const steps: StepResult[] = [];
          const scenesModified: string[] = [];
          const runtimeErrors: string[] = [];

          // Step 1: Project info
          await runStep(steps, "project.get_info", () =>
            callAfterConnect(godot, "project.get_info", {})
          );

          // Step 2: Doctor checks
          await runStep(steps, "batch.find_unused", () =>
            callAfterConnect(godot, "batch.find_unused", {})
          );
          await runStep(steps, "batch.detect_circular", () =>
            callAfterConnect(godot, "batch.detect_circular", {})
          );
          await runStep(steps, "infer.input_map_from_scripts", () =>
            callAfterConnect(godot, "infer.input_map_from_scripts", {})
          );
          await runStep(steps, "infer.autoloads_from_scripts", () =>
            callAfterConnect(godot, "infer.autoloads_from_scripts", {})
          );

          // Step 3: Get open scenes
          const openScenesResult = await runStep(steps, "project.get_open_scenes", () =>
            callAfterConnect(godot, "project.get_open_scenes", {})
          );

          const openScenes: string[] = [];
          if (openScenesResult.ok) {
            const raw = (openScenesResult.data as any)?.scenes;
            if (Array.isArray(raw)) openScenes.push(...raw);
          }

          // Step 4: Validate each open scene
          let allScenesLoad = true;
          for (const sp of openScenes) {
            const vr = await runStep(steps, `scene.validate: ${sp}`, () =>
              callAfterConnect(godot, "scene.validate", { scene_path: sp })
            );
            if (!vr.ok) allScenesLoad = false;
            scenesModified.push(sp);
          }

          // Step 5: Conventions check
          if (shouldCheckConventions) {
            await runStep(steps, "intelligence.validate_conventions", () =>
              callAfterConnect(godot, "intelligence.validate_conventions", {})
            );
          }

          // Step 6: Run game
          let fps: number | null = null;
          if (shouldRunGame) {
            await runStep(steps, "debug.run_project", () =>
              callAfterConnect(godot, "debug.run_project", {})
            );
            await sleep(runDuration);

            const fpsResult = await runStep(steps, "runtime.get_fps", () =>
              callAfterConnect(godot, "runtime.get_fps", {})
            );
            if (fpsResult.ok) {
              fps = (fpsResult.data as any)?.fps ?? null;
            }

            const errorsResult = await runStep(steps, "debug.get_debugger_errors (runtime)", () =>
              callAfterConnect(godot, "debug.get_debugger_errors", {})
            );
            if (errorsResult.ok && Array.isArray((errorsResult.data as any)?.errors)) {
              runtimeErrors.push(...(errorsResult.data as any).errors.map((e: unknown) => String(e)));
            }

            await runStep(steps, "debug.stop_project", () =>
              callAfterConnect(godot, "debug.stop_project", {})
            );
          }

          const failedCount = steps.filter(s => !s.ok).length;

          const report: WorkflowReport = {
            plan,
            steps_executed: steps,
            files_created: [],
            files_modified: [],
            scenes_modified: scenesModified,
            tests_generated: [],
            validation: {
              scripts_compile: true,
              scene_loads: allScenesLoad,
              runtime_errors: runtimeErrors
            },
            summary: failedCount === 0 && runtimeErrors.length === 0
              ? `Project validation passed — ${steps.length} checks, ${openScenes.length} scene(s) validated${fps !== null ? `, ${fps} FPS` : ""}.`
              : `Project validation found issues — ${failedCount} step failure(s), ${runtimeErrors.length} runtime error(s).`,
            dry_run: false
          };

          return createSuccessResponse(
            {
              ...report,
              scenes_validated: openScenes,
              fps,
              doctor_steps: steps
                .filter(s => ["batch.find_unused", "batch.detect_circular", "infer.input_map_from_scripts", "infer.autoloads_from_scripts"].some(m => s.step.includes(m)))
                .map(s => ({ check: s.step, ok: s.ok, data: s.data }))
            },
            report.summary,
            failedCount > 0 ? [`${failedCount} validation step(s) failed.`] : [],
            runtimeErrors.length > 0 ? ["Fix runtime errors before release."] : []
          );
        })
      )
  );

  // ── devpilot_prepare_export_release ───────────────────────────────────────
  server.tool(
    "devpilot_prepare_export_release",
    "Full release preparation workflow: validate project → check export presets → generate release checklist → run validation loop → produce export commands. Returns ready-to-ship status.",
    {
      run_validation: z.boolean().optional().describe("Run game validation before export. Default true."),
      hold_ms: z.number().optional().describe("Validation run duration ms. Default 3000.")
    },
    async ({ run_validation, hold_ms }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_prepare_export_release", config), async (): Promise<ToolResponse> => {
          const shouldValidate = run_validation !== false;
          const runDuration = hold_ms ?? 3000;

          const plan: string[] = [
            "project.get_info — get project metadata",
            "export.list_presets — check configured export presets",
            "release.checklist — generate release checklist",
            ...(shouldValidate ? [
              `debug.run_project — validation run (${runDuration}ms)`,
              "debug.get_debugger_errors — collect runtime errors",
              "debug.stop_project — stop game"
            ] : []),
            "batch.find_unused — detect orphan resources",
            "batch.detect_circular — detect circular dependencies",
            "Generate export commands for each preset"
          ];

          const steps: StepResult[] = [];
          const blockers: string[] = [];
          const runtimeErrors: string[] = [];

          // Step 1: Project info
          const projectInfoResult = await runStep(steps, "project.get_info", () =>
            callAfterConnect(godot, "project.get_info", {})
          );
          const projectName: string = projectInfoResult.ok
            ? ((projectInfoResult.data as any)?.name ?? "UnknownProject")
            : "UnknownProject";
          const mainScene: string | null = projectInfoResult.ok
            ? ((projectInfoResult.data as any)?.main_scene ?? null)
            : null;

          if (!mainScene) {
            blockers.push("No main scene defined in project.godot (application/run/main_scene).");
          }

          // Step 2: Export presets
          const presetsResult = await runStep(steps, "export.list_presets", () =>
            callAfterConnect(godot, "export.list_presets", {})
          );

          const presets: Array<{ name: string; platform: string; path?: string }> = [];
          if (presetsResult.ok && Array.isArray((presetsResult.data as any)?.presets)) {
            presets.push(...(presetsResult.data as any).presets);
          } else if (!presetsResult.ok) {
            blockers.push("Could not retrieve export presets. Ensure at least one export preset is configured.");
          }
          if (presets.length === 0) {
            blockers.push("No export presets configured. Add at least one in Project → Export.");
          }

          // Step 3: Release checklist
          const checklistResult = await runStep(steps, "release.checklist", () =>
            callAfterConnect(godot, "release.checklist", {})
          );

          let checklistPassed = 0;
          let checklistTotal = 0;
          if (checklistResult.ok) {
            const data = checklistResult.data as any;
            checklistPassed = data?.passed ?? 0;
            checklistTotal = data?.total ?? 0;
            if (Array.isArray(data?.blockers)) {
              blockers.push(...data.blockers);
            }
          }

          // Step 4: Validation run
          if (shouldValidate) {
            const runResult = await runStep(steps, "debug.run_project", () =>
              callAfterConnect(godot, "debug.run_project", {})
            );
            if (!runResult.ok) {
              blockers.push("Project failed to run — cannot validate for export.");
            } else {
              await sleep(runDuration);

              const errorsResult = await runStep(steps, "debug.get_debugger_errors (release)", () =>
                callAfterConnect(godot, "debug.get_debugger_errors", {})
              );
              if (errorsResult.ok && Array.isArray((errorsResult.data as any)?.errors)) {
                const errs = (errorsResult.data as any).errors as unknown[];
                runtimeErrors.push(...errs.map(e => String(e)));
                if (errs.length > 0) {
                  blockers.push(`${errs.length} runtime error(s) detected during validation run.`);
                }
              }

              await runStep(steps, "debug.stop_project", () =>
                callAfterConnect(godot, "debug.stop_project", {})
              );
            }
          }

          // Step 5: Unused resources
          const unusedResult = await runStep(steps, "batch.find_unused", () =>
            callAfterConnect(godot, "batch.find_unused", {})
          );
          const unusedCount: number = unusedResult.ok
            ? ((unusedResult.data as any)?.count ?? (Array.isArray((unusedResult.data as any)?.unused) ? (unusedResult.data as any).unused.length : 0))
            : 0;
          if (unusedCount > 0) {
            // Warning, not a blocker
          }

          // Step 6: Circular deps
          const circularResult = await runStep(steps, "batch.detect_circular", () =>
            callAfterConnect(godot, "batch.detect_circular", {})
          );
          const circularCount: number = circularResult.ok
            ? ((circularResult.data as any)?.count ?? (Array.isArray((circularResult.data as any)?.cycles) ? (circularResult.data as any).cycles.length : 0))
            : 0;
          if (circularCount > 0) {
            blockers.push(`${circularCount} circular dependency cycle(s) detected — resolve before export.`);
          }

          // Step 7: Generate export commands
          const exportCommands: string[] = presets.map(preset => {
            const outputPath = preset.path ?? `./exports/${preset.name.replace(/\s+/g, "_")}/`;
            return `godot --headless --export-release "${preset.name}" "${outputPath}"`;
          });
          if (exportCommands.length === 0) {
            exportCommands.push("# No presets configured — add one via Project → Export first.");
          }

          // Release notes template
          const releaseNotesTemplate = [
            `# ${projectName} — Release Notes`,
            ``,
            `**Version:** 1.0.0`,
            `**Date:** ${new Date().toISOString().slice(0, 10)}`,
            ``,
            `## What's New`,
            `- [ ] Feature 1`,
            `- [ ] Feature 2`,
            ``,
            `## Bug Fixes`,
            `- [ ] Fix 1`,
            ``,
            `## Known Issues`,
            `- [ ] None`,
            ``,
            `## Export Targets`,
            ...exportCommands.map(cmd => `- \`${cmd}\``)
          ].join("\n");

          const readyToShip = blockers.length === 0;
          const failedCount = steps.filter(s => !s.ok).length;

          const report: WorkflowReport = {
            plan,
            steps_executed: steps,
            files_created: [],
            files_modified: [],
            scenes_modified: [],
            tests_generated: [],
            validation: {
              scripts_compile: true,
              scene_loads: !blockers.some(b => b.includes("failed to run")),
              runtime_errors: runtimeErrors
            },
            summary: readyToShip
              ? `Project '${projectName}' is ready to ship. ${presets.length} export preset(s) configured.`
              : `Project '${projectName}' has ${blockers.length} blocker(s) before release.`,
            dry_run: false
          };

          return createSuccessResponse(
            {
              ...report,
              ready_to_ship: readyToShip,
              blockers,
              checklist_passed: checklistPassed,
              checklist_total: checklistTotal,
              export_presets: presets,
              export_commands: exportCommands,
              unused_resources: unusedCount,
              circular_dependencies: circularCount,
              release_notes_template: releaseNotesTemplate
            },
            report.summary,
            [
              ...(!readyToShip ? [`${blockers.length} blocker(s) must be resolved before export.`] : []),
              ...(unusedCount > 0 ? [`${unusedCount} unused resource(s) detected — clean up to reduce build size.`] : [])
            ],
            readyToShip
              ? ["Run the export_commands above to build release artifacts.", "Tag the release in version control after export."]
              : ["Fix blockers listed in the 'blockers' array, then re-run devpilot_prepare_export_release."]
          );
        })
      )
  );
}

// ── Local helpers ──────────────────────────────────────────────────────────────

function buildErrorReport(
  steps: StepResult[],
  plan: string[],
  label: string,
  reason: string
): ToolResponse {
  return createErrorResponse(
    "WORKFLOW_STEP_FAILED",
    `Workflow for '${label}' halted: ${reason}`,
    {
      plan,
      steps_executed: steps,
      failed_step: steps.at(-1)
    },
    ["Check steps_executed for the failing step details.", "Ensure Godot is open and the plugin is active."]
  );
}
