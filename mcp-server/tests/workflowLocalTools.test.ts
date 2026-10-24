import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cleanupTmpProjects, makeConfig, makeFakeGodot, makeTmpProject, readText, mkdir, writeFile } from "./_helpers.js";
import { registerScriptTools } from "../src/tools/scriptTools.js";
import { registerDebugTools } from "../src/tools/debugTools.js";
import { registerIntelligenceTools } from "../src/tools/intelligenceTools.js";
import { registerWorkflowTools } from "../src/tools/workflowTools.js";
import { registerAutoFixTools } from "../src/tools/autoFixTools.js";
import { generatePromptPlan } from "../src/workflows/prompt/promptPlanner.js";
import { executePromptWorkflow } from "../src/workflows/prompt/promptExecutor.js";

afterEach(async () => cleanupTmpProjects());

async function setup() {
  const root = await makeTmpProject();
  const godot = makeFakeGodot();
  const config = makeConfig(root);
  const server = new McpServer({ name: "workflow-test", version: "1.0.0" });
  registerScriptTools(server, godot, config);
  registerDebugTools(server, godot, config);
  registerIntelligenceTools(server, config);
  registerAutoFixTools(server, godot, config);
  registerWorkflowTools(server, godot, config);
  const registry = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }> }> })._registeredTools;
  return { root, godot, registry };
}

describe("workflow composition", () => {
  it("creates a script through the registered server tool", async () => {
    const { root, godot, registry } = await setup();
    const result = JSON.parse((await registry.devpilot_build_feature.handler({ feature_name: "Inventory", kind: "script_only", generate_test: false, dry_run: false })).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.data.steps_executed.every((step: { ok: boolean }) => step.ok)).toBe(true);
    expect(await readText(path.join(root, "scripts", "Inventory.gd"))).toContain("extends Node");
    expect(godot.__callLog.some(({ method }) => method === "script.create" || method === "debug.get_debugger_errors")).toBe(false);
  });

  it("uses the Godot scene parameter names and persists a nonempty test scenario", async () => {
    const { godot, registry } = await setup();
    const result = JSON.parse((await registry.devpilot_build_feature.handler({ feature_name: "Arena", kind: "scene_with_script", generate_test: true, dry_run: false })).content[0].text);
    expect(result.ok).toBe(true);
    const create = godot.__callLog.find(({ method }) => method === "scene.create");
    const open = godot.__callLog.find(({ method }) => method === "scene.open");
    const validate = godot.__callLog.find(({ method }) => method === "scene.validate");
    const scenario = godot.__callLog.find(({ method }) => method === "test.create_scenario");
    expect(create?.params).toMatchObject({ path: "res://scenes/Arena.tscn" });
    expect(open?.params).toMatchObject({ path: "res://scenes/Arena.tscn" });
    expect(validate?.params).toMatchObject({ path: "res://scenes/Arena.tscn" });
    expect(scenario?.params).toMatchObject({ steps: [{ type: "assert_node_exists" }] });
  });

  it("previews fixes through the registered debug tool", async () => {
    const { registry } = await setup();
    const result = JSON.parse((await registry.devpilot_fix_bug.handler({ dry_run: true })).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.data.steps_executed.every((step: { ok: boolean }) => step.ok)).toBe(true);
  });

  it("computes scene impact and release checks locally", async () => {
    const { registry, godot } = await setup();
    const refactor = JSON.parse((await registry.devpilot_refactor_scene_safely.handler({ scene_path: "res://Main.tscn", changes: [{ type: "rename_node", node_path: "Player", value: "Hero" }], dry_run: true })).content[0].text);
    expect(refactor.ok).toBe(true);
    expect(refactor.data.steps_executed.every((step: { ok: boolean }) => step.ok)).toBe(true);
    const release = JSON.parse((await registry.devpilot_prepare_export_release.handler({ run_validation: false })).content[0].text);
    expect(release.ok).toBe(true);
    expect(release.data.checklist_total).toBe(3);
    expect(godot.__callLog.some(({ method }) => method === "intelligence.impact_check" || method === "release.checklist")).toBe(false);
  });

  it("gets static parse errors locally and rejects out-of-project lint paths", async () => {
    const { root, godot, registry } = await setup();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Broken.gd"), "extends Node\nfunc broken()\n    pass\n");
    const result = JSON.parse((await registry.devpilot_auto_fix_parse_errors.handler({ max_iterations: 1, additional_paths: ["res://../outside.gd"] })).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(godot.__callLog.some(({ method }) => method === "static.get_script_parse_errors")).toBe(false);
  });

  it("reads prompt validation errors from local run reports", async () => {
    const root = await makeTmpProject();
    const godot = makeFakeGodot();
    const result = await executePromptWorkflow("Validate project", generatePromptPlan("Validate project", "VALIDATE"), {
      dry_run: false, validate_after: false, generate_report: false, explain_steps: false
    }, godot, makeConfig(root));
    expect(result.success).toBe(true);
    expect(result.executed_steps.some((step) => step.tools_called.includes("server:run_reports:error"))).toBe(true);
    expect(godot.__callLog.some(({ method }) => method.startsWith("debug.get_"))).toBe(false);
  });
});
