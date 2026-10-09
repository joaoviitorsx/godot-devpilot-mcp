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

async function writeIfNew(projectRoot: string, resPath: string, content: string, isGd: boolean, overwrite: boolean): Promise<boolean> {
  const r = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return false;
  await mkdir(path.dirname(r.absolutePath), { recursive: true });
  await writeFile(r.absolutePath, isGd ? autoFixGDScript(content) : content, "utf8");
  return true;
}

const ParamsSchema = {
  script_dir: z.string().optional().default("res://scripts"),
  overwrite: z.boolean().optional().default(false),
};

// ── Animation state machine helper ───────────────────────────────────────────

const ANIM_STATE_MACHINE_HELPER = `extends Node
# Setup helper for AnimationTree state machine. Attach to a character that has
# AnimationPlayer + AnimationTree children. Defines a basic state machine with
# idle/walk/run/attack and exposes simple set_state() / set_velocity() helpers.

@export var anim_player_path: NodePath
@export var anim_tree_path: NodePath
@export var default_state: StringName = &"idle"

var _player: AnimationPlayer
var _tree: AnimationTree
var _playback

const STATES := ["idle", "walk", "run", "attack"]

func _ready() -> void:
	if anim_player_path != NodePath(""):
		_player = get_node_or_null(anim_player_path) as AnimationPlayer
	if anim_tree_path != NodePath(""):
		_tree = get_node_or_null(anim_tree_path) as AnimationTree
	if _tree:
		_tree.active = true
		_playback = _tree.get("parameters/playback")
		if _playback:
			_playback.travel(default_state)

func set_state(state_name: StringName) -> void:
	if _playback:
		_playback.travel(state_name)

func set_velocity(speed: float, threshold_walk: float = 20.0, threshold_run: float = 180.0) -> void:
	if speed < threshold_walk:
		set_state(&"idle")
	elif speed < threshold_run:
		set_state(&"walk")
	else:
		set_state(&"run")

func play_attack() -> void:
	set_state(&"attack")
`;

// ── Audio bus layout (.tres) + AudioManager ─────────────────────────────────

const AUDIO_BUS_LAYOUT_TRES = `[gd_resource type="AudioBusLayout" format=3]

[resource]
bus/0/name = &"Master"
bus/0/solo = false
bus/0/mute = false
bus/0/bypass_fx = false
bus/0/volume_db = 0.0
bus/0/send = &""
bus/1/name = &"Music"
bus/1/solo = false
bus/1/mute = false
bus/1/bypass_fx = false
bus/1/volume_db = -3.0
bus/1/send = &"Master"
bus/2/name = &"SFX"
bus/2/solo = false
bus/2/mute = false
bus/2/bypass_fx = false
bus/2/volume_db = 0.0
bus/2/send = &"Master"
`;

const AUDIO_MANAGER = `extends Node
# Lightweight audio bus + SFX/Music helper. Register as autoload.
# Buses required: Master, Music, SFX (default_bus_layout.tres ships those).

signal volume_changed(bus: String, db: float)

@export var sfx_pool_size: int = 8

var _music_player: AudioStreamPlayer = null
var _sfx_pool: Array[AudioStreamPlayer] = []

func _ready() -> void:
	_music_player = AudioStreamPlayer.new()
	_music_player.bus = "Music"
	add_child(_music_player)
	for i in sfx_pool_size:
		var p := AudioStreamPlayer.new()
		p.bus = "SFX"
		add_child(p)
		_sfx_pool.append(p)

func play_music(stream: AudioStream, fade_in: float = 0.0) -> void:
	if _music_player == null or stream == null:
		return
	_music_player.stream = stream
	_music_player.volume_db = -40.0 if fade_in > 0.0 else 0.0
	_music_player.play()
	if fade_in > 0.0:
		var t := create_tween()
		t.tween_property(_music_player, "volume_db", 0.0, fade_in)

func stop_music(fade_out: float = 0.3) -> void:
	if _music_player == null or not _music_player.playing:
		return
	if fade_out > 0.0:
		var t := create_tween()
		t.tween_property(_music_player, "volume_db", -40.0, fade_out)
		t.tween_callback(_music_player.stop)
	else:
		_music_player.stop()

func play_sfx(stream: AudioStream, pitch: float = 1.0) -> void:
	if stream == null:
		return
	for p in _sfx_pool:
		if not p.playing:
			p.stream = stream
			p.pitch_scale = pitch
			p.play()
			return

func set_bus_volume(bus: String, db: float) -> void:
	var idx := AudioServer.get_bus_index(bus)
	if idx >= 0:
		AudioServer.set_bus_volume_db(idx, db)
		volume_changed.emit(bus, db)
`;

export function registerBlueprintLibraryAVTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_blueprint_animation_state_machine",
    "AnimationTree state machine helper. Sets up idle/walk/run/attack states + travel API. Attach this script to a node that already owns AnimationPlayer + AnimationTree (you author the actual AnimationLibraries in editor).",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_animation_state_machine", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const sp = `${params.script_dir}/AnimationStateController.gd`;
          const w = await writeIfNew(config.projectRoot, sp, ANIM_STATE_MACHINE_HELPER, true, params.overwrite);
          if (w) await recordScript(config.projectRoot, sp, {});
          await recordBlueprintApplied(config.projectRoot, "animation_state_machine");
          return createSuccessResponse({ files: [sp], next_steps: ["Attach AnimationStateController.gd as a child of your character; assign anim_player_path + anim_tree_path."] }, "animation_state_machine applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_audio_bus",
    "Default 3-bus layout (Master/Music/SFX) + AudioManager autoload (play_music/stop_music/play_sfx pool/set_bus_volume). Writes default_bus_layout.tres at project root and sets up SFX pool of 8 players.",
    {
      ...ParamsSchema,
      bus_layout_path: z.string().optional().default("res://default_bus_layout.tres"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_audio_bus", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const layoutPath = params.bus_layout_path;
          const scriptPath = `${params.script_dir}/AudioManager.gd`;
          const w1 = await writeIfNew(config.projectRoot, layoutPath, AUDIO_BUS_LAYOUT_TRES, false, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, scriptPath, AUDIO_MANAGER, true, params.overwrite);
          if (w2) await recordScript(config.projectRoot, scriptPath, { signals: ["volume_changed"] });
          await recordBlueprintApplied(config.projectRoot, "audio_bus");
          return createSuccessResponse(
            { files: [layoutPath, scriptPath], next_steps: [`Set project setting audio/buses/default_bus_layout=${layoutPath}`, `devpilot_add_autoload name=AudioManager path=${scriptPath}`] },
            "audio_bus applied."
          );
        })
      )
  );
}

export const BLUEPRINT_AV_REGISTRY = [
  { name: "animation_state_machine", description: "AnimationTree state controller (idle/walk/run/attack)", category: "animation", files_created: ["scripts/AnimationStateController.gd"], params_schema: {}, example: {} },
  { name: "audio_bus", description: "3-bus audio layout (Master/Music/SFX) + AudioManager autoload", category: "audio", files_created: ["default_bus_layout.tres", "scripts/AudioManager.gd"], params_schema: {}, example: {} },
];
