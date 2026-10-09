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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function addChildNode(godot: GodotClient, parent: string, type: string, name: string): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.add", { parent_path: parent, node_type: type, node_name: name });
}

async function setProperty(godot: GodotClient, nodePath: string, property: string, value: unknown): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.set_property", { node_path: nodePath, property, value });
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
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and _camera_pivot:
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
        const camPath = `${parent_path}/${camName}`;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_setup_camera_3d",
            plannedChanges: [
              `Add Camera3D '${camName}' under ${parent_path}`,
              `Set current=true and fov=${fovDeg}`
            ],
            affectedNodes: [camPath]
          });
        }

        const ops = [
          await addChildNode(godot, parent_path, "Camera3D", camName),
          await setProperty(godot, camPath, "current", true),
          await setProperty(godot, camPath, "fov", fovDeg)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

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
            `Add MeshInstance3D + CollisionShape3D children`
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

        const write = await writeScriptFile(config.projectRoot, scriptResPath, THIRD_PERSON_CONTROLLER, overwrite_script ?? false);
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: scriptResPath }, []);

        const playerPath = parent === "." ? playerName : `${parent}/${playerName}`;
        const ops: ToolResponse[] = [
          await addChildNode(godot, parent, "CharacterBody3D", playerName),
          await addChildNode(godot, playerPath, "MeshInstance3D", "Mesh"),
          await addChildNode(godot, playerPath, "CollisionShape3D", "Collision")
        ];
        if (withCamera) {
          ops.push(await addChildNode(godot, playerPath, "Node3D", "CameraPivot"));
          ops.push(await addChildNode(godot, `${playerPath}/CameraPivot`, "Camera3D", "Camera3D"));
          ops.push(await setProperty(godot, `${playerPath}/CameraPivot/Camera3D`, "current", true));
        }
        ops.push(await attachScript(godot, playerPath, scriptResPath));

        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { player_path: playerPath, script_path: scriptResPath, camera_included: withCamera },
          "CharacterBody3D created.",
          [],
          ["Assign Mesh and Shape3D resources via inspector. Define Input Map: 'jump', 'move_left', 'move_right', 'move_forward', 'move_back'."]
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
              `Add WorldEnvironment '${envName}' under ${parent}`
            ],
            affectedNodes: [`${parent}/${lightName}`, `${parent}/${envName}`]
          });
        }

        const lightPath = parent === "." ? lightName : `${parent}/${lightName}`;
        const envPath = parent === "." ? envName : `${parent}/${envName}`;
        const ops = [
          await addChildNode(godot, parent, "DirectionalLight3D", lightName),
          await setProperty(godot, lightPath, "rotation_degrees", { x: -50, y: -45, z: 0 }),
          await setProperty(godot, lightPath, "light_energy", energy),
          await setProperty(godot, lightPath, "shadow_enabled", true),
          await addChildNode(godot, parent, "WorldEnvironment", envName)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { light_path: lightPath, env_path: envPath, light_energy: energy },
          "Lighting setup added.",
          [],
          ["Assign an Environment resource (with sky/ambient) to WorldEnvironment.environment in the inspector."]
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
        const write = await writeScriptFile(config.projectRoot, script_path, THIRD_PERSON_CONTROLLER, overwrite ?? false);
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
    "Add a MeshInstance3D under a parent. NOTE: assigning the actual primitive mesh resource (BoxMesh/SphereMesh/etc.) must be done in the editor inspector — JSON-RPC cannot instantiate Resources directly.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'Mesh' or to the primitive name when provided."),
      primitive: z.enum(PRIMITIVE_MESH_TYPES).optional().describe("Suggested primitive (purely informational — included in suggestions)."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, primitive, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_primitive_mesh", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const meshName = name ?? (primitive ? primitive.replace(/Mesh$/, "") : "Mesh");
        const meshPath = parent === "." ? meshName : `${parent}/${meshName}`;
        const suggestedPrim: PrimitiveMeshType = primitive ?? "BoxMesh";

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_primitive_mesh",
            plannedChanges: [`Add MeshInstance3D '${meshName}' under ${parent}`],
            affectedNodes: [meshPath]
          });
        }

        const r = await addChildNode(godot, parent, "MeshInstance3D", meshName);
        if (!r.ok) return r;
        return createSuccessResponse(
          { mesh_path: meshPath, suggested_primitive: suggestedPrim },
          "MeshInstance3D added.",
          [],
          [`Assign a ${suggestedPrim} (or other PrimitiveMesh) to the 'mesh' property in the editor inspector.`]
        );
      })
    )
  );

  // ── godot_create_navigation_region_3d ──────────────────────────────────────
  server.tool(
    "godot_create_navigation_region_3d",
    "Add a NavigationRegion3D node. NavigationMesh resource must be assigned + baked in editor.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'NavigationRegion3D'."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_navigation_region_3d", config), async (): Promise<ToolResponse> => {
        const navName = name ?? "NavigationRegion3D";
        const parent = parent_path ?? ".";
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_navigation_region_3d",
            plannedChanges: [`Add NavigationRegion3D '${navName}' under ${parent}`],
            affectedNodes: [`${parent}/${navName}`]
          });
        }
        const r = await addChildNode(godot, parent, "NavigationRegion3D", navName);
        if (!r.ok) return r;
        return createSuccessResponse(
          { navigation_path: parent === "." ? navName : `${parent}/${navName}` },
          "NavigationRegion3D added.",
          [],
          ["Assign a NavigationMesh resource and bake it via the editor's 'Bake NavMesh' button."]
        );
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
        const rcPath = `${parent_path}/${rcName}`;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_raycast_3d",
            plannedChanges: [
              `Add RayCast3D '${rcName}' under ${parent_path}`,
              `Set target_position=(${tx}, ${ty}, ${tz}) and enabled=true`
            ],
            affectedNodes: [rcPath]
          });
        }

        const ops = [
          await addChildNode(godot, parent_path, "RayCast3D", rcName),
          await setProperty(godot, rcPath, "target_position", { x: tx, y: ty, z: tz }),
          await setProperty(godot, rcPath, "enabled", true)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

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
    "Add a Node3D placeholder and instruct user to import .gltf/.glb via Godot's import dock. Direct import via JSON-RPC is not supported (Godot import pipeline runs in editor).",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'GLTFRoot'."),
      gltf_path: z.string().describe("res:// path to the .gltf or .glb file (informational, must already be imported by the editor)."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, gltf_path, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_import_gltf", config), async (): Promise<ToolResponse> => {
        const placeholderName = name ?? "GLTFRoot";
        const parent = parent_path ?? ".";

        if (!gltf_path.startsWith("res://") || !(gltf_path.endsWith(".gltf") || gltf_path.endsWith(".glb"))) {
          return createErrorResponse(
            "INVALID_PARAMS",
            "gltf_path must be a res:// path ending in .gltf or .glb.",
            { gltf_path },
            ["Provide a res:// path to an imported glTF/GLB asset."]
          );
        }

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_import_gltf",
            plannedChanges: [`Add Node3D placeholder '${placeholderName}' under ${parent}; suggest manual instance of ${gltf_path}`],
            affectedNodes: [`${parent}/${placeholderName}`]
          });
        }

        const r = await addChildNode(godot, parent, "Node3D", placeholderName);
        if (!r.ok) return r;

        return createSuccessResponse(
          { placeholder_path: parent === "." ? placeholderName : `${parent}/${placeholderName}`, gltf_path, instanced: false },
          "Placeholder added. glTF must be instanced via editor.",
          ["Direct glTF instancing via JSON-RPC is not supported — use the Godot editor's 'Instantiate Child Scene' menu pointing to the imported scene."],
          [`Drag ${gltf_path} from FileSystem dock onto '${placeholderName}' to instance the imported scene.`]
        );
      })
    )
  );
}
