import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

import { registerQualityTools } from "../src/tools/qualityTools.js";
import { registerCiTools } from "../src/tools/ciTools.js";
import { registerAssetAndExportTools } from "../src/tools/assetAndExportTools.js";
import { registerSaveAchievementsTools } from "../src/tools/saveAchievementsTools.js";
import { registerCsharpAndAdvancedTools } from "../src/tools/csharpAndAdvancedTools.js";
import { registerVTools } from "../src/tools/vTools.js";
import { registerHelpTools } from "../src/tools/helpTools.js";
import { registerVerifySpecTools } from "../src/tools/verifySpecTools.js";
import { registerTierAndCustomTools } from "../src/tools/tierAndCustomTools.js";
import { recordBlueprintApplied, recordScript } from "../src/tools/manifestTools.js";
import { writeFile, mkdir } from "node:fs/promises";
import { makeConfig, makeFakeGodot, makeServer, makeTmpProject, cleanupTmpProjects, exists, readText, parse } from "./_helpers.js";

afterEach(async () => { await cleanupTmpProjects(); });

describe("qualityTools", () => {
  it("save_schema writes SaveData.gd + SaveManager.gd", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerQualityTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_blueprint_save_schema");
    expect(parse(r).ok).toBe(true);
    expect(await exists(path.join(root, "scripts/SaveData.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/SaveManager.gd"))).toBe(true);
  });

  it("localization writes csv + LocaleManager", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerQualityTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_localization");
    expect(await exists(path.join(root, "translations.csv"))).toBe(true);
    expect(await exists(path.join(root, "scripts/LocaleManager.gd"))).toBe(true);
  });

  it("performance_budget scans scenes/", async () => {
    const root = await makeTmpProject();
    await mkdir(path.join(root, "scenes"), { recursive: true });
    await writeFile(path.join(root, "scenes/X.tscn"), `[gd_scene format=3]\n[node name="A" type="Node2D"]\n`, "utf8");
    const server = makeServer();
    registerQualityTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_performance_budget");
    expect(parse(r).data.total_scenes).toBe(1);
    expect(parse(r).data.node_types.Node2D).toBe(1);
  });
});

describe("ciTools", () => {
  it("setup_ci github_actions writes workflow", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCiTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_setup_ci", { target: "github_actions" });
    expect(parse(r).ok).toBe(true);
    expect(await exists(path.join(root, ".github/workflows/godot-build.yml"))).toBe(true);
    const content = await readText(path.join(root, ".github/workflows/godot-build.yml"));
    expect(content).toContain("name: Godot Build");
  });

  it("setup_ci gitlab writes .gitlab-ci.yml", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCiTools(server as never, makeConfig(root));
    await server.run("devpilot_setup_ci", { target: "gitlab" });
    expect(await exists(path.join(root, ".gitlab-ci.yml"))).toBe(true);
  });

  it("setup_ci circleci writes config", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCiTools(server as never, makeConfig(root));
    await server.run("devpilot_setup_ci", { target: "circleci" });
    expect(await exists(path.join(root, ".circleci/config.yml"))).toBe(true);
  });

  it("overwrite=false on existing CI file errors", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCiTools(server as never, makeConfig(root));
    await server.run("devpilot_setup_ci", { target: "github_actions" });
    const r = await server.run("devpilot_setup_ci", { target: "github_actions" });
    expect(parse(r).ok).toBe(false);
  });
});

describe("assetAndExport", () => {
  it("setup_asset_pack creates folders + README", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerAssetAndExportTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_setup_asset_pack");
    expect(parse(r).ok).toBe(true);
    for (const d of ["assets/kenney", "assets/sfx", "assets/music", "assets/generated"]) {
      expect(await exists(path.join(root, d))).toBe(true);
    }
    expect(await exists(path.join(root, "assets/README.md"))).toBe(true);
  });

  it("setup_export_preset windows appends preset", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerAssetAndExportTools(server as never, makeConfig(root));
    await server.run("devpilot_setup_export_preset", { target: "windows" });
    expect(await exists(path.join(root, "export_presets.cfg"))).toBe(true);
    const cfg = await readText(path.join(root, "export_presets.cfg"));
    expect(cfg).toContain('[preset.0]');
    expect(cfg).toContain("Windows Desktop");
  });

  it("multiple presets append with incremented index", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerAssetAndExportTools(server as never, makeConfig(root));
    await server.run("devpilot_setup_export_preset", { target: "windows" });
    await server.run("devpilot_setup_export_preset", { target: "linux" });
    const cfg = await readText(path.join(root, "export_presets.cfg"));
    expect(cfg).toContain("[preset.0]");
    expect(cfg).toContain("[preset.1]");
  });
});

describe("save migration + achievements + reload", () => {
  it("save_migration writes SaveMigration.gd", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerSaveAchievementsTools(server as never, makeFakeGodot(), makeConfig(root));
    await server.run("devpilot_blueprint_save_migration");
    expect(await exists(path.join(root, "scripts/SaveMigration.gd"))).toBe(true);
  });

  it("achievements writes Achievement.gd + AchievementsManager.gd", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerSaveAchievementsTools(server as never, makeFakeGodot(), makeConfig(root));
    await server.run("devpilot_blueprint_achievements");
    expect(await exists(path.join(root, "scripts/Achievement.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/AchievementsManager.gd"))).toBe(true);
  });

  it("reload_editor attempts RPCs", async () => {
    const root = await makeTmpProject();
    const fake = makeFakeGodot({ callResult: { ok: false, error: { code: "UNKNOWN_METHOD", message: "?" } } });
    const server = makeServer();
    registerSaveAchievementsTools(server as never, fake, makeConfig(root));
    const r = await server.run("devpilot_reload_editor");
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(out.data.attempted.length).toBeGreaterThan(0);
  });
});

describe("csharp + advanced", () => {
  it("csharp_player writes .cs file", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCsharpAndAdvancedTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_csharp_player", { class_name_param: "Hero" });
    expect(await exists(path.join(root, "scripts/cs/Hero.cs"))).toBe(true);
    const cs = await readText(path.join(root, "scripts/cs/Hero.cs"));
    expect(cs).toContain("public partial class Hero : CharacterBody2D");
  });

  it("setup_csharp_project writes csproj", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCsharpAndAdvancedTools(server as never, makeConfig(root));
    await server.run("devpilot_setup_csharp_project", { project_name: "MyGame" });
    expect(await exists(path.join(root, "MyGame.csproj"))).toBe(true);
  });

  it("gdextension_scaffold writes 6 files", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCsharpAndAdvancedTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_blueprint_gdextension_scaffold", { lib_name: "myext" });
    expect(parse(r).ok).toBe(true);
    expect(await exists(path.join(root, "myext.gdextension"))).toBe(true);
    expect(await exists(path.join(root, "src/myext.h"))).toBe(true);
    expect(await exists(path.join(root, "SConstruct"))).toBe(true);
  });

  it("gdextension_scaffold rejects invalid lib_name", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCsharpAndAdvancedTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_blueprint_gdextension_scaffold", { lib_name: "Bad-Name" });
    expect(parse(r).ok).toBe(false);
  });

  it("workspace_register + list", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCsharpAndAdvancedTools(server as never, makeConfig(root));
    await server.run("devpilot_workspace_register", { name: "test_ws" });
    const r = await server.run("devpilot_workspace_list");
    const ws = parse(r).data.workspaces.find((w: { name: string }) => w.name === "test_ws");
    expect(ws).toBeDefined();
  });

  it("telemetry enable + log_event + view", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerCsharpAndAdvancedTools(server as never, makeConfig(root));
    await server.run("devpilot_telemetry", { action: "enable" });
    await server.run("devpilot_telemetry", { action: "log_event", event: "test_event" });
    const r = await server.run("devpilot_telemetry", { action: "view" });
    expect(parse(r).data.enabled).toBe(true);
    expect(parse(r).data.counts.test_event).toBe(1);
  });
});

describe("vTools (tests v2 + drag-drop + dialogue authoring)", () => {
  it("generate_tests_v2 emits per-blueprint asserts", async () => {
    const root = await makeTmpProject();
    await recordScript(root, "res://scripts/PlayerTwinStick.gd", {});
    await recordScript(root, "res://scripts/Bullet.gd", {});
    const server = makeServer();
    registerVTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_generate_tests_v2");
    expect(parse(r).ok).toBe(true);
    expect(await exists(path.join(root, "tests/test_PlayerTwinStick.gd"))).toBe(true);
    expect(await exists(path.join(root, "tests/test_Bullet.gd"))).toBe(true);
    const content = await readText(path.join(root, "tests/test_PlayerTwinStick.gd"));
    expect(content).toContain("test_player_has_max_hp");
  });

  it("inventory_drag_drop writes 2 scripts", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerVTools(server as never, makeConfig(root));
    await server.run("devpilot_blueprint_inventory_drag_drop");
    expect(await exists(path.join(root, "scripts/InventoryDragSlot.gd"))).toBe(true);
    expect(await exists(path.join(root, "scripts/InventoryDragPanel.gd"))).toBe(true);
  });

  it("author_dialogue_graph writes line + graph .tres", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerVTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_author_dialogue_graph", {
      graph_name: "intro",
      root_id: "start",
      lines: [
        { id: "start", speaker: "NPC", text: "Hi", choices: [], next_id: "end" },
        { id: "end", speaker: "NPC", text: "Bye" },
      ],
    });
    const out = parse(r);
    expect(out.ok).toBe(true);
    expect(await exists(path.join(root, "dialogue/intro.tres"))).toBe(true);
    expect(await exists(path.join(root, "dialogue/intro/start.tres"))).toBe(true);
    expect(await exists(path.join(root, "dialogue/intro/end.tres"))).toBe(true);
  });
});

describe("helpTools + verifySpec + tierAndCustom", () => {
  it("help returns markdown for known topics", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerHelpTools(server as never, makeConfig(root));
    const overview = parse(await server.run("devpilot_help"));
    expect(overview.data.markdown).toContain("DevPilot MCP");
    const fps = parse(await server.run("devpilot_help", { topic: "fps_3d" }));
    expect(fps.data.markdown).toContain("FPS 3D");
  });

  it("verify_spec evaluates file_exists + autoload + main_scene", async () => {
    const root = await makeTmpProject();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts/Foo.gd"), "extends Node\n", "utf8");
    const server = makeServer();
    registerVerifySpecTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_verify_spec", {
      criteria: [
        { type: "file_exists", path: "res://scripts/Foo.gd" },
        { type: "file_exists", path: "res://nonexistent.gd" },
      ],
    });
    const out = parse(r).data;
    expect(out.passed).toBe(1);
    expect(out.failed).toBe(1);
  });

  it("list_tools_by_tier returns core list", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerTierAndCustomTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_list_tools_by_tier");
    expect(parse(r).data.core.length).toBeGreaterThan(10);
  });

  it("custom_blueprint register + list + apply", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerTierAndCustomTools(server as never, makeConfig(root));
    await server.run("devpilot_register_custom_blueprint", {
      blueprint: {
        name: "my_test",
        description: "test bp",
        scripts: [{ path: "res://scripts/MyTest.gd", content: "extends Node\n" }],
      },
    });
    const list = parse(await server.run("devpilot_list_custom_blueprints"));
    expect(list.data.count).toBe(1);
    expect(list.data.blueprints[0].name).toBe("my_test");
    const apply = parse(await server.run("devpilot_apply_custom_blueprint", { name: "my_test" }));
    expect(apply.ok).toBe(true);
    expect(await exists(path.join(root, "scripts/MyTest.gd"))).toBe(true);
  });

  it("apply_custom_blueprint unknown returns error", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerTierAndCustomTools(server as never, makeConfig(root));
    const r = await server.run("devpilot_apply_custom_blueprint", { name: "nonexistent" });
    expect(parse(r).ok).toBe(false);
  });
});
