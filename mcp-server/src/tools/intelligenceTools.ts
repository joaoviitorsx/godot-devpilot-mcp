import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import {
  buildDependencyGraph,
  buildProjectSummary,
  buildSignalMap,
  checkConventions,
  indexProject,
  type DependencyGraph,
  type SignalConnection
} from "../indexer/projectIndexer.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

const cacheDir = (root: string) => path.join(root, ".godot_mcp", "intel");
const depGraphPath = (root: string) => path.join(cacheDir(root), "dependency_graph.json");
const signalMapPath = (root: string) => path.join(cacheDir(root), "signal_map.json");

async function readJsonCache<T>(p: string): Promise<T | null> {
  try {
    const content = await readFile(p, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJsonCache(p: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

export function registerIntelligenceTools(server: McpServer, config: ServerConfig): void {
  // ── godot_project_summary ──────────────────────────────────────────────────
  server.tool(
    "godot_project_summary",
    "Generate a structural summary of the project (counts, main scene, largest files).",
    { include_assets: z.boolean().optional().describe("Include asset list (default false).") },
    async ({ include_assets }) => toMcpResult(
      await executeToolSafely(ctx("godot_project_summary", config), async (): Promise<ToolResponse> => {
        const summary = await buildProjectSummary(config.projectRoot);
        const data: Record<string, unknown> = { summary };
        if (include_assets) {
          const files = await indexProject(config.projectRoot);
          data.assets = files.filter((f) => f.kind === "asset").map((f) => f.res_path);
        }
        return createSuccessResponse(data, "Project summary generated.");
      })
    )
  );

  // ── godot_build_dependency_graph ──────────────────────────────────────────
  server.tool(
    "godot_build_dependency_graph",
    "Build dependency graph (preload/load/extends/scene_resource) and cache it to .godot_mcp/intel/dependency_graph.json.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_build_dependency_graph", config), async (): Promise<ToolResponse> => {
        const graph = await buildDependencyGraph(config.projectRoot);
        await writeJsonCache(depGraphPath(config.projectRoot), graph);
        return createSuccessResponse(
          { node_count: graph.nodes.length, edge_count: graph.edges.length, cached_at: depGraphPath(config.projectRoot) },
          "Dependency graph built and cached."
        );
      })
    )
  );

  // ── godot_get_dependency_graph ────────────────────────────────────────────
  server.tool(
    "godot_get_dependency_graph",
    "Return cached dependency graph. Builds it if cache is missing.",
    { rebuild: z.boolean().optional().describe("Force rebuild before returning.") },
    async ({ rebuild }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_dependency_graph", config), async (): Promise<ToolResponse> => {
        let graph = rebuild ? null : await readJsonCache<DependencyGraph>(depGraphPath(config.projectRoot));
        if (!graph) {
          graph = await buildDependencyGraph(config.projectRoot);
          await writeJsonCache(depGraphPath(config.projectRoot), graph);
        }
        return createSuccessResponse({ graph }, "Dependency graph retrieved.");
      })
    )
  );

  // ── godot_build_signal_map ────────────────────────────────────────────────
  server.tool(
    "godot_build_signal_map",
    "Scan all .tscn files for signal connections and cache them to .godot_mcp/intel/signal_map.json.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_build_signal_map", config), async (): Promise<ToolResponse> => {
        const connections = await buildSignalMap(config.projectRoot);
        await writeJsonCache(signalMapPath(config.projectRoot), connections);
        return createSuccessResponse(
          { count: connections.length, cached_at: signalMapPath(config.projectRoot) },
          "Signal map built and cached."
        );
      })
    )
  );

  // ── godot_get_signal_map ──────────────────────────────────────────────────
  server.tool(
    "godot_get_signal_map",
    "Return cached signal map. Builds it if cache is missing.",
    { rebuild: z.boolean().optional().describe("Force rebuild before returning.") },
    async ({ rebuild }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_signal_map", config), async (): Promise<ToolResponse> => {
        let connections = rebuild ? null : await readJsonCache<SignalConnection[]>(signalMapPath(config.projectRoot));
        if (!connections) {
          connections = await buildSignalMap(config.projectRoot);
          await writeJsonCache(signalMapPath(config.projectRoot), connections);
        }
        return createSuccessResponse({ connections, count: connections.length }, "Signal map retrieved.");
      })
    )
  );

  // ── godot_impact_check ────────────────────────────────────────────────────
  server.tool(
    "godot_impact_check",
    "Estimate impact of a planned change (file rename/move, signal rename) using the dependency graph and signal map.",
    {
      change_type: z.enum(["rename_file", "delete_file", "rename_signal"]).describe("Type of planned change."),
      target: z.string().describe("File res:// path or signal name being changed."),
      new_value: z.string().optional().describe("New name/path (informative).")
    },
    async ({ change_type, target, new_value }) => toMcpResult(
      await executeToolSafely(ctx("godot_impact_check", config), async (): Promise<ToolResponse> => {
        const graph = (await readJsonCache<DependencyGraph>(depGraphPath(config.projectRoot)))
          ?? await buildDependencyGraph(config.projectRoot);
        const signals = (await readJsonCache<SignalConnection[]>(signalMapPath(config.projectRoot)))
          ?? await buildSignalMap(config.projectRoot);

        const affectedFiles = new Set<string>();
        const affectedSignals: SignalConnection[] = [];
        const risks: string[] = [];

        if (change_type === "rename_file" || change_type === "delete_file") {
          for (const e of graph.edges) {
            if (e.to === target) {
              affectedFiles.add(e.from);
            }
          }
          if (change_type === "delete_file" && affectedFiles.size > 0) {
            risks.push(`${affectedFiles.size} file(s) reference ${target}. Deleting will break them.`);
          }
        }

        if (change_type === "rename_signal") {
          for (const c of signals) {
            if (c.signal === target) {
              affectedSignals.push(c);
              affectedFiles.add(c.scene);
            }
          }
          if (affectedSignals.length > 0) {
            risks.push(`${affectedSignals.length} connection(s) use signal '${target}' and would need updating.`);
          }
        }

        const impactLevel = affectedFiles.size === 0 ? "none" :
          affectedFiles.size <= 2 ? "low" :
          affectedFiles.size <= 8 ? "medium" : "high";

        return createSuccessResponse(
          {
            change_type,
            target,
            new_value: new_value ?? null,
            impact_level: impactLevel,
            affected_files: [...affectedFiles].sort(),
            affected_signals: affectedSignals,
            risks
          },
          "Impact analysis completed."
        );
      })
    )
  );

  // ── godot_trace_flow ──────────────────────────────────────────────────────
  server.tool(
    "godot_trace_flow",
    "Trace dependency paths from one res:// file to another using the dependency graph.",
    {
      from: z.string().describe("Origin res:// path."),
      to: z.string().describe("Target res:// path."),
      max_depth: z.number().int().positive().max(10).optional().describe("Max search depth. Defaults to 6.")
    },
    async ({ from, to, max_depth }) => toMcpResult(
      await executeToolSafely(ctx("godot_trace_flow", config), async (): Promise<ToolResponse> => {
        const graph = (await readJsonCache<DependencyGraph>(depGraphPath(config.projectRoot)))
          ?? await buildDependencyGraph(config.projectRoot);

        const adj = new Map<string, string[]>();
        for (const e of graph.edges) {
          if (!adj.has(e.from)) adj.set(e.from, []);
          adj.get(e.from)!.push(e.to);
        }

        const limit = max_depth ?? 6;
        const paths: string[][] = [];
        const stack: { node: string; path: string[] }[] = [{ node: from, path: [from] }];
        const seen = new Set<string>();

        while (stack.length > 0) {
          const { node, path: currentPath } = stack.pop()!;
          if (currentPath.length > limit) continue;
          if (node === to && currentPath.length > 1) {
            paths.push(currentPath);
            continue;
          }
          const key = currentPath.join(">");
          if (seen.has(key)) continue;
          seen.add(key);
          for (const next of adj.get(node) ?? []) {
            if (currentPath.includes(next)) continue;
            stack.push({ node: next, path: [...currentPath, next] });
          }
        }

        return createSuccessResponse(
          { from, to, paths, count: paths.length, reachable: paths.length > 0 },
          paths.length > 0 ? `Found ${paths.length} path(s).` : "No dependency path found."
        );
      })
    )
  );

  // ── godot_detect_gameplay_systems ─────────────────────────────────────────
  server.tool(
    "godot_detect_gameplay_systems",
    "Heuristically detect gameplay systems by scanning script and scene names for common patterns.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_detect_gameplay_systems", config), async (): Promise<ToolResponse> => {
        const files = await indexProject(config.projectRoot);
        const buckets: Record<string, string[]> = {};
        const patterns: Array<[string, RegExp]> = [
          ["player", /player|character/i],
          ["enemy", /enemy|monster|foe/i],
          ["inventory", /inventory|item|backpack/i],
          ["ui", /\bui\b|hud|menu|button/i],
          ["combat", /combat|attack|weapon|damage/i],
          ["movement", /movement|controller|jump|move/i],
          ["dialog", /dialog|conversation|npc/i],
          ["audio", /audio|sound|music|sfx/i],
          ["save", /save|persist|profile/i]
        ];

        for (const f of files) {
          if (f.kind !== "script" && f.kind !== "scene") continue;
          const stem = f.res_path.split("/").pop() ?? "";
          for (const [name, re] of patterns) {
            if (re.test(stem)) {
              if (!buckets[name]) buckets[name] = [];
              buckets[name].push(f.res_path);
            }
          }
        }

        const detected = Object.keys(buckets).filter((k) => buckets[k].length > 0);
        return createSuccessResponse(
          { systems_detected: detected, buckets },
          detected.length > 0 ? `Detected ${detected.length} systems.` : "No common gameplay systems detected."
        );
      })
    )
  );

  // ── godot_analyze_architecture ────────────────────────────────────────────
  server.tool(
    "godot_analyze_architecture",
    "Architectural overview: counts, top-level dirs, dependency hubs, signal density.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_analyze_architecture", config), async (): Promise<ToolResponse> => {
        const files = await indexProject(config.projectRoot);
        const summary = await buildProjectSummary(config.projectRoot);
        const graph = await buildDependencyGraph(config.projectRoot);
        const signals = await buildSignalMap(config.projectRoot);

        const incoming = new Map<string, number>();
        for (const e of graph.edges) {
          incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
        }
        const hubs = [...incoming.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([res, c]) => ({ res_path: res, incoming_refs: c }));

        const topDirs = new Map<string, number>();
        for (const f of files) {
          const top = f.res_path.replace(/^res:\/\//, "").split("/")[0] ?? "";
          if (!top || top.includes(".")) continue;
          topDirs.set(top, (topDirs.get(top) ?? 0) + 1);
        }

        return createSuccessResponse(
          {
            summary,
            top_level_directories: [...topDirs.entries()].sort((a, b) => b[1] - a[1]).map(([dir, c]) => ({ dir, file_count: c })),
            dependency_hubs: hubs,
            signal_connections: signals.length,
            scenes_with_connections: new Set(signals.map((s) => s.scene)).size
          },
          "Architecture analyzed."
        );
      })
    )
  );

  // ── godot_validate_conventions ────────────────────────────────────────────
  server.tool(
    "godot_validate_conventions",
    "Check naming conventions for scenes, scripts, and assets.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_validate_conventions", config), async (): Promise<ToolResponse> => {
        const files = await indexProject(config.projectRoot);
        const violations = checkConventions(files);
        return createSuccessResponse(
          { violations, count: violations.length, files_scanned: files.length },
          violations.length === 0 ? "All naming conventions satisfied." : `${violations.length} naming violation(s) detected.`,
          [],
          violations.length > 0 ? ["Rename listed files to match conventions or update godot_set_convention via Phase 10 memory tools."] : []
        );
      })
    )
  );
}

// Suppress unused warning when type narrowing is reused
export type _Unused = typeof createErrorResponse;
