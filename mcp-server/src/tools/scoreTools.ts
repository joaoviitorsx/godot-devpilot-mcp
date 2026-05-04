import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: false, projectRoot: config.projectRoot };
}

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

type Snapshot = {
  taken_at: string;
  error_count: number;
  warning_count: number;
  circular_deps: number;
  unused_resources: number;
  convention_violations: number;
  fps_avg: number | null;
  score: number;
};

async function captureSnapshot(godot: GodotClient): Promise<Snapshot> {
  const errors = await callRpc(godot, "debug.get_debugger_errors", {});
  const errorCount = errors.ok && Array.isArray((errors.data as { errors?: unknown[] })?.errors)
    ? ((errors.data as { errors: unknown[] }).errors).length
    : 0;

  const circular = await callRpc(godot, "batch.detect_circular", {});
  const circularCount = circular.ok && Array.isArray((circular.data as { cycles?: unknown[] })?.cycles)
    ? ((circular.data as { cycles: unknown[] }).cycles).length
    : 0;

  const unused = await callRpc(godot, "batch.find_unused", {});
  const unusedCount = unused.ok && Array.isArray((unused.data as { unused?: unknown[] })?.unused)
    ? ((unused.data as { unused: unknown[] }).unused).length
    : 0;

  let fpsAvg: number | null = null;
  const fpsResp = await callRpc(godot, "runtime.get_fps", {});
  if (fpsResp.ok) {
    const v = (fpsResp.data as { fps?: number }).fps;
    if (typeof v === "number") fpsAvg = v;
  }

  const errorPenalty = Math.min(errorCount * 5, 40);
  const circularPenalty = Math.min(circularCount * 10, 30);
  const unusedPenalty = Math.min(unusedCount * 2, 15);
  const score = Math.max(0, 100 - errorPenalty - circularPenalty - unusedPenalty);

  return {
    taken_at: new Date().toISOString(),
    error_count: errorCount,
    warning_count: 0,
    circular_deps: circularCount,
    unused_resources: unusedCount,
    convention_violations: 0,
    fps_avg: fpsAvg,
    score,
  };
}

export function registerScoreTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_validation_snapshot ──────────────────────────────────────────────
  server.tool(
    "godot_validation_snapshot",
    "Capture a project health snapshot (errors, circular deps, unused resources, FPS) and compute score 0-100. Use before/after operations to measure regression.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("godot_validation_snapshot", config), async () => {
          const snap = await captureSnapshot(godot);
          return createSuccessResponse(snap, `Snapshot score: ${snap.score}/100`);
        })
      )
  );

  // ── godot_validation_compare ───────────────────────────────────────────────
  server.tool(
    "godot_validation_compare",
    "Compare two validation snapshots and report regressions/improvements per metric.",
    {
      before: z.object({
        score: z.number(),
        error_count: z.number(),
        circular_deps: z.number(),
        unused_resources: z.number(),
        fps_avg: z.number().nullable(),
      }).passthrough(),
      after: z.object({
        score: z.number(),
        error_count: z.number(),
        circular_deps: z.number(),
        unused_resources: z.number(),
        fps_avg: z.number().nullable(),
      }).passthrough(),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_validation_compare", config), async () => {
          const score_delta = params.after.score - params.before.score;
          const regressions: string[] = [];
          const improvements: string[] = [];

          const cmp = (label: string, before: number, after: number, lowerIsBetter = true) => {
            if (after === before) return;
            if ((after > before) === lowerIsBetter) regressions.push(`${label}: ${before} → ${after}`);
            else improvements.push(`${label}: ${before} → ${after}`);
          };

          cmp("errors", params.before.error_count, params.after.error_count);
          cmp("circular_deps", params.before.circular_deps, params.after.circular_deps);
          cmp("unused_resources", params.before.unused_resources, params.after.unused_resources);
          if (params.before.fps_avg !== null && params.after.fps_avg !== null) {
            cmp("fps_avg", params.before.fps_avg, params.after.fps_avg, false);
          }

          const verdict = score_delta > 0 ? "improved" : score_delta < 0 ? "regressed" : "unchanged";

          return createSuccessResponse({
            score_delta,
            verdict,
            before_score: params.before.score,
            after_score: params.after.score,
            regressions,
            improvements,
          }, `Score ${verdict}: ${params.before.score} → ${params.after.score} (Δ${score_delta >= 0 ? "+" : ""}${score_delta})`);
        })
      )
  );

  // ── godot_run_with_score ───────────────────────────────────────────────────
  server.tool(
    "godot_run_with_score",
    "Capture before snapshot → execute an MCP method via internal RPC → capture after snapshot → return both + delta. Useful for measuring impact of a single operation.",
    {
      method: z.string().describe("Internal RPC method, e.g. 'debug.run_project'"),
      params: z.record(z.unknown()).optional().default({}),
    },
    async (input) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_run_with_score", config), async () => {
          const before = await captureSnapshot(godot);
          const result = await callRpc(godot, input.method, input.params);
          const after = await captureSnapshot(godot);
          const score_delta = after.score - before.score;

          return createSuccessResponse({
            method: input.method,
            operation_ok: result.ok,
            operation_result: result.ok ? result.data : result.error,
            before,
            after,
            score_delta,
            verdict: score_delta > 0 ? "improved" : score_delta < 0 ? "regressed" : "unchanged",
          }, `Score: ${before.score} → ${after.score} (Δ${score_delta >= 0 ? "+" : ""}${score_delta})`);
        })
      )
  );
}
