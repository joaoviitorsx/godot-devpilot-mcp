import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ServerConfig } from "../config/config.js";
import { getModeCapabilities } from "../config/modes.js";
import type { GodotClient, GodotConnectionStatus } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";

type CapabilitiesPayload = ReturnType<typeof getModeCapabilities> & {
  connection: GodotConnectionStatus;
  server_version: string;
  protocol_version: string;
  security: {
    read_only: boolean;
  };
  plugin: unknown | null;
};

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(response, null, 2)
      }
    ],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) {
      return connection;
    }
  }

  return godot.call(method, params);
}

export function buildCapabilitiesPayload(
  config: ServerConfig,
  status: GodotConnectionStatus,
  pluginCapabilities: unknown | null = null
): CapabilitiesPayload {
  return {
    ...getModeCapabilities(config.mode),
    connection: status,
    server_version: config.server.version,
    protocol_version: config.server.protocolVersion,
    security: {
      read_only: config.security.readOnly
    },
    plugin: pluginCapabilities
  };
}

export function registerCoreTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.registerTool(
    "godot_health_check",
    {
      title: "Godot Health Check",
      description: "Verifies that the MCP server can reach the Godot plugin over local WebSocket.",
      inputSchema: {}
    },
    async () => toMcpResult(await callAfterConnect(godot, "system.health_check"))
  );

  server.registerTool(
    "godot_ping",
    {
      title: "Godot Ping",
      description: "Sends a lightweight heartbeat request to the Godot plugin.",
      inputSchema: {}
    },
    async () => toMcpResult(await callAfterConnect(godot, "system.ping"))
  );

  server.registerTool(
    "godot_get_capabilities",
    {
      title: "Godot Capabilities",
      description: "Returns phase 1 server capabilities and reconciles plugin capabilities when the editor bridge is connected.",
      inputSchema: {}
    },
    async () => {
      const status = godot.getStatus();
      let pluginCapabilities: unknown | null = null;

      if (status.connected) {
        const pluginResponse = await godot.call("system.get_capabilities", {});
        pluginCapabilities = pluginResponse.ok ? pluginResponse.data : { error: pluginResponse.error };
      }

      return toMcpResult(
        createSuccessResponse(
          buildCapabilitiesPayload(config, godot.getStatus(), pluginCapabilities),
          "Capabilities loaded successfully."
        )
      );
    }
  );

  server.registerTool(
    "godot_get_connection_status",
    {
      title: "Godot Connection Status",
      description: "Returns local WebSocket connection diagnostics without requiring Godot to be connected.",
      inputSchema: {}
    },
    async () =>
      toMcpResult(
        createSuccessResponse(
          {
            ...godot.getStatus(),
            mode: config.mode
          },
          "Connection status obtained."
        )
      )
  );

  server.registerTool(
    "godot_get_protocol_version",
    {
      title: "Godot Protocol Version",
      description: "Returns the JSON-RPC protocol version used between the MCP server and Godot plugin.",
      inputSchema: {}
    },
    async () =>
      toMcpResult(
        createSuccessResponse(
          {
            protocol_version: config.server.protocolVersion,
            jsonrpc: "2.0"
          },
          "Protocol version obtained."
        )
      )
  );
}
