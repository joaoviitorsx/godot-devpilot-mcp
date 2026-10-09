import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";
import { serializeSceneToTscn, type SceneSpec, SubRef } from "../utils/sceneSerializer.js";
import { recordBlueprintApplied, recordScene, recordScript } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// ── Tilemap declarativo ──────────────────────────────────────────────────────

const TILEMAP_HELPER_SCRIPT = `extends TileMapLayer

# Helper to bulk-set cells. cells = [[x, y, source_id, atlas_x, atlas_y], ...].
func populate(cells: Array) -> void:
	for entry in cells:
		if entry.size() < 5:
			continue
		set_cell(Vector2i(entry[0], entry[1]), entry[2], Vector2i(entry[3], entry[4]))

func clear_all() -> void:
	clear()
`;

function specTilemap(scriptPath: string, sceneName: string): SceneSpec {
  return {
    path: `res://scenes/${sceneName}.tscn`,
    ext_resources: [{ id: "tm_script", type: "Script", path: scriptPath }],
    sub_resources: [{ id: "TS_EMPTY", type: "TileSet", props: { tile_size: { x: 16, y: 16 } } }],
    root: {
      name: sceneName, type: "TileMapLayer", script: "tm_script",
      props: { tile_set: SubRef("TS_EMPTY") },
    },
  };
}

// ── Procedural dungeon (BSP) ─────────────────────────────────────────────────

const PROCEDURAL_DUNGEON_GD = `extends Node
# Procedural BSP dungeon generator. Emits build() that returns a layout dict
# {rooms: Array, corridors: Array, spawn: Vector2}. Plug into your level by
# instancing room scenes at the returned positions.

@export var grid_width: int = 60
@export var grid_height: int = 40
@export var min_room_size: int = 6
@export var max_room_size: int = 12
@export var max_depth: int = 5
@export var seed: int = 0

signal dungeon_built(layout: Dictionary)

var _rng: RandomNumberGenerator = RandomNumberGenerator.new()

func build() -> Dictionary:
	if seed != 0:
		_rng.seed = seed
	else:
		_rng.randomize()
	var rooms: Array = []
	var corridors: Array = []
	var root := Rect2i(0, 0, grid_width, grid_height)
	_split(root, 0, rooms)
	for i in rooms.size() - 1:
		var a: Rect2i = rooms[i]
		var b: Rect2i = rooms[i + 1]
		var ca := a.position + a.size / 2
		var cb := b.position + b.size / 2
		corridors.append([ca, cb])
	var layout := {
		"rooms": rooms,
		"corridors": corridors,
		"spawn": (rooms[0].position + rooms[0].size / 2) if rooms.size() > 0 else Vector2i.ZERO,
	}
	dungeon_built.emit(layout)
	return layout

func _split(rect: Rect2i, depth: int, out: Array) -> void:
	if depth >= max_depth or (rect.size.x < max_room_size * 2 and rect.size.y < max_room_size * 2):
		var rw := _rng.randi_range(min_room_size, min(max_room_size, rect.size.x))
		var rh := _rng.randi_range(min_room_size, min(max_room_size, rect.size.y))
		var rx := rect.position.x + _rng.randi_range(0, max(0, rect.size.x - rw))
		var ry := rect.position.y + _rng.randi_range(0, max(0, rect.size.y - rh))
		out.append(Rect2i(rx, ry, rw, rh))
		return
	var horizontal: bool = rect.size.x < rect.size.y
	if horizontal:
		var split := _rng.randi_range(rect.size.y / 3, 2 * rect.size.y / 3)
		_split(Rect2i(rect.position, Vector2i(rect.size.x, split)), depth + 1, out)
		_split(Rect2i(Vector2i(rect.position.x, rect.position.y + split), Vector2i(rect.size.x, rect.size.y - split)), depth + 1, out)
	else:
		var split := _rng.randi_range(rect.size.x / 3, 2 * rect.size.x / 3)
		_split(Rect2i(rect.position, Vector2i(split, rect.size.y)), depth + 1, out)
		_split(Rect2i(Vector2i(rect.position.x + split, rect.position.y), Vector2i(rect.size.x - split, rect.size.y)), depth + 1, out)
`;

// ── Apply helpers ────────────────────────────────────────────────────────────

async function writeIfNew(projectRoot: string, resPath: string, content: string, isGd: boolean, overwrite: boolean): Promise<{ written: boolean; reason?: string }> {
  const r = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return { written: false, reason: "exists" };
  await mkdir(path.dirname(r.absolutePath), { recursive: true });
  await writeFile(r.absolutePath, isGd ? autoFixGDScript(content) : content, "utf8");
  return { written: true };
}

const ParamsSchema = {
  script_dir: z.string().optional().default("res://scripts"),
  scenes_dir: z.string().optional().default("res://scenes"),
  overwrite: z.boolean().optional().default(false),
};

export function registerTilemapAndDungeonTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_define_tilemap",
    "Generate a TileMapLayer scene + helper script with `populate(cells)` and `clear_all()` methods. cells param accepts [[x,y,source_id,atlas_x,atlas_y]...]. TileSet starts empty (16×16) — attach an atlas in editor or via sub_resource patching.",
    {
      ...ParamsSchema,
      scene_name: z.string().optional().default("DungeonTiles"),
      cells: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])).optional().describe("Optional initial cells. If provided, helper script bakes them into _ready()."),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_define_tilemap", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const scriptPath = `${params.script_dir}/${params.scene_name}.gd`;
          let scriptContent = TILEMAP_HELPER_SCRIPT;
          if (params.cells && params.cells.length > 0) {
            const cellsLiteral = params.cells.map((c) => `[${c.join(", ")}]`).join(", ");
            scriptContent = scriptContent.replace(
              "func clear_all() -> void:",
              `func _ready() -> void:\n\tpopulate([${cellsLiteral}])\n\nfunc clear_all() -> void:`
            );
          }
          const w1 = await writeIfNew(config.projectRoot, scriptPath, scriptContent, true, params.overwrite);
          const sceneSpec = specTilemap(scriptPath, params.scene_name);
          sceneSpec.path = `${params.scenes_dir}/${params.scene_name}.tscn`;
          const w2 = await writeIfNew(config.projectRoot, sceneSpec.path, serializeSceneToTscn(sceneSpec), false, params.overwrite);
          if (w1.written) await recordScript(config.projectRoot, scriptPath, {});
          if (w2.written) await recordScene(config.projectRoot, sceneSpec.path, "tilemap", [scriptPath]);
          await recordBlueprintApplied(config.projectRoot, "tilemap", { scene_name: params.scene_name });
          return createSuccessResponse({ files: [scriptPath, sceneSpec.path] }, `tilemap '${params.scene_name}' generated.`);
        })
      )
  );

  server.tool(
    "devpilot_blueprint_procedural_dungeon",
    "BSP-based procedural dungeon generator autoload-ready. Emits dungeon_built(layout) signal with rooms + corridors. Configurable seed/grid/min/max room sizes. Pair with devpilot_blueprint_dungeon_room (2D) or _3d.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_procedural_dungeon", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const scriptPath = `${params.script_dir}/ProceduralDungeon.gd`;
          const w = await writeIfNew(config.projectRoot, scriptPath, PROCEDURAL_DUNGEON_GD, true, params.overwrite);
          if (w.written) await recordScript(config.projectRoot, scriptPath, { signals: ["dungeon_built"] });
          await recordBlueprintApplied(config.projectRoot, "procedural_dungeon");
          return createSuccessResponse(
            { files: [scriptPath], next_steps: [`Register autoload: devpilot_add_autoload name=ProceduralDungeon path=${scriptPath}`, "Call ProceduralDungeon.build() to get layout dict"] },
            "procedural_dungeon applied."
          );
        })
      )
  );
}

export const TILEMAP_DUNGEON_REGISTRY = [
  { name: "tilemap", description: "TileMapLayer scene + populate/clear helper script", category: "level", files_created: ["scripts/<name>.gd", "scenes/<name>.tscn"], params_schema: { scene_name: "string?", cells: "array?" }, example: { scene_name: "DungeonTiles" } },
  { name: "procedural_dungeon", description: "BSP procedural dungeon generator autoload (rooms+corridors)", category: "level", files_created: ["scripts/ProceduralDungeon.gd"], params_schema: {}, example: {} },
];
