import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse } from "../godot/protocol.js";
import { indexProject, type ProjectFile } from "../indexer/projectIndexer.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

const MAX_SOURCE_FILES = 400;
const MAX_SOURCE_BYTES = 512_000;

const ProgressionSchema = z.object({
  milestone_distance: z.number().positive().finite().describe("Progress needed to reach the milestone in game units."),
  resource_capacity: z.number().nonnegative().finite().describe("Starting resource available for one attempt."),
  minimum_attempts: z.number().int().positive().optional().describe("Design goal: minimum attempts before this milestone can be reached."),
  strategies: z.array(z.object({
    name: z.string().min(1),
    progress_per_second: z.number().nonnegative().finite(),
    resource_per_second: z.number().positive().finite()
  })).min(1).max(12)
});

const ControlSchema = z.object({
  action: z.string().min(1),
  expected_effect: z.string().min(1).describe("Player-facing effect to verify during playtest.")
});

export type GameQualityOptions = {
  progression?: z.infer<typeof ProgressionSchema>;
  controls?: Array<z.infer<typeof ControlSchema>>;
};

type Evidence = { path: string; line: number; excerpt: string };
type Finding = { id: string; severity: "attention" | "review"; message: string; evidence: Evidence[]; next_step: string };
type Area = { status: "attention" | "review" | "not_verified"; findings: Finding[]; verification: string[] };
type Source = { file: ProjectFile; text: string };

function evidence(source: Source, pattern: RegExp, limit = 2): Evidence[] {
  const hits: Evidence[] = [];
  for (const [index, raw] of source.text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (pattern.test(line)) hits.push({ path: source.file.res_path, line: index + 1, excerpt: line.slice(0, 180) });
    if (hits.length >= limit) break;
  }
  return hits;
}

function firstEvidence(sources: Source[], pattern: RegExp, limit = 3): Evidence[] {
  return sources.flatMap((source) => evidence(source, pattern, 1)).slice(0, limit);
}

function area(findings: Finding[], verification: string[]): Area {
  return {
    status: findings.some((finding) => finding.severity === "attention") ? "attention" : findings.length ? "review" : "not_verified",
    findings,
    verification
  };
}

function scanInputActions(project: string): Set<string> {
  const actions = new Set<string>();
  let inInput = false;
  for (const line of project.split(/\r?\n/)) {
    if (/^\[[^\]]+\]$/.test(line.trim())) {
      inInput = line.trim() === "[input]";
      continue;
    }
    if (inInput) {
      const match = line.match(/^([\w./-]+)\s*=/);
      if (match) actions.add(match[1]);
    }
  }
  return actions;
}

async function sourcesFor(files: ProjectFile[]): Promise<{ sources: Source[]; omitted: number }> {
  const candidates = files.filter((file) => file.kind === "script" || (file.kind === "scene" && file.res_path.endsWith(".tscn")))
    .sort((a, b) => a.res_path.localeCompare(b.res_path));
  const selected = candidates.slice(0, MAX_SOURCE_FILES);
  const sources: Source[] = [];
  for (let i = 0; i < selected.length; i += 32) {
    const batch = await Promise.all(selected.slice(i, i + 32).map(async (file) => {
      if (file.size_bytes > MAX_SOURCE_BYTES) return null;
      const text = await readFile(file.absolute_path, "utf8").catch(() => null);
      return text === null ? null : { file, text };
    }));
    sources.push(...batch.filter((source): source is Source => source !== null));
  }
  return { sources, omitted: candidates.length - sources.length };
}

export async function auditGameQuality(root: string, options: GameQualityOptions = {}) {
  const [indexed, project] = await Promise.all([
    indexProject(root),
    readFile(path.join(root, "project.godot"), "utf8")
  ]);
  const gameFiles = indexed.filter((file) => !file.res_path.startsWith("res://addons/"));
  const { sources, omitted } = await sourcesFor(gameFiles);
  const production = sources.filter((source) => !/^res:\/\/(?:tests?|test_scenes)\//i.test(source.file.res_path));
  const scripts = production.filter((source) => source.file.kind === "script");
  const scenes = production.filter((source) => source.file.kind === "scene");
  const findings: Record<"progression" | "controls" | "presentation" | "ui" | "persistence", Finding[]> = {
    progression: [], controls: [], presentation: [], ui: [], persistence: []
  };

  const progressionResults = options.progression?.strategies.map((strategy) => {
    const duration_seconds = options.progression!.milestone_distance / strategy.progress_per_second;
    const resource_required = duration_seconds * strategy.resource_per_second;
    return {
      name: strategy.name,
      duration_seconds: Number.isFinite(duration_seconds) ? duration_seconds : null,
      resource_required: Number.isFinite(resource_required) ? resource_required : null,
      reachable_in_one_attempt: resource_required <= options.progression!.resource_capacity
    };
  }) ?? [];
  if (options.progression?.minimum_attempts && options.progression.minimum_attempts > 1) {
    const early = progressionResults.filter((result) => result.reachable_in_one_attempt);
    if (early.length) findings.progression.push({
      id: "milestone_reachable_early", severity: "attention",
      message: `The supplied linear model reaches the milestone in one attempt via ${early.map((result) => result.name).join(", ")}, below the ${options.progression.minimum_attempts}-attempt goal.`,
      evidence: [],
      next_step: "Check the real movement and resource formulas, then simulate the fastest legitimate route and upgrade states in Godot."
    });
  }

  const inputActions = scanInputActions(project);
  const builtInActions = new Set(["ui_accept", "ui_select", "ui_cancel", "ui_focus_next", "ui_focus_prev", "ui_left", "ui_right", "ui_up", "ui_down", "ui_page_up", "ui_page_down", "ui_home", "ui_end"]);
  const controls = (options.controls ?? []).map((control) => {
    const configured = inputActions.has(control.action) || builtInActions.has(control.action);
    const usage = scripts.flatMap((source) => evidence(source, /Input\.|InputEvent|_input\(/, 20))
      .filter((hit) => hit.excerpt.includes(control.action)).slice(0, 3);
    if (!configured) findings.controls.push({
      id: "input_action_missing", severity: "attention",
      message: `Input action '${control.action}' is not declared in project.godot.` ,
      evidence: [], next_step: `Add and bind '${control.action}' in InputMap, then test: ${control.expected_effect}`
    });
    return { ...control, configured, observed_script_use: usage };
  });

  const imageAssets = gameFiles.filter((file) => /\.(png|jpe?g|webp|svg)$/i.test(file.res_path));
  const audioAssets = gameFiles.filter((file) => /\.(ogg|wav|mp3)$/i.test(file.res_path));
  const drawEvidence = firstEvidence(scripts, /func _draw\(|draw_(circle|line|rect|texture|polygon)\(/);
  if (imageAssets.length === 0 && drawEvidence.length) findings.presentation.push({
    id: "procedural_only_art", severity: "review",
    message: "Visuals appear to be drawn procedurally, with no image assets in the game files. Review their readability and identity in play.",
    evidence: drawEvidence,
    next_step: "Capture menu, gameplay and result screens; compare hierarchy, silhouette, color and feedback against the art direction."
  });
  if (imageAssets.length > 0 && drawEvidence.length > 1) findings.presentation.push({
    id: "mixed_art_pipeline", severity: "review",
    message: "The game mixes authored image assets with multiple procedural draw scripts. Check whether gameplay, menus and results share a coherent visual language.",
    evidence: drawEvidence,
    next_step: "Compare screenshots from the main menu, active gameplay and result screen; verify sprites, shapes, animation and feedback against one art direction."
  });
  if (audioAssets.length === 0) findings.presentation.push({
    id: "no_audio_assets", severity: "review", message: "No audio assets were indexed in the game files.", evidence: [],
    next_step: "Playtest actions and rewards for audible feedback if the design calls for sound."
  });

  const codeUi = scripts.filter((source) => /\b(?:Control|Label|Button|PanelContainer|TextureRect|ProgressBar)\.new\(/.test(source.text));
  const fixedUi = codeUi.filter((source) => /\.(?:position|size|offset_(?:left|right|top|bottom))\s*=\s*(?:Vector2\(|\d)/.test(source.text));
  const uiScenes = scenes.filter((source) => /\[node [^\]]*type="(?:Control|CanvasLayer|MarginContainer|VBoxContainer|HBoxContainer|PanelContainer|CenterContainer|GridContainer)"/.test(source.text));
  if (fixedUi.length) findings.ui.push({
    id: "fixed_code_ui", severity: "attention",
    message: `${fixedUi.length} script(s) create controls and assign fixed pixel positions or sizes. This may hinder editor authoring and multiple resolutions.`,
    evidence: firstEvidence(fixedUi, /\.(?:position|size|offset_(?:left|right|top|bottom))\s*=\s*(?:Vector2\(|\d)/),
    next_step: "Move stable layout into a .tscn with Containers or anchors; keep scripts for data binding and interaction. Verify at multiple aspect ratios."
  });

  const saveScripts = scripts.filter((source) => /(?:FileAccess\.open|ResourceSaver\.save|ConfigFile\.save)/.test(source.text) &&
    (source.text.includes("user://") || /(?:save|persist)/i.test(path.basename(source.file.res_path))));
  const saveText = saveScripts.map((source) => source.text.replace(/^\s*#.*$/gm, "")).join("\n");
  const saveRelatedScripts = scripts.filter((source) => saveScripts.includes(source) || /(?:save|persist|migration)/i.test(path.basename(source.file.res_path)));
  const versionEvidence = firstEvidence(saveRelatedScripts, /schema_version|CURRENT_VERSION|SAVE_VERSION/);
  if (saveScripts.length && !versionEvidence.length) findings.persistence.push({
    id: "unversioned_save", severity: "attention", message: "Save code was found without an explicit schema version.",
    evidence: firstEvidence(saveScripts, /FileAccess\.open|ResourceSaver\.save|ConfigFile\.save/),
    next_step: "Add a schema version and migration path; test loading an older and a future version."
  });
  if (saveScripts.length && !/(?:\.tmp|\.pending|TEMP_PATH|temporary_path)/i.test(saveText)) findings.persistence.push({
    id: "direct_save_write", severity: "attention", message: "Save code does not show a temporary file before replacing the primary save.",
    evidence: firstEvidence(saveScripts, /FileAccess\.open|ResourceSaver\.save|ConfigFile\.save/),
    next_step: "Write and validate a temporary save, then replace the primary file; test interrupted and corrupt writes."
  });
  if (saveScripts.length && !/(?:\.bak|backup|BACKUP_PATH)/i.test(saveText)) findings.persistence.push({
    id: "save_without_backup", severity: "review", message: "No backup or recovery path was found near save writes.",
    evidence: firstEvidence(saveScripts, /FileAccess\.open|ResourceSaver\.save|ConfigFile\.save/),
    next_step: "Keep the last valid save as a backup and test recovery after corrupting the primary file."
  });
  const hasGit = await access(path.join(root, ".git")).then(() => true, () => false);
  if (!hasGit) findings.persistence.push({
    id: "no_git_repository", severity: "review", message: "The game project is not a Git repository.", evidence: [],
    next_step: "Initialize version control when the creator is ready; ignore .godot, user data and generated files."
  });

  return {
    scan: { source_files: sources.length, omitted_source_files: omitted, complete: omitted === 0, addon_files_excluded: indexed.length - gameFiles.length },
    progression: {
      ...area(findings.progression, ["Supply real fastest-route rates and resource capacity, including upgrades and hazards.", "Run a timed gameplay scenario for the first and target milestone."]),
      model: options.progression ?? null,
      strategy_results: progressionResults,
      model_limit: "Linear, constant-rate estimate only; acceleration, hazards, pickups and upgrades need runtime verification."
    },
    controls: {
      ...area(findings.controls, ["Use godot_run_test_scenario or input simulation to verify each expected effect, reverse direction, return/cancel and feedback." ]),
      contract: controls
    },
    presentation: {
      ...area(findings.presentation, ["Capture representative menu, gameplay and result screenshots; assess visual consistency and feedback with a human." ]),
      image_assets: imageAssets.length, audio_assets: audioAssets.length, procedural_draw_evidence: drawEvidence
    },
    ui: {
      ...area(findings.ui, ["Inspect HUD layout in the editor and test at narrow, wide and target resolutions; verify focus and contrast." ]),
      authored_ui_scenes: uiScenes.map((source) => source.file.res_path).slice(0, 24),
      code_built_ui_scripts: codeUi.map((source) => source.file.res_path).slice(0, 24)
    },
    persistence: {
      ...area(findings.persistence, ["Round-trip a save, load an older schema, corrupt the primary file and verify recovery; check the project under version control." ]),
      save_scripts: saveScripts.map((source) => source.file.res_path).slice(0, 24),
      has_git: hasGit
    },
    summary: {
      attention: Object.values(findings).flat().filter((finding) => finding.severity === "attention").length,
      review: Object.values(findings).flat().filter((finding) => finding.severity === "review").length,
      caveat: `${omitted ? `${omitted} oversized or excess source files were not scanned. ` : ""}Static evidence and the optional linear budget do not prove game feel, accessibility, visuals or save recovery. Run focused playtests.`
    }
  };
}

export function registerGameQualityTools(server: McpServer, config: ServerConfig): void {
  server.registerTool("devpilot_game_quality_audit", {
    description: "Audit five game-production risks: progression budget, controls, visual/audio evidence, editable responsive UI, and save/version-control maintenance. Optional numeric and input contracts make findings specific. Read-only and works without a connected Godot editor.",
    inputSchema: { progression: ProgressionSchema.optional(), controls: z.array(ControlSchema).max(24).optional() },
    annotations: { readOnlyHint: true }
  }, async (options): Promise<CallToolResult> => {
    const response = await executeToolSafely(
      { toolName: "devpilot_game_quality_audit", readOnly: config.security.readOnly, projectRoot: config.projectRoot },
      async () => createSuccessResponse(await auditGameQuality(config.projectRoot, options), "Game quality audit generated.")
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], isError: !response.ok };
  });
}
