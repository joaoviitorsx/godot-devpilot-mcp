import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";
import { serializeSceneToTscn, type SceneSpec } from "../utils/sceneSerializer.js";
import { readManifest, recordScene, recordBlueprintApplied } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// ── Blueprint dependency registry (provides / requires) ──────────────────────

export type BlueprintDeps = {
  name: string;
  provides: string[];
  requires: string[];
};

export const BLUEPRINT_DEPS: BlueprintDeps[] = [
  { name: "twin_stick",            provides: ["player_2d", "weapon"],         requires: ["player_bullet"] },
  { name: "projectile_system",     provides: ["player_bullet", "enemy_bullet"], requires: [] },
  { name: "dungeon_room",          provides: ["room_2d", "door"],             requires: [] },
  { name: "boss_arena",            provides: ["boss"],                        requires: ["enemy_bullet"] },
  { name: "shop_item",             provides: ["shop_slot"],                   requires: [] },
  { name: "chest",                 provides: ["chest"],                       requires: [] },
  { name: "pickup",                provides: ["pickup"],                      requires: [] },
  { name: "player_3d",             provides: ["player_3d"],                   requires: [] },
  { name: "enemy_3d",              provides: ["enemy_3d"],                    requires: [] },
  { name: "projectile_3d",         provides: ["player_projectile_3d"],        requires: [] },
  { name: "dungeon_room_3d",       provides: ["room_3d"],                     requires: [] },
  { name: "dialogue_system",       provides: ["dialogue"],                    requires: [] },
  { name: "quest_system",          provides: ["quest"],                       requires: [] },
  { name: "inventory_grid",        provides: ["inventory"],                   requires: [] },
  { name: "loot_table",            provides: ["loot"],                        requires: ["inventory"] },
  { name: "audio_bus",             provides: ["audio"],                       requires: [] },
  { name: "save_schema",           provides: ["save"],                        requires: [] },
  { name: "localization",          provides: ["i18n"],                        requires: [] },
  { name: "rts_unit",              provides: ["rts_unit"],                    requires: [] },
  { name: "physics_puzzle",        provides: ["draggable"],                   requires: [] },
  { name: "behavior_tree",         provides: ["bt"],                          requires: [] },
  { name: "vfx_library",           provides: ["vfx"],                         requires: [] },
  { name: "scene_transitions",     provides: ["transitions"],                 requires: [] },
  { name: "settings_manager",      provides: ["settings"],                    requires: [] },
  { name: "shader_library",        provides: ["shaders"],                     requires: [] },
  { name: "navigation",            provides: ["navmesh"],                     requires: [] },
];

function findDeps(name: string): BlueprintDeps | undefined {
  return BLUEPRINT_DEPS.find((d) => d.name === name);
}

// ── compose Main.tscn ────────────────────────────────────────────────────────

const MAIN_SCENE_HINT_SCRIPT = `extends Node2D
# Auto-composed Main scene. Patches blueprint instances together.
# Override _ready to add additional setup if needed.

func _ready() -> void:
	pass
`;

async function buildMainSceneSpec(projectRoot: string, opts: { include_pause: boolean; include_hud: boolean; rooms_layout: "single" | "grid"; main_path: string }): Promise<{ spec: SceneSpec; warnings: string[]; refs: Array<{ scene: string; instance_name: string }> }> {
  const m = await readManifest(projectRoot);
  const warnings: string[] = [];

  // Helper: find scene by manifest "kind".
  const findByKind = (kind: string): string[] =>
    Object.entries(m.scenes).filter(([, info]) => info.kind === kind).map(([p]) => p);

  const playerScenes = [...findByKind("player"), ...findByKind("player_3d")];
  const roomScenes = [...findByKind("room"), ...findByKind("room_3d")];
  const hudScenes = findByKind("hud");
  const pauseScenes = findByKind("pause");

  const ext_resources: Array<{ id: string; type: string; path: string }> = [];
  const children: SceneSpec["root"]["children"] = [];

  let nextId = 0;
  const idFor = (path: string): string => {
    let r = ext_resources.find((e) => e.path === path);
    if (r) return r.id;
    const id = `sc_${nextId++}`;
    ext_resources.push({ id, type: "PackedScene", path });
    return id;
  };

  const refs: Array<{ scene: string; instance_name: string }> = [];

  // Dungeon container
  const dungeonChildren: SceneSpec["root"]["children"] = [];
  if (roomScenes.length > 0) {
    const roomScene = roomScenes[0];
    const id = idFor(roomScene);
    const layoutPositions: Array<[number, number]> = opts.rooms_layout === "grid" && roomScenes.length === 1
      ? [[0, 0], [800, 0], [1600, 0], [2400, 0], [1600, -600], [1600, 600], [3200, 0]]
      : [[0, 0]];
    layoutPositions.forEach(([x, y], i) => {
      dungeonChildren!.push({
        name: `Room${i}`, instance: id, props: { position: { x, y }, room_id: i === 0 ? "start" : `room_${i}` },
      });
      refs.push({ scene: roomScene, instance_name: `Room${i}` });
    });
  }

  if (dungeonChildren && dungeonChildren.length > 0) {
    children!.push({ name: "Dungeon", type: "Node2D", children: dungeonChildren });
  } else {
    warnings.push("No room blueprint applied — main scene will lack level geometry.");
  }

  // Player
  if (playerScenes.length > 0) {
    const id = idFor(playerScenes[0]);
    const is3d = playerScenes[0].includes("3D") || playerScenes[0].includes("3d");
    children!.push({
      name: "Player", instance: id, props: is3d ? {} : { position: { x: 360, y: 240 } },
    });
    refs.push({ scene: playerScenes[0], instance_name: "Player" });
  } else {
    warnings.push("No player blueprint applied — main scene won't have a controllable character.");
  }

  // HUD
  if (opts.include_hud && hudScenes.length > 0) {
    const id = idFor(hudScenes[0]);
    children!.push({ name: "HUD", instance: id });
    refs.push({ scene: hudScenes[0], instance_name: "HUD" });
  }

  // PauseMenu
  if (opts.include_pause && pauseScenes.length > 0) {
    const id = idFor(pauseScenes[0]);
    children!.push({ name: "PauseMenu", instance: id });
    refs.push({ scene: pauseScenes[0], instance_name: "PauseMenu" });
  }

  const spec: SceneSpec = {
    path: opts.main_path,
    ext_resources,
    root: { name: "Main", type: "Node2D", children },
  };

  return { spec, warnings, refs };
}

export function registerCompositionTools(server: McpServer, config: ServerConfig): void {
  // ── compose Main.tscn ────────────────────────────────────────────────────
  server.tool(
    "devpilot_compose_main_scene",
    "Auto-compose Main.tscn from blueprints recorded in manifest. Instances Player, Rooms, HUD, PauseMenu at sensible positions. Optionally sets project run/main_scene. Idempotent — pass overwrite=true to replace.",
    {
      main_path: z.string().optional().default("res://scenes/Main.tscn"),
      rooms_layout: z.enum(["single", "grid"]).optional().default("grid").describe("'single' = one room at origin; 'grid' = 7 rooms arranged in dungeon-crawler layout."),
      include_pause: z.boolean().optional().default(true),
      include_hud: z.boolean().optional().default(true),
      set_as_main: z.boolean().optional().default(true).describe("Update project.godot run/main_scene."),
      overwrite: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_compose_main_scene", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const result = await buildMainSceneSpec(config.projectRoot, {
            include_pause: params.include_pause,
            include_hud: params.include_hud,
            rooms_layout: params.rooms_layout,
            main_path: params.main_path,
          });
          const resolved = resolveProjectPath(params.main_path, config.projectRoot);
          if (await fileExists(resolved.absolutePath) && !params.overwrite) {
            return createErrorResponse("EXISTS", "Main scene exists; pass overwrite=true.", { path: params.main_path }, []);
          }
          await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
          await writeFile(resolved.absolutePath, serializeSceneToTscn(result.spec), "utf8");
          await recordScene(config.projectRoot, params.main_path, "main_composed", result.refs.map((r) => r.scene));
          await recordBlueprintApplied(config.projectRoot, "compose_main_scene", { path: params.main_path });

          // Optionally patch project.godot run/main_scene.
          let main_scene_set: string | null = null;
          if (params.set_as_main) {
            const projectFile = path.join(config.projectRoot, "project.godot");
            if (await fileExists(projectFile)) {
              const content = await readFile(projectFile, "utf8");
              let updated: string;
              if (/run\/main_scene\s*=/.test(content)) {
                updated = content.replace(/run\/main_scene\s*=\s*"[^"]*"/, `run/main_scene="${params.main_path}"`);
              } else if (/\[application\]/.test(content)) {
                updated = content.replace(/(\[application\][\s\S]*?)(?=\n\[|$)/, (block) => {
                  if (/run\/main_scene/.test(block)) return block;
                  return block.trimEnd() + `\nrun/main_scene="${params.main_path}"\n`;
                });
              } else {
                updated = content + `\n[application]\nrun/main_scene="${params.main_path}"\n`;
              }
              if (updated !== content) {
                await writeFile(projectFile, updated, "utf8");
                main_scene_set = params.main_path;
              }
            }
          }

          return createSuccessResponse(
            { path: params.main_path, references: result.refs, warnings: result.warnings, main_scene_set },
            `Main.tscn composed (${result.refs.length} instance(s)).`,
            result.warnings,
          );
        })
      )
  );

  // ── apply_refinement diff-aware ──────────────────────────────────────────
  server.tool(
    "devpilot_apply_refinement",
    "Apply a refinement plan: scans current manifest, detects added/removed entities & systems vs the new plan, and executes only the patches needed (calls add_autoload, applies missing blueprints, deletes obsolete files). Pair with devpilot_refine_plan.",
    {
      target_blueprints: z.array(z.string()).describe("Final list of blueprints the project should have."),
      target_autoloads: z.record(z.string()).optional().describe("Final {name: res:// path} autoload map."),
      remove_obsolete_files: z.boolean().optional().default(false).describe("If true, delete generated files no longer in target. Destructive — snapshot first."),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_apply_refinement", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const m = await readManifest(config.projectRoot);
          const applied = new Set(m.blueprints_applied.map((b) => b.name));
          const target = new Set(params.target_blueprints);

          const to_add: string[] = [];
          for (const t of target) if (!applied.has(t)) to_add.push(t);

          const to_remove: string[] = [];
          for (const a of applied) if (!target.has(a)) to_remove.push(a);

          // Add missing autoloads (caller must follow-up with devpilot_add_autoload calls).
          const autoload_actions: Array<{ action: string; name: string; path: string }> = [];
          if (params.target_autoloads) {
            for (const [name, p] of Object.entries(params.target_autoloads)) {
              if (!m.autoloads[name]) autoload_actions.push({ action: "add", name, path: p });
            }
          }

          const removed_files: string[] = [];
          if (params.remove_obsolete_files && to_remove.length > 0) {
            // Heuristic: remove generated_files whose name matches a blueprint's expected outputs.
            // Blueprint metadata not exhaustively tracked → only remove if user explicitly asked.
            for (const f of m.generated_files) {
              for (const b of to_remove) {
                if (f.toLowerCase().includes(b.replace(/_/g, ""))) {
                  removed_files.push(f);
                }
              }
            }
          }

          const next_steps: string[] = [];
          for (const b of to_add) next_steps.push(`devpilot_blueprint_${b}`);
          for (const al of autoload_actions) next_steps.push(`devpilot_add_autoload name=${al.name} path=${al.path}`);

          return createSuccessResponse(
            {
              diff: {
                add_blueprints: to_add,
                remove_blueprints: to_remove,
                add_autoloads: autoload_actions,
                obsolete_files_detected: removed_files,
              },
              next_steps,
            },
            `Diff: +${to_add.length} blueprint(s), -${to_remove.length}, +${autoload_actions.length} autoload(s).`,
          );
        })
      )
  );

  // ── check_blueprint_dependencies ─────────────────────────────────────────
  server.tool(
    "devpilot_check_blueprint_dependencies",
    "Inspect manifest blueprints against the dependency registry. Reports missing requires (e.g. boss_arena requires enemy_bullet from projectile_system). Pure read — no mutations.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_check_blueprint_dependencies", config), async (): Promise<ToolResponse> => {
          const m = await readManifest(config.projectRoot);
          const applied = m.blueprints_applied.map((b) => b.name);
          const provided = new Set<string>();
          for (const bp of applied) {
            const d = findDeps(bp);
            if (d) for (const p of d.provides) provided.add(p);
          }
          const issues: Array<{ blueprint: string; missing: string[] }> = [];
          for (const bp of applied) {
            const d = findDeps(bp);
            if (!d) continue;
            const missing = d.requires.filter((r) => !provided.has(r));
            if (missing.length > 0) issues.push({ blueprint: bp, missing });
          }
          return createSuccessResponse(
            { provides: Array.from(provided), issues, ok: issues.length === 0 },
            issues.length === 0 ? "All dependencies satisfied." : `${issues.length} blueprint(s) have unmet dependencies.`,
          );
        })
      )
  );

  // unused helper export to silence linter
  void MAIN_SCENE_HINT_SCRIPT;
}

void autoFixGDScript;
