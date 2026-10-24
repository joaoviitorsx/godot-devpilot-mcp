import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { createFileBackup } from "../safety/backup.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { createErrorResponse, type ToolResponse } from "../godot/protocol.js";

function toMcpResult(response: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], isError: !response.ok };
}

function ctx(name: string, config: ServerConfig) {
  return { toolName: name, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  return godot.call(method, params);
}

async function backupEditedResource(godot: GodotClient, config: ServerConfig, nodePath: string, toolName: string, sceneOnly = false): Promise<ToolResponse | null> {
  const listing = await callAfterConnect(godot, "better_tile_editor.list_terrains", { node_path: nodePath });
  if (!listing.ok) return listing;
  const data = listing.data as Record<string, unknown> | null;
  const tileSetPath = String(data?.tile_set_path ?? "");
  const scenePath = String(data?.scene_path ?? "");
  const target = sceneOnly || !tileSetPath.startsWith("res://") ? scenePath : tileSetPath;
  if (!target.startsWith("res://")) return createErrorResponse("UNSAVED_SCENE", "Save the scene before editing its TileSet or cells.");
  const resolved = resolveProjectPath(target, config.projectRoot);
  if (existsSync(resolved.absolutePath)) {
    await createFileBackup({ projectRoot: config.projectRoot, resPath: resolved.resPath, toolName, reason: "Before Better Tile Editor mutation" });
  }
  return null;
}

export function registerBetterTileEditorTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "godot_better_tile_editor_status",
    "Check whether the optional Better Tile Editor addon is installed and enabled in this Godot project.",
    {},
    async () => toMcpResult(await executeToolSafely(ctx("godot_better_tile_editor_status", config), () => callAfterConnect(godot, "better_tile_editor.status")))
  );

  server.tool(
    "godot_better_tile_editor_list_terrains",
    "List Better Tile Editor terrain IDs configured in the TileSet of an open TileMapLayer.",
    { node_path: z.string().min(1).describe("TileMapLayer node path in the open scene.") },
    async ({ node_path }) => toMcpResult(await executeToolSafely(ctx("godot_better_tile_editor_list_terrains", config), () => callAfterConnect(godot, "better_tile_editor.list_terrains", { node_path })))
  );

  server.tool(
    "godot_create_tile_atlas",
    "Create a Godot TileSet atlas from an existing project texture. This works without Better Tile Editor; terrain metadata can be added afterwards.",
    {
      texture_path: z.string().describe("Existing imported texture at res://..."),
      tileset_path: z.string().describe("Output TileSet .tres path at res://..."),
      tile_width: z.number().int().min(1).max(2048).default(16),
      tile_height: z.number().int().min(1).max(2048).default(16),
      overwrite: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false)
    },
    async ({ texture_path, tileset_path, tile_width, tile_height, overwrite, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_tile_atlas", config), async (): Promise<ToolResponse> => {
        const texture = resolveProjectPath(texture_path, config.projectRoot);
        const tileset = resolveProjectPath(tileset_path, config.projectRoot);
        if (!tileset.resPath.endsWith(".tres")) return createErrorResponse("INVALID_PARAMS", "tileset_path must end in .tres.");
        if (dry_run) return createDryRunResponse({ toolName: "godot_create_tile_atlas", plannedChanges: [`Create ${tileset.resPath} from ${texture.resPath} at ${tile_width}×${tile_height} pixels per tile`], affectedFiles: [tileset.resPath] });
        if (overwrite && existsSync(tileset.absolutePath)) {
          await createFileBackup({ projectRoot: config.projectRoot, resPath: tileset.resPath, toolName: "godot_create_tile_atlas", reason: "Before replacing TileSet atlas" });
        }
        return callAfterConnect(godot, "tilemap.create_atlas", { texture_path: texture.resPath, tileset_path: tileset.resPath, tile_width, tile_height, overwrite });
      })
    )
  );

  server.tool(
    "godot_better_tile_editor_create_terrain",
    "Add a Better Tile Editor terrain to the TileSet on an open TileMapLayer. Assign atlas tiles before painting.",
    {
      node_path: z.string().min(1),
      name: z.string().min(1).max(128),
      color: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).default("#7cc86b"),
      terrain_type: z.enum(["match_tiles", "match_vertices", "category", "single"]).default("match_tiles"),
      dry_run: z.boolean().optional().default(false)
    },
    async ({ node_path, name, color, terrain_type, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_better_tile_editor_create_terrain", config), async (): Promise<ToolResponse> => {
        const types = { match_tiles: 0, match_vertices: 1, category: 2, single: 7 } as const;
        if (dry_run) return createDryRunResponse({ toolName: "godot_better_tile_editor_create_terrain", plannedChanges: [`Add ${terrain_type} terrain '${name}' to ${node_path}`], affectedFiles: [] });
        const backupError = await backupEditedResource(godot, config, node_path, "godot_better_tile_editor_create_terrain");
        if (backupError) return backupError;
        return callAfterConnect(godot, "better_tile_editor.create_terrain", { node_path, name, color, terrain_type: types[terrain_type] });
      })
    )
  );

  server.tool(
    "godot_better_tile_editor_assign_tile",
    "Associate an existing atlas tile with a Better Tile Editor terrain.",
    {
      node_path: z.string().min(1), terrain_id: z.number().int().min(0), source_id: z.number().int().min(0).default(0),
      atlas_x: z.number().int().min(0), atlas_y: z.number().int().min(0), alternative: z.number().int().min(0).default(0),
      dry_run: z.boolean().optional().default(false)
    },
    async ({ node_path, terrain_id, source_id, atlas_x, atlas_y, alternative, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_better_tile_editor_assign_tile", config), async (): Promise<ToolResponse> => {
        if (dry_run) return createDryRunResponse({ toolName: "godot_better_tile_editor_assign_tile", plannedChanges: [`Assign atlas tile ${source_id}:${atlas_x},${atlas_y} to terrain ${terrain_id}`], affectedFiles: [] });
        const backupError = await backupEditedResource(godot, config, node_path, "godot_better_tile_editor_assign_tile");
        if (backupError) return backupError;
        return callAfterConnect(godot, "better_tile_editor.assign_tile", { node_path, terrain_id, source_id, atlas_x, atlas_y, alternative });
      })
    )
  );

  server.tool(
    "godot_better_tile_editor_paint_terrain",
    "Paint terrain cells using Better Tile Editor and update neighboring terrain tiles. The scene is saved after painting.",
    {
      node_path: z.string().min(1), terrain_id: z.number().int().min(0),
      cells: z.array(z.object({ x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) })).min(1).max(10000),
      update_neighbors: z.boolean().optional().default(true), dry_run: z.boolean().optional().default(false)
    },
    async ({ node_path, terrain_id, cells, update_neighbors, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_better_tile_editor_paint_terrain", config), async (): Promise<ToolResponse> => {
        if (dry_run) return createDryRunResponse({ toolName: "godot_better_tile_editor_paint_terrain", plannedChanges: [`Paint ${cells.length} cell(s) on ${node_path} with terrain ${terrain_id}`], affectedFiles: [] });
        const backupError = await backupEditedResource(godot, config, node_path, "godot_better_tile_editor_paint_terrain", true);
        if (backupError) return backupError;
        return callAfterConnect(godot, "better_tile_editor.paint_terrain", { node_path, terrain_id, cells, update_neighbors });
      })
    )
  );
}
