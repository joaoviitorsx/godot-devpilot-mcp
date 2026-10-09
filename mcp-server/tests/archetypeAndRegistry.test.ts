import { afterEach, describe, expect, it } from "vitest";

import { registerArchetypeTools } from "../src/tools/archetypeTools.js";
import { registerBlueprintRegistryTools } from "../src/tools/blueprintRegistryTools.js";
import { recordBlueprintApplied } from "../src/tools/manifestTools.js";
import { makeConfig, makeServer, makeTmpProject, cleanupTmpProjects, parse } from "./_helpers.js";

afterEach(async () => { await cleanupTmpProjects(); });

describe("archetypeTools", () => {
  it("list_archetypes includes all canonical archetypes", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerArchetypeTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_list_archetypes");
    const names = parse(r).data.archetypes.map((a: { name: string }) => a.name);
    expect(names).toEqual(expect.arrayContaining(["shooter_2d", "dungeon_crawler", "rpg_topdown", "platformer", "fps_3d", "rts_2d", "physics_puzzle"]));
  });

  it("create_project_archetype returns playbook for fps_3d", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerArchetypeTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_create_project_archetype", { name: "fps_3d" });
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.call_plan.length).toBeGreaterThan(5);
    const tools = out.data.call_plan.map((s: { tool: string }) => s.tool);
    expect(tools).toContain("devpilot_blueprint_player_3d");
    expect(tools).toContain("devpilot_blueprint_enemy_3d");
    expect(tools).toContain("devpilot_blueprint_dungeon_room_3d");
  });

  it("create_project_archetype unknown name returns error", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerArchetypeTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_create_project_archetype", { name: "nonexistent" });
    expect(parse(r).ok).toBe(false);
  });

  it("signal_graph returns markdown + graph from manifest", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerArchetypeTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_signal_graph");
    expect(parse(r).ok).toBe(true);
    expect(typeof parse(r).data.markdown).toBe("string");
  });

  it("validate_blueprint_compat warns when blueprint already applied", async () => {
    const root = await makeTmpProject();
    await recordBlueprintApplied(root, "twin_stick");
    const server = makeServer();
    registerArchetypeTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_validate_blueprint_compat", { blueprint: "twin_stick" });
    const out = parse(r);
    expect(out.data.ok).toBe(false);
    expect(out.data.conflicts.length).toBeGreaterThan(0);
  });

  it("validate_blueprint_compat OK for fresh blueprint", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerArchetypeTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_validate_blueprint_compat", { blueprint: "boss_arena" });
    expect(parse(r).data.ok).toBe(true);
  });
});

describe("blueprintRegistryTools", () => {
  it("list_blueprints returns merged 2D+3D registry", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintRegistryTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_list_blueprints");
    const out = parse(r);
    expect(out.ok).toBe(true);
    const names = out.data.blueprints.map((b: { name: string }) => b.name);
    expect(names).toEqual(expect.arrayContaining(["twin_stick", "player_3d", "boss_arena"]));
    expect(out.data.categories.length).toBeGreaterThan(2);
  });

  it("list_blueprints filtered by category", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintRegistryTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_list_blueprints", { category: "combat" });
    const names = parse(r).data.blueprints.map((b: { name: string }) => b.name);
    expect(names).toEqual(expect.arrayContaining(["projectile_system", "boss_arena"]));
  });

  it("describe_blueprint returns details for known + error for unknown", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintRegistryTools(server as never, makeConfig(root));
    const known = parse(await server.run("devpilot_describe_blueprint", { name: "twin_stick" }));
    expect(known.ok).toBe(true);
    expect(known.data.name).toBe("twin_stick");
    const unknown = parse(await server.run("devpilot_describe_blueprint", { name: "nonexistent" }));
    expect(unknown.ok).toBe(false);
  });
});
