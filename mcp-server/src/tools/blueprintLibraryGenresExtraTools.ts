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

async function writeIfNew(projectRoot: string, resPath: string, content: string, overwrite: boolean): Promise<boolean> {
  const r = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return false;
  await mkdir(path.dirname(r.absolutePath), { recursive: true });
  await writeFile(r.absolutePath, autoFixGDScript(content), "utf8");
  return true;
}

const Params = {
  script_dir: z.string().optional().default("res://scripts"),
  overwrite: z.boolean().optional().default(false),
};

// ── Templates ────────────────────────────────────────────────────────────────

const CARD_GAME_CARD = `extends Resource
class_name Card

@export var id: String = ""
@export var display_name: String = ""
@export var description: String = ""
@export var attack: int = 0
@export var hp: int = 0
@export var cost: int = 0
@export var art: Texture2D
`;

const CARD_GAME_DECK = `extends Node
class_name Deck

signal card_drawn(card)
signal deck_empty

var cards: Array = []
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()

func add_card(card) -> void:
	cards.append(card)

func shuffle() -> void:
	_rng.randomize()
	cards.shuffle()

func draw() -> Variant:
	if cards.is_empty():
		deck_empty.emit()
		return null
	var c = cards.pop_back()
	card_drawn.emit(c)
	return c

func size() -> int:
	return cards.size()
`;

const CARD_GAME_HAND = `extends Node
class_name Hand

signal hand_changed

@export var max_size: int = 7
var cards: Array = []

func add(card) -> bool:
	if cards.size() >= max_size:
		return false
	cards.append(card)
	hand_changed.emit()
	return true

func remove(card) -> bool:
	var idx := cards.find(card)
	if idx == -1:
		return false
	cards.remove_at(idx)
	hand_changed.emit()
	return true

func size() -> int:
	return cards.size()
`;

// ── Stealth ──────────────────────────────────────────────────────────────────

const VISION_CONE = `extends Area2D
class_name VisionCone

@export var view_distance: float = 220.0
@export var view_angle_deg: float = 60.0

signal player_spotted(target: Node2D)
signal player_lost

var _spotted: bool = false
var _player: Node2D = null

func _ready() -> void:
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

func _physics_process(_delta: float) -> void:
	if _player == null:
		return
	var to := _player.global_position - global_position
	if to.length() > view_distance:
		_lose()
		return
	var fwd := Vector2.RIGHT.rotated(global_rotation)
	var angle := rad_to_deg(abs(fwd.angle_to(to)))
	if angle <= view_angle_deg * 0.5:
		if not _spotted:
			_spotted = true
			player_spotted.emit(_player)
	else:
		_lose()

func _on_body_entered(body: Node) -> void:
	if body.is_in_group("player"):
		_player = body

func _on_body_exited(body: Node) -> void:
	if body == _player:
		_lose()
		_player = null

func _lose() -> void:
	if _spotted:
		_spotted = false
		player_lost.emit()
`;

const AWARENESS_STATE = `extends Node
class_name AwarenessState

enum State { IDLE, SUSPICIOUS, ALERT }

signal state_changed(new_state: int)

@export var suspicion_decay_rate: float = 0.4
@export var alert_threshold: float = 1.0
@export var suspicious_threshold: float = 0.4

var state: int = State.IDLE
var suspicion: float = 0.0

func _physics_process(delta: float) -> void:
	if suspicion > 0.0:
		suspicion = max(0.0, suspicion - suspicion_decay_rate * delta)
		_resolve_state()

func add_suspicion(amount: float) -> void:
	suspicion = clamp(suspicion + amount, 0.0, 2.0)
	_resolve_state()

func _resolve_state() -> void:
	var new_state := State.IDLE
	if suspicion >= alert_threshold:
		new_state = State.ALERT
	elif suspicion >= suspicious_threshold:
		new_state = State.SUSPICIOUS
	if new_state != state:
		state = new_state
		state_changed.emit(new_state)
`;

// ── Crafting ─────────────────────────────────────────────────────────────────

const RECIPE_RESOURCE = `extends Resource
class_name Recipe

@export var id: String = ""
@export var inputs: Array = []         # [{"item_id": String, "count": int}]
@export var output_item_id: String = ""
@export var output_count: int = 1
@export var craft_time: float = 1.0
`;

const CRAFTING_STATION = `extends Node
class_name CraftingStation

signal craft_started(recipe)
signal craft_completed(recipe)
signal craft_failed(reason: String)

@export var recipes: Array[Recipe] = []

var _busy: bool = false

func can_craft(recipe) -> bool:
	if recipe == null:
		return false
	var inv = get_node_or_null("/root/InventoryGrid")
	if inv == null:
		return false
	for entry in recipe.inputs:
		if int(inv.count_of(String(entry.get("item_id", "")))) < int(entry.get("count", 1)):
			return false
	return true

func craft(recipe) -> void:
	if _busy:
		craft_failed.emit("busy")
		return
	if not can_craft(recipe):
		craft_failed.emit("missing_inputs")
		return
	_busy = true
	craft_started.emit(recipe)
	var inv = get_node_or_null("/root/InventoryGrid")
	for entry in recipe.inputs:
		inv.remove_item(String(entry.get("item_id", "")), int(entry.get("count", 1)))
	await get_tree().create_timer(recipe.craft_time).timeout
	if inv:
		inv.add_item(recipe.output_item_id, recipe.output_count)
	_busy = false
	craft_completed.emit(recipe)
`;

// ── Skill tree ──────────────────────────────────────────────────────────────

const SKILL_NODE = `extends Resource
class_name SkillNode

@export var id: String = ""
@export var display_name: String = ""
@export var description: String = ""
@export var prerequisites: Array = []   # Array of skill ids
@export var cost: int = 1
@export var effects: Dictionary = {}
`;

const SKILL_TREE_MANAGER = `extends Node

signal skill_unlocked(skill_id: String)
signal points_changed(amount: int)

@export var skills: Array[SkillNode] = []

var unlocked: Dictionary = {}
var available_points: int = 0

func add_points(n: int) -> void:
	available_points += n
	points_changed.emit(available_points)

func can_unlock(skill_id: String) -> bool:
	if unlocked.has(skill_id):
		return false
	var s = _get_skill(skill_id)
	if s == null:
		return false
	if available_points < s.cost:
		return false
	for pre in s.prerequisites:
		if not unlocked.has(String(pre)):
			return false
	return true

func unlock(skill_id: String) -> bool:
	if not can_unlock(skill_id):
		return false
	var s = _get_skill(skill_id)
	available_points -= s.cost
	unlocked[skill_id] = true
	skill_unlocked.emit(skill_id)
	points_changed.emit(available_points)
	return true

func _get_skill(skill_id: String):
	for s in skills:
		if s.id == skill_id:
			return s
	return null
`;

// ── Roguelike run ───────────────────────────────────────────────────────────

const RUN_MANAGER = `extends Node
# Roguelike per-run state. Resets on death; persistent meta is separate.

signal run_started
signal run_failed
signal run_completed
signal floor_changed(n: int)

@export var max_floor: int = 10
var current_floor: int = 1
var modifiers: Dictionary = {}
var run_active: bool = false

func start_run() -> void:
	current_floor = 1
	modifiers.clear()
	run_active = true
	run_started.emit()

func advance_floor() -> void:
	if not run_active:
		return
	current_floor += 1
	floor_changed.emit(current_floor)
	if current_floor > max_floor:
		run_active = false
		run_completed.emit()

func fail_run() -> void:
	if not run_active:
		return
	run_active = false
	run_failed.emit()

func add_modifier(key: String, value) -> void:
	modifiers[key] = value
`;

const META_PROGRESSION = `extends Resource
class_name MetaProgression

@export var total_runs: int = 0
@export var best_floor_reached: int = 1
@export var meta_currency: int = 0
@export var unlocked_perks: Array = []
`;

// ── Fishing minigame ────────────────────────────────────────────────────────

const FISHING_MINIGAME = `extends Node2D
# Timing minigame: fill a bar by tapping action when marker is in green zone.

signal succeeded
signal failed

@export var fill_required: float = 1.0
@export var fill_per_tap: float = 0.18
@export var drain_rate: float = 0.25
@export var success_zone_min: float = 0.4
@export var success_zone_max: float = 0.7
@export var marker_speed: float = 1.6

var _fill: float = 0.0
var _marker: float = 0.0
var _direction: float = 1.0
var _running: bool = false

func _ready() -> void:
	visible = false

func start() -> void:
	_fill = 0.0
	_marker = 0.0
	_direction = 1.0
	_running = true
	visible = true
	set_process(true)

func _process(delta: float) -> void:
	if not _running:
		return
	_marker += delta * marker_speed * _direction
	if _marker > 1.0:
		_marker = 1.0
		_direction = -1.0
	elif _marker < 0.0:
		_marker = 0.0
		_direction = 1.0
	if Input.is_action_just_pressed("interact"):
		if _marker >= success_zone_min and _marker <= success_zone_max:
			_fill += fill_per_tap
		else:
			_fill -= fill_per_tap * 0.5
	_fill -= drain_rate * delta
	_fill = clamp(_fill, 0.0, 1.5)
	if _fill >= fill_required:
		_finish(true)
	elif _fill < -0.1:
		_finish(false)

func _finish(success: bool) -> void:
	_running = false
	visible = false
	set_process(false)
	if success: succeeded.emit()
	else: failed.emit()
`;

// ── Tower defense v2 ────────────────────────────────────────────────────────

const TD_TOWER_BASE = `extends StaticBody2D
class_name TowerBase

@export var fire_rate: float = 0.8
@export var range_radius: float = 220.0
@export var damage: int = 1
@export var bullet_scene: PackedScene

var _cooldown: float = 0.0

func _physics_process(delta: float) -> void:
	_cooldown = max(0.0, _cooldown - delta)
	if _cooldown > 0.0:
		return
	var target := _find_target()
	if target == null:
		return
	_fire(target)
	_cooldown = fire_rate

func _find_target() -> Node2D:
	var best: Node2D = null
	var best_dist := range_radius
	for e in get_tree().get_nodes_in_group("enemies"):
		if e is Node2D:
			var d := global_position.distance_to(e.global_position)
			if d < best_dist:
				best = e
				best_dist = d
	return best

func _fire(target: Node2D) -> void:
	if bullet_scene == null:
		return
	var b: Node2D = bullet_scene.instantiate()
	b.set("damage", damage)
	b.set("direction", (target.global_position - global_position).normalized())
	b.global_position = global_position
	get_tree().current_scene.add_child(b)
`;

const TD_WAVE_MANAGER = `extends Node

signal wave_started(n: int)
signal wave_finished(n: int)
signal all_waves_complete

@export var enemy_scene: PackedScene
@export var spawn_path_path: NodePath
@export var waves: Array = [5, 8, 12, 18, 25]
@export var spawn_interval: float = 0.6

var current_wave: int = 0
var _to_spawn: int = 0
var _spawn_timer: float = 0.0
var _alive: int = 0

func _ready() -> void:
	set_process(true)

func _process(delta: float) -> void:
	if _to_spawn <= 0 and _alive == 0 and current_wave < waves.size():
		start_next_wave()
		return
	if _to_spawn > 0:
		_spawn_timer -= delta
		if _spawn_timer <= 0.0:
			_spawn_one()
			_spawn_timer = spawn_interval

func start_next_wave() -> void:
	current_wave += 1
	if current_wave > waves.size():
		all_waves_complete.emit()
		set_process(false)
		return
	_to_spawn = int(waves[current_wave - 1])
	_spawn_timer = 0.0
	wave_started.emit(current_wave)

func _spawn_one() -> void:
	if enemy_scene == null:
		return
	var path = get_node_or_null(spawn_path_path) as Path2D
	var enemy: Node2D = enemy_scene.instantiate()
	if path:
		var follower := PathFollow2D.new()
		path.add_child(follower)
		follower.add_child(enemy)
	else:
		get_tree().current_scene.add_child(enemy)
	enemy.tree_exited.connect(_on_enemy_died)
	_alive += 1
	_to_spawn -= 1
	if _to_spawn == 0:
		wave_finished.emit(current_wave)

func _on_enemy_died() -> void:
	_alive = max(0, _alive - 1)
`;

// ── Match-3 v2 ──────────────────────────────────────────────────────────────

const MATCH3_GRID = `extends Node
# Match-3 8x8 grid w/ swap + match detection + cascade.

signal match_made(positions: Array, kind: int)
signal grid_settled

@export var width: int = 8
@export var height: int = 8
@export var kinds: int = 6

var grid: Array = []   # grid[y][x] = int kind id (0..kinds-1)
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()

func _ready() -> void:
	_rng.randomize()
	_initialize()

func _initialize() -> void:
	grid = []
	for y in height:
		var row: Array = []
		for x in width:
			row.append(_rng.randi_range(0, kinds - 1))
		grid.append(row)
	_resolve_matches()

func swap(a: Vector2i, b: Vector2i) -> bool:
	if not _adjacent(a, b):
		return false
	var tmp := grid[a.y][a.x]
	grid[a.y][a.x] = grid[b.y][b.x]
	grid[b.y][b.x] = tmp
	if _resolve_matches():
		return true
	# Revert if no match.
	tmp = grid[a.y][a.x]
	grid[a.y][a.x] = grid[b.y][b.x]
	grid[b.y][b.x] = tmp
	return false

func _adjacent(a: Vector2i, b: Vector2i) -> bool:
	var d := a - b
	return abs(d.x) + abs(d.y) == 1

func _resolve_matches() -> bool:
	var found := _find_matches()
	if found.is_empty():
		grid_settled.emit()
		return false
	for run in found:
		match_made.emit(run.positions, run.kind)
		for p in run.positions:
			grid[p.y][p.x] = -1
	_collapse()
	_refill()
	_resolve_matches()
	return true

func _find_matches() -> Array:
	var runs: Array = []
	# Horizontal.
	for y in height:
		var x := 0
		while x < width - 2:
			var k = grid[y][x]
			if k < 0:
				x += 1; continue
			var run_len := 1
			while x + run_len < width and grid[y][x + run_len] == k:
				run_len += 1
			if run_len >= 3:
				var positions: Array = []
				for i in run_len:
					positions.append(Vector2i(x + i, y))
				runs.append({"positions": positions, "kind": k})
			x += run_len
	# Vertical.
	for x in width:
		var y := 0
		while y < height - 2:
			var k = grid[y][x]
			if k < 0:
				y += 1; continue
			var run_len := 1
			while y + run_len < height and grid[y + run_len][x] == k:
				run_len += 1
			if run_len >= 3:
				var positions: Array = []
				for i in run_len:
					positions.append(Vector2i(x, y + i))
				runs.append({"positions": positions, "kind": k})
			y += run_len
	return runs

func _collapse() -> void:
	for x in width:
		var col: Array = []
		for y in range(height - 1, -1, -1):
			if grid[y][x] >= 0:
				col.append(grid[y][x])
		while col.size() < height:
			col.append(-1)
		for y in range(height - 1, -1, -1):
			grid[y][x] = col[height - 1 - y]

func _refill() -> void:
	for y in height:
		for x in width:
			if grid[y][x] < 0:
				grid[y][x] = _rng.randi_range(0, kinds - 1)
`;

// ── Visual novel v2 ─────────────────────────────────────────────────────────

const VN_PLAYER = `extends CanvasLayer
# Visual novel scene player. Pairs with DialogueManager (dialogue_system blueprint).

@onready var background: TextureRect = $Background
@onready var character: TextureRect = $Character
@onready var name_label: Label = $TextBox/NameLabel
@onready var text_label: Label = $TextBox/TextLabel
@onready var choices_box: VBoxContainer = $TextBox/Choices

var _dm = null

func _ready() -> void:
	_dm = get_node_or_null("/root/DialogueManager")
	if _dm:
		_dm.line_shown.connect(_on_line)
		_dm.dialogue_finished.connect(func(): visible = false)

func play_dialogue(graph) -> void:
	if _dm == null:
		return
	visible = true
	_dm.play(graph)

func set_background(tex: Texture2D) -> void:
	if background: background.texture = tex

func set_character(tex: Texture2D) -> void:
	if character: character.texture = tex

func _on_line(line) -> void:
	if name_label: name_label.text = line.speaker
	if text_label: text_label.text = line.text
	for c in choices_box.get_children():
		c.queue_free()
	if line.choices and line.choices.size() > 0:
		for i in line.choices.size():
			var btn := Button.new()
			btn.text = String(line.choices[i].get("label", ""))
			var idx := i
			btn.pressed.connect(func(): _dm.choose(idx))
			choices_box.add_child(btn)
`;

// ── Tool registration ────────────────────────────────────────────────────────

export function registerBlueprintLibraryGenresExtraTools(server: McpServer, config: ServerConfig): void {
  const apply = (server: McpServer, name: string, desc: string, files: Array<[string, string, string[]?]>) => {
    server.tool(
      `devpilot_blueprint_${name}`,
      desc,
      Params,
      async (params) =>
        toMcpResult(
          await executeToolSafely(ctx(`devpilot_blueprint_${name}`, config), async () => {
            if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
            const written: string[] = [];
            for (const [filename, content, signals] of files) {
              const p = `${params.script_dir}/${filename}`;
              const ok = await writeIfNew(config.projectRoot, p, content, params.overwrite);
              if (ok) {
                written.push(p);
                await recordScript(config.projectRoot, p, { signals });
              }
            }
            await recordBlueprintApplied(config.projectRoot, name, { template_version: "0.5.0" });
            return createSuccessResponse({ files: written }, `${name} applied (${written.length} file(s)).`);
          })
        )
    );
  };

  apply(server, "card_game", "[Card] Card Resource + Deck (shuffle/draw) + Hand (max_size). Compose with custom UI.", [
    ["Card.gd", CARD_GAME_CARD],
    ["Deck.gd", CARD_GAME_DECK, ["card_drawn", "deck_empty"]],
    ["Hand.gd", CARD_GAME_HAND, ["hand_changed"]],
  ]);

  apply(server, "stealth", "[Stealth] VisionCone (Area2D + cone test) + AwarenessState (idle/suspicious/alert with decay).", [
    ["VisionCone.gd", VISION_CONE, ["player_spotted", "player_lost"]],
    ["AwarenessState.gd", AWARENESS_STATE, ["state_changed"]],
  ]);

  apply(server, "crafting", "[Crafting] Recipe Resource + CraftingStation (consumes inputs from InventoryGrid, awaits craft_time, outputs item).", [
    ["Recipe.gd", RECIPE_RESOURCE],
    ["CraftingStation.gd", CRAFTING_STATION, ["craft_started", "craft_completed", "craft_failed"]],
  ]);

  apply(server, "skill_tree", "[Skill] SkillNode Resource + SkillTreeManager (prerequisites + cost + unlock + points).", [
    ["SkillNode.gd", SKILL_NODE],
    ["SkillTreeManager.gd", SKILL_TREE_MANAGER, ["skill_unlocked", "points_changed"]],
  ]);

  apply(server, "roguelike_run", "[Roguelike] RunManager autoload (per-run state, floor counter, modifiers) + MetaProgression Resource (persistent meta currency / best floor).", [
    ["RunManager.gd", RUN_MANAGER, ["run_started", "run_failed", "run_completed", "floor_changed"]],
    ["MetaProgression.gd", META_PROGRESSION],
  ]);

  apply(server, "fishing_minigame", "[Mini-game] Timing-based fishing/cooking minigame Node — tap interact when marker is in success zone, fill bar to win.", [
    ["FishingMinigame.gd", FISHING_MINIGAME, ["succeeded", "failed"]],
  ]);

  apply(server, "tower_defense_v2", "[TD v2] Modernized tower-defense: TowerBase (range/fire_rate) + WaveManager (configurable waves array, path follower spawning).", [
    ["TowerBase.gd", TD_TOWER_BASE],
    ["WaveManager.gd", TD_WAVE_MANAGER, ["wave_started", "wave_finished", "all_waves_complete"]],
  ]);

  apply(server, "match_3_v2", "[Match-3 v2] 8x8 grid w/ swap, match detection (3+), cascade + refill. Pure logic — bind own UI.", [
    ["Match3Grid.gd", MATCH3_GRID, ["match_made", "grid_settled"]],
  ]);

  apply(server, "visual_novel_v2", "[VN v2] CanvasLayer player consuming dialogue_system DialogueGraph: background/character/textbox/choices. Pairs with dialogue_system blueprint.", [
    ["VNPlayer.gd", VN_PLAYER],
  ]);
}

export const BLUEPRINT_GENRES_EXTRA_REGISTRY = [
  { name: "card_game", description: "[Card] Card/Deck/Hand primitives", category: "card", files_created: ["scripts/Card.gd", "scripts/Deck.gd", "scripts/Hand.gd"], params_schema: {}, example: {} },
  { name: "stealth", description: "[Stealth] VisionCone + AwarenessState", category: "ai", files_created: ["scripts/VisionCone.gd", "scripts/AwarenessState.gd"], params_schema: {}, example: {} },
  { name: "crafting", description: "[Crafting] Recipe + CraftingStation", category: "rpg", files_created: ["scripts/Recipe.gd", "scripts/CraftingStation.gd"], params_schema: {}, example: {} },
  { name: "skill_tree", description: "[Skill] SkillNode + SkillTreeManager", category: "rpg", files_created: ["scripts/SkillNode.gd", "scripts/SkillTreeManager.gd"], params_schema: {}, example: {} },
  { name: "roguelike_run", description: "[Roguelike] RunManager + MetaProgression", category: "roguelike", files_created: ["scripts/RunManager.gd", "scripts/MetaProgression.gd"], params_schema: {}, example: {} },
  { name: "fishing_minigame", description: "[Mini-game] Timing fishing/cooking", category: "minigame", files_created: ["scripts/FishingMinigame.gd"], params_schema: {}, example: {} },
  { name: "tower_defense_v2", description: "[TD v2] Tower + WaveManager", category: "td", files_created: ["scripts/TowerBase.gd", "scripts/WaveManager.gd"], params_schema: {}, example: {} },
  { name: "match_3_v2", description: "[Match-3 v2] 8x8 swap+cascade grid", category: "puzzle", files_created: ["scripts/Match3Grid.gd"], params_schema: {}, example: {} },
  { name: "visual_novel_v2", description: "[VN v2] Scene player consuming DialogueGraph", category: "vn", files_created: ["scripts/VNPlayer.gd"], params_schema: {}, example: {} },
];
