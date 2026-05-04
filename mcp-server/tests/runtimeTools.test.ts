import { describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import { registerRuntimeTools } from "../src/tools/runtimeTools";

function makeConfig(readOnly = false, projectRoot = "/fake/project") {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full",
    security: { readOnly },
    projectRoot
  };
}

function makeGodot(callImpl?: (method: string, params: unknown) => unknown): GodotClient {
  const fn = vi.fn().mockImplementation((m: string, p: unknown) =>
    Promise.resolve(callImpl ? callImpl(m, p) : { ok: true, data: {}, message: "ok", warnings: [], suggestions: [] })
  );
  return {
    getStatus: vi.fn().mockReturnValue({ connected: true }),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    call: fn
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

describe("registerRuntimeTools — read-only", () => {
  const readOnly: string[] = [
    "godot_get_runtime_tree",
    "godot_get_runtime_node_properties",
    "godot_get_fps",
    "godot_get_process_stats",
    "godot_find_runtime_node",
    "godot_get_current_camera",
    "godot_find_ui_element"
  ];
  for (const tool of readOnly) {
    it(`${tool} is allowed in read-only`, async () => {
      const server = makeServer();
      registerRuntimeTools(server as never, makeGodot(), makeConfig(true) as never);
      const args: Record<string, unknown> =
        tool === "godot_get_runtime_node_properties" ? { node_path: "Player" } :
        tool === "godot_find_runtime_node" ? { name: "Player" } :
        tool === "godot_find_ui_element" ? { text: "Start" } :
        {};
      const result = parse(await server.run(tool, args) as { content: Array<{ text: string }> });
      expect(result.ok).toBe(true);
    });
  }

  it("godot_set_runtime_node_property blocked in read-only", async () => {
    const server = makeServer();
    registerRuntimeTools(server as never, makeGodot(), makeConfig(true) as never);
    const result = parse(await server.run("godot_set_runtime_node_property", { node_path: "Player", property: "position", value: { x: 0, y: 0 } }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("READ_ONLY_MODE");
  });

  it("godot_click_ui_by_text blocked in read-only", async () => {
    const server = makeServer();
    registerRuntimeTools(server as never, makeGodot(), makeConfig(true) as never);
    const result = parse(await server.run("godot_click_ui_by_text", { text: "Start" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("READ_ONLY_MODE");
  });
});

describe("registerRuntimeTools — delegation", () => {
  it("get_runtime_tree calls runtime.get_tree with defaults", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerRuntimeTools(server as never, godot, makeConfig(false) as never);
    await server.run("godot_get_runtime_tree", {});
    const call = (godot.call as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("runtime.get_tree");
    expect(call[1]).toEqual({ max_depth: 10, include_properties: false });
  });

  it("set_runtime_node_property calls runtime.set_node_property", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerRuntimeTools(server as never, godot, makeConfig(false) as never);
    await server.run("godot_set_runtime_node_property", { node_path: "Player", property: "position", value: { x: 1, y: 2 } });
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("runtime.set_node_property");
  });

  it("get_fps calls runtime.get_fps", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerRuntimeTools(server as never, godot, makeConfig(false) as never);
    await server.run("godot_get_fps");
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("runtime.get_fps");
  });

  it("find_runtime_node rejects when no filter", async () => {
    const server = makeServer();
    registerRuntimeTools(server as never, makeGodot(), makeConfig(false) as never);
    const result = parse(await server.run("godot_find_runtime_node", {}) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_PARAMS");
  });

  it("find_ui_element rejects when no filter", async () => {
    const server = makeServer();
    registerRuntimeTools(server as never, makeGodot(), makeConfig(false) as never);
    const result = parse(await server.run("godot_find_ui_element", {}) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_PARAMS");
  });
});

describe("registerRuntimeTools — wait_for_condition", () => {
  it("matches immediately when value already correct", async () => {
    const godot = makeGodot(() => ({ ok: true, data: { properties: { health: 50 } }, message: "", warnings: [], suggestions: [] }));
    const server = makeServer();
    registerRuntimeTools(server as never, godot, makeConfig(false) as never);
    const result = parse(await server.run("godot_wait_for_condition", {
      node_path: "Player",
      property: "health",
      expected_value: 50,
      timeout_ms: 1000,
      poll_interval_ms: 100
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.matched).toBe(true);
  });

  it("times out when value never matches", async () => {
    const godot = makeGodot(() => ({ ok: true, data: { properties: { health: 100 } }, message: "", warnings: [], suggestions: [] }));
    const server = makeServer();
    registerRuntimeTools(server as never, godot, makeConfig(false) as never);
    const result = parse(await server.run("godot_wait_for_condition", {
      node_path: "Player",
      property: "health",
      expected_value: 0,
      timeout_ms: 300,
      poll_interval_ms: 100
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("WAIT_TIMEOUT");
  });

  it("propagates plugin error from poll", async () => {
    const godot = makeGodot(() => ({ ok: false, error: { code: "RUNTIME_NOT_RUNNING", message: "no run", details: {}, suggestions: [] } }));
    const server = makeServer();
    registerRuntimeTools(server as never, godot, makeConfig(false) as never);
    const result = parse(await server.run("godot_wait_for_condition", {
      node_path: "Player",
      property: "health",
      expected_value: 0
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("RUNTIME_NOT_RUNNING");
  });
});
