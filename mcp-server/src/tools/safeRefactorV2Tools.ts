import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

const SKIP_DIRS = new Set([".git", ".godot", ".godot_mcp", "node_modules"]);

async function findFiles(root: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
    }
  }
  await walk(root);
  return out;
}

type Context = "identifier" | "type_hint" | "string" | "comment" | "function_name" | "class_name";

type Occurrence = {
  file: string;
  line: number;
  column: number;
  context: Context;
  line_content: string;
};

function classifyLine(line: string, symbol: string): Array<{ column: number; context: Context }> {
  const occurrences: Array<{ column: number; context: Context }> = [];
  // Strip strings and comments
  let inString: '"' | "'" | null = null;
  const masked = Array.from(line);
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      masked[i] = "\x00";
      if (ch === inString && line[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; masked[i] = "\x00"; continue; }
    if (ch === "#") {
      for (let j = i; j < line.length; j++) masked[j] = "\x01";
      break;
    }
  }
  const maskedStr = masked.join("");
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const col = m.index;
    const maskedChar = maskedStr[col];
    let context: Context;
    if (maskedChar === "\x00") context = "string";
    else if (maskedChar === "\x01") context = "comment";
    else {
      const before = line.slice(0, col).trimEnd();
      const beforeChar = before.slice(-1);
      const beforeWord = before.match(/(\w+)\s*$/)?.[1] ?? "";
      const beforeArrow = before.endsWith("->");
      const beforeColon = beforeChar === ":" && !before.endsWith("::");
      if (beforeArrow || beforeColon) context = "type_hint";
      else if (beforeWord === "func") context = "function_name";
      else if (beforeWord === "class_name") context = "class_name";
      else context = "identifier";
    }
    occurrences.push({ column: col, context });
  }
  return occurrences;
}

export function registerSafeRefactorV2Tools(server: McpServer, _godot: unknown, config: ServerConfig): void {
  // ── godot_safe_refactor_symbol_v2 ──────────────────────────────────────────
  server.tool(
    "godot_safe_refactor_symbol_v2",
    "Context-aware symbol refactor. Classifies each occurrence (identifier/type_hint/string/comment/function_name/class_name) and applies replacement only in selected contexts. Default skips strings + comments.",
    {
      old_symbol: z.string(),
      new_symbol: z.string(),
      contexts: z.array(z.enum(["identifier", "type_hint", "function_name", "class_name", "string", "comment"]))
        .optional().default(["identifier", "type_hint", "function_name", "class_name"])
        .describe("Which contexts to replace. Defaults to code contexts only."),
      file_extensions: z.array(z.string()).optional().default([".gd"]),
      dry_run: z.boolean().optional().default(true),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_safe_refactor_symbol_v2", config), async () => {
          const files = await findFiles(config.projectRoot, params.file_extensions);
          const allOccurrences: Occurrence[] = [];
          const filesToWrite: Array<{ path: string; content: string }> = [];

          for (const f of files) {
            const content = await readFile(f, "utf8");
            const lines = content.split("\n");
            const newLines: string[] = [];
            let fileChanged = false;

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const occs = classifyLine(line, params.old_symbol);
              if (occs.length === 0) {
                newLines.push(line);
                continue;
              }
              for (const o of occs) {
                allOccurrences.push({
                  file: path.relative(config.projectRoot, f),
                  line: i + 1,
                  column: o.column + 1,
                  context: o.context,
                  line_content: line,
                });
              }
              const allowed = occs.filter((o) => params.contexts.includes(o.context));
              if (allowed.length === 0) {
                newLines.push(line);
                continue;
              }
              let newLine = "";
              let cursor = 0;
              const sortedAllowed = allowed.sort((a, b) => a.column - b.column);
              for (const o of sortedAllowed) {
                newLine += line.slice(cursor, o.column) + params.new_symbol;
                cursor = o.column + params.old_symbol.length;
              }
              newLine += line.slice(cursor);
              newLines.push(newLine);
              fileChanged = true;
            }

            if (fileChanged) filesToWrite.push({ path: f, content: newLines.join("\n") });
          }

          const byContext: Record<Context, number> = {
            identifier: 0, type_hint: 0, string: 0, comment: 0, function_name: 0, class_name: 0,
          };
          for (const o of allOccurrences) byContext[o.context]++;

          const willReplace = allOccurrences.filter((o) => params.contexts.includes(o.context)).length;
          const willSkip = allOccurrences.length - willReplace;

          if (!params.dry_run && !config.security.readOnly) {
            for (const f of filesToWrite) await writeFile(f.path, f.content, "utf8");
          }

          return createSuccessResponse({
            old_symbol: params.old_symbol,
            new_symbol: params.new_symbol,
            files_scanned: files.length,
            files_modified: filesToWrite.length,
            total_occurrences: allOccurrences.length,
            replaced: willReplace,
            skipped: willSkip,
            by_context: byContext,
            occurrences: allOccurrences.slice(0, 200),
            truncated: allOccurrences.length > 200,
            applied: !params.dry_run && !config.security.readOnly,
            dry_run: params.dry_run,
          }, params.dry_run
            ? `Dry run: ${willReplace} occurrences would be replaced (${willSkip} skipped).`
            : `Applied: ${willReplace} occurrences replaced in ${filesToWrite.length} files.`);
        })
      )
  );
}
