import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/config";
import { buildCapabilitiesPayload } from "../src/tools/coreTools";

describe("buildCapabilitiesPayload", () => {
  it("combines server capabilities with plugin capabilities when available", () => {
    const config = loadConfig({});
    const payload = buildCapabilitiesPayload(
      config,
      {
        connected: true,
        host: "127.0.0.1",
        port: 6505,
        url: "ws://127.0.0.1:6505",
        pendingRequests: 0,
        lastConnectedAt: "2026-05-03T00:00:00.000Z",
        lastDisconnectedAt: null
      },
      {
        available_methods: ["system.health_check", "system.ping"],
        plugin_version: "0.1.0",
        protocol_version: "1.0.0"
      }
    );

    expect(payload.mode).toBe("core");
    expect(payload.security).toEqual({ read_only: true });
    expect(payload.tools).toContain("godot_health_check");
    expect(payload.plugin).toEqual({
      available_methods: ["system.health_check", "system.ping"],
      plugin_version: "0.1.0",
      protocol_version: "1.0.0"
    });
  });

  it("represents unavailable plugin capabilities explicitly", () => {
    const config = loadConfig({});
    const payload = buildCapabilitiesPayload(config, {
      connected: false,
      host: "127.0.0.1",
      port: 6505,
      url: "ws://127.0.0.1:6505",
      pendingRequests: 0,
      lastConnectedAt: null,
      lastDisconnectedAt: null
    });

    expect(payload.plugin).toBeNull();
  });
});
