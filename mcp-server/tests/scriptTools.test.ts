import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerConfig } from "../src/config/config";
import type { GodotClient } from "../src/godot/client";
import { registerScriptTools } from "../src/tools/scriptTools";

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
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-script-tools-"));
  roots.push(root);
  return root;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("scriptTools", () => {
  it("creates a script and blocks overwrite without explicit flag", async () => {
    const root = await makeProjectRoot();
    const server = makeServer();
    registerScriptTools(server as never, makeGodot(), makeConfig(false, root));

    const created = parse(await server.run("godot_create_script", {
      path: "res://scripts/Player.gd",
      extends: "CharacterBody2D",
      content: "func _ready():\n\tpass\n"
    }) as { content: Array<{ text: string }> });
    const duplicate = parse(await server.run("godot_create_script", {
      path: "res://scripts/Player.gd",
      extends: "Node"
    }) as { content: Array<{ text: string }> });

    expect(created.ok).toBe(true);
    expect(await readFile(path.join(root, "scripts", "Player.gd"), "utf8")).toContain("extends CharacterBody2D");
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error.code).toBe("FILE_ALREADY_EXISTS");
  });

  it("creates a backup when overwriting a script", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Player.gd"), "extends Node\n", "utf8");
    const server = makeServer();
    registerScriptTools(server as never, makeGodot(), makeConfig(false, root));

    const result = parse(await server.run("godot_create_script", {
      path: "res://scripts/Player.gd",
      extends: "CharacterBody2D",
      overwrite: true
    }) as { content: Array<{ text: string }> });

    expect(result.ok).toBe(true);
    expect(result.data.backup_path).toMatch(/^res:\/\/\.godot_mcp\/backups\//);
  });

  it("reads scripts and rejects non-gd/sensitive paths", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Player.gd"), "extends Node\n", "utf8");
    const server = makeServer();
    registerScriptTools(server as never, makeGodot(), makeConfig(false, root));

    const read = parse(await server.run("godot_read_script", { path: "res://scripts/Player.gd" }) as { content: Array<{ text: string }> });
    const blocked = parse(await server.run("godot_read_script", { path: "res://.env" }) as { content: Array<{ text: string }> });

    expect(read.ok).toBe(true);
    expect(read.data.content).toBe("extends Node\n");
    expect(blocked.ok).toBe(false);
  });

  it("patches a script with mandatory backup and dry_run", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Player.gd"), "extends Node\nvar speed = 100\n", "utf8");
    const server = makeServer();
    registerScriptTools(server as never, makeGodot(), makeConfig(false, root));

    const dry = parse(await server.run("godot_patch_script", {
      path: "res://scripts/Player.gd",
      old_content: "speed = 100",
      new_content: "speed = 200",
      dry_run: true
    }) as { content: Array<{ text: string }> });
    const patched = parse(await server.run("godot_patch_script", {
      path: "res://scripts/Player.gd",
      old_content: "speed = 100",
      new_content: "speed = 200"
    }) as { content: Array<{ text: string }> });

    expect(dry.data.dry_run).toBe(true);
    expect(patched.ok).toBe(true);
    expect(patched.data.backup_path).toMatch(/^res:\/\/\.godot_mcp\/backups\//);
    expect(await readFile(path.join(root, "scripts", "Player.gd"), "utf8")).toContain("speed = 200");
  });

  it("routes attach, validate and classdb info to Godot", async () => {
    const godot = makeGodot({ ok: true, data: {}, message: "" });
    const server = makeServer();
    registerScriptTools(server as never, godot, makeConfig());

    await server.run("godot_attach_script", { node_path: "Player", script_path: "res://scripts/Player.gd" });
    await server.run("godot_validate_script", { path: "res://scripts/Player.gd", godot_version_target: "4.x" });
    await server.run("godot_get_classdb_info", { class_name: "CharacterBody2D" });

    expect(godot.call).toHaveBeenCalledWith("script.attach", { node_path: "Player", script_path: "res://scripts/Player.gd" });
    expect(godot.call).toHaveBeenCalledWith("script.validate", { path: "res://scripts/Player.gd", godot_version_target: "4.x" });
    expect(godot.call).toHaveBeenCalledWith("script.get_classdb_info", { class_name: "CharacterBody2D" });
  });

  it("extracts symbols, dependencies, references and formats scripts", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Player.gd"), "class_name Player\nextends CharacterBody2D\nsignal died\n@export var speed = 100\nfunc move_player():\n    pass  \n", "utf8");
    await writeFile(path.join(root, "scripts", "Enemy.gd"), "const PlayerScene = preload(\"res://scripts/Player.gd\")\nfunc hit(p: Player): pass\n", "utf8");
    const server = makeServer();
    registerScriptTools(server as never, makeGodot(), makeConfig(false, root));

    const symbols = parse(await server.run("godot_get_script_symbols", { path: "res://scripts/Player.gd" }) as { content: Array<{ text: string }> });
    const deps = parse(await server.run("godot_get_script_dependencies", { path: "res://scripts/Enemy.gd" }) as { content: Array<{ text: string }> });
    const refs = parse(await server.run("godot_find_references", { query: "Player", root: "res://scripts" }) as { content: Array<{ text: string }> });
    const formatted = parse(await server.run("godot_format_script", { path: "res://scripts/Player.gd" }) as { content: Array<{ text: string }> });

    expect(symbols.data.class_name).toBe("Player");
    expect(symbols.data.functions[0].name).toBe("move_player");
    expect(deps.data.dependencies).toContain("res://scripts/Player.gd");
    expect(refs.data.references.length).toBeGreaterThan(0);
    expect(formatted.ok).toBe(true);
    expect(formatted.data.backup_path).toMatch(/^res:\/\/\.godot_mcp\/backups\//);
  });
});
