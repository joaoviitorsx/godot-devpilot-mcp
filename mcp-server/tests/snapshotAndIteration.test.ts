import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { registerSnapshotMaintenanceTools } from "../src/tools/snapshotMaintenanceTools.js";
import { registerSnapshotTools, registerExplainProjectTool, registerRecommendBlueprintsTool, registerAutoWireSignalsTool } from "../src/tools/iterationTools.js";
import { recordBlueprintApplied, recordScript } from "../src/tools/manifestTools.js";
import { makeConfig, makeServer, makeTmpProject, cleanupTmpProjects, exists, parse } from "./_helpers.js";

afterEach(async () => { await cleanupTmpProjects(); });

describe("snapshot tools", () => {
  it("snapshot_project copies scenes/scripts", async () => {
    const root = await makeTmpProject();
    await mkdir(path.join(root, "scenes"), { recursive: true });
    await writeFile(path.join(root, "scenes/Test.tscn"), "[gd_scene format=3]", "utf8");
    const server = makeServer();
    registerSnapshotTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_snapshot_project", { label: "test_snap" });
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.id).toContain("test_snap");
    expect(await exists(path.join(out.data.dest_path, "scenes/Test.tscn"))).toBe(true);
  });

  it("list_snapshots returns created snapshot", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerSnapshotTools(server as never, makeConfig(root));
    await server.run("devpilot_snapshot_project", { label: "alpha" });
    await server.run("devpilot_snapshot_project", { label: "beta" });
    const r = await server.run("devpilot_list_snapshots");
    expect(parse(r).data.count).toBeGreaterThanOrEqual(2);
  });

  it("rollback requires confirm=true", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerSnapshotTools(server as never, makeConfig(root));
    await server.run("devpilot_snapshot_project", { label: "x" });
    const r = await server.run("devpilot_rollback_to_snapshot", { id: "x", confirm: false });
    expect(parse(r).ok).toBe(false);
    expect(parse(r).error.code).toBe("CONFIRM_REQUIRED");
  });
});

describe("snapshot maintenance", () => {
  it("prune_snapshots keeps most recent N", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerSnapshotTools(server as never, makeConfig(root));
    registerSnapshotMaintenanceTools(server as never, makeConfig(root));
    for (const label of ["a", "b", "c", "d", "e"]) {
      await server.run("devpilot_snapshot_project", { label });
      await new Promise((res) => setTimeout(res, 5));
    }
    const r = await server.run("devpilot_prune_snapshots", { keep_last: 2, confirm: true });
    expect(parse(r).data.kept.length).toBe(2);
    expect(parse(r).data.pruned_count).toBe(3);
  });

  it("diff_snapshot returns added/removed/modified", async () => {
    const root = await makeTmpProject();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts/A.gd"), "extends Node\n", "utf8");
    const server = makeServer();
    registerSnapshotTools(server as never, makeConfig(root));
    registerSnapshotMaintenanceTools(server as never, makeConfig(root));
    await server.run("devpilot_snapshot_project", { label: "before" });
    await writeFile(path.join(root, "scripts/B.gd"), "extends Node\n", "utf8");
    await writeFile(path.join(root, "scripts/A.gd"), "extends Node\n# changed\n", "utf8");
    const r = await server.run("devpilot_diff_snapshot", { id: "before" });
    const diff = parse(r).data.diff.scripts;
    expect(diff.added).toContain("B.gd");
    expect(diff.modified).toContain("A.gd");
  });

  it("diff_snapshot returns error for missing id", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerSnapshotMaintenanceTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_diff_snapshot", { id: "nonexistent" });
    expect(parse(r).ok).toBe(false);
  });
});

describe("explain_project + recommend_blueprints + auto_wire_signals", () => {
  it("explain_project generates markdown", async () => {
    const root = await makeTmpProject();
    await recordBlueprintApplied(root, "twin_stick");
    await recordScript(root, "res://scripts/Player.gd", { signals: ["died"] });
    const server = makeServer();
    registerExplainProjectTool(server as never, makeConfig(root));
    const r = await server.run("devpilot_explain_project");
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.markdown).toContain("# Project");
    expect(out.data.markdown).toContain("twin_stick");
    expect(out.data.markdown).toContain("died");
  });

  it("recommend_blueprints maps prompt → blueprints + presets", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerRecommendBlueprintsTool(server as never, makeConfig(root));
    const r = await server.run("devpilot_recommend_blueprints", { prompt: "FPS 3D first-person shooter" });
    const out = parse(r).data;
    expect(out.blueprints).toContain("player_3d");
    expect(out.presets.some((p: [string, string]) => p[0] === "input_map" && p[1] === "fps_3d")).toBe(true);
  });

  it("recommend_blueprints handles RPG prompt", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerRecommendBlueprintsTool(server as never, makeConfig(root));
    const r = await server.run("devpilot_recommend_blueprints", { prompt: "RPG com quest e dialogue e inventory" });
    const out = parse(r).data;
    expect(out.blueprints).toEqual(expect.arrayContaining(["dialogue_system", "quest_system", "inventory_grid"]));
  });

  it("auto_wire_signals returns gdscript snippet", async () => {
    const root = await makeTmpProject();
    await recordScript(root, "res://scripts/Player.gd", { signals: ["died", "damaged"] });
    const server = makeServer();
    registerAutoWireSignalsTool(server as never, makeConfig(root));
    const r = await server.run("devpilot_auto_wire_signals");
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.gdscript_snippet).toContain("func _ready()");
    expect(out.data.signals_count).toBe(2);
  });
});
