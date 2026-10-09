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

async function writeIfNew(projectRoot: string, resPath: string, content: string, isGd: boolean, overwrite: boolean): Promise<boolean> {
  const r = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return false;
  await mkdir(path.dirname(r.absolutePath), { recursive: true });
  await writeFile(r.absolutePath, isGd ? autoFixGDScript(content) : content, "utf8");
  return true;
}

const ParamsSchema = {
  script_dir: z.string().optional().default("res://scripts"),
  scenes_dir: z.string().optional().default("res://scenes"),
  shaders_dir: z.string().optional().default("res://shaders"),
  overwrite: z.boolean().optional().default(false),
};

// ── Behavior tree ────────────────────────────────────────────────────────────

const BT_NODE = `extends Resource
class_name BTNode

enum Status { SUCCESS, FAILURE, RUNNING }

# Override in subclasses. Returns Status.
func tick(_ctx) -> int:
	return Status.SUCCESS
`;

const BT_SEQUENCE = `extends BTNode
class_name BTSequence

@export var children: Array[BTNode] = []

func tick(ctx) -> int:
	for c in children:
		var s := c.tick(ctx)
		if s == Status.FAILURE:
			return Status.FAILURE
		if s == Status.RUNNING:
			return Status.RUNNING
	return Status.SUCCESS
`;

const BT_SELECTOR = `extends BTNode
class_name BTSelector

@export var children: Array[BTNode] = []

func tick(ctx) -> int:
	for c in children:
		var s := c.tick(ctx)
		if s == Status.SUCCESS:
			return Status.SUCCESS
		if s == Status.RUNNING:
			return Status.RUNNING
	return Status.FAILURE
`;

const BT_LEAF_MOVE = `extends BTNode
class_name BTMoveTo

@export var arrival_threshold: float = 6.0

func tick(ctx) -> int:
	var actor = ctx.get("actor", null)
	var target: Vector2 = ctx.get("target", Vector2.ZERO)
	if actor == null:
		return Status.FAILURE
	var to_target := target - actor.global_position
	if to_target.length() <= arrival_threshold:
		return Status.SUCCESS
	actor.velocity = to_target.normalized() * actor.get("speed")
	actor.move_and_slide()
	return Status.RUNNING
`;

const BT_RUNNER = `extends Node
class_name BTRunner

@export var root_node: BTNode
@export var actor_path: NodePath
@export var tick_interval: float = 0.1

var _ctx: Dictionary = {}
var _timer: float = 0.0

func _ready() -> void:
	if actor_path != NodePath(""):
		_ctx["actor"] = get_node_or_null(actor_path)

func _process(delta: float) -> void:
	_timer -= delta
	if _timer > 0.0 or root_node == null:
		return
	root_node.tick(_ctx)
	_timer = tick_interval

func set_blackboard(key: String, value) -> void:
	_ctx[key] = value
`;

// ── VFX library ──────────────────────────────────────────────────────────────

const VFX_BURST = `extends GPUParticles2D
class_name VFXBurst

@export var auto_free: bool = true
@export var lifetime_padding: float = 0.5

func play() -> void:
	emitting = true
	if auto_free:
		await get_tree().create_timer(lifetime + lifetime_padding).timeout
		queue_free()
`;

function specVfxParticles(name: string, color: { r: number; g: number; b: number; a: number }, scriptPath: string, opts: { gravity?: number; lifetime?: number; amount?: number; scale_min?: number; scale_max?: number }): SceneSpec {
  return {
    path: `res://scenes/vfx/VFX_${name}.tscn`,
    ext_resources: [{ id: "vfx_script", type: "Script", path: scriptPath }],
    sub_resources: [
      {
        id: "PM",
        type: "ParticleProcessMaterial",
        props: {
          gravity: { x: 0, y: opts.gravity ?? 0, z: 0 },
          initial_velocity_min: 60,
          initial_velocity_max: 220,
          scale_min: opts.scale_min ?? 0.3,
          scale_max: opts.scale_max ?? 1.0,
          color: color,
          spread: 180.0,
        },
      },
    ],
    root: {
      name: `VFX_${name}`, type: "GPUParticles2D", script: "vfx_script",
      props: {
        emitting: false,
        amount: opts.amount ?? 24,
        lifetime: opts.lifetime ?? 0.6,
        one_shot: true,
        explosiveness: 0.85,
        process_material: SubRef("PM"),
      },
    },
  };
}

// ── Scene transitions ────────────────────────────────────────────────────────

const SCENE_TRANSITIONS = `extends CanvasLayer
# Autoload-ready overlay that fades to black between scenes.
# Usage: await SceneTransitions.fade_to_scene("res://scenes/Next.tscn", 0.3)

signal transition_started
signal transition_finished

@export var fade_duration: float = 0.35

var _overlay: ColorRect

func _ready() -> void:
	layer = 100
	_overlay = ColorRect.new()
	_overlay.color = Color(0, 0, 0, 0)
	_overlay.anchor_right = 1.0
	_overlay.anchor_bottom = 1.0
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_overlay)

func fade_to_scene(path: String, duration: float = -1.0) -> void:
	if duration < 0.0:
		duration = fade_duration
	transition_started.emit()
	var t := create_tween()
	t.tween_property(_overlay, "color", Color(0, 0, 0, 1), duration)
	await t.finished
	get_tree().change_scene_to_file(path)
	t = create_tween()
	t.tween_property(_overlay, "color", Color(0, 0, 0, 0), duration)
	await t.finished
	transition_finished.emit()

func flash(color: Color = Color(1, 1, 1, 0.5), duration: float = 0.15) -> void:
	_overlay.color = color
	var t := create_tween()
	t.tween_property(_overlay, "color", Color(0, 0, 0, 0), duration)
	await t.finished
`;

// ── Settings manager ────────────────────────────────────────────────────────

const SETTINGS_MANAGER = `extends Node
# Persistent settings stored at user://settings.cfg.
# Reads/writes audio bus volumes, fullscreen, vsync, and arbitrary key/value.

const PATH := "user://settings.cfg"

signal setting_changed(key: String, value)

var _config: ConfigFile = ConfigFile.new()

func _ready() -> void:
	_load()
	_apply_audio()
	_apply_video()

func _load() -> void:
	if FileAccess.file_exists(PATH):
		_config.load(PATH)

func save() -> void:
	_config.save(PATH)

func get_value(section: String, key: String, default = null):
	return _config.get_value(section, key, default)

func set_value(section: String, key: String, value) -> void:
	_config.set_value(section, key, value)
	setting_changed.emit("%s/%s" % [section, key], value)
	save()

func _apply_audio() -> void:
	for bus_name in ["Master", "Music", "SFX"]:
		var idx := AudioServer.get_bus_index(bus_name)
		if idx < 0:
			continue
		var v: float = float(_config.get_value("audio", bus_name, 0.0))
		AudioServer.set_bus_volume_db(idx, v)

func _apply_video() -> void:
	var fullscreen: bool = bool(_config.get_value("video", "fullscreen", false))
	if fullscreen:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	var vsync_on: bool = bool(_config.get_value("video", "vsync", true))
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if vsync_on else DisplayServer.VSYNC_DISABLED)

func set_bus_volume(bus: String, db: float) -> void:
	set_value("audio", bus, db)
	_apply_audio()

func set_fullscreen(on: bool) -> void:
	set_value("video", "fullscreen", on)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if on else DisplayServer.WINDOW_MODE_WINDOWED)

func set_vsync(on: bool) -> void:
	set_value("video", "vsync", on)
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if on else DisplayServer.VSYNC_DISABLED)
`;

// ── Shader library ──────────────────────────────────────────────────────────

const SHADER_OUTLINE = `shader_type canvas_item;
uniform vec4 outline_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float outline_width : hint_range(0.0, 4.0) = 1.0;

void fragment() {
	vec4 base = texture(TEXTURE, UV);
	vec2 size = TEXTURE_PIXEL_SIZE * outline_width;
	float alpha = base.a;
	alpha = max(alpha, texture(TEXTURE, UV + vec2(size.x, 0.0)).a);
	alpha = max(alpha, texture(TEXTURE, UV - vec2(size.x, 0.0)).a);
	alpha = max(alpha, texture(TEXTURE, UV + vec2(0.0, size.y)).a);
	alpha = max(alpha, texture(TEXTURE, UV - vec2(0.0, size.y)).a);
	if (base.a < 0.05 && alpha > 0.05) {
		COLOR = outline_color;
	} else {
		COLOR = base;
	}
}
`;

const SHADER_HIT_FLASH = `shader_type canvas_item;
uniform float flash_intensity : hint_range(0.0, 1.0) = 0.0;
uniform vec4 flash_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);

void fragment() {
	vec4 c = texture(TEXTURE, UV);
	COLOR = mix(c, vec4(flash_color.rgb, c.a), flash_intensity);
}
`;

const SHADER_PIXELATE = `shader_type canvas_item;
uniform float pixel_size : hint_range(1.0, 32.0) = 4.0;

void fragment() {
	vec2 size = TEXTURE_PIXEL_SIZE * pixel_size;
	vec2 uv = floor(UV / size) * size;
	COLOR = texture(TEXTURE, uv);
}
`;

const SHADER_DISSOLVE = `shader_type canvas_item;
uniform sampler2D noise;
uniform float threshold : hint_range(0.0, 1.0) = 0.0;
uniform vec4 edge_color : source_color = vec4(1.0, 0.5, 0.0, 1.0);
uniform float edge_width : hint_range(0.0, 0.2) = 0.05;

void fragment() {
	vec4 c = texture(TEXTURE, UV);
	float n = texture(noise, UV).r;
	if (n < threshold) {
		discard;
	} else if (n < threshold + edge_width) {
		COLOR = edge_color;
	} else {
		COLOR = c;
	}
}
`;

const SHADER_WATER = `shader_type canvas_item;
uniform float time_speed : hint_range(0.0, 4.0) = 0.6;
uniform float wave_amount : hint_range(0.0, 0.05) = 0.01;

void fragment() {
	vec2 uv = UV;
	uv.x += sin(uv.y * 20.0 + TIME * time_speed) * wave_amount;
	uv.y += cos(uv.x * 20.0 + TIME * time_speed) * wave_amount;
	COLOR = texture(TEXTURE, uv);
}
`;

// ── Navigation integration ──────────────────────────────────────────────────

const NAV_AGENT_CONTROLLER_2D = `extends Node
# Bridge that drives a CharacterBody2D parent toward a navigation goal using
# NavigationAgent2D. Attach as child of the body; assign target at runtime.

@export var speed: float = 120.0
@export var arrival_threshold: float = 8.0

var agent: NavigationAgent2D = null
var target: Vector2 = Vector2.ZERO

func _ready() -> void:
	for c in get_parent().get_children():
		if c is NavigationAgent2D:
			agent = c
			break
	if agent == null:
		agent = NavigationAgent2D.new()
		get_parent().add_child(agent)

func set_target(world_pos: Vector2) -> void:
	target = world_pos
	if agent:
		agent.target_position = world_pos

func _physics_process(_delta: float) -> void:
	var body = get_parent()
	if agent == null or body == null or not body.has_method("move_and_slide"):
		return
	if agent.is_navigation_finished():
		body.velocity = Vector2.ZERO
		return
	var next: Vector2 = agent.get_next_path_position()
	var dir := (next - body.global_position).normalized()
	body.velocity = dir * speed
	body.move_and_slide()
`;

// ── Tool registration ────────────────────────────────────────────────────────

export function registerBlueprintLibraryAdvancedTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_blueprint_behavior_tree",
    "Behavior tree library: BTNode base + BTSequence + BTSelector + BTMoveTo example leaf + BTRunner Node. Wire by composing BTNode resources + assigning to a BTRunner.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_behavior_tree", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const dir = params.script_dir;
          const files: Array<[string, string]> = [
            [`${dir}/BTNode.gd`, BT_NODE],
            [`${dir}/BTSequence.gd`, BT_SEQUENCE],
            [`${dir}/BTSelector.gd`, BT_SELECTOR],
            [`${dir}/BTMoveTo.gd`, BT_LEAF_MOVE],
            [`${dir}/BTRunner.gd`, BT_RUNNER],
          ];
          for (const [p, c] of files) await writeIfNew(config.projectRoot, p, c, true, params.overwrite);
          await recordBlueprintApplied(config.projectRoot, "behavior_tree", { template_version: "0.4.0" });
          for (const [p] of files) await recordScript(config.projectRoot, p, {});
          return createSuccessResponse({ files: files.map(([p]) => p) }, "behavior_tree applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_vfx_library",
    "VFX library: 5 GPUParticles2D scenes (explosion, fire, blood, sparkle, dust) + VFXBurst helper script (auto-emit + queue_free). Each is one_shot/explosiveness preset.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_vfx_library", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const scriptPath = `${params.script_dir}/VFXBurst.gd`;
          await writeIfNew(config.projectRoot, scriptPath, VFX_BURST, true, params.overwrite);
          const presets: Array<[string, { r: number; g: number; b: number; a: number }, Record<string, number>]> = [
            ["explosion", { r: 1, g: 0.6, b: 0.2, a: 1 }, { lifetime: 0.7, amount: 32, gravity: -100, scale_min: 0.4, scale_max: 1.2 }],
            ["fire", { r: 1, g: 0.4, b: 0.1, a: 1 }, { lifetime: 0.9, amount: 24, gravity: -200 }],
            ["blood", { r: 0.7, g: 0.05, b: 0.1, a: 1 }, { lifetime: 0.5, amount: 16, gravity: 280 }],
            ["sparkle", { r: 1, g: 0.95, b: 0.4, a: 1 }, { lifetime: 0.6, amount: 20, scale_min: 0.2, scale_max: 0.6 }],
            ["dust", { r: 0.65, g: 0.6, b: 0.55, a: 1 }, { lifetime: 0.7, amount: 14, gravity: 60 }],
          ];
          const written: string[] = [];
          for (const [name, color, opts] of presets) {
            const spec = specVfxParticles(name, color, scriptPath, opts);
            spec.path = `${params.scenes_dir}/vfx/VFX_${name}.tscn`;
            const ok = await writeIfNew(config.projectRoot, spec.path, serializeSceneToTscn(spec), false, params.overwrite);
            if (ok) {
              written.push(spec.path);
              await recordScene(config.projectRoot, spec.path, "vfx", [scriptPath]);
            }
          }
          await recordScript(config.projectRoot, scriptPath, {});
          await recordBlueprintApplied(config.projectRoot, "vfx_library", { template_version: "0.4.0" });
          return createSuccessResponse({ files: [scriptPath, ...written] }, `vfx_library applied (${written.length} preset(s)).`);
        })
      )
  );

  server.tool(
    "devpilot_blueprint_scene_transitions",
    "SceneTransitions autoload: ColorRect overlay that fades to black between scenes. Methods: fade_to_scene(path, duration), flash(color, duration). Register as autoload manually.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_scene_transitions", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const sp = `${params.script_dir}/SceneTransitions.gd`;
          const w = await writeIfNew(config.projectRoot, sp, SCENE_TRANSITIONS, true, params.overwrite);
          if (w) await recordScript(config.projectRoot, sp, { signals: ["transition_started", "transition_finished"] });
          await recordBlueprintApplied(config.projectRoot, "scene_transitions", { template_version: "0.4.0" });
          return createSuccessResponse({ files: [sp], next_steps: [`devpilot_add_autoload name=SceneTransitions path=${sp}`] }, "scene_transitions applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_settings_manager",
    "SettingsManager autoload: persists user://settings.cfg. Helpers set_bus_volume, set_fullscreen, set_vsync, set_value/get_value. Auto-applies audio + video on _ready.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_settings_manager", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const sp = `${params.script_dir}/SettingsManager.gd`;
          const w = await writeIfNew(config.projectRoot, sp, SETTINGS_MANAGER, true, params.overwrite);
          if (w) await recordScript(config.projectRoot, sp, { signals: ["setting_changed"] });
          await recordBlueprintApplied(config.projectRoot, "settings_manager", { template_version: "0.4.0" });
          return createSuccessResponse({ files: [sp], next_steps: [`devpilot_add_autoload name=SettingsManager path=${sp}`] }, "settings_manager applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_shader_library",
    "5 canvas_item shaders: outline, hit_flash, pixelate, dissolve, water. Apply via ShaderMaterial on Sprite2D. Each .gdshader file in shaders/.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_shader_library", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const dir = params.shaders_dir;
          const files: Array<[string, string]> = [
            [`${dir}/outline.gdshader`, SHADER_OUTLINE],
            [`${dir}/hit_flash.gdshader`, SHADER_HIT_FLASH],
            [`${dir}/pixelate.gdshader`, SHADER_PIXELATE],
            [`${dir}/dissolve.gdshader`, SHADER_DISSOLVE],
            [`${dir}/water.gdshader`, SHADER_WATER],
          ];
          for (const [p, c] of files) await writeIfNew(config.projectRoot, p, c, false, params.overwrite);
          await recordBlueprintApplied(config.projectRoot, "shader_library", { template_version: "0.4.0" });
          return createSuccessResponse({ files: files.map(([p]) => p) }, "shader_library applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_navigation",
    "Navigation integration: NavAgentController helper that drives a CharacterBody2D parent through NavigationAgent2D pathfinding. Attach to enemy bodies. set_target(pos) updates goal.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_navigation", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const sp = `${params.script_dir}/NavAgentController.gd`;
          const w = await writeIfNew(config.projectRoot, sp, NAV_AGENT_CONTROLLER_2D, true, params.overwrite);
          if (w) await recordScript(config.projectRoot, sp, {});
          await recordBlueprintApplied(config.projectRoot, "navigation", { template_version: "0.4.0" });
          return createSuccessResponse({ files: [sp], next_steps: ["Set up NavigationRegion2D + bake polygon manually or via godot_setup_navigation_region_2d.", "Attach NavAgentController.gd as child of enemies."] }, "navigation applied.");
        })
      )
  );
}

export const BLUEPRINT_ADVANCED_REGISTRY = [
  { name: "behavior_tree", description: "BTNode + Sequence/Selector + Runner (composable AI)", category: "ai", files_created: ["scripts/BT*.gd"], params_schema: {}, example: {} },
  { name: "vfx_library", description: "5 GPUParticles2D presets (explosion/fire/blood/sparkle/dust)", category: "fx", files_created: ["scripts/VFXBurst.gd", "scenes/vfx/*.tscn"], params_schema: {}, example: {} },
  { name: "scene_transitions", description: "Fade overlay autoload (SceneTransitions)", category: "ui", files_created: ["scripts/SceneTransitions.gd"], params_schema: {}, example: {} },
  { name: "settings_manager", description: "Persistent settings autoload (user://settings.cfg)", category: "infra", files_created: ["scripts/SettingsManager.gd"], params_schema: {}, example: {} },
  { name: "shader_library", description: "5 canvas_item shaders (outline, hit_flash, pixelate, dissolve, water)", category: "fx", files_created: ["shaders/*.gdshader"], params_schema: {}, example: {} },
  { name: "navigation", description: "NavAgentController for CharacterBody2D + NavigationAgent2D", category: "ai", files_created: ["scripts/NavAgentController.gd"], params_schema: {}, example: {} },
];
