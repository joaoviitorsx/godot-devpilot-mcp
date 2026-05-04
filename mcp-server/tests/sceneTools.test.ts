import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerConfig } from "../src/config/config";
import type { GodotClient } from "../src/godot/client";
import { registerSceneTools } from "../src/tools/sceneTools";

function makeConfig(readOnly = false, projectRoot = "/fake/project"): ServerConfig {
  return {
    server: { name: "test", version: "0.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeout: 5000, reconnectDelay: 1000, maxReconnectDelay: 30000 },
    security: { readOnly },
    projectRoot
  };
}

function makeGodot(callResult: unknown = { ok: true, data: {}, message: "" }): GodotClient {
  return {
    getStatus: vi.fn().mockReturnValue({ connected: true }),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    call: vi.fn().mockResolvedValue(callResult)
  } as unknown as GodotClient;
}

function makeGodotSequence(callResults: unknown[]): GodotClient {
  return {
    getStatus: vi.fn().mockReturnValue({ connected: true }),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    call: vi.fn()
      .mockResolvedValueOnce(callResults[0])
      .mockResolvedValueOnce(callResults[1])
      .mockResolvedValueOnce(callResults[2])
  } as unknown as GodotClient;
}

function makeServer() {
  const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  return {
    tool: (name: string, _desc: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      tools[name] = handler;
    },
    run: (name: string, args: Record<string, unknown> = {}) => tools[name](args)
  };
}

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-scene-tools-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("sceneTools", () => {
  describe("godot_get_scene_tree", () => {
    it("calls scene.get_tree with include_properties", async () => {
      const godot = makeGodot({ ok: true, data: { root: {}, total_nodes: 1 }, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      await server.run("godot_get_scene_tree", { include_properties: true, max_depth: 3 });

      expect(godot.call).toHaveBeenCalledWith("scene.get_tree", { include_properties: true, max_depth: 3 });
    });

    it("defaults include_properties to false", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      await server.run("godot_get_scene_tree", {});

      expect(godot.call).toHaveBeenCalledWith("scene.get_tree", { include_properties: false, max_depth: 10 });
    });
  });

  describe("godot_get_scene_summary", () => {
    it("calls scene.get_summary", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      await server.run("godot_get_scene_summary", {});

      expect(godot.call).toHaveBeenCalledWith("scene.get_summary", {});
    });
  });

  describe("godot_validate_scene", () => {
    it("calls scene.validate with path", async () => {
      const godot = makeGodot({ ok: true, data: { valid: true }, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      await server.run("godot_validate_scene", { path: "res://scenes/Player.tscn" });

      expect(godot.call).toHaveBeenCalledWith("scene.validate", { path: "res://scenes/Player.tscn" });
    });

    it("blocks paths outside res:// before calling godot", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      const result = await server.run("godot_validate_scene", { path: "../outside.tscn" }) as { isError: boolean };

      expect(result.isError).toBe(true);
      expect(godot.call).not.toHaveBeenCalled();
    });
  });

  describe("godot_create_scene", () => {
    it("returns dry_run payload without calling godot", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      const result = await server.run("godot_create_scene", {
        scene_path: "res://scenes/New.tscn",
        root_type: "Node2D",
        dry_run: true
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.dry_run).toBe(true);
      expect(godot.call).not.toHaveBeenCalled();
    });

    it("blocked in read-only mode", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig(true));

      const result = await server.run("godot_create_scene", { path: "res://scenes/X.tscn" }) as { isError: boolean };

      expect(result.isError).toBe(true);
      expect(godot.call).not.toHaveBeenCalled();
    });

    it("calls scene.create when not dry_run", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      await server.run("godot_create_scene", { scene_path: "res://scenes/New.tscn", root_type: "Node3D", root_name: "Root" });

      expect(godot.call).toHaveBeenCalledWith("scene.create", {
        path: "res://scenes/New.tscn",
        root_type: "Node3D",
        root_name: "Root",
        overwrite: false
      });
    });

    it("rejects an existing scene unless overwrite=true", async () => {
      const root = await makeProjectRoot();
      await mkdir(path.join(root, "scenes"), { recursive: true });
      await writeFile(path.join(root, "scenes", "New.tscn"), "[gd_scene format=3]\n", "utf8");

      const godot = makeGodot();
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig(false, root));

      const result = await server.run("godot_create_scene", { path: "res://scenes/New.tscn" }) as { isError: boolean };

      expect(result.isError).toBe(true);
      expect(godot.call).not.toHaveBeenCalled();
    });
  });

  describe("godot_duplicate_scene", () => {
    it("returns dry_run without calling godot", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      const result = await server.run("godot_duplicate_scene", {
        source: "res://scenes/A.tscn",
        destination: "res://scenes/B.tscn",
        dry_run: true
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.dry_run).toBe(true);
      expect(godot.call).not.toHaveBeenCalled();
    });

    it("blocks duplicate scene paths outside res://", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      const result = await server.run("godot_duplicate_scene", {
        source: "res://scenes/A.tscn",
        destination: "../B.tscn"
      }) as { isError: boolean };

      expect(result.isError).toBe(true);
      expect(godot.call).not.toHaveBeenCalled();
    });
  });

  describe("godot_open_scene", () => {
    it("calls scene.open", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      await server.run("godot_open_scene", { path: "res://scenes/Main.tscn" });

      expect(godot.call).toHaveBeenCalledWith("scene.open", { path: "res://scenes/Main.tscn" });
    });
  });

  describe("godot_save_scene", () => {
    it("calls scene.save with explicit path", async () => {
      const godot = makeGodot({ ok: true, data: {}, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      await server.run("godot_save_scene", { scene_path: "res://scenes/Main.tscn" });

      expect(godot.call).toHaveBeenCalledWith("scene.save", { path: "res://scenes/Main.tscn" });
    });

    it("returns dry_run without saving", async () => {
      const godot = makeGodot();
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      const result = await server.run("godot_save_scene", { scene_path: "res://scenes/Main.tscn", dry_run: true }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.dry_run).toBe(true);
      expect(godot.call).not.toHaveBeenCalled();
    });

    it("creates a backup before saving an existing scene", async () => {
      const root = await makeProjectRoot();
      await mkdir(path.join(root, "scenes"), { recursive: true });
      await writeFile(path.join(root, "scenes", "Main.tscn"), "[gd_scene format=3]\n", "utf8");
      const godot = makeGodot({ ok: true, data: { path: "res://scenes/Main.tscn" }, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig(false, root));

      const result = await server.run("godot_save_scene", { scene_path: "res://scenes/Main.tscn" }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.backup_path).toMatch(/^res:\/\/\.godot_mcp\/backups\//);
      expect(godot.call).toHaveBeenCalledWith("scene.save", { path: "res://scenes/Main.tscn" });
    });

    it("gets current scene path and creates backup before saving without explicit path", async () => {
      const root = await makeProjectRoot();
      await mkdir(path.join(root, "scenes"), { recursive: true });
      await writeFile(path.join(root, "scenes", "Current.tscn"), "[gd_scene format=3]\n", "utf8");
      const godot = makeGodotSequence([
        { ok: true, data: { current_scene: "res://scenes/Current.tscn" }, message: "" },
        { ok: true, data: { path: "res://scenes/Current.tscn" }, message: "" }
      ]);
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig(false, root));

      const result = await server.run("godot_save_scene", {}) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.backup_path).toMatch(/^res:\/\/\.godot_mcp\/backups\//);
      expect(godot.call).toHaveBeenNthCalledWith(1, "project.get_editor_context", {});
      expect(godot.call).toHaveBeenNthCalledWith(2, "scene.save", { path: "res://scenes/Current.tscn" });
    });
  });

  describe("godot_audit_scene", () => {
    it("calls scene.audit", async () => {
      const godot = makeGodot({ ok: true, data: { issues: [] }, message: "" });
      const server = makeServer();
      registerSceneTools(server as never, godot, makeConfig());

      await server.run("godot_audit_scene", { path: "res://scenes/Main.tscn" });

      expect(godot.call).toHaveBeenCalledWith("scene.audit", { path: "res://scenes/Main.tscn" });
    });
  });
});
