import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { routePrompt } from "../workflows/prompt/promptRouter.js";
import { generatePromptPlan } from "../workflows/prompt/promptPlanner.js";
import { executePromptWorkflow } from "../workflows/prompt/promptExecutor.js";
import { renderReportMarkdown, writeReport, readLatestResult } from "../workflows/prompt/workflowReporter.js";
import { WORKFLOW_MODES, type WorkflowMode } from "../workflows/prompt/workflowTypes.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

const ModeEnum = z.enum(WORKFLOW_MODES as [WorkflowMode, ...WorkflowMode[]]);
const ModeOrAuto = z.enum(["auto", ...WORKFLOW_MODES] as ["auto", WorkflowMode, ...WorkflowMode[]]);

export function registerPromptWorkflowTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // 1. Route
  server.tool(
    "devpilot_route_prompt",
    "Classify a natural-language game-dev prompt into a DevPilot workflow mode (CREATE, CONTINUE, ADD_FEATURE, FIX_BUG, POLISH, VALIDATE). Returns intent, confidence, risk level, and recommended workflow.",
    {
      prompt: z.string().min(1).describe("Natural-language prompt (PT or EN)."),
    },
    async ({ prompt }) => toMcpResult(
      await executeToolSafely(ctx("devpilot_route_prompt", config), async (): Promise<ToolResponse> => {
        const route = routePrompt(prompt);
        return createSuccessResponse(route, `Routed to ${route.mode} (confidence ${route.confidence.toFixed(2)}).`);
      })
    )
  );

  // 2. Plan
  server.tool(
    "devpilot_generate_prompt_plan",
    "Build a structured WorkflowPlan (steps, validation, next prompts) for a given prompt + mode. Pure function — no side effects.",
    {
      prompt: z.string().min(1).describe("Natural-language prompt."),
      mode: ModeEnum.describe("Workflow mode."),
    },
    async ({ prompt, mode }) => toMcpResult(
      await executeToolSafely(ctx("devpilot_generate_prompt_plan", config), async (): Promise<ToolResponse> => {
        const plan = generatePromptPlan(prompt, mode);
        return createSuccessResponse(plan, `Plan generated for ${mode} (${plan.steps.length} steps).`);
      })
    )
  );

  // 3. Execute
  server.tool(
    "devpilot_execute_prompt_workflow",
    "Prompt-first orchestrator. Routes the prompt, builds a plan, executes via existing internal helpers and Godot RPC, validates and writes a report. Set dry_run=true for preview-only (no mutation).",
    {
      prompt: z.string().min(1).describe("Natural-language prompt (PT or EN)."),
      mode: ModeOrAuto.optional().describe("Force a workflow mode; 'auto' (default) uses the router."),
      dry_run: z.boolean().optional().describe("Preview only — no mutation. Default false."),
      validate_after: z.boolean().optional().describe("Run post-execution validation. Default true."),
      generate_report: z.boolean().optional().describe("Write Markdown + JSON report to .devpilot/reports/. Default true."),
      explain_steps: z.boolean().optional().describe("Reserved for future use. Default true."),
    },
    async (params) => toMcpResult(
      await executeToolSafely(ctx("devpilot_execute_prompt_workflow", config), async (): Promise<ToolResponse> => {
        const requested = params.mode ?? "auto";
        const route = requested === "auto"
          ? routePrompt(params.prompt)
          : {
              mode: requested as WorkflowMode,
              intent: `manual_${requested.toLowerCase()}`,
              confidence: 1,
              requires_project_scan: requested !== "CREATE",
              risk_level: "medium" as const,
              recommended_workflow: `${(requested as string).toLowerCase()}Workflow`,
              matched_keywords: [],
            };

        const plan = generatePromptPlan(params.prompt, route.mode);
        const result = await executePromptWorkflow(
          params.prompt,
          plan,
          {
            dry_run: params.dry_run ?? false,
            validate_after: params.validate_after ?? true,
            generate_report: params.generate_report ?? true,
            explain_steps: params.explain_steps ?? true,
          },
          godot,
          config,
        );

        if ((params.generate_report ?? true) && !config.security.readOnly) {
          try {
            const paths = await writeReport(config.projectRoot, result);
            result.report_path = paths.markdown_path;
          } catch (e) {
            result.warnings.push(`writeReport failed: ${(e as Error).message}`);
          }
        } else if (config.security.readOnly) {
          result.warnings.push("read-only mode: report not persisted");
        }

        return createSuccessResponse({ route, ...result }, result.summary, result.warnings, result.next_prompts);
      })
    )
  );

  // 4. Generate report (rehydrates last result)
  server.tool(
    "devpilot_generate_workflow_report",
    "Render the last workflow execution as Markdown. Reads .devpilot/reports/latest.json. Optionally rewrites latest.md.",
    {
      rewrite_latest: z.boolean().optional().describe("Rewrite .devpilot/reports/latest.md. Default false."),
    },
    async ({ rewrite_latest }) => toMcpResult(
      await executeToolSafely(ctx("devpilot_generate_workflow_report", config), async (): Promise<ToolResponse> => {
        const result = await readLatestResult(config.projectRoot);
        if (!result) {
          return createErrorResponse(
            "NO_LATEST_RESULT",
            "No prior workflow result found at .devpilot/reports/latest.json.",
            {},
            ["Run devpilot_execute_prompt_workflow first."]
          );
        }
        const markdown = renderReportMarkdown(result);
        let written: string | null = null;
        if (rewrite_latest && !config.security.readOnly) {
          const paths = await writeReport(config.projectRoot, result);
          written = paths.latest_markdown;
        }
        return createSuccessResponse(
          { markdown, mode: result.mode, goal: result.goal, summary: result.summary, written_path: written },
          "Report rendered."
        );
      })
    )
  );
}
