import { describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import { registerInputTools } from "../src/tools/inputTools";

function makeConfig(readOnly = false, projectRoot = "/fake/project") {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full",
    security: { readOnly },
    projectRoot
  };
}

function makeGodot(callResult: unknown = { ok: true, data: {}, message: "ok" }): GodotClient {
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

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe("registerInputTools — read-only blocks every input tool", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["godot_press_action", { action: "jump" }],
    ["godot_release_action", { action: "jump" }],
    ["godot_press_key", { keycode: "Space" }],
    ["godot_release_key", { keycode: "Space" }],
    ["godot_tap_key", { keycode: "Space" }],
    ["godot_mouse_move", { x: 10, y: 20 }],
    ["godot_mouse_click", { x: 10, y: 20 }],
    ["godot_mouse_drag", { from_x: 0, from_y: 0, to_x: 100, to_y: 100 }],
    ["godot_run_input_sequence", { sequence: [{ type: "action_press", action: "jump" }] }]
  ];

  for (const [tool, args] of cases) {
    it(`${tool} blocked in read-only`, async () => {
      const server = makeServer();
      registerInputTools(server as never, makeGodot(), makeConfig(true) as never);
      const result = parse(await server.run(tool, args) as { content: Array<{ text: string }> });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("READ_ONLY_MODE");
    });
  }
});

describe("registerInputTools — delegation to plugin methods", () => {
  it("godot_press_action calls input.press_action with action and duration_ms", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    await server.run("godot_press_action", { action: "jump", duration_ms: 250 });
    const call = (godot.call as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("input.press_action");
    expect(call[1]).toEqual({ action: "jump", duration_ms: 250 });
  });

  it("godot_press_action defaults duration_ms to 0", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    await server.run("godot_press_action", { action: "jump" });
    const call = (godot.call as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toEqual({ action: "jump", duration_ms: 0 });
  });

  it("godot_release_action calls input.release_action", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    await server.run("godot_release_action", { action: "jump" });
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("input.release_action");
  });

  it("godot_press_key calls input.press_key", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    await server.run("godot_press_key", { keycode: "Space", duration_ms: 100 });
    const call = (godot.call as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("input.press_key");
    expect(call[1]).toEqual({ keycode: "Space", duration_ms: 100 });
  });

  it("godot_tap_key calls input.tap_key", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    await server.run("godot_tap_key", { keycode: "Enter" });
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("input.tap_key");
  });

  it("godot_mouse_move forwards x and y", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    await server.run("godot_mouse_move", { x: 100, y: 200 });
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({ x: 100, y: 200 });
  });

  it("godot_mouse_click defaults button to left", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    await server.run("godot_mouse_click", { x: 50, y: 60 });
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({ x: 50, y: 60, button: "left" });
  });

  it("godot_mouse_drag accepts custom button", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    await server.run("godot_mouse_drag", { from_x: 0, from_y: 0, to_x: 100, to_y: 100, button: "right" });
    const call = (godot.call as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("input.mouse_drag");
    expect(call[1].button).toBe("right");
  });

  it("godot_run_input_sequence forwards sequence array", async () => {
    const godot = makeGodot();
    const server = makeServer();
    registerInputTools(server as never, godot, makeConfig(false) as never);

    const sequence = [
      { type: "action_press", action: "move_right", duration_ms: 500 },
      { type: "wait", duration_ms: 100 },
      { type: "key_tap", keycode: "Space" },
      { type: "mouse_click", x: 10, y: 20, button: "left" }
    ];

    await server.run("godot_run_input_sequence", { sequence });
    const call = (godot.call as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("input.run_sequence");
    expect(call[1].sequence).toEqual(sequence);
  });
});
