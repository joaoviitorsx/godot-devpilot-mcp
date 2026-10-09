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
import { serializeSceneToTscn, type SceneSpec } from "../utils/sceneSerializer.js";
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
  overwrite: z.boolean().optional().default(false),
};

// ── Dialogue ─────────────────────────────────────────────────────────────────

const DIALOGUE_LINE = `extends Resource
class_name DialogueLine

@export var id: String = ""
@export var speaker: String = ""
@export var text: String = ""
# choices: Array of { "label": String, "next_id": String }
@export var choices: Array = []
@export var next_id: String = ""
`;

const DIALOGUE_GRAPH = `extends Resource
class_name DialogueGraph

@export var root_id: String = ""
# lines: Dictionary id -> DialogueLine
@export var lines: Dictionary = {}

func get_line(id: String) -> DialogueLine:
	return lines.get(id, null)
`;

const DIALOGUE_MANAGER = `extends Node

signal line_shown(line)
signal dialogue_started(graph)
signal dialogue_finished

var current_graph = null
var current_line_id: String = ""

func play(graph) -> void:
	if graph == null:
		return
	current_graph = graph
	current_line_id = graph.root_id
	dialogue_started.emit(graph)
	_show_current()

func choose(index: int) -> void:
	if current_graph == null:
		return
	var line = current_graph.get_line(current_line_id)
	if line == null:
		_finish()
		return
	if index >= 0 and index < line.choices.size():
		current_line_id = line.choices[index].get("next_id", "")
	else:
		current_line_id = line.next_id
	_show_current()

func advance() -> void:
	choose(-1)

func _show_current() -> void:
	if current_line_id == "":
		_finish()
		return
	var line = current_graph.get_line(current_line_id)
	if line == null:
		_finish()
		return
	line_shown.emit(line)

func _finish() -> void:
	current_graph = null
	current_line_id = ""
	dialogue_finished.emit()
`;

const DIALOGUE_BOX = `extends CanvasLayer

@onready var name_label: Label = $Root/Panel/NameLabel
@onready var text_label: Label = $Root/Panel/TextLabel
@onready var choices_box: VBoxContainer = $Root/Panel/Choices

var _current_line = null

func _ready() -> void:
	visible = false
	if Engine.has_singleton("DialogueManager") or get_node_or_null("/root/DialogueManager"):
		var dm = get_node_or_null("/root/DialogueManager")
		if dm:
			dm.line_shown.connect(_on_line_shown)
			dm.dialogue_started.connect(func(_g): visible = true)
			dm.dialogue_finished.connect(func(): visible = false)

func _on_line_shown(line) -> void:
	_current_line = line
	if name_label: name_label.text = line.speaker
	if text_label: text_label.text = line.text
	for c in choices_box.get_children():
		c.queue_free()
	if line.choices and line.choices.size() > 0:
		for i in line.choices.size():
			var btn := Button.new()
			btn.text = String(line.choices[i].get("label", ""))
			var idx := i
			btn.pressed.connect(func(): _choose(idx))
			choices_box.add_child(btn)

func _choose(idx: int) -> void:
	var dm = get_node_or_null("/root/DialogueManager")
	if dm:
		dm.choose(idx)

func _unhandled_input(event: InputEvent) -> void:
	if visible and event.is_action_pressed("ui_accept") and (_current_line == null or _current_line.choices.is_empty()):
		var dm = get_node_or_null("/root/DialogueManager")
		if dm: dm.advance()
`;

function specDialogueBox(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/DialogueBox.tscn",
    ext_resources: [{ id: "db_script", type: "Script", path: scriptPath }],
    root: {
      name: "DialogueBox", type: "CanvasLayer", script: "db_script",
      children: [
        {
          name: "Root", type: "Control", props: { anchor_right: 1.0, anchor_bottom: 1.0 },
          children: [
            {
              name: "Panel", type: "PanelContainer",
              props: { offset_left: 64, offset_top: 480, offset_right: 1216, offset_bottom: 700 },
              children: [
                { name: "NameLabel", type: "Label", props: { text: "Speaker" } },
                { name: "TextLabel", type: "Label", props: { text: "..." } },
                { name: "Choices", type: "VBoxContainer" },
              ],
            },
          ],
        },
      ],
    },
  };
}

// ── Quest ────────────────────────────────────────────────────────────────────

const QUEST_DATA = `extends Resource
class_name QuestData

@export var id: String = ""
@export var title: String = ""
@export var description: String = ""
# objectives: Array of { "id": String, "label": String, "completed": bool }
@export var objectives: Array = []
@export var rewards: Dictionary = {}
@export var status: String = "inactive"   # inactive | active | completed | failed
`;

const QUEST_MANAGER = `extends Node

signal quest_started(quest)
signal quest_completed(quest)
signal objective_changed(quest_id: String, objective_id: String)

var quests: Dictionary = {}

func register(quest) -> void:
	if quest == null:
		return
	quests[quest.id] = quest

func start(quest_id: String) -> void:
	var q = quests.get(quest_id, null)
	if q == null:
		return
	q.status = "active"
	quest_started.emit(q)

func complete_objective(quest_id: String, objective_id: String) -> void:
	var q = quests.get(quest_id, null)
	if q == null:
		return
	for o in q.objectives:
		if String(o.get("id", "")) == objective_id:
			o["completed"] = true
			objective_changed.emit(quest_id, objective_id)
	if _all_done(q):
		q.status = "completed"
		quest_completed.emit(q)

func _all_done(q) -> bool:
	for o in q.objectives:
		if not bool(o.get("completed", false)):
			return false
	return true

func active_quests() -> Array:
	var out: Array = []
	for q in quests.values():
		if q.status == "active":
			out.append(q)
	return out
`;

// ── Inventory grid ───────────────────────────────────────────────────────────

const ITEM_DATA = `extends Resource
class_name ItemData

@export var id: String = ""
@export var display_name: String = ""
@export var description: String = ""
@export var icon: Texture2D
@export var max_stack: int = 99
@export var value: int = 0
`;

const INVENTORY_GRID = `extends Node

signal inventory_changed
signal item_added(item_id: String, count: int)
signal item_removed(item_id: String, count: int)

@export var slots: int = 24
# _slots[i] = { "item_id": String, "count": int } or null
var _slots: Array = []

func _ready() -> void:
	_slots.resize(slots)

func add_item(item_id: String, count: int = 1, max_stack: int = 99) -> int:
	var remaining := count
	for i in _slots.size():
		var s = _slots[i]
		if s != null and s.get("item_id", "") == item_id and s.get("count", 0) < max_stack:
			var room := max_stack - int(s.get("count", 0))
			var add_n := min(remaining, room)
			s["count"] = int(s.get("count", 0)) + add_n
			remaining -= add_n
			if remaining <= 0:
				inventory_changed.emit()
				item_added.emit(item_id, count - remaining)
				return 0
	for i in _slots.size():
		if _slots[i] == null:
			var n := min(remaining, max_stack)
			_slots[i] = { "item_id": item_id, "count": n }
			remaining -= n
			if remaining <= 0:
				inventory_changed.emit()
				item_added.emit(item_id, count - remaining)
				return 0
	inventory_changed.emit()
	if count - remaining > 0:
		item_added.emit(item_id, count - remaining)
	return remaining

func remove_item(item_id: String, count: int = 1) -> bool:
	var remaining := count
	for i in _slots.size():
		var s = _slots[i]
		if s != null and s.get("item_id", "") == item_id:
			var have := int(s.get("count", 0))
			var take := min(remaining, have)
			s["count"] = have - take
			remaining -= take
			if s["count"] <= 0:
				_slots[i] = null
			if remaining <= 0:
				inventory_changed.emit()
				item_removed.emit(item_id, count)
				return true
	inventory_changed.emit()
	return remaining == 0

func count_of(item_id: String) -> int:
	var n := 0
	for s in _slots:
		if s != null and s.get("item_id", "") == item_id:
			n += int(s.get("count", 0))
	return n

func snapshot() -> Array:
	return _slots.duplicate(true)
`;

const INVENTORY_UI = `extends CanvasLayer

@export var columns: int = 6
@onready var grid: GridContainer = $Root/Grid

func _ready() -> void:
	visible = false
	if grid:
		grid.columns = columns
	var inv = get_node_or_null("/root/InventoryGrid")
	if inv:
		inv.inventory_changed.connect(_refresh)
		_refresh()

func toggle() -> void:
	visible = not visible
	if visible:
		_refresh()

func _refresh() -> void:
	var inv = get_node_or_null("/root/InventoryGrid")
	if inv == null or grid == null:
		return
	for c in grid.get_children():
		c.queue_free()
	for s in inv.snapshot():
		var slot := PanelContainer.new()
		var lbl := Label.new()
		if s == null:
			lbl.text = "·"
		else:
			lbl.text = "%s\\nx%d" % [String(s.get("item_id", "?")), int(s.get("count", 0))]
		slot.add_child(lbl)
		grid.add_child(slot)
`;

function specInventoryUI(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/InventoryUI.tscn",
    ext_resources: [{ id: "ui_script", type: "Script", path: scriptPath }],
    root: {
      name: "InventoryUI", type: "CanvasLayer", script: "ui_script",
      children: [
        {
          name: "Root", type: "Control", props: { anchor_right: 1.0, anchor_bottom: 1.0 },
          children: [
            {
              name: "Background", type: "ColorRect",
              props: { anchor_right: 1.0, anchor_bottom: 1.0, color: { r: 0, g: 0, b: 0, a: 0.55 } },
            },
            {
              name: "Grid", type: "GridContainer",
              props: { offset_left: 320, offset_top: 120, offset_right: 960, offset_bottom: 600, columns: 6 },
            },
          ],
        },
      ],
    },
  };
}

// ── Loot table ───────────────────────────────────────────────────────────────

const LOOT_TABLE = `extends Resource
class_name LootTable

# entries: Array of { "item_id": String, "weight": int, "count_min": int, "count_max": int }
@export var entries: Array = []

func roll(rng: RandomNumberGenerator = null) -> Dictionary:
	if entries.is_empty():
		return {}
	if rng == null:
		rng = RandomNumberGenerator.new()
		rng.randomize()
	var total := 0
	for e in entries:
		total += int(e.get("weight", 1))
	var pick := rng.randi_range(0, max(0, total - 1))
	var acc := 0
	for e in entries:
		acc += int(e.get("weight", 1))
		if pick < acc:
			var lo := int(e.get("count_min", 1))
			var hi := int(e.get("count_max", lo))
			return { "item_id": String(e.get("item_id", "")), "count": rng.randi_range(lo, hi) }
	return {}
`;

const LOOT_ROLLER = `extends Node

func roll(table) -> Dictionary:
	if table == null:
		return {}
	return table.roll()

func roll_many(table, count: int) -> Array:
	var out: Array = []
	for i in count:
		var d := roll(table)
		if not d.is_empty():
			out.append(d)
	return out
`;

// ── Tool registration ────────────────────────────────────────────────────────

export function registerBlueprintLibraryRPGTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_blueprint_dialogue_system",
    "[RPG] Resource-based dialogue: DialogueLine + DialogueGraph + DialogueManager autoload + DialogueBox UI scene. Supports speaker/text/choices/branching.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_dialogue_system", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const lp = `${params.script_dir}/DialogueLine.gd`;
          const gp = `${params.script_dir}/DialogueGraph.gd`;
          const mp = `${params.script_dir}/DialogueManager.gd`;
          const bp = `${params.script_dir}/DialogueBox.gd`;
          const w1 = await writeIfNew(config.projectRoot, lp, DIALOGUE_LINE, true, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, gp, DIALOGUE_GRAPH, true, params.overwrite);
          const w3 = await writeIfNew(config.projectRoot, mp, DIALOGUE_MANAGER, true, params.overwrite);
          const w4 = await writeIfNew(config.projectRoot, bp, DIALOGUE_BOX, true, params.overwrite);
          const sceneSpec = specDialogueBox(bp);
          sceneSpec.path = `${params.scenes_dir}/DialogueBox.tscn`;
          const w5 = await writeIfNew(config.projectRoot, sceneSpec.path, serializeSceneToTscn(sceneSpec), false, params.overwrite);
          if (w3) await recordScript(config.projectRoot, mp, { signals: ["line_shown", "dialogue_started", "dialogue_finished"] });
          if (w5) await recordScene(config.projectRoot, sceneSpec.path, "dialogue_ui", [bp]);
          await recordBlueprintApplied(config.projectRoot, "dialogue_system");
          return createSuccessResponse({ files: [lp, gp, mp, bp, sceneSpec.path], next_steps: [`devpilot_add_autoload name=DialogueManager path=${mp}`] }, "dialogue_system applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_quest_system",
    "[RPG] QuestData Resource + QuestManager autoload (register, start, complete_objective). Emits quest_started, quest_completed, objective_changed.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_quest_system", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const dp = `${params.script_dir}/QuestData.gd`;
          const mp = `${params.script_dir}/QuestManager.gd`;
          await writeIfNew(config.projectRoot, dp, QUEST_DATA, true, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, mp, QUEST_MANAGER, true, params.overwrite);
          if (w2) await recordScript(config.projectRoot, mp, { signals: ["quest_started", "quest_completed", "objective_changed"] });
          await recordBlueprintApplied(config.projectRoot, "quest_system");
          return createSuccessResponse({ files: [dp, mp], next_steps: [`devpilot_add_autoload name=QuestManager path=${mp}`] }, "quest_system applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_inventory_grid",
    "[RPG] ItemData Resource + InventoryGrid autoload (slots, stack/merge, add/remove) + InventoryUI scene (toggleable grid panel).",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_inventory_grid", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const ip = `${params.script_dir}/ItemData.gd`;
          const gp = `${params.script_dir}/InventoryGrid.gd`;
          const up = `${params.script_dir}/InventoryUI.gd`;
          await writeIfNew(config.projectRoot, ip, ITEM_DATA, true, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, gp, INVENTORY_GRID, true, params.overwrite);
          const w3 = await writeIfNew(config.projectRoot, up, INVENTORY_UI, true, params.overwrite);
          const sceneSpec = specInventoryUI(up);
          sceneSpec.path = `${params.scenes_dir}/InventoryUI.tscn`;
          const w4 = await writeIfNew(config.projectRoot, sceneSpec.path, serializeSceneToTscn(sceneSpec), false, params.overwrite);
          if (w2) await recordScript(config.projectRoot, gp, { signals: ["inventory_changed", "item_added", "item_removed"] });
          if (w4) await recordScene(config.projectRoot, sceneSpec.path, "inventory_ui", [up]);
          await recordBlueprintApplied(config.projectRoot, "inventory_grid");
          return createSuccessResponse({ files: [ip, gp, up, sceneSpec.path], next_steps: [`devpilot_add_autoload name=InventoryGrid path=${gp}`] }, "inventory_grid applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_loot_table",
    "[RPG] LootTable Resource (weighted entries) + LootRoller helper Node. roll() / roll_many(table, count).",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_loot_table", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const tp = `${params.script_dir}/LootTable.gd`;
          const rp = `${params.script_dir}/LootRoller.gd`;
          await writeIfNew(config.projectRoot, tp, LOOT_TABLE, true, params.overwrite);
          await writeIfNew(config.projectRoot, rp, LOOT_ROLLER, true, params.overwrite);
          await recordBlueprintApplied(config.projectRoot, "loot_table");
          return createSuccessResponse({ files: [tp, rp] }, "loot_table applied.");
        })
      )
  );
}

export const BLUEPRINT_RPG_REGISTRY = [
  { name: "dialogue_system", description: "[RPG] Branching dialogue (Resource-based) + DialogueManager + UI", category: "rpg", files_created: ["scripts/Dialogue*.gd", "scenes/DialogueBox.tscn"], params_schema: {}, example: {} },
  { name: "quest_system", description: "[RPG] Quest Resource + QuestManager autoload", category: "rpg", files_created: ["scripts/QuestData.gd", "scripts/QuestManager.gd"], params_schema: {}, example: {} },
  { name: "inventory_grid", description: "[RPG] Slot/grid inventory + UI panel", category: "rpg", files_created: ["scripts/ItemData.gd", "scripts/InventoryGrid.gd", "scripts/InventoryUI.gd", "scenes/InventoryUI.tscn"], params_schema: {}, example: {} },
  { name: "loot_table", description: "[RPG] Weighted loot table Resource + roller", category: "rpg", files_created: ["scripts/LootTable.gd", "scripts/LootRoller.gd"], params_schema: {}, example: {} },
];
