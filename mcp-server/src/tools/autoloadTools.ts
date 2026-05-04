import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

export function registerAutoloadTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_list_autoloads_full ──────────────────────────────────────────────
  server.tool(
    "godot_list_autoloads_full",
    "List all registered autoloads with full status: path, enabled (* prefix), script_exists, loads_ok, class_name. Use to validate autoload integrity.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("godot_list_autoloads_full", config), async () =>
          callRpc(godot, "project.get_autoloads_full", {})
        )
      )
  );

  // ── godot_reload_autoload ──────────────────────────────────────────────────
  server.tool(
    "godot_reload_autoload",
    "Force reload a single autoload by removing and re-adding the entry. Use after editing the autoload's script to pick up changes.",
    {
      name: z.string().describe("Singleton name to reload"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_reload_autoload", config), async () =>
          callRpc(godot, "project.reload_autoload", params)
        )
      )
  );

  // ── godot_reorder_autoloads ────────────────────────────────────────────────
  server.tool(
    "godot_reorder_autoloads",
    "Reorder autoloads in load order. Pass full ordered list of names. Order matters when autoloads depend on each other.",
    {
      order: z.array(z.string()).describe("Full ordered list of autoload names"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_reorder_autoloads", config), async () =>
          callRpc(godot, "project.reorder_autoloads", params)
        )
      )
  );
}
