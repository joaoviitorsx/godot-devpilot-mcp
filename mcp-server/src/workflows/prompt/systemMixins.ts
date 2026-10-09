import type { ServerConfig } from "../../config/config.js";
import type { GodotClient } from "../../godot/client.js";
import type { ToolResponse } from "../../godot/protocol.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

import type { GameDesignPlan } from "../../tools/prototypeTools.js";
import { autoFixGDScript } from "../../utils/gdscriptLint.js";

type StepResult = { step: string; ok: boolean; data?: unknown; error?: unknown };

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function writeIfMissing(projectRoot: string, resPath: string, content: string): Promise<{ written: boolean; absPath: string }> {
  const rel = resPath.replace(/^res:\/\//, "");
  const abs = path.join(projectRoot, rel);
  if (await fileExists(abs)) return { written: false, absPath: abs };
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, autoFixGDScript(content), "utf8");
  return { written: true, absPath: abs };
}

// ── Templates ────────────────────────────────────────────────────────────────

const HUD_SCRIPT = `extends CanvasLayer

@export var max_health: int = 100

@onready var health_bar: ProgressBar = $Root/HealthBar
@onready var score_label: Label = $Root/ScoreLabel

var _score: int = 0
var _health: int = 100

func _ready() -> void:
\tif health_bar:
\t\thealth_bar.max_value = max_health
\t\thealth_bar.value = max_health
\tif score_label:
\t\tscore_label.text = "Score: 0"

func set_health(value: int) -> void:
\t_health = clamp(value, 0, max_health)
\tif health_bar:
\t\thealth_bar.value = _health

func add_score(delta: int) -> void:
\t_score += delta
\tif score_label:
\t\tscore_label.text = "Score: %d" % _score
`;

const SAVE_SCRIPT = `extends Node
# SaveSystem — register as autoload (Project Settings → Autoload).
# Stores a JSON snapshot at user://save.json.

const SAVE_PATH := "user://save.json"

func save_game(state: Dictionary) -> void:
\tvar f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
\tif f == null:
\t\tpush_warning("SaveSystem: cannot open %s for write" % SAVE_PATH)
\t\treturn
\tf.store_string(JSON.stringify(state))

func load_game() -> Dictionary:
\tif not FileAccess.file_exists(SAVE_PATH):
\t\treturn {}
\tvar f := FileAccess.open(SAVE_PATH, FileAccess.READ)
\tif f == null:
\t\treturn {}
\tvar text := f.get_as_text()
\tvar parsed: Variant = JSON.parse_string(text)
\tif typeof(parsed) == TYPE_DICTIONARY:
\t\treturn parsed
\treturn {}

func has_save() -> bool:
\treturn FileAccess.file_exists(SAVE_PATH)
`;

const INVENTORY_SCRIPT = `extends Node
# Inventory — autoload-ready item store with signals.

signal item_added(id: StringName, count: int)
signal item_removed(id: StringName, count: int)
signal inventory_changed()

var _items: Dictionary = {}

func add_item(id: StringName, count: int = 1) -> void:
\t_items[id] = (_items.get(id, 0) as int) + count
\titem_added.emit(id, count)
\tinventory_changed.emit()

func remove_item(id: StringName, count: int = 1) -> bool:
\tvar have: int = _items.get(id, 0)
\tif have < count:
\t\treturn false
\t_items[id] = have - count
\tif _items[id] <= 0:
\t\t_items.erase(id)
\titem_removed.emit(id, count)
\tinventory_changed.emit()
\treturn true

func count_of(id: StringName) -> int:
\treturn _items.get(id, 0)

func snapshot() -> Dictionary:
\treturn _items.duplicate(true)
`;

const DIALOGUE_SCRIPT = `extends CanvasLayer

signal advanced
signal finished

@onready var label: Label = $Root/Panel/Label
@onready var name_label: Label = $Root/Panel/NameLabel

var _lines: Array = []
var _index: int = 0

func play(lines: Array) -> void:
\t_lines = lines
\t_index = 0
\tvisible = true
\t_show_current()

func advance() -> void:
\t_index += 1
\tif _index >= _lines.size():
\t\tvisible = false
\t\tfinished.emit()
\t\treturn
\t_show_current()
\tadvanced.emit()

func _show_current() -> void:
\tif _index >= _lines.size():
\t\treturn
\tvar line: Variant = _lines[_index]
\tif typeof(line) == TYPE_DICTIONARY:
\t\tname_label.text = line.get("name", "")
\t\tlabel.text = line.get("text", "")
\telse:
\t\tname_label.text = ""
\t\tlabel.text = String(line)

func _unhandled_input(event: InputEvent) -> void:
\tif visible and event.is_action_pressed("ui_accept"):
\t\tadvance()
`;

// ── Mixin contract ───────────────────────────────────────────────────────────

type MixinContext = {
  godot: GodotClient;
  config: ServerConfig;
  plan: GameDesignPlan;
  steps: StepResult[];
  files_created: string[];
};

async function run(ctx: MixinContext, label: string, fn: () => Promise<ToolResponse>): Promise<ToolResponse> {
  const r = await fn();
  ctx.steps.push({ step: label, ok: r.ok, data: r.ok ? r.data : undefined, error: r.ok ? undefined : r.error });
  return r;
}

// HUD: CanvasLayer with HealthBar + ScoreLabel.
async function applyHudMixin(ctx: MixinContext): Promise<void> {
  const scriptPath = "res://scripts/HUD.gd";
  const w = await writeIfMissing(ctx.config.projectRoot, scriptPath, HUD_SCRIPT);
  if (w.written) ctx.files_created.push(scriptPath);

  await run(ctx, "hud_create_layer", () => callRpc(ctx.godot, "node.add", { parent_path: ".", node_type: "CanvasLayer", node_name: "HUD" }));
  await run(ctx, "hud_create_root", () => callRpc(ctx.godot, "node.add", { parent_path: "HUD", node_type: "Control", node_name: "Root" }));
  await run(ctx, "hud_set_root_anchor", () => callRpc(ctx.godot, "node.set_property", { node_path: "HUD/Root", property: "anchor_right", value: 1.0 }));
  await run(ctx, "hud_set_root_anchor_b", () => callRpc(ctx.godot, "node.set_property", { node_path: "HUD/Root", property: "anchor_bottom", value: 1.0 }));
  await run(ctx, "hud_create_healthbar", () => callRpc(ctx.godot, "node.add", { parent_path: "HUD/Root", node_type: "ProgressBar", node_name: "HealthBar" }));
  await run(ctx, "hud_set_health_pos", () => callRpc(ctx.godot, "node.set_property", { node_path: "HUD/Root/HealthBar", property: "position", value: { x: 16, y: 16 } }));
  await run(ctx, "hud_set_health_size", () => callRpc(ctx.godot, "node.set_property", { node_path: "HUD/Root/HealthBar", property: "size", value: { x: 220, y: 18 } }));
  await run(ctx, "hud_set_health_max", () => callRpc(ctx.godot, "node.set_property", { node_path: "HUD/Root/HealthBar", property: "max_value", value: 100 }));
  await run(ctx, "hud_set_health_value", () => callRpc(ctx.godot, "node.set_property", { node_path: "HUD/Root/HealthBar", property: "value", value: 100 }));
  await run(ctx, "hud_create_score", () => callRpc(ctx.godot, "node.add", { parent_path: "HUD/Root", node_type: "Label", node_name: "ScoreLabel" }));
  await run(ctx, "hud_set_score_pos", () => callRpc(ctx.godot, "node.set_property", { node_path: "HUD/Root/ScoreLabel", property: "position", value: { x: 16, y: 40 } }));
  await run(ctx, "hud_set_score_text", () => callRpc(ctx.godot, "node.set_property", { node_path: "HUD/Root/ScoreLabel", property: "text", value: "Score: 0" }));
  await run(ctx, "hud_attach_script", () => callRpc(ctx.godot, "script.attach", { node_path: "HUD", script_path: scriptPath }));
}

async function applySaveMixin(ctx: MixinContext): Promise<void> {
  const scriptPath = "res://scripts/SaveSystem.gd";
  const w = await writeIfMissing(ctx.config.projectRoot, scriptPath, SAVE_SCRIPT);
  if (w.written) ctx.files_created.push(scriptPath);

  await run(ctx, "save_create_node", () => callRpc(ctx.godot, "node.add", { parent_path: ".", node_type: "Node", node_name: "SaveSystem" }));
  await run(ctx, "save_attach_script", () => callRpc(ctx.godot, "script.attach", { node_path: "SaveSystem", script_path: scriptPath }));
}

async function applyInventoryMixin(ctx: MixinContext): Promise<void> {
  const scriptPath = "res://scripts/Inventory.gd";
  const w = await writeIfMissing(ctx.config.projectRoot, scriptPath, INVENTORY_SCRIPT);
  if (w.written) ctx.files_created.push(scriptPath);

  await run(ctx, "inv_create_node", () => callRpc(ctx.godot, "node.add", { parent_path: ".", node_type: "Node", node_name: "Inventory" }));
  await run(ctx, "inv_attach_script", () => callRpc(ctx.godot, "script.attach", { node_path: "Inventory", script_path: scriptPath }));
}

async function applyDialogueMixin(ctx: MixinContext): Promise<void> {
  const scriptPath = "res://scripts/Dialogue.gd";
  const w = await writeIfMissing(ctx.config.projectRoot, scriptPath, DIALOGUE_SCRIPT);
  if (w.written) ctx.files_created.push(scriptPath);

  await run(ctx, "dlg_create_layer", () => callRpc(ctx.godot, "node.add", { parent_path: ".", node_type: "CanvasLayer", node_name: "Dialogue" }));
  await run(ctx, "dlg_create_root", () => callRpc(ctx.godot, "node.add", { parent_path: "Dialogue", node_type: "Control", node_name: "Root" }));
  await run(ctx, "dlg_root_anchor_r", () => callRpc(ctx.godot, "node.set_property", { node_path: "Dialogue/Root", property: "anchor_right", value: 1.0 }));
  await run(ctx, "dlg_root_anchor_b", () => callRpc(ctx.godot, "node.set_property", { node_path: "Dialogue/Root", property: "anchor_bottom", value: 1.0 }));
  await run(ctx, "dlg_create_panel", () => callRpc(ctx.godot, "node.add", { parent_path: "Dialogue/Root", node_type: "PanelContainer", node_name: "Panel" }));
  await run(ctx, "dlg_panel_pos", () => callRpc(ctx.godot, "node.set_property", { node_path: "Dialogue/Root/Panel", property: "position", value: { x: 32, y: 280 } }));
  await run(ctx, "dlg_panel_size", () => callRpc(ctx.godot, "node.set_property", { node_path: "Dialogue/Root/Panel", property: "size", value: { x: 540, y: 96 } }));
  await run(ctx, "dlg_create_name", () => callRpc(ctx.godot, "node.add", { parent_path: "Dialogue/Root/Panel", node_type: "Label", node_name: "NameLabel" }));
  await run(ctx, "dlg_create_label", () => callRpc(ctx.godot, "node.add", { parent_path: "Dialogue/Root/Panel", node_type: "Label", node_name: "Label" }));
  await run(ctx, "dlg_set_visible", () => callRpc(ctx.godot, "node.set_property", { node_path: "Dialogue", property: "visible", value: false }));
  await run(ctx, "dlg_attach_script", () => callRpc(ctx.godot, "script.attach", { node_path: "Dialogue", script_path: scriptPath }));
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function applySystemMixins(
  godot: GodotClient,
  config: ServerConfig,
  plan: GameDesignPlan,
): Promise<{ steps: StepResult[]; files_created: string[] }> {
  const ctx: MixinContext = { godot, config, plan, steps: [], files_created: [] };

  const want = (s: string) => plan.systems.includes(s as never);

  // HUD also includes score (single CanvasLayer covers both).
  if (want("hud") || want("score") || want("health")) {
    await applyHudMixin(ctx);
  }
  if (want("inventory")) await applyInventoryMixin(ctx);
  if (want("save")) await applySaveMixin(ctx);
  if (want("dialogue")) await applyDialogueMixin(ctx);

  return { steps: ctx.steps, files_created: ctx.files_created };
}
