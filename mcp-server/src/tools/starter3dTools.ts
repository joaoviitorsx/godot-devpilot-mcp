import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createErrorResponse, createSuccessResponse } from "../godot/protocol.js";
import { createFileBackup } from "../safety/backup.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { serializeSceneToTscn, SubRef, type NodeSpec, type SceneSpec } from "../utils/sceneSerializer.js";
import { audit3DSceneSource } from "./scene3dAuditTools.js";

type Mode = "fps" | "tps";

function controllerScript(): string {
  return `extends CharacterBody3D

@export var move_speed: float = 6.0
@export var jump_velocity: float = 5.0
@export var mouse_sensitivity: float = 0.0025

@onready var camera_pivot: Node3D = $CameraPivot
var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)

func _ready() -> void:
	_ensure_action("move_left", KEY_A)
	_ensure_action("move_right", KEY_D)
	_ensure_action("move_up", KEY_W)
	_ensure_action("move_down", KEY_S)
	_ensure_action("jump", KEY_SPACE)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _ensure_action(action: StringName, key: Key) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	var event := InputEventKey.new()
	event.physical_keycode = key
	InputMap.action_add_event(action, event)

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-event.relative.x * mouse_sensitivity)
		camera_pivot.rotate_x(-event.relative.y * mouse_sensitivity)
		camera_pivot.rotation.x = clampf(camera_pivot.rotation.x, -1.3, 1.3)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= gravity * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity
	var input_axis := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	var direction := (global_transform.basis * Vector3(input_axis.x, 0.0, input_axis.y)).normalized()
	velocity.x = direction.x * move_speed
	velocity.z = direction.z * move_speed
	move_and_slide()
`;
}

function wall(name: string, position: { x: number; y: number; z: number }, mesh: string, shape: string): NodeSpec {
  return {
    name, type: "StaticBody3D", props: { position, collision_layer: 1 },
    children: [
      { name: "Visual", type: "MeshInstance3D", props: { mesh: SubRef(mesh), material_override: SubRef("WallMaterial") } },
      { name: "Collision", type: "CollisionShape3D", props: { shape: SubRef(shape) } }
    ]
  };
}

export function starter3DSceneSpec(scenePath: string, scriptPath: string, mode: Mode): SceneSpec {
  return {
    path: scenePath,
    ext_resources: [{ id: "PlayerScript", type: "Script", path: scriptPath }],
    sub_resources: [
      { id: "FloorMesh", type: "BoxMesh", props: { size: { x: 20, y: 0.4, z: 20 } } },
      { id: "FloorShape", type: "BoxShape3D", props: { size: { x: 20, y: 0.4, z: 20 } } },
      { id: "FloorMaterial", type: "StandardMaterial3D", props: { albedo_color: { r: 0.25, g: 0.29, b: 0.32, a: 1 } } },
      { id: "WallMeshX", type: "BoxMesh", props: { size: { x: 20, y: 3, z: 0.4 } } },
      { id: "WallShapeX", type: "BoxShape3D", props: { size: { x: 20, y: 3, z: 0.4 } } },
      { id: "WallMeshZ", type: "BoxMesh", props: { size: { x: 0.4, y: 3, z: 20 } } },
      { id: "WallShapeZ", type: "BoxShape3D", props: { size: { x: 0.4, y: 3, z: 20 } } },
      { id: "WallMaterial", type: "StandardMaterial3D", props: { albedo_color: { r: 0.13, g: 0.2, b: 0.3, a: 1 } } },
      { id: "PlayerMesh", type: "CapsuleMesh", props: { radius: 0.4, height: 1.8 } },
      { id: "PlayerShape", type: "CapsuleShape3D", props: { radius: 0.4, height: 1.8 } },
      { id: "PlayerMaterial", type: "StandardMaterial3D", props: { albedo_color: { r: 0.95, g: 0.52, b: 0.2, a: 1 } } },
      { id: "WorldEnvironment", type: "Environment", props: { background_mode: 1, background_color: { r: 0.12, g: 0.17, b: 0.24, a: 1 } } }
    ],
    root: {
      name: "Starter3D", type: "Node3D",
      children: [
        { name: "Environment", type: "WorldEnvironment", props: { environment: SubRef("WorldEnvironment") } },
        { name: "Sun", type: "DirectionalLight3D", props: { rotation_degrees: { x: -50, y: -35, z: 0 }, light_energy: 1.3, shadow_enabled: true } },
        {
          name: "Floor", type: "StaticBody3D", props: { position: { x: 0, y: -0.2, z: 0 }, collision_layer: 1 },
          children: [
            { name: "Visual", type: "MeshInstance3D", props: { mesh: SubRef("FloorMesh"), material_override: SubRef("FloorMaterial") } },
            { name: "Collision", type: "CollisionShape3D", props: { shape: SubRef("FloorShape") } }
          ]
        },
        wall("WallNorth", { x: 0, y: 1.5, z: -10 }, "WallMeshX", "WallShapeX"),
        wall("WallSouth", { x: 0, y: 1.5, z: 10 }, "WallMeshX", "WallShapeX"),
        wall("WallEast", { x: 10, y: 1.5, z: 0 }, "WallMeshZ", "WallShapeZ"),
        wall("WallWest", { x: -10, y: 1.5, z: 0 }, "WallMeshZ", "WallShapeZ"),
        {
          name: "Player", type: "CharacterBody3D", script: "PlayerScript",
          props: { position: { x: 0, y: 1.1, z: 0 }, collision_layer: 2, collision_mask: 1 },
          children: [
            { name: "Visual", type: "MeshInstance3D", props: { mesh: SubRef("PlayerMesh"), material_override: SubRef("PlayerMaterial"), visible: mode === "tps" } },
            { name: "Collision", type: "CollisionShape3D", props: { shape: SubRef("PlayerShape") } },
            {
              name: "CameraPivot", type: "Node3D", props: { position: { x: 0, y: 0.65, z: 0 } },
              children: [{ name: "Camera3D", type: "Camera3D", props: { position: mode === "tps" ? { x: 0, y: 0.8, z: 4 } : { x: 0, y: 0, z: 0 }, current: true } }]
            }
          ]
        },
        {
          name: "HUD", type: "CanvasLayer", children: [
            { name: "Instructions", type: "Label", props: { offset_left: 16, offset_top: 16, offset_right: 520, offset_bottom: 50, text: "WASD: mover  |  Espaço: pular  |  Esc: liberar mouse" } },
            { name: "Crosshair", type: "Label", props: { anchor_left: 0.5, anchor_top: 0.5, anchor_right: 0.5, anchor_bottom: 0.5, offset_left: -5, offset_top: -12, offset_right: 8, offset_bottom: 12, text: mode === "fps" ? "+" : "" } }
          ]
        }
      ]
    }
  };
}

function withMainSceneIfEmpty(content: string, scenePath: string): { content: string; status: "set" | "existing" } {
  if (/^run\/main_scene\s*=/m.test(content)) return { content, status: "existing" };
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const section = /^\[application\][ \t]*\r?\n/m.exec(content);
  if (!section) {
    return { content: `${content}${content.endsWith("\n") ? "" : lineEnding}${lineEnding}[application]${lineEnding}run/main_scene="${scenePath}"${lineEnding}`, status: "set" };
  }
  const at = section.index + section[0].length;
  return { content: `${content.slice(0, at)}run/main_scene="${scenePath}"${lineEnding}${content.slice(at)}`, status: "set" };
}

async function existingContent(absPath: string): Promise<string | null> {
  try { return await readFile(absPath, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function registerStarter3DTools(server: McpServer, config: ServerConfig): void {
  server.registerTool("devpilot_create_3d_starter", {
    description: "Create a runnable FPS/TPS 3D starter scene with player controller, floor, walls, assigned meshes/colliders, camera, light and environment. Preserves an existing main scene and never overwrites edited files.",
    inputSchema: {
      mode: z.enum(["fps", "tps"]).optional().default("fps"),
      scene_path: z.string().optional().default("res://scenes/godopilot_3d_starter.tscn"),
      script_path: z.string().optional().default("res://scripts/godopilot_3d_controller.gd"),
      set_main_scene_if_empty: z.boolean().optional().default(true),
      dry_run: z.boolean().optional().default(false)
    }
  }, async ({ mode, scene_path, script_path, set_main_scene_if_empty, dry_run }): Promise<CallToolResult> => {
    const response = await executeToolSafely<unknown>(
      { toolName: "devpilot_create_3d_starter", readOnly: config.security.readOnly, projectRoot: config.projectRoot },
      async () => {
        const scene = resolveProjectPath(scene_path, config.projectRoot);
        const script = resolveProjectPath(script_path, config.projectRoot);
        if (!scene.resPath.endsWith(".tscn") || !script.resPath.endsWith(".gd")) {
          return createErrorResponse("INVALID_PATH", "Use a .tscn scene and a .gd script inside this project.", { scene_path, script_path });
        }
        const sceneText = serializeSceneToTscn(starter3DSceneSpec(scene.resPath, script.resPath, mode));
        const scriptText = controllerScript();
        const sceneAudit = audit3DSceneSource(sceneText, "playable");
        if (sceneAudit.findings.length) return createErrorResponse("STARTER_AUDIT_FAILED", "Generated 3D scene failed its own static audit.", { findings: sceneAudit.findings });
        const [oldScene, oldScript] = await Promise.all([existingContent(scene.absolutePath), existingContent(script.absolutePath)]);
        const conflicts = [oldScene !== null && oldScene !== sceneText ? scene.resPath : null, oldScript !== null && oldScript !== scriptText ? script.resPath : null].filter(Boolean);
        if (conflicts.length) return createErrorResponse("FILE_ALREADY_EXISTS", "Starter files already exist with different content; choose new paths.", { conflicts });

        const projectPath = resolveProjectPath("res://project.godot", config.projectRoot);
        const oldProject = await readFile(projectPath.absolutePath, "utf8");
        const main = set_main_scene_if_empty ? withMainSceneIfEmpty(oldProject, scene.resPath) : { content: oldProject, status: "existing" as const };
        if (dry_run) {
          const affectedFiles = [oldScript === null ? script.resPath : null, oldScene === null ? scene.resPath : null, main.content !== oldProject ? "res://project.godot" : null].filter((item): item is string => item !== null);
          return createDryRunResponse({
            toolName: "devpilot_create_3d_starter",
            plannedChanges: affectedFiles.map((file) => file === "res://project.godot" ? `Set ${scene.resPath} as the main scene` : `Create ${file}`),
            affectedFiles
          });
        }
        let backupPath: string | null = null;
        if (main.content !== oldProject) {
          const backup = await createFileBackup({ projectRoot: config.projectRoot, resPath: "res://project.godot", toolName: "devpilot_create_3d_starter", reason: "set 3D starter as initial main scene" });
          backupPath = backup.backupResPath;
        }
        const created: string[] = [];
        let projectWriteAttempted = false;
        try {
          for (const [target, old, content] of [[script.absolutePath, oldScript, scriptText], [scene.absolutePath, oldScene, sceneText]] as const) {
            if (old !== null) continue;
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, content, { encoding: "utf8", flag: "wx" });
            created.push(target);
          }
          if (main.content !== oldProject) {
            projectWriteAttempted = true;
            await writeFile(projectPath.absolutePath, main.content, "utf8");
          }
        } catch (error) {
          await Promise.all(created.map((target) => unlink(target).catch(() => undefined)));
          if (projectWriteAttempted) await writeFile(projectPath.absolutePath, oldProject, "utf8").catch(() => undefined);
          throw error;
        }
        return createSuccessResponse({
          scene_path: scene.resPath,
          script_path: script.resPath,
          mode,
          created_files: created.map((target) => target === scene.absolutePath ? scene.resPath : script.resPath),
          main_scene: main.content !== oldProject ? "set" : main.status === "existing" && /^run\/main_scene\s*=/m.test(oldProject) ? "preserved_existing" : "not_changed",
          project_backup: backupPath,
          scene_audit_findings: sceneAudit.findings
        }, "Runnable 3D starter created.", [], ["Open the scene in Godot and press F6 to playtest it; move WASD, jump with Space, release the mouse with Esc.", "The controller supplies default InputMap actions at runtime only when the project does not already define them. Configure persistent bindings in Project Settings for a production game."]);
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], isError: !response.ok };
  });
}
