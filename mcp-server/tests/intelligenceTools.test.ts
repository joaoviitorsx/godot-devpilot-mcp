import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildDependencyGraph,
  buildProjectSummary,
  buildSignalMap,
  checkConventions,
  classifyByExt,
  indexProject
} from "../src/indexer/projectIndexer";
import { registerIntelligenceTools } from "../src/tools/intelligenceTools";

function makeConfig(readOnly = false, projectRoot = "/fake/project") {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full",
    security: { readOnly },
    projectRoot
  };
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
  const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-intel-"));
  roots.push(r);
  return r;
}

async function setupSampleProject(root: string): Promise<void> {
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "scenes"), { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "project.godot"), '[application]\nrun/main_scene="res://scenes/Main.tscn"\n', "utf8");
  await writeFile(path.join(root, "scripts", "Player.gd"),
    `extends CharacterBody2D\n\nconst Bullet = preload("res://scripts/Bullet.gd")\nfunc _ready():\n\tvar enemy = load("res://scripts/Enemy.gd")\n`, "utf8");
  await writeFile(path.join(root, "scripts", "Bullet.gd"), `extends Node2D\n`, "utf8");
  await writeFile(path.join(root, "scripts", "Enemy.gd"), `extends CharacterBody2D\n`, "utf8");
  await writeFile(path.join(root, "scenes", "Main.tscn"),
    `[gd_scene format=3]\n\n[ext_resource path="res://scripts/Player.gd" type="Script"]\n\n[node name="Main" type="Node2D"]\n[node name="Player" type="CharacterBody2D" parent="."]\n[connection signal="health_changed" from="Player" to="Main" method="_on_player_health_changed"]\n`,
    "utf8");
  await writeFile(path.join(root, "assets", "BadName.png"), "fake-png-bytes", "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("projectIndexer helpers", () => {
  it("classifyByExt classifies common files correctly", () => {
    expect(classifyByExt("X.tscn")).toBe("scene");
    expect(classifyByExt("X.gd")).toBe("script");
    expect(classifyByExt("X.tres")).toBe("resource");
    expect(classifyByExt("X.png")).toBe("asset");
    expect(classifyByExt("X.md")).toBe("other");
  });

  it("indexProject ignores .godot and .godot_mcp", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    await mkdir(path.join(root, ".godot", "imported"), { recursive: true });
    await writeFile(path.join(root, ".godot", "imported", "x.png"), "x", "utf8");
    const files = await indexProject(root);
    const fromGodotDir = files.find((f) => f.res_path.startsWith("res://.godot/"));
    expect(fromGodotDir).toBeUndefined();
  });

  it("buildProjectSummary returns counts and main_scene", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const summary = await buildProjectSummary(root);
    expect(summary.scripts).toBeGreaterThanOrEqual(3);
    expect(summary.scenes).toBe(1);
    expect(summary.assets).toBe(1);
    expect(summary.main_scene).toBe("res://scenes/Main.tscn");
  });

  it("buildDependencyGraph captures preload, load, and scene ext_resource", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const graph = await buildDependencyGraph(root);
    const kinds = graph.edges.map((e) => e.kind);
    expect(kinds).toContain("preload");
    expect(kinds).toContain("load");
    expect(kinds).toContain("scene_resource");
  });

  it("buildSignalMap parses connection lines from .tscn", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const signals = await buildSignalMap(root);
    expect(signals).toHaveLength(1);
    expect(signals[0].signal).toBe("health_changed");
    expect(signals[0].from).toBe("Player");
    expect(signals[0].to).toBe("Main");
  });

  it("checkConventions flags BadName.png asset", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const files = await indexProject(root);
    const violations = checkConventions(files);
    expect(violations.some((v) => v.res_path.includes("BadName.png"))).toBe(true);
  });
});

describe("registerIntelligenceTools", () => {
  it("godot_project_summary returns summary", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_project_summary") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.summary.main_scene).toBe("res://scenes/Main.tscn");
  });

  it("godot_build_dependency_graph caches to .godot_mcp/intel/dependency_graph.json", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_build_dependency_graph") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.edge_count).toBeGreaterThan(0);
  });

  it("godot_get_dependency_graph builds when no cache", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_get_dependency_graph", { rebuild: true }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.graph.edges.length).toBeGreaterThan(0);
  });

  it("godot_impact_check rename_signal returns affected scenes", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_impact_check", {
      change_type: "rename_signal",
      target: "health_changed",
      new_value: "player_health_changed"
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.affected_signals.length).toBe(1);
    expect(result.data.impact_level).not.toBe("none");
  });

  it("godot_impact_check delete_file flags dependents", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_impact_check", {
      change_type: "delete_file",
      target: "res://scripts/Bullet.gd"
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.affected_files).toContain("res://scripts/Player.gd");
  });

  it("godot_trace_flow finds path from Player to Bullet", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_trace_flow", {
      from: "res://scripts/Player.gd",
      to: "res://scripts/Bullet.gd"
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.reachable).toBe(true);
  });

  it("godot_detect_gameplay_systems detects player + enemy buckets", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_detect_gameplay_systems") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.systems_detected).toContain("player");
    expect(result.data.systems_detected).toContain("enemy");
  });

  it("godot_analyze_architecture returns hubs and signals counts", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_analyze_architecture") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.signal_connections).toBe(1);
  });

  it("godot_validate_conventions reports BadName violation", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_validate_conventions") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBeGreaterThan(0);
  });

  it("read-only blocks build_dependency_graph but allows summary", async () => {
    const root = await makeRoot();
    await setupSampleProject(root);
    const server = makeServer();
    registerIntelligenceTools(server as never, makeConfig(true, root) as never);

    const summary = parse(await server.run("godot_project_summary") as { content: Array<{ text: string }> });
    expect(summary.ok).toBe(true);

    const blocked = parse(await server.run("godot_build_dependency_graph") as { content: Array<{ text: string }> });
    expect(blocked.ok).toBe(false);
    expect(blocked.error.code).toBe("READ_ONLY_MODE");
  });
});
