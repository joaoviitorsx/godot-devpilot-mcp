import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/config";
import { registerFileTools } from "../src/tools/fileTools";

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-file-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeConfig(projectRoot: string, readOnly = false) {
  return { ...loadConfig({ GODOT_MCP_READ_ONLY: String(readOnly) }), projectRoot };
}

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function captureTools(projectRoot: string, readOnly = false): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    registerTool: (name: string, _meta: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    }
  };
  registerFileTools(fakeServer as never, makeConfig(projectRoot, readOnly));
  return handlers;
}

function parseResult(raw: { content: Array<{ text: string }> }) {
  return JSON.parse(raw.content[0].text);
}

// ─── godot_search_files ──────────────────────────────────────────────────────

describe("godot_search_files", () => {
  it("finds files by pattern", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"));
    await writeFile(path.join(root, "scripts", "Player.gd"), "");
    await writeFile(path.join(root, "scripts", "Enemy.gd"), "");
    await writeFile(path.join(root, "Main.tscn"), "");

    const tools = captureTools(root);
    const result = parseResult(await tools["godot_search_files"]({ pattern: "Player", root: "res://", extensions: [], recursive: true, limit: 100 }));

    expect(result.ok).toBe(true);
    expect(result.data.files).toContain("res://scripts/Player.gd");
    expect(result.data.files).not.toContain("res://scripts/Enemy.gd");
  });

  it("returns all files when pattern is empty string", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "a.gd"), "");
    await writeFile(path.join(root, "b.gd"), "");

    const tools = captureTools(root);
    const result = parseResult(await tools["godot_search_files"]({ pattern: "", root: "res://", extensions: [], recursive: false, limit: 100 }));

    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(2);
  });

  it("filters by extension", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "Player.gd"), "");
    await writeFile(path.join(root, "Player.tscn"), "");

    const tools = captureTools(root);
    const result = parseResult(await tools["godot_search_files"]({ pattern: "Player", root: "res://", extensions: [".gd"], recursive: false, limit: 100 }));

    expect(result.ok).toBe(true);
    expect(result.data.files).toContain("res://Player.gd");
    expect(result.data.files).not.toContain("res://Player.tscn");
  });
});

// ─── godot_write_file ────────────────────────────────────────────────────────

describe("godot_write_file", () => {
  it("creates a new file", async () => {
    const root = await makeProjectRoot();
    const tools = captureTools(root, false);

    const result = parseResult(await tools["godot_write_file"]({
      path: "res://scripts/Player.gd",
      content: "extends CharacterBody2D",
      overwrite: false,
      dry_run: false
    }));

    expect(result.ok).toBe(true);
    expect(result.data.created).toBe(true);
    expect(result.data.backed_up).toBe(false);

    const written = await readFile(path.join(root, "scripts", "Player.gd"), "utf8");
    expect(written).toBe("extends CharacterBody2D");
  });

  it("returns FILE_ALREADY_EXISTS when overwrite=false and file exists", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "Player.gd"), "old");

    const tools = captureTools(root, false);
    const result = parseResult(await tools["godot_write_file"]({
      path: "res://Player.gd",
      content: "new",
      overwrite: false,
      dry_run: false
    }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("FILE_ALREADY_EXISTS");
  });

  it("overwrites and backs up when overwrite=true", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "Player.gd"), "old content");

    const tools = captureTools(root, false);
    const result = parseResult(await tools["godot_write_file"]({
      path: "res://Player.gd",
      content: "new content",
      overwrite: true,
      dry_run: false
    }));

    expect(result.ok).toBe(true);
    expect(result.data.backed_up).toBe(true);

    const written = await readFile(path.join(root, "Player.gd"), "utf8");
    expect(written).toBe("new content");
  });

  it("dry_run returns planned changes without writing", async () => {
    const root = await makeProjectRoot();
    const tools = captureTools(root, false);

    const result = parseResult(await tools["godot_write_file"]({
      path: "res://scripts/Player.gd",
      content: "extends Node",
      overwrite: false,
      dry_run: true
    }));

    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);
    expect(result.data.applied).toBe(false);

    const exists = await readFile(path.join(root, "scripts", "Player.gd"), "utf8").catch(() => null);
    expect(exists).toBeNull();
  });

  it("returns READ_ONLY_MODE when read-only enabled", async () => {
    const root = await makeProjectRoot();
    const tools = captureTools(root, true);

    const result = parseResult(await tools["godot_write_file"]({
      path: "res://Player.gd",
      content: "x",
      overwrite: false,
      dry_run: false
    }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("READ_ONLY_MODE");
  });

  it("returns PATH_OUTSIDE_PROJECT for traversal", async () => {
    const root = await makeProjectRoot();
    const tools = captureTools(root, false);

    const result = parseResult(await tools["godot_write_file"]({
      path: "res://../outside.gd",
      content: "evil",
      overwrite: false,
      dry_run: false
    }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("PATH_OUTSIDE_PROJECT");
  });
});

// ─── godot_patch_file ────────────────────────────────────────────────────────

describe("godot_patch_file", () => {
  it("replaces content in file and creates backup", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "Player.gd"), "extends CharacterBody2D\nvar speed = 100");

    const tools = captureTools(root, false);
    const result = parseResult(await tools["godot_patch_file"]({
      path: "res://Player.gd",
      old_content: "var speed = 100",
      new_content: "var speed = 200",
      dry_run: false
    }));

    expect(result.ok).toBe(true);
    expect(result.data.backed_up).toBe(true);

    const patched = await readFile(path.join(root, "Player.gd"), "utf8");
    expect(patched).toBe("extends CharacterBody2D\nvar speed = 200");
  });

  it("returns PATCH_CONTENT_NOT_FOUND when old_content missing", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "Player.gd"), "extends Node");

    const tools = captureTools(root, false);
    const result = parseResult(await tools["godot_patch_file"]({
      path: "res://Player.gd",
      old_content: "not in file",
      new_content: "replacement",
      dry_run: false
    }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("PATCH_CONTENT_NOT_FOUND");
  });

  it("dry_run validates but does not write", async () => {
    const root = await makeProjectRoot();
    const original = "extends Node\nvar x = 1";
    await writeFile(path.join(root, "Player.gd"), original);

    const tools = captureTools(root, false);
    const result = parseResult(await tools["godot_patch_file"]({
      path: "res://Player.gd",
      old_content: "var x = 1",
      new_content: "var x = 2",
      dry_run: true
    }));

    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);

    const unchanged = await readFile(path.join(root, "Player.gd"), "utf8");
    expect(unchanged).toBe(original);
  });

  it("returns FILE_READ_FAILED for missing file", async () => {
    const root = await makeProjectRoot();
    const tools = captureTools(root, false);

    const result = parseResult(await tools["godot_patch_file"]({
      path: "res://missing.gd",
      old_content: "x",
      new_content: "y",
      dry_run: false
    }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("FILE_READ_FAILED");
  });
});
