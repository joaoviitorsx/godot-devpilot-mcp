import { describe, expect, it } from "vitest";

import { calculateReconnectDelayMs } from "../src/godot/client";

describe("calculateReconnectDelayMs", () => {
  it("uses capped exponential backoff for reconnect attempts", () => {
    const reconnect = {
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 5000
    };

    expect(calculateReconnectDelayMs(reconnect, 0)).toBe(500);
    expect(calculateReconnectDelayMs(reconnect, 1)).toBe(1000);
    expect(calculateReconnectDelayMs(reconnect, 2)).toBe(2000);
    expect(calculateReconnectDelayMs(reconnect, 3)).toBe(4000);
    expect(calculateReconnectDelayMs(reconnect, 4)).toBe(5000);
    expect(calculateReconnectDelayMs(reconnect, 10)).toBe(5000);
  });
});
