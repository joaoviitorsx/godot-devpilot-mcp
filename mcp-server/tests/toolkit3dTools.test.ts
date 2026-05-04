import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import { registerToolkit3dTools } from "../src/tools/toolkit3dTools";

function makeConfig(readOnly = false, projectRoot = "/fake/project") {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full",
    security: { readOnly },
    projectRoot
  };
}

function makeGodot(): GodotClient {
  return {
    getStatus: vi.fn().mockReturnValue({ connected: true }),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    call: vi.fn().mockResolvedValue({ ok: true, data: {}, message: "ok", warnings: [], suggestions: [] })
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

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-toolkit3d-"));
  roots.push(r);
  return r;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("toolkit3d — read-only", () => {
  it("blocks setup_camera_3d in read-only", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(true, root) as never);
    const r = parse(await server.run("godot_setup_camera_3d", { parent_path: "Player" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("READ_ONLY_MODE");
  });

  it("blocks create_character_body_3d in read-only", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(true, root) as never);
    const r = parse(await server.run("godot_create_character_body_3d") as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("READ_ONLY_MODE");
  });
});

describe("toolkit3d — dry_run", () => {
  it("setup_camera_3d dry_run", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_camera_3d", { parent_path: "Player", fov: 90, dry_run: true }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dry_run).toBe(true);
    expect(r.data.planned_changes.length).toBe(2);
  });

  it("create_character_body_3d dry_run includes camera by default", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_character_body_3d", { dry_run: true }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.planned_changes.some((c: string) => c.includes("CameraPivot"))).toBe(true);
  });

  it("create_character_body_3d dry_run with include_camera=false skips camera", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_character_body_3d", { include_camera: false, dry_run: true }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.planned_changes.some((c: string) => c.includes("CameraPivot"))).toBe(false);
  });
});

describe("toolkit3d — script generation", () => {
  it("setup_third_person_controller writes file", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_third_person_controller", { script_path: "res://scripts/TPC.gd" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const content = await readFile(path.join(root, "scripts", "TPC.gd"), "utf8");
    expect(content).toContain("CharacterBody3D");
    expect(content).toContain("move_and_slide()");
    expect(content).toContain("MOUSE_MODE_CAPTURED");
  });

  it("rejects non-.gd path for third_person_controller", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_third_person_controller", { script_path: "res://scripts/TPC.txt" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("INVALID_PARAMS");
  });

  it("FILE_ALREADY_EXISTS without overwrite", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    await server.run("godot_setup_third_person_controller", { script_path: "res://scripts/X.gd" });
    const second = parse(await server.run("godot_setup_third_person_controller", { script_path: "res://scripts/X.gd" }) as { content: Array<{ text: string }> });
    expect(second.ok).toBe(false);
    expect(second.error.code).toBe("FILE_ALREADY_EXISTS");
  });
});

describe("toolkit3d — orchestration", () => {
  it("setup_camera_3d sets current and fov", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit3dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_camera_3d", { parent_path: "Player", fov: 90 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const calls = (godot.call as ReturnType<typeof vi.fn>).mock.calls;
    const props = calls.filter((c) => c[0] === "node.set_property").map((c) => (c[1] as { property: string }).property);
    expect(props).toContain("current");
    expect(props).toContain("fov");
  });

  it("create_character_body_3d issues node.add for body + mesh + collision + camera", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit3dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_character_body_3d", {}) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("CharacterBody3D");
    expect(types).toContain("MeshInstance3D");
    expect(types).toContain("CollisionShape3D");
    expect(types).toContain("Camera3D");
  });

  it("setup_lighting adds DirectionalLight3D + WorldEnvironment", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit3dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_lighting", {}) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("DirectionalLight3D");
    expect(types).toContain("WorldEnvironment");
  });

  it("create_navigation_region_3d adds NavigationRegion3D", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit3dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_navigation_region_3d", {}) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("NavigationRegion3D");
  });

  it("create_raycast_3d sets target_position and enabled", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit3dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_raycast_3d", { parent_path: "Player", target_y: -5 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.target_position.y).toBe(-5);
    const props = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.set_property")
      .map((c) => (c[1] as { property: string }).property);
    expect(props).toContain("target_position");
    expect(props).toContain("enabled");
  });

  it("import_gltf rejects non-gltf path", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit3dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_import_gltf", { gltf_path: "res://models/X.png" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("INVALID_PARAMS");
  });

  it("import_gltf adds Node3D placeholder for valid path", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit3dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_import_gltf", { gltf_path: "res://models/scene.glb" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.instanced).toBe(false);
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("Node3D");
  });

  it("create_primitive_mesh adds MeshInstance3D and reports suggestion", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit3dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_primitive_mesh", { primitive: "SphereMesh" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.suggested_primitive).toBe("SphereMesh");
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("MeshInstance3D");
  });
});
