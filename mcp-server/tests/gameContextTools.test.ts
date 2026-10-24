import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { checkConventions } from "../src/indexer/projectIndexer.js";
import { buildGameContext, registerGameContextTools } from "../src/tools/gameContextTools.js";
import { cleanupTmpProjects, makeConfig, makeTmpProject, mkdir, writeFile } from "./_helpers.js";

afterEach(async () => cleanupTmpProjects());

async function fixture() {
  const root = await makeTmpProject();
  await mkdir(path.join(root, "scenes"));
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "assets"));
  await mkdir(path.join(root, "addons", "godot_devpilot_mcp"), { recursive: true });
  await writeFile(path.join(root, "project.godot"), '[application]\nconfig/name="My Game"\nrun/main_scene="res://scenes/main_scene.tscn"\n');
  await writeFile(path.join(root, "scenes", "main_scene.tscn"), '[gd_scene format=3]\n[ext_resource type="Script" path="res://scripts/player.gd" id="1"]\n[ext_resource type="Texture2D" path="res://assets/missing.png" id="2"]\n');
  await writeFile(path.join(root, "scripts", "player.gd"), "extends Node2D\n");
  await writeFile(path.join(root, "assets", "hero.png"), "image");
  await writeFile(path.join(root, "addons", "godot_devpilot_mcp", "plugin.cfg"), "[plugin]\nname=\"DevPilot\"\n");
  await writeFile(path.join(root, "addons", "godot_devpilot_mcp", "plugin.gd"), "@tool\nextends EditorPlugin\n");
  return root;
}

describe("game context for AI workflows", () => {
  it("indexes game content without counting addon implementation files", async () => {
    const root = await fixture();
    const context = await buildGameContext(root);
    expect(context.project_name).toBe("My Game");
    expect(context.main_scene_exists).toBe(true);
    expect(context.main_scene_resolved_path).toBe("res://scenes/main_scene.tscn");
    expect(context.counts).toMatchObject({ scenes: 1, scripts: 1, assets: 1 });
    expect(context.addons).toEqual(["godot_devpilot_mcp"]);
    expect(context.missing_dependencies).toContain("res://scenes/main_scene.tscn -> res://assets/missing.png");
    expect(context.scripts.paths).toEqual(["res://scripts/player.gd"]);
  });

  it("resolves a Godot 4 scene UID from the scene header", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "project.godot"), '[application]\nrun/main_scene="uid://test_main_scene"\n');
    await writeFile(path.join(root, "scenes", "main_scene.tscn"), '[gd_scene format=3 uid="uid://test_main_scene"]\n[node name="Main" type="Node2D"]\n');
    const context = await buildGameContext(root);
    expect(context.main_scene_resolved_path).toBe("res://scenes/main_scene.tscn");
    expect(context.main_scene_exists).toBe(true);
  });

  it("exposes a read-only tool, resource, and reusable feature/playtest/tile/3D prompts", async () => {
    const root = await fixture();
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    registerGameContextTools(server, makeConfig(root, true));
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("godot://project/context");
      const resource = await client.readResource({ uri: "godot://project/context" });
      expect(JSON.parse(resource.contents[0].text as string).counts.scenes).toBe(1);
      const result = await client.callTool({ name: "devpilot_game_context", arguments: {} });
      const text = result.content[0].type === "text" ? result.content[0].text : "{}";
      expect(JSON.parse(text).ok).toBe(true);
      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((entry) => entry.name)).toEqual([
        "devpilot_feature_loop", "devpilot_playtest_loop", "devpilot_tile_workflow", "devpilot_3d_vertical_slice", "devpilot_game_production_loop"
      ]);
      const feature = await client.getPrompt({ name: "devpilot_feature_loop", arguments: { goal: "Add a jump" } });
      expect(feature.messages[0].content.type).toBe("text");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("accepts Godot's snake_case scene file convention", () => {
    expect(checkConventions([{ res_path: "res://scenes/main_scene.tscn", absolute_path: "", size_bytes: 0, kind: "scene" }])).toEqual([]);
  });
});
