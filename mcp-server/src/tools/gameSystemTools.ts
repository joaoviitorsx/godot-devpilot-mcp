import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { createSafetyError } from "../safety/errors.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

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

async function fileExists(absPath: string): Promise<boolean> {
  try { await access(absPath); return true; } catch { return false; }
}

async function writeScriptFile(projectRoot: string, resPath: string, content: string, allowOverwrite: boolean): Promise<{ written: boolean; reason?: string; absPath: string }> {
  const resolved = resolveProjectPath(resPath, projectRoot);
  if (!resolved.resPath.endsWith(".gd")) {
    throw createSafetyError("INVALID_PARAMS", "script path must end in .gd.", { path: resPath }, []);
  }
  const exists = await fileExists(resolved.absolutePath);
  if (exists && !allowOverwrite) {
    return { written: false, reason: "Script exists. Pass overwrite=true.", absPath: resolved.absolutePath };
  }
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, content, "utf8");
  return { written: true, absPath: resolved.absolutePath };
}

const addChildNode = (g: GodotClient, parent: string, type: string, name: string) =>
  callRpc(g, "node.add", { parent_path: parent, node_type: type, node_name: name });
const setProp = (g: GodotClient, nodePath: string, property: string, value: unknown) =>
  callRpc(g, "node.set_property", { node_path: nodePath, property, value });
const attachScript = (g: GodotClient, nodePath: string, scriptPath: string) =>
  callRpc(g, "script.attach", { node_path: nodePath, script_path: scriptPath });

const childPath = (parent: string, name: string) => parent === "." ? name : `${parent}/${name}`;

function dryRun(toolName: string, plan: string[], files?: string[], nodes?: string[]) {
  return createDryRunResponse({ toolName, plannedChanges: plan, affectedFiles: files, affectedNodes: nodes });
}

// ── Templates ────────────────────────────────────────────────────────────────

const PLAYER_PLATFORMER = `extends CharacterBody2D

@export var speed: float = 250.0
@export var jump_velocity: float = -400.0
@export var gravity: float = 980.0

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += gravity * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity
	var direction := Input.get_axis("move_left", "move_right")
	if direction != 0.0:
		velocity.x = direction * speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
	move_and_slide()
`;

const PLAYER_TOPDOWN = `extends CharacterBody2D

@export var speed: float = 200.0

func _physics_process(_delta: float) -> void:
	var direction := Vector2.ZERO
	direction.x = Input.get_axis("move_left", "move_right")
	direction.y = Input.get_axis("move_up", "move_down")
	if direction.length() > 1.0:
		direction = direction.normalized()
	velocity = direction * speed
	move_and_slide()
`;

const PLAYER_SIDESCROLLER = `extends CharacterBody2D

@export var speed: float = 220.0

func _physics_process(_delta: float) -> void:
	var direction := Input.get_axis("move_left", "move_right")
	velocity.x = direction * speed
	move_and_slide()
`;

const HEALTH_SYSTEM = `extends Node

signal health_changed(new_value: int, max_value: int)
signal damaged(amount: int)
signal died

@export var max_health: int = 100
@export var invincibility_time: float = 0.4

var current_health: int
var _invincible: bool = false

func _ready() -> void:
	current_health = max_health
	health_changed.emit(current_health, max_health)

func damage(amount: int) -> void:
	if _invincible or current_health <= 0:
		return
	current_health = max(0, current_health - amount)
	damaged.emit(amount)
	health_changed.emit(current_health, max_health)
	if current_health == 0:
		died.emit()
		return
	_invincible = true
	await get_tree().create_timer(invincibility_time).timeout
	_invincible = false

func heal(amount: int) -> void:
	current_health = min(max_health, current_health + amount)
	health_changed.emit(current_health, max_health)
`;

const DAMAGE_DEALER = `extends Area2D

signal damage_dealt(target: Node, amount: int)

@export var damage_amount: int = 10
@export var one_shot: bool = false

func _ready() -> void:
	body_entered.connect(_on_body_entered)
	area_entered.connect(_on_area_entered)

func _try_deal(target: Node) -> void:
	if target == null or not is_instance_valid(target):
		return
	if target.is_in_group("damageable"):
		var receiver := target.find_child("DamageReceiver", true, false)
		if receiver and receiver.has_method("receive_damage"):
			receiver.receive_damage(damage_amount, self)
			damage_dealt.emit(target, damage_amount)
			if one_shot:
				queue_free()

func _on_body_entered(body: Node) -> void:
	_try_deal(body)

func _on_area_entered(area: Area2D) -> void:
	_try_deal(area)
`;

const DAMAGE_RECEIVER = `extends Node

signal damage_received(amount: int, source: Node)

@export var health_node_path: NodePath

func receive_damage(amount: int, source: Node) -> void:
	damage_received.emit(amount, source)
	if health_node_path.is_empty():
		return
	var health := get_node_or_null(health_node_path)
	if health and health.has_method("damage"):
		health.damage(amount)
`;

const INTERACTION_SYSTEM = `extends Area2D

signal interactable_entered(node: Node)
signal interactable_left(node: Node)
signal interact_pressed(target: Node)

@export var interact_action: String = "interact"

var _candidates: Array[Node] = []

func _ready() -> void:
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

func _on_body_entered(body: Node) -> void:
	if body.is_in_group("interactable"):
		_candidates.append(body)
		interactable_entered.emit(body)

func _on_body_exited(body: Node) -> void:
	if _candidates.has(body):
		_candidates.erase(body)
		interactable_left.emit(body)

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(interact_action) and not _candidates.is_empty():
		interact_pressed.emit(_candidates[0])
`;

const INVENTORY_RESOURCE = `class_name InventoryItem
extends Resource

@export var id: StringName = &""
@export var display_name: String = ""
@export var icon: Texture2D
@export var stack_size: int = 1
@export var stats: Dictionary = {}
`;

const INVENTORY_SYSTEM = `extends Node

signal inventory_changed
signal item_added(item: InventoryItem, count: int)
signal item_removed(item: InventoryItem, count: int)

@export var max_slots: int = 24

var slots: Array = []

func add_item(item: InventoryItem, count: int = 1) -> bool:
	for slot in slots:
		if slot.item.id == item.id and slot.count < item.stack_size:
			var space := item.stack_size - slot.count
			var add_count: int = min(count, space)
			slot.count += add_count
			count -= add_count
			item_added.emit(item, add_count)
			if count <= 0:
				inventory_changed.emit()
				return true
	while count > 0 and slots.size() < max_slots:
		var add_count: int = min(count, item.stack_size)
		slots.append({"item": item, "count": add_count})
		item_added.emit(item, add_count)
		count -= add_count
	inventory_changed.emit()
	return count == 0

func remove_item(item_id: StringName, count: int = 1) -> bool:
	for i in range(slots.size() - 1, -1, -1):
		if slots[i].item.id == item_id:
			var take: int = min(count, slots[i].count)
			slots[i].count -= take
			count -= take
			item_removed.emit(slots[i].item, take)
			if slots[i].count <= 0:
				slots.remove_at(i)
			if count <= 0:
				inventory_changed.emit()
				return true
	inventory_changed.emit()
	return count == 0

func has_item(item_id: StringName, count: int = 1) -> bool:
	var total: int = 0
	for slot in slots:
		if slot.item.id == item_id:
			total += slot.count
	return total >= count
`;

const SAVE_SYSTEM = `extends Node

const SAVE_PATH := "user://savegame.json"

signal saved
signal loaded(data: Dictionary)

var _state: Dictionary = {}

func set_value(key: String, value: Variant) -> void:
	_state[key] = value

func get_value(key: String, default_value: Variant = null) -> Variant:
	return _state.get(key, default_value)

func save_game() -> bool:
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		push_error("Save: cannot open file.")
		return false
	file.store_string(JSON.stringify(_state, "\\t"))
	file.close()
	saved.emit()
	return true

func load_game() -> bool:
	if not FileAccess.file_exists(SAVE_PATH):
		return false
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		return false
	var raw := file.get_as_text()
	file.close()
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		return false
	_state = parsed
	loaded.emit(_state)
	return true
`;

const HUD_SCRIPT = `extends CanvasLayer

@export var player_health_path: NodePath

@onready var hp_label: Label = $Root/HBox/HPLabel
@onready var hp_bar: ProgressBar = $Root/HBox/HPBar

func _ready() -> void:
	if player_health_path.is_empty():
		return
	var health := get_node_or_null(player_health_path)
	if health and health.has_signal("health_changed"):
		health.health_changed.connect(_on_health_changed)
		if "current_health" in health and "max_health" in health:
			_on_health_changed(health.current_health, health.max_health)

func _on_health_changed(current: int, max_value: int) -> void:
	if hp_bar:
		hp_bar.max_value = max_value
		hp_bar.value = current
	if hp_label:
		hp_label.text = "HP: %d / %d" % [current, max_value]
`;

const PAUSE_MENU = `extends CanvasLayer

@export var pause_action: String = "ui_cancel"

@onready var resume_button: Button = $Root/VBox/Resume
@onready var quit_button: Button = $Root/VBox/Quit

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	visible = false
	if resume_button:
		resume_button.pressed.connect(_on_resume)
	if quit_button:
		quit_button.pressed.connect(_on_quit)

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(pause_action):
		toggle_pause()

func toggle_pause() -> void:
	visible = not visible
	get_tree().paused = visible

func _on_resume() -> void:
	toggle_pause()

func _on_quit() -> void:
	get_tree().paused = false
	get_tree().quit()
`;

// ── Tool registration ────────────────────────────────────────────────────────

export function registerGameSystemTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_create_player_controller_2d ───────────────────────────────────
  server.tool(
    "devpilot_create_player_controller_2d",
    "Create a complete 2D player: CharacterBody2D + Sprite2D + CollisionShape2D + Camera2D + script. Style: platformer | topdown | sidescroller. Requires open scene.",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("Player"),
      style: z.enum(["platformer", "topdown", "sidescroller"]).optional().default("topdown"),
      script_path: z.string().optional(),
      include_camera: z.boolean().optional().default(true),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_player_controller_2d", config), async () => {
          const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
          const playerPath = childPath(params.parent_path, params.name);
          const template = params.style === "platformer" ? PLAYER_PLATFORMER : params.style === "sidescroller" ? PLAYER_SIDESCROLLER : PLAYER_TOPDOWN;

          if (params.dry_run) {
            return dryRun("devpilot_create_player_controller_2d",
              [`add CharacterBody2D '${params.name}'`, "add Sprite2D + CollisionShape2D", params.include_camera ? "add Camera2D" : "skip Camera2D", `write script ${scriptPath} (${params.style})`, `attach script to ${playerPath}`],
              [scriptPath], [playerPath]);
          }

          const write = await writeScriptFile(config.projectRoot, scriptPath, template, params.overwrite_script);
          if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason ?? "", { path: scriptPath }, ["Pass overwrite_script=true"]) as ToolResponse;

          const ops: ToolResponse[] = [];
          ops.push(await addChildNode(godot, params.parent_path, "CharacterBody2D", params.name));
          ops.push(await addChildNode(godot, playerPath, "Sprite2D", "Sprite2D"));
          ops.push(await addChildNode(godot, playerPath, "CollisionShape2D", "CollisionShape2D"));
          if (params.include_camera) ops.push(await addChildNode(godot, playerPath, "Camera2D", "Camera2D"));
          ops.push(await attachScript(godot, playerPath, scriptPath));
          const failed = ops.find((o) => !o.ok);
          if (failed) return failed;

          return createSuccessResponse({ player_path: playerPath, script_path: scriptPath, style: params.style, nodes_created: params.include_camera ? 4 : 3 }, "Player controller created.");
        })
      )
  );

  // ── devpilot_create_health_system ──────────────────────────────────────────
  server.tool(
    "devpilot_create_health_system",
    "Create a Health system Node with health_changed/damaged/died signals + invincibility frames. Optionally attaches as child of an existing node.",
    {
      attach_to: z.string().optional().default("."),
      name: z.string().optional().default("Health"),
      max_health: z.number().int().positive().optional().default(100),
      invincibility_time: z.number().min(0).optional().default(0.4),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_health_system", config), async () => {
          const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
          const nodePath = childPath(params.attach_to, params.name);

          if (params.dry_run) {
            return dryRun("devpilot_create_health_system",
              [`add Node '${params.name}' under ${params.attach_to}`, `write ${scriptPath}`, "set max_health, invincibility_time"],
              [scriptPath], [nodePath]);
          }

          const write = await writeScriptFile(config.projectRoot, scriptPath, HEALTH_SYSTEM, params.overwrite_script);
          if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason ?? "", { path: scriptPath }, []) as ToolResponse;

          const ops: ToolResponse[] = [];
          ops.push(await addChildNode(godot, params.attach_to, "Node", params.name));
          ops.push(await attachScript(godot, nodePath, scriptPath));
          ops.push(await setProp(godot, nodePath, "max_health", params.max_health));
          ops.push(await setProp(godot, nodePath, "invincibility_time", params.invincibility_time));
          const failed = ops.find((o) => !o.ok);
          if (failed) return failed;

          return createSuccessResponse({ node_path: nodePath, script_path: scriptPath, max_health: params.max_health }, "Health system created.");
        })
      )
  );

  // ── devpilot_create_damage_system ──────────────────────────────────────────
  server.tool(
    "devpilot_create_damage_system",
    "Create DamageDealer (Area2D) and/or DamageReceiver (Node) scripts. Dealer triggers on body/area enter; receiver forwards to a health node via NodePath.",
    {
      kind: z.enum(["dealer", "receiver", "both"]).optional().default("both"),
      attach_to: z.string().optional().default("."),
      dealer_name: z.string().optional().default("DamageDealer"),
      receiver_name: z.string().optional().default("DamageReceiver"),
      damage_amount: z.number().int().positive().optional().default(10),
      script_dir: z.string().optional().default("res://scripts"),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_damage_system", config), async () => {
          const dealerScript = `${params.script_dir}/DamageDealer.gd`;
          const receiverScript = `${params.script_dir}/DamageReceiver.gd`;
          const created: string[] = [];

          if (params.dry_run) {
            return dryRun("devpilot_create_damage_system",
              [`kind=${params.kind}`, params.kind !== "receiver" ? `write ${dealerScript}` : "", params.kind !== "dealer" ? `write ${receiverScript}` : ""].filter(Boolean) as string[],
              [dealerScript, receiverScript]);
          }

          if (params.kind === "dealer" || params.kind === "both") {
            const w = await writeScriptFile(config.projectRoot, dealerScript, DAMAGE_DEALER, params.overwrite_script);
            if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", w.reason ?? "", { path: dealerScript }, []) as ToolResponse;
            const dealerPath = childPath(params.attach_to, params.dealer_name);
            const ops = [
              await addChildNode(godot, params.attach_to, "Area2D", params.dealer_name),
              await addChildNode(godot, dealerPath, "CollisionShape2D", "CollisionShape2D"),
              await attachScript(godot, dealerPath, dealerScript),
              await setProp(godot, dealerPath, "damage_amount", params.damage_amount),
            ];
            const fail = ops.find((o) => !o.ok);
            if (fail) return fail;
            created.push(dealerPath);
          }
          if (params.kind === "receiver" || params.kind === "both") {
            const w = await writeScriptFile(config.projectRoot, receiverScript, DAMAGE_RECEIVER, params.overwrite_script);
            if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", w.reason ?? "", { path: receiverScript }, []) as ToolResponse;
            const recvPath = childPath(params.attach_to, params.receiver_name);
            const ops = [
              await addChildNode(godot, params.attach_to, "Node", params.receiver_name),
              await attachScript(godot, recvPath, receiverScript),
            ];
            const fail = ops.find((o) => !o.ok);
            if (fail) return fail;
            created.push(recvPath);
          }
          return createSuccessResponse({ created, kind: params.kind, damage_amount: params.damage_amount }, "Damage system created.");
        })
      )
  );

  // ── devpilot_create_interaction_system ─────────────────────────────────────
  server.tool(
    "devpilot_create_interaction_system",
    "Create an Area2D interaction trigger that detects bodies in 'interactable' group and emits interact_pressed on input action.",
    {
      attach_to: z.string().optional().default("."),
      name: z.string().optional().default("InteractionArea"),
      interact_action: z.string().optional().default("interact"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_interaction_system", config), async () => {
          const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
          const nodePath = childPath(params.attach_to, params.name);

          if (params.dry_run) {
            return dryRun("devpilot_create_interaction_system",
              ["add Area2D + CollisionShape2D", `write ${scriptPath}`, `set interact_action='${params.interact_action}'`],
              [scriptPath], [nodePath]);
          }

          const w = await writeScriptFile(config.projectRoot, scriptPath, INTERACTION_SYSTEM, params.overwrite_script);
          if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", w.reason ?? "", { path: scriptPath }, []) as ToolResponse;

          const ops = [
            await addChildNode(godot, params.attach_to, "Area2D", params.name),
            await addChildNode(godot, nodePath, "CollisionShape2D", "CollisionShape2D"),
            await attachScript(godot, nodePath, scriptPath),
            await setProp(godot, nodePath, "interact_action", params.interact_action),
          ];
          const fail = ops.find((o) => !o.ok);
          if (fail) return fail;
          return createSuccessResponse({ node_path: nodePath, script_path: scriptPath, interact_action: params.interact_action }, "Interaction system created.");
        })
      )
  );

  // ── devpilot_create_inventory_system ───────────────────────────────────────
  server.tool(
    "devpilot_create_inventory_system",
    "Create an inventory: InventoryItem Resource subclass (.gd with class_name) + Inventory Node script with add_item/remove_item/has_item.",
    {
      attach_to: z.string().optional().default("."),
      name: z.string().optional().default("Inventory"),
      max_slots: z.number().int().positive().optional().default(24),
      item_script_path: z.string().optional().default("res://scripts/InventoryItem.gd"),
      inventory_script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_inventory_system", config), async () => {
          const inventoryScript = params.inventory_script_path ?? `res://scripts/${params.name}.gd`;
          const nodePath = childPath(params.attach_to, params.name);

          if (params.dry_run) {
            return dryRun("devpilot_create_inventory_system",
              [`write ${params.item_script_path}`, `write ${inventoryScript}`, `add Node '${params.name}'`, "attach + set max_slots"],
              [params.item_script_path, inventoryScript], [nodePath]);
          }

          const itemWrite = await writeScriptFile(config.projectRoot, params.item_script_path, INVENTORY_RESOURCE, params.overwrite_script);
          if (!itemWrite.written) return createErrorResponse("FILE_ALREADY_EXISTS", itemWrite.reason ?? "", { path: params.item_script_path }, []) as ToolResponse;
          const invWrite = await writeScriptFile(config.projectRoot, inventoryScript, INVENTORY_SYSTEM, params.overwrite_script);
          if (!invWrite.written) return createErrorResponse("FILE_ALREADY_EXISTS", invWrite.reason ?? "", { path: inventoryScript }, []) as ToolResponse;

          const ops = [
            await addChildNode(godot, params.attach_to, "Node", params.name),
            await attachScript(godot, nodePath, inventoryScript),
            await setProp(godot, nodePath, "max_slots", params.max_slots),
          ];
          const fail = ops.find((o) => !o.ok);
          if (fail) return fail;
          return createSuccessResponse({ node_path: nodePath, item_script: params.item_script_path, inventory_script: inventoryScript, max_slots: params.max_slots }, "Inventory system created.");
        })
      )
  );

  // ── devpilot_create_save_system ────────────────────────────────────────────
  server.tool(
    "devpilot_create_save_system",
    "Create a SaveSystem singleton (autoload) with save_game/load_game using JSON in user://savegame.json. Auto-registers as autoload.",
    {
      autoload_name: z.string().optional().default("SaveSystem"),
      script_path: z.string().optional().default("res://autoload/SaveSystem.gd"),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_save_system", config), async () => {
          if (params.dry_run) {
            return dryRun("devpilot_create_save_system",
              [`write ${params.script_path}`, `register autoload '${params.autoload_name}'`],
              [params.script_path]);
          }
          const w = await writeScriptFile(config.projectRoot, params.script_path, SAVE_SYSTEM, params.overwrite_script);
          if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", w.reason ?? "", { path: params.script_path }, []) as ToolResponse;
          const addAuto = await callRpc(godot, "project.add_autoload", { name: params.autoload_name, path: `*${params.script_path}` });
          if (!addAuto.ok && addAuto.error.code !== "AUTOLOAD_ALREADY_EXISTS") return addAuto;
          return createSuccessResponse({ autoload_name: params.autoload_name, script_path: params.script_path, autoload_added: addAuto.ok }, "Save system created and autoloaded.");
        })
      )
  );

  // ── devpilot_create_hud ────────────────────────────────────────────────────
  server.tool(
    "devpilot_create_hud",
    "Create a HUD CanvasLayer with HP label + ProgressBar wired to a player health node via NodePath.",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("HUD"),
      player_health_path: z.string().optional().default("../Player/Health").describe("NodePath from HUD to the Health node"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_hud", config), async () => {
          const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
          const hudPath = childPath(params.parent_path, params.name);
          const rootPath = `${hudPath}/Root`;
          const hboxPath = `${rootPath}/HBox`;

          if (params.dry_run) {
            return dryRun("devpilot_create_hud",
              ["add CanvasLayer/Control/HBoxContainer/Label+ProgressBar", `write ${scriptPath}`, `set player_health_path='${params.player_health_path}'`],
              [scriptPath], [hudPath]);
          }

          const w = await writeScriptFile(config.projectRoot, scriptPath, HUD_SCRIPT, params.overwrite_script);
          if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", w.reason ?? "", { path: scriptPath }, []) as ToolResponse;

          const ops = [
            await addChildNode(godot, params.parent_path, "CanvasLayer", params.name),
            await addChildNode(godot, hudPath, "Control", "Root"),
            await setProp(godot, rootPath, "anchors_preset", 15),
            await addChildNode(godot, rootPath, "HBoxContainer", "HBox"),
            await addChildNode(godot, hboxPath, "Label", "HPLabel"),
            await addChildNode(godot, hboxPath, "ProgressBar", "HPBar"),
            await attachScript(godot, hudPath, scriptPath),
            await setProp(godot, hudPath, "player_health_path", params.player_health_path),
          ];
          const fail = ops.find((o) => !o.ok);
          if (fail) return fail;
          return createSuccessResponse({ hud_path: hudPath, script_path: scriptPath, player_health_path: params.player_health_path }, "HUD created.");
        })
      )
  );

  // ── devpilot_create_pause_menu ─────────────────────────────────────────────
  server.tool(
    "devpilot_create_pause_menu",
    "Create a PauseMenu CanvasLayer with dim background + Resume/Quit buttons. Toggles visibility on pause_action (default ui_cancel) and pauses the tree.",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("PauseMenu"),
      pause_action: z.string().optional().default("ui_cancel"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_pause_menu", config), async () => {
          const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
          const menuPath = childPath(params.parent_path, params.name);
          const rootPath = `${menuPath}/Root`;
          const dimPath = `${rootPath}/Dim`;
          const vboxPath = `${rootPath}/VBox`;

          if (params.dry_run) {
            return dryRun("devpilot_create_pause_menu",
              ["add CanvasLayer/Control/ColorRect+VBox/Resume+Quit", `write ${scriptPath}`, `set pause_action='${params.pause_action}'`],
              [scriptPath], [menuPath]);
          }

          const w = await writeScriptFile(config.projectRoot, scriptPath, PAUSE_MENU, params.overwrite_script);
          if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", w.reason ?? "", { path: scriptPath }, []) as ToolResponse;

          const ops = [
            await addChildNode(godot, params.parent_path, "CanvasLayer", params.name),
            await addChildNode(godot, menuPath, "Control", "Root"),
            await setProp(godot, rootPath, "anchors_preset", 15),
            await addChildNode(godot, rootPath, "ColorRect", "Dim"),
            await setProp(godot, dimPath, "anchors_preset", 15),
            await setProp(godot, dimPath, "color", { r: 0, g: 0, b: 0, a: 0.5 }),
            await addChildNode(godot, rootPath, "VBoxContainer", "VBox"),
            await setProp(godot, vboxPath, "anchors_preset", 8),
            await addChildNode(godot, vboxPath, "Button", "Resume"),
            await setProp(godot, `${vboxPath}/Resume`, "text", "Resume"),
            await addChildNode(godot, vboxPath, "Button", "Quit"),
            await setProp(godot, `${vboxPath}/Quit`, "text", "Quit"),
            await attachScript(godot, menuPath, scriptPath),
            await setProp(godot, menuPath, "pause_action", params.pause_action),
          ];
          const fail = ops.find((o) => !o.ok);
          if (fail) return fail;
          return createSuccessResponse({ menu_path: menuPath, script_path: scriptPath, pause_action: params.pause_action }, "Pause menu created.");
        })
      )
  );
}
