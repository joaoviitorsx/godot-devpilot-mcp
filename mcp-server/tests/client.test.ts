import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

import { GodotClient } from "../src/godot/client";

describe("GodotClient", () => {
  it("reports disconnected status before a socket is opened", () => {
    const client = new GodotClient({
      host: "127.0.0.1",
      port: 6505,
      timeoutMs: 25,
      reconnect: { enabled: true, initialDelayMs: 50, maxDelayMs: 1000 }
    });

    expect(client.getStatus()).toMatchObject({
      connected: false,
      host: "127.0.0.1",
      port: 6505,
      pendingRequests: 0
    });
  });

  it("returns a standardized error instead of throwing when not connected", async () => {
    const client = new GodotClient({
      host: "127.0.0.1",
      port: 6505,
      timeoutMs: 25,
      reconnect: { enabled: false, initialDelayMs: 50, maxDelayMs: 1000 }
    });

    await client.disconnect();
    const response = await client.call("system.ping", {});

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("GODOT_NOT_CONNECTED");
      expect(response.error.suggestions.length).toBeGreaterThan(0);
    }
  });

  it("authenticates and rejects a bridge for another project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "devpilot-bridge-"));
    await mkdir(path.join(root, ".godot_mcp"));
    const token = "a".repeat(64);
    await writeFile(path.join(root, ".godot_mcp", "bridge-token"), token);
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const received: Array<Record<string, unknown>> = [];
    server.on("connection", (socket) => socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(request);
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: true, data: { project_path: path.join(root, "other"), plugin_version: "2.6.0", protocol_version: "1.0.0" }, message: "ok" } }));
    }));
    const client = new GodotClient({ host: "127.0.0.1", port: address.port, timeoutMs: 1000, reconnect: { enabled: false, initialDelayMs: 50, maxDelayMs: 1000 } }, { projectRoot: root, pluginVersion: "2.6.0", protocolVersion: "1.0.0" });
    try {
      const [result, second] = await Promise.all([client.connect(), client.connect()]);
      expect(result.ok).toBe(false);
      expect(second.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("BRIDGE_MISMATCH");
      expect(received[0].auth).toBe(token);
      expect(received[0].method).toBe("system.health_check");
      expect(received).toHaveLength(1);
      expect(client.getStatus().connected).toBe(false);
    } finally {
      await client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
