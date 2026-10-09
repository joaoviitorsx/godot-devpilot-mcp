import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { readManifest } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

// Archetypes — canonical curated playbooks. Each step = {tool, args} the LLM
// client should call in sequence.
type Step = { tool: string; args?: Record<string, unknown>; comment?: string };

const ARCHETYPES: Record<string, { description: string; steps: Step[]; main_scene_hint?: string }> = {
  shooter_2d: {
    description: "Top-down 2D twin-stick shooter with dungeon rooms, projectiles, boss, shop, chest, pickups, audio bus.",
    steps: [
      { tool: "devpilot_apply_preset", args: { category: "input_map", name: "twin_stick" } },
      { tool: "devpilot_apply_preset", args: { category: "physics_layers", name: "shooter" } },
      { tool: "devpilot_apply_preset", args: { category: "hud", name: "shooter" } },
      { tool: "devpilot_blueprint_audio_bus" },
      { tool: "devpilot_blueprint_projectile_system" },
      { tool: "devpilot_blueprint_twin_stick" },
      { tool: "devpilot_blueprint_dungeon_room" },
      { tool: "devpilot_blueprint_boss_arena" },
      { tool: "devpilot_blueprint_shop_item" },
      { tool: "devpilot_blueprint_chest" },
      { tool: "devpilot_blueprint_pickup" },
      { tool: "devpilot_blueprint_save_schema" },
      { tool: "devpilot_add_autoload", args: { name: "DungeonManager", path: "res://scripts/DungeonManager.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "AudioManager", path: "res://scripts/AudioManager.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "SaveManager", path: "res://scripts/SaveManager.gd" } },
    ],
    main_scene_hint: "Compose Main.tscn with a Player + 5-7 Room instances + HUD + PauseMenu via devpilot_define_scene.",
  },
  dungeon_crawler: {
    description: "2D dungeon crawler with simple weapon, rooms, pickups (no shop, simpler than shooter_2d).",
    steps: [
      { tool: "devpilot_apply_preset", args: { category: "input_map", name: "topdown" } },
      { tool: "devpilot_apply_preset", args: { category: "physics_layers", name: "topdown_rpg" } },
      { tool: "devpilot_apply_preset", args: { category: "hud", name: "shooter" } },
      { tool: "devpilot_blueprint_dungeon_room" },
      { tool: "devpilot_blueprint_chest" },
      { tool: "devpilot_blueprint_pickup" },
      { tool: "devpilot_blueprint_save_schema" },
      { tool: "devpilot_add_autoload", args: { name: "DungeonManager", path: "res://scripts/DungeonManager.gd" } },
    ],
    main_scene_hint: "Compose Main.tscn with rooms + Player + HUD.",
  },
  rpg_topdown: {
    description: "Top-down RPG with dialogue, quests, inventory, loot, save.",
    steps: [
      { tool: "devpilot_apply_preset", args: { category: "input_map", name: "topdown" } },
      { tool: "devpilot_apply_preset", args: { category: "physics_layers", name: "topdown_rpg" } },
      { tool: "devpilot_apply_preset", args: { category: "hud", name: "rpg" } },
      { tool: "devpilot_blueprint_audio_bus" },
      { tool: "devpilot_blueprint_dialogue_system" },
      { tool: "devpilot_blueprint_quest_system" },
      { tool: "devpilot_blueprint_inventory_grid" },
      { tool: "devpilot_blueprint_loot_table" },
      { tool: "devpilot_blueprint_save_schema" },
      { tool: "devpilot_blueprint_localization" },
      { tool: "devpilot_add_autoload", args: { name: "DialogueManager", path: "res://scripts/DialogueManager.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "QuestManager", path: "res://scripts/QuestManager.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "InventoryGrid", path: "res://scripts/InventoryGrid.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "AudioManager", path: "res://scripts/AudioManager.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "SaveManager", path: "res://scripts/SaveManager.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "LocaleManager", path: "res://scripts/LocaleManager.gd" } },
    ],
    main_scene_hint: "Author your overworld map and instance Player + DialogueBox + InventoryUI.",
  },
  platformer: {
    description: "Side-scrolling platformer baseline.",
    steps: [
      { tool: "devpilot_apply_preset", args: { category: "input_map", name: "platformer" } },
      { tool: "devpilot_apply_preset", args: { category: "physics_layers", name: "platformer" } },
      { tool: "devpilot_apply_preset", args: { category: "hud", name: "shooter" } },
      { tool: "devpilot_blueprint_audio_bus" },
      { tool: "devpilot_blueprint_save_schema" },
      { tool: "devpilot_add_autoload", args: { name: "AudioManager", path: "res://scripts/AudioManager.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "SaveManager", path: "res://scripts/SaveManager.gd" } },
    ],
    main_scene_hint: "Use existing godot_create_platformer_controller for player. Author levels with TileMap.",
  },
  fps_3d: {
    description: "3D first-person shooter baseline (FPS player + 3D enemies + projectiles + room).",
    steps: [
      { tool: "devpilot_apply_preset", args: { category: "input_map", name: "fps_3d" } },
      { tool: "devpilot_apply_preset", args: { category: "physics_layers", name: "shooter_3d" } },
      { tool: "devpilot_apply_preset", args: { category: "hud", name: "fps_3d" } },
      { tool: "devpilot_blueprint_audio_bus" },
      { tool: "devpilot_blueprint_player_3d", args: { mode: "fps" } },
      { tool: "devpilot_blueprint_enemy_3d" },
      { tool: "devpilot_blueprint_projectile_3d" },
      { tool: "devpilot_blueprint_dungeon_room_3d" },
      { tool: "devpilot_blueprint_save_schema" },
      { tool: "devpilot_add_autoload", args: { name: "AudioManager", path: "res://scripts/AudioManager.gd" } },
      { tool: "devpilot_add_autoload", args: { name: "SaveManager", path: "res://scripts/SaveManager.gd" } },
    ],
    main_scene_hint: "Compose Main.tscn with Room3D + Player3D instance + HUD.",
  },
  rts_2d: {
    description: "RTS / strategy baseline.",
    steps: [
      { tool: "devpilot_apply_preset", args: { category: "input_map", name: "topdown" } },
      { tool: "devpilot_apply_preset", args: { category: "physics_layers", name: "topdown_rpg" } },
      { tool: "devpilot_blueprint_rts_unit" },
      { tool: "devpilot_blueprint_save_schema" },
    ],
    main_scene_hint: "Place RtsUnit instances + RtsController script on level root.",
  },
  physics_puzzle: {
    description: "Physics-joint puzzle baseline.",
    steps: [
      { tool: "devpilot_apply_preset", args: { category: "input_map", name: "topdown" } },
      { tool: "devpilot_blueprint_physics_puzzle" },
      { tool: "devpilot_blueprint_save_schema" },
    ],
    main_scene_hint: "Use PhysicsPuzzleHelper.build_chain() at level start.",
  },
};

export function registerArchetypeTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_list_archetypes",
    "List canonical project archetypes (curated combos of presets+blueprints+autoloads). Use to fast-start a project: shooter_2d, dungeon_crawler, rpg_topdown, platformer, fps_3d, rts_2d, physics_puzzle.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_list_archetypes", config), async (): Promise<ToolResponse> => {
          const list = Object.entries(ARCHETYPES).map(([name, a]) => ({ name, description: a.description, steps: a.steps.length }));
          return createSuccessResponse({ archetypes: list, count: list.length }, `${list.length} archetypes available.`);
        })
      )
  );

  server.tool(
    "devpilot_create_project_archetype",
    "Return the canonical playbook (sequence of MCP tool calls) for an archetype. Pure planning — no side effects. The LLM client then iterates the steps and calls each tool. Use devpilot_list_archetypes first.",
    {
      name: z.string(),
    },
    async ({ name }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_project_archetype", config), async (): Promise<ToolResponse> => {
          const a = ARCHETYPES[name];
          if (!a) {
            return createErrorResponse("ARCHETYPE_NOT_FOUND", `Unknown archetype '${name}'.`, { available: Object.keys(ARCHETYPES) }, []);
          }
          return createSuccessResponse(
            {
              name,
              description: a.description,
              call_plan: a.steps,
              main_scene_hint: a.main_scene_hint ?? null,
              total_steps: a.steps.length,
            },
            `Playbook for '${name}': ${a.steps.length} step(s). Iterate and call each MCP tool sequentially.`
          );
        })
      )
  );

  server.tool(
    "devpilot_signal_graph",
    "Return signals graph from manifest as Markdown + JSON. Each signal lists the scripts that emit it.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_signal_graph", config), async (): Promise<ToolResponse> => {
          const m = await readManifest(config.projectRoot);
          const lines: string[] = ["# Signal Graph", ""];
          if (Object.keys(m.signals_map).length === 0) {
            lines.push("_No signals recorded in manifest yet._");
          } else {
            for (const [sig, emitters] of Object.entries(m.signals_map)) {
              lines.push(`## ${sig}`);
              for (const e of emitters) lines.push(`- ${e}`);
              lines.push("");
            }
          }
          return createSuccessResponse({ markdown: lines.join("\n"), graph: m.signals_map }, `Signals: ${Object.keys(m.signals_map).length}.`);
        })
      )
  );

  server.tool(
    "devpilot_validate_blueprint_compat",
    "Check whether applying a blueprint conflicts with the manifest state. Returns conflicts (file collisions, duplicate categories).",
    {
      blueprint: z.string(),
    },
    async ({ blueprint }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_validate_blueprint_compat", config), async (): Promise<ToolResponse> => {
          const m = await readManifest(config.projectRoot);
          const conflicts: string[] = [];
          // Heuristic: if blueprint already applied, warn.
          if (m.blueprints_applied.some((b) => b.name === blueprint)) {
            conflicts.push(`blueprint '${blueprint}' was already applied previously`);
          }
          // HUD presets collide if applied twice.
          if (blueprint.startsWith("hud_") || blueprint === "hud") {
            const huds = m.blueprints_applied.filter((b) => b.name.startsWith("hud"));
            if (huds.length > 0) conflicts.push("multiple HUD presets risk overwriting scenes/HUD.tscn");
          }
          return createSuccessResponse({ blueprint, conflicts, ok: conflicts.length === 0 }, conflicts.length === 0 ? "no conflicts detected" : `${conflicts.length} conflict(s)`);
        })
      )
  );
}
