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

async function writeFileWithMkdir(absPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, content, "utf8");
}

// ── Templates ────────────────────────────────────────────────────────────────

const PLAYER_3D_FPS = `extends CharacterBody3D

@export var speed: float = 5.0
@export var jump_velocity: float = 4.5
@export var mouse_sensitivity: float = 0.002
@export var max_hp: int = 100

signal player_damaged(current_hp: int, max_hp: int)
signal player_died

var hp: int = 100
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)

var camera_pivot: Node3D = null

func _ready() -> void:
	add_to_group("player")
	hp = max_hp
	if has_node("CameraPivot"):
		camera_pivot = get_node("CameraPivot")
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		rotate_y(-event.relative.x * mouse_sensitivity)
		if camera_pivot:
			camera_pivot.rotate_x(-event.relative.y * mouse_sensitivity)
			camera_pivot.rotation.x = clamp(camera_pivot.rotation.x, -PI / 2, PI / 2)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= _gravity * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity
	var input_dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	var direction := (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	if direction.length() > 0.0:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)
	move_and_slide()

func take_damage(amount: int) -> void:
	hp = max(0, hp - amount)
	player_damaged.emit(hp, max_hp)
	if hp <= 0:
		player_died.emit()
`;

const PLAYER_3D_TPS = `extends CharacterBody3D

@export var speed: float = 5.5
@export var jump_velocity: float = 5.0
@export var mouse_sensitivity: float = 0.0035
@export var camera_distance: float = 4.0

var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)
var camera_pivot: Node3D = null
var camera: Camera3D = null

func _ready() -> void:
	add_to_group("player")
	if has_node("CameraPivot"):
		camera_pivot = get_node("CameraPivot")
	if has_node("CameraPivot/Camera3D"):
		camera = get_node("CameraPivot/Camera3D")
		camera.position.z = camera_distance
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and camera_pivot:
		camera_pivot.rotate_y(-event.relative.x * mouse_sensitivity)
		camera_pivot.rotate_object_local(Vector3.RIGHT, -event.relative.y * mouse_sensitivity)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= _gravity * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity
	var input_dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	var basis := camera_pivot.global_transform.basis if camera_pivot else transform.basis
	var direction := (basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	direction.y = 0
	if direction.length() > 0.0:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
		look_at(global_position + direction, Vector3.UP)
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)
	move_and_slide()
`;

const ENEMY_3D = `extends CharacterBody3D

@export var max_hp: int = 3
@export var speed: float = 3.0
@export var detect_radius: float = 8.0
@export var contact_damage: int = 1
@export var contact_cooldown: float = 0.6

signal died(enemy: Node)

var hp: int = 3
var _hit_timer: float = 0.0
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)

func _ready() -> void:
	add_to_group("enemies")
	hp = max_hp

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= _gravity * delta
	_hit_timer = max(0.0, _hit_timer - delta)
	var p := _get_player()
	if p and global_position.distance_to(p.global_position) <= detect_radius:
		var dir := (p.global_position - global_position)
		dir.y = 0
		dir = dir.normalized()
		velocity.x = dir.x * speed
		velocity.z = dir.z * speed
		_try_hit(p)
	else:
		velocity.x = 0
		velocity.z = 0
	move_and_slide()

func _try_hit(p: Node3D) -> void:
	if _hit_timer > 0.0:
		return
	if global_position.distance_to(p.global_position) < 1.5 and p.has_method("take_damage"):
		p.take_damage(contact_damage)
		_hit_timer = contact_cooldown

func take_damage(amount: int) -> void:
	hp = max(0, hp - amount)
	if hp <= 0:
		died.emit(self)
		queue_free()

func _get_player() -> Node3D:
	var arr: Array = get_tree().get_nodes_in_group("player")
	if arr.is_empty():
		return null
	return arr[0] as Node3D
`;

const PROJECTILE_3D = `extends Area3D

@export var speed: float = 30.0
@export var damage: int = 1
@export var lifetime: float = 2.0
@export var direction: Vector3 = Vector3.FORWARD

var _life: float = 0.0

func _ready() -> void:
	_life = lifetime
	body_entered.connect(_on_body_entered)

func _physics_process(delta: float) -> void:
	_life -= delta
	if _life <= 0.0:
		queue_free()
		return
	global_position += direction.normalized() * speed * delta

func _on_body_entered(body: Node) -> void:
	if body.is_in_group("player") or body.is_in_group("player_projectiles"):
		return
	if body.is_in_group("enemies") and body.has_method("take_damage"):
		body.take_damage(damage)
		queue_free()
		return
	if body is StaticBody3D:
		queue_free()
`;

// ── Scene specs ──────────────────────────────────────────────────────────────

function specPlayer3D(scriptPath: string, mode: "fps" | "tps"): SceneSpec {
  const children = mode === "fps"
    ? [
        { name: "Visual", type: "MeshInstance3D", props: { mesh: SubRef("M_BODY") } },
        { name: "CollisionShape3D", type: "CollisionShape3D", props: { shape: SubRef("S_BODY") } },
        {
          name: "CameraPivot", type: "Node3D", props: { position: { x: 0, y: 1.6, z: 0 } },
          children: [
            { name: "Camera3D", type: "Camera3D" },
          ],
        },
      ]
    : [
        { name: "Visual", type: "MeshInstance3D", props: { mesh: SubRef("M_BODY") } },
        { name: "CollisionShape3D", type: "CollisionShape3D", props: { shape: SubRef("S_BODY") } },
        {
          name: "CameraPivot", type: "Node3D", props: { position: { x: 0, y: 1.6, z: 0 } },
          children: [
            { name: "Camera3D", type: "Camera3D", props: { position: { x: 0, y: 0.5, z: 4 } } },
          ],
        },
      ];
  return {
    path: "res://scenes/Player3D.tscn",
    ext_resources: [{ id: "p_script", type: "Script", path: scriptPath }],
    sub_resources: [
      { id: "M_BODY", type: "BoxMesh", props: { size: { x: 0.8, y: 1.8, z: 0.8 } } },
      { id: "S_BODY", type: "BoxShape3D", props: { size: { x: 0.8, y: 1.8, z: 0.8 } } },
    ],
    root: {
      name: "Player3D", type: "CharacterBody3D", script: "p_script",
      props: { collision_layer: 2, collision_mask: 1 },
      children,
    },
  };
}

function specEnemy3D(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/Enemy3D.tscn",
    ext_resources: [{ id: "e_script", type: "Script", path: scriptPath }],
    sub_resources: [
      { id: "M_E", type: "BoxMesh", props: { size: { x: 0.8, y: 1.5, z: 0.8 } } },
      { id: "S_E", type: "BoxShape3D", props: { size: { x: 0.8, y: 1.5, z: 0.8 } } },
      { id: "MAT_E", type: "StandardMaterial3D", props: { albedo_color: { r: 0.95, g: 0.25, b: 0.25, a: 1 } } },
    ],
    root: {
      name: "Enemy3D", type: "CharacterBody3D", script: "e_script",
      props: { collision_layer: 4, collision_mask: 3 },
      children: [
        { name: "Visual", type: "MeshInstance3D", props: { mesh: SubRef("M_E"), material_override: SubRef("MAT_E") } },
        { name: "CollisionShape3D", type: "CollisionShape3D", props: { shape: SubRef("S_E") } },
      ],
    },
  };
}

function specProjectile3D(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/PlayerProjectile3D.tscn",
    ext_resources: [{ id: "pr_script", type: "Script", path: scriptPath }],
    sub_resources: [
      { id: "M_PR", type: "BoxMesh", props: { size: { x: 0.15, y: 0.15, z: 0.4 } } },
      { id: "S_PR", type: "BoxShape3D", props: { size: { x: 0.15, y: 0.15, z: 0.4 } } },
      { id: "MAT_PR", type: "StandardMaterial3D", props: { albedo_color: { r: 1, g: 0.95, b: 0.2, a: 1 }, emission_enabled: true, emission: { r: 1, g: 0.95, b: 0.2, a: 1 } } },
    ],
    root: {
      name: "PlayerProjectile3D", type: "Area3D", script: "pr_script",
      props: { collision_layer: 8, collision_mask: 5 },
      children: [
        { name: "Visual", type: "MeshInstance3D", props: { mesh: SubRef("M_PR"), material_override: SubRef("MAT_PR") } },
        { name: "CollisionShape3D", type: "CollisionShape3D", props: { shape: SubRef("S_PR") } },
      ],
    },
  };
}

function specRoom3D(): SceneSpec {
  // 16x10 room with floor + 4 walls (each StaticBody3D + MeshInstance3D box) + ceiling.
  return {
    path: "res://scenes/Room3D.tscn",
    sub_resources: [
      { id: "M_FLOOR", type: "BoxMesh", props: { size: { x: 16, y: 0.4, z: 16 } } },
      { id: "S_FLOOR", type: "BoxShape3D", props: { size: { x: 16, y: 0.4, z: 16 } } },
      { id: "MAT_FLOOR", type: "StandardMaterial3D", props: { albedo_color: { r: 0.18, g: 0.18, b: 0.21, a: 1 } } },
      { id: "M_WALL_LR", type: "BoxMesh", props: { size: { x: 0.4, y: 4, z: 16 } } },
      { id: "S_WALL_LR", type: "BoxShape3D", props: { size: { x: 0.4, y: 4, z: 16 } } },
      { id: "M_WALL_FB", type: "BoxMesh", props: { size: { x: 16, y: 4, z: 0.4 } } },
      { id: "S_WALL_FB", type: "BoxShape3D", props: { size: { x: 16, y: 4, z: 0.4 } } },
      { id: "MAT_WALL", type: "StandardMaterial3D", props: { albedo_color: { r: 0.05, g: 0.05, b: 0.08, a: 1 } } },
    ],
    root: {
      name: "Room3D", type: "Node3D",
      children: [
        { name: "DirectionalLight", type: "DirectionalLight3D", props: { rotation: { x: -0.6, y: 0.4, z: 0 } } },
        {
          name: "Floor", type: "StaticBody3D", props: { collision_layer: 1, collision_mask: 0 },
          children: [
            { name: "Mesh", type: "MeshInstance3D", props: { mesh: SubRef("M_FLOOR"), material_override: SubRef("MAT_FLOOR") } },
            { name: "Coll", type: "CollisionShape3D", props: { shape: SubRef("S_FLOOR") } },
          ],
        },
        {
          name: "WallEast", type: "StaticBody3D", props: { collision_layer: 1, collision_mask: 0, position: { x: 8, y: 2, z: 0 } },
          children: [
            { name: "Mesh", type: "MeshInstance3D", props: { mesh: SubRef("M_WALL_LR"), material_override: SubRef("MAT_WALL") } },
            { name: "Coll", type: "CollisionShape3D", props: { shape: SubRef("S_WALL_LR") } },
          ],
        },
        {
          name: "WallWest", type: "StaticBody3D", props: { collision_layer: 1, collision_mask: 0, position: { x: -8, y: 2, z: 0 } },
          children: [
            { name: "Mesh", type: "MeshInstance3D", props: { mesh: SubRef("M_WALL_LR"), material_override: SubRef("MAT_WALL") } },
            { name: "Coll", type: "CollisionShape3D", props: { shape: SubRef("S_WALL_LR") } },
          ],
        },
        {
          name: "WallNorth", type: "StaticBody3D", props: { collision_layer: 1, collision_mask: 0, position: { x: 0, y: 2, z: -8 } },
          children: [
            { name: "Mesh", type: "MeshInstance3D", props: { mesh: SubRef("M_WALL_FB"), material_override: SubRef("MAT_WALL") } },
            { name: "Coll", type: "CollisionShape3D", props: { shape: SubRef("S_WALL_FB") } },
          ],
        },
        {
          name: "WallSouth", type: "StaticBody3D", props: { collision_layer: 1, collision_mask: 0, position: { x: 0, y: 2, z: 8 } },
          children: [
            { name: "Mesh", type: "MeshInstance3D", props: { mesh: SubRef("M_WALL_FB"), material_override: SubRef("MAT_WALL") } },
            { name: "Coll", type: "CollisionShape3D", props: { shape: SubRef("S_WALL_FB") } },
          ],
        },
      ],
    },
  };
}

// ── Apply helpers ────────────────────────────────────────────────────────────

async function writeScript(projectRoot: string, resPath: string, raw: string, overwrite: boolean): Promise<{ written: boolean; reason?: string }> {
  const r = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return { written: false, reason: "exists" };
  await writeFileWithMkdir(r.absolutePath, autoFixGDScript(raw));
  return { written: true };
}

async function writeScene(projectRoot: string, spec: SceneSpec, overwrite: boolean): Promise<{ written: boolean; reason?: string }> {
  const r = resolveProjectPath(spec.path, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return { written: false, reason: "exists" };
  await writeFileWithMkdir(r.absolutePath, serializeSceneToTscn(spec));
  return { written: true };
}

const ParamsSchema = {
  script_dir: z.string().optional().default("res://scripts"),
  scenes_dir: z.string().optional().default("res://scenes"),
  overwrite: z.boolean().optional().default(false),
};

export function registerBlueprintLibrary3DTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_blueprint_player_3d",
    "[3D] CharacterBody3D player + camera (FPS or TPS) + mouse capture + WASD movement + jump + gravity. Mode param chooses fps/tps. Includes BoxMesh placeholder visual.",
    {
      ...ParamsSchema,
      mode: z.enum(["fps", "tps"]).optional().default("fps"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_player_3d", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "Cannot apply blueprint.", {}, []);
          const scriptName = params.mode === "fps" ? "Player3DFPS.gd" : "Player3DTPS.gd";
          const scriptPath = `${params.script_dir}/${scriptName}`;
          const tmpl = params.mode === "fps" ? PLAYER_3D_FPS : PLAYER_3D_TPS;
          const w1 = await writeScript(config.projectRoot, scriptPath, tmpl, params.overwrite);
          const sceneSpec = specPlayer3D(scriptPath, params.mode);
          sceneSpec.path = `${params.scenes_dir}/Player3D.tscn`;
          const w2 = await writeScene(config.projectRoot, sceneSpec, params.overwrite);
          if (w1.written) await recordScript(config.projectRoot, scriptPath, { signals: ["player_damaged", "player_died"] });
          if (w2.written) await recordScene(config.projectRoot, sceneSpec.path, "player_3d", [scriptPath]);
          await recordBlueprintApplied(config.projectRoot, "player_3d", { mode: params.mode });
          return createSuccessResponse({ files: [scriptPath, sceneSpec.path], mode: params.mode }, `player_3d (${params.mode}) blueprint applied.`);
        })
      )
  );

  server.tool(
    "devpilot_blueprint_enemy_3d",
    "[3D] CharacterBody3D enemy with chase/contact AI + take_damage. BoxMesh placeholder red.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_enemy_3d", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const scriptPath = `${params.script_dir}/Enemy3D.gd`;
          const w1 = await writeScript(config.projectRoot, scriptPath, ENEMY_3D, params.overwrite);
          const sceneSpec = specEnemy3D(scriptPath);
          sceneSpec.path = `${params.scenes_dir}/Enemy3D.tscn`;
          const w2 = await writeScene(config.projectRoot, sceneSpec, params.overwrite);
          if (w1.written) await recordScript(config.projectRoot, scriptPath, { signals: ["died"] });
          if (w2.written) await recordScene(config.projectRoot, sceneSpec.path, "enemy_3d", [scriptPath]);
          await recordBlueprintApplied(config.projectRoot, "enemy_3d");
          return createSuccessResponse({ files: [scriptPath, sceneSpec.path] }, "enemy_3d applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_projectile_3d",
    "[3D] Area3D projectile with BoxMesh + emissive material + lifetime + body collision.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_projectile_3d", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const scriptPath = `${params.script_dir}/PlayerProjectile3D.gd`;
          const w1 = await writeScript(config.projectRoot, scriptPath, PROJECTILE_3D, params.overwrite);
          const sceneSpec = specProjectile3D(scriptPath);
          sceneSpec.path = `${params.scenes_dir}/PlayerProjectile3D.tscn`;
          const w2 = await writeScene(config.projectRoot, sceneSpec, params.overwrite);
          if (w1.written) await recordScript(config.projectRoot, scriptPath, {});
          if (w2.written) await recordScene(config.projectRoot, sceneSpec.path, "projectile_3d", [scriptPath]);
          await recordBlueprintApplied(config.projectRoot, "projectile_3d");
          return createSuccessResponse({ files: [scriptPath, sceneSpec.path] }, "projectile_3d applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_dungeon_room_3d",
    "[3D] Room3D 16x16 floor + 4 walls + DirectionalLight. StaticBody3D walls with BoxShape3D collision. No script attached — purely level geometry.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_dungeon_room_3d", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const sceneSpec = specRoom3D();
          sceneSpec.path = `${params.scenes_dir}/Room3D.tscn`;
          const w = await writeScene(config.projectRoot, sceneSpec, params.overwrite);
          if (w.written) await recordScene(config.projectRoot, sceneSpec.path, "room_3d", []);
          await recordBlueprintApplied(config.projectRoot, "dungeon_room_3d");
          return createSuccessResponse({ files: [sceneSpec.path] }, "dungeon_room_3d applied.");
        })
      )
  );
}

// Metadata exported for registry.
export const BLUEPRINT_3D_REGISTRY = [
  { name: "player_3d", description: "[3D] CharacterBody3D player FPS/TPS", category: "player", files_created: ["scripts/Player3D{FPS,TPS}.gd", "scenes/Player3D.tscn"], params_schema: { mode: "string?", overwrite: "bool?" }, example: { mode: "fps" } },
  { name: "enemy_3d", description: "[3D] CharacterBody3D enemy chase AI", category: "combat", files_created: ["scripts/Enemy3D.gd", "scenes/Enemy3D.tscn"], params_schema: {}, example: {} },
  { name: "projectile_3d", description: "[3D] Area3D projectile", category: "combat", files_created: ["scripts/PlayerProjectile3D.gd", "scenes/PlayerProjectile3D.tscn"], params_schema: {}, example: {} },
  { name: "dungeon_room_3d", description: "[3D] Room geometry (floor + walls + light)", category: "level", files_created: ["scenes/Room3D.tscn"], params_schema: {}, example: {} },
];
