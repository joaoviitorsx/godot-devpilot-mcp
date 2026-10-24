import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { createFileBackup } from "../safety/backup.js";
import { createSafetyError } from "../safety/errors.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  try {
    if (!godot.getStatus().connected) {
      const connection = await godot.connect();
      if (!connection.ok) return connection;
    }
    return await godot.call(method, params);
  } catch (error) {
    return createErrorResponse("EDITOR_RPC_FAILED", `Editor request ${method} failed.`, { cause: error instanceof Error ? error.message : String(error) }, []);
  }
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(absPath: string): Promise<boolean> {
  try { await access(absPath); return true; } catch { return false; }
}

async function writeScriptFile(projectRoot: string, resPath: string, content: string, allowOverwrite: boolean, toolName: string): Promise<{ written: boolean; reason?: string }> {
  const resolved = resolveProjectPath(resPath, projectRoot);
  if (!resolved.resPath.endsWith(".gd")) {
    throw createSafetyError("INVALID_PARAMS", "script path must end in .gd.", { path: resPath }, []);
  }
  const exists = await fileExists(resolved.absolutePath);
  if (exists && !allowOverwrite) {
    return { written: false, reason: "Script already exists. Pass overwrite=true to replace." };
  }
  if (exists) {
    await createFileBackup({ projectRoot, resPath: resolved.resPath, toolName, reason: "replace 3D controller script" });
  }
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, content, "utf8");
  return { written: true };
}

async function addChildNode(godot: GodotClient, parent: string, type: string, name: string): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.add", { parent_path: parent, node_type: type, node_name: name });
}

function addedNodePath(response: ToolResponse): string | null {
  const value = response.ok && response.data && typeof response.data === "object" ? (response.data as Record<string, unknown>).path : null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function missingNodePath(): ToolResponse {
  return createErrorResponse("INVALID_PLUGIN_RESPONSE", "The Godot editor did not return the path of its new node.", {}, ["Update and restart the GodoPilot editor plugin."]);
}

async function setProperty(godot: GodotClient, nodePath: string, property: string, value: unknown): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.set_property", { node_path: nodePath, property, value });
}

async function assign3DResource(godot: GodotClient, nodePath: string, property: string, resourceType: string, options: Record<string, unknown> = {}): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.assign_3d_resource", { node_path: nodePath, property, resource_type: resourceType, ...options });
}

async function runSteps(steps: Array<() => Promise<ToolResponse>>): Promise<ToolResponse | null> {
  for (const step of steps) {
    const response = await step();
    if (!response.ok) return response;
  }
  return null;
}

async function rollbackComposite(godot: GodotClient, paths: string[], failure: ToolResponse, script?: { absolutePath: string; previous?: string }): Promise<ToolResponse> {
  const cleanupErrors: string[] = [];
  for (const nodePath of [...paths].reverse()) {
    try {
      const removed = await callAfterConnect(godot, "node.remove", { node_path: nodePath });
      if (!removed.ok) cleanupErrors.push(`${nodePath}: ${removed.error.code}`);
    } catch (error) {
      cleanupErrors.push(`${nodePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (script) {
    try {
      if (script.previous === undefined) await rm(script.absolutePath, { force: true });
      else await writeFile(script.absolutePath, script.previous, "utf8");
    } catch (error) {
      cleanupErrors.push(`${script.absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const original = failure.ok ? createErrorResponse("COMPOSITE_FAILED", "Composite operation failed.", {}, []) : failure;
  return createErrorResponse(
    cleanupErrors.length ? "ROLLBACK_FAILED" : original.error.code,
    cleanupErrors.length ? "The operation failed and cleanup was incomplete." : original.error.message,
    { ...original.error.details, rollback: { completed: cleanupErrors.length === 0, removed_nodes: paths, restored_script: script?.absolutePath, errors: cleanupErrors } },
    original.error.suggestions
  );
}

async function attachScript(godot: GodotClient, nodePath: string, scriptPath: string): Promise<ToolResponse> {
  return callAfterConnect(godot, "script.attach", { node_path: nodePath, script_path: scriptPath });
}

// ── Templates ─────────────────────────────────────────────────────────────────

const THIRD_PERSON_CONTROLLER = `extends CharacterBody3D

@export var speed: float = 5.0
@export var jump_velocity: float = 4.5
@export var mouse_sensitivity: float = 0.002

var _camera_pivot: Node3D = null

var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)

func _ready() -> void:
	if has_node("CameraPivot"):
		_camera_pivot = get_node("CameraPivot")
	_ensure_action("move_left", KEY_A)
	_ensure_action("move_right", KEY_D)
	_ensure_action("move_forward", KEY_W)
	_ensure_action("move_back", KEY_S)
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
		return
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if event is InputEventMouseMotion and _camera_pivot and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-event.relative.x * mouse_sensitivity)
		_camera_pivot.rotate_x(-event.relative.y * mouse_sensitivity)
		_camera_pivot.rotation.x = clamp(_camera_pivot.rotation.x, -PI / 2, PI / 2)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= _gravity * delta

	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity

	var input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var direction := (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	if direction.length() > 0.0:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)

	move_and_slide()
`;

const PRIMITIVE_MESH_TYPES = ["BoxMesh", "SphereMesh", "CapsuleMesh", "CylinderMesh", "PlaneMesh", "PrismMesh", "TorusMesh"] as const;
type PrimitiveMeshType = (typeof PRIMITIVE_MESH_TYPES)[number];

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerToolkit3dTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_setup_camera_3d ──────────────────────────────────────────────────
  server.tool(
    "godot_setup_camera_3d",
    "Add a Camera3D to a parent and mark it as current.",
    {
      parent_path: z.string().describe("Parent node path."),
      name: z.string().optional().describe("Defaults to 'Camera3D'."),
      fov: z.number().positive().optional().describe("Field of view (degrees). Defaults to 75."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, fov, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_camera_3d", config), async (): Promise<ToolResponse> => {
        const camName = name ?? "Camera3D";
        const fovDeg = fov ?? 75;
        const plannedPath = parent_path === "." ? camName : `${parent_path}/${camName}`;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_setup_camera_3d",
            plannedChanges: [
              `Add Camera3D '${camName}' under ${parent_path}`,
              `Set current=true and fov=${fovDeg}`
            ],
            affectedNodes: [plannedPath]
          });
        }

        const added = await addChildNode(godot, parent_path, "Camera3D", camName);
        if (!added.ok) return added;
        const camPath = addedNodePath(added);
        if (!camPath) return missingNodePath();
        const failed = await runSteps([
          () => setProperty(godot, camPath, "current", true),
          () => setProperty(godot, camPath, "fov", fovDeg)
        ]);
        if (failed) return rollbackComposite(godot, [camPath], failed);

        return createSuccessResponse(
          { camera_path: camPath, fov: fovDeg },
          "Camera3D configured."
        );
      })
    )
  );

  // ── godot_create_character_body_3d ─────────────────────────────────────────
  server.tool(
    "godot_create_character_body_3d",
    "Create a CharacterBody3D node tree (body + MeshInstance3D + CollisionShape3D + CameraPivot/Camera3D) with the third-person controller script.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'Player'."),
      script_path: z.string().optional().describe("Defaults to res://scripts/Player3D.gd."),
      include_camera: z.boolean().optional().describe("Add CameraPivot + Camera3D children. Defaults to true."),
      overwrite_script: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, script_path, include_camera, overwrite_script, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_character_body_3d", config), async (): Promise<ToolResponse> => {
        const playerName = name ?? "Player";
        const parent = parent_path ?? ".";
        const scriptResPath = script_path ?? "res://scripts/Player3D.gd";
        const withCamera = include_camera !== false;

        if (dry_run) {
          const planned = [
            `Write ${scriptResPath} (third-person controller)`,
            `Add CharacterBody3D '${playerName}' under ${parent}`,
            `Add MeshInstance3D with CapsuleMesh + CollisionShape3D with CapsuleShape3D`
          ];
          if (withCamera) planned.push(`Add CameraPivot (Node3D) + Camera3D children`);
          planned.push(`Attach ${scriptResPath} to ${playerName}`);
          return createDryRunResponse({
            toolName: "godot_create_character_body_3d",
            plannedChanges: planned,
            affectedFiles: [scriptResPath],
            affectedNodes: [`${parent}/${playerName}`]
          });
        }

        const parentCheck = await callAfterConnect(godot, "node.get_properties", { node_path: parent });
        if (!parentCheck.ok) return parentCheck;

        const scriptAbsolutePath = resolveProjectPath(scriptResPath, config.projectRoot).absolutePath;
        const previousScript = await readFile(scriptAbsolutePath, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        const write = await writeScriptFile(config.projectRoot, scriptResPath, THIRD_PERSON_CONTROLLER, overwrite_script ?? false, "godot_create_character_body_3d");
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: scriptResPath }, []);
        const scriptRollback = { absolutePath: scriptAbsolutePath, previous: previousScript };

        const added = await addChildNode(godot, parent, "CharacterBody3D", playerName);
        if (!added.ok) return rollbackComposite(godot, [], added, scriptRollback);
        const playerPath = addedNodePath(added);
        if (!playerPath) return rollbackComposite(godot, [], missingNodePath(), scriptRollback);
        const steps: Array<() => Promise<ToolResponse>> = [
          () => addChildNode(godot, playerPath, "MeshInstance3D", "Mesh"),
          () => assign3DResource(godot, `${playerPath}/Mesh`, "mesh", "CapsuleMesh"),
          () => addChildNode(godot, playerPath, "CollisionShape3D", "Collision"),
          () => assign3DResource(godot, `${playerPath}/Collision`, "shape", "CapsuleShape3D")
        ];
        if (withCamera) {
          steps.push(() => addChildNode(godot, playerPath, "Node3D", "CameraPivot"));
          steps.push(() => setProperty(godot, `${playerPath}/CameraPivot`, "position", { x: 0, y: 0.65, z: 0 }));
          steps.push(() => addChildNode(godot, `${playerPath}/CameraPivot`, "Camera3D", "Camera3D"));
          steps.push(() => setProperty(godot, `${playerPath}/CameraPivot/Camera3D`, "position", { x: 0, y: 0.8, z: 4 }));
          steps.push(() => setProperty(godot, `${playerPath}/CameraPivot/Camera3D`, "current", true));
        }
        steps.push(() => attachScript(godot, playerPath, scriptResPath));

        const failed = await runSteps(steps);
        if (failed) return rollbackComposite(godot, [playerPath], failed, scriptRollback);

        return createSuccessResponse(
          { player_path: playerPath, script_path: scriptResPath, camera_included: withCamera },
          "CharacterBody3D created.",
          [],
          ["The controller supplies default InputMap actions at runtime only when absent. Configure persistent bindings in Project Settings for production."]
        );
      })
    )
  );

  // ── godot_setup_lighting ───────────────────────────────────────────────────
  server.tool(
    "godot_setup_lighting",
    "Add DirectionalLight3D + WorldEnvironment for a basic outdoor scene.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      light_name: z.string().optional().describe("Defaults to 'Sun'."),
      env_name: z.string().optional().describe("Defaults to 'WorldEnvironment'."),
      light_energy: z.number().positive().optional().describe("DirectionalLight3D.light_energy. Defaults to 1.0."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, light_name, env_name, light_energy, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_lighting", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const lightName = light_name ?? "Sun";
        const envName = env_name ?? "WorldEnvironment";
        const energy = light_energy ?? 1.0;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_setup_lighting",
            plannedChanges: [
              `Add DirectionalLight3D '${lightName}' under ${parent}`,
              `Set rotation_degrees=Vector3(-50, -45, 0) and light_energy=${energy}`,
              `Add WorldEnvironment '${envName}' with an Environment resource under ${parent}`
            ],
            affectedNodes: [`${parent}/${lightName}`, `${parent}/${envName}`]
          });
        }

        const addedLight = await addChildNode(godot, parent, "DirectionalLight3D", lightName);
        if (!addedLight.ok) return addedLight;
        const lightPath = addedNodePath(addedLight);
        if (!lightPath) return missingNodePath();
        const failed = await runSteps([
          () => setProperty(godot, lightPath, "rotation_degrees", { x: -50, y: -45, z: 0 }),
          () => setProperty(godot, lightPath, "light_energy", energy),
          () => setProperty(godot, lightPath, "shadow_enabled", true)
        ]);
        if (failed) return rollbackComposite(godot, [lightPath], failed);
        const addedEnv = await addChildNode(godot, parent, "WorldEnvironment", envName);
        if (!addedEnv.ok) return rollbackComposite(godot, [lightPath], addedEnv);
        const envPath = addedNodePath(addedEnv);
        if (!envPath) return rollbackComposite(godot, [lightPath], missingNodePath());
        const assigned = await assign3DResource(godot, envPath, "environment", "Environment");
        if (!assigned.ok) return rollbackComposite(godot, [envPath, lightPath], assigned);

        return createSuccessResponse(
          { light_path: lightPath, env_path: envPath, light_energy: energy },
          "Lighting setup added.",
          [],
          ["Adjust the environment and lighting in the inspector to match the game's art direction."]
        );
      })
    )
  );

  // ── godot_setup_third_person_controller (script only) ─────────────────────
  server.tool(
    "godot_setup_third_person_controller",
    "Generate a third-person CharacterBody3D controller GDScript template (no nodes created).",
    {
      script_path: z.string().describe("res:// destination .gd path."),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ script_path, overwrite, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_third_person_controller", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_setup_third_person_controller",
            plannedChanges: [`Write ${script_path} (third-person controller — requires CameraPivot child + Input Map jump/move_*)`],
            affectedFiles: [script_path]
          });
        }
        const write = await writeScriptFile(config.projectRoot, script_path, THIRD_PERSON_CONTROLLER, overwrite ?? false, "godot_setup_third_person_controller");
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: script_path }, []);
        return createSuccessResponse(
          { script_path },
          "Third-person controller written.",
          [],
          ["Define Input Map actions: 'jump', 'move_left', 'move_right', 'move_forward', 'move_back'.", "Attach this script to a CharacterBody3D with a CameraPivot child."]
        );
      })
    )
  );

  // ── godot_create_primitive_mesh ────────────────────────────────────────────
  server.tool(
    "godot_create_primitive_mesh",
    "Add a MeshInstance3D with an assigned primitive Mesh resource under a parent.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'Mesh' or to the primitive name when provided."),
      primitive: z.enum(PRIMITIVE_MESH_TYPES).optional().describe("Mesh resource type. Defaults to BoxMesh."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, primitive, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_primitive_mesh", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const meshName = name ?? (primitive ? primitive.replace(/Mesh$/, "") : "Mesh");
        const plannedPath = parent === "." ? meshName : `${parent}/${meshName}`;
        const suggestedPrim: PrimitiveMeshType = primitive ?? "BoxMesh";

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_primitive_mesh",
            plannedChanges: [`Add MeshInstance3D '${meshName}' with ${suggestedPrim} under ${parent}`],
            affectedNodes: [plannedPath]
          });
        }

        const r = await addChildNode(godot, parent, "MeshInstance3D", meshName);
        if (!r.ok) return r;
        const meshPath = addedNodePath(r);
        if (!meshPath) return missingNodePath();
        const assigned = await assign3DResource(godot, meshPath, "mesh", suggestedPrim);
        if (!assigned.ok) return rollbackComposite(godot, [meshPath], assigned);
        return createSuccessResponse(
          { mesh_path: meshPath, primitive: suggestedPrim, suggested_primitive: suggestedPrim },
          "MeshInstance3D created with a primitive mesh."
        );
      })
    )
  );

  // ── godot_create_navigation_region_3d ──────────────────────────────────────
  server.tool(
    "godot_create_navigation_region_3d",
    "Add a NavigationRegion3D with a flat rectangular NavigationMesh. For obstacles or complex levels, bake a new mesh in the Godot editor.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'NavigationRegion3D'."),
      width: z.number().finite().min(0.5).max(1000).optional().describe("Flat navigation rectangle width. Defaults to 10."),
      depth: z.number().finite().min(0.5).max(1000).optional().describe("Flat navigation rectangle depth. Defaults to 10."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, width, depth, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_navigation_region_3d", config), async (): Promise<ToolResponse> => {
        const navName = name ?? "NavigationRegion3D";
        const parent = parent_path ?? ".";
        const plannedPath = parent === "." ? navName : `${parent}/${navName}`;
        const navWidth = width ?? 10;
        const navDepth = depth ?? 10;
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_navigation_region_3d",
            plannedChanges: [`Add NavigationRegion3D '${navName}' under ${parent} with a ${navWidth}×${navDepth} flat NavigationMesh`],
            affectedNodes: [plannedPath]
          });
        }
        const r = await addChildNode(godot, parent, "NavigationRegion3D", navName);
        if (!r.ok) return r;
        const navPath = addedNodePath(r);
        if (!navPath) return missingNodePath();
        const assigned = await assign3DResource(godot, navPath, "navigation_mesh", "NavigationMesh", { width: navWidth, depth: navDepth });
        if (!assigned.ok) return rollbackComposite(godot, [navPath], assigned);
        return createSuccessResponse(
          { navigation_path: navPath, width: navWidth, depth: navDepth },
          "NavigationRegion3D created with a flat NavigationMesh.",
          [],
          ["This flat rectangle ignores obstacles and height changes. Bake a NavigationMesh from level geometry for complex scenes."]
        );
      })
    )
  );

  server.tool(
    "godot_bake_navigation_mesh_3d",
    "Bake a NavigationRegion3D from meshes and static colliders in the open scene. Replaces its navigation mesh with an undoable resource only when walkable polygons are produced.",
    {
      region_path: z.string().describe("Path to a NavigationRegion3D in the open scene."),
      source_root_path: z.string().optional().describe("Geometry subtree root. Defaults to the scene root ('.')."),
      agent_radius: z.number().finite().min(0.05).max(10).optional().describe("Agent radius in Godot units. Defaults to 0.5."),
      cell_size: z.number().finite().min(0.05).max(2).optional().describe("Bake voxel width in Godot units. Defaults to 0.25."),
      dry_run: z.boolean().optional()
    },
    async ({ region_path, source_root_path, agent_radius, cell_size, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_bake_navigation_mesh_3d", config), async (): Promise<ToolResponse> => {
        if (dry_run) return createDryRunResponse({
          toolName: "godot_bake_navigation_mesh_3d",
          plannedChanges: [`Bake navigation from ${source_root_path ?? "."} into ${region_path}`],
          affectedNodes: [region_path]
        });
        return callAfterConnect(godot, "node.bake_navigation_mesh_3d", {
          region_path,
          source_root_path: source_root_path ?? ".",
          agent_radius: agent_radius ?? 0.5,
          cell_size: cell_size ?? 0.25
        });
      })
    )
  );

  // ── godot_create_raycast_3d ────────────────────────────────────────────────
  server.tool(
    "godot_create_raycast_3d",
    "Add a RayCast3D node and configure its target_position.",
    {
      parent_path: z.string().describe("Parent node path."),
      name: z.string().optional().describe("Defaults to 'RayCast3D'."),
      target_x: z.number().optional().describe("target_position.x. Defaults to 0."),
      target_y: z.number().optional().describe("target_position.y. Defaults to -1 (downward)."),
      target_z: z.number().optional().describe("target_position.z. Defaults to 0."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, target_x, target_y, target_z, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_raycast_3d", config), async (): Promise<ToolResponse> => {
        const rcName = name ?? "RayCast3D";
        const tx = target_x ?? 0;
        const ty = target_y ?? -1;
        const tz = target_z ?? 0;
        const plannedPath = parent_path === "." ? rcName : `${parent_path}/${rcName}`;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_raycast_3d",
            plannedChanges: [
              `Add RayCast3D '${rcName}' under ${parent_path}`,
              `Set target_position=(${tx}, ${ty}, ${tz}) and enabled=true`
            ],
            affectedNodes: [plannedPath]
          });
        }

        const added = await addChildNode(godot, parent_path, "RayCast3D", rcName);
        if (!added.ok) return added;
        const rcPath = addedNodePath(added);
        if (!rcPath) return missingNodePath();
        const failed = await runSteps([
          () => setProperty(godot, rcPath, "target_position", { x: tx, y: ty, z: tz }),
          () => setProperty(godot, rcPath, "enabled", true)
        ]);
        if (failed) return rollbackComposite(godot, [rcPath], failed);

        return createSuccessResponse(
          { raycast_path: rcPath, target_position: { x: tx, y: ty, z: tz } },
          "RayCast3D configured."
        );
      })
    )
  );

  // ── godot_import_gltf ──────────────────────────────────────────────────────
  server.tool(
    "godot_import_gltf",
    "Instance an existing .gltf/.glb model scene imported by Godot under the open scene's parent node.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Optional name for the instantiated model root."),
      gltf_path: z.string().describe("Project-local res:// path to a .gltf or .glb file already imported by the editor."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, gltf_path, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_import_gltf", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const model = resolveProjectPath(gltf_path, config.projectRoot);
        if (!(model.resPath.endsWith(".gltf") || model.resPath.endsWith(".glb"))) {
          return createErrorResponse(
            "INVALID_PARAMS",
            "gltf_path must be a res:// path ending in .gltf or .glb.",
            { gltf_path },
            ["Provide a res:// path to a glTF/GLB asset inside this project."]
          );
        }
        if (!await fileExists(model.absolutePath)) return createErrorResponse("FILE_NOT_FOUND", "Model file does not exist in this project.", { gltf_path: model.resPath }, []);

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_import_gltf",
            plannedChanges: [`Instance imported model ${model.resPath} under ${parent}${name ? ` as '${name}'` : ""}`],
            affectedFiles: [model.resPath],
            affectedNodes: [parent]
          });
        }

        const r = await callAfterConnect(godot, "scene.add_instance", { scene_path: model.resPath, parent_path: parent, instance_name: name ?? "" });
        if (!r.ok) return r;

        return createSuccessResponse(
          { gltf_path: model.resPath, instance_path: (r.data as Record<string, unknown> | null)?.node_path ?? null, instanced: true },
          "Imported glTF model instanced in the open scene.",
          [],
          ["Inspect scale, orientation, materials, animations and collision after import; add collision separately when gameplay needs it."]
        );
      })
    )
  );

  server.tool(
    "godot_audit_gltf",
    "Inspect a glTF/GLB scene already imported by Godot. Reports meshes, material coverage, animations, skeletons, collision and non-unit scales; visual orientation still requires review.",
    { gltf_path: z.string().describe("Project-local res:// path to an imported .glb or .gltf file.") },
    async ({ gltf_path }) => toMcpResult(
      await executeToolSafely({ ...ctx("godot_audit_gltf", config), readOnly: false }, async (): Promise<ToolResponse> => {
        const model = resolveProjectPath(gltf_path, config.projectRoot);
        if (!(model.resPath.endsWith(".gltf") || model.resPath.endsWith(".glb"))) {
          return createErrorResponse("INVALID_PARAMS", "gltf_path must end in .gltf or .glb.", { gltf_path }, []);
        }
        if (!await fileExists(model.absolutePath)) return createErrorResponse("FILE_NOT_FOUND", "Model file does not exist in this project.", { gltf_path: model.resPath }, []);
        return callAfterConnect(godot, "node.audit_gltf_import", { gltf_path: model.resPath });
      })
    )
  );

  server.tool(
    "godot_create_gridmap_3d",
    "Create a GridMap for modular 3D level building. Use a project MeshLibrary, or omit it for a basic collidable Block palette.",
    {
      parent_path: z.string().optional().describe("Parent node path; defaults to scene root."),
      name: z.string().optional().describe("GridMap node name; defaults to GridMap3D."),
      cell_size: z.number().finite().min(0.25).max(100).optional().describe("Uniform cell size; defaults to 2 Godot units."),
      mesh_library_path: z.string().optional().describe("Optional project-local res:// .tres or .res MeshLibrary."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, cell_size, mesh_library_path, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_gridmap_3d", config), async (): Promise<ToolResponse> => {
        let libraryPath = "";
        if (mesh_library_path) {
          const resolved = resolveProjectPath(mesh_library_path, config.projectRoot);
          if (!(resolved.resPath.endsWith(".tres") || resolved.resPath.endsWith(".res"))) return createErrorResponse("INVALID_PARAMS", "mesh_library_path must end in .tres or .res.", { mesh_library_path }, []);
          if (!await fileExists(resolved.absolutePath)) return createErrorResponse("FILE_NOT_FOUND", "MeshLibrary file does not exist.", { mesh_library_path: resolved.resPath }, []);
          libraryPath = resolved.resPath;
        }
        if (dry_run) return createDryRunResponse({
          toolName: "godot_create_gridmap_3d",
          plannedChanges: [`Create GridMap '${name ?? "GridMap3D"}' under ${parent_path ?? "."} with ${libraryPath || "a primitive Block MeshLibrary"}`],
          affectedNodes: [parent_path ?? "."],
          affectedFiles: libraryPath ? [libraryPath] : []
        });
        return callAfterConnect(godot, "node.create_gridmap_3d", { parent_path: parent_path ?? ".", name: name ?? "GridMap3D", cell_size: cell_size ?? 2, mesh_library_path: libraryPath });
      })
    )
  );

  server.tool(
    "godot_get_gridmap_palette",
    "List item IDs, names, and collision/navigation coverage in a GridMap's MeshLibrary before placing cells.",
    { gridmap_path: z.string().describe("Path to a GridMap in the open scene.") },
    async ({ gridmap_path }) => toMcpResult(
      await executeToolSafely({ ...ctx("godot_get_gridmap_palette", config), readOnly: false }, async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "node.get_gridmap_palette", { gridmap_path })
      )
    )
  );

  server.tool(
    "godot_paint_gridmap_cells",
    "Paint or erase up to 512 GridMap cells in one undoable editor action. Use item=-1 to erase; inspect palette first for valid IDs.",
    {
      gridmap_path: z.string().describe("Path to a GridMap in the open scene."),
      cells: z.array(z.object({
        x: z.number().int().min(-10000).max(10000),
        y: z.number().int().min(-10000).max(10000),
        z: z.number().int().min(-10000).max(10000),
        item: z.number().int().min(-1),
        orientation: z.number().int().min(0).max(23).optional()
      })).min(1).max(512),
      dry_run: z.boolean().optional()
    },
    async ({ gridmap_path, cells, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_paint_gridmap_cells", config), async (): Promise<ToolResponse> => {
        if (dry_run) return createDryRunResponse({ toolName: "godot_paint_gridmap_cells", plannedChanges: [`Paint ${cells.length} cells on ${gridmap_path}`], affectedNodes: [gridmap_path] });
        return callAfterConnect(godot, "node.paint_gridmap_cells", { gridmap_path, cells });
      })
    )
  );
}
