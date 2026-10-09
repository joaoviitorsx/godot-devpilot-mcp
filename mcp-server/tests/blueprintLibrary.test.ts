import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

import { registerBlueprintLibraryTools, BLUEPRINT_REGISTRY } from "../src/tools/blueprintLibraryTools.js";
import { registerBlueprintLibrary3DTools, BLUEPRINT_3D_REGISTRY } from "../src/tools/blueprintLibrary3DTools.js";
import { registerBlueprintLibraryRPGTools, BLUEPRINT_RPG_REGISTRY } from "../src/tools/blueprintLibraryRPGTools.js";
import { registerBlueprintLibraryAVTools, BLUEPRINT_AV_REGISTRY } from "../src/tools/blueprintLibraryAVTools.js";
import { registerBlueprintLibraryGenresTools, BLUEPRINT_GENRES_REGISTRY } from "../src/tools/blueprintLibraryGenresTools.js";
import { registerBlueprintLibraryGenresExtraTools, BLUEPRINT_GENRES_EXTRA_REGISTRY } from "../src/tools/blueprintLibraryGenresExtraTools.js";
import { registerBlueprintLibraryAdvancedTools, BLUEPRINT_ADVANCED_REGISTRY } from "../src/tools/blueprintLibraryAdvancedTools.js";
import { readManifest } from "../src/tools/manifestTools.js";
import { makeConfig, makeServer, makeTmpProject, cleanupTmpProjects, exists, readText, parse } from "./_helpers.js";

afterEach(async () => { await cleanupTmpProjects(); });

async function applyAndCheck(server: ReturnType<typeof makeServer>, root: string, toolName: string, args: Record<string, unknown> = {}) {
  const r = await server.run(toolName, args);
  const out = parse(r);
  expect(out.ok, `${toolName}: ${JSON.stringify(out.error ?? out.message)}`).toBe(true);
  const m = await readManifest(root);
  return { out, manifest: m };
}

describe("blueprintLibraryTools (2D core)", () => {
  it("registers all expected tools", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryTools(server as never, makeConfig(root));
    for (const b of BLUEPRINT_REGISTRY) {
      expect(server.has(`devpilot_blueprint_${b.name}`), `missing ${b.name}`).toBe(true);
    }
  });

  it("twin_stick writes scripts + scene + records manifest", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryTools(server as never, makeConfig(root));
    const { manifest } = await applyAndCheck(server, root, "devpilot_blueprint_twin_stick");
    expect(await exists(path.join(root, "scripts/PlayerTwinStick.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/PlayerWeapon.gd"))).toBe(true);
    expect(await exists(path.join(root, "scenes/PlayerTwinStick.tscn"))).toBe(true);
    expect(manifest.blueprints_applied.find((b) => b.name === "twin_stick")).toBeDefined();
    const tscn = await readText(path.join(root, "scenes/PlayerTwinStick.tscn"));
    expect(tscn).toContain("[gd_scene");
    expect(tscn).toContain("CharacterBody2D");
  });

  it("projectile_system applies all 3 scripts", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryTools(server as never, makeConfig(root));
    await applyAndCheck(server, root, "devpilot_blueprint_projectile_system");
    expect(await exists(path.join(root, "scripts/Bullet.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/PlayerBullet.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/EnemyBullet.gd"))).toBe(true);
  });

  it("dungeon_room writes door + room scenes", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryTools(server as never, makeConfig(root));
    await applyAndCheck(server, root, "devpilot_blueprint_dungeon_room");
    expect(await exists(path.join(root, "scripts/RoomManager.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/DungeonManager.gd"))).toBe(true);
    expect(await exists(path.join(root, "scenes/Room.tscn"))).toBe(true);
    expect(await exists(path.join(root, "scenes/Door.tscn"))).toBe(true);
  });

  it("read-only mode blocks blueprint", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryTools(server as never, makeConfig(root, true));
    const r = await server.run("devpilot_blueprint_pickup");
    expect(parse(r).ok).toBe(false);
    expect(parse(r).error.code).toMatch(/READ_ONLY/);
  });

  it("overwrite=false skips existing files", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryTools(server as never, makeConfig(root));
    await applyAndCheck(server, root, "devpilot_blueprint_pickup");
    const r = await applyAndCheck(server, root, "devpilot_blueprint_pickup");
    const skipped = r.out.data.files.find((f: { written: boolean; reason?: string }) => f.written === false);
    expect(skipped).toBeDefined();
    expect(skipped.reason).toBe("exists");
  });
});

describe("blueprintLibrary3DTools", () => {
  it("registers + applies player_3d FPS mode", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibrary3DTools(server as never, makeConfig(root));
    for (const b of BLUEPRINT_3D_REGISTRY) {
      expect(server.has(`devpilot_blueprint_${b.name}`), `missing ${b.name}`).toBe(true);
    }
    const r = await server.run("devpilot_blueprint_player_3d", { mode: "fps" });
    expect(parse(r).ok).toBe(true);
    expect(await exists(path.join(root, "scripts/Player3DFPS.gd"))).toBe(true);
  });

  it("dungeon_room_3d writes scene only (no script)", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibrary3DTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_dungeon_room_3d");
    expect(await exists(path.join(root, "scenes/Room3D.tscn"))).toBe(true);
    const tscn = await readText(path.join(root, "scenes/Room3D.tscn"));
    expect(tscn).toContain("DirectionalLight3D");
    expect(tscn).toContain("StaticBody3D");
  });
});

describe("blueprintLibraryRPGTools", () => {
  it("registers all RPG blueprints", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryRPGTools(server as never, makeConfig(root));
    for (const b of BLUEPRINT_RPG_REGISTRY) {
      expect(server.has(`devpilot_blueprint_${b.name}`)).toBe(true);
    }
  });

  it("dialogue_system writes 4 scripts + scene", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryRPGTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_dialogue_system");
    for (const f of ["DialogueLine.gd", "DialogueGraph.gd", "DialogueManager.gd", "DialogueBox.gd"]) {
      expect(await exists(path.join(root, "scripts", f))).toBe(true);
    }
    expect(await exists(path.join(root, "scenes/DialogueBox.tscn"))).toBe(true);
  });

  it("inventory_grid + loot_table coexist", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryRPGTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_inventory_grid");
    await server.run("devpilot_blueprint_loot_table");
    const m = await readManifest(root);
    expect(m.blueprints_applied.map((b) => b.name)).toEqual(expect.arrayContaining(["inventory_grid", "loot_table"]));
  });
});

describe("blueprintLibraryAVTools", () => {
  it("audio_bus writes .tres + autoload script", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryAVTools(server as never, makeConfig(root));
    for (const b of BLUEPRINT_AV_REGISTRY) {
      expect(server.has(`devpilot_blueprint_${b.name}`)).toBe(true);
    }
    await server.run("devpilot_blueprint_audio_bus");
    expect(await exists(path.join(root, "default_bus_layout.tres"))).toBe(true);
    expect(await exists(path.join(root, "scripts/AudioManager.gd"))).toBe(true);
    const tres = await readText(path.join(root, "default_bus_layout.tres"));
    expect(tres).toContain('bus/0/name = &"Master"');
    expect(tres).toContain('bus/1/name = &"Music"');
    expect(tres).toContain('bus/2/name = &"SFX"');
  });

  it("animation_state_machine writes single script", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryAVTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_animation_state_machine");
    expect(await exists(path.join(root, "scripts/AnimationStateController.gd"))).toBe(true);
  });
});

describe("blueprintLibraryGenresTools (rts + physics)", () => {
  it("rts_unit writes scripts + scene", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryGenresTools(server as never, makeConfig(root));
    for (const b of BLUEPRINT_GENRES_REGISTRY) {
      expect(server.has(`devpilot_blueprint_${b.name}`)).toBe(true);
    }
    await server.run("devpilot_blueprint_rts_unit");
    expect(await exists(path.join(root, "scripts/RtsUnit.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/RtsController.gd"))).toBe(true);
    expect(await exists(path.join(root, "scenes/RtsUnit.tscn"))).toBe(true);
  });

  it("physics_puzzle writes draggable scene", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryGenresTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_physics_puzzle");
    expect(await exists(path.join(root, "scenes/DraggableBody.tscn"))).toBe(true);
  });
});

describe("blueprintLibraryGenresExtraTools (9 genres)", () => {
  it("registers all 9 genre blueprints", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryGenresExtraTools(server as never, makeConfig(root));
    for (const b of BLUEPRINT_GENRES_EXTRA_REGISTRY) {
      expect(server.has(`devpilot_blueprint_${b.name}`), `missing ${b.name}`).toBe(true);
    }
  });

  it("card_game writes Card/Deck/Hand", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryGenresExtraTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_card_game");
    for (const f of ["Card.gd", "Deck.gd", "Hand.gd"]) {
      expect(await exists(path.join(root, "scripts", f))).toBe(true);
    }
  });

  it("stealth + crafting + skill_tree apply independently", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryGenresExtraTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_stealth");
    await server.run("devpilot_blueprint_crafting");
    await server.run("devpilot_blueprint_skill_tree");
    const m = await readManifest(root);
    const names = m.blueprints_applied.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(["stealth", "crafting", "skill_tree"]));
  });

  it("match_3_v2 writes single script", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryGenresExtraTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_match_3_v2");
    expect(await exists(path.join(root, "scripts/Match3Grid.gd"))).toBe(true);
  });
});

describe("blueprintLibraryAdvancedTools (BT/VFX/transitions/etc)", () => {
  it("registers all advanced blueprints", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryAdvancedTools(server as never, makeConfig(root));
    for (const b of BLUEPRINT_ADVANCED_REGISTRY) {
      expect(server.has(`devpilot_blueprint_${b.name}`), `missing ${b.name}`).toBe(true);
    }
  });

  it("behavior_tree writes 5 BT scripts", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryAdvancedTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_behavior_tree");
    for (const f of ["BTNode.gd", "BTSequence.gd", "BTSelector.gd", "BTMoveTo.gd", "BTRunner.gd"]) {
      expect(await exists(path.join(root, "scripts", f))).toBe(true);
    }
  });

  it("vfx_library writes 5 .tscn presets + script", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryAdvancedTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_vfx_library");
    expect(await exists(path.join(root, "scripts/VFXBurst.gd"))).toBe(true);
    for (const name of ["explosion", "fire", "blood", "sparkle", "dust"]) {
      expect(await exists(path.join(root, `scenes/vfx/VFX_${name}.tscn`)), `missing VFX_${name}.tscn`).toBe(true);
    }
  });

  it("shader_library writes 5 .gdshader files", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryAdvancedTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_shader_library");
    for (const name of ["outline", "hit_flash", "pixelate", "dissolve", "water"]) {
      expect(await exists(path.join(root, "shaders", `${name}.gdshader`))).toBe(true);
    }
  });

  it("scene_transitions + settings_manager + navigation each one script", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerBlueprintLibraryAdvancedTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_scene_transitions");
    await server.run("devpilot_blueprint_settings_manager");
    await server.run("devpilot_blueprint_navigation");
    expect(await exists(path.join(root, "scripts/SceneTransitions.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/SettingsManager.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/NavAgentController.gd"))).toBe(true);
  });
});
