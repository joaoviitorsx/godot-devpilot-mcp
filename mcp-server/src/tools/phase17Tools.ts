import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { type ToolResponse } from "../godot/protocol.js";
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

export function registerPhase17Tools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "godot_execute_editor_script",
    "Execute arbitrary GDScript in the editor context. Returns output captured from print() calls.",
    {
      code: z.string().min(1).describe("GDScript code to execute. Will be wrapped in a @tool RefCounted class."),
      timeout_ms: z.number().optional().describe("Max execution time ms. Default 5000.")
    },
    async ({ code, timeout_ms }) => {
      const result = await executeToolSafely(ctx("godot_execute_editor_script", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "script.execute_editor", { code, timeout_ms });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_execute_game_script",
    "Execute arbitrary GDScript inside the running game scene. Requires project to be running.",
    {
      code: z.string().min(1).describe("GDScript code to run in game context."),
      timeout_ms: z.number().optional()
    },
    async ({ code, timeout_ms }) => {
      const result = await executeToolSafely(ctx("godot_execute_game_script", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "script.execute_game", { code, timeout_ms });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_connect_signal",
    "Connect a signal from a source node to a method on a target node.",
    {
      source_path: z.string().describe("NodePath of signal emitter."),
      signal_name: z.string().describe("Signal name."),
      target_path: z.string().describe("NodePath of receiver."),
      method_name: z.string().describe("Method name on target."),
      flags: z.number().optional().describe("Connection flags (0=default, 1=deferred, 4=one_shot)."),
      dry_run: z.boolean().optional()
    },
    async ({ source_path, signal_name, target_path, method_name, flags, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_connect_signal", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_connect_signal",
            plannedChanges: [`Connect signal '${signal_name}' from '${source_path}' to '${target_path}.${method_name}'`],
            affectedFiles: [],
            affectedNodes: [source_path, target_path]
          });
        }
        return callAfterConnect(godot, "node.connect_signal", { source_path, signal_name, target_path, method_name, flags });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_disconnect_signal",
    "Disconnect a signal connection between two nodes.",
    {
      source_path: z.string(),
      signal_name: z.string(),
      target_path: z.string(),
      method_name: z.string(),
      dry_run: z.boolean().optional()
    },
    async ({ source_path, signal_name, target_path, method_name, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_disconnect_signal", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_disconnect_signal",
            plannedChanges: [`Disconnect signal '${signal_name}' from '${source_path}' → '${target_path}.${method_name}'`],
            affectedFiles: [],
            affectedNodes: [source_path, target_path]
          });
        }
        return callAfterConnect(godot, "node.disconnect_signal", { source_path, signal_name, target_path, method_name });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_add_scene_instance",
    "Instantiate a PackedScene (.tscn) as a child of a node in the current scene.",
    {
      scene_path: z.string().describe("res:// path to .tscn file."),
      parent_path: z.string().optional().describe("Parent NodePath, defaults to scene root."),
      instance_name: z.string().optional().describe("Override instance name."),
      dry_run: z.boolean().optional()
    },
    async ({ scene_path, parent_path, instance_name, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_add_scene_instance", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_add_scene_instance",
            plannedChanges: [`Instantiate scene '${scene_path}' as child of '${parent_path ?? "."}'${instance_name ? ` named '${instance_name}'` : ""}`],
            affectedFiles: [scene_path],
            affectedNodes: [parent_path ?? "."]
          });
        }
        return callAfterConnect(godot, "scene.add_instance", { scene_path, parent_path, instance_name });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_tilemap_set_cell",
    "Set a tile cell in a TileMap node.",
    {
      node_path: z.string().describe("NodePath to TileMap."),
      layer: z.number().optional().describe("Layer index, default 0."),
      x: z.number().describe("Cell X coordinate."),
      y: z.number().describe("Cell Y coordinate."),
      source_id: z.number().optional().describe("TileSet source ID, default 0."),
      atlas_x: z.number().optional().describe("Atlas coords X, default 0."),
      atlas_y: z.number().optional().describe("Atlas coords Y, default 0."),
      alternative_tile: z.number().optional().describe("Alternative tile index, default 0."),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, layer, x, y, source_id, atlas_x, atlas_y, alternative_tile, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_tilemap_set_cell", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_tilemap_set_cell",
            plannedChanges: [`Set TileMap cell at (${x}, ${y}) layer ${layer ?? 0} on '${node_path}'`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "tilemap.set_cell", { node_path, layer, x, y, source_id, atlas_x, atlas_y, alternative_tile });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_tilemap_fill_rect",
    "Fill a rectangular region of a TileMap with a tile.",
    {
      node_path: z.string(),
      layer: z.number().optional(),
      x: z.number().describe("Top-left X."),
      y: z.number().describe("Top-left Y."),
      width: z.number().describe("Fill width in cells."),
      height: z.number().describe("Fill height in cells."),
      source_id: z.number().optional(),
      atlas_x: z.number().optional(),
      atlas_y: z.number().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, layer, x, y, width, height, source_id, atlas_x, atlas_y, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_tilemap_fill_rect", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_tilemap_fill_rect",
            plannedChanges: [`Fill TileMap rect (${x}, ${y}, ${width}x${height}) layer ${layer ?? 0} on '${node_path}'`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "tilemap.fill_rect", { node_path, layer, x, y, width, height, source_id, atlas_x, atlas_y });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_tilemap_get_cell",
    "Read tile data from a specific TileMap cell.",
    {
      node_path: z.string(),
      layer: z.number().optional(),
      x: z.number(),
      y: z.number()
    },
    async ({ node_path, layer, x, y }) => {
      const result = await executeToolSafely(ctx("godot_tilemap_get_cell", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "tilemap.get_cell", { node_path, layer, x, y });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_tilemap_clear",
    "Clear all tiles from a TileMap layer.",
    {
      node_path: z.string(),
      layer: z.number().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, layer, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_tilemap_clear", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_tilemap_clear",
            plannedChanges: [`Clear all tiles from TileMap '${node_path}' layer ${layer ?? 0}`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "tilemap.clear", { node_path, layer });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_tilemap_get_info",
    "Get TileMap metadata: layers, tile set sources, used rect.",
    {
      node_path: z.string()
    },
    async ({ node_path }) => {
      const result = await executeToolSafely(ctx("godot_tilemap_get_info", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "tilemap.get_info", { node_path });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_tilemap_get_used_cells",
    "Get all cells currently in use in a TileMap layer.",
    {
      node_path: z.string(),
      layer: z.number().optional()
    },
    async ({ node_path, layer }) => {
      const result = await executeToolSafely(ctx("godot_tilemap_get_used_cells", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "tilemap.get_used_cells", { node_path, layer });
      });
      return toMcpResult(result);
    }
  );
}
