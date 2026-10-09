import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { lintGDScript } from "../utils/gdscriptLint.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function resToAbs(projectRoot: string, resPath: string): string {
  return path.join(projectRoot, resPath.replace(/^res:\/\//, ""));
}

type ParseError = { path?: string; file?: string; line?: number; message?: string };

async function getParseErrorsFromGodot(godot: GodotClient): Promise<ParseError[]> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return [];
  }
  const r = await godot.call("static.get_script_parse_errors", {});
  if (!r.ok) return [];
  const data = r.data as { parse_errors?: unknown[] };
  if (!Array.isArray(data?.parse_errors)) return [];
  return data.parse_errors.map((e) => e as ParseError);
}

async function fixAutoloadProjectGodot(projectRoot: string): Promise<string[]> {
  const file = path.join(projectRoot, "project.godot");
  if (!(await fileExists(file))) return [];
  const content = await readFile(file, "utf8");
  // Find [autoload] section and add * to entries missing it.
  const fixed = content.replace(
    /(\[autoload\][\s\S]*?)(?=\n\[|$)/,
    (block) => {
      return block.replace(/^([A-Za-z_]\w*)="(res:\/\/[^"]+)"$/gm, (_m, name, p) => {
        if (p.startsWith("*")) return `${name}="${p}"`;
        return `${name}="*${p}"`;
      });
    }
  );
  if (fixed !== content) {
    await writeFile(file, fixed, "utf8");
    return ["enabled disabled autoloads with * prefix"];
  }
  return [];
}

async function relintScripts(projectRoot: string, paths: string[]): Promise<{ fixed: string[]; warnings: string[] }> {
  const fixed: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    const abs = resToAbs(projectRoot, p);
    if (!(await fileExists(abs))) continue;
    try {
      const original = await readFile(abs, "utf8");
      const result = lintGDScript(original);
      if (result.fixed !== original) {
        await writeFile(abs, result.fixed, "utf8");
        fixed.push(p);
      }
      for (const i of result.issues) {
        if (i.severity === "error" && !i.fixed) {
          warnings.push(`${p}:${i.line} ${i.rule} — ${i.message}`);
        }
      }
    } catch (e) {
      warnings.push(`${p}: ${(e as Error).message}`);
    }
  }
  return { fixed, warnings };
}

export function registerAutoFixTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "devpilot_auto_fix_parse_errors",
    "Heuristic auto-fix loop: queries Godot for parse errors, applies known fixes (gdscriptLint on affected scripts, * prefix on disabled autoloads in project.godot), and re-checks. Returns lists of fixed files + remaining errors.",
    {
      max_iterations: z.number().int().positive().max(5).optional().default(3),
      additional_paths: z.array(z.string()).optional().describe("Extra res:// paths to lint regardless of detected errors."),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_auto_fix_parse_errors", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) {
            return createSuccessResponse({ skipped: true }, "Read-only mode — skipping auto-fix.");
          }

          const allFixed: string[] = [];
          const allWarnings: string[] = [];
          let lastErrorCount = -1;

          for (let i = 0; i < params.max_iterations; i++) {
            const errors = await getParseErrorsFromGodot(godot);
            const errorPaths = errors
              .map((e) => e.path ?? e.file ?? "")
              .filter((s) => typeof s === "string" && s.length > 0);

            // Always also relint additional_paths even when bridge has no errors yet.
            const targets = Array.from(new Set([...errorPaths, ...(params.additional_paths ?? [])]));
            if (targets.length === 0) {
              // No targets — try the autoload fix once and break.
              if (i === 0) {
                const al = await fixAutoloadProjectGodot(config.projectRoot);
                allFixed.push(...al);
              }
              break;
            }

            const r = await relintScripts(config.projectRoot, targets);
            allFixed.push(...r.fixed);
            allWarnings.push(...r.warnings);

            // Try autoload fix in case error msg is "Identifier ... not declared".
            const autoloadKeyword = errors.some((e) => /Identifier.*not declared/i.test(e.message ?? ""));
            if (autoloadKeyword) {
              const al = await fixAutoloadProjectGodot(config.projectRoot);
              allFixed.push(...al);
            }

            const after = await getParseErrorsFromGodot(godot);
            if (after.length === 0) {
              lastErrorCount = 0;
              break;
            }
            if (after.length === lastErrorCount) {
              // No progress — stop loop to avoid infinite cycle.
              lastErrorCount = after.length;
              break;
            }
            lastErrorCount = after.length;
          }

          return createSuccessResponse(
            {
              fixed_files: Array.from(new Set(allFixed)),
              warnings: allWarnings,
              remaining_errors: lastErrorCount,
            },
            lastErrorCount === 0
              ? `Auto-fix succeeded — no parse errors remaining.`
              : `Auto-fix complete; ${lastErrorCount} error(s) remain.`
          );
        })
      )
  );
}
