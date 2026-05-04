import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

const MOUSE_BUTTON = z.enum(["left", "right", "middle"]).describe("Mouse button to simulate.");

const SEQUENCE_STEP = z.discriminatedUnion("type", [
  z.object({ type: z.literal("action_press"), action: z.string(), duration_ms: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("action_release"), action: z.string() }),
  z.object({ type: z.literal("key_press"), keycode: z.string(), duration_ms: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("key_release"), keycode: z.string() }),
  z.object({ type: z.literal("key_tap"), keycode: z.string() }),
  z.object({ type: z.literal("mouse_move"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("mouse_click"), x: z.number(), y: z.number(), button: MOUSE_BUTTON.optional() }),
  z.object({ type: z.literal("wait"), duration_ms: z.number().int().positive() })
]);

export function registerInputTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_press_action ─────────────────────────────────────────────────────
  server.tool(
    "godot_press_action",
    "Simulate pressing an Input Map action. If duration_ms is provided, releases after the duration.",
    {
      action: z.string().describe("Input Map action name."),
      duration_ms: z.number().int().nonnegative().optional().describe("Hold duration in ms. 0/omitted = press only.")
    },
    async ({ action, duration_ms }) => toMcpResult(
      await executeToolSafely(ctx("godot_press_action", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.press_action", { action, duration_ms: duration_ms ?? 0 })
      )
    )
  );

  // ── godot_release_action ───────────────────────────────────────────────────
  server.tool(
    "godot_release_action",
    "Simulate releasing an Input Map action.",
    { action: z.string().describe("Input Map action name.") },
    async ({ action }) => toMcpResult(
      await executeToolSafely(ctx("godot_release_action", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.release_action", { action })
      )
    )
  );

  // ── godot_press_key ────────────────────────────────────────────────────────
  server.tool(
    "godot_press_key",
    "Simulate pressing a keyboard key. If duration_ms is provided, releases after the duration.",
    {
      keycode: z.string().describe("Godot keycode name (e.g. 'A', 'Space', 'Enter', 'Escape')."),
      duration_ms: z.number().int().nonnegative().optional().describe("Hold duration in ms. 0/omitted = press only.")
    },
    async ({ keycode, duration_ms }) => toMcpResult(
      await executeToolSafely(ctx("godot_press_key", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.press_key", { keycode, duration_ms: duration_ms ?? 0 })
      )
    )
  );

  // ── godot_release_key ──────────────────────────────────────────────────────
  server.tool(
    "godot_release_key",
    "Simulate releasing a keyboard key.",
    { keycode: z.string().describe("Godot keycode name.") },
    async ({ keycode }) => toMcpResult(
      await executeToolSafely(ctx("godot_release_key", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.release_key", { keycode })
      )
    )
  );

  // ── godot_tap_key ──────────────────────────────────────────────────────────
  server.tool(
    "godot_tap_key",
    "Simulate a keyboard key tap (press immediately followed by release).",
    { keycode: z.string().describe("Godot keycode name.") },
    async ({ keycode }) => toMcpResult(
      await executeToolSafely(ctx("godot_tap_key", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.tap_key", { keycode })
      )
    )
  );

  // ── godot_mouse_move ───────────────────────────────────────────────────────
  server.tool(
    "godot_mouse_move",
    "Simulate moving the mouse cursor to (x, y) in window coordinates.",
    {
      x: z.number().describe("X coordinate in window pixels."),
      y: z.number().describe("Y coordinate in window pixels.")
    },
    async ({ x, y }) => toMcpResult(
      await executeToolSafely(ctx("godot_mouse_move", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.mouse_move", { x, y })
      )
    )
  );

  // ── godot_mouse_click ──────────────────────────────────────────────────────
  server.tool(
    "godot_mouse_click",
    "Simulate a mouse click at (x, y) in window coordinates.",
    {
      x: z.number().describe("X coordinate in window pixels."),
      y: z.number().describe("Y coordinate in window pixels."),
      button: MOUSE_BUTTON.optional().describe("Mouse button. Defaults to 'left'.")
    },
    async ({ x, y, button }) => toMcpResult(
      await executeToolSafely(ctx("godot_mouse_click", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.mouse_click", { x, y, button: button ?? "left" })
      )
    )
  );

  // ── godot_mouse_drag ───────────────────────────────────────────────────────
  server.tool(
    "godot_mouse_drag",
    "Simulate a mouse drag from (from_x, from_y) to (to_x, to_y).",
    {
      from_x: z.number(),
      from_y: z.number(),
      to_x: z.number(),
      to_y: z.number(),
      button: MOUSE_BUTTON.optional().describe("Mouse button to hold during drag. Defaults to 'left'.")
    },
    async ({ from_x, from_y, to_x, to_y, button }) => toMcpResult(
      await executeToolSafely(ctx("godot_mouse_drag", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.mouse_drag", { from_x, from_y, to_x, to_y, button: button ?? "left" })
      )
    )
  );

  // ── godot_run_input_sequence ───────────────────────────────────────────────
  server.tool(
    "godot_run_input_sequence",
    "Execute a sequence of input events (action_press, action_release, key_press, key_release, key_tap, mouse_move, mouse_click, wait).",
    { sequence: z.array(SEQUENCE_STEP).min(1).describe("Ordered list of input steps.") },
    async ({ sequence }) => toMcpResult(
      await executeToolSafely(ctx("godot_run_input_sequence", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "input.run_sequence", { sequence })
      )
    )
  );
}
