import { describe, expect, it } from "vitest";

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
});
