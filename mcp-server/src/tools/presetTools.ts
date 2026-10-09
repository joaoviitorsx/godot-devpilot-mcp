import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";
import { serializeSceneToTscn, type SceneSpec, SubRef } from "../utils/sceneSerializer.js";
import { recordScene, recordScript } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// ── Input map presets ────────────────────────────────────────────────────────

type InputBinding = { keys: number[] };
type InputPreset = Record<string, InputBinding>;

// Godot 4 keycodes
const K = {
  A: 65, B: 66, C: 67, D: 68, E: 69, F: 70, G: 71, H: 72, I: 73, J: 74, K: 75, L: 76,
  M: 77, N: 78, O: 79, P: 80, Q: 81, R: 82, S: 83, T: 84, U: 85, V: 86, W: 87,
  X: 88, Y: 89, Z: 90,
  SPACE: 32, ENTER: 4194309, ESC: 4194305, TAB: 4194306,
  LEFT: 4194319, RIGHT: 4194321, UP: 4194320, DOWN: 4194322,
  F1: 4194332, F5: 4194336,
};

const INPUT_PRESETS: Record<string, InputPreset> = {
  twin_stick: {
    move_up: { keys: [K.W, K.UP] },
    move_down: { keys: [K.S, K.DOWN] },
    move_left: { keys: [K.A, K.LEFT] },
    move_right: { keys: [K.D, K.RIGHT] },
    shoot_up: { keys: [K.I] },
    shoot_down: { keys: [K.K] },
    shoot_left: { keys: [K.J] },
    shoot_right: { keys: [K.L] },
    dodge_roll: { keys: [K.SPACE] },
    interact: { keys: [K.E] },
    reload: { keys: [K.R] },
    pause: { keys: [K.ESC] },
    restart: { keys: [K.ENTER] },
  },
  platformer: {
    move_left: { keys: [K.A, K.LEFT] },
    move_right: { keys: [K.D, K.RIGHT] },
    jump: { keys: [K.SPACE, K.W, K.UP] },
    attack: { keys: [K.J, K.X] },
    interact: { keys: [K.E] },
    pause: { keys: [K.ESC] },
  },
  topdown: {
    move_up: { keys: [K.W, K.UP] },
    move_down: { keys: [K.S, K.DOWN] },
    move_left: { keys: [K.A, K.LEFT] },
    move_right: { keys: [K.D, K.RIGHT] },
    interact: { keys: [K.E] },
    attack: { keys: [K.SPACE, K.J] },
    pause: { keys: [K.ESC] },
  },
  fps_3d: {
    move_up: { keys: [K.W] },
    move_down: { keys: [K.S] },
    move_left: { keys: [K.A] },
    move_right: { keys: [K.D] },
    jump: { keys: [K.SPACE] },
    interact: { keys: [K.E] },
    reload: { keys: [K.R] },
    pause: { keys: [K.ESC] },
  },
};

const MOUSE_LEFT_EVENT = `Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":0,"position":Vector2(0, 0),"global_position":Vector2(0, 0),"factor":1.0,"button_index":1,"canceled":false,"pressed":false,"double_click":false,"script":null)`;

function keyEvent(keycode: number): string {
  return `Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":${keycode},"physical_keycode":0,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)`;
}

function formatInputAction(action: string, binding: InputBinding, includeMouseLeft = false): string {
  const events: string[] = binding.keys.map(keyEvent);
  if (includeMouseLeft) events.push(MOUSE_LEFT_EVENT);
  const eventsStr = events.join("\n, ");
  return `${action}={\n"deadzone": 0.5,\n"events": [${eventsStr}\n]\n}`;
}

// ── Physics layer presets ────────────────────────────────────────────────────

const LAYER_PRESETS: Record<string, Record<number, string>> = {
  shooter: { 1: "World", 2: "Player", 3: "Enemies", 4: "PlayerBullets", 5: "EnemyBullets", 6: "Pickups" },
  platformer: { 1: "Floor", 2: "Player", 3: "Enemy", 4: "OneWay", 5: "Hazard" },
  topdown_rpg: { 1: "World", 2: "Player", 3: "Enemy", 4: "Interactable", 5: "Pickup" },
  shooter_3d: { 1: "World", 2: "Player", 3: "Enemies", 4: "PlayerProjectiles", 5: "EnemyProjectiles", 6: "Pickups" },
  fps_3d: { 1: "World", 2: "Player", 3: "Enemies", 4: "Projectiles", 5: "Triggers" },
};

// ── HUD presets (script + scene specs) ───────────────────────────────────────

const HUD_SHOOTER_SCRIPT = `extends CanvasLayer

@onready var hp_label: Label = $Root/HP
@onready var coin_label: Label = $Root/Coins
@onready var ammo_label: Label = $Root/Ammo
@onready var message_label: Label = $Root/Message
@onready var boss_bar: ProgressBar = $Root/BossBar

var _msg_timer: float = 0.0

func set_hp(current: int, max_v: int) -> void:
	hp_label.text = "Vida: %d/%d" % [current, max_v]

func set_coins(amount: int) -> void:
	coin_label.text = "Moedas: %d" % amount

func set_ammo(current: int, max_v: int) -> void:
	ammo_label.text = "Munição: %d/%d" % [current, max_v]

func show_message(text: String, duration: float = 1.5) -> void:
	message_label.text = text
	_msg_timer = duration

func set_boss_health(current: int, max_v: int, visible_now: bool = true) -> void:
	boss_bar.max_value = max_v
	boss_bar.value = current
	boss_bar.visible = visible_now

func _process(delta: float) -> void:
	if _msg_timer > 0.0:
		_msg_timer -= delta
		if _msg_timer <= 0.0:
			message_label.text = ""
`;

const HUD_RPG_SCRIPT = `extends CanvasLayer

@onready var hp_label: Label = $Root/HP
@onready var mp_label: Label = $Root/MP
@onready var xp_label: Label = $Root/XP
@onready var coin_label: Label = $Root/Coins
@onready var message_label: Label = $Root/Message

var _msg_timer: float = 0.0

func set_hp(current: int, max_v: int) -> void:
	hp_label.text = "HP: %d/%d" % [current, max_v]

func set_mp(current: int, max_v: int) -> void:
	mp_label.text = "MP: %d/%d" % [current, max_v]

func set_xp(current: int, next: int, level: int) -> void:
	xp_label.text = "Lv %d  XP: %d/%d" % [level, current, next]

func set_coins(amount: int) -> void:
	coin_label.text = "Ouro: %d" % amount

func show_message(text: String, duration: float = 1.5) -> void:
	message_label.text = text
	_msg_timer = duration

func _process(delta: float) -> void:
	if _msg_timer > 0.0:
		_msg_timer -= delta
		if _msg_timer <= 0.0:
			message_label.text = ""
`;

const HUD_SURVIVOR_SCRIPT = `extends CanvasLayer

@onready var hp_label: Label = $Root/HP
@onready var wave_label: Label = $Root/Wave
@onready var kills_label: Label = $Root/Kills
@onready var timer_label: Label = $Root/Timer
@onready var xp_bar: ProgressBar = $Root/XPBar

func set_hp(current: int, max_v: int) -> void:
	hp_label.text = "Vida: %d/%d" % [current, max_v]

func set_wave(n: int) -> void:
	wave_label.text = "Onda: %d" % n

func set_kills(n: int) -> void:
	kills_label.text = "Kills: %d" % n

func set_time(seconds: int) -> void:
	timer_label.text = "Tempo: %02d:%02d" % [seconds / 60, seconds % 60]

func set_xp(current: int, next: int) -> void:
	xp_bar.max_value = next
	xp_bar.value = current
`;

function specHudShooter(scriptPath: string): SceneSpec {
  const lbl = (name: string, x: number, y: number, w: number, text: string) => ({
    name, type: "Label",
    props: {
      offset_left: x, offset_top: y, offset_right: x + w, offset_bottom: y + 24,
      text,
    },
  });
  return {
    path: "res://scenes/HUD.tscn",
    ext_resources: [{ id: "h_script", type: "Script", path: scriptPath }],
    root: {
      name: "HUD", type: "CanvasLayer", script: "h_script",
      children: [
        {
          name: "Root", type: "Control", props: { anchor_right: 1.0, anchor_bottom: 1.0 },
          children: [
            lbl("HP", 16, 12, 264, "Vida: 6/6"),
            lbl("Coins", 16, 36, 264, "Moedas: 0"),
            lbl("Ammo", 16, 60, 264, "Munição: 8/8"),
            lbl("Message", 0, 120, 1280, ""),
            { name: "BossBar", type: "ProgressBar", props: { anchor_left: 0.5, anchor_right: 0.5, offset_left: -200, offset_top: 50, offset_right: 200, offset_bottom: 70, max_value: 30.0, value: 30.0, visible: false } },
          ],
        },
      ],
    },
  };
}

function specHudRpg(scriptPath: string): SceneSpec {
  const lbl = (name: string, x: number, y: number, w: number, text: string) => ({
    name, type: "Label",
    props: { offset_left: x, offset_top: y, offset_right: x + w, offset_bottom: y + 24, text },
  });
  return {
    path: "res://scenes/HUD.tscn",
    ext_resources: [{ id: "h_script", type: "Script", path: scriptPath }],
    root: {
      name: "HUD", type: "CanvasLayer", script: "h_script",
      children: [
        {
          name: "Root", type: "Control", props: { anchor_right: 1.0, anchor_bottom: 1.0 },
          children: [
            lbl("HP", 16, 12, 264, "HP: 100/100"),
            lbl("MP", 16, 36, 264, "MP: 50/50"),
            lbl("XP", 16, 60, 264, "Lv 1  XP: 0/100"),
            lbl("Coins", 16, 84, 264, "Ouro: 0"),
            lbl("Message", 0, 140, 1280, ""),
          ],
        },
      ],
    },
  };
}

const HUD_FPS_3D_SCRIPT = `extends CanvasLayer

@onready var hp_label: Label = $Root/HP
@onready var ammo_label: Label = $Root/Ammo
@onready var crosshair: ColorRect = $Root/Crosshair

func set_hp(current: int, max_v: int) -> void:
	hp_label.text = "%d/%d" % [current, max_v]

func set_ammo(current: int, max_v: int) -> void:
	ammo_label.text = "AMMO %d/%d" % [current, max_v]
`;

function specHudFps3D(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/HUD.tscn",
    ext_resources: [{ id: "h_script", type: "Script", path: scriptPath }],
    root: {
      name: "HUD", type: "CanvasLayer", script: "h_script",
      children: [
        {
          name: "Root", type: "Control", props: { anchor_right: 1.0, anchor_bottom: 1.0 },
          children: [
            {
              name: "Crosshair", type: "ColorRect",
              props: { anchor_left: 0.5, anchor_top: 0.5, anchor_right: 0.5, anchor_bottom: 0.5, offset_left: -2, offset_top: -2, offset_right: 2, offset_bottom: 2, color: { r: 1, g: 1, b: 1, a: 0.85 } },
            },
            { name: "HP", type: "Label", props: { offset_left: 32, offset_top: 660, offset_right: 220, offset_bottom: 700, text: "100/100" } },
            { name: "Ammo", type: "Label", props: { offset_left: 1080, offset_top: 660, offset_right: 1248, offset_bottom: 700, text: "AMMO 30/30", horizontal_alignment: 2 } },
          ],
        },
      ],
    },
  };
}

function specHudSurvivor(scriptPath: string): SceneSpec {
  const lbl = (name: string, x: number, y: number, w: number, text: string) => ({
    name, type: "Label",
    props: { offset_left: x, offset_top: y, offset_right: x + w, offset_bottom: y + 24, text },
  });
  return {
    path: "res://scenes/HUD.tscn",
    ext_resources: [{ id: "h_script", type: "Script", path: scriptPath }],
    root: {
      name: "HUD", type: "CanvasLayer", script: "h_script",
      children: [
        {
          name: "Root", type: "Control", props: { anchor_right: 1.0, anchor_bottom: 1.0 },
          children: [
            lbl("HP", 16, 12, 264, "Vida: 100/100"),
            lbl("Wave", 16, 36, 264, "Onda: 1"),
            lbl("Kills", 16, 60, 264, "Kills: 0"),
            lbl("Timer", 16, 84, 264, "Tempo: 00:00"),
            { name: "XPBar", type: "ProgressBar", props: { offset_left: 16, offset_top: 110, offset_right: 280, offset_bottom: 130, max_value: 100, value: 0 } },
          ],
        },
      ],
    },
  };
}

// ── project.godot section editor ─────────────────────────────────────────────

async function readProjectGodotRaw(projectRoot: string): Promise<string> {
  const file = path.join(projectRoot, "project.godot");
  return await readFile(file, "utf8");
}

async function writeProjectGodotRaw(projectRoot: string, content: string): Promise<void> {
  const file = path.join(projectRoot, "project.godot");
  await writeFile(file, content, "utf8");
}

function ensureSection(content: string, sectionName: string, body: string): string {
  // body should start with newline + entries, end with newline.
  const re = new RegExp(`(\\[${sectionName}\\][\\s\\S]*?)(?=\\n\\[|$)`);
  if (re.test(content)) {
    return content.replace(re, `[${sectionName}]\n${body.trimStart()}`);
  }
  // Append section at end.
  if (!content.endsWith("\n")) content += "\n";
  return content + `\n[${sectionName}]\n${body.trimStart()}\n`;
}

function buildInputBody(preset: InputPreset, includeMouseLeft = false): string {
  const lines: string[] = [];
  for (const [action, binding] of Object.entries(preset)) {
    const useMouse = includeMouseLeft && action === "shoot_mouse";
    lines.push(formatInputAction(action, binding, useMouse));
  }
  return lines.join("\n");
}

function buildInputBodyWithMouse(preset: InputPreset): string {
  // Add shoot_mouse with LMB as bonus action when twin_stick.
  const mouseAction = `shoot_mouse={\n"deadzone": 0.5,\n"events": [${MOUSE_LEFT_EVENT}\n]\n}`;
  const body = buildInputBody(preset);
  return body + "\n" + mouseAction;
}

function buildLayersBody(layers: Record<number, string>): string {
  const lines: string[] = [];
  for (const [idx, name] of Object.entries(layers)) {
    lines.push(`2d_physics/layer_${idx}="${name}"`);
  }
  return lines.join("\n");
}

// ── Tool registration ────────────────────────────────────────────────────────

const PresetCategory = z.enum(["input_map", "physics_layers", "hud"]);

export function registerPresetTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_list_presets",
    "List available presets per category. Categories: input_map (twin_stick, platformer, topdown), physics_layers (shooter, platformer, topdown_rpg), hud (shooter, rpg, survivor).",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_list_presets", config), async (): Promise<ToolResponse> => {
          return createSuccessResponse(
            {
              input_map: Object.keys(INPUT_PRESETS),
              physics_layers: Object.keys(LAYER_PRESETS),
              hud: ["shooter", "rpg", "survivor", "fps_3d"],
            },
            "Presets listed."
          );
        })
      )
  );

  server.tool(
    "devpilot_apply_preset",
    "Apply a preset by category + name. input_map writes [input] section to project.godot. physics_layers writes [layer_names]. hud generates scenes/HUD.tscn + scripts/HUD.gd. Existing entries are replaced.",
    {
      category: PresetCategory,
      name: z.string().describe("Preset name (see devpilot_list_presets)."),
      overwrite: z.boolean().optional().default(false).describe("For HUD: overwrite existing files."),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_apply_preset", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) {
            return createErrorResponse("READ_ONLY", "Cannot apply preset in read-only mode.", {}, []);
          }

          if (params.category === "input_map") {
            const preset = INPUT_PRESETS[params.name];
            if (!preset) return createErrorResponse("PRESET_NOT_FOUND", "Unknown input_map preset.", { name: params.name, available: Object.keys(INPUT_PRESETS) }, []);
            const body = params.name === "twin_stick" ? buildInputBodyWithMouse(preset) : buildInputBody(preset);
            const content = await readProjectGodotRaw(config.projectRoot);
            const updated = ensureSection(content, "input", body + "\n");
            await writeProjectGodotRaw(config.projectRoot, updated);
            return createSuccessResponse({ category: "input_map", name: params.name, actions: Object.keys(preset).length + (params.name === "twin_stick" ? 1 : 0) }, `Input preset '${params.name}' applied.`);
          }

          if (params.category === "physics_layers") {
            const preset = LAYER_PRESETS[params.name];
            if (!preset) return createErrorResponse("PRESET_NOT_FOUND", "Unknown physics_layers preset.", { name: params.name, available: Object.keys(LAYER_PRESETS) }, []);
            const body = buildLayersBody(preset);
            const content = await readProjectGodotRaw(config.projectRoot);
            const updated = ensureSection(content, "layer_names", body + "\n");
            await writeProjectGodotRaw(config.projectRoot, updated);
            return createSuccessResponse({ category: "physics_layers", name: params.name, layers: Object.keys(preset).length }, `Physics layer preset '${params.name}' applied.`);
          }

          if (params.category === "hud") {
            const scriptPath = "res://scripts/HUD.gd";
            const sceneOwn: { script: string; spec: SceneSpec } = (() => {
              if (params.name === "rpg") return { script: HUD_RPG_SCRIPT, spec: specHudRpg(scriptPath) };
              if (params.name === "survivor") return { script: HUD_SURVIVOR_SCRIPT, spec: specHudSurvivor(scriptPath) };
              if (params.name === "fps_3d") return { script: HUD_FPS_3D_SCRIPT, spec: specHudFps3D(scriptPath) };
              return { script: HUD_SHOOTER_SCRIPT, spec: specHudShooter(scriptPath) };
            })();
            const scriptResolved = resolveProjectPath(scriptPath, config.projectRoot);
            const sceneResolved = resolveProjectPath(sceneOwn.spec.path, config.projectRoot);
            if (await fileExists(scriptResolved.absolutePath) && !params.overwrite) {
              return createErrorResponse("EXISTS", "HUD.gd already exists; pass overwrite=true.", { path: scriptPath }, []);
            }
            await mkdir(path.dirname(scriptResolved.absolutePath), { recursive: true });
            await writeFile(scriptResolved.absolutePath, autoFixGDScript(sceneOwn.script), "utf8");
            await mkdir(path.dirname(sceneResolved.absolutePath), { recursive: true });
            await writeFile(sceneResolved.absolutePath, serializeSceneToTscn(sceneOwn.spec), "utf8");
            await recordScript(config.projectRoot, scriptPath, {});
            await recordScene(config.projectRoot, sceneOwn.spec.path, "hud", [scriptPath]);
            return createSuccessResponse({ category: "hud", name: params.name, files: [scriptPath, sceneOwn.spec.path] }, `HUD preset '${params.name}' applied.`);
          }

          return createErrorResponse("INVALID_PARAMS", "Unknown category.", { category: params.category }, []);
        })
      )
  );
}

// expose SubRef in case HUD specs are extended later
void SubRef;
