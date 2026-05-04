import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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

const SKIP_DIRS = new Set([".git", ".godot", ".godot_mcp", "node_modules", "addons"]);

async function findFiles(root: string, extensions: string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && SKIP_DIRS.has(e.name)) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (extensions.some((x) => e.name.endsWith(x))) out.push(full);
    }
  }
  await walk(root);
  return out;
}

type ConventionRules = {
  function_naming: "snake_case" | "camelCase" | "mixed";
  variable_naming: "snake_case" | "camelCase" | "mixed";
  constant_naming: "SCREAMING_SNAKE" | "PascalCase" | "mixed";
  class_naming: "PascalCase" | "snake_case" | "mixed";
  signal_naming: "snake_case" | "camelCase" | "mixed";
  indent_style: "tab" | "space" | "mixed";
  script_coverage_min_pct: number;
  max_node_depth: number;
};

function classifyCase(name: string): "snake_case" | "camelCase" | "PascalCase" | "SCREAMING_SNAKE" | "other" {
  if (/^[a-z][a-z0-9_]*$/.test(name) && name.includes("_")) return "snake_case";
  if (/^[a-z][a-z0-9]*$/.test(name)) return "snake_case";
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return "SCREAMING_SNAKE";
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return "PascalCase";
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return "camelCase";
  return "other";
}

function dominant<T extends string>(counts: Record<T, number>, threshold = 0.6): T | "mixed" {
  const entries = Object.entries(counts) as Array<[T, number]>;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return "mixed";
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  return sorted[0][1] / total >= threshold ? sorted[0][0] : "mixed";
}

export function registerConventionTools(server: McpServer, _godot: unknown, config: ServerConfig): void {
  // ── godot_detect_conventions ───────────────────────────────────────────────
  server.tool(
    "godot_detect_conventions",
    "Scan all .gd and .tscn files and infer project conventions (naming, indent, depth, script coverage). Returns inferred rules + sample evidence.",
    {
      persist_to_memory: z.boolean().optional().default(false).describe("Write inferred rules to .godot_mcp/memory/conventions.md"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_detect_conventions", config), async () => {
          const gdFiles = await findFiles(config.projectRoot, [".gd"]);
          const tscnFiles = await findFiles(config.projectRoot, [".tscn"]);

          const funcCases: Record<string, number> = { snake_case: 0, camelCase: 0, PascalCase: 0, SCREAMING_SNAKE: 0, other: 0 };
          const varCases: Record<string, number> = { snake_case: 0, camelCase: 0, PascalCase: 0, SCREAMING_SNAKE: 0, other: 0 };
          const constCases: Record<string, number> = { snake_case: 0, camelCase: 0, PascalCase: 0, SCREAMING_SNAKE: 0, other: 0 };
          const classCases: Record<string, number> = { snake_case: 0, camelCase: 0, PascalCase: 0, SCREAMING_SNAKE: 0, other: 0 };
          const signalCases: Record<string, number> = { snake_case: 0, camelCase: 0, PascalCase: 0, SCREAMING_SNAKE: 0, other: 0 };
          let tabIndent = 0;
          let spaceIndent = 0;

          for (const f of gdFiles) {
            const content = await readFile(f, "utf8");
            for (const line of content.split("\n")) {
              const fn = line.match(/^\s*func\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (fn) funcCases[classifyCase(fn[1])]++;
              const vr = line.match(/^\s*var\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (vr) varCases[classifyCase(vr[1])]++;
              const cn = line.match(/^\s*const\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (cn) constCases[classifyCase(cn[1])]++;
              const cls = line.match(/^class_name\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (cls) classCases[classifyCase(cls[1])]++;
              const sig = line.match(/^\s*signal\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (sig) signalCases[classifyCase(sig[1])]++;
              if (line.startsWith("\t")) tabIndent++;
              else if (line.startsWith("    ")) spaceIndent++;
            }
          }

          let scenesWithScript = 0;
          let totalScenes = tscnFiles.length;
          let maxDepth = 0;
          for (const f of tscnFiles) {
            const content = await readFile(f, "utf8");
            if (/script\s*=\s*ExtResource/.test(content)) scenesWithScript++;
            const parents = (content.match(/\[node[^\]]*parent="([^"]*)"/g) ?? []).map((m) => m.match(/parent="([^"]*)"/)?.[1] ?? "");
            const depths = parents.map((p) => p === "." ? 1 : (p.split("/").length + 1));
            if (depths.length > 0) maxDepth = Math.max(maxDepth, Math.max(...depths));
          }

          const rules: ConventionRules = {
            function_naming: dominant(funcCases) as ConventionRules["function_naming"],
            variable_naming: dominant(varCases) as ConventionRules["variable_naming"],
            constant_naming: dominant(constCases) as ConventionRules["constant_naming"],
            class_naming: dominant(classCases) as ConventionRules["class_naming"],
            signal_naming: dominant(signalCases) as ConventionRules["signal_naming"],
            indent_style: tabIndent > spaceIndent * 2 ? "tab" : spaceIndent > tabIndent * 2 ? "space" : "mixed",
            script_coverage_min_pct: totalScenes > 0 ? Math.round((scenesWithScript / totalScenes) * 100) : 0,
            max_node_depth: maxDepth,
          };

          if (params.persist_to_memory && !config.security.readOnly) {
            const memDir = path.join(config.projectRoot, ".godot_mcp", "memory");
            await mkdir(memDir, { recursive: true });
            const md = [
              "# Project Conventions (auto-detected)",
              "",
              `Detected at: ${new Date().toISOString()}`,
              "",
              "## Naming",
              `- Functions: \`${rules.function_naming}\``,
              `- Variables: \`${rules.variable_naming}\``,
              `- Constants: \`${rules.constant_naming}\``,
              `- Classes (class_name): \`${rules.class_naming}\``,
              `- Signals: \`${rules.signal_naming}\``,
              "",
              "## Style",
              `- Indent: \`${rules.indent_style}\``,
              "",
              "## Structure",
              `- Script coverage: ${rules.script_coverage_min_pct}%`,
              `- Max node depth: ${rules.max_node_depth}`,
              "",
            ].join("\n");
            await writeFile(path.join(memDir, "conventions.md"), md, "utf8");
          }

          return createSuccessResponse({
            rules,
            evidence: {
              gd_files_scanned: gdFiles.length,
              tscn_files_scanned: tscnFiles.length,
              function_case_counts: funcCases,
              variable_case_counts: varCases,
              constant_case_counts: constCases,
              indent_lines: { tab: tabIndent, space: spaceIndent },
              scenes_with_script: scenesWithScript,
              total_scenes: totalScenes,
            },
            persisted: params.persist_to_memory,
          }, "Conventions inferred from project.");
        })
      )
  );

  // ── godot_enforce_conventions ──────────────────────────────────────────────
  server.tool(
    "godot_enforce_conventions",
    "Check current project against rules (provided or auto-detected) and report violations. dry_run reports only; with dry_run=false, writes a markdown report to .godot_mcp/reports/conventions_violations.md.",
    {
      rules: z.object({
        function_naming: z.enum(["snake_case", "camelCase"]).optional(),
        variable_naming: z.enum(["snake_case", "camelCase"]).optional(),
        constant_naming: z.enum(["SCREAMING_SNAKE", "PascalCase"]).optional(),
        class_naming: z.enum(["PascalCase", "snake_case"]).optional(),
        signal_naming: z.enum(["snake_case", "camelCase"]).optional(),
        indent_style: z.enum(["tab", "space"]).optional(),
      }).optional().describe("Rules to enforce. If omitted, auto-detect first."),
      dry_run: z.boolean().optional().default(true),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_enforce_conventions", config), async () => {
          const gdFiles = await findFiles(config.projectRoot, [".gd"]);
          const violations: Array<{ file: string; line: number; symbol: string; expected: string; actual: string; kind: string }> = [];

          const rules = params.rules ?? {};
          for (const f of gdFiles) {
            const content = await readFile(f, "utf8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const fn = line.match(/^\s*func\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (fn && rules.function_naming) {
                const c = classifyCase(fn[1]);
                if (c !== rules.function_naming && c !== "other") {
                  violations.push({ file: path.relative(config.projectRoot, f), line: i + 1, symbol: fn[1], expected: rules.function_naming, actual: c, kind: "function" });
                }
              }
              const vr = line.match(/^\s*var\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (vr && rules.variable_naming) {
                const c = classifyCase(vr[1]);
                if (c !== rules.variable_naming && c !== "other") {
                  violations.push({ file: path.relative(config.projectRoot, f), line: i + 1, symbol: vr[1], expected: rules.variable_naming, actual: c, kind: "variable" });
                }
              }
              const cn = line.match(/^\s*const\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (cn && rules.constant_naming) {
                const c = classifyCase(cn[1]);
                if (c !== rules.constant_naming && c !== "other") {
                  violations.push({ file: path.relative(config.projectRoot, f), line: i + 1, symbol: cn[1], expected: rules.constant_naming, actual: c, kind: "constant" });
                }
              }
              const sig = line.match(/^\s*signal\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
              if (sig && rules.signal_naming) {
                const c = classifyCase(sig[1]);
                if (c !== rules.signal_naming && c !== "other") {
                  violations.push({ file: path.relative(config.projectRoot, f), line: i + 1, symbol: sig[1], expected: rules.signal_naming, actual: c, kind: "signal" });
                }
              }
            }
          }

          let report_path: string | null = null;
          if (!params.dry_run && !config.security.readOnly) {
            const reportDir = path.join(config.projectRoot, ".godot_mcp", "reports");
            await mkdir(reportDir, { recursive: true });
            const lines = [
              "# Convention Violations Report",
              "",
              `Generated: ${new Date().toISOString()}`,
              `Total violations: ${violations.length}`,
              "",
              "| File | Line | Kind | Symbol | Expected | Actual |",
              "| --- | --- | --- | --- | --- | --- |",
              ...violations.map((v) => `| ${v.file} | ${v.line} | ${v.kind} | \`${v.symbol}\` | ${v.expected} | ${v.actual} |`),
            ];
            report_path = path.join(reportDir, "conventions_violations.md");
            await writeFile(report_path, lines.join("\n"), "utf8");
          }

          return createSuccessResponse({
            total_violations: violations.length,
            files_with_violations: new Set(violations.map((v) => v.file)).size,
            violations: violations.slice(0, 100),
            truncated: violations.length > 100,
            report_path,
            dry_run: params.dry_run,
          }, `Found ${violations.length} convention violations.`);
        })
      )
  );
}
