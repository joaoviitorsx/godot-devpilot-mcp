import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

import { registerPresetTools } from "../src/tools/presetTools.js";
import { makeConfig, makeServer, makeTmpProject, cleanupTmpProjects, exists, readText, parse } from "./_helpers.js";

afterEach(async () => { await cleanupTmpProjects(); });

describe("presetTools", () => {
  it("list_presets returns all categories", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerPresetTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_list_presets");
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.input_map).toEqual(expect.arrayContaining(["twin_stick", "platformer", "topdown", "fps_3d"]));
    expect(out.data.physics_layers).toEqual(expect.arrayContaining(["shooter", "platformer", "topdown_rpg", "shooter_3d", "fps_3d"]));
    expect(out.data.hud).toEqual(expect.arrayContaining(["shooter", "rpg", "survivor", "fps_3d"]));
  });

  it("apply input_map twin_stick writes [input] section", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerPresetTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_apply_preset", { category: "input_map", name: "twin_stick" });
    expect(parse(r).ok).toBe(true);
    const proj = await readText(path.join(root, "project.godot"));
    expect(proj).toContain("[input]");
    expect(proj).toContain("move_up=");
    expect(proj).toContain("shoot_mouse=");
  });

  it("apply physics_layers shooter writes [layer_names]", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerPresetTools(server as never, makeConfig(root));
    await server.run("devpilot_apply_preset", { category: "physics_layers", name: "shooter" });
    const proj = await readText(path.join(root, "project.godot"));
    expect(proj).toContain("[layer_names]");
    expect(proj).toContain('2d_physics/layer_2="Player"');
    expect(proj).toContain('2d_physics/layer_3="Enemies"');
  });

  it("apply hud shooter writes HUD.gd + HUD.tscn", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerPresetTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_apply_preset", { category: "hud", name: "shooter" });
    expect(parse(r).ok).toBe(true);
    expect(await exists(path.join(root, "scripts/HUD.gd"))).toBe(true);
    expect(await exists(path.join(root, "scenes/HUD.tscn"))).toBe(true);
  });

  it("unknown preset returns error", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerPresetTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_apply_preset", { category: "input_map", name: "nonexistent" });
    expect(parse(r).ok).toBe(false);
  });
});
