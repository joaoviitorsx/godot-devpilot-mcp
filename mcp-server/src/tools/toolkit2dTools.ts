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

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(absPath: string): Promise<boolean> {
  try { await access(absPath); return true; } catch { return false; }
}

async function writeScriptFile(projectRoot: string, resPath: string, content: string, allowOverwrite: boolean): Promise<{ written: boolean; reason?: string }> {
  const resolved = resolveProjectPath(resPath, projectRoot);
  if (!resolved.resPath.endsWith(".gd")) {
    throw createSafetyError("INVALID_PARAMS", "script path must end in .gd.", { path: resPath }, []);
  }
  const exists = await fileExists(resolved.absolutePath);
  if (exists && !allowOverwrite) {
    return { written: false, reason: "Script already exists. Pass overwrite=true to replace." };
  }
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, content, "utf8");
  return { written: true };
}

// ── Script templates ──────────────────────────────────────────────────────────

const TOPDOWN_CONTROLLER = `extends CharacterBody2D

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

const PLATFORMER_CONTROLLER = `extends CharacterBody2D

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

const ENEMY_PATROL = `extends CharacterBody2D

@export var speed: float = 80.0
@export var patrol_distance: float = 200.0

var _start_x: float
var _direction: int = 1

func _ready() -> void:
	_start_x = global_position.x

func _physics_process(_delta: float) -> void:
	velocity.x = speed * _direction
	move_and_slide()
	if abs(global_position.x - _start_x) > patrol_distance:
		_direction *= -1
`;

const HEALTH_SYSTEM = `extends Node

signal health_changed(new_value: int, max_value: int)
signal died

@export var max_health: int = 100
var current_health: int

func _ready() -> void:
	current_health = max_health
	health_changed.emit(current_health, max_health)

func damage(amount: int) -> void:
	current_health = max(0, current_health - amount)
	health_changed.emit(current_health, max_health)
	if current_health == 0:
		died.emit()

func heal(amount: int) -> void:
	current_health = min(max_health, current_health + amount)
	health_changed.emit(current_health, max_health)
`;

const COLLECTIBLE = `extends Area2D

signal collected(by: Node)

@export var value: int = 1

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node) -> void:
	collected.emit(body)
	queue_free()
`;

// ── Helpers for plugin orchestration ──────────────────────────────────────────

async function addChildNode(godot: GodotClient, parent: string, type: string, name: string): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.add", { parent_path: parent, node_type: type, node_name: name });
}

async function setProperty(godot: GodotClient, nodePath: string, property: string, value: unknown): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.set_property", { node_path: nodePath, property, value });
}

async function attachScript(godot: GodotClient, nodePath: string, scriptPath: string): Promise<ToolResponse> {
  return callAfterConnect(godot, "script.attach", { node_path: nodePath, script_path: scriptPath });
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerToolkit2dTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_create_player_2d ─────────────────────────────────────────────────
  server.tool(
    "godot_create_player_2d",
    "Create a 2D Player node tree (CharacterBody2D + Sprite2D + CollisionShape2D) with a movement script. Requires an open scene.",
    {
      parent_path: z.string().optional().describe("Parent node path. Defaults to '.'."),
      name: z.string().optional().describe("Node name. Defaults to 'Player'."),
      script_path: z.string().optional().describe("res:// script path. Defaults to res://scripts/Player.gd."),
      controller: z.enum(["topdown", "platformer"]).optional().describe("Controller template. Defaults to topdown."),
      overwrite_script: z.boolean().optional().describe("Allow overwriting existing script."),
      dry_run: z.boolean().optional().describe("Preview the plan without applying.")
    },
    async ({ parent_path, name, script_path, controller, overwrite_script, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_player_2d", config), async (): Promise<ToolResponse> => {
        const playerName = name ?? "Player";
        const parent = parent_path ?? ".";
        const scriptResPath = script_path ?? "res://scripts/Player.gd";
        const controllerKind = controller ?? "topdown";
        const template = controllerKind === "platformer" ? PLATFORMER_CONTROLLER : TOPDOWN_CONTROLLER;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_player_2d",
            plannedChanges: [
              `Write ${scriptResPath} (${controllerKind} controller)`,
              `Add CharacterBody2D '${playerName}' under ${parent}`,
              `Add Sprite2D under ${playerName}`,
              `Add CollisionShape2D under ${playerName}`,
              `Attach ${scriptResPath} to ${playerName}`
            ],
            affectedFiles: [scriptResPath],
            affectedNodes: [`${parent}/${playerName}`]
          });
        }

        const write = await writeScriptFile(config.projectRoot, scriptResPath, template, overwrite_script ?? false);
        if (!write.written) {
          return createErrorResponse("FILE_ALREADY_EXISTS", write.reason ?? "Script already exists.", { path: scriptResPath }, ["Pass overwrite_script=true to replace."]);
        }

        const operations: ToolResponse[] = [];
        operations.push(await addChildNode(godot, parent, "CharacterBody2D", playerName));
        const playerPath = parent === "." ? playerName : `${parent}/${playerName}`;
        operations.push(await addChildNode(godot, playerPath, "Sprite2D", "Sprite2D"));
        operations.push(await addChildNode(godot, playerPath, "CollisionShape2D", "CollisionShape2D"));
        operations.push(await attachScript(godot, playerPath, scriptResPath));

        const failed = operations.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          {
            player_path: playerPath,
            script_path: scriptResPath,
            controller: controllerKind,
            children_added: ["Sprite2D", "CollisionShape2D"]
          },
          "Player 2D created.",
          [],
          ["Set Sprite2D.texture and CollisionShape2D.shape for a working player."]
        );
      })
    )
  );

  // ── godot_create_enemy_2d ──────────────────────────────────────────────────
  server.tool(
    "godot_create_enemy_2d",
    "Create a 2D Enemy node tree (CharacterBody2D + Sprite2D + CollisionShape2D) with a patrol script.",
    {
      parent_path: z.string().optional(),
      name: z.string().optional().describe("Defaults to 'Enemy'."),
      script_path: z.string().optional().describe("Defaults to res://scripts/Enemy.gd."),
      overwrite_script: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, script_path, overwrite_script, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_enemy_2d", config), async (): Promise<ToolResponse> => {
        const enemyName = name ?? "Enemy";
        const parent = parent_path ?? ".";
        const scriptResPath = script_path ?? "res://scripts/Enemy.gd";

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_enemy_2d",
            plannedChanges: [
              `Write ${scriptResPath} (patrol controller)`,
              `Add CharacterBody2D '${enemyName}' under ${parent}`,
              `Add Sprite2D + CollisionShape2D children`,
              `Attach ${scriptResPath} to ${enemyName}`
            ],
            affectedFiles: [scriptResPath],
            affectedNodes: [`${parent}/${enemyName}`]
          });
        }

        const write = await writeScriptFile(config.projectRoot, scriptResPath, ENEMY_PATROL, overwrite_script ?? false);
        if (!write.written) {
          return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: scriptResPath }, []);
        }

        const enemyPath = parent === "." ? enemyName : `${parent}/${enemyName}`;
        const ops = [
          await addChildNode(godot, parent, "CharacterBody2D", enemyName),
          await addChildNode(godot, enemyPath, "Sprite2D", "Sprite2D"),
          await addChildNode(godot, enemyPath, "CollisionShape2D", "CollisionShape2D"),
          await attachScript(godot, enemyPath, scriptResPath)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { enemy_path: enemyPath, script_path: scriptResPath },
          "Enemy 2D created."
        );
      })
    )
  );

  // ── godot_create_collectible_2d ────────────────────────────────────────────
  server.tool(
    "godot_create_collectible_2d",
    "Create a 2D Collectible node tree (Area2D + Sprite2D + CollisionShape2D) with a collect script.",
    {
      parent_path: z.string().optional(),
      name: z.string().optional().describe("Defaults to 'Collectible'."),
      script_path: z.string().optional().describe("Defaults to res://scripts/Collectible.gd."),
      overwrite_script: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, script_path, overwrite_script, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_collectible_2d", config), async (): Promise<ToolResponse> => {
        const itemName = name ?? "Collectible";
        const parent = parent_path ?? ".";
        const scriptResPath = script_path ?? "res://scripts/Collectible.gd";

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_collectible_2d",
            plannedChanges: [
              `Write ${scriptResPath}`,
              `Add Area2D '${itemName}' under ${parent}`,
              `Add Sprite2D + CollisionShape2D`,
              `Attach ${scriptResPath}`
            ],
            affectedFiles: [scriptResPath],
            affectedNodes: [`${parent}/${itemName}`]
          });
        }

        const write = await writeScriptFile(config.projectRoot, scriptResPath, COLLECTIBLE, overwrite_script ?? false);
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: scriptResPath }, []);

        const itemPath = parent === "." ? itemName : `${parent}/${itemName}`;
        const ops = [
          await addChildNode(godot, parent, "Area2D", itemName),
          await addChildNode(godot, itemPath, "Sprite2D", "Sprite2D"),
          await addChildNode(godot, itemPath, "CollisionShape2D", "CollisionShape2D"),
          await attachScript(godot, itemPath, scriptResPath)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { collectible_path: itemPath, script_path: scriptResPath },
          "Collectible 2D created."
        );
      })
    )
  );

  // ── godot_setup_camera_2d ──────────────────────────────────────────────────
  server.tool(
    "godot_setup_camera_2d",
    "Add a Camera2D to a parent node (typically the player) and mark it as enabled.",
    {
      parent_path: z.string().describe("Parent node path (e.g. 'Player')."),
      name: z.string().optional().describe("Defaults to 'Camera2D'."),
      zoom: z.number().positive().optional().describe("Uniform zoom value. Defaults to 1.0."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, zoom, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_camera_2d", config), async (): Promise<ToolResponse> => {
        const cameraName = name ?? "Camera2D";
        const z2d = zoom ?? 1.0;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_setup_camera_2d",
            plannedChanges: [
              `Add Camera2D '${cameraName}' under ${parent_path}`,
              `Set enabled=true and zoom=(${z2d}, ${z2d})`
            ],
            affectedNodes: [`${parent_path}/${cameraName}`]
          });
        }

        const camPath = `${parent_path}/${cameraName}`;
        const ops = [
          await addChildNode(godot, parent_path, "Camera2D", cameraName),
          await setProperty(godot, camPath, "enabled", true),
          await setProperty(godot, camPath, "zoom", { x: z2d, y: z2d })
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { camera_path: camPath, zoom: z2d },
          "Camera2D configured."
        );
      })
    )
  );

  // ── godot_create_health_system ─────────────────────────────────────────────
  server.tool(
    "godot_create_health_system",
    "Create a HealthSystem GDScript with health_changed and died signals. Optionally attach to a node.",
    {
      script_path: z.string().optional().describe("Defaults to res://scripts/HealthSystem.gd."),
      attach_to: z.string().optional().describe("Optional node path to attach the script to (creates a Node child if missing)."),
      max_health: z.number().int().positive().optional().describe("Initial max_health. Defaults to 100."),
      overwrite_script: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ script_path, attach_to, max_health, overwrite_script, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_health_system", config), async (): Promise<ToolResponse> => {
        const scriptResPath = script_path ?? "res://scripts/HealthSystem.gd";
        const hp = max_health ?? 100;
        const template = HEALTH_SYSTEM.replace("max_health: int = 100", `max_health: int = ${hp}`);

        const planned = [`Write ${scriptResPath} (max_health=${hp})`];
        if (attach_to) planned.push(`Attach ${scriptResPath} to ${attach_to}`);

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_health_system",
            plannedChanges: planned,
            affectedFiles: [scriptResPath],
            affectedNodes: attach_to ? [attach_to] : []
          });
        }

        const write = await writeScriptFile(config.projectRoot, scriptResPath, template, overwrite_script ?? false);
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: scriptResPath }, []);

        if (attach_to) {
          const attach = await attachScript(godot, attach_to, scriptResPath);
          if (!attach.ok) return attach;
        }

        return createSuccessResponse(
          { script_path: scriptResPath, max_health: hp, attached_to: attach_to ?? null },
          "Health system created."
        );
      })
    )
  );

  // ── godot_create_topdown_controller (script only) ──────────────────────────
  server.tool(
    "godot_create_topdown_controller",
    "Generate a top-down movement GDScript template. Does not create any nodes.",
    {
      script_path: z.string().describe("res:// destination .gd path."),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ script_path, overwrite, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_topdown_controller", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_topdown_controller",
            plannedChanges: [`Write ${script_path} (top-down controller template)`],
            affectedFiles: [script_path]
          });
        }
        const write = await writeScriptFile(config.projectRoot, script_path, TOPDOWN_CONTROLLER, overwrite ?? false);
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: script_path }, []);
        return createSuccessResponse({ script_path }, "Top-down controller written.");
      })
    )
  );

  // ── godot_create_platformer_controller (script only) ───────────────────────
  server.tool(
    "godot_create_platformer_controller",
    "Generate a platformer movement GDScript template. Does not create any nodes.",
    {
      script_path: z.string().describe("res:// destination .gd path."),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ script_path, overwrite, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_platformer_controller", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_platformer_controller",
            plannedChanges: [`Write ${script_path} (platformer controller template, requires 'jump'/'move_left'/'move_right' actions)`],
            affectedFiles: [script_path]
          });
        }
        const write = await writeScriptFile(config.projectRoot, script_path, PLATFORMER_CONTROLLER, overwrite ?? false);
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: script_path }, []);
        return createSuccessResponse({ script_path }, "Platformer controller written.", [], ["Define Input Map actions: 'jump', 'move_left', 'move_right'."]);
      })
    )
  );

  // ── godot_setup_collision_2d ───────────────────────────────────────────────
  server.tool(
    "godot_setup_collision_2d",
    "Add a CollisionShape2D node under a parent. Shape resource must be assigned in editor (limitation: JSON-RPC cannot create Resource instances directly).",
    {
      parent_path: z.string().describe("Parent node path (e.g. 'Player')."),
      name: z.string().optional().describe("Defaults to 'CollisionShape2D'."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_collision_2d", config), async (): Promise<ToolResponse> => {
        const colName = name ?? "CollisionShape2D";
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_setup_collision_2d",
            plannedChanges: [`Add CollisionShape2D '${colName}' under ${parent_path}`],
            affectedNodes: [`${parent_path}/${colName}`]
          });
        }
        const r = await addChildNode(godot, parent_path, "CollisionShape2D", colName);
        if (!r.ok) return r;
        return createSuccessResponse(
          { collision_path: `${parent_path}/${colName}` },
          "CollisionShape2D added.",
          [],
          ["Assign a Shape2D resource (RectangleShape2D, CircleShape2D, etc.) to the 'shape' property in the editor."]
        );
      })
    )
  );

  // ── godot_setup_area_trigger_2d ────────────────────────────────────────────
  server.tool(
    "godot_setup_area_trigger_2d",
    "Create an Area2D trigger (Area2D + CollisionShape2D + script with body_entered/exited handlers).",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'AreaTrigger'."),
      script_path: z.string().optional().describe("Defaults to res://scripts/AreaTrigger.gd."),
      overwrite_script: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, script_path, overwrite_script, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_area_trigger_2d", config), async (): Promise<ToolResponse> => {
        const triggerName = name ?? "AreaTrigger";
        const parent = parent_path ?? ".";
        const scriptResPath = script_path ?? "res://scripts/AreaTrigger.gd";

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_setup_area_trigger_2d",
            plannedChanges: [
              `Write ${scriptResPath} (Area2D trigger handler)`,
              `Add Area2D '${triggerName}' under ${parent}`,
              `Add CollisionShape2D child`,
              `Attach ${scriptResPath}`
            ],
            affectedFiles: [scriptResPath],
            affectedNodes: [`${parent}/${triggerName}`]
          });
        }

        const write = await writeScriptFile(config.projectRoot, scriptResPath, AREA_TRIGGER, overwrite_script ?? false);
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: scriptResPath }, []);

        const triggerPath = parent === "." ? triggerName : `${parent}/${triggerName}`;
        const ops = [
          await addChildNode(godot, parent, "Area2D", triggerName),
          await addChildNode(godot, triggerPath, "CollisionShape2D", "CollisionShape2D"),
          await attachScript(godot, triggerPath, scriptResPath)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { trigger_path: triggerPath, script_path: scriptResPath },
          "Area2D trigger created.",
          [],
          ["Assign a Shape2D to the CollisionShape2D and connect to area signals via signals dock."]
        );
      })
    )
  );

  // ── godot_create_tilemap ───────────────────────────────────────────────────
  server.tool(
    "godot_create_tilemap",
    "Add a TileMap node under a parent. TileSet resource must be assigned in editor.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'TileMap'."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_tilemap", config), async (): Promise<ToolResponse> => {
        const tmName = name ?? "TileMap";
        const parent = parent_path ?? ".";
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_tilemap",
            plannedChanges: [`Add TileMap '${tmName}' under ${parent}`],
            affectedNodes: [`${parent}/${tmName}`]
          });
        }
        const r = await addChildNode(godot, parent, "TileMap", tmName);
        if (!r.ok) return r;
        return createSuccessResponse(
          { tilemap_path: parent === "." ? tmName : `${parent}/${tmName}` },
          "TileMap added.",
          [],
          ["Assign a TileSet resource via the editor inspector. Note: in Godot 4.4+ prefer TileMapLayer nodes."]
        );
      })
    )
  );

  // ── godot_setup_parallax_background ────────────────────────────────────────
  server.tool(
    "godot_setup_parallax_background",
    "Create a ParallaxBackground with N ParallaxLayer children.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'ParallaxBackground'."),
      layer_count: z.number().int().min(1).max(10).optional().describe("Number of ParallaxLayer children. Defaults to 3."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, layer_count, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_parallax_background", config), async (): Promise<ToolResponse> => {
        const bgName = name ?? "ParallaxBackground";
        const parent = parent_path ?? ".";
        const count = layer_count ?? 3;

        if (dry_run) {
          const planned = [`Add ParallaxBackground '${bgName}' under ${parent}`];
          for (let i = 0; i < count; i++) planned.push(`Add ParallaxLayer 'Layer${i + 1}'`);
          return createDryRunResponse({
            toolName: "godot_setup_parallax_background",
            plannedChanges: planned,
            affectedNodes: [`${parent}/${bgName}`]
          });
        }

        const bgPath = parent === "." ? bgName : `${parent}/${bgName}`;
        const ops: ToolResponse[] = [await addChildNode(godot, parent, "ParallaxBackground", bgName)];
        for (let i = 0; i < count; i++) {
          ops.push(await addChildNode(godot, bgPath, "ParallaxLayer", `Layer${i + 1}`));
        }
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { parallax_path: bgPath, layer_count: count },
          "ParallaxBackground configured.",
          [],
          ["Add Sprite2D children to each ParallaxLayer and set motion_scale per layer for depth effect."]
        );
      })
    )
  );

  // ── godot_create_inventory_ui ──────────────────────────────────────────────
  server.tool(
    "godot_create_inventory_ui",
    "Create a baseline inventory UI (CanvasLayer + Control + GridContainer) with an InventoryUI script.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'InventoryUI'."),
      script_path: z.string().optional().describe("Defaults to res://scripts/InventoryUI.gd."),
      columns: z.number().int().min(1).max(16).optional().describe("Grid columns. Defaults to 4."),
      overwrite_script: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, script_path, columns, overwrite_script, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_inventory_ui", config), async (): Promise<ToolResponse> => {
        const uiName = name ?? "InventoryUI";
        const parent = parent_path ?? ".";
        const scriptResPath = script_path ?? "res://scripts/InventoryUI.gd";
        const cols = columns ?? 4;
        const template = INVENTORY_UI.replace("@export var columns: int = 4", `@export var columns: int = ${cols}`);

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_inventory_ui",
            plannedChanges: [
              `Write ${scriptResPath} (columns=${cols})`,
              `Add CanvasLayer '${uiName}' under ${parent}`,
              `Add Control 'Root' + GridContainer 'Slots'`,
              `Attach ${scriptResPath} to ${uiName}`
            ],
            affectedFiles: [scriptResPath],
            affectedNodes: [`${parent}/${uiName}`]
          });
        }

        const write = await writeScriptFile(config.projectRoot, scriptResPath, template, overwrite_script ?? false);
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: scriptResPath }, []);

        const uiPath = parent === "." ? uiName : `${parent}/${uiName}`;
        const ops = [
          await addChildNode(godot, parent, "CanvasLayer", uiName),
          await addChildNode(godot, uiPath, "Control", "Root"),
          await addChildNode(godot, `${uiPath}/Root`, "GridContainer", "Slots"),
          await setProperty(godot, `${uiPath}/Root/Slots`, "columns", cols),
          await attachScript(godot, uiPath, scriptResPath)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { inventory_path: uiPath, script_path: scriptResPath, columns: cols },
          "Inventory UI created.",
          [],
          ["Add slot scenes as children of GridContainer 'Slots' to populate the inventory."]
        );
      })
    )
  );
}

// ── Additional templates for Phase 11 completion ────────────────────────────

const AREA_TRIGGER = `extends Area2D

signal triggered(by: Node)

func _ready() -> void:
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

func _on_body_entered(body: Node) -> void:
	triggered.emit(body)

func _on_body_exited(_body: Node) -> void:
	pass
`;

const INVENTORY_UI = `extends CanvasLayer

@export var columns: int = 4

var _slots: GridContainer

func _ready() -> void:
	_slots = $Root/Slots if has_node("Root/Slots") else null
	if _slots:
		_slots.columns = columns

func add_item(slot_scene: PackedScene) -> void:
	if _slots == null or slot_scene == null:
		return
	var slot := slot_scene.instantiate()
	_slots.add_child(slot)

func clear_items() -> void:
	if _slots == null:
		return
	for child in _slots.get_children():
		child.queue_free()
`;
