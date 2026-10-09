import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { routePrompt } from "../workflows/prompt/promptRouter.js";
import { generatePromptPlan } from "../workflows/prompt/promptPlanner.js";
import { executePromptWorkflow } from "../workflows/prompt/promptExecutor.js";
import { writeReport } from "../workflows/prompt/workflowReporter.js";
import { WORKFLOW_MODES, type WorkflowMode } from "../workflows/prompt/workflowTypes.js";
import { loadPersistedPlan, parsePromptToPlan } from "./prototypeTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

const ModeOrAuto = z.enum(["auto", ...WORKFLOW_MODES] as ["auto", WorkflowMode, ...WorkflowMode[]]);

function suggestNextPrompts(planPreview: ReturnType<typeof parsePromptToPlan> | null, mode: WorkflowMode): string[] {
  const out: string[] = [];
  if (mode === "CREATE" && planPreview) {
    if (!planPreview.systems.includes("save")) out.push("Add save system to my game.");
    if (!planPreview.systems.includes("inventory")) out.push("Add an inventory system.");
    if (!planPreview.systems.includes("dialogue") && planPreview.entities.find((e) => e.type === "npc")) {
      out.push("Add a dialogue system for the NPCs.");
    }
    if (!planPreview.menus.includes("settings")) out.push("Add a settings menu with audio and video options.");
    if (planPreview.genre === "platformer") out.push("Tune the jump arc to feel snappier.");
    if (planPreview.genre === "topdown" || planPreview.genre === "rpg") out.push("Generate a dungeon layout.");
    out.push("Run a QA audit (performance + accessibility).");
  } else if (mode === "ADD_FEATURE") {
    out.push("Validate the project after the change.");
    out.push("Run a polish pass (camera + game feel).");
  } else if (mode === "FIX_BUG") {
    out.push("Run the project and capture logs.");
    out.push("Validate signals + autoloads after the fix.");
  } else if (mode === "POLISH") {
    out.push("Run the QA audit to confirm gains.");
    out.push("Prepare the release checklist.");
  } else if (mode === "VALIDATE") {
    out.push("Fix the highest-severity issue first, then re-validate.");
  } else if (mode === "CONTINUE") {
    out.push("Add a new feature: e.g., 'Add a boss fight'.");
    out.push("Polish the game feel and camera.");
  }
  return out.slice(0, 5);
}

export function registerGameLauncherTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_game (single-entry orchestrator) ────────────────────────────
  server.tool(
    "devpilot_game",
    "One-shot prompt-first game builder. Takes a natural-language prompt and runs the full DevPilot pipeline: route → plan → execute → validate → report. Wraps devpilot_execute_prompt_workflow with simplified UX (single tool, sane defaults, suggested follow-up prompts). Use this as the primary entry point.",
    {
      prompt: z.string().min(1).describe("Natural-language prompt (PT or EN). Examples: 'create a top-down zelda-like with 3 enemies and inventory', 'add save system', 'fix the jump bug', 'polish the camera'."),
      mode: ModeOrAuto.optional().describe("Force a workflow mode; 'auto' (default) uses the router."),
      dry_run: z.boolean().optional().describe("Preview only — no mutation. Default false."),
      validate: z.boolean().optional().describe("Run post-execution validation. Default true."),
      placeholders: z.boolean().optional().describe("Generate colored placeholder polygons for entities. Default true."),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_game", config), async (): Promise<ToolResponse> => {
          const route = (params.mode ?? "auto") === "auto"
            ? routePrompt(params.prompt)
            : {
                mode: params.mode as WorkflowMode,
                intent: `manual_${(params.mode as string).toLowerCase()}`,
                confidence: 1,
                requires_project_scan: params.mode !== "CREATE",
                risk_level: "medium" as const,
                recommended_workflow: `${(params.mode as string).toLowerCase()}Workflow`,
                matched_keywords: [],
              };

          // For CREATE mode, parse plan up front so we can show what was understood
          // and tailor placeholder behavior before executing.
          let planPreview: ReturnType<typeof parsePromptToPlan> | null = null;
          if (route.mode === "CREATE") {
            planPreview = parsePromptToPlan(params.prompt);
            if (params.placeholders === false) planPreview.placeholders = false;
          }

          const workflowPlan = generatePromptPlan(params.prompt, route.mode);
          const dryRun = params.dry_run ?? false;
          const result = await executePromptWorkflow(
            params.prompt,
            workflowPlan,
            {
              dry_run: dryRun,
              validate_after: params.validate ?? true,
              generate_report: true,
              explain_steps: true,
            },
            godot,
            config,
          );

          if (!dryRun && !config.security.readOnly) {
            try {
              const paths = await writeReport(config.projectRoot, result);
              result.report_path = paths.markdown_path;
            } catch (e) {
              result.warnings.push(`writeReport failed: ${(e as Error).message}`);
            }
          }

          // Auto-lint pass: query Godot for static parse errors. If any, surface
          // them on the result so the caller knows the prototype is not yet runnable
          // even if all RPC steps succeeded.
          let parseErrorCount = 0;
          if (!dryRun && godot.getStatus().connected) {
            try {
              const parseRes = await godot.call("static.get_script_parse_errors", {});
              if (parseRes.ok && parseRes.data && typeof parseRes.data === "object") {
                const data = parseRes.data as { error_count?: number; parse_errors?: unknown[] };
                parseErrorCount = data.error_count ?? (Array.isArray(data.parse_errors) ? data.parse_errors.length : 0);
                if (parseErrorCount > 0) {
                  result.warnings.push(`${parseErrorCount} GDScript parse error(s) detected — see godot_get_script_parse_errors for details.`);
                }
              }
            } catch {
              /* parse-error RPC is optional; ignore failures */
            }
          }

          // If CREATE didn't apply (read-only), still surface the plan we'd have built.
          if (!planPreview && route.mode === "CREATE") {
            planPreview = await loadPersistedPlan(config.projectRoot);
          }

          const status: "ready_to_play" | "partial" | "preview" | "needs_fix" | "failed" =
            dryRun ? "preview"
            : !result.success ? "failed"
            : parseErrorCount > 0 ? "needs_fix"
            : result.warnings.length > 0 ? "partial"
            : "ready_to_play";

          const nextPrompts = result.next_prompts.length > 0
            ? result.next_prompts
            : suggestNextPrompts(planPreview, route.mode);

          const summary = [
            `Mode: ${route.mode} (confidence ${route.confidence.toFixed(2)})`,
            planPreview ? `Genre: ${planPreview.genre} | Title: ${planPreview.title}` : null,
            planPreview ? `Entities: ${planPreview.entities.map((e) => `${e.type}${e.count ? `×${e.count}` : ""}`).join(", ")}` : null,
            planPreview && planPreview.systems.length > 0 ? `Systems: ${planPreview.systems.join(", ")}` : null,
            `Status: ${status}`,
            result.created_files.length > 0 ? `Files created: ${result.created_files.length}` : null,
          ].filter(Boolean).join(" | ");

          return createSuccessResponse(
            {
              status,
              mode: route.mode,
              route,
              plan_preview: planPreview,
              created_files: result.created_files,
              modified_files: result.modified_files,
              executed_steps: result.executed_steps.length,
              warnings: result.warnings,
              errors: result.errors,
              next_prompts: nextPrompts,
              report_path: result.report_path,
              dry_run: dryRun,
            },
            summary,
            result.warnings,
            nextPrompts,
          );
        })
      )
  );
}
