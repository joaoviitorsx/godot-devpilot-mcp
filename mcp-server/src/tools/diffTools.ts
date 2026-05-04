import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: false, projectRoot: config.projectRoot };
}

// ── Line-based diff (LCS-style) ──────────────────────────────────────────────

type DiffLine = { kind: "added" | "removed" | "unchanged"; line: string; line_number_a?: number; line_number_b?: number };

function diffLines(a: string[], b: string[]): DiffLine[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift({ kind: "unchanged", line: a[i - 1], line_number_a: i, line_number_b: j });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      result.unshift({ kind: "removed", line: a[i - 1], line_number_a: i });
      i--;
    } else {
      result.unshift({ kind: "added", line: b[j - 1], line_number_b: j });
      j--;
    }
  }
  while (i > 0) { result.unshift({ kind: "removed", line: a[i - 1], line_number_a: i }); i--; }
  while (j > 0) { result.unshift({ kind: "added", line: b[j - 1], line_number_b: j }); j--; }
  return result;
}

function unifiedDiff(diff: DiffLine[], pathA: string, pathB: string, contextLines = 3): string {
  const out: string[] = [];
  out.push(`--- ${pathA}`);
  out.push(`+++ ${pathB}`);
  let i = 0;
  while (i < diff.length) {
    if (diff[i].kind === "unchanged") { i++; continue; }
    const hunkStart = Math.max(0, i - contextLines);
    let hunkEnd = i;
    while (hunkEnd < diff.length && (diff[hunkEnd].kind !== "unchanged" || (hunkEnd + 1 < diff.length && diff.slice(hunkEnd, Math.min(hunkEnd + contextLines + 1, diff.length)).some((l) => l.kind !== "unchanged")))) {
      hunkEnd++;
    }
    hunkEnd = Math.min(diff.length, hunkEnd + contextLines);
    const hunk = diff.slice(hunkStart, hunkEnd);
    const aStart = hunk.find((l) => l.line_number_a)?.line_number_a ?? 0;
    const bStart = hunk.find((l) => l.line_number_b)?.line_number_b ?? 0;
    const aCount = hunk.filter((l) => l.kind !== "added").length;
    const bCount = hunk.filter((l) => l.kind !== "removed").length;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const l of hunk) {
      if (l.kind === "added") out.push(`+${l.line}`);
      else if (l.kind === "removed") out.push(`-${l.line}`);
      else out.push(` ${l.line}`);
    }
    i = hunkEnd;
  }
  return out.join("\n");
}

// ── TSCN parser (lightweight) ────────────────────────────────────────────────

type SceneNode = { name: string; type: string; parent: string; properties: Record<string, string> };

function parseTscn(content: string): SceneNode[] {
  const nodes: SceneNode[] = [];
  const lines = content.split("\n");
  let current: SceneNode | null = null;
  for (const line of lines) {
    const nodeMatch = line.match(/^\[node name="([^"]+)"(?:\s+type="([^"]+)")?(?:\s+parent="([^"]*)")?/);
    if (nodeMatch) {
      if (current) nodes.push(current);
      current = { name: nodeMatch[1], type: nodeMatch[2] ?? "", parent: nodeMatch[3] ?? "", properties: {} };
      continue;
    }
    if (current) {
      const propMatch = line.match(/^([a-z_][a-z0-9_/]*)\s*=\s*(.+)$/i);
      if (propMatch) current.properties[propMatch[1]] = propMatch[2];
    }
  }
  if (current) nodes.push(current);
  return nodes;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerDiffTools(server: McpServer, _godot: unknown, config: ServerConfig): void {
  // ── godot_diff_file ────────────────────────────────────────────────────────
  server.tool(
    "godot_diff_file",
    "Compare a file's current content with proposed content. Returns added/removed/unchanged line counts and unified diff. No mutation.",
    {
      path: z.string().describe("File path (res:// or absolute) inside project root"),
      proposed_content: z.string().describe("Proposed new content to diff against the current file"),
      context_lines: z.number().int().min(0).max(20).optional().default(3),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_diff_file", config), async () => {
          const resolved = resolveProjectPath(params.path, config.projectRoot);
          let currentContent = "";
          try {
            currentContent = await readFile(resolved.absolutePath, "utf8");
          } catch {
            currentContent = "";
          }
          const aLines = currentContent.split("\n");
          const bLines = params.proposed_content.split("\n");
          const diff = diffLines(aLines, bLines);
          const added = diff.filter((d) => d.kind === "added").length;
          const removed = diff.filter((d) => d.kind === "removed").length;
          const unchanged = diff.filter((d) => d.kind === "unchanged").length;
          const unified = unifiedDiff(diff, params.path, `${params.path} (proposed)`, params.context_lines);
          return createSuccessResponse({
            path: params.path,
            added,
            removed,
            unchanged,
            total_lines_a: aLines.length,
            total_lines_b: bLines.length,
            unified_diff: unified,
            file_existed: currentContent.length > 0,
          }, `Diff: +${added} -${removed} =${unchanged}`);
        })
      )
  );

  // ── godot_diff_scene ───────────────────────────────────────────────────────
  server.tool(
    "godot_diff_scene",
    "Compare a .tscn file's current scene tree with a proposed .tscn content. Returns node-level adds/removes/changes.",
    {
      scene_path: z.string().describe("Scene path (res:// or absolute)"),
      proposed_tscn: z.string().describe("Proposed full .tscn content"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_diff_scene", config), async () => {
          const resolved = resolveProjectPath(params.scene_path, config.projectRoot);
          let currentContent = "";
          try {
            currentContent = await readFile(resolved.absolutePath, "utf8");
          } catch {
            return createErrorResponse("FILE_NOT_FOUND", `Scene file not found: ${params.scene_path}`, {}, ["Check the path"]);
          }
          const currentNodes = parseTscn(currentContent);
          const proposedNodes = parseTscn(params.proposed_tscn);

          const currentByKey = new Map(currentNodes.map((n) => [`${n.parent}/${n.name}`, n]));
          const proposedByKey = new Map(proposedNodes.map((n) => [`${n.parent}/${n.name}`, n]));

          const added: SceneNode[] = [];
          const removed: SceneNode[] = [];
          const changed: Array<{ key: string; type_changed: boolean; properties_changed: string[] }> = [];

          for (const [k, n] of proposedByKey) {
            if (!currentByKey.has(k)) added.push(n);
            else {
              const c = currentByKey.get(k)!;
              const props_changed = [];
              for (const p of new Set([...Object.keys(c.properties), ...Object.keys(n.properties)])) {
                if (c.properties[p] !== n.properties[p]) props_changed.push(p);
              }
              if (c.type !== n.type || props_changed.length > 0) {
                changed.push({ key: k, type_changed: c.type !== n.type, properties_changed: props_changed });
              }
            }
          }
          for (const [k, n] of currentByKey) if (!proposedByKey.has(k)) removed.push(n);

          return createSuccessResponse({
            scene_path: params.scene_path,
            nodes_added: added.length,
            nodes_removed: removed.length,
            nodes_changed: changed.length,
            added: added.map((n) => ({ name: n.name, type: n.type, parent: n.parent })),
            removed: removed.map((n) => ({ name: n.name, type: n.type, parent: n.parent })),
            changed,
          }, `Scene diff: +${added.length} -${removed.length} ~${changed.length}`);
        })
      )
  );
}
