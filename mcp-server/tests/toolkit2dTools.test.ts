import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import { registerToolkit2dTools } from "../src/tools/toolkit2dTools";

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
  const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-toolkit2d-"));
  roots.push(r);
  return r;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("toolkit2d — read-only", () => {
  it("blocks create_player_2d in read-only", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(true, root) as never);
    const r = parse(await server.run("godot_create_player_2d") as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("READ_ONLY_MODE");
  });
});

describe("toolkit2d — dry_run", () => {
  it("create_player_2d dry_run returns plan without writing", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_player_2d", { dry_run: true }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dry_run).toBe(true);
    expect(r.data.planned_changes.length).toBeGreaterThan(0);
  });

  it("create_topdown_controller dry_run", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_topdown_controller", { script_path: "res://scripts/X.gd", dry_run: true }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dry_run).toBe(true);
  });
});

describe("toolkit2d — script generation", () => {
  it("create_topdown_controller writes file", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_topdown_controller", { script_path: "res://scripts/Top.gd" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const content = await readFile(path.join(root, "scripts", "Top.gd"), "utf8");
    expect(content).toContain("get_axis(\"move_left\", \"move_right\")");
    expect(content).toContain("move_and_slide()");
  });

  it("create_platformer_controller writes platformer template", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_platformer_controller", { script_path: "res://scripts/Plat.gd" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const content = await readFile(path.join(root, "scripts", "Plat.gd"), "utf8");
    expect(content).toContain("jump_velocity");
    expect(content).toContain("is_on_floor()");
  });

  it("rejects non-.gd path", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_topdown_controller", { script_path: "res://scripts/Bad.txt" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("INVALID_PARAMS");
  });

  it("blocks overwrite without overwrite=true", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    await server.run("godot_create_topdown_controller", { script_path: "res://scripts/A.gd" });
    const second = parse(await server.run("godot_create_topdown_controller", { script_path: "res://scripts/A.gd" }) as { content: Array<{ text: string }> });
    expect(second.ok).toBe(false);
    expect(second.error.code).toBe("FILE_ALREADY_EXISTS");
  });
});

describe("toolkit2d — orchestration", () => {
  it("create_player_2d issues node.add and script.attach calls", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit2dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_player_2d", { name: "Hero" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.player_path).toBe("Hero");
    const calls = (godot.call as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toContain("node.add");
    expect(calls).toContain("script.attach");
  });

  it("setup_camera_2d sets enabled and zoom", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit2dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_camera_2d", { parent_path: "Player", zoom: 2.0 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const calls = (godot.call as ReturnType<typeof vi.fn>).mock.calls;
    const setProps = calls.filter((c) => c[0] === "node.set_property");
    expect(setProps.some((c) => (c[1] as { property: string }).property === "enabled")).toBe(true);
    expect(setProps.some((c) => (c[1] as { property: string }).property === "zoom")).toBe(true);
  });

  it("create_health_system supports max_health override", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_health_system", { max_health: 250 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const content = await readFile(path.join(root, "scripts", "HealthSystem.gd"), "utf8");
    expect(content).toContain("max_health: int = 250");
  });
});

describe("toolkit2d — Phase 11 completion (collision/area/tilemap/parallax/inventory)", () => {
  it("setup_collision_2d adds CollisionShape2D node", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit2dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_collision_2d", { parent_path: "Player" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.collision_path).toBe("Player/CollisionShape2D");
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("CollisionShape2D");
  });

  it("setup_collision_2d blocked in read-only", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(true, root) as never);
    const r = parse(await server.run("godot_setup_collision_2d", { parent_path: "Player" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("READ_ONLY_MODE");
  });

  it("setup_area_trigger_2d creates Area2D + script", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit2dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_area_trigger_2d", {}) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const content = await readFile(path.join(root, "scripts", "AreaTrigger.gd"), "utf8");
    expect(content).toContain("body_entered.connect");
    expect(content).toContain("triggered.emit");
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("Area2D");
    expect(types).toContain("CollisionShape2D");
  });

  it("create_tilemap dry_run", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit2dTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_tilemap", { dry_run: true }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dry_run).toBe(true);
  });

  it("create_tilemap adds TileMap node", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit2dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_tilemap", { name: "World" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.tilemap_path).toBe("World");
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("TileMap");
  });

  it("setup_parallax_background creates background + N layers", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit2dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_parallax_background", { layer_count: 4 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.layer_count).toBe(4);
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types.filter((t) => t === "ParallaxLayer").length).toBe(4);
    expect(types).toContain("ParallaxBackground");
  });

  it("setup_parallax_background defaults to 3 layers", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit2dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_parallax_background", {}) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.layer_count).toBe(3);
  });

  it("create_inventory_ui creates CanvasLayer + Control + GridContainer + script", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit2dTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_inventory_ui", { columns: 6 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.columns).toBe(6);
    const content = await readFile(path.join(root, "scripts", "InventoryUI.gd"), "utf8");
    expect(content).toContain("@export var columns: int = 6");
    expect(content).toContain("add_item");
    const types = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.add")
      .map((c) => (c[1] as { node_type: string }).node_type);
    expect(types).toContain("CanvasLayer");
    expect(types).toContain("Control");
    expect(types).toContain("GridContainer");
  });
});
