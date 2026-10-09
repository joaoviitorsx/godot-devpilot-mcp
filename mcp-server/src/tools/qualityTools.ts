import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";
import { recordBlueprintApplied, recordScript, readManifest } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function writeIfNew(projectRoot: string, resPath: string, content: string, isGd: boolean, overwrite: boolean): Promise<boolean> {
  const r = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return false;
  await mkdir(path.dirname(r.absolutePath), { recursive: true });
  await writeFile(r.absolutePath, isGd ? autoFixGDScript(content) : content, "utf8");
  return true;
}

const ParamsSchema = {
  script_dir: z.string().optional().default("res://scripts"),
  overwrite: z.boolean().optional().default(false),
};

// ── save_schema ──────────────────────────────────────────────────────────────

const SAVE_DATA_RESOURCE = `extends Resource
class_name SaveData

@export var schema_version: int = 1
@export var player_name: String = ""
@export var current_level: String = ""
@export var play_time_seconds: int = 0
@export var stats: Dictionary = {}
@export var inventory: Array = []
@export var quests: Dictionary = {}
@export var flags: Dictionary = {}
`;

const SAVE_MANAGER = `extends Node
# Resource-based save system. Stores SaveData (.tres) at user://save_<slot>.tres.

const SAVE_DIR := "user://"

signal save_completed(slot: int)
signal load_completed(slot: int, data)
signal save_failed(reason: String)

func save(data: SaveData, slot: int = 1) -> bool:
	if data == null:
		save_failed.emit("null SaveData")
		return false
	var p := "%ssave_%d.tres" % [SAVE_DIR, slot]
	var err := ResourceSaver.save(data, p)
	if err == OK:
		save_completed.emit(slot)
		return true
	save_failed.emit("ResourceSaver error: %d" % err)
	return false

func load_slot(slot: int = 1) -> SaveData:
	var p := "%ssave_%d.tres" % [SAVE_DIR, slot]
	if not FileAccess.file_exists(p):
		return null
	var res := ResourceLoader.load(p)
	if res is SaveData:
		load_completed.emit(slot, res)
		return res
	return null

func has_slot(slot: int = 1) -> bool:
	return FileAccess.file_exists("%ssave_%d.tres" % [SAVE_DIR, slot])

func delete_slot(slot: int = 1) -> bool:
	var p := "%ssave_%d.tres" % [SAVE_DIR, slot]
	if FileAccess.file_exists(p):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(p))
		return true
	return false
`;

// ── localization ─────────────────────────────────────────────────────────────

const TRANSLATIONS_CSV = `keys,en,pt
ui.play,Play,Jogar
ui.quit,Quit,Sair
ui.settings,Settings,Configurações
ui.continue,Continue,Continuar
ui.restart,Restart,Reiniciar
hud.score,Score,Pontuação
hud.coins,Coins,Moedas
hud.lives,Lives,Vidas
msg.game_over,Game Over,Fim de Jogo
msg.victory,Victory!,Vitória!
`;

const LOCALE_MANAGER = `extends Node
# Locale switcher. Wraps TranslationServer with helpers + signal.
# Add translations.csv to Project Settings → Localization → Translations.

signal locale_changed(locale: String)

@export var available_locales: Array = ["en", "pt"]
@export var default_locale: String = "en"

func _ready() -> void:
	if TranslationServer.get_locale() == "":
		TranslationServer.set_locale(default_locale)

func set_locale(locale: String) -> void:
	if locale not in available_locales:
		return
	TranslationServer.set_locale(locale)
	locale_changed.emit(locale)

func current_locale() -> String:
	return TranslationServer.get_locale()

func t(key: String) -> String:
	return tr(key)
`;

// ── headless run ─────────────────────────────────────────────────────────────

function runGodotHeadless(godotBin: string, projectRoot: string, quitAfter: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(godotBin, [
      "--headless",
      "--path", projectRoot,
      `--quit-after`, String(quitAfter),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    child.on("error", () => resolve({ stdout, stderr: stderr + "\n[spawn error]", code: -1 }));
  });
}

// ── perf budget ──────────────────────────────────────────────────────────────

async function scanScenes(projectRoot: string): Promise<{ total: number; per_kind: Record<string, number>; warnings: string[] }> {
  const scenesDir = path.join(projectRoot, "scenes");
  const warnings: string[] = [];
  const per_kind: Record<string, number> = {};
  let total = 0;
  async function walk(dir: string): Promise<void> {
    if (!(await fileExists(dir))) return;
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".tscn")) {
        total++;
        try {
          const content = await readFile(p, "utf8");
          const node_count = (content.match(/^\[node /gm) ?? []).length;
          const scriptRefs = (content.match(/^\[ext_resource type="Script"/gm) ?? []).length;
          if (node_count > 200) warnings.push(`${p}: ${node_count} nodes (consider splitting)`);
          if (scriptRefs > 30) warnings.push(`${p}: ${scriptRefs} scripts (high coupling)`);
          for (const m of content.matchAll(/^\[node[^\]]*type="(\w+)"/gm)) {
            const kind = m[1];
            per_kind[kind] = (per_kind[kind] ?? 0) + 1;
          }
        } catch { /* ignore */ }
      }
    }
  }
  await walk(scenesDir);
  if (per_kind.CharacterBody2D > 50) warnings.push(`>50 CharacterBody2D in project — consider pooling enemies`);
  if (per_kind.AnimationPlayer > 30) warnings.push(`>30 AnimationPlayer instances — review whether AnimationTree could share`);
  return { total, per_kind, warnings };
}

// ── tests scaffold ───────────────────────────────────────────────────────────

const GUT_TEST_TEMPLATE = (blueprint: string, scriptPath: string) => `extends GutTest
# Test scaffold for ${blueprint}. Customize asserts based on your project.

const Subject := preload("${scriptPath}")

func before_each() -> void:
	pass

func test_subject_loads() -> void:
	var instance = Subject.new()
	assert_not_null(instance, "${blueprint} script loads")
`;

// ── Tool registration ────────────────────────────────────────────────────────

export function registerQualityTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_blueprint_save_schema",
    "Resource-based save system: SaveData class + SaveManager autoload (save/load/delete .tres slots in user://). Type-safe, signals on completion/failure.",
    ParamsSchema,
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_save_schema", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const dp = `${params.script_dir}/SaveData.gd`;
          const mp = `${params.script_dir}/SaveManager.gd`;
          await writeIfNew(config.projectRoot, dp, SAVE_DATA_RESOURCE, true, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, mp, SAVE_MANAGER, true, params.overwrite);
          if (w2) await recordScript(config.projectRoot, mp, { signals: ["save_completed", "load_completed", "save_failed"] });
          await recordBlueprintApplied(config.projectRoot, "save_schema");
          return createSuccessResponse({ files: [dp, mp], next_steps: [`devpilot_add_autoload name=SaveManager path=${mp}`] }, "save_schema applied.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_localization",
    "Localization scaffold: translations.csv (en/pt seed) + LocaleManager autoload (set_locale/current_locale/t). Add translations.csv to Project Settings → Localization → Translations.",
    {
      ...ParamsSchema,
      csv_path: z.string().optional().default("res://translations.csv"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_localization", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const csv = params.csv_path;
          const mp = `${params.script_dir}/LocaleManager.gd`;
          const w1 = await writeIfNew(config.projectRoot, csv, TRANSLATIONS_CSV, false, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, mp, LOCALE_MANAGER, true, params.overwrite);
          if (w2) await recordScript(config.projectRoot, mp, { signals: ["locale_changed"] });
          await recordBlueprintApplied(config.projectRoot, "localization");
          return createSuccessResponse({ files: [csv, mp], next_steps: [`devpilot_add_autoload name=LocaleManager path=${mp}`, `Add ${csv} in Project Settings → Localization → Translations`] }, "localization applied.");
        })
      )
  );

  server.tool(
    "devpilot_run_headless",
    "Run the project headless via Godot CLI for N seconds, capture stdout+stderr. Useful for CI / capturing real runtime errors outside the editor.",
    {
      seconds: z.number().int().positive().max(60).optional().default(5),
      godot_bin: z.string().optional().default("godot").describe("Path to godot binary. Default: 'godot' (PATH lookup)."),
    },
    async ({ seconds, godot_bin }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_run_headless", config), async (): Promise<ToolResponse> => {
          try {
            const r = await runGodotHeadless(godot_bin, config.projectRoot, seconds);
            const errorLines = r.stderr.split("\n").filter((l) => /error|ERROR/.test(l)).length;
            return createSuccessResponse(
              {
                exit_code: r.code,
                stdout: r.stdout.slice(-10_000),
                stderr: r.stderr.slice(-10_000),
                error_line_count: errorLines,
              },
              `Headless run complete (code=${r.code}, ${errorLines} error line(s) detected).`
            );
          } catch (e) {
            return createErrorResponse("HEADLESS_RUN_FAILED", (e as Error).message, {}, ["Ensure 'godot' is in PATH or pass godot_bin explicitly."]);
          }
        })
      )
  );

  server.tool(
    "devpilot_performance_budget",
    "Static performance scan over scenes/. Counts node types, flags large scenes, suggests pooling thresholds. Read-only — no mutations.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_performance_budget", config), async (): Promise<ToolResponse> => {
          const r = await scanScenes(config.projectRoot);
          return createSuccessResponse({ total_scenes: r.total, node_types: r.per_kind, warnings: r.warnings }, `Scanned ${r.total} scene(s); ${r.warnings.length} warning(s).`);
        })
      )
  );

  server.tool(
    "devpilot_generate_tests",
    "Scaffold GUT-style test files for blueprints recorded in the manifest. Writes minimal `extends GutTest` skeletons to res://tests/.",
    {
      tests_dir: z.string().optional().default("res://tests"),
      overwrite: z.boolean().optional().default(false),
    },
    async ({ tests_dir, overwrite }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_generate_tests", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const m = await readManifest(config.projectRoot);
          const written: string[] = [];
          for (const [scriptPath] of Object.entries(m.scripts)) {
            const base = path.basename(scriptPath, ".gd");
            const testPath = `${tests_dir}/test_${base}.gd`;
            const ok = await writeIfNew(config.projectRoot, testPath, GUT_TEST_TEMPLATE(base, scriptPath), true, overwrite);
            if (ok) written.push(testPath);
          }
          return createSuccessResponse({ written }, `${written.length} test(s) scaffolded.`);
        })
      )
  );
}

export const QUALITY_BLUEPRINT_REGISTRY = [
  { name: "save_schema", description: "Resource-based save (SaveData + SaveManager)", category: "infra", files_created: ["scripts/SaveData.gd", "scripts/SaveManager.gd"], params_schema: {}, example: {} },
  { name: "localization", description: "translations.csv + LocaleManager autoload", category: "infra", files_created: ["translations.csv", "scripts/LocaleManager.gd"], params_schema: {}, example: {} },
];
