import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readdir, readFile, rm, access, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const SNAPSHOT_BASE = ".devpilot/snapshots";

async function listSnapshotIds(projectRoot: string): Promise<Array<{ id: string; created_at: string }>> {
  const base = path.join(projectRoot, SNAPSHOT_BASE);
  if (!(await fileExists(base))) return [];
  const entries = await readdir(base, { withFileTypes: true });
  const out: Array<{ id: string; created_at: string }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const meta = path.join(base, e.name, "snapshot.json");
    let created_at = "";
    if (await fileExists(meta)) {
      try {
        const j = JSON.parse(await readFile(meta, "utf8"));
        created_at = String(j.created_at ?? "");
      } catch { /* ignore */ }
    }
    if (!created_at) {
      try {
        const st = await stat(path.join(base, e.name));
        created_at = new Date(st.mtimeMs).toISOString();
      } catch { /* ignore */ }
    }
    out.push({ id: e.name, created_at });
  }
  out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return out;
}

async function diffDirs(a: string, b: string): Promise<{ only_in_a: string[]; only_in_b: string[]; modified: string[] }> {
  async function walkRel(root: string): Promise<Set<string>> {
    const out = new Set<string>();
    if (!(await fileExists(root))) return out;
    const fs = await import("node:fs/promises");
    async function rec(d: string, rel: string): Promise<void> {
      let entries;
      try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await rec(path.join(d, e.name), r);
        else out.add(r);
      }
    }
    await rec(root, "");
    return out;
  }
  const setA = await walkRel(a);
  const setB = await walkRel(b);
  const only_in_a: string[] = [];
  const only_in_b: string[] = [];
  const modified: string[] = [];
  for (const f of setA) {
    if (!setB.has(f)) only_in_a.push(f);
    else {
      try {
        const ca = await readFile(path.join(a, f));
        const cb = await readFile(path.join(b, f));
        if (!ca.equals(cb)) modified.push(f);
      } catch { /* ignore */ }
    }
  }
  for (const f of setB) {
    if (!setA.has(f)) only_in_b.push(f);
  }
  return { only_in_a, only_in_b, modified };
}

export function registerSnapshotMaintenanceTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_prune_snapshots",
    "Delete older snapshots, keeping the most recent N. Snapshots accumulate disk usage; prune periodically.",
    {
      keep_last: z.number().int().min(1).max(50).optional().default(10),
      confirm: z.boolean().describe("Required true — destructive."),
    },
    async ({ keep_last, confirm }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_prune_snapshots", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          if (!confirm) return createErrorResponse("CONFIRM_REQUIRED", "Pass confirm=true to delete snapshots.", {}, []);
          const list = await listSnapshotIds(config.projectRoot);
          const keep = list.slice(0, keep_last);
          const drop = list.slice(keep_last);
          for (const s of drop) {
            try {
              await rm(path.join(config.projectRoot, SNAPSHOT_BASE, s.id), { recursive: true, force: true });
            } catch { /* ignore */ }
          }
          return createSuccessResponse(
            { kept: keep.map((k) => k.id), pruned: drop.map((d) => d.id), pruned_count: drop.length },
            `Pruned ${drop.length} snapshot(s); kept ${keep.length}.`,
          );
        })
      )
  );

  server.tool(
    "devpilot_diff_snapshot",
    "Diff a snapshot vs current project state. Reports added/removed/modified files within scenes/, scripts/, project.godot.",
    {
      id: z.string(),
    },
    async ({ id }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_diff_snapshot", config), async (): Promise<ToolResponse> => {
          const snapDir = path.join(config.projectRoot, SNAPSHOT_BASE, id);
          if (!(await fileExists(snapDir))) {
            return createErrorResponse("SNAPSHOT_NOT_FOUND", `Snapshot ${id} not found.`, {}, []);
          }
          const dirs = ["scenes", "scripts"];
          const result: Record<string, unknown> = {};
          for (const sub of dirs) {
            const a = path.join(snapDir, sub);
            const b = path.join(config.projectRoot, sub);
            const d = await diffDirs(a, b);
            result[sub] = { added: d.only_in_b, removed: d.only_in_a, modified: d.modified };
          }
          // project.godot single-file diff
          const projA = path.join(snapDir, "project.godot");
          const projB = path.join(config.projectRoot, "project.godot");
          let proj_modified = false;
          if (await fileExists(projA) && await fileExists(projB)) {
            const a = await readFile(projA);
            const b = await readFile(projB);
            proj_modified = !a.equals(b);
          }
          return createSuccessResponse({ id, diff: result, project_godot_modified: proj_modified }, `Diff vs '${id}' computed.`);
        })
      )
  );
}
