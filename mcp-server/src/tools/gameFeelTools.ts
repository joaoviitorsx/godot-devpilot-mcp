import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
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
  return { toolName, readOnly: false, projectRoot: config.projectRoot };
}

// ── Presets ──────────────────────────────────────────────────────────────────

const MOVEMENT_PRESETS = {
  floaty: { speed: 180, friction: 600, acceleration: 800 },
  snappy: { speed: 280, friction: 2400, acceleration: 3000 },
  heavy: { speed: 200, friction: 1200, acceleration: 1500 },
  responsive: { speed: 240, friction: 1800, acceleration: 2200 },
} as const;

const CAMERA_PRESETS = {
  cinematic: { position_smoothing_speed: 5.0, drag_horizontal_enabled: true, drag_vertical_enabled: true, position_smoothing_enabled: true },
  twitchy: { position_smoothing_speed: 25.0, drag_horizontal_enabled: false, drag_vertical_enabled: false, position_smoothing_enabled: true },
  anchored: { position_smoothing_speed: 1.0, drag_horizontal_enabled: false, drag_vertical_enabled: false, position_smoothing_enabled: false },
} as const;

// ── Tool registration ────────────────────────────────────────────────────────

export function registerGameFeelTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_tune_player_movement ──────────────────────────────────────────
  server.tool(
    "devpilot_tune_player_movement",
    "Tune a player script's movement constants. Patches the script's @export speed/friction/acceleration values via script.patch (permanent) or runtime.set_property (temporary). Presets: floaty/snappy/heavy/responsive.",
    {
      script_path: z.string().optional().describe("Player script .gd to patch (permanent mode)"),
      runtime_node_path: z.string().optional().describe("Runtime node path for live tuning (temporary mode)"),
      preset: z.enum(["floaty", "snappy", "heavy", "responsive"]).optional(),
      speed: z.number().optional(),
      friction: z.number().optional(),
      acceleration: z.number().optional(),
      mode: z.enum(["permanent", "runtime"]).optional().default("permanent"),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_tune_player_movement", config), async (): Promise<ToolResponse> => {
          const presetValues = params.preset ? MOVEMENT_PRESETS[params.preset] : null;
          const values = {
            speed: params.speed ?? presetValues?.speed,
            friction: params.friction ?? presetValues?.friction,
            acceleration: params.acceleration ?? presetValues?.acceleration,
          };

          if (params.dry_run) {
            return createSuccessResponse({ dry_run: true, mode: params.mode, values, preset: params.preset }, "Dry run.");
          }

          const results: Record<string, unknown> = {};
          if (params.mode === "runtime") {
            if (!params.runtime_node_path) return createSuccessResponse({ error: "runtime_node_path required for runtime mode" }, "Missing param.");
            for (const [key, val] of Object.entries(values)) {
              if (val === undefined) continue;
              const r = await callRpc(godot, "runtime.set_property", { node_path: params.runtime_node_path, property: key, value: val });
              results[key] = { ok: r.ok, value: val };
            }
          } else {
            if (!params.script_path) return createSuccessResponse({ error: "script_path required for permanent mode" }, "Missing param.");
            for (const [key, val] of Object.entries(values)) {
              if (val === undefined) continue;
              const re = new RegExp(`(@export var ${key}: float = )([\\d.]+)`);
              const r = await callRpc(godot, "script.patch", { script_path: params.script_path, pattern: re.source, replacement: `$1${val}`, regex: true });
              results[key] = { ok: r.ok, value: val };
            }
          }
          return createSuccessResponse({ mode: params.mode, preset: params.preset ?? "(custom)", values, results }, "Movement tuned.");
        })
      )
  );

  // ── devpilot_tune_camera_feel ──────────────────────────────────────────────
  server.tool(
    "devpilot_tune_camera_feel",
    "Tune Camera2D feel via property mutations. Presets: cinematic (smooth + drag), twitchy (instant), anchored (locked).",
    {
      camera_path: z.string().describe("Camera2D node path"),
      preset: z.enum(["cinematic", "twitchy", "anchored"]).optional(),
      smoothing_speed: z.number().positive().optional(),
      drag_horizontal: z.boolean().optional(),
      drag_vertical: z.boolean().optional(),
      runtime: z.boolean().optional().default(false).describe("Apply to runtime node instead of editor"),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_tune_camera_feel", config), async (): Promise<ToolResponse> => {
          const presetValues = params.preset ? CAMERA_PRESETS[params.preset] : null;
          const final = {
            position_smoothing_speed: params.smoothing_speed ?? presetValues?.position_smoothing_speed,
            drag_horizontal_enabled: params.drag_horizontal ?? presetValues?.drag_horizontal_enabled,
            drag_vertical_enabled: params.drag_vertical ?? presetValues?.drag_vertical_enabled,
            position_smoothing_enabled: presetValues?.position_smoothing_enabled,
          };
          if (params.dry_run) return createSuccessResponse({ dry_run: true, camera_path: params.camera_path, preset: params.preset, values: final }, "Dry run.");
          const method = params.runtime ? "runtime.set_property" : "node.set_property";
          const results: Record<string, boolean> = {};
          for (const [k, v] of Object.entries(final)) {
            if (v === undefined) continue;
            const r = await callRpc(godot, method, { node_path: params.camera_path, property: k, value: v });
            results[k] = r.ok;
          }
          return createSuccessResponse({ camera_path: params.camera_path, preset: params.preset ?? "(custom)", values: final, results, runtime: params.runtime }, "Camera tuned.");
        })
      )
  );

  // ── devpilot_tune_jump_arc ─────────────────────────────────────────────────
  server.tool(
    "devpilot_tune_jump_arc",
    "Compute platformer physics constants from human-meaningful inputs (jump height in pixels + time to apex). Returns gravity + jump_velocity. Optionally patches the player script.",
    {
      jump_height_px: z.number().positive().describe("Pixel height the player reaches at peak"),
      time_to_apex_s: z.number().positive().describe("Seconds from jump start to peak"),
      script_path: z.string().optional().describe("If provided, patches @export var gravity / jump_velocity in this script"),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_tune_jump_arc", config), async (): Promise<ToolResponse> => {
          // Standard projectile motion: jump_velocity = -2h/t (negative because Godot Y axis points down)
          // gravity = 2h/t²
          const gravity = (2 * params.jump_height_px) / (params.time_to_apex_s * params.time_to_apex_s);
          const jumpVelocity = -((2 * params.jump_height_px) / params.time_to_apex_s);

          if (params.dry_run || !params.script_path) {
            return createSuccessResponse({
              dry_run: params.dry_run,
              jump_height_px: params.jump_height_px,
              time_to_apex_s: params.time_to_apex_s,
              computed: { gravity: Math.round(gravity * 100) / 100, jump_velocity: Math.round(jumpVelocity * 100) / 100 },
              patch_target: params.script_path ?? null,
            }, params.script_path ? "Dry run." : "Computed only (no script_path provided).");
          }

          const results: Record<string, boolean> = {};
          const r1 = await callRpc(godot, "script.patch", { script_path: params.script_path, pattern: `(@export var gravity: float = )([\\d.]+)`, replacement: `$1${Math.round(gravity * 100) / 100}`, regex: true });
          results.gravity = r1.ok;
          const r2 = await callRpc(godot, "script.patch", { script_path: params.script_path, pattern: `(@export var jump_velocity: float = )(-?[\\d.]+)`, replacement: `$1${Math.round(jumpVelocity * 100) / 100}`, regex: true });
          results.jump_velocity = r2.ok;

          return createSuccessResponse({
            jump_height_px: params.jump_height_px,
            time_to_apex_s: params.time_to_apex_s,
            computed: { gravity: Math.round(gravity * 100) / 100, jump_velocity: Math.round(jumpVelocity * 100) / 100 },
            script_path: params.script_path,
            patches_applied: results,
          }, "Jump arc computed and applied.");
        })
      )
  );

  // ── devpilot_tune_combat_balance ───────────────────────────────────────────
  server.tool(
    "devpilot_tune_combat_balance",
    "Heuristic combat balance: takes player HP + average enemy HP/damage and target time-to-kill, suggests adjustments. Returns markdown report.",
    {
      player_max_hp: z.number().int().positive(),
      player_damage_per_attack: z.number().int().positive(),
      attacks_per_second: z.number().positive(),
      enemy_max_hp: z.number().int().positive(),
      enemy_damage_per_attack: z.number().int().positive(),
      enemy_attacks_per_second: z.number().positive(),
      target_time_to_kill_s: z.number().positive().optional().default(3.0),
      target_player_survival_s: z.number().positive().optional().default(15.0),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_tune_combat_balance", config), async (): Promise<ToolResponse> => {
          const playerDps = params.player_damage_per_attack * params.attacks_per_second;
          const enemyDps = params.enemy_damage_per_attack * params.enemy_attacks_per_second;
          const ttkActual = params.enemy_max_hp / playerDps;
          const survivalActual = params.player_max_hp / enemyDps;

          const suggestions: string[] = [];
          if (ttkActual > params.target_time_to_kill_s * 1.3) {
            const targetEnemyHp = Math.round(playerDps * params.target_time_to_kill_s);
            suggestions.push(`Reduce enemy_max_hp from ${params.enemy_max_hp} → ${targetEnemyHp} (current TTK ${ttkActual.toFixed(2)}s > target ${params.target_time_to_kill_s}s).`);
          }
          if (ttkActual < params.target_time_to_kill_s * 0.7) {
            const targetEnemyHp = Math.round(playerDps * params.target_time_to_kill_s);
            suggestions.push(`Increase enemy_max_hp from ${params.enemy_max_hp} → ${targetEnemyHp} (TTK too short).`);
          }
          if (survivalActual < params.target_player_survival_s * 0.7) {
            const targetPlayerHp = Math.round(enemyDps * params.target_player_survival_s);
            suggestions.push(`Increase player_max_hp from ${params.player_max_hp} → ${targetPlayerHp} (player dies in ${survivalActual.toFixed(2)}s, target ${params.target_player_survival_s}s).`);
          }
          if (survivalActual > params.target_player_survival_s * 1.5) {
            suggestions.push(`Player too tanky (${survivalActual.toFixed(2)}s survival). Consider increasing enemy damage.`);
          }

          return createSuccessResponse({
            metrics: {
              player_dps: Math.round(playerDps * 100) / 100,
              enemy_dps: Math.round(enemyDps * 100) / 100,
              time_to_kill_s: Math.round(ttkActual * 100) / 100,
              player_survival_s: Math.round(survivalActual * 100) / 100,
            },
            targets: {
              time_to_kill_s: params.target_time_to_kill_s,
              survival_s: params.target_player_survival_s,
            },
            in_target_range: suggestions.length === 0,
            suggestions,
          }, suggestions.length === 0 ? "Combat balance is within target ranges." : `${suggestions.length} balance issues detected.`);
        })
      )
  );
}
