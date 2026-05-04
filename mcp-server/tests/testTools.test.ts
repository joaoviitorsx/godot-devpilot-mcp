import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import { registerTestTools } from "../src/tools/testTools";

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
  const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-test-tools-"));
  roots.push(r);
  return r;
}

function makePng(width: number, fill: number = 0): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const len = Buffer.alloc(4); len.writeUInt32BE(13);
  const type = Buffer.from("IHDR");
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0); data.writeUInt32BE(width, 4);
  data[8] = 8; data[9] = 6;
  const crc = Buffer.alloc(4);
  return Buffer.concat([sig, len, type, data, crc, Buffer.alloc(8, fill)]);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("testTools — assertions", () => {
  it("assert_node_exists passes when plugin returns ok", async () => {
    const server = makeServer();
    registerTestTools(server as never, makeGodot(), makeConfig(false) as never);
    const r = parse(await server.run("godot_assert_node_exists", { node_path: "Player" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.passed).toBe(true);
  });

  it("assert_node_exists fails when plugin returns error", async () => {
    const godot = makeGodot(() => ({ ok: false, error: { code: "NODE_NOT_FOUND", message: "x", details: {}, suggestions: [] } }));
    const server = makeServer();
    registerTestTools(server as never, godot, makeConfig(false) as never);
    const r = parse(await server.run("godot_assert_node_exists", { node_path: "Ghost" }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("ASSERTION_FAILED");
  });

  it("assert_property_equals passes when value matches", async () => {
    const godot = makeGodot(() => ({ ok: true, data: { properties: { health: 100 } }, message: "ok", warnings: [], suggestions: [] }));
    const server = makeServer();
    registerTestTools(server as never, godot, makeConfig(false) as never);
    const r = parse(await server.run("godot_assert_property_equals", { node_path: "Player", property: "health", expected_value: 100 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
  });

  it("assert_property_equals fails on mismatch", async () => {
    const godot = makeGodot(() => ({ ok: true, data: { properties: { health: 50 } }, message: "ok", warnings: [], suggestions: [] }));
    const server = makeServer();
    registerTestTools(server as never, godot, makeConfig(false) as never);
    const r = parse(await server.run("godot_assert_property_equals", { node_path: "Player", property: "health", expected_value: 100 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("ASSERTION_FAILED");
  });

  it("assert_screenshot_matches passes for identical files", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, ".godot_mcp/screenshots"), { recursive: true });
    const png = makePng(8, 0xff);
    await writeFile(path.join(root, ".godot_mcp/screenshots/a.png"), png);
    await writeFile(path.join(root, ".godot_mcp/screenshots/b.png"), png);
    const server = makeServer();
    registerTestTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_assert_screenshot_matches", {
      reference_path: "res://.godot_mcp/screenshots/a.png",
      candidate_path: "res://.godot_mcp/screenshots/b.png"
    }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
  });

  it("assert_screenshot_matches fails when above threshold", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, ".godot_mcp/screenshots"), { recursive: true });
    await writeFile(path.join(root, ".godot_mcp/screenshots/a.png"), makePng(8, 0xff));
    await writeFile(path.join(root, ".godot_mcp/screenshots/b.png"), makePng(8, 0x00));
    const server = makeServer();
    registerTestTools(server as never, makeGodot(), makeConfig(false, root) as never);
    const r = parse(await server.run("godot_assert_screenshot_matches", {
      reference_path: "res://.godot_mcp/screenshots/a.png",
      candidate_path: "res://.godot_mcp/screenshots/b.png",
      max_byte_diff: 0
    }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("ASSERTION_FAILED");
  });

  it("run_test_scenario aggregates pass/fail", async () => {
    const callImpl = (_m: string, p: unknown) => {
      const params = p as Record<string, unknown>;
      if (params.node_path === "Player") {
        return { ok: true, data: { properties: { health: 100 } }, message: "ok", warnings: [], suggestions: [] };
      }
      return { ok: false, error: { code: "NODE_NOT_FOUND", message: "no", details: {}, suggestions: [] } };
    };
    const server = makeServer();
    registerTestTools(server as never, makeGodot(callImpl), makeConfig(false) as never);
    const r = parse(await server.run("godot_run_test_scenario", {
      steps: [
        { name: "player exists", type: "assert_node_exists", params: { node_path: "Player" } },
        { name: "ghost missing", type: "assert_node_exists", params: { node_path: "Ghost" } },
        { name: "health ok", type: "assert_property_equals", params: { node_path: "Player", property: "health", expected_value: 100 } }
      ]
    }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.total).toBe(3);
    expect(r.data.passed).toBe(2);
    expect(r.data.failed).toBe(1);
  });
});

describe("testTools — Phase 14 expansion", () => {
  it("create_test_scenario writes JSON file", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-test-scenario-"));
    try {
      const server = makeServer();
      registerTestTools(server as never, makeGodot(), makeConfig(false, root) as never);
      const r = parse(await server.run("godot_create_test_scenario", {
        name: "boot",
        description: "Verifies Player exists at boot.",
        steps: [{ name: "player exists", type: "assert_node_exists", params: { node_path: "Player" } }]
      }) as { content: Array<{ text: string }> });
      expect(r.ok).toBe(true);
      const content = await readFile(r.data.path, "utf8");
      expect(content).toContain("Verifies Player exists");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("create_test_scenario blocks overwrite without flag", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-test-scenario-"));
    try {
      const server = makeServer();
      registerTestTools(server as never, makeGodot(), makeConfig(false, root) as never);
      await server.run("godot_create_test_scenario", { name: "x", steps: [{ name: "s", type: "assert_node_exists", params: { node_path: "P" } }] });
      const second = parse(await server.run("godot_create_test_scenario", { name: "x", steps: [{ name: "s", type: "assert_node_exists", params: { node_path: "P" } }] }) as { content: Array<{ text: string }> });
      expect(second.ok).toBe(false);
      expect(second.error.code).toBe("FILE_ALREADY_EXISTS");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stress_test_scene returns latency stats and aggregates errors", async () => {
    let n = 0;
    const godot = makeGodot(() => {
      n++;
      return n === 2
        ? { ok: false, error: { code: "X", message: "y", details: {}, suggestions: [] } }
        : { ok: true, data: { fps: 60 }, message: "ok", warnings: [], suggestions: [] };
    });
    const server = makeServer();
    registerTestTools(server as never, godot, makeConfig(false) as never);
    const r = parse(await server.run("godot_stress_test_scene", { iterations: 5, delay_ms: 0 }) as { content: Array<{ text: string }> });
    expect(r.ok).toBe(true);
    expect(r.data.iterations_completed).toBeGreaterThan(0);
    expect(r.data.errors.length).toBe(1);
    expect(r.data.avg_ms).toBeGreaterThanOrEqual(0);
  });

  it("generate_regression_test snapshots tree and writes scenario", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-regression-"));
    try {
      const godot = makeGodot((m) =>
        m === "runtime.get_tree"
          ? { ok: true, data: { tree: { children: [{ path: "/root/Main/Player" }, { path: "/root/Main/HUD" }] } }, message: "", warnings: [], suggestions: [] }
          : { ok: true, data: {}, message: "", warnings: [], suggestions: [] }
      );
      const server = makeServer();
      registerTestTools(server as never, godot, makeConfig(false, root) as never);
      const r = parse(await server.run("godot_generate_regression_test", { name: "boot" }) as { content: Array<{ text: string }> });
      expect(r.ok).toBe(true);
      expect(r.data.captured_paths).toEqual(["/root/Main/Player", "/root/Main/HUD"]);
      const content = await readFile(r.data.path, "utf8");
      expect(content).toContain("assert_node_exists");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
