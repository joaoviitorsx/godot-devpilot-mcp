import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { cleanupTmpProjects, makeConfig, makeFakeGodot, makeServer, makeTmpProject, mkdir, parse, writeFile } from "./_helpers.js";
import { inferAutoloads, inferInputActions, registerInferTools } from "../src/tools/inferTools.js";

afterEach(async () => cleanupTmpProjects());

describe("project inference with an editor InputMap that is out of date", () => {
  it("reads input registrations from project.godot and ignores addon code", async () => {
    const root = await makeTmpProject();
    await writeFile(path.join(root, "project.godot"), `config_version=5
[input]
move_left={"deadzone":0.5,"events":[Object(InputEventKey,"physical_keycode":65)]}
move_right={"deadzone":0.5,"events":[Object(InputEventKey,"physical_keycode":68)]}
vacuum={"deadzone":0.5,"events":[Object(InputEventKey,"physical_keycode":32)]}
`, "utf8");
    await mkdir(path.join(root, "scripts"));
    await writeFile(path.join(root, "scripts", "game.gd"), `extends Node
const CloudScene = preload("res://cloud.gd")
func _process(_delta):
  Input.get_axis("move_left", "move_right")
  Input.is_action_pressed("vacuum")
  CloudScene.new()
  CircleShape2D.new()
  CapiCloud.DATA.get("fluffy")
`, "utf8");
    await mkdir(path.join(root, "addons", "third_party"), { recursive: true });
    await writeFile(path.join(root, "addons", "third_party", "plugin.gd"), `extends EditorPlugin
FakeEditorManager.run()
`, "utf8");

    const godot = makeFakeGodot(); // Editor RPC returns an empty, stale InputMap.
    const input = await inferInputActions(godot, root);
    expect(input.ok).toBe(true);
    expect((input.data as { missing_actions: string[] }).missing_actions).toEqual([]);
    const autoloads = await inferAutoloads(godot, root);
    expect((autoloads.data as { missing_singletons: string[] }).missing_singletons).toEqual([]);

    const server = makeServer();
    registerInferTools(server as never, godot, makeConfig(root));
    const validation = parse(await server.run("godot_validate_input_map"));
    expect(validation.data.passed).toBe(true);
  });

  it("reports actual missing game autoloads and honors project registrations", async () => {
    const root = await makeTmpProject();
    await mkdir(path.join(root, "scripts"));
    await writeFile(path.join(root, "scripts", "game.gd"), "extends Node\nfunc _ready():\n  GameManager.start()\n", "utf8");
    const godot = makeFakeGodot();
    const missing = await inferAutoloads(godot, root);
    expect((missing.data as { missing_singletons: string[] }).missing_singletons).toEqual(["GameManager"]);

    await writeFile(path.join(root, "project.godot"), "config_version=5\n[autoload]\nGameManager=\"*res://scripts/game_manager.gd\"\n", "utf8");
    const registered = await inferAutoloads(godot, root);
    expect((registered.data as { missing_singletons: string[] }).missing_singletons).toEqual([]);
  });
});
