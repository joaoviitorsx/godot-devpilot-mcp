import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";
import { recordBlueprintApplied, recordScript } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function writeIfNew(projectRoot: string, resPath: string, content: string, overwrite: boolean): Promise<boolean> {
  const r = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return false;
  await mkdir(path.dirname(r.absolutePath), { recursive: true });
  await writeFile(r.absolutePath, autoFixGDScript(content), "utf8");
  return true;
}

const ParamsSchema = {
  script_dir: z.string().optional().default("res://scripts"),
  overwrite: z.boolean().optional().default(false),
};

// ── Save migration ──────────────────────────────────────────────────────────

const SAVE_MIGRATION = `extends Node
# Save schema migrator. Version your SaveData and register migrations here.
# Usage:
#   var migrated := SaveMigration.migrate(saved_data)
#   if migrated: load_state(migrated)

const CURRENT_VERSION := 3

# Each migration: from_version → callable that mutates the dict in place.
static func _migrations() -> Dictionary:
	return {
		1: func(d: Dictionary) -> void:
			# v1 → v2: rename "score" to "high_score"
			if d.has("score"):
				d["high_score"] = d["score"]
				d.erase("score"),
		2: func(d: Dictionary) -> void:
			# v2 → v3: add inventory array if missing
			if not d.has("inventory"):
				d["inventory"] = [],
	}

static func migrate(data: Dictionary) -> Dictionary:
	var version := int(data.get("schema_version", 1))
	var d := data.duplicate(true)
	while version < CURRENT_VERSION:
		var step = _migrations().get(version, null)
		if step == null:
			break
		step.call(d)
		version += 1
		d["schema_version"] = version
	return d
`;

// ── Achievements ────────────────────────────────────────────────────────────

const ACHIEVEMENT_RESOURCE = `extends Resource
class_name Achievement

@export var id: String = ""
@export var title: String = ""
@export var description: String = ""
@export var icon: Texture2D
@export var hidden: bool = false
`;

const ACHIEVEMENTS_MANAGER = `extends Node
# Local-only achievements manager. Persists unlocks at user://achievements.cfg.
# Steam/GameJolt integration: subclass and override _on_unlock to forward.

const PATH := "user://achievements.cfg"

signal achievement_unlocked(id: String)
signal achievement_progress(id: String, progress: float)

@export var achievements: Array[Achievement] = []

var _config: ConfigFile = ConfigFile.new()
var _unlocked: Dictionary = {}

func _ready() -> void:
	_load()

func _load() -> void:
	if FileAccess.file_exists(PATH):
		_config.load(PATH)
		for a in achievements:
			if bool(_config.get_value("unlocked", a.id, false)):
				_unlocked[a.id] = true

func unlock(id: String) -> bool:
	if _unlocked.has(id):
		return false
	_unlocked[id] = true
	_config.set_value("unlocked", id, true)
	_config.save(PATH)
	achievement_unlocked.emit(id)
	_on_unlock(id)
	return true

func is_unlocked(id: String) -> bool:
	return _unlocked.has(id)

func report_progress(id: String, progress: float) -> void:
	achievement_progress.emit(id, progress)
	if progress >= 1.0:
		unlock(id)

func _on_unlock(_id: String) -> void:
	# Override in subclass to forward to Steam/GameJolt/etc.
	pass

func unlocked_list() -> Array:
	return _unlocked.keys()

func reset_all() -> void:
	_unlocked.clear()
	for a in achievements:
		_config.set_value("unlocked", a.id, false)
	_config.save(PATH)
`;

// ── Tool registration ────────────────────────────────────────────────────────

export function registerSaveAchievementsTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "devpilot_blueprint_save_migration",
    "Save migration helper: SaveMigration.migrate(dict) walks schema_version forward applying registered migrations. Edit _migrations() to add new versions.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_save_migration", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const sp = `${params.script_dir}/SaveMigration.gd`;
          const w = await writeIfNew(config.projectRoot, sp, SAVE_MIGRATION, params.overwrite);
          if (w) await recordScript(config.projectRoot, sp, {});
          await recordBlueprintApplied(config.projectRoot, "save_migration", { template_version: "0.5.0" });
          return createSuccessResponse({ files: [sp] }, "save_migration applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_achievements",
    "Local achievements manager (autoload-ready) + Achievement Resource. Persists unlocks at user://achievements.cfg. Override _on_unlock for Steam/GameJolt integration.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_achievements", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const ap = `${params.script_dir}/Achievement.gd`;
          const mp = `${params.script_dir}/AchievementsManager.gd`;
          await writeIfNew(config.projectRoot, ap, ACHIEVEMENT_RESOURCE, params.overwrite);
          const w = await writeIfNew(config.projectRoot, mp, ACHIEVEMENTS_MANAGER, params.overwrite);
          if (w) await recordScript(config.projectRoot, mp, { signals: ["achievement_unlocked", "achievement_progress"] });
          await recordBlueprintApplied(config.projectRoot, "achievements", { template_version: "0.5.0" });
          return createSuccessResponse({ files: [ap, mp], next_steps: [`devpilot_add_autoload name=AchievementsManager path=${mp}`] }, "achievements applied.");
        })
      )
  );

  server.tool(
    "devpilot_reload_editor",
    "Best-effort: send RPC to addon asking editor to rescan filesystem. Limited — Godot does not expose project.godot reload. After running, you may still need Project → Reload Current Project for autoload/input changes.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_reload_editor", config), async (): Promise<ToolResponse> => {
          if (!godot.getStatus().connected) {
            const c = await godot.connect();
            if (!c.ok) return createErrorResponse("BRIDGE_OFFLINE", "Bridge not connected.", {}, []);
          }
          // Try multiple RPCs gracefully — addon may or may not expose them.
          const attempts = ["editor.scan_filesystem", "editor.reload_filesystem", "project.reload_settings"];
          const tried: Array<{ method: string; ok: boolean; error?: string }> = [];
          for (const m of attempts) {
            try {
              const r = await godot.call(m, {});
              tried.push({ method: m, ok: r.ok, error: r.ok ? undefined : r.error.code });
              if (r.ok) break;
            } catch (e) {
              tried.push({ method: m, ok: false, error: (e as Error).message });
            }
          }
          const any_ok = tried.some((t) => t.ok);
          return createSuccessResponse(
            { attempted: tried, success: any_ok },
            any_ok ? "Editor reload attempted." : "No reload RPC available — Godot limitation. Run Project → Reload Current Project manually.",
            any_ok ? [] : ["Project → Reload Current Project (manual)"],
          );
        })
      )
  );
}
