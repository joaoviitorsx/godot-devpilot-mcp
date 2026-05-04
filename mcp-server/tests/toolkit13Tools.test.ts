import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import { registerToolkit13Tools } from "../src/tools/toolkit13Tools";

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
  const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-toolkit13-"));
  roots.push(r);
  return r;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function nodeAddTypes(godot: GodotClient): string[] {
  return (godot.call as ReturnType<typeof vi.fn>).mock.calls
    .filter((c) => c[0] === "node.add")
    .map((c) => (c[1] as { node_type: string }).node_type);
}

describe("toolkit13 — Physics", () => {
  it("setup_physics_body 2D adds RigidBody2D + CollisionShape2D + Sprite2D", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_physics_body", { name: "Ball", body_type: "RigidBody2D" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dimensions).toBe("2D");
    const types = nodeAddTypes(godot);
    expect(types).toContain("RigidBody2D");
    expect(types).toContain("CollisionShape2D");
    expect(types).toContain("Sprite2D");
  });

  it("setup_physics_body 3D include_visual=false skips MeshInstance3D", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_physics_body", { name: "Wall", body_type: "StaticBody3D", include_visual: false }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const types = nodeAddTypes(godot);
    expect(types).toContain("StaticBody3D");
    expect(types).toContain("CollisionShape3D");
    expect(types).not.toContain("MeshInstance3D");
  });

  it("setup_physics_body blocked in read-only", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit13Tools(server as never, makeGodot(), makeConfig(true, root) as never);
    const r = parse(await server.run("godot_setup_physics_body", { name: "X", body_type: "RigidBody2D" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("READ_ONLY_MODE");
  });

  it("set_collision_layers sets layer + mask", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_set_collision_layers", { node_path: "Player", layer: 3, mask: 5 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const props = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.set_property")
      .map((c) => (c[1] as { property: string; value: unknown }));
    expect(props.find((p) => p.property === "collision_layer")?.value).toBe(3);
    expect(props.find((p) => p.property === "collision_mask")?.value).toBe(5);
  });

  it("add_raycast_2d sets target_position and enabled", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_add_raycast_2d", { parent_path: "Player", target_x: 50, target_y: -200 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.target_position).toEqual({ x: 50, y: -200 });
    expect(nodeAddTypes(godot)).toContain("RayCast2D");
  });
});

describe("toolkit13 — Animation", () => {
  it("create_animation_player adds AnimationPlayer", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_animation_player", { autoplay: "idle" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.autoplay).toBe("idle");
    expect(nodeAddTypes(godot)).toContain("AnimationPlayer");
  });

  it("add_animation_track returns instructions (read-only)", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit13Tools(server as never, makeGodot(), makeConfig(true, root) as never);
    const r = parse(await server.run("godot_add_animation_track", { player_path: "AnimationPlayer", animation_name: "idle" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.instructions.length).toBeGreaterThan(0);
  });

  it("create_animation_tree configures anim_player + active=true", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_animation_tree", { anim_player: "../Anim" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.anim_player).toBe("../Anim");
    const props = (godot.call as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "node.set_property")
      .map((c) => (c[1] as { property: string }).property);
    expect(props).toContain("anim_player");
    expect(props).toContain("active");
  });
});

describe("toolkit13 — Audio", () => {
  it("create_audio_stream_player_2d sets bus + volume + autoplay", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_audio_stream_player_2d", { bus: "SFX", volume_db: -6, autoplay: true }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.bus).toBe("SFX");
    expect(r.data.volume_db).toBe(-6);
    expect(nodeAddTypes(godot)).toContain("AudioStreamPlayer2D");
  });

  it("create_audio_stream_player_3d sets max_distance", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_audio_stream_player_3d", { max_distance: 100 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.max_distance).toBe(100);
    expect(nodeAddTypes(godot)).toContain("AudioStreamPlayer3D");
  });
});

describe("toolkit13 — Particles", () => {
  it("create_gpu_particles_2d defaults amount=32 emitting=true", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_gpu_particles_2d", {}) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.amount).toBe(32);
    expect(r.data.emitting).toBe(true);
    expect(nodeAddTypes(godot)).toContain("GPUParticles2D");
  });

  it("create_gpu_particles_3d accepts custom amount", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_gpu_particles_3d", { amount: 200 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.amount).toBe(200);
    expect(nodeAddTypes(godot)).toContain("GPUParticles3D");
  });
});

describe("toolkit13 — Shader", () => {
  it("create_shader writes canvas_item template by default", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit13Tools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_shader", { shader_path: "res://shaders/Tint.gdshader" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const content = await readFile(path.join(root, "shaders", "Tint.gdshader"), "utf8");
    expect(content).toContain("shader_type canvas_item");
    expect(content).toContain("uniform vec4 tint");
  });

  it("create_shader spatial template", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit13Tools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_shader", { shader_path: "res://shaders/Mat3D.gdshader", shader_type: "spatial" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const content = await readFile(path.join(root, "shaders", "Mat3D.gdshader"), "utf8");
    expect(content).toContain("shader_type spatial");
    expect(content).toContain("ALBEDO");
  });

  it("create_shader rejects non-.gdshader path", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit13Tools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_shader", { shader_path: "res://shaders/Bad.gd" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("INVALID_PARAMS");
  });

  it("assign_shader_material returns instructions and validates extension", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerToolkit13Tools(server as never, makeGodot(), makeConfig(false, root) as never);
    const ok = parse(await server.run("godot_assign_shader_material", { node_path: "Sprite2D", shader_path: "res://shaders/X.gdshader" }) as { content: Array<{ text: string }> });
    expect(ok.ok).toBe(true);
    expect(ok.data.instructions.length).toBeGreaterThan(0);

    const bad = parse(await server.run("godot_assign_shader_material", { node_path: "Sprite2D", shader_path: "res://shaders/X.txt" }) as { content: Array<{ text: string }> });
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe("INVALID_PARAMS");
  });
});

describe("toolkit13 — Navigation", () => {
  it("setup_navigation_region_2d adds NavigationRegion2D", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_navigation_region_2d", {}) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(nodeAddTypes(godot)).toContain("NavigationRegion2D");
  });

  it("setup_navigation_region_2d dry_run does not call plugin", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerToolkit13Tools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_setup_navigation_region_2d", { dry_run: true }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dry_run).toBe(true);
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
