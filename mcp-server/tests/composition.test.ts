import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

import { registerCompositionTools, BLUEPRINT_DEPS } from "../src/tools/compositionTools.js";
import { recordScene, recordBlueprintApplied } from "../src/tools/manifestTools.js";
import { makeConfig, makeServer, makeTmpProject, cleanupTmpProjects, exists, readText, parse } from "./_helpers.js";

afterEach(async () => { await cleanupTmpProjects(); });

describe("compositionTools", () => {
  it("compose_main_scene with no blueprints warns + returns empty refs", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCompositionTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_compose_main_scene", { rooms_layout: "single", set_as_main: false });
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(await exists(path.join(root, "scenes/Main.tscn"))).toBe(true);
  });

  it("compose_main_scene composes player + room + HUD when manifest has them", async () => {
    const root = await makeTmpProject();
    await recordScene(root, "res://scenes/PlayerTwinStick.tscn", "player", []);
    await recordScene(root, "res://scenes/Room.tscn", "room", []);
    await recordScene(root, "res://scenes/HUD.tscn", "hud", []);
    const server = makeServer();
    registerCompositionTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_compose_main_scene", { rooms_layout: "single", set_as_main: false });
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.references.length).toBe(3);
    const tscn = await readText(path.join(root, "scenes/Main.tscn"));
    expect(tscn).toContain("[gd_scene");
    expect(tscn).toContain("Player");
    expect(tscn).toContain("Room0");
    expect(tscn).toContain("HUD");
  });

  it("compose grid layout creates 7 rooms", async () => {
    const root = await makeTmpProject();
    await recordScene(root, "res://scenes/Room.tscn", "room", []);
    const server = makeServer();
    registerCompositionTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_compose_main_scene", { rooms_layout: "grid", set_as_main: false });
    expect(parse(r).ok).toBe(true);
    const tscn = await readText(path.join(root, "scenes/Main.tscn"));
    for (let i = 0; i < 7; i++) expect(tscn).toContain(`Room${i}`);
  });

  it("compose_main_scene set_as_main updates project.godot", async () => {
    const root = await makeTmpProject();
    await recordScene(root, "res://scenes/Room.tscn", "room", []);
    const server = makeServer();
    registerCompositionTools(server as never, makeConfig(root));
    await server.run("devpilot_compose_main_scene", { rooms_layout: "single", set_as_main: true });
    const proj = await readText(path.join(root, "project.godot"));
    expect(proj).toContain('run/main_scene="res://scenes/Main.tscn"');
  });

  it("apply_refinement returns diff vs current manifest", async () => {
    const root = await makeTmpProject();
    await recordBlueprintApplied(root, "twin_stick");
    await recordBlueprintApplied(root, "save_schema");
    const server = makeServer();
    registerCompositionTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_apply_refinement", { target_blueprints: ["twin_stick", "boss_arena"] });
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.diff.add_blueprints).toContain("boss_arena");
    expect(out.data.diff.remove_blueprints).toContain("save_schema");
  });

  it("check_blueprint_dependencies flags missing requires", async () => {
    const root = await makeTmpProject();
    await recordBlueprintApplied(root, "boss_arena"); // requires enemy_bullet
    const server = makeServer();
    registerCompositionTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_check_blueprint_dependencies");
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.ok).toBe(false);
    expect(out.data.issues[0].blueprint).toBe("boss_arena");
    expect(out.data.issues[0].missing).toContain("enemy_bullet");
  });

  it("check_blueprint_dependencies passes when projectile_system covers boss requires", async () => {
    const root = await makeTmpProject();
    await recordBlueprintApplied(root, "projectile_system");
    await recordBlueprintApplied(root, "boss_arena");
    const server = makeServer();
    registerCompositionTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_check_blueprint_dependencies");
    expect(parse(r).data.ok).toBe(true);
  });

  it("BLUEPRINT_DEPS registry includes core entries", () => {
    const names = BLUEPRINT_DEPS.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(["twin_stick", "projectile_system", "boss_arena", "dungeon_room", "behavior_tree"]));
  });
});
