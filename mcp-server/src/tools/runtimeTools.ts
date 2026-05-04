import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerRuntimeTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_get_runtime_tree ─────────────────────────────────────────────────
  server.tool(
    "godot_get_runtime_tree",
    "Inspect the running scene tree. Requires the game to be running.",
    {
      max_depth: z.number().int().positive().max(20).optional().describe("Max tree depth. Defaults to 10."),
      include_properties: z.boolean().optional().describe("Include common properties per node. Defaults to false.")
    },
    async ({ max_depth, include_properties }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_runtime_tree", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "runtime.get_tree", {
          max_depth: max_depth ?? 10,
          include_properties: include_properties ?? false
        })
      )
    )
  );

  // ── godot_get_runtime_node_properties ─────────────────────────────────────
  server.tool(
    "godot_get_runtime_node_properties",
    "Read properties of a node from the running scene.",
    {
      node_path: z.string().describe("Node path relative to scene root."),
      properties: z.array(z.string()).optional().describe("Specific properties to read. Omit for common defaults.")
    },
    async ({ node_path, properties }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_runtime_node_properties", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "runtime.get_node_properties", { node_path, properties: properties ?? [] })
      )
    )
  );

  // ── godot_set_runtime_node_property ───────────────────────────────────────
  server.tool(
    "godot_set_runtime_node_property",
    "Temporarily set a property on a node in the running scene. Reverts when the game stops.",
    {
      node_path: z.string().describe("Node path relative to scene root."),
      property: z.string().describe("Property name."),
      value: z.unknown().describe("New value (matches Godot type via coercion).")
    },
    async ({ node_path, property, value }) => toMcpResult(
      await executeToolSafely(ctx("godot_set_runtime_node_property", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "runtime.set_node_property", { node_path, property, value })
      )
    )
  );

  // ── godot_get_fps ──────────────────────────────────────────────────────────
  server.tool(
    "godot_get_fps",
    "Get current frames-per-second. Works in editor (returns editor FPS) and during runtime (returns game FPS).",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_get_fps", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "runtime.get_fps", {})
      )
    )
  );

  // ── godot_get_process_stats ───────────────────────────────────────────────
  server.tool(
    "godot_get_process_stats",
    "Get engine performance monitors (FPS, frame time, memory, draw calls, object counts).",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_get_process_stats", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "runtime.get_process_stats", {})
      )
    )
  );

  // ── godot_wait_for_condition ──────────────────────────────────────────────
  server.tool(
    "godot_wait_for_condition",
    "Poll a node property until it equals the expected value or timeout expires.",
    {
      node_path: z.string().describe("Node path relative to scene root."),
      property: z.string().describe("Property name to poll."),
      expected_value: z.unknown().describe("Value to wait for (deep equality)."),
      timeout_ms: z.number().int().positive().max(60000).optional().describe("Timeout in ms. Defaults to 5000."),
      poll_interval_ms: z.number().int().positive().max(5000).optional().describe("Poll interval ms. Defaults to 200.")
    },
    async ({ node_path, property, expected_value, timeout_ms, poll_interval_ms }) => toMcpResult(
      await executeToolSafely(ctx("godot_wait_for_condition", config), async (): Promise<ToolResponse> => {
        const timeout = timeout_ms ?? 5000;
        const interval = poll_interval_ms ?? 200;
        const start = Date.now();
        const expectedJson = JSON.stringify(expected_value);

        while (Date.now() - start < timeout) {
          const response = await callAfterConnect(godot, "runtime.get_node_properties", { node_path, properties: [property] });
          if (!response.ok) {
            return response;
          }
          const data = response.data as Record<string, unknown>;
          const props = (data?.properties ?? data) as Record<string, unknown>;
          const actual = props?.[property];
          if (JSON.stringify(actual) === expectedJson) {
            return createSuccessResponse(
              { matched: true, elapsed_ms: Date.now() - start, value: actual },
              "Condition matched."
            );
          }
          await sleep(interval);
        }

        return createErrorResponse(
          "WAIT_TIMEOUT",
          `Condition did not match within ${timeout}ms.`,
          { node_path, property, expected_value, elapsed_ms: Date.now() - start },
          ["Increase timeout_ms or verify the node is reaching the expected state."]
        );
      })
    )
  );

  // ── godot_find_runtime_node ───────────────────────────────────────────────
  server.tool(
    "godot_find_runtime_node",
    "Find nodes in the running scene by name, type, or group.",
    {
      name: z.string().optional().describe("Match by node name (case-insensitive substring)."),
      type: z.string().optional().describe("Match by Godot class name (exact)."),
      group: z.string().optional().describe("Match by group membership."),
      limit: z.number().int().positive().max(200).optional().describe("Max results. Defaults to 50.")
    },
    async ({ name, type, group, limit }) => toMcpResult(
      await executeToolSafely(ctx("godot_find_runtime_node", config), async (): Promise<ToolResponse> => {
        if (!name && !type && !group) {
          return createErrorResponse(
            "INVALID_PARAMS",
            "At least one of name, type, group must be provided.",
            {},
            ["Pass name, type, or group to filter."]
          );
        }
        return callAfterConnect(godot, "runtime.find_node", { name: name ?? "", type: type ?? "", group: group ?? "", limit: limit ?? 50 });
      })
    )
  );

  // ── godot_get_current_camera ──────────────────────────────────────────────
  server.tool(
    "godot_get_current_camera",
    "Get the current Camera2D or Camera3D in the running scene.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_get_current_camera", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "runtime.get_current_camera", {})
      )
    )
  );

  // ── godot_find_ui_element ─────────────────────────────────────────────────
  server.tool(
    "godot_find_ui_element",
    "Find a Control node by visible text or name in the running scene.",
    {
      text: z.string().optional().describe("Substring to match in node text/label."),
      name: z.string().optional().describe("Substring to match in node name."),
      type: z.string().optional().describe("Filter by Control subclass (e.g. Button, LineEdit).")
    },
    async ({ text, name, type }) => toMcpResult(
      await executeToolSafely(ctx("godot_find_ui_element", config), async (): Promise<ToolResponse> => {
        if (!text && !name && !type) {
          return createErrorResponse(
            "INVALID_PARAMS",
            "At least one of text, name, type must be provided.",
            {},
            ["Pass text, name, or type to filter UI elements."]
          );
        }
        return callAfterConnect(godot, "runtime.find_ui_element", { text: text ?? "", name: name ?? "", type: type ?? "" });
      })
    )
  );

  // ── godot_click_ui_by_text ────────────────────────────────────────────────
  server.tool(
    "godot_click_ui_by_text",
    "Find a Control by visible text and simulate a click at its center.",
    { text: z.string().describe("Text shown by the Button/Label/LineEdit to click.") },
    async ({ text }) => toMcpResult(
      await executeToolSafely(ctx("godot_click_ui_by_text", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "runtime.click_ui_by_text", { text })
      )
    )
  );
}
