import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

const MEMORY_DIR = ".godot_mcp/memory";
const SUMMARY_FILE = "project_summary.md";
const ARCHITECTURE_FILE = "architecture.md";
const CONVENTIONS_FILE = "conventions.md";
const DECISIONS_DIR = "decisions";
const TASK_FILE = "current_task.md";
const SYSTEMS_FILE = "gameplay_systems.md";

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

function memoryPath(root: string, name: string): string {
  return path.join(root, MEMORY_DIR, name);
}

async function ensureMemoryDir(root: string): Promise<void> {
  await mkdir(path.join(root, MEMORY_DIR), { recursive: true });
  await mkdir(path.join(root, MEMORY_DIR, DECISIONS_DIR), { recursive: true });
}

async function readMemoryFile(root: string, name: string): Promise<string | null> {
  try {
    return await readFile(memoryPath(root, name), "utf8");
  } catch {
    return null;
  }
}

async function writeMemoryFile(root: string, name: string, content: string): Promise<string> {
  await ensureMemoryDir(root);
  const target = memoryPath(root, name);
  await writeFile(target, content, "utf8");
  return target;
}

function timestamp(): string {
  return new Date().toISOString();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerMemoryTools(server: McpServer, config: ServerConfig): void {
  // ── godot_update_project_memory ────────────────────────────────────────────
  server.tool(
    "godot_update_project_memory",
    "Update one of the persistent memory files (summary, architecture, conventions, gameplay_systems, current_task).",
    {
      file: z.enum(["summary", "architecture", "conventions", "gameplay_systems", "current_task"]).describe("Memory file to update."),
      content: z.string().describe("Full markdown content to write (overwrites)."),
      append: z.boolean().optional().describe("Append instead of overwriting. Defaults to false.")
    },
    async ({ file, content, append }) => toMcpResult(
      await executeToolSafely(ctx("godot_update_project_memory", config), async (): Promise<ToolResponse> => {
        const map: Record<string, string> = {
          summary: SUMMARY_FILE,
          architecture: ARCHITECTURE_FILE,
          conventions: CONVENTIONS_FILE,
          gameplay_systems: SYSTEMS_FILE,
          current_task: TASK_FILE
        };
        const target = map[file];
        await ensureMemoryDir(config.projectRoot);
        const fullPath = memoryPath(config.projectRoot, target);
        if (append) {
          const existing = (await readMemoryFile(config.projectRoot, target)) ?? "";
          const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
          await writeFile(fullPath, existing + sep + content + (content.endsWith("\n") ? "" : "\n"), "utf8");
        } else {
          await writeFile(fullPath, content.endsWith("\n") ? content : content + "\n", "utf8");
        }
        return createSuccessResponse(
          { file: target, written_to: fullPath, mode: append ? "append" : "overwrite", size_bytes: Buffer.byteLength(content, "utf8") },
          "Memory file updated."
        );
      })
    )
  );

  // ── godot_get_project_memory ──────────────────────────────────────────────
  server.tool(
    "godot_get_project_memory",
    "Return the project memory summary file (project_summary.md).",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_get_project_memory", config), async (): Promise<ToolResponse> => {
        const content = await readMemoryFile(config.projectRoot, SUMMARY_FILE);
        if (content === null) {
          return createSuccessResponse(
            { found: false, content: "" },
            "No project_summary.md found. Use godot_update_project_memory to create one.",
            [],
            ["Run godot_project_summary (Phase 9) and write the result via godot_update_project_memory."]
          );
        }
        return createSuccessResponse(
          { found: true, file: SUMMARY_FILE, content, size_bytes: Buffer.byteLength(content, "utf8") },
          "Project memory retrieved."
        );
      })
    )
  );

  // ── godot_get_architecture_notes ──────────────────────────────────────────
  server.tool(
    "godot_get_architecture_notes",
    "Return architecture notes from .godot_mcp/memory/architecture.md.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_get_architecture_notes", config), async (): Promise<ToolResponse> => {
        const content = await readMemoryFile(config.projectRoot, ARCHITECTURE_FILE);
        if (content === null) {
          return createSuccessResponse({ found: false, content: "" }, "No architecture.md found.");
        }
        return createSuccessResponse({ found: true, file: ARCHITECTURE_FILE, content }, "Architecture notes retrieved.");
      })
    )
  );

  // ── godot_get_conventions ─────────────────────────────────────────────────
  server.tool(
    "godot_get_conventions",
    "Return project conventions from .godot_mcp/memory/conventions.md.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_get_conventions", config), async (): Promise<ToolResponse> => {
        const content = await readMemoryFile(config.projectRoot, CONVENTIONS_FILE);
        if (content === null) {
          return createSuccessResponse({ found: false, content: "" }, "No conventions.md found.");
        }
        return createSuccessResponse({ found: true, file: CONVENTIONS_FILE, content }, "Conventions retrieved.");
      })
    )
  );

  // ── godot_set_convention ──────────────────────────────────────────────────
  server.tool(
    "godot_set_convention",
    "Append or update a single convention rule in conventions.md.",
    {
      key: z.string().describe("Convention identifier (slug)."),
      rule: z.string().describe("One-line description of the rule."),
      rationale: z.string().optional().describe("Optional explanation.")
    },
    async ({ key, rule, rationale }) => toMcpResult(
      await executeToolSafely(ctx("godot_set_convention", config), async (): Promise<ToolResponse> => {
        await ensureMemoryDir(config.projectRoot);
        const existing = (await readMemoryFile(config.projectRoot, CONVENTIONS_FILE)) ?? "# Project Conventions\n\n";
        const block = `\n## ${key}\n\n- **Rule:** ${rule}\n${rationale ? `- **Rationale:** ${rationale}\n` : ""}- **Updated:** ${timestamp()}\n`;
        const updated = existing.includes(`## ${key}\n`)
          ? existing.replace(new RegExp(`## ${escapeRe(key)}\\n[\\s\\S]*?(?=\\n## |$)`), block.trim() + "\n")
          : existing + block;
        await writeFile(memoryPath(config.projectRoot, CONVENTIONS_FILE), updated, "utf8");
        return createSuccessResponse({ key, file: CONVENTIONS_FILE }, "Convention recorded.");
      })
    )
  );

  // ── godot_create_decision_record ──────────────────────────────────────────
  server.tool(
    "godot_create_decision_record",
    "Create an Architecture Decision Record (ADR-style) in .godot_mcp/memory/decisions/.",
    {
      title: z.string().describe("Short title."),
      context: z.string().describe("Why the decision is needed."),
      decision: z.string().describe("What was decided."),
      consequences: z.string().optional().describe("Expected consequences.")
    },
    async ({ title, context, decision, consequences }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_decision_record", config), async (): Promise<ToolResponse> => {
        await ensureMemoryDir(config.projectRoot);
        const dir = path.join(config.projectRoot, MEMORY_DIR, DECISIONS_DIR);
        const existing = await readdir(dir).catch(() => []);
        const next = existing.filter((f) => /^\d{4}-/.test(f)).length + 1;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
        const fileName = `${String(next).padStart(4, "0")}-${slug}.md`;
        const body = [
          `# ADR ${String(next).padStart(4, "0")} — ${title}`,
          "",
          `Date: ${todayKey()}`,
          "",
          "## Context",
          "",
          context,
          "",
          "## Decision",
          "",
          decision,
          ""
        ];
        if (consequences) {
          body.push("## Consequences", "", consequences, "");
        }
        const fullPath = path.join(dir, fileName);
        await writeFile(fullPath, body.join("\n"), "utf8");
        return createSuccessResponse({ file: fileName, path: fullPath, number: next }, "Decision record created.");
      })
    )
  );

  // ── godot_search_memory ───────────────────────────────────────────────────
  server.tool(
    "godot_search_memory",
    "Search across all memory files for a substring (case-insensitive).",
    {
      query: z.string().min(1).describe("Substring to find."),
      limit: z.number().int().positive().max(200).optional().describe("Max matches. Defaults to 50.")
    },
    async ({ query, limit }) => toMcpResult(
      await executeToolSafely(ctx("godot_search_memory", config), async (): Promise<ToolResponse> => {
        const dir = path.join(config.projectRoot, MEMORY_DIR);
        const matches: Array<{ file: string; line: number; text: string }> = [];
        const max = limit ?? 50;
        const lower = query.toLowerCase();

        async function walk(absDir: string, relPrefix: string): Promise<void> {
          let entries;
          try {
            entries = await readdir(absDir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (matches.length >= max) return;
            const abs = path.join(absDir, entry.name);
            const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              await walk(abs, rel);
            } else if (entry.isFile() && entry.name.endsWith(".md")) {
              const content = await readFile(abs, "utf8").catch(() => "");
              const lines = content.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= max) break;
                if (lines[i].toLowerCase().includes(lower)) {
                  matches.push({ file: rel, line: i + 1, text: lines[i].trim() });
                }
              }
            }
          }
        }

        await walk(dir, "");
        return createSuccessResponse(
          { query, matches, count: matches.length, truncated: matches.length >= max },
          matches.length > 0 ? `Found ${matches.length} match(es).` : "No matches found."
        );
      })
    )
  );

  // ── godot_get_current_task_context ────────────────────────────────────────
  server.tool(
    "godot_get_current_task_context",
    "Return the current task context from current_task.md.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_get_current_task_context", config), async (): Promise<ToolResponse> => {
        const content = await readMemoryFile(config.projectRoot, TASK_FILE);
        if (content === null) {
          return createSuccessResponse(
            { found: false, content: "" },
            "No current_task.md set.",
            [],
            ["Use godot_update_project_memory with file='current_task' to set the current task."]
          );
        }
        return createSuccessResponse({ found: true, file: TASK_FILE, content }, "Current task context retrieved.");
      })
    )
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Suppress unused warning
export type _Unused = typeof createErrorResponse;
