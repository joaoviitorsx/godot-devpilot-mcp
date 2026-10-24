import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { resolveProjectRelativePath, safePathComponent } from "../safety/pathGuard.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

type EvalCase = {
  id: string;
  description: string;
  expected_tool?: string;
  mcp_method?: string;
  params?: Record<string, unknown>;
  expected_ok?: boolean;
  expected_response_contains?: string[];
  tags?: string[];
};

type EvalResult = {
  id: string;
  status: "passed" | "failed" | "error" | "pending";
  expected_tool?: string;
  actual_response: unknown;
  passed: boolean | null;
  duration_ms?: number;
  failure_reasons?: string[];
  ran_at: string;
};

async function createEvalClient(projectRoot: string): Promise<Client> {
  const client = new Client({ name: "devpilot-eval-tool", version: "1.0.0" });
  const entryPoint = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entryPoint], cwd: projectRoot, env: { ...process.env, GODOT_MCP_PROJECT_ROOT: projectRoot, GODOT_MCP_MODE: "full", GODOT_MCP_READ_ONLY: "false" }, stderr: "pipe" }));
  return client;
}

async function runCase(c: EvalCase, godot: GodotClient, client: Client): Promise<ToolResponse> {
  if (c.mcp_method) return callRpc(godot, c.mcp_method, c.params ?? {});
  if (!c.expected_tool || ["godot_run_eval_case", "godot_run_all_evals"].includes(c.expected_tool)) return createErrorResponse("METHOD_UNRESOLVED", "Eval case must name a callable MCP tool.", {}, []);
  const response = await client.callTool({ name: c.expected_tool, arguments: c.params ?? {} });
  const content = Array.isArray(response.content) ? response.content : [];
  const body = content.find((item: unknown) => typeof item === "object" && item !== null && "type" in item && item.type === "text") as { text: string } | undefined;
  if (!body) return createErrorResponse("INVALID_RESPONSE", "Tool returned no text response.", {}, []);
  try { return JSON.parse(body.text) as ToolResponse; }
  catch { return createErrorResponse("INVALID_RESPONSE", body.text, {}, []); }
}

function checkResponseContains(response: unknown, keys: string[]): { ok: boolean; missing: string[] } {
  const json = JSON.stringify(response);
  const missing = keys.filter((k) => !json.includes(k));
  return { ok: missing.length === 0, missing };
}

export function registerEvalReportTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_run_eval_case ────────────────────────────────────────────────────
  server.tool(
    "godot_run_eval_case",
    "Execute a single eval case through its MCP tool (or explicit internal mcp_method), validate the response, and save the result.",
    {
      case_path: z.string().describe("Project-relative path to eval case JSON file"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_run_eval_case", config), async () => {
          const absPath = resolveProjectRelativePath(params.case_path, config.projectRoot).absolutePath;
          let evalCase: EvalCase;
          try {
            evalCase = JSON.parse(await readFile(absPath, "utf8"));
          } catch (e) {
            return createErrorResponse("CASE_NOT_FOUND", e instanceof Error ? e.message : String(e), { case_path: absPath }, []) as ToolResponse;
          }

          safePathComponent(evalCase.id);

          const start = Date.now();
          const client = await createEvalClient(config.projectRoot);
          let response: ToolResponse;
          try { response = await runCase(evalCase, godot, client); }
          finally { await client.close(); }
          const duration_ms = Date.now() - start;

          const failure_reasons: string[] = [];
          if (evalCase.expected_ok === true && !response.ok) failure_reasons.push("response.ok was false");
          if (evalCase.expected_ok === false && response.ok) failure_reasons.push("response.ok was true (expected false)");
          if (evalCase.expected_response_contains) {
            const check = checkResponseContains(response, evalCase.expected_response_contains);
            if (!check.ok) failure_reasons.push(`Missing keys: ${check.missing.join(", ")}`);
          }

          const passed = failure_reasons.length === 0;
          const result: EvalResult = {
            id: evalCase.id,
            status: passed ? "passed" : "failed",
            expected_tool: evalCase.expected_tool,
            actual_response: response,
            passed,
            duration_ms,
            failure_reasons: passed ? undefined : failure_reasons,
            ran_at: new Date().toISOString(),
          };

          if (!config.security.readOnly) {
            const resultsDir = resolveProjectRelativePath("evals/results", config.projectRoot).absolutePath;
            await mkdir(resultsDir, { recursive: true });
            await writeFile(path.join(resultsDir, `${evalCase.id}.result.json`), JSON.stringify(result, null, 2), "utf8");
          }

          return createSuccessResponse(result, passed ? `Eval ${evalCase.id} passed.` : `Eval ${evalCase.id} failed: ${failure_reasons.join("; ")}`);
        })
      )
  );

  // ── godot_run_all_evals ────────────────────────────────────────────────────
  server.tool(
    "godot_run_all_evals",
    "Run all eval cases in evals/cases/*.eval.json. Writes each result + a combined markdown report to evals/results/.",
    {
      cases_dir: z.string().optional().default("evals/cases"),
      report_path: z.string().optional().default("evals/results/REPORT.md"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_run_all_evals", config), async () => {
          const casesDir = resolveProjectRelativePath(params.cases_dir, config.projectRoot).absolutePath;
          const reportPath = resolveProjectRelativePath(params.report_path, config.projectRoot).absolutePath;
          let files: string[] = [];
          try {
            files = (await readdir(casesDir)).filter((f) => f.endsWith(".eval.json"));
          } catch {
            return createErrorResponse("CASES_DIR_NOT_FOUND", `Cases directory not found: ${casesDir}`, {}, []) as ToolResponse;
          }

          const results: EvalResult[] = [];
          const client = await createEvalClient(config.projectRoot);
          try {
          for (const f of files) {
            const absPath = path.join(casesDir, f);
            try {
              const evalCase = JSON.parse(await readFile(absPath, "utf8")) as EvalCase;
              safePathComponent(evalCase.id);
              const start = Date.now();
              const response = await runCase(evalCase, godot, client);
              const duration_ms = Date.now() - start;
              const failure_reasons: string[] = [];
              if (evalCase.expected_ok === true && !response.ok) failure_reasons.push("response.ok was false");
              if (evalCase.expected_response_contains) {
                const check = checkResponseContains(response, evalCase.expected_response_contains);
                if (!check.ok) failure_reasons.push(`missing: ${check.missing.join(", ")}`);
              }
              const passed = failure_reasons.length === 0;
              results.push({
                id: evalCase.id,
                status: passed ? "passed" : "failed",
                expected_tool: evalCase.expected_tool,
                actual_response: response,
                passed,
                duration_ms,
                failure_reasons: passed ? undefined : failure_reasons,
                ran_at: new Date().toISOString(),
              });
            } catch (e) {
              results.push({
                id: f,
                status: "error",
                actual_response: null,
                passed: false,
                failure_reasons: [e instanceof Error ? e.message : String(e)],
                ran_at: new Date().toISOString(),
              });
            }
          }
          } finally { await client.close(); }

          const passed = results.filter((r) => r.status === "passed").length;
          const failed = results.filter((r) => r.status === "failed").length;
          const errored = results.filter((r) => r.status === "error").length;

          if (!config.security.readOnly) {
            const resultsDir = resolveProjectRelativePath("evals/results", config.projectRoot).absolutePath;
            await mkdir(resultsDir, { recursive: true });
            for (const r of results) {
              await writeFile(path.join(resultsDir, `${safePathComponent(r.id)}.result.json`), JSON.stringify(r, null, 2), "utf8");
            }
            const md = [
              "# Eval Run Report",
              "",
              `Generated: ${new Date().toISOString()}`,
              `Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Errored: ${errored}`,
              "",
              "## Results",
              "",
              "| ID | Status | Tool | Duration (ms) | Notes |",
              "| --- | --- | --- | --- | --- |",
              ...results.map((r) => `| ${r.id} | ${r.status} | ${r.expected_tool ?? "-"} | ${r.duration_ms ?? "-"} | ${r.failure_reasons?.join("; ") ?? "-"} |`),
            ].join("\n");
            await mkdir(path.dirname(reportPath), { recursive: true });
            await writeFile(reportPath, md, "utf8");
          }

          return createSuccessResponse({
            total: results.length,
            passed,
            failed,
            errored,
            pass_rate_pct: results.length > 0 ? Math.round((passed / results.length) * 10000) / 100 : 0,
            results: results.map((r) => ({ id: r.id, status: r.status, duration_ms: r.duration_ms, failure_reasons: r.failure_reasons })),
            report_path: params.report_path,
          }, `${passed}/${results.length} evals passed.`);
        })
      )
  );

  // ── godot_export_eval_report ───────────────────────────────────────────────
  server.tool(
    "godot_export_eval_report",
    "Read existing evals/results/*.result.json files and generate a fresh markdown report (no re-execution).",
    {
      results_dir: z.string().optional().default("evals/results"),
      output_path: z.string().optional().default("evals/results/REPORT.md"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_export_eval_report", config), async () => {
          const resultsDir = resolveProjectRelativePath(params.results_dir, config.projectRoot).absolutePath;
          const outputPath = resolveProjectRelativePath(params.output_path, config.projectRoot).absolutePath;
          let files: string[] = [];
          try {
            files = (await readdir(resultsDir)).filter((f) => f.endsWith(".result.json"));
          } catch {
            return createErrorResponse("RESULTS_DIR_NOT_FOUND", `Results directory not found: ${resultsDir}`, {}, []) as ToolResponse;
          }
          const results: EvalResult[] = [];
          for (const f of files) {
            try {
              results.push(JSON.parse(await readFile(path.join(resultsDir, f), "utf8")) as EvalResult);
            } catch { /* skip */ }
          }
          const passed = results.filter((r) => r.status === "passed").length;
          const failed = results.filter((r) => r.status === "failed").length;
          const errored = results.filter((r) => r.status === "error").length;
          const pending = results.filter((r) => r.status === "pending").length;
          const md = [
            "# Eval Report",
            "",
            `Generated: ${new Date().toISOString()}`,
            `Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Errored: ${errored} | Pending: ${pending}`,
            `Pass rate: ${results.length > 0 ? ((passed / results.length) * 100).toFixed(2) : "0.00"}%`,
            "",
            "## Summary",
            "",
            "| ID | Status | Tool | Duration (ms) | Last Ran | Notes |",
            "| --- | --- | --- | --- | --- | --- |",
            ...results.map((r) => `| ${r.id} | ${r.status} | ${r.expected_tool ?? "-"} | ${r.duration_ms ?? "-"} | ${r.ran_at?.slice(0, 19) ?? "-"} | ${r.failure_reasons?.join("; ") ?? "-"} |`),
          ].join("\n");

          if (!config.security.readOnly) {
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, md, "utf8");
          }

          return createSuccessResponse({
            total: results.length,
            passed,
            failed,
            errored,
            pending,
            pass_rate_pct: results.length > 0 ? Math.round((passed / results.length) * 10000) / 100 : 0,
            output_path: params.output_path,
          }, `Report exported with ${results.length} results.`);
        })
      )
  );
}
