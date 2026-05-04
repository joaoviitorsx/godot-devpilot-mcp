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

async function writeProjectFile(projectRoot: string, resPath: string, content: string, allowOverwrite: boolean, requiredExt?: string): Promise<{ written: boolean; reason?: string; absolutePath: string }> {
  const resolved = resolveProjectPath(resPath, projectRoot);
  if (requiredExt && !resolved.resPath.endsWith(requiredExt)) {
    throw createSafetyError("INVALID_PARAMS", `path must end in ${requiredExt}.`, { path: resPath }, []);
  }
  const exists = await fileExists(resolved.absolutePath);
  if (exists && !allowOverwrite) {
    return { written: false, reason: "File already exists.", absolutePath: resolved.absolutePath };
  }
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, content, "utf8");
  return { written: true, absolutePath: resolved.absolutePath };
}

async function addChildNode(godot: GodotClient, parent: string, type: string, name: string): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.add", { parent_path: parent, node_type: type, node_name: name });
}

async function setProperty(godot: GodotClient, nodePath: string, property: string, value: unknown): Promise<ToolResponse> {
  return callAfterConnect(godot, "node.set_property", { node_path: nodePath, property, value });
}

// ── Templates ─────────────────────────────────────────────────────────────────

const SHADER_MATERIAL_TEMPLATE = `shader_type canvas_item;

uniform vec4 tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float intensity : hint_range(0.0, 2.0) = 1.0;

void fragment() {
	vec4 base = texture(TEXTURE, UV);
	COLOR = vec4(base.rgb * tint.rgb * intensity, base.a * tint.a);
}
`;

const SHADER_3D_TEMPLATE = `shader_type spatial;

uniform vec4 albedo : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform sampler2D albedo_tex : source_color, hint_default_white;

void fragment() {
	vec4 c = texture(albedo_tex, UV) * albedo;
	ALBEDO = c.rgb;
	ALPHA = c.a;
}
`;

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerToolkit13Tools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // PHYSICS TOOLKIT (3)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── godot_setup_physics_body ───────────────────────────────────────────────
  server.tool(
    "godot_setup_physics_body",
    "Create a physics body (RigidBody2D, RigidBody3D, StaticBody2D, StaticBody3D) with a child CollisionShape and optional mesh/sprite.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().describe("Body name."),
      body_type: z.enum(["RigidBody2D", "RigidBody3D", "StaticBody2D", "StaticBody3D"]).describe("Physics body class."),
      include_visual: z.boolean().optional().describe("Add Sprite2D (2D) or MeshInstance3D (3D) child. Defaults to true."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, body_type, include_visual, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_physics_body", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const visual = include_visual !== false;
        const is2D = body_type.endsWith("2D");
        const collisionType = is2D ? "CollisionShape2D" : "CollisionShape3D";
        const visualType = is2D ? "Sprite2D" : "MeshInstance3D";
        const bodyPath = parent === "." ? name : `${parent}/${name}`;

        if (dry_run) {
          const planned = [
            `Add ${body_type} '${name}' under ${parent}`,
            `Add ${collisionType} child`
          ];
          if (visual) planned.push(`Add ${visualType} child`);
          return createDryRunResponse({
            toolName: "godot_setup_physics_body",
            plannedChanges: planned,
            affectedNodes: [bodyPath]
          });
        }

        const ops: ToolResponse[] = [
          await addChildNode(godot, parent, body_type, name),
          await addChildNode(godot, bodyPath, collisionType, "Collision")
        ];
        if (visual) ops.push(await addChildNode(godot, bodyPath, visualType, "Visual"));

        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { body_path: bodyPath, body_type, dimensions: is2D ? "2D" : "3D" },
          "Physics body created.",
          [],
          [`Assign Shape to ${bodyPath}/Collision via inspector.`]
        );
      })
    )
  );

  // ── godot_set_collision_layers ─────────────────────────────────────────────
  server.tool(
    "godot_set_collision_layers",
    "Set collision_layer and collision_mask bitmasks on a physics body or area node.",
    {
      node_path: z.string().describe("Node path of the physics body/area."),
      layer: z.number().int().nonnegative().describe("collision_layer bitmask (uint32)."),
      mask: z.number().int().nonnegative().describe("collision_mask bitmask (uint32)."),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, layer, mask, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_set_collision_layers", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_collision_layers",
            plannedChanges: [`Set ${node_path}.collision_layer=${layer} and collision_mask=${mask}`],
            affectedNodes: [node_path]
          });
        }
        const ops = [
          await setProperty(godot, node_path, "collision_layer", layer),
          await setProperty(godot, node_path, "collision_mask", mask)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;
        return createSuccessResponse({ node_path, collision_layer: layer, collision_mask: mask }, "Collision layers set.");
      })
    )
  );

  // ── godot_add_raycast_2d ──────────────────────────────────────────────────
  server.tool(
    "godot_add_raycast_2d",
    "Add a RayCast2D node with target_position and enabled=true.",
    {
      parent_path: z.string().describe("Parent node path."),
      name: z.string().optional().describe("Defaults to 'RayCast2D'."),
      target_x: z.number().optional().describe("Defaults to 0."),
      target_y: z.number().optional().describe("Defaults to 100."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, target_x, target_y, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_add_raycast_2d", config), async (): Promise<ToolResponse> => {
        const rcName = name ?? "RayCast2D";
        const tx = target_x ?? 0;
        const ty = target_y ?? 100;
        const rcPath = `${parent_path}/${rcName}`;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_add_raycast_2d",
            plannedChanges: [
              `Add RayCast2D '${rcName}' under ${parent_path}`,
              `Set target_position=(${tx}, ${ty}) and enabled=true`
            ],
            affectedNodes: [rcPath]
          });
        }

        const ops = [
          await addChildNode(godot, parent_path, "RayCast2D", rcName),
          await setProperty(godot, rcPath, "target_position", { x: tx, y: ty }),
          await setProperty(godot, rcPath, "enabled", true)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { raycast_path: rcPath, target_position: { x: tx, y: ty } },
          "RayCast2D configured."
        );
      })
    )
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATION TOOLKIT (3)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── godot_create_animation_player ─────────────────────────────────────────
  server.tool(
    "godot_create_animation_player",
    "Add an AnimationPlayer node under a parent.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'AnimationPlayer'."),
      autoplay: z.string().optional().describe("Animation name to autoplay (informational; assign in inspector)."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, autoplay, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_animation_player", config), async (): Promise<ToolResponse> => {
        const apName = name ?? "AnimationPlayer";
        const parent = parent_path ?? ".";
        const apPath = parent === "." ? apName : `${parent}/${apName}`;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_animation_player",
            plannedChanges: [`Add AnimationPlayer '${apName}' under ${parent}`],
            affectedNodes: [apPath]
          });
        }

        const r = await addChildNode(godot, parent, "AnimationPlayer", apName);
        if (!r.ok) return r;

        return createSuccessResponse(
          { player_path: apPath, autoplay: autoplay ?? null },
          "AnimationPlayer added.",
          [],
          ["Create an AnimationLibrary resource and add Animation tracks via the editor's Animation panel.", autoplay ? `Set autoplay='${autoplay}' in the Animation panel.` : "Use the Animation panel to author animations."]
        );
      })
    )
  );

  // ── godot_add_animation_track ─────────────────────────────────────────────
  server.tool(
    "godot_add_animation_track",
    "Document the steps to add a new Animation to an AnimationPlayer (returns instructions; Animation/AnimationLibrary resources cannot be instanced via JSON-RPC).",
    {
      player_path: z.string().describe("AnimationPlayer node path."),
      animation_name: z.string().describe("Animation name to create.")
    },
    async ({ player_path, animation_name }) => toMcpResult(
      await executeToolSafely(ctx("godot_add_animation_track", config), async (): Promise<ToolResponse> =>
        createSuccessResponse(
          {
            player_path,
            animation_name,
            instructions: [
              "Open the Animation panel in the bottom dock.",
              `Select '${player_path}'.`,
              "Click Animation → New, name it '" + animation_name + "'.",
              "Add tracks via 'Add Track' for properties to animate.",
              "Set keyframes by changing properties at the desired time."
            ]
          },
          "Animation creation instructions returned.",
          ["AnimationLibrary/Animation resources require editor-side authoring."]
        )
      )
    )
  );

  // ── godot_create_animation_tree ───────────────────────────────────────────
  server.tool(
    "godot_create_animation_tree",
    "Add an AnimationTree node configured to use an AnimationPlayer (anim_player property).",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'AnimationTree'."),
      anim_player: z.string().optional().describe("NodePath to the AnimationPlayer (e.g. '../AnimationPlayer')."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, anim_player, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_animation_tree", config), async (): Promise<ToolResponse> => {
        const treeName = name ?? "AnimationTree";
        const parent = parent_path ?? ".";
        const treePath = parent === "." ? treeName : `${parent}/${treeName}`;
        const player = anim_player ?? "../AnimationPlayer";

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_animation_tree",
            plannedChanges: [
              `Add AnimationTree '${treeName}' under ${parent}`,
              `Set anim_player='${player}' and active=true`
            ],
            affectedNodes: [treePath]
          });
        }

        const ops = [
          await addChildNode(godot, parent, "AnimationTree", treeName),
          await setProperty(godot, treePath, "anim_player", player),
          await setProperty(godot, treePath, "active", true)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { tree_path: treePath, anim_player: player },
          "AnimationTree configured.",
          [],
          ["Create a tree_root (AnimationNodeStateMachine, BlendTree, etc.) via inspector."]
        );
      })
    )
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIO TOOLKIT (2)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── godot_create_audio_stream_player_2d ───────────────────────────────────
  server.tool(
    "godot_create_audio_stream_player_2d",
    "Add an AudioStreamPlayer2D under a parent and configure bus/volume.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'AudioStreamPlayer2D'."),
      bus: z.string().optional().describe("Audio bus name. Defaults to 'Master'."),
      volume_db: z.number().optional().describe("volume_db. Defaults to 0."),
      autoplay: z.boolean().optional().describe("Defaults to false."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, bus, volume_db, autoplay, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_audio_stream_player_2d", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const playerName = name ?? "AudioStreamPlayer2D";
        const pPath = parent === "." ? playerName : `${parent}/${playerName}`;
        const playerBus = bus ?? "Master";
        const vol = volume_db ?? 0;
        const auto = autoplay ?? false;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_audio_stream_player_2d",
            plannedChanges: [
              `Add AudioStreamPlayer2D '${playerName}' under ${parent}`,
              `Set bus='${playerBus}', volume_db=${vol}, autoplay=${auto}`
            ],
            affectedNodes: [pPath]
          });
        }

        const ops = [
          await addChildNode(godot, parent, "AudioStreamPlayer2D", playerName),
          await setProperty(godot, pPath, "bus", playerBus),
          await setProperty(godot, pPath, "volume_db", vol),
          await setProperty(godot, pPath, "autoplay", auto)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { player_path: pPath, bus: playerBus, volume_db: vol, autoplay: auto },
          "AudioStreamPlayer2D configured.",
          [],
          ["Assign an AudioStream resource (.ogg/.wav/.mp3) to the 'stream' property."]
        );
      })
    )
  );

  // ── godot_create_audio_stream_player_3d ───────────────────────────────────
  server.tool(
    "godot_create_audio_stream_player_3d",
    "Add an AudioStreamPlayer3D for spatial audio.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'AudioStreamPlayer3D'."),
      bus: z.string().optional().describe("Defaults to 'Master'."),
      max_distance: z.number().positive().optional().describe("Audible distance. Defaults to 50."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, bus, max_distance, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_audio_stream_player_3d", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const playerName = name ?? "AudioStreamPlayer3D";
        const pPath = parent === "." ? playerName : `${parent}/${playerName}`;
        const playerBus = bus ?? "Master";
        const dist = max_distance ?? 50;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_audio_stream_player_3d",
            plannedChanges: [
              `Add AudioStreamPlayer3D '${playerName}' under ${parent}`,
              `Set bus='${playerBus}' and max_distance=${dist}`
            ],
            affectedNodes: [pPath]
          });
        }

        const ops = [
          await addChildNode(godot, parent, "AudioStreamPlayer3D", playerName),
          await setProperty(godot, pPath, "bus", playerBus),
          await setProperty(godot, pPath, "max_distance", dist)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { player_path: pPath, bus: playerBus, max_distance: dist },
          "AudioStreamPlayer3D configured.",
          [],
          ["Assign an AudioStream resource to 'stream'."]
        );
      })
    )
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PARTICLES TOOLKIT (2)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── godot_create_gpu_particles_2d ─────────────────────────────────────────
  server.tool(
    "godot_create_gpu_particles_2d",
    "Add a GPUParticles2D node configured with amount and emitting flag.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'GPUParticles2D'."),
      amount: z.number().int().positive().optional().describe("Particle count. Defaults to 32."),
      emitting: z.boolean().optional().describe("Defaults to true."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, amount, emitting, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_gpu_particles_2d", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const partName = name ?? "GPUParticles2D";
        const pPath = parent === "." ? partName : `${parent}/${partName}`;
        const amt = amount ?? 32;
        const emit = emitting !== false;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_gpu_particles_2d",
            plannedChanges: [
              `Add GPUParticles2D '${partName}' under ${parent}`,
              `Set amount=${amt}, emitting=${emit}`
            ],
            affectedNodes: [pPath]
          });
        }

        const ops = [
          await addChildNode(godot, parent, "GPUParticles2D", partName),
          await setProperty(godot, pPath, "amount", amt),
          await setProperty(godot, pPath, "emitting", emit)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { particles_path: pPath, amount: amt, emitting: emit },
          "GPUParticles2D configured.",
          [],
          ["Assign a ParticleProcessMaterial to 'process_material' to define particle behavior."]
        );
      })
    )
  );

  // ── godot_create_gpu_particles_3d ─────────────────────────────────────────
  server.tool(
    "godot_create_gpu_particles_3d",
    "Add a GPUParticles3D node configured with amount and emitting flag.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'GPUParticles3D'."),
      amount: z.number().int().positive().optional().describe("Defaults to 32."),
      emitting: z.boolean().optional().describe("Defaults to true."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, amount, emitting, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_gpu_particles_3d", config), async (): Promise<ToolResponse> => {
        const parent = parent_path ?? ".";
        const partName = name ?? "GPUParticles3D";
        const pPath = parent === "." ? partName : `${parent}/${partName}`;
        const amt = amount ?? 32;
        const emit = emitting !== false;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_gpu_particles_3d",
            plannedChanges: [
              `Add GPUParticles3D '${partName}' under ${parent}`,
              `Set amount=${amt}, emitting=${emit}`
            ],
            affectedNodes: [pPath]
          });
        }

        const ops = [
          await addChildNode(godot, parent, "GPUParticles3D", partName),
          await setProperty(godot, pPath, "amount", amt),
          await setProperty(godot, pPath, "emitting", emit)
        ];
        const failed = ops.find((o) => !o.ok);
        if (failed) return failed;

        return createSuccessResponse(
          { particles_path: pPath, amount: amt, emitting: emit },
          "GPUParticles3D configured.",
          [],
          ["Assign ParticleProcessMaterial + draw_pass_1 (mesh) for full setup."]
        );
      })
    )
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SHADER TOOLKIT (2)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── godot_create_shader ────────────────────────────────────────────────────
  server.tool(
    "godot_create_shader",
    "Generate a baseline .gdshader file (canvas_item or spatial) inside the project.",
    {
      shader_path: z.string().describe("res:// path ending in .gdshader."),
      shader_type: z.enum(["canvas_item", "spatial"]).optional().describe("Defaults to canvas_item."),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ shader_path, shader_type, overwrite, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_shader", config), async (): Promise<ToolResponse> => {
        const kind = shader_type ?? "canvas_item";
        const template = kind === "spatial" ? SHADER_3D_TEMPLATE : SHADER_MATERIAL_TEMPLATE;

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_shader",
            plannedChanges: [`Write ${shader_path} (${kind} shader template)`],
            affectedFiles: [shader_path]
          });
        }

        const write = await writeProjectFile(config.projectRoot, shader_path, template, overwrite ?? false, ".gdshader");
        if (!write.written) return createErrorResponse("FILE_ALREADY_EXISTS", write.reason!, { path: shader_path }, ["Pass overwrite=true to replace."]);

        return createSuccessResponse(
          { shader_path, shader_type: kind },
          "Shader template written.",
          [],
          ["Create a ShaderMaterial in the inspector and assign this .gdshader to 'shader'."]
        );
      })
    )
  );

  // ── godot_assign_shader_material ──────────────────────────────────────────
  server.tool(
    "godot_assign_shader_material",
    "Document how to assign a shader material to a CanvasItem/MeshInstance node (Resource instancing limitation).",
    {
      node_path: z.string().describe("Target node path (Sprite2D, MeshInstance3D, etc.)."),
      shader_path: z.string().describe("res:// .gdshader path.")
    },
    async ({ node_path, shader_path }) => toMcpResult(
      await executeToolSafely(ctx("godot_assign_shader_material", config), async (): Promise<ToolResponse> => {
        if (!shader_path.endsWith(".gdshader")) {
          return createErrorResponse("INVALID_PARAMS", "shader_path must end in .gdshader.", { shader_path }, []);
        }
        return createSuccessResponse(
          {
            node_path,
            shader_path,
            instructions: [
              `Open '${node_path}' in the inspector.`,
              "Find the 'material' (CanvasItem) or 'material_override' (MeshInstance3D) property.",
              "Click 'New ShaderMaterial'.",
              "Expand the new material → 'shader' → Load → select '" + shader_path + "'."
            ]
          },
          "Assignment instructions returned.",
          ["ShaderMaterial Resource cannot be instanced via JSON-RPC; assign it via inspector."]
        );
      })
    )
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION TOOLKIT (1) — 3D version is in toolkit3dTools.ts
  // ═══════════════════════════════════════════════════════════════════════════

  // ── godot_setup_navigation_region_2d ──────────────────────────────────────
  server.tool(
    "godot_setup_navigation_region_2d",
    "Add a NavigationRegion2D node. NavigationPolygon resource must be assigned + baked in editor.",
    {
      parent_path: z.string().optional().describe("Defaults to '.'."),
      name: z.string().optional().describe("Defaults to 'NavigationRegion2D'."),
      dry_run: z.boolean().optional()
    },
    async ({ parent_path, name, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_setup_navigation_region_2d", config), async (): Promise<ToolResponse> => {
        const navName = name ?? "NavigationRegion2D";
        const parent = parent_path ?? ".";
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_setup_navigation_region_2d",
            plannedChanges: [`Add NavigationRegion2D '${navName}' under ${parent}`],
            affectedNodes: [`${parent}/${navName}`]
          });
        }
        const r = await addChildNode(godot, parent, "NavigationRegion2D", navName);
        if (!r.ok) return r;
        return createSuccessResponse(
          { navigation_path: parent === "." ? navName : `${parent}/${navName}` },
          "NavigationRegion2D added.",
          [],
          ["Assign a NavigationPolygon to 'navigation_polygon' and bake via the editor toolbar."]
        );
      })
    )
  );
}
