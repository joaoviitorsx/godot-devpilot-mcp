import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function writeGd(projectRoot: string, resPath: string, content: string): Promise<void> {
  const resolved = resolveProjectPath(resPath, projectRoot);
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, autoFixGDScript(content), "utf8");
}

type StepResult = { step: string; ok: boolean; error?: unknown };

async function runStep(steps: StepResult[], label: string, fn: () => Promise<ToolResponse>): Promise<ToolResponse> {
  const r = await fn();
  steps.push({ step: label, ok: r.ok, error: r.ok ? undefined : r.error });
  return r;
}

const dryRun = (toolName: string, plan: string[], files?: string[], scenes?: string[]) =>
  createDryRunResponse({ toolName, plannedChanges: plan, affectedFiles: files, affectedNodes: scenes });

// ── Templates ────────────────────────────────────────────────────────────────

const AUTO_SHOOTER = `extends Node2D

@export var fire_rate: float = 0.5
@export var bullet_scene: PackedScene
@export var range_radius: float = 400.0

var _cooldown: float = 0.0

func _physics_process(delta: float) -> void:
	_cooldown -= delta
	if _cooldown > 0.0:
		return
	var target := _find_nearest_enemy()
	if target == null:
		return
	_fire_at(target.global_position)
	_cooldown = fire_rate

func _find_nearest_enemy() -> Node2D:
	var best: Node2D = null
	var best_dist := range_radius
	for node in get_tree().get_nodes_in_group("enemies"):
		if node is Node2D:
			var d := global_position.distance_to(node.global_position)
			if d < best_dist:
				best = node
				best_dist = d
	return best

func _fire_at(target: Vector2) -> void:
	if bullet_scene == null:
		return
	var bullet := bullet_scene.instantiate()
	get_tree().current_scene.add_child(bullet)
	if bullet is Node2D:
		bullet.global_position = global_position
		if bullet.has_method("set_direction"):
			bullet.set_direction((target - global_position).normalized())
`;

const SPAWN_MANAGER = `extends Node

@export var enemy_scene: PackedScene
@export var spawn_interval: float = 2.0
@export var spawn_radius: float = 600.0

var _timer: float = 0.0

func _physics_process(delta: float) -> void:
	_timer -= delta
	if _timer <= 0.0:
		_spawn_one()
		_timer = spawn_interval

func _spawn_one() -> void:
	if enemy_scene == null:
		return
	var enemy := enemy_scene.instantiate()
	var angle := randf() * TAU
	var pos := Vector2(cos(angle), sin(angle)) * spawn_radius
	if enemy is Node2D:
		enemy.global_position = get_tree().current_scene.global_position + pos
	enemy.add_to_group("enemies")
	get_tree().current_scene.add_child(enemy)
`;

const XP_SYSTEM = `extends Node

signal level_up(new_level: int)
signal xp_changed(current: int, required: int)

@export var xp_per_level: int = 100
@export var growth_factor: float = 1.5

var current_xp: int = 0
var current_level: int = 1
var required_xp: int = 100

func _ready() -> void:
	required_xp = xp_per_level

func add_xp(amount: int) -> void:
	current_xp += amount
	while current_xp >= required_xp:
		current_xp -= required_xp
		current_level += 1
		required_xp = int(required_xp * growth_factor)
		level_up.emit(current_level)
	xp_changed.emit(current_xp, required_xp)
`;

const DIALOGUE_BOX = `extends CanvasLayer

signal dialogue_finished

@onready var label: Label = $Root/Panel/Text
@onready var name_label: Label = $Root/Panel/Speaker

var _lines: Array = []
var _index: int = 0

func play(lines: Array) -> void:
	_lines = lines
	_index = 0
	visible = true
	_show_current()

func _show_current() -> void:
	if _index >= _lines.size():
		visible = false
		dialogue_finished.emit()
		return
	var line = _lines[_index]
	if name_label:
		name_label.text = str(line.get("speaker", ""))
	if label:
		label.text = str(line.get("text", ""))

func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return
	if event.is_action_pressed("ui_accept") or event.is_action_pressed("interact"):
		_index += 1
		_show_current()
		get_viewport().set_input_as_handled()
`;

const TILE_SWAP_PUZZLE = `extends Node2D

@export var grid_size: Vector2i = Vector2i(4, 4)
@export var tile_size: int = 64

var _grid: Array = []
var _selected: Vector2i = Vector2i(-1, -1)

signal score_changed(score: int)

var score: int = 0

func _ready() -> void:
	_init_grid()

func _init_grid() -> void:
	_grid.clear()
	for y in grid_size.y:
		var row: Array = []
		for x in grid_size.x:
			row.append(randi() % 5)
		_grid.append(row)

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		var cell := Vector2i(int(event.position.x / tile_size), int(event.position.y / tile_size))
		_on_click(cell)

func _on_click(cell: Vector2i) -> void:
	if cell.x < 0 or cell.y < 0 or cell.x >= grid_size.x or cell.y >= grid_size.y:
		return
	if _selected == Vector2i(-1, -1):
		_selected = cell
		return
	if (_selected - cell).length() == 1.0:
		_swap(_selected, cell)
	_selected = Vector2i(-1, -1)

func _swap(a: Vector2i, b: Vector2i) -> void:
	var tmp = _grid[a.y][a.x]
	_grid[a.y][a.x] = _grid[b.y][b.x]
	_grid[b.y][b.x] = tmp
	score += 10
	score_changed.emit(score)
`;

const TOWER_PLACEMENT = `extends Node2D

@export var tower_scene: PackedScene
@export var currency: int = 100
@export var tower_cost: int = 50

signal currency_changed(amount: int)
signal tower_placed(position: Vector2)

func _ready() -> void:
	currency_changed.emit(currency)

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_try_place(event.global_position)

func _try_place(pos: Vector2) -> void:
	if currency < tower_cost or tower_scene == null:
		return
	var tower := tower_scene.instantiate()
	get_tree().current_scene.add_child(tower)
	if tower is Node2D:
		tower.global_position = pos
	currency -= tower_cost
	currency_changed.emit(currency)
	tower_placed.emit(pos)

func add_currency(amount: int) -> void:
	currency += amount
	currency_changed.emit(currency)
`;

const ENEMY_WAVES = `extends Node

signal wave_started(wave: int)
signal wave_finished(wave: int)

@export var enemy_scene: PackedScene
@export var path_path: NodePath
@export var enemies_per_wave: int = 5
@export var spawn_delay: float = 1.0

var current_wave: int = 0
var _spawned: int = 0
var _timer: float = 0.0

func start_wave() -> void:
	current_wave += 1
	_spawned = 0
	wave_started.emit(current_wave)

func _physics_process(delta: float) -> void:
	if _spawned >= enemies_per_wave:
		return
	_timer -= delta
	if _timer <= 0.0:
		_spawn_one()
		_timer = spawn_delay

func _spawn_one() -> void:
	if enemy_scene == null:
		return
	var enemy := enemy_scene.instantiate()
	var path := get_node_or_null(path_path) as Path2D
	if path:
		var follower := PathFollow2D.new()
		follower.add_child(enemy)
		path.add_child(follower)
	else:
		get_tree().current_scene.add_child(enemy)
	_spawned += 1
	if _spawned >= enemies_per_wave:
		wave_finished.emit(current_wave)
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

const addNode = (g: GodotClient, parent: string, type: string, name: string) =>
  callRpc(g, "node.add", { parent_path: parent, node_type: type, node_name: name });
const setProp = (g: GodotClient, nodePath: string, property: string, value: unknown) =>
  callRpc(g, "node.set_property", { node_path: nodePath, property, value });
const attach = (g: GodotClient, nodePath: string, scriptPath: string) =>
  callRpc(g, "script.attach", { node_path: nodePath, script_path: scriptPath });

// ── Tool registration ────────────────────────────────────────────────────────

export function registerGenreBlueprintTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── Platformer ─────────────────────────────────────────────────────────────
  server.tool(
    "devpilot_create_platformer_blueprint",
    "Full platformer template: scene + player (gravity+jump) + tilemap floor + enemies + collectibles + camera + HUD. Tilemap pre-filled with N×10 floor cells.",
    {
      scene_path: z.string().optional().default("res://scenes/platformer.tscn"),
      level_length: z.number().int().positive().optional().default(50),
      enemy_count: z.number().int().nonnegative().optional().default(3),
      collectible_count: z.number().int().nonnegative().optional().default(10),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_platformer_blueprint", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_create_platformer_blueprint",
            [`create ${params.scene_path}`, `floor: ${params.level_length}×10 cells`, `${params.enemy_count} enemies + ${params.collectible_count} collectibles`, "player + camera + HUD"], [params.scene_path]);

          const steps: StepResult[] = [];
          const filesCreated: string[] = [];

          await runStep(steps, "create_scene", () => callRpc(godot, "scene.create", { scene_path: params.scene_path, root_node_type: "Node2D" }));
          await runStep(steps, "open_scene", () => callRpc(godot, "scene.open", { scene_path: params.scene_path }));

          // Tilemap floor
          await runStep(steps, "add_tilemap", () => addNode(godot, ".", "TileMap", "Floor"));
          await runStep(steps, "fill_floor", () => callRpc(godot, "tilemap.fill_rect", { node_path: "Floor", x: 0, y: 8, width: params.level_length, height: 2, layer: 0, source_id: 0, atlas_x: 0, atlas_y: 0 }));

          // Player
          const playerScript = "res://scripts/blueprint/PlatformerPlayer.gd";
          filesCreated.push(playerScript);
          await writeGd(config.projectRoot, playerScript, `extends CharacterBody2D\n@export var speed: float = 250.0\n@export var jump_velocity: float = -400.0\n@export var gravity: float = 980.0\nfunc _physics_process(d: float) -> void:\n\tif not is_on_floor(): velocity.y += gravity * d\n\tif Input.is_action_just_pressed("jump") and is_on_floor(): velocity.y = jump_velocity\n\tvar dir := Input.get_axis("move_left", "move_right")\n\tif dir != 0.0: velocity.x = dir * speed\n\telse: velocity.x = move_toward(velocity.x, 0.0, speed)\n\tmove_and_slide()\n`);
          await runStep(steps, "add_player", () => addNode(godot, ".", "CharacterBody2D", "Player"));
          await runStep(steps, "add_player_sprite", () => addNode(godot, "Player", "Sprite2D", "Sprite2D"));
          await runStep(steps, "add_player_coll", () => addNode(godot, "Player", "CollisionShape2D", "CollisionShape2D"));
          await runStep(steps, "add_player_camera", () => addNode(godot, "Player", "Camera2D", "Camera2D"));
          await runStep(steps, "attach_player_script", () => attach(godot, "Player", playerScript));

          // Enemies
          if (params.enemy_count > 0) {
            const enemyScript = "res://scripts/blueprint/PlatformerEnemy.gd";
            filesCreated.push(enemyScript);
            await writeGd(config.projectRoot, enemyScript, `extends CharacterBody2D\n@export var speed: float = 80.0\n@export var gravity: float = 980.0\nvar _dir: int = 1\nfunc _physics_process(d: float) -> void:\n\tif not is_on_floor(): velocity.y += gravity * d\n\tvelocity.x = _dir * speed\n\tmove_and_slide()\n\tif is_on_wall(): _dir *= -1\n`);
            for (let i = 1; i <= params.enemy_count; i++) {
              await runStep(steps, `enemy_${i}`, () => addNode(godot, ".", "CharacterBody2D", `Enemy${i}`));
              await runStep(steps, `enemy_sprite_${i}`, () => addNode(godot, `Enemy${i}`, "Sprite2D", "Sprite2D"));
              await runStep(steps, `enemy_coll_${i}`, () => addNode(godot, `Enemy${i}`, "CollisionShape2D", "CollisionShape2D"));
              await runStep(steps, `enemy_attach_${i}`, () => attach(godot, `Enemy${i}`, enemyScript));
              await runStep(steps, `enemy_pos_${i}`, () => setProp(godot, `Enemy${i}`, "position", { x: 200 + i * 300, y: 0 }));
            }
          }

          // Collectibles
          if (params.collectible_count > 0) {
            const collScript = "res://scripts/blueprint/Collectible.gd";
            filesCreated.push(collScript);
            await writeGd(config.projectRoot, collScript, `extends Area2D\nsignal collected(by: Node)\nfunc _ready() -> void:\n\tbody_entered.connect(_on)\nfunc _on(body: Node) -> void:\n\tcollected.emit(body)\n\tqueue_free()\n`);
            for (let i = 1; i <= params.collectible_count; i++) {
              await runStep(steps, `coll_${i}`, () => addNode(godot, ".", "Area2D", `Coin${i}`));
              await runStep(steps, `coll_coll_${i}`, () => addNode(godot, `Coin${i}`, "CollisionShape2D", "CollisionShape2D"));
              await runStep(steps, `coll_attach_${i}`, () => attach(godot, `Coin${i}`, collScript));
              await runStep(steps, `coll_pos_${i}`, () => setProp(godot, `Coin${i}`, "position", { x: 100 + i * 80, y: 100 }));
            }
          }

          await runStep(steps, "save", () => callRpc(godot, "scene.save", { scene_path: params.scene_path }));
          const failed = steps.filter((s) => !s.ok).length;

          return createSuccessResponse({
            scene_path: params.scene_path,
            level_length: params.level_length,
            entities: { player: 1, enemies: params.enemy_count, collectibles: params.collectible_count },
            files_created: filesCreated,
            steps_executed: steps.length, steps_failed: failed,
            next_steps: ["Assign TileSet to Floor.tile_set", "Add CollisionShape2D shapes (RectangleShape2D)", "Test with debug.run_project"],
          }, failed === 0 ? "Platformer blueprint generated." : `Platformer blueprint generated with ${failed} failures.`);
        })
      )
  );

  // ── Top-Down RPG ──────────────────────────────────────────────────────────
  server.tool(
    "devpilot_create_top_down_rpg_blueprint",
    "Full top-down RPG template: player (8-dir) + N NPCs in 'interactable' group + dialogue box + inventory + save system + HUD.",
    {
      scene_path: z.string().optional().default("res://scenes/rpg.tscn"),
      npc_count: z.number().int().nonnegative().optional().default(3),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_top_down_rpg_blueprint", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_create_top_down_rpg_blueprint", [`create ${params.scene_path}`, `${params.npc_count} NPCs`, "dialogue + inventory + save"], [params.scene_path]);

          const steps: StepResult[] = [];
          const filesCreated: string[] = [];

          await runStep(steps, "create_scene", () => callRpc(godot, "scene.create", { scene_path: params.scene_path, root_node_type: "Node2D" }));
          await runStep(steps, "open_scene", () => callRpc(godot, "scene.open", { scene_path: params.scene_path }));

          // Player
          const playerScript = "res://scripts/blueprint/RpgPlayer.gd";
          filesCreated.push(playerScript);
          await writeGd(config.projectRoot, playerScript, `extends CharacterBody2D\n@export var speed: float = 200.0\nfunc _physics_process(_d: float) -> void:\n\tvar dir := Vector2.ZERO\n\tdir.x = Input.get_axis("move_left", "move_right")\n\tdir.y = Input.get_axis("move_up", "move_down")\n\tif dir.length() > 1.0: dir = dir.normalized()\n\tvelocity = dir * speed\n\tmove_and_slide()\n`);
          await runStep(steps, "add_player", () => addNode(godot, ".", "CharacterBody2D", "Player"));
          await runStep(steps, "player_sprite", () => addNode(godot, "Player", "Sprite2D", "Sprite2D"));
          await runStep(steps, "player_coll", () => addNode(godot, "Player", "CollisionShape2D", "CollisionShape2D"));
          await runStep(steps, "player_cam", () => addNode(godot, "Player", "Camera2D", "Camera2D"));
          await runStep(steps, "attach_player", () => attach(godot, "Player", playerScript));

          // NPCs
          const npcScript = "res://scripts/blueprint/RpgNpc.gd";
          filesCreated.push(npcScript);
          await writeGd(config.projectRoot, npcScript, `extends CharacterBody2D\n@export var dialogue_lines: Array = []\nfunc _ready() -> void:\n\tadd_to_group("interactable")\n`);
          for (let i = 1; i <= params.npc_count; i++) {
            await runStep(steps, `npc_${i}`, () => addNode(godot, ".", "CharacterBody2D", `NPC${i}`));
            await runStep(steps, `npc_sprite_${i}`, () => addNode(godot, `NPC${i}`, "Sprite2D", "Sprite2D"));
            await runStep(steps, `npc_coll_${i}`, () => addNode(godot, `NPC${i}`, "CollisionShape2D", "CollisionShape2D"));
            await runStep(steps, `npc_attach_${i}`, () => attach(godot, `NPC${i}`, npcScript));
            await runStep(steps, `npc_pos_${i}`, () => setProp(godot, `NPC${i}`, "position", { x: i * 200, y: 100 }));
          }

          // Dialogue box
          const dialogueScript = "res://scripts/blueprint/DialogueBox.gd";
          filesCreated.push(dialogueScript);
          await writeGd(config.projectRoot, dialogueScript, DIALOGUE_BOX);
          await runStep(steps, "dialogue_layer", () => addNode(godot, ".", "CanvasLayer", "DialogueBox"));
          await runStep(steps, "dialogue_root", () => addNode(godot, "DialogueBox", "Control", "Root"));
          await runStep(steps, "dialogue_panel", () => addNode(godot, "DialogueBox/Root", "Panel", "Panel"));
          await runStep(steps, "dialogue_speaker", () => addNode(godot, "DialogueBox/Root/Panel", "Label", "Speaker"));
          await runStep(steps, "dialogue_text", () => addNode(godot, "DialogueBox/Root/Panel", "Label", "Text"));
          await runStep(steps, "dialogue_attach", () => attach(godot, "DialogueBox", dialogueScript));

          await runStep(steps, "save", () => callRpc(godot, "scene.save", { scene_path: params.scene_path }));
          const failed = steps.filter((s) => !s.ok).length;

          return createSuccessResponse({
            scene_path: params.scene_path,
            entities: { player: 1, npcs: params.npc_count },
            files_created: filesCreated,
            systems_used: ["dialogue"],
            steps_executed: steps.length, steps_failed: failed,
            next_steps: ["Add InteractionArea to Player", "Populate NPC dialogue_lines", "Add Inventory autoload via devpilot_create_inventory_system"],
          }, "Top-down RPG blueprint generated.");
        })
      )
  );

  // ── Survivor-Like ─────────────────────────────────────────────────────────
  server.tool(
    "devpilot_create_survivor_like_blueprint",
    "Survivor-like (bullet-heaven) template: player + auto-shooter weapon + spawn manager (waves) + XP system. Enemy/collectible/HUD wired via groups.",
    {
      scene_path: z.string().optional().default("res://scenes/survivor.tscn"),
      spawn_interval: z.number().positive().optional().default(2.0),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_survivor_like_blueprint", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_create_survivor_like_blueprint", ["scene + player + auto-shooter + spawn manager + XP"], [params.scene_path]);

          const steps: StepResult[] = [];
          const filesCreated: string[] = [];

          await runStep(steps, "create_scene", () => callRpc(godot, "scene.create", { scene_path: params.scene_path, root_node_type: "Node2D" }));
          await runStep(steps, "open_scene", () => callRpc(godot, "scene.open", { scene_path: params.scene_path }));

          const shooterScript = "res://scripts/blueprint/AutoShooter.gd";
          const spawnScript = "res://scripts/blueprint/SpawnManager.gd";
          const xpScript = "res://scripts/blueprint/XpSystem.gd";
          filesCreated.push(shooterScript, spawnScript, xpScript);
          await writeGd(config.projectRoot, shooterScript, AUTO_SHOOTER);
          await writeGd(config.projectRoot, spawnScript, SPAWN_MANAGER);
          await writeGd(config.projectRoot, xpScript, XP_SYSTEM);

          // Player + AutoShooter child
          const playerScript = "res://scripts/blueprint/SurvivorPlayer.gd";
          filesCreated.push(playerScript);
          await writeGd(config.projectRoot, playerScript, `extends CharacterBody2D\n@export var speed: float = 220.0\nfunc _physics_process(_d: float) -> void:\n\tvar dir := Vector2.ZERO\n\tdir.x = Input.get_axis("move_left", "move_right")\n\tdir.y = Input.get_axis("move_up", "move_down")\n\tif dir.length() > 1.0: dir = dir.normalized()\n\tvelocity = dir * speed\n\tmove_and_slide()\n`);
          await runStep(steps, "add_player", () => addNode(godot, ".", "CharacterBody2D", "Player"));
          await runStep(steps, "player_sprite", () => addNode(godot, "Player", "Sprite2D", "Sprite2D"));
          await runStep(steps, "player_coll", () => addNode(godot, "Player", "CollisionShape2D", "CollisionShape2D"));
          await runStep(steps, "player_cam", () => addNode(godot, "Player", "Camera2D", "Camera2D"));
          await runStep(steps, "attach_player", () => attach(godot, "Player", playerScript));
          await runStep(steps, "add_shooter", () => addNode(godot, "Player", "Node2D", "AutoShooter"));
          await runStep(steps, "attach_shooter", () => attach(godot, "Player/AutoShooter", shooterScript));

          await runStep(steps, "add_spawn_mgr", () => addNode(godot, ".", "Node", "SpawnManager"));
          await runStep(steps, "attach_spawn", () => attach(godot, "SpawnManager", spawnScript));
          await runStep(steps, "spawn_interval", () => setProp(godot, "SpawnManager", "spawn_interval", params.spawn_interval));

          await runStep(steps, "add_xp", () => addNode(godot, ".", "Node", "XPSystem"));
          await runStep(steps, "attach_xp", () => attach(godot, "XPSystem", xpScript));

          await runStep(steps, "save", () => callRpc(godot, "scene.save", { scene_path: params.scene_path }));
          const failed = steps.filter((s) => !s.ok).length;

          return createSuccessResponse({
            scene_path: params.scene_path,
            files_created: filesCreated,
            systems_used: ["auto-shooter", "spawn-manager", "xp"],
            steps_executed: steps.length, steps_failed: failed,
            next_steps: ["Assign Player.AutoShooter.bullet_scene", "Assign SpawnManager.enemy_scene", "Add HUD bound to XPSystem.xp_changed"],
          }, "Survivor-like blueprint generated.");
        })
      )
  );

  // ── Puzzle ─────────────────────────────────────────────────────────────────
  server.tool(
    "devpilot_create_puzzle_blueprint",
    "Tile-swap puzzle template: grid + swap mechanic + score HUD.",
    {
      scene_path: z.string().optional().default("res://scenes/puzzle.tscn"),
      grid_width: z.number().int().min(2).max(16).optional().default(4),
      grid_height: z.number().int().min(2).max(16).optional().default(4),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_puzzle_blueprint", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_create_puzzle_blueprint", [`grid ${params.grid_width}x${params.grid_height} + score HUD`], [params.scene_path]);
          const steps: StepResult[] = [];
          const filesCreated: string[] = [];
          await runStep(steps, "create_scene", () => callRpc(godot, "scene.create", { scene_path: params.scene_path, root_node_type: "Node2D" }));
          await runStep(steps, "open_scene", () => callRpc(godot, "scene.open", { scene_path: params.scene_path }));
          const puzzleScript = "res://scripts/blueprint/PuzzleGrid.gd";
          filesCreated.push(puzzleScript);
          await writeGd(config.projectRoot, puzzleScript, TILE_SWAP_PUZZLE);
          await runStep(steps, "add_grid", () => addNode(godot, ".", "Node2D", "Puzzle"));
          await runStep(steps, "attach_grid", () => attach(godot, "Puzzle", puzzleScript));
          await runStep(steps, "set_grid_size", () => setProp(godot, "Puzzle", "grid_size", { x: params.grid_width, y: params.grid_height }));
          // HUD
          await runStep(steps, "hud_layer", () => addNode(godot, ".", "CanvasLayer", "HUD"));
          await runStep(steps, "hud_label", () => addNode(godot, "HUD", "Label", "ScoreLabel"));
          await runStep(steps, "hud_text", () => setProp(godot, "HUD/ScoreLabel", "text", "Score: 0"));
          await runStep(steps, "save", () => callRpc(godot, "scene.save", { scene_path: params.scene_path }));
          const failed = steps.filter((s) => !s.ok).length;
          return createSuccessResponse({ scene_path: params.scene_path, grid: { width: params.grid_width, height: params.grid_height }, files_created: filesCreated, steps_executed: steps.length, steps_failed: failed }, "Puzzle blueprint generated.");
        })
      )
  );

  // ── Visual Novel ──────────────────────────────────────────────────────────
  server.tool(
    "devpilot_create_visual_novel_blueprint",
    "Visual novel template: background + character sprite + dialogue box + branching dialogue Resource. Reads dialogue.json from res://data/.",
    {
      scene_path: z.string().optional().default("res://scenes/vn.tscn"),
      dialogue_data_path: z.string().optional().default("res://data/dialogue.json"),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_visual_novel_blueprint", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_create_visual_novel_blueprint", [`scene + bg + character + DialogueBox + ${params.dialogue_data_path}`], [params.scene_path, params.dialogue_data_path]);
          const steps: StepResult[] = [];
          const filesCreated: string[] = [];
          await runStep(steps, "create_scene", () => callRpc(godot, "scene.create", { scene_path: params.scene_path, root_node_type: "Node2D" }));
          await runStep(steps, "open_scene", () => callRpc(godot, "scene.open", { scene_path: params.scene_path }));
          await runStep(steps, "add_bg", () => addNode(godot, ".", "Sprite2D", "Background"));
          await runStep(steps, "add_char", () => addNode(godot, ".", "Sprite2D", "Character"));
          // Dialogue box
          const dialogueScript = "res://scripts/blueprint/VnDialogueBox.gd";
          filesCreated.push(dialogueScript);
          await writeGd(config.projectRoot, dialogueScript, DIALOGUE_BOX);
          await runStep(steps, "dialogue_layer", () => addNode(godot, ".", "CanvasLayer", "DialogueBox"));
          await runStep(steps, "dialogue_root", () => addNode(godot, "DialogueBox", "Control", "Root"));
          await runStep(steps, "dialogue_panel", () => addNode(godot, "DialogueBox/Root", "Panel", "Panel"));
          await runStep(steps, "dialogue_speaker", () => addNode(godot, "DialogueBox/Root/Panel", "Label", "Speaker"));
          await runStep(steps, "dialogue_text", () => addNode(godot, "DialogueBox/Root/Panel", "Label", "Text"));
          await runStep(steps, "dialogue_attach", () => attach(godot, "DialogueBox", dialogueScript));
          // Sample dialogue.json
          if (!config.security.readOnly) {
            const resolved = resolveProjectPath(params.dialogue_data_path, config.projectRoot);
            await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
            const sample = {
              start: [
                { speaker: "Narrator", text: "It was a stormy night..." },
                { speaker: "Hero", text: "I should head home.", choices: [{ label: "Continue", next: "end" }] },
              ],
              end: [{ speaker: "Narrator", text: "The end." }],
            };
            await writeFile(resolved.absolutePath, JSON.stringify(sample, null, 2), "utf8");
            filesCreated.push(params.dialogue_data_path);
          }
          await runStep(steps, "save", () => callRpc(godot, "scene.save", { scene_path: params.scene_path }));
          const failed = steps.filter((s) => !s.ok).length;
          return createSuccessResponse({ scene_path: params.scene_path, files_created: filesCreated, dialogue_data: params.dialogue_data_path, steps_executed: steps.length, steps_failed: failed, next_steps: ["Assign Background.texture", "Assign Character.texture", "Wire DialogueBox.play() with dialogue_data branch"] }, "Visual novel blueprint generated.");
        })
      )
  );

  // ── Tower Defense ─────────────────────────────────────────────────────────
  server.tool(
    "devpilot_create_tower_defense_blueprint",
    "Tower defense template: Path2D + tower placement + enemy waves + currency. Tower/enemy scenes assigned later.",
    {
      scene_path: z.string().optional().default("res://scenes/td.tscn"),
      starting_currency: z.number().int().nonnegative().optional().default(100),
      tower_cost: z.number().int().positive().optional().default(50),
      enemies_per_wave: z.number().int().positive().optional().default(5),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_tower_defense_blueprint", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_create_tower_defense_blueprint", ["scene + Path2D + TowerPlacement + EnemyWaves + currency HUD"], [params.scene_path]);
          const steps: StepResult[] = [];
          const filesCreated: string[] = [];
          await runStep(steps, "create_scene", () => callRpc(godot, "scene.create", { scene_path: params.scene_path, root_node_type: "Node2D" }));
          await runStep(steps, "open_scene", () => callRpc(godot, "scene.open", { scene_path: params.scene_path }));
          await runStep(steps, "add_path", () => addNode(godot, ".", "Path2D", "EnemyPath"));

          const placementScript = "res://scripts/blueprint/TowerPlacement.gd";
          const wavesScript = "res://scripts/blueprint/EnemyWaves.gd";
          filesCreated.push(placementScript, wavesScript);
          await writeGd(config.projectRoot, placementScript, TOWER_PLACEMENT);
          await writeGd(config.projectRoot, wavesScript, ENEMY_WAVES);

          await runStep(steps, "add_placement", () => addNode(godot, ".", "Node2D", "TowerPlacement"));
          await runStep(steps, "attach_placement", () => attach(godot, "TowerPlacement", placementScript));
          await runStep(steps, "set_currency", () => setProp(godot, "TowerPlacement", "currency", params.starting_currency));
          await runStep(steps, "set_cost", () => setProp(godot, "TowerPlacement", "tower_cost", params.tower_cost));

          await runStep(steps, "add_waves", () => addNode(godot, ".", "Node", "Waves"));
          await runStep(steps, "attach_waves", () => attach(godot, "Waves", wavesScript));
          await runStep(steps, "waves_per_wave", () => setProp(godot, "Waves", "enemies_per_wave", params.enemies_per_wave));

          await runStep(steps, "hud_layer", () => addNode(godot, ".", "CanvasLayer", "HUD"));
          await runStep(steps, "hud_label", () => addNode(godot, "HUD", "Label", "CurrencyLabel"));
          await runStep(steps, "hud_text", () => setProp(godot, "HUD/CurrencyLabel", "text", `Currency: ${params.starting_currency}`));

          await runStep(steps, "save", () => callRpc(godot, "scene.save", { scene_path: params.scene_path }));
          const failed = steps.filter((s) => !s.ok).length;

          return createSuccessResponse({ scene_path: params.scene_path, files_created: filesCreated, currency: params.starting_currency, tower_cost: params.tower_cost, enemies_per_wave: params.enemies_per_wave, steps_executed: steps.length, steps_failed: failed, next_steps: ["Add curve to EnemyPath", "Assign TowerPlacement.tower_scene", "Assign Waves.enemy_scene + path_path"] }, "Tower defense blueprint generated.");
        })
      )
  );
}
