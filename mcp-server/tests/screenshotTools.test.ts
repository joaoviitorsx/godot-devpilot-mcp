import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import { compareScreenshotFiles, registerScreenshotTools } from "../src/tools/screenshotTools";

function makeConfig(readOnly = false, projectRoot = "/fake/project") {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full",
    security: { readOnly },
    projectRoot
  };
}

function makeGodot(callResult: unknown = { ok: true, data: { path: "x.png", width: 1, height: 1 }, message: "" }): GodotClient {
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

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-screenshot-tools-"));
  roots.push(r);
  return r;
}

// Minimal valid PNG: 8-byte signature + IHDR chunk with width/height
function makePng(width: number, height: number, fill: number = 0): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13);
  const ihdrType = Buffer.from("IHDR");
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 6; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const ihdrCrc = Buffer.alloc(4); ihdrCrc.writeUInt32BE(0);
  const filler = Buffer.alloc(16, fill);
  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, ihdrCrc, filler]);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("compareScreenshotFiles", () => {
  it("identifies identical files", async () => {
    const root = await makeRoot();
    const png = makePng(10, 10, 0xff);
    await writeFile(path.join(root, "a.png"), png);
    await writeFile(path.join(root, "b.png"), png);
    const result = await compareScreenshotFiles(path.join(root, "a.png"), path.join(root, "b.png"));
    expect(result.identical).toBe(true);
    expect(result.byte_diff_count).toBe(0);
    expect(result.dimensions_a).toEqual({ width: 10, height: 10 });
  });

  it("identifies different files", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "a.png"), makePng(10, 10, 0xff));
    await writeFile(path.join(root, "b.png"), makePng(10, 10, 0x00));
    const result = await compareScreenshotFiles(path.join(root, "a.png"), path.join(root, "b.png"));
    expect(result.identical).toBe(false);
    expect(result.byte_diff_count).toBeGreaterThan(0);
  });

  it("reports different dimensions", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "a.png"), makePng(10, 10));
    await writeFile(path.join(root, "b.png"), makePng(20, 20));
    const result = await compareScreenshotFiles(path.join(root, "a.png"), path.join(root, "b.png"));
    expect(result.dimensions_a).toEqual({ width: 10, height: 10 });
    expect(result.dimensions_b).toEqual({ width: 20, height: 20 });
    expect(result.identical).toBe(false);
  });
});

describe("registerScreenshotTools — read-only behavior", () => {
  it("godot_take_game_screenshot is blocked in read-only mode", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerScreenshotTools(server as never, makeGodot(), makeConfig(true, root) as never);

    const result = parse(await server.run("godot_take_game_screenshot") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("READ_ONLY_MODE");
  });

  it("godot_take_editor_screenshot is blocked in read-only mode", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerScreenshotTools(server as never, makeGodot(), makeConfig(true, root) as never);

    const result = parse(await server.run("godot_take_editor_screenshot") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("READ_ONLY_MODE");
  });

  it("godot_compare_screenshots is allowed in read-only mode", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, ".godot_mcp", "screenshots"), { recursive: true });
    await writeFile(path.join(root, ".godot_mcp", "screenshots", "a.png"), makePng(5, 5));
    await writeFile(path.join(root, ".godot_mcp", "screenshots", "b.png"), makePng(5, 5));

    const server = makeServer();
    registerScreenshotTools(server as never, makeGodot(), makeConfig(true, root) as never);

    const result = parse(await server.run("godot_compare_screenshots", {
      path_a: "res://.godot_mcp/screenshots/a.png",
      path_b: "res://.godot_mcp/screenshots/b.png"
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.identical).toBe(true);
  });
});

describe("registerScreenshotTools — capture", () => {
  it("godot_take_game_screenshot delegates to plugin via screenshot.take_game", async () => {
    const root = await makeRoot();
    const godot = makeGodot({ ok: true, data: { path: "res://.godot_mcp/screenshots/game_x.png", width: 1280, height: 720 }, message: "Screenshot saved." });
    const server = makeServer();
    registerScreenshotTools(server as never, godot, makeConfig(false, root) as never);

    const result = parse(await server.run("godot_take_game_screenshot", { output_path: "res://.godot_mcp/screenshots/game_x.png" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("screenshot.take_game");
  });

  it("godot_take_editor_screenshot rejects non-png paths", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerScreenshotTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_take_editor_screenshot", { output_path: "res://.godot_mcp/screenshots/foo.txt" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_PARAMS");
  });

  it("godot_take_game_screenshot rejects path outside res://", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerScreenshotTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_take_game_screenshot", { output_path: "/etc/passwd.png" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("PATH_OUTSIDE_PROJECT");
  });

  it("godot_get_viewport_image delegates to screenshot.get_viewport", async () => {
    const root = await makeRoot();
    const godot = makeGodot();
    const server = makeServer();
    registerScreenshotTools(server as never, godot, makeConfig(false, root) as never);

    await server.run("godot_get_viewport_image", { output_path: "res://.godot_mcp/screenshots/v.png" });
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("screenshot.get_viewport");
  });
});

describe("registerScreenshotTools — compare error cases", () => {
  it("returns SCREENSHOT_NOT_FOUND when files missing", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerScreenshotTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_compare_screenshots", {
      path_a: "res://nope_a.png",
      path_b: "res://nope_b.png"
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("SCREENSHOT_NOT_FOUND");
  });

  it("rejects non-png inputs", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerScreenshotTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_compare_screenshots", {
      path_a: "res://a.txt",
      path_b: "res://b.txt"
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_PARAMS");
  });
});
