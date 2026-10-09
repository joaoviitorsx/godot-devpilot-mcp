import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
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

const MANIFEST_REL = ".godot_mcp/manifest.json";

export type ProjectManifest = {
  schema_version: 1;
  generated_files: string[];                          // res:// paths created by DevPilot
  scenes: Record<string, { kind: string; uses?: string[] }>;
  scripts: Record<string, { extends?: string; class_name?: string; signals?: string[] }>;
  autoloads: Record<string, string>;                  // name → res:// path
  blueprints_applied: Array<{ name: string; params?: unknown; at: string }>;
  signals_map: Record<string, string[]>;              // signal name → emitter scripts
  notes: string[];
};

// Factory — never reuse the same array/object instance across reads, otherwise
// `m.blueprints_applied.push(...)` from one caller leaks into other roots that
// shallow-spread EMPTY_MANIFEST (subtle test/runtime corruption).
export function freshManifest(): ProjectManifest {
  return {
    schema_version: 1,
    generated_files: [],
    scenes: {},
    scripts: {},
    autoloads: {},
    blueprints_applied: [],
    signals_map: {},
    notes: [],
  };
}

export const EMPTY_MANIFEST: ProjectManifest = freshManifest();

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function readManifest(projectRoot: string): Promise<ProjectManifest> {
  const file = path.join(projectRoot, MANIFEST_REL);
  if (!(await fileExists(file))) return freshManifest();
  try {
    const content = await readFile(file, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.schema_version === 1) {
      return { ...freshManifest(), ...parsed };
    }
  } catch {
    /* ignore */
  }
  return freshManifest();
}

// Atomic write: serialize → temp file → rename. On POSIX, rename(2) is atomic.
// Eliminates the corrupt-on-crash window. A best-effort lockfile guards against
// two MCP-server processes writing concurrently.
let _writeChain: Promise<unknown> = Promise.resolve();

export async function writeManifest(projectRoot: string, m: ProjectManifest): Promise<void> {
  const file = path.join(projectRoot, MANIFEST_REL);
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  // Serialize all writes from this process into a chain.
  const next = _writeChain.then(async () => {
    const tmp = path.join(dir, `manifest.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tmp, JSON.stringify(m, null, 2), "utf8");
    const fs = await import("node:fs/promises");
    await fs.rename(tmp, file);
  });
  _writeChain = next.catch(() => undefined);
  await next;
}

// Convenience helpers used by codegen tools.
export async function recordGeneratedFile(projectRoot: string, resPath: string): Promise<void> {
  const m = await readManifest(projectRoot);
  if (!m.generated_files.includes(resPath)) m.generated_files.push(resPath);
  await writeManifest(projectRoot, m);
}

export async function recordBlueprintApplied(projectRoot: string, name: string, params?: unknown): Promise<void> {
  const m = await readManifest(projectRoot);
  m.blueprints_applied.push({ name, params, at: new Date().toISOString() });
  await writeManifest(projectRoot, m);
}

export async function recordScene(projectRoot: string, resPath: string, kind: string, uses?: string[]): Promise<void> {
  const m = await readManifest(projectRoot);
  m.scenes[resPath] = { kind, uses };
  if (!m.generated_files.includes(resPath)) m.generated_files.push(resPath);
  await writeManifest(projectRoot, m);
}

export async function recordScript(projectRoot: string, resPath: string, info: { extends?: string; class_name?: string; signals?: string[] }): Promise<void> {
  const m = await readManifest(projectRoot);
  m.scripts[resPath] = info;
  if (!m.generated_files.includes(resPath)) m.generated_files.push(resPath);
  if (info.signals) {
    for (const s of info.signals) {
      if (!m.signals_map[s]) m.signals_map[s] = [];
      if (!m.signals_map[s].includes(resPath)) m.signals_map[s].push(resPath);
    }
  }
  await writeManifest(projectRoot, m);
}

export async function recordAutoload(projectRoot: string, name: string, resPath: string): Promise<void> {
  const m = await readManifest(projectRoot);
  m.autoloads[name] = resPath;
  await writeManifest(projectRoot, m);
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerManifestTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_manifest_get",
    "Read .godot_mcp/manifest.json. Source-of-truth for files DevPilot generated, scene/script registry, autoloads, and applied blueprints. Returns empty manifest if not present.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_manifest_get", config), async (): Promise<ToolResponse> => {
          const m = await readManifest(config.projectRoot);
          return createSuccessResponse(m, `Manifest loaded (${m.generated_files.length} files, ${m.blueprints_applied.length} blueprints).`);
        })
      )
  );

  server.tool(
    "devpilot_manifest_update",
    "Merge a partial manifest patch into .godot_mcp/manifest.json. Arrays are de-duplicated; objects are shallow-merged. Use sparingly — most updates happen automatically when codegen tools record their output.",
    {
      patch: z.object({
        generated_files: z.array(z.string()).optional(),
        scenes: z.record(z.unknown()).optional(),
        scripts: z.record(z.unknown()).optional(),
        autoloads: z.record(z.string()).optional(),
        blueprints_applied: z.array(z.object({ name: z.string(), params: z.unknown().optional(), at: z.string() })).optional(),
        signals_map: z.record(z.array(z.string())).optional(),
        notes: z.array(z.string()).optional(),
      }),
    },
    async ({ patch }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_manifest_update", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) {
            return createSuccessResponse({ skipped: true }, "Read-only mode — manifest not updated.");
          }
          const m = await readManifest(config.projectRoot);
          if (patch.generated_files) {
            for (const f of patch.generated_files) {
              if (!m.generated_files.includes(f)) m.generated_files.push(f);
            }
          }
          if (patch.scenes) m.scenes = { ...m.scenes, ...(patch.scenes as Record<string, { kind: string; uses?: string[] }>) };
          if (patch.scripts) m.scripts = { ...m.scripts, ...(patch.scripts as Record<string, { extends?: string; class_name?: string; signals?: string[] }>) };
          if (patch.autoloads) m.autoloads = { ...m.autoloads, ...patch.autoloads };
          if (patch.blueprints_applied) m.blueprints_applied.push(...patch.blueprints_applied as Array<{ name: string; params?: unknown; at: string }>);
          if (patch.signals_map) {
            for (const [k, v] of Object.entries(patch.signals_map)) {
              const existing = m.signals_map[k] ?? [];
              const merged = Array.from(new Set([...existing, ...v]));
              m.signals_map[k] = merged;
            }
          }
          if (patch.notes) {
            for (const n of patch.notes) {
              if (!m.notes.includes(n)) m.notes.push(n);
            }
          }
          await writeManifest(config.projectRoot, m);
          return createSuccessResponse({ generated_files: m.generated_files.length, blueprints: m.blueprints_applied.length }, "Manifest updated.");
        })
      )
  );
}
