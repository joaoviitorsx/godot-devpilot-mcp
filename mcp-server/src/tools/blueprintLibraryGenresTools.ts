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
import { serializeSceneToTscn, type SceneSpec, SubRef, PolygonRect } from "../utils/sceneSerializer.js";
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

// ── RTS Unit ─────────────────────────────────────────────────────────────────

const RTS_UNIT = `extends CharacterBody2D
class_name RtsUnit

@export var speed: float = 120.0
@export var arrival_threshold: float = 6.0
@export var team: String = "player"

signal selected(unit: RtsUnit)
signal deselected(unit: RtsUnit)
signal arrived(unit: RtsUnit)

var _target_pos: Vector2 = Vector2.ZERO
var _moving: bool = false
var _is_selected: bool = false

@onready var visual: Polygon2D = $Visual

func _ready() -> void:
	add_to_group("rts_units")
	_target_pos = global_position

func _physics_process(_delta: float) -> void:
	if not _moving:
		velocity = Vector2.ZERO
		return
	var to_target := _target_pos - global_position
	if to_target.length() <= arrival_threshold:
		_moving = false
		velocity = Vector2.ZERO
		arrived.emit(self)
		return
	velocity = to_target.normalized() * speed
	move_and_slide()

func move_to(world_pos: Vector2) -> void:
	_target_pos = world_pos
	_moving = true

func set_selected(s: bool) -> void:
	_is_selected = s
	if visual:
		visual.modulate = Color(1, 1, 0.3, 1) if s else Color(1, 1, 1, 1)
	if s:
		selected.emit(self)
	else:
		deselected.emit(self)

func is_selected() -> bool:
	return _is_selected
`;

const RTS_CONTROLLER = `extends Node2D
# Click-to-select + right-click-to-move + drag-rectangle selection.
# Attach as child of your level root or as a top-level controller.

@export var selection_button: int = MOUSE_BUTTON_LEFT
@export var move_button: int = MOUSE_BUTTON_RIGHT
@export var drag_threshold: float = 6.0

var _drag_start: Vector2 = Vector2.ZERO
var _dragging: bool = false
var _selected: Array = []

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == selection_button:
			if event.pressed:
				_drag_start = event.position
				_dragging = false
			else:
				if not _dragging:
					_select_at(event.position)
				else:
					_select_rect(_drag_start, event.position)
				_dragging = false
		elif event.button_index == move_button and event.pressed:
			_command_move(get_global_mouse_position())
	elif event is InputEventMouseMotion and Input.is_mouse_button_pressed(selection_button):
		if not _dragging and _drag_start.distance_to(event.position) > drag_threshold:
			_dragging = true

func _select_at(screen_pos: Vector2) -> void:
	_clear_selection()
	var world_pos := get_global_mouse_position()
	for u in get_tree().get_nodes_in_group("rts_units"):
		if u is Node2D and u.global_position.distance_to(world_pos) < 24.0:
			_selected.append(u)
			u.set_selected(true)
			return

func _select_rect(a: Vector2, b: Vector2) -> void:
	_clear_selection()
	var rect := Rect2(a, b - a).abs()
	for u in get_tree().get_nodes_in_group("rts_units"):
		if u is Node2D and rect.has_point(get_viewport().get_canvas_transform() * u.global_position):
			_selected.append(u)
			u.set_selected(true)

func _command_move(world_pos: Vector2) -> void:
	for i in _selected.size():
		var offset := Vector2(cos(i * TAU / max(1, _selected.size())), sin(i * TAU / max(1, _selected.size()))) * 24.0
		_selected[i].move_to(world_pos + offset)

func _clear_selection() -> void:
	for u in _selected:
		if is_instance_valid(u):
			u.set_selected(false)
	_selected.clear()
`;

function specRtsUnit(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/RtsUnit.tscn",
    ext_resources: [{ id: "u_script", type: "Script", path: scriptPath }],
    sub_resources: [{ id: "U_SHAPE", type: "RectangleShape2D", props: { size: { x: 24, y: 24 } } }],
    root: {
      name: "RtsUnit", type: "CharacterBody2D", script: "u_script",
      props: { collision_layer: 2, collision_mask: 1 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(12, 12), color: { r: 0.2, g: 0.7, b: 0.4, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D", props: { shape: SubRef("U_SHAPE") } },
      ],
    },
  };
}

// ── Physics Puzzle ───────────────────────────────────────────────────────────

const DRAGGABLE_BODY = `extends RigidBody2D
class_name DraggableBody

@export var drag_force: float = 1500.0

var _dragging: bool = false

func _ready() -> void:
	add_to_group("draggables")
	input_pickable = true
	input_event.connect(_on_input)

func _on_input(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		_dragging = event.pressed

func _physics_process(_delta: float) -> void:
	if _dragging:
		var to_mouse := get_global_mouse_position() - global_position
		linear_velocity = to_mouse.normalized() * min(drag_force, to_mouse.length() * 10.0)
`;

const PHYSICS_PUZZLE_HELPER = `extends Node2D
# Helper to spawn pin-jointed chains/structures programmatically.

@export var body_scene: PackedScene
@export var spawn_count: int = 3
@export var spacing: float = 64.0

func build_chain(anchor: Vector2) -> Array:
	if body_scene == null:
		return []
	var bodies: Array = []
	var prev: PhysicsBody2D = null
	for i in spawn_count:
		var b := body_scene.instantiate()
		add_child(b)
		b.global_position = anchor + Vector2(i * spacing, 0)
		bodies.append(b)
		if prev:
			var joint := PinJoint2D.new()
			add_child(joint)
			joint.global_position = (prev.global_position + b.global_position) / 2.0
			joint.node_a = prev.get_path()
			joint.node_b = b.get_path()
		prev = b
	return bodies
`;

function specDraggableBody(scriptPath: string): SceneSpec {
  return {
    path: "res://scenes/DraggableBody.tscn",
    ext_resources: [{ id: "db_script", type: "Script", path: scriptPath }],
    sub_resources: [{ id: "D_SHAPE", type: "RectangleShape2D", props: { size: { x: 40, y: 40 } } }],
    root: {
      name: "DraggableBody", type: "RigidBody2D", script: "db_script",
      props: { collision_layer: 1, collision_mask: 1, gravity_scale: 1.0 },
      children: [
        { name: "Visual", type: "Polygon2D", props: { polygon: PolygonRect(20, 20), color: { r: 0.85, g: 0.55, b: 0.25, a: 1 } } },
        { name: "CollisionShape2D", type: "CollisionShape2D", props: { shape: SubRef("D_SHAPE") } },
      ],
    },
  };
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerBlueprintLibraryGenresTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_blueprint_rts_unit",
    "RTS unit blueprint: CharacterBody2D unit (selectable, move_to API) + RtsController (LMB select, RMB move, drag-rect group select). Ready for a strategy game prototype.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_rts_unit", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const up = `${params.script_dir}/RtsUnit.gd`;
          const cp = `${params.script_dir}/RtsController.gd`;
          const w1 = await writeIfNew(config.projectRoot, up, RTS_UNIT, true, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, cp, RTS_CONTROLLER, true, params.overwrite);
          const sceneSpec = specRtsUnit(up);
          sceneSpec.path = `${params.scenes_dir}/RtsUnit.tscn`;
          const w3 = await writeIfNew(config.projectRoot, sceneSpec.path, serializeSceneToTscn(sceneSpec), false, params.overwrite);
          if (w1) await recordScript(config.projectRoot, up, { signals: ["selected", "deselected", "arrived"] });
          if (w2) await recordScript(config.projectRoot, cp, {});
          if (w3) await recordScene(config.projectRoot, sceneSpec.path, "rts_unit", [up]);
          await recordBlueprintApplied(config.projectRoot, "rts_unit");
          return createSuccessResponse({ files: [up, cp, sceneSpec.path] }, "rts_unit applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_physics_puzzle",
    "Physics puzzle blueprint: DraggableBody (RigidBody2D + mouse drag) + PhysicsPuzzleHelper (build pin-jointed chain). Foundation for joint-based puzzle games.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_physics_puzzle", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const dp = `${params.script_dir}/DraggableBody.gd`;
          const hp = `${params.script_dir}/PhysicsPuzzleHelper.gd`;
          const w1 = await writeIfNew(config.projectRoot, dp, DRAGGABLE_BODY, true, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, hp, PHYSICS_PUZZLE_HELPER, true, params.overwrite);
          const sceneSpec = specDraggableBody(dp);
          sceneSpec.path = `${params.scenes_dir}/DraggableBody.tscn`;
          const w3 = await writeIfNew(config.projectRoot, sceneSpec.path, serializeSceneToTscn(sceneSpec), false, params.overwrite);
          if (w1) await recordScript(config.projectRoot, dp, {});
          if (w2) await recordScript(config.projectRoot, hp, {});
          if (w3) await recordScene(config.projectRoot, sceneSpec.path, "draggable", [dp]);
          await recordBlueprintApplied(config.projectRoot, "physics_puzzle");
          return createSuccessResponse({ files: [dp, hp, sceneSpec.path] }, "physics_puzzle applied.");
        })
      )
  );
}

export const BLUEPRINT_GENRES_REGISTRY = [
  { name: "rts_unit", description: "RTS unit + selection/move-to controller", category: "rts", files_created: ["scripts/RtsUnit.gd", "scripts/RtsController.gd", "scenes/RtsUnit.tscn"], params_schema: {}, example: {} },
  { name: "physics_puzzle", description: "Draggable RigidBody2D + chain helper (PinJoint2D)", category: "puzzle", files_created: ["scripts/DraggableBody.gd", "scripts/PhysicsPuzzleHelper.gd", "scenes/DraggableBody.tscn"], params_schema: {}, example: {} },
];
