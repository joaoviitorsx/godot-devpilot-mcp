import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { audit3DSceneSource } from "../src/tools/scene3dAuditTools.js";
import { registerStarter3DTools, starter3DSceneSpec } from "../src/tools/starter3dTools.js";
import { serializeSceneToTscn } from "../src/utils/sceneSerializer.js";
import { cleanupTmpProjects, makeConfig, makeTmpProject, readText, writeFile } from "./_helpers.js";

afterEach(async () => cleanupTmpProjects());

async function useStarter(root: string, readOnly = false) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  registerStarter3DTools(server, makeConfig(root, readOnly));
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

async function call(client: Client, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: "devpilot_create_3d_starter", arguments: args });
  const text = result.content[0].type === "text" ? result.content[0].text : "{}";
  return JSON.parse(text);
}

describe("3D starter", () => {
  it("serializes complete FPS and TPS scenes that pass the static 3D audit", () => {
    for (const mode of ["fps", "tps"] as const) {
      const scene = serializeSceneToTscn(starter3DSceneSpec("res://scenes/starter.tscn", "res://scripts/starter.gd", mode));
      expect(audit3DSceneSource(scene, "playable").findings).toEqual([]);
      expect(scene).toContain("WorldEnvironment");
      expect(scene).toContain('shape = SubResource("PlayerShape")');
    }
  });

  it("creates a playable scene, sets an empty main scene, and is repeatable", async () => {
    const root = await makeTmpProject();
    const { client, close } = await useStarter(root);
    try {
      const first = await call(client);
      expect(first.ok).toBe(true);
      expect(first.data.created_files).toHaveLength(2);
      expect(first.data.main_scene).toBe("set");
      expect(first.data.project_backup).toMatch(/^res:\/\/\.godot_mcp\/backups\//);
      const script = await readText(path.join(root, "scripts", "godopilot_3d_controller.gd"));
      const scene = await readText(path.join(root, "scenes", "godopilot_3d_starter.tscn"));
      expect(script).toContain("InputMap.add_action(action)");
      expect(scene).toContain('name="Camera3D"');
      expect(await readText(path.join(root, "project.godot"))).toContain('run/main_scene="res://scenes/godopilot_3d_starter.tscn"');
      const repeat = await call(client);
      expect(repeat.ok).toBe(true);
      expect(repeat.data.created_files).toEqual([]);
    } finally { await close(); }
  });

  it("previews all changes without creating files or backups", async () => {
    const root = await makeTmpProject();
    const originalProject = await readText(path.join(root, "project.godot"));
    const { client, close } = await useStarter(root);
    try {
      const preview = await call(client, { dry_run: true });
      expect(preview.ok).toBe(true);
      expect(preview.data.dry_run).toBe(true);
      expect(preview.data.affected_files).toEqual([
        "res://scripts/godopilot_3d_controller.gd",
        "res://scenes/godopilot_3d_starter.tscn",
        "res://project.godot"
      ]);
      expect(await readText(path.join(root, "project.godot"))).toBe(originalProject);
      await expect(readText(path.join(root, "scenes", "godopilot_3d_starter.tscn"))).rejects.toThrow();
    } finally { await close(); }
  });

  it("preserves an existing game and refuses to replace modified starter files", async () => {
    const root = await makeTmpProject();
    await writeFile(path.join(root, "project.godot"), '[application]\nrun/main_scene="res://scenes/my_game.tscn"\n');
    const { client, close } = await useStarter(root);
    try {
      const first = await call(client, { mode: "tps" });
      expect(first.ok).toBe(true);
      expect(first.data.main_scene).toBe("preserved_existing");
      expect(await readText(path.join(root, "project.godot"))).toContain('run/main_scene="res://scenes/my_game.tscn"');
      await writeFile(path.join(root, "scenes", "godopilot_3d_starter.tscn"), "my scene");
      const conflict = await call(client, { mode: "tps" });
      expect(conflict.ok).toBe(false);
      expect(conflict.error.code).toBe("FILE_ALREADY_EXISTS");
      expect(await readText(path.join(root, "scenes", "godopilot_3d_starter.tscn"))).toBe("my scene");
      const escaped = await call(client, { scene_path: "res://../outside.tscn" });
      expect(escaped.ok).toBe(false);
    } finally { await close(); }
  });

  it("respects read-only mode", async () => {
    const root = await makeTmpProject();
    const { client, close } = await useStarter(root, true);
    try {
      expect((await call(client)).error.code).toBe("READ_ONLY_MODE");
    } finally { await close(); }
  });
});
