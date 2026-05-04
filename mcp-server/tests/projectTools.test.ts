import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config/config";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../src/godot/protocol";
import { registerProjectTools } from "../src/tools/projectTools";

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-project-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeConfig(projectRoot: string, readOnly = false) {
  return {
    ...loadConfig({ GODOT_MCP_READ_ONLY: String(readOnly) }),
    projectRoot
  };
}

type FakeGodot = {
  getStatus: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function makeFakeGodot(options: { connected?: boolean; callResponse?: ToolResponse } = {}): FakeGodot {
  const connected = options.connected ?? false;
  const callResponse =
    options.callResponse ??
    createSuccessResponse({ project_name: "TestProject" }, "Project info loaded.");

  return {
    getStatus: vi.fn().mockReturnValue({
      connected,
      host: "127.0.0.1",
      port: 6505,
      url: "ws://127.0.0.1:6505",
      pendingRequests: 0,
      reconnectAttempts: 0,
      lastConnectedAt: null,
      lastDisconnectedAt: null
    }),
    connect: vi.fn().mockResolvedValue(
      connected
        ? createSuccessResponse({}, "Connected.")
        : createErrorResponse("GODOT_NOT_CONNECTED", "Cannot connect.", {}, [])
    ),
    call: vi.fn().mockResolvedValue(callResponse),
    disconnect: vi.fn().mockResolvedValue(undefined)
  };
}

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function captureTools(
  projectRoot: string,
  fakeGodot: FakeGodot,
  readOnly = false
): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    registerTool: (
      name: string,
      _meta: unknown,
      handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>
    ) => {
      handlers[name] = handler;
    }
  };

  registerProjectTools(fakeServer as never, fakeGodot as never, makeConfig(projectRoot, readOnly));
  return handlers;
}

function parseResult(raw: { content: Array<{ text: string }> }) {
  return JSON.parse(raw.content[0].text);
}

// ─── godot_list_files ────────────────────────────────────────────────────────

describe("godot_list_files", () => {
  it("lists files in project root", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "project.godot"), "");
    await writeFile(path.join(root, "Main.tscn"), "");
    await mkdir(path.join(root, "scripts"));
    await writeFile(path.join(root, "scripts", "Player.gd"), "");

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_list_files"]({ root: "res://", extensions: [], recursive: false, limit: 100 }));

    expect(result.ok).toBe(true);
    const filePaths: string[] = result.data.files;
    expect(filePaths).toContain("res://project.godot");
    expect(filePaths).toContain("res://Main.tscn");
  });

  it("filters by extension", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "Player.gd"), "");
    await writeFile(path.join(root, "Main.tscn"), "");

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_list_files"]({ root: "res://", extensions: [".gd"], recursive: false, limit: 100 }));

    expect(result.ok).toBe(true);
    expect(result.data.files).toContain("res://Player.gd");
    expect(result.data.files).not.toContain("res://Main.tscn");
  });

  it("recurses into subdirectories when recursive=true", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"));
    await writeFile(path.join(root, "scripts", "Player.gd"), "");

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_list_files"]({ root: "res://", extensions: [], recursive: true, limit: 100 }));

    expect(result.ok).toBe(true);
    expect(result.data.files).toContain("res://scripts/Player.gd");
  });

  it("respects limit and sets truncated=true", async () => {
    const root = await makeProjectRoot();
    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(root, `file${i}.gd`), "");
    }

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_list_files"]({ root: "res://", extensions: [], recursive: false, limit: 3 }));

    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(3);
    expect(result.data.truncated).toBe(true);
  });

  it("returns PATH_NOT_FOUND for missing directory", async () => {
    const root = await makeProjectRoot();

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_list_files"]({ root: "res://nonexistent", extensions: [], recursive: false, limit: 100 }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("PATH_NOT_FOUND");
  });

  it("returns PATH_OUTSIDE_PROJECT for traversal attempts", async () => {
    const root = await makeProjectRoot();

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_list_files"]({ root: "res://../outside", extensions: [], recursive: false, limit: 100 }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("PATH_OUTSIDE_PROJECT");
  });
});

// ─── godot_read_file ─────────────────────────────────────────────────────────

describe("godot_read_file", () => {
  it("reads file content", async () => {
    const root = await makeProjectRoot();
    await writeFile(path.join(root, "Player.gd"), "extends CharacterBody2D");

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_read_file"]({ path: "res://Player.gd" }));

    expect(result.ok).toBe(true);
    expect(result.data.content).toBe("extends CharacterBody2D");
    expect(result.data.path).toBe("res://Player.gd");
    expect(typeof result.data.size_bytes).toBe("number");
  });

  it("returns FILE_READ_FAILED for missing file", async () => {
    const root = await makeProjectRoot();

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_read_file"]({ path: "res://missing.gd" }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("FILE_READ_FAILED");
  });

  it("returns PATH_OUTSIDE_PROJECT for traversal", async () => {
    const root = await makeProjectRoot();

    const tools = captureTools(root, makeFakeGodot());
    const result = parseResult(await tools["godot_read_file"]({ path: "res://../etc/passwd" }));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("PATH_OUTSIDE_PROJECT");
  });
});

// ─── godot_get_project_info ──────────────────────────────────────────────────

describe("godot_get_project_info", () => {
  it("returns plugin response when connected", async () => {
    const root = await makeProjectRoot();
    const fake = makeFakeGodot({
      connected: true,
      callResponse: createSuccessResponse({ project_name: "MyGame", godot_version: "4.6.1" }, "Project info loaded.")
    });

    const tools = captureTools(root, fake);
    const result = parseResult(await tools["godot_get_project_info"]({}));

    expect(result.ok).toBe(true);
    expect(result.data.project_name).toBe("MyGame");
    expect(fake.call).toHaveBeenCalledWith("project.get_info", {});
  });

  it("returns error when Godot connection fails", async () => {
    const root = await makeProjectRoot();
    const fake = makeFakeGodot({ connected: false });

    const tools = captureTools(root, fake);
    const result = parseResult(await tools["godot_get_project_info"]({}));

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GODOT_NOT_CONNECTED");
  });
});

// ─── godot_get_editor_context ────────────────────────────────────────────────

describe("godot_get_editor_context", () => {
  it("returns plugin response when connected", async () => {
    const root = await makeProjectRoot();
    const fake = makeFakeGodot({
      connected: true,
      callResponse: createSuccessResponse(
        { current_scene: "res://Main.tscn", selected_nodes: [], is_playing: false },
        "Editor context obtained."
      )
    });

    const tools = captureTools(root, fake);
    const result = parseResult(await tools["godot_get_editor_context"]({}));

    expect(result.ok).toBe(true);
    expect(result.data.current_scene).toBe("res://Main.tscn");
    expect(fake.call).toHaveBeenCalledWith("project.get_editor_context", {});
  });
});
