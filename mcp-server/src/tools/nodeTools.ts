import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely, type ToolExecutionContext } from "../safety/toolWrapper.js";

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

function ctx(toolName: string, config: ServerConfig): ToolExecutionContext {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

export function registerNodeTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "godot_add_node",
    "Add a child node to an existing node in the current scene.",
    {
      node_type: z.string().optional().describe("ClassDB type for the new node (e.g. Sprite2D, Label)."),
      type: z.string().optional().describe("Alias for node_type."),
      node_name: z.string().optional().describe("Name for the new node (defaults to node_type)."),
      name: z.string().optional().describe("Alias for node_name."),
      parent_path: z.string().optional().describe("NodePath of the parent relative to scene root (default: '.' = root)."),
      properties: z.record(z.unknown()).optional().describe("Initial properties to set on the new node."),
      dry_run: z.boolean().optional().describe("Preview without modifying the scene.")
    },
    async ({ node_type, type, node_name, name, parent_path, properties, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_add_node", config), async (): Promise<ToolResponse> => {
        const resolvedType = node_type ?? type;
        if (!resolvedType) {
          return createErrorResponse(
            "INVALID_PARAMS",
            "node_type is required.",
            {},
            ["Pass node_type, or the documented alias type."]
          );
        }
        const resolvedName = node_name ?? name ?? resolvedType;
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_add_node",
            plannedChanges: [`Add '${resolvedType}' node '${resolvedName}' as child of '${parent_path ?? "."}'`],
            affectedFiles: [],
            affectedNodes: [parent_path ?? "."]
          });
        }
        return callAfterConnect(godot, "node.add", {
          node_type: resolvedType,
          node_name: resolvedName,
          parent_path: parent_path ?? ".",
          properties: properties ?? {}
        });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_remove_node",
    "Remove a node from the current scene. Cannot remove the root node.",
    {
      node_path: z.string().describe("NodePath of the node to remove, relative to scene root."),
      dry_run: z.boolean().optional().describe("Preview without modifying the scene.")
    },
    async ({ node_path, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_remove_node", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_remove_node",
            plannedChanges: [`Remove node at '${node_path}'`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "node.remove", { node_path });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_rename_node",
    "Rename a node in the current scene.",
    {
      node_path: z.string().describe("NodePath of the node to rename, relative to scene root."),
      new_name: z.string().describe("New name for the node."),
      dry_run: z.boolean().optional().describe("Preview without modifying the scene.")
    },
    async ({ node_path, new_name, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_rename_node", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_rename_node",
            plannedChanges: [`Rename node at '${node_path}' to '${new_name}'`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "node.rename", { node_path, new_name });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_duplicate_node",
    "Duplicate a node and add the copy as a sibling.",
    {
      node_path: z.string().describe("NodePath of the node to duplicate, relative to scene root."),
      dry_run: z.boolean().optional().describe("Preview without modifying the scene.")
    },
    async ({ node_path, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_duplicate_node", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_duplicate_node",
            plannedChanges: [`Duplicate node at '${node_path}'`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "node.duplicate", { node_path });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_reparent_node",
    "Move a node to a different parent within the current scene.",
    {
      node_path: z.string().describe("NodePath of the node to reparent."),
      new_parent_path: z.string().describe("NodePath of the new parent node."),
      dry_run: z.boolean().optional().describe("Preview without modifying the scene.")
    },
    async ({ node_path, new_parent_path, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_reparent_node", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_reparent_node",
            plannedChanges: [`Reparent '${node_path}' → '${new_parent_path}'`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "node.reparent", { node_path, new_parent_path });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_get_node_properties",
    "List all editor-visible properties and their current values for a node.",
    {
      node_path: z.string().optional().describe("NodePath relative to scene root (default: '.' = root).")
    },
    async ({ node_path }) => {
      const result = await executeToolSafely(ctx("godot_get_node_properties", config), async () =>
        callAfterConnect(godot, "node.get_properties", { node_path: node_path ?? "." })
      );
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_node_property",
    "Set a property on a node in the current scene.",
    {
      node_path: z.string().optional().describe("NodePath relative to scene root (default: '.' = root)."),
      property: z.string().describe("Property name as exposed in the Godot Inspector."),
      value: z.unknown().describe("New value; coerced to match the property type automatically."),
      dry_run: z.boolean().optional().describe("Preview without modifying the scene.")
    },
    async ({ node_path, property, value, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_node_property", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_node_property",
            plannedChanges: [`Set '${node_path ?? "."}.${property}' = ${JSON.stringify(value)}`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "node.set_property", { node_path: node_path ?? ".", property, value });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_get_node_groups",
    "List all groups a node belongs to.",
    {
      node_path: z.string().optional().describe("NodePath relative to scene root (default: '.' = root).")
    },
    async ({ node_path }) => {
      const result = await executeToolSafely(ctx("godot_get_node_groups", config), async () =>
        callAfterConnect(godot, "node.get_groups", { node_path: node_path ?? "." })
      );
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_add_node_to_group",
    "Add a node to a group in the current scene.",
    {
      node_path: z.string().optional().describe("NodePath relative to scene root (default: '.' = root)."),
      group: z.string().describe("Group name to add the node to."),
      dry_run: z.boolean().optional().describe("Preview without modifying the scene.")
    },
    async ({ node_path, group, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_add_node_to_group", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_add_node_to_group",
            plannedChanges: [`Add node '${node_path ?? "."}' to group '${group}'`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "node.add_to_group", { node_path: node_path ?? ".", group });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_remove_node_from_group",
    "Remove a node from a group in the current scene.",
    {
      node_path: z.string().optional().describe("NodePath relative to scene root (default: '.' = root)."),
      group: z.string().describe("Group name to remove the node from."),
      dry_run: z.boolean().optional().describe("Preview without modifying the scene.")
    },
    async ({ node_path, group, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_remove_node_from_group", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_remove_node_from_group",
            plannedChanges: [`Remove node '${node_path ?? "."}' from group '${group}'`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "node.remove_from_group", { node_path: node_path ?? ".", group });
      });
      return toMcpResult(result);
    }
  );
}
