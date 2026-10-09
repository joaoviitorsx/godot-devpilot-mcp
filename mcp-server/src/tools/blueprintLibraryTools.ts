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
import { serializeSceneToTscn, type SceneSpec, SubRef, ExtRef, PolygonRect } from "../utils/sceneSerializer.js";
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

async function writeText(projectRoot: string, resPath: string, content: string, overwrite: boolean): Promise<{ written: boolean; reason?: string; absPath: string }> {
  const resolved = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(resolved.absolutePath) && !overwrite) {
    return { written: false, reason: "exists", absPath: resolved.absolutePath };
  }
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, content, "utf8");
  return { written: true, absPath: resolved.absolutePath };
}

async function writeScript(projectRoot: string, resPath: string, raw: string, overwrite: boolean): Promise<{ written: boolean; reason?: string; absPath: string }> {
  const fixed = autoFixGDScript(raw);
  return writeText(projectRoot, resPath, fixed, overwrite);
}

async function writeScene(projectRoot: string, spec: SceneSpec, overwrite: boolean): Promise<{ written: boolean; reason?: string; absPath: string }> {
  const content = serializeSceneToTscn(spec);
  return writeText(projectRoot, spec.path, content, overwrite);
}

// ────────────────────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────────────────────

const TWIN_STICK_PLAYER = `extends CharacterBody2D

@export var speed: float = 220.0
@export var dodge_speed: float = 480.0
@export var dodge_duration: float = 0.28
@export var dodge_cooldown: float = 0.6
@export var max_hp: int = 6
@export var invincibility_time: float = 0.7

signal player_damaged(current_hp: int, max_hp: int)
signal player_died

var hp: int = 6
var _invincible: bool = false
var _dodging: bool = false
var _dodge_dir: Vector2 = Vector2.ZERO
var _dodge_timer: float = 0.0
var _dodge_cd_timer: float = 0.0

@onready var visual: Polygon2D = $Visual
@onready var weapon_pivot: Node2D = $WeaponPivot

func _ready() -> void:
	add_to_group("player")
	hp = max_hp
	var shape := RectangleShape2D.new()
	shape.size = Vector2(28, 28)
	if has_node("CollisionShape2D"):
		$CollisionShape2D.shape = shape
	player_damaged.emit(hp, max_hp)

func _physics_process(delta: float) -> void:
	_dodge_cd_timer = max(0.0, _dodge_cd_timer - delta)
	if _dodging:
		_dodge_timer -= delta
		velocity = _dodge_dir * dodge_speed
		if _dodge_timer <= 0.0:
			_dodging = false
			_invincible = false
	else:
		var dir := Vector2(
			Input.get_axis("move_left", "move_right"),
			Input.get_axis("move_up", "move_down")
		)
		if dir.length() > 1.0:
			dir = dir.normalized()
		velocity = dir * speed
		if Input.is_action_just_pressed("dodge_roll") and _dodge_cd_timer <= 0.0 and dir.length() > 0.1:
			_start_dodge(dir.normalized())
	move_and_slide()
	_aim()

func _start_dodge(dir: Vector2) -> void:
	_dodging = true
	_dodge_dir = dir
	_dodge_timer = dodge_duration
	_dodge_cd_timer = dodge_cooldown
	_invincible = true

func _aim() -> void:
	if weapon_pivot == null:
		return
	var aim_dir := _get_aim_direction()
	if aim_dir.length() > 0.01:
		weapon_pivot.rotation = aim_dir.angle()

func _get_aim_direction() -> Vector2:
	var kbd := Vector2(
		Input.get_axis("shoot_left", "shoot_right"),
		Input.get_axis("shoot_up", "shoot_down")
	)
	if kbd.length() > 0.1:
		return kbd.normalized()
	var mouse := get_global_mouse_position()
	return (mouse - global_position).normalized()

func take_damage(amount: int = 1) -> void:
	if _invincible:
		return
	hp = max(0, hp - amount)
	player_damaged.emit(hp, max_hp)
	_flash()
	_invincible = true
	if hp <= 0:
		player_died.emit()
		return
	await get_tree().create_timer(invincibility_time).timeout
	if not _dodging:
		_invincible = false

func heal(amount: int) -> void:
	hp = min(max_hp, hp + amount)
	player_damaged.emit(hp, max_hp)

func _flash() -> void:
	if visual == null:
		return
	for i in 4:
		visual.modulate = Color(1, 0.4, 0.4, 1)
		await get_tree().create_timer(0.06).timeout
		visual.modulate = Color(1, 1, 1, 1)
		await get_tree().create_timer(0.06).timeout
`;

const TWIN_STICK_WEAPON = `extends Node2D

@export var weapon_name: String = "Basic Pistol"
@export var damage: int = 1
@export var fire_rate: float = 0.18
@export var bullet_speed: float = 600.0
@export var mag_size: int = 8
@export var reload_time: float = 1.0
@export var bullet_scene: PackedScene

signal ammo_changed(current_ammo: int, max_ammo: int)
signal reload_started
signal reload_finished

var ammo: int = 8
var _cooldown: float = 0.0
var _reloading: bool = false

@onready var muzzle: Marker2D = $Muzzle

func _ready() -> void:
	ammo = mag_size
	ammo_changed.emit(ammo, mag_size)

func _process(delta: float) -> void:
	_cooldown = max(0.0, _cooldown - delta)
	if Input.is_action_just_pressed("reload"):
		_start_reload()
	if _reloading:
		return
	var firing := Input.is_action_pressed("shoot_mouse") or _has_kbd_shoot()
	if firing and _cooldown <= 0.0 and ammo > 0:
		_fire()

func _has_kbd_shoot() -> bool:
	return Input.is_action_pressed("shoot_up") or Input.is_action_pressed("shoot_down") \
		or Input.is_action_pressed("shoot_left") or Input.is_action_pressed("shoot_right")

func _fire() -> void:
	_cooldown = fire_rate
	ammo -= 1
	ammo_changed.emit(ammo, mag_size)
	if bullet_scene == null:
		return
	var bullet: Node2D = bullet_scene.instantiate()
	bullet.set("damage", damage)
	bullet.set("speed", bullet_speed)
	bullet.set("direction", Vector2.RIGHT.rotated(global_rotation))
	bullet.global_position = muzzle.global_position
	bullet.rotation = global_rotation
	get_tree().current_scene.add_child(bullet)
	if ammo <= 0:
		_start_reload()

func _start_reload() -> void:
	if _reloading or ammo == mag_size:
		return
	_reloading = true
	reload_started.emit()
	await get_tree().create_timer(reload_time).timeout
	ammo = mag_size
	_reloading = false
	reload_finished.emit()
	ammo_changed.emit(ammo, mag_size)
`;

const BULLET_BASE = `extends Area2D
class_name Bullet

@export var speed: float = 600.0
@export var damage: int = 1
@export var lifetime: float = 1.4
@export var direction: Vector2 = Vector2.RIGHT

var _life: float = 0.0

func _ready() -> void:
	_life = lifetime
	body_entered.connect(_on_body_entered)
	area_entered.connect(_on_area_entered)
	var shape := CircleShape2D.new()
	shape.radius = 5.0
	if has_node("CollisionShape2D"):
		$CollisionShape2D.shape = shape

func _physics_process(delta: float) -> void:
	_life -= delta
	if _life <= 0.0:
		queue_free()
		return
	global_position += direction.normalized() * speed * delta

func _on_body_entered(body: Node) -> void:
	if _on_hit(body):
		queue_free()

func _on_area_entered(area: Node) -> void:
	if _on_hit(area):
		queue_free()

func _on_hit(_node: Node) -> bool:
	return true
`;

const PLAYER_BULLET = `extends Bullet

func _ready() -> void:
	super._ready()
	add_to_group("player_bullets")

func _on_hit(node: Node) -> bool:
	if node.is_in_group("player") or node.is_in_group("player_bullets"):
		return false
	if node.is_in_group("enemies") and node.has_method("take_damage"):
		node.take_damage(damage)
		return true
	if node is StaticBody2D or node is TileMap:
		return true
	return false
`;

const ENEMY_BULLET = `extends Bullet

func _ready() -> void:
	super._ready()
	add_to_group("enemy_bullets")

func _on_hit(node: Node) -> bool:
	if node.is_in_group("enemies") or node.is_in_group("enemy_bullets"):
		return false
	if node.is_in_group("player") and node.has_method("take_damage"):
		node.take_damage(damage)
		return true
	if node is StaticBody2D or node is TileMap:
		return true
	return false
`;

const ROOM_MANAGER = `extends Node2D

@export var room_id: String = ""

@onready var doors_root: Node2D = $Doors
@onready var spawns_root: Node2D = $SpawnPoints

var fills_root: Node2D = null
var enter_trigger: Area2D = null

var _activated: bool = false

signal entered(room_id: String)
signal cleared(room_id: String)

func _ready() -> void:
	if has_node("Fills"):
		fills_root = get_node("Fills")
	if has_node("EnterTrigger"):
		enter_trigger = get_node("EnterTrigger")
		enter_trigger.body_entered.connect(_on_enter_trigger)
	_configure_doors()

func _configure_doors() -> void:
	if not Engine.has_singleton("DungeonManager") and not get_node_or_null("/root/DungeonManager"):
		return
	var dm = get_node_or_null("/root/DungeonManager")
	if dm == null:
		return
	var connections: Dictionary = dm.get_connections(room_id)
	for door in doors_root.get_children():
		if not "direction" in door:
			continue
		var dir: String = door.direction
		if connections.has(dir):
			door.set("target_room_id", connections[dir])
			door.set_locked(false)
		else:
			door.queue_free()
	if fills_root:
		for fill in fills_root.get_children():
			var dname := str(fill.name).to_lower()
			var fdir := "north" if dname.contains("north") else ("south" if dname.contains("south") else ("east" if dname.contains("east") else "west"))
			if connections.has(fdir):
				fill.queue_free()

func _on_enter_trigger(body: Node) -> void:
	if body.is_in_group("player"):
		entered.emit(room_id)

func mark_cleared() -> void:
	cleared.emit(room_id)
`;

const DUNGEON_MANAGER = `extends Node

# Generic dungeon registry. Define rooms + connections in the project that
# uses this autoload. Override populate() to set ROOMS / CONNECTIONS from
# a sub-class or via setter call.

var ROOMS: Dictionary = {}
var CONNECTIONS: Dictionary = {}

var current_room: String = ""
var room_nodes: Dictionary = {}

signal room_entered(room_id: String)
signal room_cleared(room_id: String)

func register_room(room_id: String, node: Node) -> void:
	room_nodes[room_id] = node

func get_connections(room_id: String) -> Dictionary:
	return CONNECTIONS.get(room_id, {})

func enter_room(room_id: String) -> void:
	if current_room == room_id:
		return
	current_room = room_id
	room_entered.emit(room_id)

func mark_room_cleared(room_id: String) -> void:
	room_cleared.emit(room_id)
`;

const DOOR_SCRIPT = `extends StaticBody2D

@export var direction: String = "east"
@export var target_room_id: String = ""

@onready var visual: Polygon2D = $Visual
@onready var collision: CollisionShape2D = $CollisionShape2D
@onready var trigger: Area2D = $Trigger

var _locked: bool = true

func _ready() -> void:
	add_to_group("doors")
	if trigger:
		trigger.body_entered.connect(_on_trigger_entered)
	var shape := RectangleShape2D.new()
	shape.size = Vector2(80, 20)
	if collision:
		collision.shape = shape
	var trig_shape := RectangleShape2D.new()
	trig_shape.size = Vector2(70, 40)
	for c in trigger.get_children():
		if c is CollisionShape2D:
			c.shape = trig_shape
	set_locked(true)

func set_locked(locked: bool) -> void:
	_locked = locked
	if collision:
		collision.disabled = not locked
	if visual:
		visual.color = Color(0.7, 0.15, 0.15, 1) if locked else Color(0.25, 0.85, 0.4, 1)

func _on_trigger_entered(body: Node) -> void:
	if _locked:
		return
	if body.is_in_group("player") and target_room_id != "":
		var dm = get_node_or_null("/root/DungeonManager")
		if dm:
			dm.enter_room(target_room_id)
`;

const BOSS_BASE = `extends CharacterBody2D
class_name BossBase

@export var max_hp: int = 30
@export var speed: float = 60.0
@export var contact_damage: int = 2
@export var pattern_pause: float = 1.2

signal boss_damaged(current_hp: int, max_hp: int)
signal boss_defeated

var hp: int = 30
var _pattern_timer: float = 0.0
var _pattern_idx: int = 0

@onready var visual: Polygon2D = $Visual

func _ready() -> void:
	add_to_group("enemies")
	add_to_group("boss")
	hp = max_hp
	var shape := CircleShape2D.new()
	shape.radius = 36.0
	if has_node("CollisionShape2D"):
		$CollisionShape2D.shape = shape
	boss_damaged.emit(hp, max_hp)

func _physics_process(delta: float) -> void:
	_pattern_timer -= delta
	var p := _get_player()
	if p:
		var dir := (p.global_position - global_position).normalized()
		velocity = dir * speed
	move_and_slide()
	if _pattern_timer <= 0.0 and p:
		_run_pattern(p)
		_pattern_timer = pattern_pause

func _run_pattern(p: Node2D) -> void:
	_pattern_idx = (_pattern_idx + 1) % 3
	match _pattern_idx:
		0: _pattern_radial()
		1: _pattern_burst(p)
		2: _pattern_sweep(p)

func _pattern_radial() -> void:
	for i in 8:
		var angle := i * TAU / 8.0
		_emit_bullet(Vector2.RIGHT.rotated(angle), 220.0)

func _pattern_burst(p: Node2D) -> void:
	for i in 3:
		var dir := (p.global_position - global_position).normalized()
		_emit_bullet(dir, 320.0)
		await get_tree().create_timer(0.18).timeout
		if not is_instance_valid(self):
			return

func _pattern_sweep(p: Node2D) -> void:
	var base := (p.global_position - global_position).normalized().angle()
	for i in range(-2, 3):
		var angle := base + i * 0.18
		_emit_bullet(Vector2.RIGHT.rotated(angle), 260.0)

func _emit_bullet(_dir: Vector2, _spd: float) -> void:
	# Override in subclass to instantiate the project's EnemyBullet scene.
	pass

func take_damage(amount: int, _knockback: Vector2 = Vector2.ZERO) -> void:
	hp = max(0, hp - amount)
	boss_damaged.emit(hp, max_hp)
	if visual:
		visual.modulate = Color(1.4, 1.4, 1.4, 1)
	await get_tree().create_timer(0.08).timeout
	if visual:
		visual.modulate = Color(1, 1, 1, 1)
	if hp <= 0:
		_die()

func _die() -> void:
	boss_defeated.emit()
	queue_free()

func _get_player() -> Node2D:
	var arr: Array = get_tree().get_nodes_in_group("player")
	if arr.is_empty():
		return null
	return arr[0] as Node2D
`;

const SHOP_ITEM_SCRIPT = `extends Area2D

@export var item_kind: String = "heart"
@export var cost: int = 3

signal purchased(kind: String)

@onready var visual: Polygon2D = $Visual

var label: Label = null
var _bought: bool = false
var _player_in: bool = false

func _ready() -> void:
	if has_node("Label"):
		label = get_node("Label")
	add_to_group("shop_items")
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)
	var shape := RectangleShape2D.new()
	shape.size = Vector2(40, 40)
	if has_node("CollisionShape2D"):
		$CollisionShape2D.shape = shape
	_refresh_label()

func _process(_delta: float) -> void:
	if _bought or not _player_in:
		return
	if Input.is_action_just_pressed("interact"):
		purchased.emit(item_kind)
		_bought = true
		if visual:
			visual.color = Color(0.3, 0.3, 0.3, 1)
		if label:
			label.text = "Vendido"

func _refresh_label() -> void:
	if label:
		label.text = "%s\\n%d moedas" % [item_kind.capitalize(), cost]

func _on_body_entered(body: Node) -> void:
	if body.is_in_group("player"): _player_in = true

func _on_body_exited(body: Node) -> void:
	if body.is_in_group("player"): _player_in = false
`;

const CHEST_SCRIPT = `extends Area2D

@export var coin_reward: int = 5
signal opened

@onready var visual: Polygon2D = $Visual

var prompt: Label = null
var _opened: bool = false
var _player_in: bool = false

func _ready() -> void:
	if has_node("Prompt"):
		prompt = get_node("Prompt")
	add_to_group("chests")
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)
	var shape := RectangleShape2D.new()
	shape.size = Vector2(40, 32)
	if has_node("CollisionShape2D"):
		$CollisionShape2D.shape = shape
	if prompt:
		prompt.visible = false

func _process(_delta: float) -> void:
	if prompt:
		prompt.visible = _player_in and not _opened
	if _player_in and not _opened and Input.is_action_just_pressed("interact"):
		_opened = true
		if visual:
			visual.color = Color(0.55, 0.4, 0.2, 1)
		opened.emit()

func _on_body_entered(body: Node) -> void:
	if body.is_in_group("player"): _player_in = true

func _on_body_exited(body: Node) -> void:
	if body.is_in_group("player"): _player_in = false
`;

const PICKUP_SCRIPT = `extends Area2D

@export var kind: String = "coin"

signal picked_up(kind: String, by: Node)

@onready var visual: Polygon2D = $Visual

func _ready() -> void:
	add_to_group("pickups")
	body_entered.connect(_on_body_entered)
	var shape := CircleShape2D.new()
	shape.radius = 8.0
	if has_node("CollisionShape2D"):
		$CollisionShape2D.shape = shape
	_apply_visual()

func _apply_visual() -> void:
	if visual == null:
		return
	if kind == "heart":
		visual.color = Color(1.0, 0.4, 0.5, 1)
	elif kind == "ammo":
		visual.color = Color(0.6, 0.85, 1, 1)
	else:
		visual.color = Color(1.0, 0.85, 0.2, 1)

func _on_body_entered(body: Node) -> void:
	if not body.is_in_group("player"):
		return
	picked_up.emit(kind, body)
	queue_free()
`;

// ────────────────────────────────────────────────────────────────────────────
// Blueprint specs metadata (used by registry tools)
// ────────────────────────────────────────────────────────────────────────────

export type BlueprintMeta = {
  name: string;
  description: string;
  category: string;
  files_created: string[];
  params_schema: Record<string, string>;
  example: Record<string, unknown>;
};

export const BLUEPRINT_REGISTRY: BlueprintMeta[] = [
  {
    name: "twin_stick",
    description: "Twin-stick shooter Player + WeaponPivot/Muzzle + PlayerWeapon (mag/reload, mouse + IJKL aim). Requires projectile_system blueprint applied first (or compatible PlayerBullet.tscn).",
    category: "player",
    files_created: ["scripts/PlayerTwinStick.gd", "scripts/PlayerWeapon.gd", "scenes/PlayerTwinStick.tscn"],
    params_schema: { script_dir: "string?", scenes_dir: "string?", overwrite: "bool?" },
    example: { script_dir: "res://scripts", scenes_dir: "res://scenes", overwrite: false },
  },
  {
    name: "projectile_system",
    description: "Bullet base + PlayerBullet + EnemyBullet w/ collision groups, lifetime, hit handlers. Generates Bullet.gd, PlayerBullet.gd, EnemyBullet.gd + 2 scenes.",
    category: "combat",
    files_created: ["scripts/Bullet.gd", "scripts/PlayerBullet.gd", "scripts/EnemyBullet.gd", "scenes/PlayerBullet.tscn", "scenes/EnemyBullet.tscn"],
    params_schema: { script_dir: "string?", scenes_dir: "string?", overwrite: "bool?" },
    example: { overwrite: false },
  },
  {
    name: "dungeon_room",
    description: "Room template (perimeter walls w/ door gaps, fills, 4 doors, 6 spawn points, enter trigger), Door.tscn, RoomManager.gd, DungeonManager.gd autoload-ready.",
    category: "level",
    files_created: ["scripts/RoomManager.gd", "scripts/DungeonManager.gd", "scripts/Door.gd", "scenes/Room.tscn", "scenes/Door.tscn"],
    params_schema: { script_dir: "string?", scenes_dir: "string?", overwrite: "bool?" },
    example: { overwrite: false },
  },
  {
    name: "boss_arena",
    description: "BossBase.gd w/ 3 attack patterns (radial 8, 3-shot burst, 5-shot sweep) + Boss.tscn placeholder. Override _emit_bullet() for project-specific bullet scene.",
    category: "combat",
    files_created: ["scripts/BossBase.gd", "scenes/Boss.tscn"],
    params_schema: { script_dir: "string?", scenes_dir: "string?", overwrite: "bool?" },
    example: { overwrite: false },
  },
  {
    name: "shop_item",
    description: "ShopItem Area2D w/ cost + interact-to-buy + purchased signal. Visual placeholder.",
    category: "dungeon",
    files_created: ["scripts/ShopItem.gd", "scenes/ShopItem.tscn"],
    params_schema: { overwrite: "bool?" },
    example: {},
  },
  {
    name: "chest",
    description: "Chest Area2D w/ interact-to-open + opened signal + Prompt label.",
    category: "dungeon",
    files_created: ["scripts/Chest.gd", "scenes/Chest.tscn"],
    params_schema: { overwrite: "bool?" },
    example: {},
  },
  {
    name: "pickup",
    description: "Pickup Area2D supporting kind=coin/heart/ammo. Auto color + picked_up signal.",
    category: "dungeon",
    files_created: ["scripts/Pickup.gd", "scenes/Pickup.tscn"],
    params_schema: { overwrite: "bool?" },
    example: {},
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Scene specs
// ────────────────────────────────────────────────────────────────────────────

function specPlayerTwinStick(scriptPath: string, weaponScriptPath: string): SceneSpec {
  return {
    path: "res://scenes/PlayerTwinStick.tscn",
    ext_resources: [
      { id: "p_script", type: "Script", path: scriptPath },
      { id: "w_script", type: "Script", path: weaponScriptPath },
    ],
    sub_resources: [
      { id: "P_SHAPE", type: "RectangleShape2D", props: { size: { x: 28, y: 28 } } },
    ],
    root: {
      name: "Player",
      type: "CharacterBody2D",
      script: "p_script",
      props: { collision_layer: 2, collision_mask: 5 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(14, 14), color: { r: 0.3, g: 0.55, b: 1, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D", props: { shape: SubRef("P_SHAPE") } },
        {
          name: "WeaponPivot",
          type: "Node2D",
          script: "w_script",
          children: [
            { name: "DirectionMarker", type: "Polygon2D", props: { polygon: { __packed_vector2: [8, -4, 20, 0, 8, 4] }, color: { r: 1, g: 1, b: 1, a: 1 } } },
            { name: "Muzzle", type: "Marker2D", props: { position: { x: 22, y: 0 } } },
          ],
        },
        { name: "Camera2D", type: "Camera2D", props: { zoom: { x: 1, y: 1 }, position_smoothing_enabled: true, position_smoothing_speed: 8.0 } },
      ],
    },
  };
}

function specPlayerBullet(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/PlayerBullet.tscn",
    ext_resources: [{ id: "pb_script", type: "Script", path: scriptPath }],
    sub_resources: [{ id: "PB_SHAPE", type: "CircleShape2D", props: { radius: 5 } }],
    root: {
      name: "PlayerBullet",
      type: "Area2D",
      script: "pb_script",
      props: { collision_layer: 8, collision_mask: 5 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(5, 3), color: { r: 1, g: 0.95, b: 0.2, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D", props: { shape: SubRef("PB_SHAPE") } },
      ],
    },
  };
}

function specEnemyBullet(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/EnemyBullet.tscn",
    ext_resources: [{ id: "eb_script", type: "Script", path: scriptPath }],
    sub_resources: [{ id: "EB_SHAPE", type: "CircleShape2D", props: { radius: 5 } }],
    root: {
      name: "EnemyBullet",
      type: "Area2D",
      script: "eb_script",
      props: { collision_layer: 16, collision_mask: 3 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(5, 5), color: { r: 1, g: 0.4, b: 0.2, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D", props: { shape: SubRef("EB_SHAPE") } },
      ],
    },
  };
}

function specRoom(scriptPath: string, doorScenePath: string): SceneSpec {
  return {
    path: "res://scenes/Room.tscn",
    ext_resources: [
      { id: "r_script", type: "Script", path: scriptPath },
      { id: "door", type: "PackedScene", path: doorScenePath },
    ],
    sub_resources: [
      { id: "WHs", type: "RectangleShape2D", props: { size: { x: 320, y: 20 } } },
      { id: "WVs", type: "RectangleShape2D", props: { size: { x: 20, y: 200 } } },
      { id: "FillH", type: "RectangleShape2D", props: { size: { x: 80, y: 20 } } },
      { id: "FillV", type: "RectangleShape2D", props: { size: { x: 20, y: 80 } } },
      { id: "EnterArea", type: "RectangleShape2D", props: { size: { x: 600, y: 360 } } },
    ],
    root: {
      name: "Room",
      type: "Node2D",
      script: "r_script",
      children: [
        { name: "Floor", type: "Polygon2D", props: { polygon: { __packed_vector2: [0, 0, 720, 0, 720, 480, 0, 480] }, color: { r: 0.15, g: 0.15, b: 0.18, a: 1 } } },
        {
          name: "Walls", type: "StaticBody2D", props: { collision_layer: 1, collision_mask: 0 },
          children: [
            { name: "V_TL", type: "Polygon2D", props: { polygon: { __packed_vector2: [0, 0, 320, 0, 320, 20, 0, 20] }, color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
            { name: "V_TR", type: "Polygon2D", props: { polygon: { __packed_vector2: [400, 0, 720, 0, 720, 20, 400, 20] }, color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
            { name: "V_BL", type: "Polygon2D", props: { polygon: { __packed_vector2: [0, 460, 320, 460, 320, 480, 0, 480] }, color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
            { name: "V_BR", type: "Polygon2D", props: { polygon: { __packed_vector2: [400, 460, 720, 460, 720, 480, 400, 480] }, color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
            { name: "V_LT", type: "Polygon2D", props: { polygon: { __packed_vector2: [0, 0, 20, 0, 20, 200, 0, 200] }, color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
            { name: "V_LB", type: "Polygon2D", props: { polygon: { __packed_vector2: [0, 280, 20, 280, 20, 480, 0, 480] }, color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
            { name: "V_RT", type: "Polygon2D", props: { polygon: { __packed_vector2: [700, 0, 720, 0, 720, 200, 700, 200] }, color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
            { name: "V_RB", type: "Polygon2D", props: { polygon: { __packed_vector2: [700, 280, 720, 280, 720, 480, 700, 480] }, color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
            { name: "C_TL", type: "CollisionShape2D", props: { position: { x: 160, y: 10 }, shape: SubRef("WHs") } },
            { name: "C_TR", type: "CollisionShape2D", props: { position: { x: 560, y: 10 }, shape: SubRef("WHs") } },
            { name: "C_BL", type: "CollisionShape2D", props: { position: { x: 160, y: 470 }, shape: SubRef("WHs") } },
            { name: "C_BR", type: "CollisionShape2D", props: { position: { x: 560, y: 470 }, shape: SubRef("WHs") } },
            { name: "C_LT", type: "CollisionShape2D", props: { position: { x: 10, y: 100 }, shape: SubRef("WVs") } },
            { name: "C_LB", type: "CollisionShape2D", props: { position: { x: 10, y: 380 }, shape: SubRef("WVs") } },
            { name: "C_RT", type: "CollisionShape2D", props: { position: { x: 710, y: 100 }, shape: SubRef("WVs") } },
            { name: "C_RB", type: "CollisionShape2D", props: { position: { x: 710, y: 380 }, shape: SubRef("WVs") } },
          ],
        },
        {
          name: "Fills", type: "Node2D",
          children: [
            { name: "FillNorth", type: "StaticBody2D", props: { collision_layer: 1, collision_mask: 0, position: { x: 360, y: 10 } }, children: [
              { name: "V", type: "Polygon2D", props: { polygon: PolygonRect(40, 10), color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
              { name: "C", type: "CollisionShape2D", props: { shape: SubRef("FillH") } },
            ] },
            { name: "FillSouth", type: "StaticBody2D", props: { collision_layer: 1, collision_mask: 0, position: { x: 360, y: 470 } }, children: [
              { name: "V", type: "Polygon2D", props: { polygon: PolygonRect(40, 10), color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
              { name: "C", type: "CollisionShape2D", props: { shape: SubRef("FillH") } },
            ] },
            { name: "FillEast", type: "StaticBody2D", props: { collision_layer: 1, collision_mask: 0, position: { x: 710, y: 240 } }, children: [
              { name: "V", type: "Polygon2D", props: { polygon: PolygonRect(10, 40), color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
              { name: "C", type: "CollisionShape2D", props: { shape: SubRef("FillV") } },
            ] },
            { name: "FillWest", type: "StaticBody2D", props: { collision_layer: 1, collision_mask: 0, position: { x: 10, y: 240 } }, children: [
              { name: "V", type: "Polygon2D", props: { polygon: PolygonRect(10, 40), color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
              { name: "C", type: "CollisionShape2D", props: { shape: SubRef("FillV") } },
            ] },
          ],
        },
        {
          name: "Doors", type: "Node2D",
          children: [
            { name: "DoorNorth", instance: "door", props: { position: { x: 360, y: 10 }, direction: "north" } },
            { name: "DoorSouth", instance: "door", props: { position: { x: 360, y: 470 }, direction: "south" } },
            { name: "DoorEast", instance: "door", props: { position: { x: 710, y: 240 }, rotation: 1.5707963, direction: "east" } },
            { name: "DoorWest", instance: "door", props: { position: { x: 10, y: 240 }, rotation: 1.5707963, direction: "west" } },
          ],
        },
        {
          name: "SpawnPoints", type: "Node2D",
          children: [
            { name: "S1", type: "Marker2D", props: { position: { x: 200, y: 140 } } },
            { name: "S2", type: "Marker2D", props: { position: { x: 520, y: 140 } } },
            { name: "S3", type: "Marker2D", props: { position: { x: 360, y: 240 } } },
            { name: "S4", type: "Marker2D", props: { position: { x: 200, y: 340 } } },
            { name: "S5", type: "Marker2D", props: { position: { x: 520, y: 340 } } },
            { name: "S6", type: "Marker2D", props: { position: { x: 360, y: 360 } } },
          ],
        },
        {
          name: "EnterTrigger", type: "Area2D", props: { collision_layer: 0, collision_mask: 2 },
          children: [
            { name: "C", type: "CollisionShape2D", props: { position: { x: 360, y: 240 }, shape: SubRef("EnterArea") } },
          ],
        },
      ],
    },
  };
}

function specDoor(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/Door.tscn",
    ext_resources: [{ id: "d_script", type: "Script", path: scriptPath }],
    root: {
      name: "Door",
      type: "StaticBody2D",
      script: "d_script",
      props: { collision_layer: 1, collision_mask: 2 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(40, 10), color: { r: 0.7, g: 0.15, b: 0.15, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D" },
        { name: "Trigger", type: "Area2D", props: { collision_layer: 0, collision_mask: 2 }, children: [
          { name: "CollisionShape2D", type: "CollisionShape2D" },
        ] },
      ],
    },
  };
}

function specBoss(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/Boss.tscn",
    ext_resources: [{ id: "b_script", type: "Script", path: scriptPath }],
    root: {
      name: "Boss",
      type: "CharacterBody2D",
      script: "b_script",
      props: { collision_layer: 4, collision_mask: 3 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: { __packed_vector2: [-32, -32, 32, -32, 36, 0, 32, 32, -32, 32, -36, 0] }, color: { r: 0.85, g: 0.18, b: 0.1, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D" },
      ],
    },
  };
}

function specShopItem(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/ShopItem.tscn",
    ext_resources: [{ id: "s_script", type: "Script", path: scriptPath }],
    root: {
      name: "ShopItem",
      type: "Area2D",
      script: "s_script",
      props: { collision_layer: 0, collision_mask: 2 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(20, 20), color: { r: 0.55, g: 0.85, b: 1, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D" },
        { name: "Label", type: "Label", props: { offset_left: -60, offset_top: -56, offset_right: 60, offset_bottom: -16, text: "Item\n0 moedas", horizontal_alignment: 1 } },
      ],
    },
  };
}

function specChest(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/Chest.tscn",
    ext_resources: [{ id: "c_script", type: "Script", path: scriptPath }],
    root: {
      name: "Chest",
      type: "Area2D",
      script: "c_script",
      props: { collision_layer: 0, collision_mask: 2 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(20, 16), color: { r: 0.85, g: 0.65, b: 0.25, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D" },
        { name: "Prompt", type: "Label", props: { offset_left: -40, offset_top: -48, offset_right: 40, offset_bottom: -28, text: "[E] Abrir", horizontal_alignment: 1 } },
      ],
    },
  };
}

function specPickup(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/Pickup.tscn",
    ext_resources: [{ id: "pk_script", type: "Script", path: scriptPath }],
    root: {
      name: "Pickup",
      type: "Area2D",
      script: "pk_script",
      props: { collision_layer: 32, collision_mask: 2 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(8, 8), color: { r: 1, g: 0.85, b: 0.2, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D" },
      ],
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tool registration
// ────────────────────────────────────────────────────────────────────────────

const ParamsSchema = {
  script_dir: z.string().optional().default("res://scripts"),
  scenes_dir: z.string().optional().default("res://scenes"),
  overwrite: z.boolean().optional().default(false),
};

type Created = { res_path: string; written: boolean; reason?: string };

async function applyBlueprint(
  config: ServerConfig,
  blueprintName: string,
  scripts: Array<{ path: string; content: string; signals?: string[] }>,
  scenes: Array<{ spec: SceneSpec; kind: string; uses?: string[] }>,
  overwrite: boolean,
): Promise<{ files: Created[]; errors: string[] }> {
  if (config.security.readOnly) {
    return { files: [], errors: ["read-only mode: cannot apply blueprint"] };
  }
  const files: Created[] = [];
  const errors: string[] = [];

  for (const s of scripts) {
    try {
      const r = await writeScript(config.projectRoot, s.path, s.content, overwrite);
      files.push({ res_path: s.path, written: r.written, reason: r.reason });
      if (r.written) await recordScript(config.projectRoot, s.path, { signals: s.signals });
    } catch (e) {
      errors.push(`${s.path}: ${(e as Error).message}`);
    }
  }
  for (const sc of scenes) {
    try {
      const r = await writeScene(config.projectRoot, sc.spec, overwrite);
      files.push({ res_path: sc.spec.path, written: r.written, reason: r.reason });
      if (r.written) await recordScene(config.projectRoot, sc.spec.path, sc.kind, sc.uses);
    } catch (e) {
      errors.push(`${sc.spec.path}: ${(e as Error).message}`);
    }
  }
  await recordBlueprintApplied(config.projectRoot, blueprintName, { overwrite });
  return { files, errors };
}

export function registerBlueprintLibraryTools(server: McpServer, config: ServerConfig): void {
  // ── twin_stick ──────────────────────────────────────────────────────────
  server.tool(
    "devpilot_blueprint_twin_stick",
    "Apply twin-stick player blueprint: PlayerTwinStick.gd + PlayerWeapon.gd + PlayerTwinStick.tscn. Reads input actions move_*, shoot_* (IJKL), shoot_mouse, dodge_roll, reload. Pair with devpilot_blueprint_projectile_system + devpilot_apply_preset (input_map: twin_stick).",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_twin_stick", config), async () => {
          const playerScript = `${params.script_dir}/PlayerTwinStick.gd`;
          const weaponScript = `${params.script_dir}/PlayerWeapon.gd`;
          const sceneSpec = specPlayerTwinStick(playerScript, weaponScript);
          sceneSpec.path = `${params.scenes_dir}/PlayerTwinStick.tscn`;
          const r = await applyBlueprint(config, "twin_stick", [
            { path: playerScript, content: TWIN_STICK_PLAYER, signals: ["player_damaged", "player_died"] },
            { path: weaponScript, content: TWIN_STICK_WEAPON, signals: ["ammo_changed", "reload_started", "reload_finished"] },
          ], [
            { spec: sceneSpec, kind: "player", uses: [playerScript, weaponScript] },
          ], params.overwrite);
          return r.errors.length > 0
            ? createErrorResponse("BLUEPRINT_PARTIAL", r.errors.join("; "), { files: r.files }, [])
            : createSuccessResponse({ files: r.files }, "twin_stick blueprint applied.");
        })
      )
  );

  // ── projectile_system ───────────────────────────────────────────────────
  server.tool(
    "devpilot_blueprint_projectile_system",
    "Apply projectile system blueprint: Bullet.gd base + PlayerBullet.gd + EnemyBullet.gd + 2 scenes. Collision groups: player_bullets (layer 8), enemy_bullets (layer 16). Subclasses override _on_hit.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_projectile_system", config), async () => {
          const bulletScript = `${params.script_dir}/Bullet.gd`;
          const playerBulletScript = `${params.script_dir}/PlayerBullet.gd`;
          const enemyBulletScript = `${params.script_dir}/EnemyBullet.gd`;
          const playerBulletSpec = specPlayerBullet(playerBulletScript);
          playerBulletSpec.path = `${params.scenes_dir}/PlayerBullet.tscn`;
          const enemyBulletSpec = specEnemyBullet(enemyBulletScript);
          enemyBulletSpec.path = `${params.scenes_dir}/EnemyBullet.tscn`;
          const r = await applyBlueprint(config, "projectile_system", [
            { path: bulletScript, content: BULLET_BASE },
            { path: playerBulletScript, content: PLAYER_BULLET },
            { path: enemyBulletScript, content: ENEMY_BULLET },
          ], [
            { spec: playerBulletSpec, kind: "projectile", uses: [playerBulletScript] },
            { spec: enemyBulletSpec, kind: "projectile", uses: [enemyBulletScript] },
          ], params.overwrite);
          return r.errors.length > 0
            ? createErrorResponse("BLUEPRINT_PARTIAL", r.errors.join("; "), { files: r.files }, [])
            : createSuccessResponse({ files: r.files }, "projectile_system blueprint applied.");
        })
      )
  );

  // ── dungeon_room ────────────────────────────────────────────────────────
  server.tool(
    "devpilot_blueprint_dungeon_room",
    "Apply dungeon room blueprint: Room.tscn (perimeter walls + 4 fills + 4 doors + 6 spawn points + EnterTrigger) + Door.tscn + RoomManager.gd + DungeonManager.gd + Door.gd. Register DungeonManager as autoload manually.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_dungeon_room", config), async () => {
          const roomScript = `${params.script_dir}/RoomManager.gd`;
          const dungeonScript = `${params.script_dir}/DungeonManager.gd`;
          const doorScript = `${params.script_dir}/Door.gd`;
          const doorScenePath = `${params.scenes_dir}/Door.tscn`;
          const roomSpec = specRoom(roomScript, doorScenePath);
          roomSpec.path = `${params.scenes_dir}/Room.tscn`;
          const doorSpec = specDoor(doorScript);
          doorSpec.path = doorScenePath;
          const r = await applyBlueprint(config, "dungeon_room", [
            { path: roomScript, content: ROOM_MANAGER, signals: ["entered", "cleared"] },
            { path: dungeonScript, content: DUNGEON_MANAGER, signals: ["room_entered", "room_cleared"] },
            { path: doorScript, content: DOOR_SCRIPT },
          ], [
            { spec: roomSpec, kind: "room", uses: [roomScript, doorScenePath] },
            { spec: doorSpec, kind: "door", uses: [doorScript] },
          ], params.overwrite);
          return r.errors.length > 0
            ? createErrorResponse("BLUEPRINT_PARTIAL", r.errors.join("; "), { files: r.files }, [])
            : createSuccessResponse({ files: r.files, next_steps: [`Register autoload: devpilot_add_autoload name=DungeonManager path=${dungeonScript}`] }, "dungeon_room blueprint applied.");
        })
      )
  );

  // ── boss_arena ──────────────────────────────────────────────────────────
  server.tool(
    "devpilot_blueprint_boss_arena",
    "Apply boss arena blueprint: BossBase.gd w/ 3 attack patterns (radial 8, 3-shot burst, 5-shot sweep) + Boss.tscn placeholder. Override _emit_bullet() in subclass.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_boss_arena", config), async () => {
          const bossScript = `${params.script_dir}/BossBase.gd`;
          const bossSpec = specBoss(bossScript);
          bossSpec.path = `${params.scenes_dir}/Boss.tscn`;
          const r = await applyBlueprint(config, "boss_arena", [
            { path: bossScript, content: BOSS_BASE, signals: ["boss_damaged", "boss_defeated"] },
          ], [
            { spec: bossSpec, kind: "boss", uses: [bossScript] },
          ], params.overwrite);
          return r.errors.length > 0
            ? createErrorResponse("BLUEPRINT_PARTIAL", r.errors.join("; "), { files: r.files }, [])
            : createSuccessResponse({ files: r.files }, "boss_arena blueprint applied.");
        })
      )
  );

  // ── shop_item / chest / pickup ──────────────────────────────────────────
  server.tool(
    "devpilot_blueprint_shop_item",
    "Apply shop item blueprint: Area2D with item_kind + cost + interact-to-buy. Emits purchased(kind).",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_shop_item", config), async () => {
          const script = `${params.script_dir}/ShopItem.gd`;
          const spec = specShopItem(script);
          spec.path = `${params.scenes_dir}/ShopItem.tscn`;
          const r = await applyBlueprint(config, "shop_item", [
            { path: script, content: SHOP_ITEM_SCRIPT, signals: ["purchased"] },
          ], [{ spec, kind: "shop_item", uses: [script] }], params.overwrite);
          return r.errors.length > 0
            ? createErrorResponse("BLUEPRINT_PARTIAL", r.errors.join("; "), { files: r.files }, [])
            : createSuccessResponse({ files: r.files }, "shop_item applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_chest",
    "Apply chest blueprint: Area2D with interact-to-open + opened signal + Prompt label.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_chest", config), async () => {
          const script = `${params.script_dir}/Chest.gd`;
          const spec = specChest(script);
          spec.path = `${params.scenes_dir}/Chest.tscn`;
          const r = await applyBlueprint(config, "chest", [
            { path: script, content: CHEST_SCRIPT, signals: ["opened"] },
          ], [{ spec, kind: "chest", uses: [script] }], params.overwrite);
          return r.errors.length > 0
            ? createErrorResponse("BLUEPRINT_PARTIAL", r.errors.join("; "), { files: r.files }, [])
            : createSuccessResponse({ files: r.files }, "chest applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_pickup",
    "Apply pickup blueprint: Area2D supporting kind=coin/heart/ammo with picked_up(kind, by) signal.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_pickup", config), async () => {
          const script = `${params.script_dir}/Pickup.gd`;
          const spec = specPickup(script);
          spec.path = `${params.scenes_dir}/Pickup.tscn`;
          const r = await applyBlueprint(config, "pickup", [
            { path: script, content: PICKUP_SCRIPT, signals: ["picked_up"] },
          ], [{ spec, kind: "pickup", uses: [script] }], params.overwrite);
          return r.errors.length > 0
            ? createErrorResponse("BLUEPRINT_PARTIAL", r.errors.join("; "), { files: r.files }, [])
            : createSuccessResponse({ files: r.files }, "pickup applied.");
        })
      )
  );
}
