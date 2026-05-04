import { describe, expect, it } from "vitest";

import {
  createErrorResponse,
  createJsonRpcRequest,
  createSuccessResponse,
  isJsonRpcResponse,
  normalizePluginResponse
} from "../src/godot/protocol";

describe("JSON-RPC protocol helpers", () => {
  it("creates JSON-RPC 2.0 requests with stable IDs", () => {
    const request = createJsonRpcRequest("system.ping", { value: "pong" }, "request-001");

    expect(request).toEqual({
      jsonrpc: "2.0",
      id: "request-001",
      method: "system.ping",
      params: { value: "pong" }
    });
  });

  it("detects valid JSON-RPC responses", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: "1", result: { ok: true } })).toBe(true);
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: "1", error: { code: "TIMEOUT" } })).toBe(true);
    expect(isJsonRpcResponse({ id: "1", result: {} })).toBe(false);
  });

  it("normalizes plugin success responses to the standard tool envelope", () => {
    const response = normalizePluginResponse({
      jsonrpc: "2.0",
      id: "1",
      result: createSuccessResponse({ connected: true }, "Connected.")
    });

    expect(response).toEqual({
      ok: true,
      data: { connected: true },
      message: "Connected.",
      warnings: [],
      suggestions: []
    });
  });

  it("normalizes JSON-RPC errors to actionable tool errors", () => {
    const response = normalizePluginResponse({
      jsonrpc: "2.0",
      id: "1",
      error: {
        code: "METHOD_NOT_FOUND",
        message: "Unknown method.",
        details: { method: "missing.method" },
        suggestions: ["Check the dispatcher method map."]
      }
    });

    expect(response).toEqual(
      createErrorResponse(
        "METHOD_NOT_FOUND",
        "Unknown method.",
        { method: "missing.method" },
        ["Check the dispatcher method map."]
      )
    );
  });
});
