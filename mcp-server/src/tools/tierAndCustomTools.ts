import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";
import { serializeSceneToTscn, type SceneSpec } from "../utils/sceneSerializer.js";
import { recordBlueprintApplied, recordScene, recordScript, readManifest } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// ── Tool tiers ───────────────────────────────────────────────────────────────

const CORE_TOOLS = [
  "devpilot_help",
  "devpilot_init_wizard",
  "devpilot_game",
  "devpilot_list_archetypes",
  "devpilot_create_project_archetype",
  "devpilot_list_blueprints",
  "devpilot_describe_blueprint",
  "devpilot_list_presets",
  "devpilot_apply_preset",
  "devpilot_recommend_blueprints",
  "devpilot_explain_project",
  "devpilot_define_scene",
  "devpilot_compose_main_scene",
  "devpilot_manifest_get",
  "devpilot_verify_spec",
  "devpilot_auto_fix_parse_errors",
  "devpilot_snapshot_project",
  "devpilot_rollback_to_snapshot",
  "devpilot_list_snapshots",
  "devpilot_apply_refinement",
  "devpilot_check_blueprint_dependencies",
  "devpilot_run_headless",
  "devpilot_signal_graph",
  "devpilot_tutorial",
];

// ── Custom blueprint loader ──────────────────────────────────────────────────

const CustomBlueprintSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  scripts: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
  scenes: z.array(z.unknown()).optional(),
});

type CustomBlueprint = z.infer<typeof CustomBlueprintSchema>;

const CUSTOM_DIR_REL = ".devpilot/custom_blueprints";

async function listCustomBlueprints(projectRoot: string): Promise<CustomBlueprint[]> {
  const dir = path.join(projectRoot, CUSTOM_DIR_REL);
  if (!(await fileExists(dir))) return [];
  const entries = await readdir(dir);
  const out: CustomBlueprint[] = [];
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(dir, f), "utf8");
      const parsed = CustomBlueprintSchema.parse(JSON.parse(raw));
      out.push(parsed);
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

async function applyCustomBlueprint(projectRoot: string, bp: CustomBlueprint, overwrite: boolean): Promise<{ files: string[]; errors: string[] }> {
  const files: string[] = [];
  const errors: string[] = [];
  for (const s of bp.scripts ?? []) {
    try {
      const r = resolveProjectPath(s.path, projectRoot);
      if (await fileExists(r.absolutePath) && !overwrite) {
        errors.push(`${s.path}: exists (overwrite=false)`);
        continue;
      }
      await mkdir(path.dirname(r.absolutePath), { recursive: true });
      await writeFile(r.absolutePath, autoFixGDScript(s.content), "utf8");
      files.push(s.path);
      await recordScript(projectRoot, s.path, {});
    } catch (e) {
      errors.push(`${s.path}: ${(e as Error).message}`);
    }
  }
  for (const sc of bp.scenes ?? []) {
    try {
      const spec = sc as SceneSpec;
      if (typeof spec.path !== "string") {
        errors.push(`scene missing 'path'`);
        continue;
      }
      const r = resolveProjectPath(spec.path, projectRoot);
      if (await fileExists(r.absolutePath) && !overwrite) {
        errors.push(`${spec.path}: exists`);
        continue;
      }
      await mkdir(path.dirname(r.absolutePath), { recursive: true });
      await writeFile(r.absolutePath, serializeSceneToTscn(spec), "utf8");
      files.push(spec.path);
      await recordScene(projectRoot, spec.path, "custom", []);
    } catch (e) {
      errors.push(`scene: ${(e as Error).message}`);
    }
  }
  await recordBlueprintApplied(projectRoot, `custom:${bp.name}`);
  return { files, errors };
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerTierAndCustomTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_list_tools_by_tier",
    "List MCP tool names categorized as 'core' (recommended starting set) vs 'advanced' (specialized). Use to scope which tools to learn first.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_list_tools_by_tier", config), async (): Promise<ToolResponse> => {
          return createSuccessResponse(
            {
              core: CORE_TOOLS,
              advanced_count_estimate: 280,
              note: "Advanced tools are still registered and callable; this list curates the recommended subset for general-purpose game-dev workflows.",
            },
            `${CORE_TOOLS.length} core tool(s).`,
          );
        })
      )
  );

  server.tool(
    "devpilot_list_custom_blueprints",
    "List user-defined blueprints in .devpilot/custom_blueprints/*.json. Each JSON file declares scripts + scenes that can be applied via devpilot_apply_custom_blueprint.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_list_custom_blueprints", config), async (): Promise<ToolResponse> => {
          const list = await listCustomBlueprints(config.projectRoot);
          return createSuccessResponse(
            {
              blueprints: list.map((b) => ({ name: b.name, description: b.description ?? "", scripts: (b.scripts ?? []).length, scenes: (b.scenes ?? []).length })),
              count: list.length,
              dir: `res://${CUSTOM_DIR_REL}`,
            },
            `${list.length} custom blueprint(s).`,
          );
        })
      )
  );

  server.tool(
    "devpilot_apply_custom_blueprint",
    "Apply a custom blueprint defined as JSON in .devpilot/custom_blueprints/<name>.json. JSON shape: { name, description?, scripts?: [{path, content}], scenes?: [SceneSpec...] }. Auto-lints GDScript + records to manifest.",
    {
      name: z.string(),
      overwrite: z.boolean().optional().default(false),
    },
    async ({ name, overwrite }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_apply_custom_blueprint", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const list = await listCustomBlueprints(config.projectRoot);
          const bp = list.find((b) => b.name === name);
          if (!bp) {
            return createErrorResponse("CUSTOM_BLUEPRINT_NOT_FOUND", `'${name}' not in ${CUSTOM_DIR_REL}/`, { available: list.map((b) => b.name) }, []);
          }
          const r = await applyCustomBlueprint(config.projectRoot, bp, overwrite);
          if (r.errors.length > 0 && r.files.length === 0) {
            return createErrorResponse("CUSTOM_BLUEPRINT_FAILED", r.errors.join("; "), { errors: r.errors }, []);
          }
          return createSuccessResponse({ files: r.files, errors: r.errors }, `Applied custom:${name} (${r.files.length} file(s)).`);
        })
      )
  );

  server.tool(
    "devpilot_register_custom_blueprint",
    "Save a custom blueprint JSON to .devpilot/custom_blueprints/<name>.json. Useful for teams to share project-specific scaffolding.",
    {
      blueprint: CustomBlueprintSchema,
      overwrite: z.boolean().optional().default(false),
    },
    async ({ blueprint, overwrite }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_register_custom_blueprint", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const dir = path.join(config.projectRoot, CUSTOM_DIR_REL);
          await mkdir(dir, { recursive: true });
          const target = path.join(dir, `${blueprint.name}.json`);
          if (await fileExists(target) && !overwrite) return createErrorResponse("EXISTS", "Already registered.", { path: target }, []);
          await writeFile(target, JSON.stringify(blueprint, null, 2), "utf8");
          return createSuccessResponse({ saved_path: target, name: blueprint.name }, `Custom blueprint '${blueprint.name}' saved.`);
        })
      )
  );

  // Versioning + migration tracker.
  server.tool(
    "devpilot_check_versions",
    "Compare blueprint template versions in manifest vs current MCP version. Lists blueprints applied with older template versions (candidates for migration).",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_check_versions", config), async (): Promise<ToolResponse> => {
          const m = await readManifest(config.projectRoot);
          const CURRENT = "0.4.0"; // bump on template breaking change
          const outdated: Array<{ name: string; recorded_version?: string; at: string }> = [];
          for (const b of m.blueprints_applied) {
            const params = (b.params ?? {}) as Record<string, unknown>;
            const v = typeof params.template_version === "string" ? params.template_version : undefined;
            if (v !== CURRENT) outdated.push({ name: b.name, recorded_version: v, at: b.at });
          }
          return createSuccessResponse({ current: CURRENT, outdated, total_applied: m.blueprints_applied.length }, `${outdated.length} blueprint(s) may need migration.`);
        })
      )
  );
}
