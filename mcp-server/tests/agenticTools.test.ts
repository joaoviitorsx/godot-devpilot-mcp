import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import { registerAgenticTools } from "../src/tools/agenticTools";

function makeConfig(readOnly = false, projectRoot = "/fake/project") {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full",
    security: { readOnly },
    projectRoot
  };
}

function makeGodot(callImpl?: (m: string, p: unknown) => unknown): GodotClient {
  return {
    getStatus: vi.fn().mockReturnValue({ connected: true }),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    call: vi.fn().mockImplementation((m: string, p: unknown) =>
      Promise.resolve(callImpl ? callImpl(m, p) : { ok: true, data: {}, message: "ok", warnings: [], suggestions: [] })
    )
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
  const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-agentic-"));
  roots.push(r);
  // Minimal project marker
  await writeFile(path.join(r, "project.godot"), "[application]\n", "utf8");
  return r;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("agentic — build_feature", () => {
  it("dry_run by default returns plan", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_build_feature", { feature_name: "PlayerHUD", kind: "scene_with_script" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dry_run).toBe(true);
    expect(r.data.planned_changes.length).toBeGreaterThan(0);
  });

  it("script_only kind skips scene steps", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_build_feature", { feature_name: "Util", kind: "script_only" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.planned_changes.some((c: string) => c.includes("Create scene"))).toBe(false);
  });

  it("dry_run=false executes RPC plan", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerAgenticTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_build_feature", { feature_name: "X", kind: "scene_with_script", dry_run: false }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.executed_steps).toBeGreaterThan(0);
    const methods = (godot.call as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(methods).toContain("scene.create");
    expect(methods).toContain("script.create");
  });
});

describe("agentic — gameplay_system", () => {
  it("health_hud preset adds CanvasLayer + Control + Label (dry_run)", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_gameplay_system", { system: "health_hud" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dry_run).toBe(true);
    expect(r.data.planned_changes).toContain("CanvasLayer HUD");
    expect(r.data.planned_changes).toContain("Health Label");
  });

  it("collectible_swarm creates 5 markers when executed", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerAgenticTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_gameplay_system", { system: "collectible_swarm", dry_run: false }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.executed_steps).toBe(5);
  });
});

describe("agentic — refactor_safely", () => {
  it("returns impact and never auto-renames (dry_run)", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts/Player.gd"), 'extends Node\nconst X = preload("res://scripts/Bullet.gd")\n', "utf8");
    await writeFile(path.join(root, "scripts/Bullet.gd"), "extends Node\n", "utf8");
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_refactor_safely", { change_type: "delete_file", target: "res://scripts/Bullet.gd" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.affected_files).toContain("res://scripts/Player.gd");
    expect(r.data.applied).toBe(false);
  });

  it("dry_run=false stays manual (no auto-rename)", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_refactor_safely", { change_type: "rename_file", target: "res://x.gd", dry_run: false }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.applied).toBe(false);
    expect(r.data.note).toContain("intentionally left manual");
  });
});

describe("agentic — generate_scene_from_prompt", () => {
  it("maps tags to node.add steps (dry_run)", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_generate_scene_from_prompt", { scene_name: "Lab", tags: ["player", "camera2d", "hud"], dimension: "2d" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const planned = r.data.planned_changes.join("\n");
    expect(planned).toContain("Player");
    expect(planned).toContain("Camera2D");
    expect(planned).toContain("HUD");
  });

  it("3d dimension adds DirectionalLight3D when light tag present", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_generate_scene_from_prompt", { scene_name: "World3D", tags: ["light", "camera3d"], dimension: "3d" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const planned = r.data.planned_changes.join("\n");
    expect(planned).toContain("DirectionalLight3D");
  });
});

describe("agentic — playable_prototype", () => {
  it("dry_run returns scene plan", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_playable_prototype", { name: "Demo", dimension: "2d" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.dry_run).toBe(true);
  });
});

describe("agentic — run_validation_loop", () => {
  it("starts main scene, waits, stops, returns report", async () => {
    const root = await makeRoot();
    const calls: string[] = [];
    const godot = makeGodot((m) => { calls.push(m); return { ok: true, data: { running: m.startsWith("debug.run") }, message: "", warnings: [], suggestions: [] }; });
    const server = makeServer();
    registerAgenticTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_run_validation_loop", { hold_ms: 0 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(calls).toContain("debug.run_project");
    expect(calls).toContain("debug.stop_project");
  });

  it("uses scene.run when scene_path provided", async () => {
    const root = await makeRoot();
    const calls: string[] = [];
    const godot = makeGodot((m) => { calls.push(m); return { ok: true, data: {}, message: "", warnings: [], suggestions: [] }; });
    const server = makeServer();
    registerAgenticTools(server as never, godot, makeConfig(false, root) as never);
    const r = parse(await server.run("godot_run_validation_loop", { hold_ms: 0, scene_path: "res://test.tscn" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(calls).toContain("debug.run_scene");
  });
});

describe("agentic — game_jam_prototype", () => {
  it("3d prototype dry_run includes light + WorldEnvironment", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_game_jam_prototype", { name: "JamGame", dimension: "3d" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    const plan = r.data.planned_changes.join("\n");
    expect(plan).toContain("WorldEnvironment");
    expect(plan).toContain("DirectionalLight3D");
  });

  it("include_hud=false skips HUD", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_create_game_jam_prototype", { name: "JamGame", dimension: "2d", include_hud: false }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.planned_changes.join("\n")).not.toContain("HUD");
  });
});

describe("agentic — explain_project_architecture", () => {
  it("returns markdown report and is read-only allowed", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(true, root) as never);
    const r = parse(await server.run("godot_explain_project_architecture") as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.report).toContain("# Project Architecture");
  });
});

describe("agentic — prepare_release_checklist", () => {
  it("writes checklist and reports passed/failed counts", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_prepare_release_checklist") as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.total).toBeGreaterThan(0);
    const written = await readFile(r.data.written_to, "utf8");
    expect(written).toContain("# Release Checklist");
  });

  it("write_report=false skips file write", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_prepare_release_checklist", { write_report: false }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.written_to).toBeNull();
  });
});

describe("agentic — fix_errors_agentic", () => {
  it("returns recommended loop steps (read-only allowed)", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerAgenticTools(server as never, makeGodot(), makeConfig(true, root) as never);
    const r = parse(await server.run("godot_fix_errors_agentic") as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.primary_tool).toBe("godot_fix_errors");
    expect(r.data.recommended_loop.length).toBe(5);
  });
});
