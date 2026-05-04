import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createFileBackup } from "../safety/backup.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { createSafetyError } from "../safety/errors.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type RunReportEventType = "start" | "stop" | "output" | "error" | "parse_error";

export type RunReportEvent = {
  timestamp: string;
  type: RunReportEventType;
  data: Record<string, unknown>;
};

type ParseError = {
  file: string;
  line: number;
  column: number | null;
  message: string;
  severity: "error" | "warning";
};

type FixPatch = {
  script_path: string;
  old_content: string;
  new_content: string;
  reason: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

export function runReportsDir(projectRoot: string): string {
  return path.join(projectRoot, ".godot_mcp", "logs", "run_reports");
}

async function safeReaddir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

async function safeDirents(dirPath: string) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readRunReportEvents(
  projectRoot: string,
  limit: number = 200,
  filter?: RunReportEventType[]
): Promise<RunReportEvent[]> {
  const baseDir = runReportsDir(projectRoot);
  const events: RunReportEvent[] = [];

  const dateDirents = await safeDirents(baseDir);
  const sortedDateDirs = dateDirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a));

  for (const dateDir of sortedDateDirs) {
    if (events.length >= limit) break;
    const datePath = path.join(baseDir, dateDir);
    const files = await safeReaddir(datePath);
    const sortedFiles = files.filter((f) => f.endsWith(".jsonl")).sort((a, b) => b.localeCompare(a));

    for (const file of sortedFiles) {
      if (events.length >= limit) break;
      const content = await readFile(path.join(datePath, file), "utf8").catch(() => "");
      const lines = content.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as RunReportEvent;
          if (!filter || filter.includes(event.type)) {
            events.push(event);
          }
        } catch {
          // skip malformed line
        }
      }
    }
  }

  return events.slice(0, limit);
}

export async function getLastRunReportFile(
  projectRoot: string
): Promise<{ date: string; file: string; absolutePath: string } | null> {
  const baseDir = runReportsDir(projectRoot);
  const dateDirents = await safeDirents(baseDir);
  const sortedDateDirs = dateDirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a));

  for (const dateDir of sortedDateDirs) {
    const datePath = path.join(baseDir, dateDir);
    const files = await safeReaddir(datePath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort((a, b) => b.localeCompare(a));
    if (jsonlFiles.length > 0) {
      return { date: dateDir, file: jsonlFiles[0], absolutePath: path.join(datePath, jsonlFiles[0]) };
    }
  }
  return null;
}

// Static parse error detection — catches common GDScript issues without Godot runtime
export function detectStaticParseErrors(content: string, resPath: string): ParseError[] {
  const errors: ParseError[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trimEnd();

    // func declaration without colon
    if (/^\s*func\s+\w+\s*\([^)]*\)\s*$/.test(trimmed)) {
      errors.push({ file: resPath, line: lineNum, column: null, message: "Function declaration missing ':'. Expected 'func name():' or 'func name() -> Type:'.", severity: "error" });
    }

    // Godot 3 connect syntax
    const connectIdx = line.indexOf(".connect(");
    if (connectIdx >= 0 && /,\s*self\s*,\s*["']/.test(line)) {
      errors.push({ file: resPath, line: lineNum, column: connectIdx, message: "Godot 3 connect() syntax. Use signal.connect(callable) in Godot 4.", severity: "warning" });
    }

    // Godot 3 emit_signal
    const emitIdx = line.indexOf("emit_signal(");
    if (emitIdx >= 0) {
      errors.push({ file: resPath, line: lineNum, column: emitIdx, message: "emit_signal() is Godot 3. Use signal_name.emit() in Godot 4.", severity: "warning" });
    }
  });

  return errors;
}

// Attempt to auto-generate a patch for a known static parse error
function buildFix(content: string, error: ParseError): FixPatch | null {
  const lines = content.split(/\r?\n/);
  const lineIdx = error.line - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) return null;
  const line = lines[lineIdx];

  // Fix: missing colon after func declaration
  if (/^\s*func\s+\w+\s*\([^)]*\)\s*$/.test(line.trimEnd())) {
    const fixed = line.trimEnd() + ":";
    return {
      script_path: error.file,
      old_content: line,
      new_content: fixed,
      reason: `Add missing colon to func declaration on line ${error.line}.`
    };
  }

  return null;
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerDebugTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_run_project ──────────────────────────────────────────────────────
  server.tool(
    "godot_run_project",
    "Run the Godot project main scene via the editor.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_run_project", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "debug.run_project", {})
      )
    )
  );

  // ── godot_run_scene ────────────────────────────────────────────────────────
  server.tool(
    "godot_run_scene",
    "Run a specific Godot scene via the editor.",
    { scene_path: z.string().describe("res:// path to the .tscn scene to run.") },
    async ({ scene_path }) => toMcpResult(
      await executeToolSafely(ctx("godot_run_scene", config), async (): Promise<ToolResponse> => {
        resolveProjectPath(scene_path, config.projectRoot);
        return callAfterConnect(godot, "debug.run_scene", { scene_path });
      })
    )
  );

  // ── godot_stop_project ────────────────────────────────────────────────────
  server.tool(
    "godot_stop_project",
    "Stop the currently running Godot project.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_stop_project", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "debug.stop_project", {})
      )
    )
  );

  // ── godot_is_game_running ──────────────────────────────────────────────────
  server.tool(
    "godot_is_game_running",
    "Check whether the Godot project is currently running.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_is_game_running", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "debug.is_running", {})
      )
    )
  );

  // ── godot_get_output_logs ──────────────────────────────────────────────────
  server.tool(
    "godot_get_output_logs",
    "Get output and error events from recent run reports stored in .godot_mcp/logs/run_reports/.",
    {
      limit: z.number().int().positive().max(500).optional().describe("Max events to return. Defaults to 100."),
      type: z.enum(["output", "error", "all"]).optional().describe("Filter by event type. Defaults to all.")
    },
    async ({ limit, type }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_output_logs", config), async (): Promise<ToolResponse> => {
        const filter: RunReportEventType[] | undefined =
          type === "output" ? ["output"] :
          type === "error" ? ["error"] :
          undefined;
        const events = await readRunReportEvents(config.projectRoot, limit ?? 100, filter);
        return createSuccessResponse(
          { events, count: events.length },
          events.length > 0 ? "Output logs retrieved." : "No run reports found. Run godot_run_project first."
        );
      })
    )
  );

  // ── godot_get_debugger_errors ──────────────────────────────────────────────
  server.tool(
    "godot_get_debugger_errors",
    "Get error events from recent run reports.",
    { limit: z.number().int().positive().max(200).optional().describe("Max errors to return. Defaults to 50.") },
    async ({ limit }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_debugger_errors", config), async (): Promise<ToolResponse> => {
        const events = await readRunReportEvents(config.projectRoot, limit ?? 50, ["error"]);
        return createSuccessResponse(
          { errors: events, count: events.length },
          events.length > 0 ? "Debugger errors retrieved." : "No error events found in run reports.",
          events.length > 0 ? [`${events.length} error(s) found. Use godot_fix_errors to generate fixes.`] : []
        );
      })
    )
  );

  // ── godot_get_script_parse_errors ─────────────────────────────────────────
  server.tool(
    "godot_get_script_parse_errors",
    "Statically detect GDScript parse errors and Godot-3 syntax in project scripts.",
    {
      path: z.string().optional().describe("res:// path to a single .gd file. Omit to scan all project scripts."),
      include_warnings: z.boolean().optional().describe("Include warnings alongside errors. Defaults to true.")
    },
    async ({ path: resPath, include_warnings }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_script_parse_errors", config), async (): Promise<ToolResponse> => {
        const showWarnings = include_warnings !== false;
        const files: string[] = [];

        if (resPath) {
          const resolved = resolveProjectPath(resPath, config.projectRoot);
          if (!resolved.resPath.endsWith(".gd")) {
            throw createSafetyError("INVALID_PARAMS", "path must end in .gd.", { path: resPath }, []);
          }
          files.push(resolved.absolutePath);
        } else {
          await collectGdFilesAbsolute(config.projectRoot, config.projectRoot, files);
        }

        const allErrors: ParseError[] = [];
        for (const absPath of files) {
          const rel = path.relative(config.projectRoot, absPath).split(path.sep).join("/");
          const scriptResPath = `res://${rel}`;
          const content = await readFile(absPath, "utf8").catch(() => "");
          const detected = detectStaticParseErrors(content, scriptResPath);
          for (const e of detected) {
            if (showWarnings || e.severity === "error") {
              allErrors.push(e);
            }
          }
        }

        const errorCount = allErrors.filter((e) => e.severity === "error").length;
        const warnCount = allErrors.filter((e) => e.severity === "warning").length;

        return createSuccessResponse(
          { parse_errors: allErrors, total: allErrors.length, error_count: errorCount, warning_count: warnCount },
          allErrors.length === 0 ? "No static parse errors detected." : `${errorCount} error(s), ${warnCount} warning(s) detected.`,
          [],
          allErrors.length > 0 ? ["Use godot_fix_errors with dry_run=true to preview auto-fixes."] : []
        );
      })
    )
  );

  // ── godot_clear_logs ──────────────────────────────────────────────────────
  server.tool(
    "godot_clear_logs",
    "Delete all run report files from .godot_mcp/logs/run_reports/.",
    { dry_run: z.boolean().optional().describe("Preview without deleting. Defaults to true.") },
    async ({ dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_clear_logs", config), async (): Promise<ToolResponse> => {
        const baseDir = runReportsDir(config.projectRoot);
        const dateDirents = await safeDirents(baseDir);
        const dirs = dateDirents.filter((d) => d.isDirectory()).map((d) => d.name);

        if (dry_run !== false) {
          return createDryRunResponse({
            toolName: "godot_clear_logs",
            plannedChanges: dirs.length > 0 ? [`Delete ${dirs.length} run report date dir(s) from .godot_mcp/logs/run_reports/`] : [],
            affectedFiles: dirs.map((d) => `.godot_mcp/logs/run_reports/${d}`)
          });
        }

        for (const dateDir of dirs) {
          await rm(path.join(baseDir, dateDir), { recursive: true, force: true });
        }

        return createSuccessResponse(
          { deleted_dirs: dirs.length },
          dirs.length > 0 ? `Cleared ${dirs.length} run report dir(s).` : "No run reports to clear."
        );
      })
    )
  );

  // ── godot_get_last_run_report ─────────────────────────────────────────────
  server.tool(
    "godot_get_last_run_report",
    "Get a summary of the most recent project run from .godot_mcp/logs/run_reports/.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_get_last_run_report", config), async (): Promise<ToolResponse> => {
        const reportFile = await getLastRunReportFile(config.projectRoot);
        if (!reportFile) {
          return createSuccessResponse(
            { found: false, report: null },
            "No run reports found. Run godot_run_project first."
          );
        }

        const content = await readFile(reportFile.absolutePath, "utf8").catch(() => "");
        const events: RunReportEvent[] = content
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => { try { return JSON.parse(l) as RunReportEvent; } catch { return null; } })
          .filter((e): e is RunReportEvent => e !== null);

        const startEvent = events.find((e) => e.type === "start");
        const stopEvent = events.slice().reverse().find((e) => e.type === "stop");
        const errorEvents = events.filter((e) => e.type === "error");
        const outputEvents = events.filter((e) => e.type === "output");

        return createSuccessResponse(
          {
            found: true,
            date: reportFile.date,
            file: reportFile.file,
            started_at: startEvent?.timestamp ?? null,
            stopped_at: stopEvent?.timestamp ?? null,
            output_count: outputEvents.length,
            error_count: errorEvents.length,
            events
          },
          errorEvents.length > 0
            ? `Last run had ${errorEvents.length} error(s).`
            : "Last run completed without recorded errors.",
          errorEvents.length > 0 ? [`${errorEvents.length} error(s) in last run. Use godot_get_debugger_errors or godot_fix_errors.`] : []
        );
      })
    )
  );

  // ── godot_assert_no_errors ────────────────────────────────────────────────
  server.tool(
    "godot_assert_no_errors",
    "Assert that the last run report contains no error events. Returns ok=false if errors are found.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_assert_no_errors", config), async (): Promise<ToolResponse> => {
        const reportFile = await getLastRunReportFile(config.projectRoot);
        if (!reportFile) {
          return createErrorResponse(
            "NO_RUN_REPORT",
            "No run report found. Cannot assert absence of errors without a prior run.",
            {},
            ["Run godot_run_project first, then call godot_assert_no_errors."]
          );
        }

        const content = await readFile(reportFile.absolutePath, "utf8").catch(() => "");
        const events: RunReportEvent[] = content
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => { try { return JSON.parse(l) as RunReportEvent; } catch { return null; } })
          .filter((e): e is RunReportEvent => e !== null);

        const errorEvents = events.filter((e) => e.type === "error");

        if (errorEvents.length > 0) {
          return createErrorResponse(
            "RUN_HAD_ERRORS",
            `Last run had ${errorEvents.length} error(s).`,
            { error_count: errorEvents.length, errors: errorEvents },
            ["Use godot_get_debugger_errors for details.", "Use godot_fix_errors with dry_run=true to preview fixes."]
          );
        }

        return createSuccessResponse(
          { has_errors: false, checked_file: reportFile.file },
          "Assertion passed: no errors in last run."
        );
      })
    )
  );

  // ── godot_fix_errors ──────────────────────────────────────────────────────
  server.tool(
    "godot_fix_errors",
    "Generate or apply auto-fixes for static GDScript parse errors. Always run with dry_run=true first to review the plan.",
    {
      path: z.string().optional().describe("res:// path to a single .gd file. Omit to scan all project scripts."),
      dry_run: z.boolean().optional().describe("Preview without applying. Defaults to true — set false only after reviewing the plan.")
    },
    async ({ path: resPath, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_fix_errors", config), async (): Promise<ToolResponse> => {
        const files: string[] = [];

        if (resPath) {
          const resolved = resolveProjectPath(resPath, config.projectRoot);
          if (!resolved.resPath.endsWith(".gd")) {
            throw createSafetyError("INVALID_PARAMS", "path must end in .gd.", { path: resPath }, []);
          }
          files.push(resolved.absolutePath);
        } else {
          await collectGdFilesAbsolute(config.projectRoot, config.projectRoot, files);
        }

        const patches: FixPatch[] = [];
        const unfixable: ParseError[] = [];

        for (const absPath of files) {
          const rel = path.relative(config.projectRoot, absPath).split(path.sep).join("/");
          const scriptResPath = `res://${rel}`;
          const content = await readFile(absPath, "utf8").catch(() => "");
          const errors = detectStaticParseErrors(content, scriptResPath).filter((e) => e.severity === "error");

          for (const error of errors) {
            const fix = buildFix(content, error);
            if (fix) {
              patches.push(fix);
            } else {
              unfixable.push(error);
            }
          }
        }

        if (dry_run !== false) {
          return createDryRunResponse({
            toolName: "godot_fix_errors",
            plannedChanges: patches.map((p) => `${p.script_path}: ${p.reason}`),
            affectedFiles: [...new Set(patches.map((p) => p.script_path))]
          });
        }

        if (patches.length === 0) {
          return createSuccessResponse(
            { applied: 0, unfixable: unfixable.length, unfixable_errors: unfixable },
            unfixable.length > 0
              ? `No auto-fixable errors found. ${unfixable.length} error(s) require manual fix.`
              : "No fixable errors found.",
            [],
            unfixable.length > 0 ? ["Review unfixable_errors and apply fixes manually."] : []
          );
        }

        const applied: FixPatch[] = [];
        const failed: { patch: FixPatch; reason: string }[] = [];

        for (const patch of patches) {
          try {
            const resolved = resolveProjectPath(patch.script_path, config.projectRoot);
            const current = await readFile(resolved.absolutePath, "utf8");
            if (!current.includes(patch.old_content)) {
              failed.push({ patch, reason: "old_content no longer found (script may have changed)." });
              continue;
            }
            await createFileBackup({
              projectRoot: config.projectRoot,
              resPath: patch.script_path,
              toolName: "godot_fix_errors",
              reason: patch.reason
            });
            const { writeFile } = await import("node:fs/promises");
            await writeFile(resolved.absolutePath, current.replace(patch.old_content, patch.new_content), "utf8");
            applied.push(patch);
          } catch (error) {
            failed.push({ patch, reason: error instanceof Error ? error.message : String(error) });
          }
        }

        return createSuccessResponse(
          { applied: applied.length, failed: failed.length, applied_patches: applied, failed_patches: failed, unfixable: unfixable.length },
          `Applied ${applied.length} fix(es). ${unfixable.length} error(s) require manual attention.`,
          failed.length > 0 ? [`${failed.length} fix(es) failed — see failed_patches.`] : [],
          unfixable.length > 0 ? ["Review unfixable_errors and apply fixes manually."] : []
        );
      })
    )
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function collectGdFilesAbsolute(dir: string, projectRoot: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const relName = entry.name;
      if (relName !== ".godot" && relName !== ".godot_mcp" && relName !== "node_modules") {
        await collectGdFilesAbsolute(abs, projectRoot, out);
      }
    } else if (entry.name.endsWith(".gd")) {
      out.push(abs);
    }
  }
}
