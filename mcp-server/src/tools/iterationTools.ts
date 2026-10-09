import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readdir, readFile, writeFile, cp, rm, access, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { readManifest } from "./manifestTools.js";
import { BLUEPRINT_REGISTRY } from "./blueprintLibraryTools.js";
import { BLUEPRINT_3D_REGISTRY } from "./blueprintLibrary3DTools.js";
import { BLUEPRINT_RPG_REGISTRY } from "./blueprintLibraryRPGTools.js";
import { BLUEPRINT_AV_REGISTRY } from "./blueprintLibraryAVTools.js";
import { TILEMAP_DUNGEON_REGISTRY } from "./tilemapAndDungeonTools.js";

const ALL_BLUEPRINTS = [
  ...BLUEPRINT_REGISTRY,
  ...BLUEPRINT_3D_REGISTRY,
  ...BLUEPRINT_RPG_REGISTRY,
  ...BLUEPRINT_AV_REGISTRY,
  ...TILEMAP_DUNGEON_REGISTRY,
];

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const SNAPSHOT_BASE = ".devpilot/snapshots";
const SNAPSHOT_DIRS = ["scenes", "scripts", ".devpilot/manifest.json", "project.godot"];

// ── Snapshot / rollback ──────────────────────────────────────────────────────

export function registerSnapshotTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_snapshot_project",
    "Snapshot the current project (scenes/, scripts/, project.godot, manifest) into .devpilot/snapshots/<id>/. Use before risky refactors.",
    {
      label: z.string().optional().describe("Free-text label for the snapshot. Defaults to ISO timestamp."),
    },
    async ({ label }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_snapshot_project", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const id = (label ?? new Date().toISOString().replace(/[:.]/g, "-")).replace(/[^A-Za-z0-9_\-.]/g, "_");
          const dest = path.join(config.projectRoot, SNAPSHOT_BASE, id);
          await mkdir(dest, { recursive: true });
          const copied: string[] = [];
          for (const sub of SNAPSHOT_DIRS) {
            const src = path.join(config.projectRoot, sub);
            if (!(await fileExists(src))) continue;
            const dst = path.join(dest, sub);
            await mkdir(path.dirname(dst), { recursive: true });
            try {
              const st = await stat(src);
              if (st.isDirectory()) await cp(src, dst, { recursive: true });
              else {
                const data = await readFile(src);
                await writeFile(dst, data);
              }
              copied.push(sub);
            } catch (e) {
              /* ignore individual copy errors */
            }
          }
          await writeFile(
            path.join(dest, "snapshot.json"),
            JSON.stringify({ id, label: label ?? null, created_at: new Date().toISOString(), copied }, null, 2),
            "utf8",
          );
          return createSuccessResponse({ id, dest_path: dest, copied }, `Snapshot '${id}' created.`);
        })
      )
  );

  server.tool(
    "devpilot_list_snapshots",
    "List existing snapshots in .devpilot/snapshots/ with creation time + label.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_list_snapshots", config), async (): Promise<ToolResponse> => {
          const base = path.join(config.projectRoot, SNAPSHOT_BASE);
          if (!(await fileExists(base))) return createSuccessResponse({ snapshots: [] }, "No snapshots yet.");
          const entries = await readdir(base, { withFileTypes: true });
          const snapshots: Array<{ id: string; created_at?: string; label?: string }> = [];
          for (const e of entries) {
            if (!e.isDirectory()) continue;
            const meta = path.join(base, e.name, "snapshot.json");
            if (!(await fileExists(meta))) {
              snapshots.push({ id: e.name });
              continue;
            }
            try {
              const json = JSON.parse(await readFile(meta, "utf8"));
              snapshots.push({ id: e.name, created_at: json.created_at, label: json.label });
            } catch {
              snapshots.push({ id: e.name });
            }
          }
          snapshots.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
          return createSuccessResponse({ snapshots, count: snapshots.length }, `${snapshots.length} snapshot(s).`);
        })
      )
  );

  server.tool(
    "devpilot_rollback_to_snapshot",
    "Restore project from a snapshot. Replaces current scenes/, scripts/, project.godot, manifest with the snapshot's copies. Destructive — pass confirm=true.",
    {
      id: z.string(),
      confirm: z.boolean().describe("Must be true to apply rollback (destructive)."),
    },
    async ({ id, confirm }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_rollback_to_snapshot", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          if (!confirm) return createErrorResponse("CONFIRM_REQUIRED", "Pass confirm=true to apply rollback.", { id }, []);
          const src = path.join(config.projectRoot, SNAPSHOT_BASE, id);
          if (!(await fileExists(src))) return createErrorResponse("SNAPSHOT_NOT_FOUND", `Snapshot ${id} not found.`, {}, []);
          const restored: string[] = [];
          for (const sub of SNAPSHOT_DIRS) {
            const s = path.join(src, sub);
            if (!(await fileExists(s))) continue;
            const d = path.join(config.projectRoot, sub);
            try {
              const st = await stat(s);
              if (st.isDirectory()) {
                if (await fileExists(d)) await rm(d, { recursive: true, force: true });
                await cp(s, d, { recursive: true });
              } else {
                const data = await readFile(s);
                await mkdir(path.dirname(d), { recursive: true });
                await writeFile(d, data);
              }
              restored.push(sub);
            } catch {
              /* ignore */
            }
          }
          return createSuccessResponse({ id, restored }, `Rolled back to '${id}'.`);
        })
      )
  );
}

// ── explain_project ──────────────────────────────────────────────────────────

async function readProjectGodotSections(projectRoot: string): Promise<Record<string, Record<string, string>>> {
  const file = path.join(projectRoot, "project.godot");
  if (!(await fileExists(file))) return {};
  const content = await readFile(file, "utf8");
  const sections: Record<string, Record<string, string>> = {};
  let current = "_root";
  sections[current] = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      current = sec[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    sections[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

export function registerExplainProjectTool(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_explain_project",
    "Generate a Markdown summary of the current project: autoloads, main scene, blueprints applied, signals graph (from manifest), input actions, file counts. Useful as context for the LLM in subsequent turns.",
    {
      persist_to: z.string().optional().describe("Optional res:// path to write the markdown. Defaults to .devpilot/project_overview.md."),
    },
    async ({ persist_to }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_explain_project", config), async (): Promise<ToolResponse> => {
          const m = await readManifest(config.projectRoot);
          const sections = await readProjectGodotSections(config.projectRoot);
          const main_scene = (sections.application?.["run/main_scene"] ?? "(unset)").replace(/"/g, "");
          const config_name = (sections.application?.["config/name"] ?? "(unnamed)").replace(/"/g, "");
          const inputs = Object.keys(sections.input ?? {});
          const autoloads = Object.entries(sections.autoload ?? {}).map(([n, p]) => `- **${n}** → \`${p.replace(/"/g, "")}\``);

          const blueprintLines = m.blueprints_applied.map(
            (b) => `- ${b.name}${b.params ? ` (${JSON.stringify(b.params)})` : ""} — _${b.at}_`
          );
          const sceneLines = Object.entries(m.scenes).map(([p, info]) => `- \`${p}\` (${info.kind})`);
          const scriptLines = Object.entries(m.scripts).map(([p, info]) => {
            const sigs = info.signals && info.signals.length > 0 ? `signals: ${info.signals.join(", ")}` : "";
            return `- \`${p}\`${sigs ? " — " + sigs : ""}`;
          });
          const signalLines = Object.entries(m.signals_map).map(([sig, emitters]) => `- **${sig}** ← ${emitters.join(", ")}`);

          const md = [
            `# Project: ${config_name}`,
            "",
            `_Generated: ${new Date().toISOString()}_`,
            "",
            "## Run config",
            `- main_scene: \`${main_scene}\``,
            `- input actions: ${inputs.length} (${inputs.slice(0, 8).join(", ")}${inputs.length > 8 ? "…" : ""})`,
            "",
            "## Autoloads",
            autoloads.length > 0 ? autoloads.join("\n") : "_(none)_",
            "",
            "## Blueprints applied",
            blueprintLines.length > 0 ? blueprintLines.join("\n") : "_(none — try devpilot_list_blueprints)_",
            "",
            `## Scenes (${sceneLines.length})`,
            sceneLines.length > 0 ? sceneLines.join("\n") : "_(no scenes recorded in manifest)_",
            "",
            `## Scripts (${scriptLines.length})`,
            scriptLines.length > 0 ? scriptLines.join("\n") : "_(no scripts recorded in manifest)_",
            "",
            "## Signals graph",
            signalLines.length > 0 ? signalLines.join("\n") : "_(no signals recorded)_",
            "",
            "## Notes",
            m.notes.length > 0 ? m.notes.map((n) => `- ${n}`).join("\n") : "_(none)_",
          ].join("\n");

          let written: string | null = null;
          if (!config.security.readOnly) {
            const target = (persist_to ?? "res://.devpilot/project_overview.md").replace(/^res:\/\//, "");
            const abs = path.join(config.projectRoot, target);
            await mkdir(path.dirname(abs), { recursive: true });
            await writeFile(abs, md, "utf8");
            written = `res://${target}`;
          }
          return createSuccessResponse({ markdown: md, written_path: written }, "Project overview generated.");
        })
      )
  );
}

// ── recommend_blueprints ─────────────────────────────────────────────────────

const KEYWORD_RECS: Array<{ pattern: RegExp; recommend: string[]; presets?: Array<[string, string]> }> = [
  { pattern: /\b(twin.?stick|bullet.?hell|gungeon)/i, recommend: ["projectile_system", "twin_stick", "shop_item", "chest", "pickup", "dungeon_room", "boss_arena"], presets: [["input_map", "twin_stick"], ["physics_layers", "shooter"], ["hud", "shooter"]] },
  { pattern: /\b(dungeon.?crawler|zelda|top.?down)/i, recommend: ["projectile_system", "twin_stick", "dungeon_room", "chest", "pickup", "shop_item"], presets: [["input_map", "twin_stick"], ["physics_layers", "shooter"], ["hud", "shooter"]] },
  { pattern: /\b(rpg|quest|dialogue|inventory|loot)/i, recommend: ["dialogue_system", "quest_system", "inventory_grid", "loot_table"], presets: [["input_map", "topdown"], ["physics_layers", "topdown_rpg"], ["hud", "rpg"]] },
  { pattern: /\b(survivor|horde|wave)/i, recommend: ["projectile_system", "twin_stick", "pickup"], presets: [["input_map", "twin_stick"], ["physics_layers", "shooter"], ["hud", "survivor"]] },
  { pattern: /\b(platformer|jump|mario|celeste)/i, recommend: [], presets: [["input_map", "platformer"], ["physics_layers", "platformer"], ["hud", "shooter"]] },
  { pattern: /\b(fps|first.?person|3d.?shooter)/i, recommend: ["player_3d", "enemy_3d", "projectile_3d", "dungeon_room_3d"], presets: [["input_map", "fps_3d"], ["physics_layers", "shooter_3d"], ["hud", "fps_3d"]] },
  { pattern: /\b(third.?person|3rd.?person|action.?adventure)/i, recommend: ["player_3d", "enemy_3d", "dungeon_room_3d"], presets: [["input_map", "fps_3d"], ["physics_layers", "shooter_3d"]] },
  { pattern: /\b(rts|strategy|unit selection)/i, recommend: ["rts_unit"] },
  { pattern: /\b(physics puzzle|joints|rigid)/i, recommend: ["physics_puzzle"] },
  { pattern: /\b(sound|music|audio)/i, recommend: ["audio_bus"] },
  { pattern: /\b(animation|state machine)/i, recommend: ["animation_state_machine"] },
  { pattern: /\b(procedural|dungeon gen|bsp|random level)/i, recommend: ["procedural_dungeon", "tilemap"] },
  { pattern: /\b(save|persist|salvar progresso)/i, recommend: ["save_schema"] },
  { pattern: /\b(localization|idioma|locale|i18n)/i, recommend: ["localization"] },
];

export function registerRecommendBlueprintsTool(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_recommend_blueprints",
    "Given a free-text prompt, return a recommended sequence of blueprints + presets to apply. Pure planning — no side-effects. LLM should review then call individual blueprint/preset tools.",
    {
      prompt: z.string().min(1),
    },
    async ({ prompt }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_recommend_blueprints", config), async (): Promise<ToolResponse> => {
          const blueprintsSet = new Set<string>();
          const presets: Array<[string, string]> = [];
          for (const rule of KEYWORD_RECS) {
            if (rule.pattern.test(prompt)) {
              for (const b of rule.recommend) blueprintsSet.add(b);
              if (rule.presets) {
                for (const p of rule.presets) {
                  if (!presets.some(([c, n]) => c === p[0] && n === p[1])) presets.push(p);
                }
              }
            }
          }
          const blueprints = Array.from(blueprintsSet);
          const order = ["audio_bus", "projectile_system", "twin_stick", "player_3d", "enemy_3d", "projectile_3d", "dungeon_room_3d", "dungeon_room", "boss_arena", "chest", "shop_item", "pickup", "dialogue_system", "quest_system", "inventory_grid", "loot_table", "procedural_dungeon", "tilemap", "animation_state_machine", "rts_unit", "physics_puzzle", "save_schema", "localization"];
          blueprints.sort((a, b) => (order.indexOf(a) - order.indexOf(b)) || a.localeCompare(b));
          const callPlan: Array<{ tool: string; args?: Record<string, unknown> }> = [];
          for (const [cat, name] of presets) callPlan.push({ tool: "devpilot_apply_preset", args: { category: cat, name } });
          for (const b of blueprints) callPlan.push({ tool: `devpilot_blueprint_${b}` });
          return createSuccessResponse(
            {
              prompt,
              blueprints,
              presets,
              call_plan: callPlan,
              available_blueprints: ALL_BLUEPRINTS.map((b) => b.name),
            },
            `${blueprints.length} blueprint(s) + ${presets.length} preset(s) recommended.`
          );
        })
      )
  );
}

// ── auto_wire_signals (advisory) ─────────────────────────────────────────────

export function registerAutoWireSignalsTool(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_auto_wire_signals",
    "Scan manifest signals_map + script files; suggest signal connections for emitter/listener pairs. Outputs GDScript snippet ready to paste into a manager (no automatic editor mutation).",
    {
      target_script: z.string().optional().describe("res:// path of the script that should subscribe (e.g. GameManager). Generates connect() calls inside its _ready()."),
    },
    async ({ target_script }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_auto_wire_signals", config), async (): Promise<ToolResponse> => {
          const m = await readManifest(config.projectRoot);
          const lines: string[] = [];
          for (const [signal, emitters] of Object.entries(m.signals_map)) {
            for (const emitter of emitters) {
              const handler = `_on_${signal}`;
              lines.push(`# from ${emitter}\n# (assumes the emitter is reachable; adapt path)\n# get_node(<emitter>).${signal}.connect(${handler})`);
            }
          }
          const snippet = lines.length > 0
            ? `func _ready() -> void:\n${lines.map((l) => l.split("\n").map((x) => "\t" + x).join("\n")).join("\n")}\n`
            : `func _ready() -> void:\n\tpass  # No signals recorded in manifest yet.\n`;
          return createSuccessResponse(
            { target_script: target_script ?? null, gdscript_snippet: snippet, signals_count: Object.keys(m.signals_map).length },
            "Wire suggestions generated — paste into your manager script and adjust paths."
          );
        })
      )
  );
}
