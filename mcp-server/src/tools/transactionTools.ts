import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { copyFile, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

type Transaction = {
  tx_id: string;
  label: string;
  started_at: string;
  status: "active" | "committed" | "rolled_back";
  files_tracked: Array<{ res_path: string; snapshot_path: string; existed: boolean }>;
  committed_at?: string;
  rolled_back_at?: string;
};

function txDir(projectRoot: string): string {
  return path.join(projectRoot, ".godot_mcp", "tx");
}

function txMetaPath(projectRoot: string, txId: string): string {
  return path.join(txDir(projectRoot), `${txId}.json`);
}

function txSnapshotDir(projectRoot: string, txId: string): string {
  return path.join(txDir(projectRoot), txId);
}

async function loadTx(projectRoot: string, txId: string): Promise<Transaction | null> {
  try {
    const content = await readFile(txMetaPath(projectRoot, txId), "utf8");
    return JSON.parse(content) as Transaction;
  } catch {
    return null;
  }
}

async function saveTx(projectRoot: string, tx: Transaction): Promise<void> {
  await mkdir(txDir(projectRoot), { recursive: true });
  await writeFile(txMetaPath(projectRoot, tx.tx_id), JSON.stringify(tx, null, 2), "utf8");
}

function genTxId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `tx_${ts}_${rand}`;
}

export function registerTransactionTools(server: McpServer, _godot: unknown, config: ServerConfig): void {
  // ── godot_begin_transaction ────────────────────────────────────────────────
  server.tool(
    "godot_begin_transaction",
    "Start a transaction by snapshotting a list of files. Returns tx_id. Use commit/rollback to finalize. Files in the project are copied to .godot_mcp/tx/<tx_id>/.",
    {
      label: z.string().describe("Human-readable transaction label, e.g. 'refactor player controller'"),
      files: z.array(z.string()).describe("Files to snapshot (res:// paths)"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_begin_transaction", config), async () => {
          if (config.security.readOnly) {
            return createErrorResponse("READ_ONLY_MODE", "Read-only mode is enabled.", {}, ["Disable read-only mode"]) as ToolResponse;
          }
          const txId = genTxId();
          const snapshotDir = txSnapshotDir(config.projectRoot, txId);
          await mkdir(snapshotDir, { recursive: true });

          const tracked: Array<{ res_path: string; snapshot_path: string; existed: boolean }> = [];

          for (const f of params.files) {
            const resolved = resolveProjectPath(f, config.projectRoot);
            const sanitizedName = resolved.relativePath.replace(/[\/]/g, "__");
            const snap = path.join(snapshotDir, sanitizedName);
            let existed = false;
            try {
              await copyFile(resolved.absolutePath, snap);
              existed = true;
            } catch {
              // File doesn't exist yet — record absence
              await writeFile(`${snap}.absent`, "", "utf8");
              existed = false;
            }
            tracked.push({ res_path: resolved.resPath, snapshot_path: snap, existed });
          }

          const tx: Transaction = {
            tx_id: txId,
            label: params.label,
            started_at: new Date().toISOString(),
            status: "active",
            files_tracked: tracked,
          };
          await saveTx(config.projectRoot, tx);

          return createSuccessResponse({
            tx_id: txId,
            label: params.label,
            files_snapshotted: tracked.length,
            snapshot_dir: snapshotDir,
            status: "active",
          }, `Transaction ${txId} started. ${tracked.length} files snapshotted.`);
        })
      )
  );

  // ── godot_commit_transaction ───────────────────────────────────────────────
  server.tool(
    "godot_commit_transaction",
    "Mark a transaction as committed. Optionally cleanup snapshot files.",
    {
      tx_id: z.string(),
      cleanup_snapshots: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_commit_transaction", config), async () => {
          const tx = await loadTx(config.projectRoot, params.tx_id);
          if (!tx) return createErrorResponse("TX_NOT_FOUND", `Transaction ${params.tx_id} not found.`, {}, []) as ToolResponse;
          if (tx.status !== "active") {
            return createErrorResponse("TX_NOT_ACTIVE", `Transaction is ${tx.status}, cannot commit.`, { status: tx.status }, []) as ToolResponse;
          }
          tx.status = "committed";
          tx.committed_at = new Date().toISOString();
          await saveTx(config.projectRoot, tx);

          if (params.cleanup_snapshots) {
            await rm(txSnapshotDir(config.projectRoot, params.tx_id), { recursive: true, force: true });
          }

          return createSuccessResponse({
            tx_id: params.tx_id,
            label: tx.label,
            status: "committed",
            committed_at: tx.committed_at,
            snapshots_cleaned: params.cleanup_snapshots,
          }, "Transaction committed.");
        })
      )
  );

  // ── godot_rollback_transaction ─────────────────────────────────────────────
  server.tool(
    "godot_rollback_transaction",
    "Restore all files snapshotted by a transaction back to their original content. Marks transaction as rolled_back.",
    {
      tx_id: z.string(),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_rollback_transaction", config), async () => {
          if (config.security.readOnly) {
            return createErrorResponse("READ_ONLY_MODE", "Read-only mode is enabled.", {}, []) as ToolResponse;
          }
          const tx = await loadTx(config.projectRoot, params.tx_id);
          if (!tx) return createErrorResponse("TX_NOT_FOUND", `Transaction ${params.tx_id} not found.`, {}, []) as ToolResponse;
          if (tx.status === "rolled_back") {
            return createErrorResponse("TX_ALREADY_ROLLED_BACK", "Already rolled back.", {}, []) as ToolResponse;
          }

          const restored: string[] = [];
          const failed: Array<{ path: string; reason: string }> = [];

          for (const f of tx.files_tracked) {
            const resolved = resolveProjectPath(f.res_path, config.projectRoot);
            try {
              if (f.existed) {
                await copyFile(f.snapshot_path, resolved.absolutePath);
                restored.push(f.res_path);
              } else {
                await rm(resolved.absolutePath, { force: true });
                restored.push(f.res_path);
              }
            } catch (e) {
              failed.push({ path: f.res_path, reason: e instanceof Error ? e.message : String(e) });
            }
          }

          tx.status = "rolled_back";
          tx.rolled_back_at = new Date().toISOString();
          await saveTx(config.projectRoot, tx);

          return createSuccessResponse({
            tx_id: params.tx_id,
            label: tx.label,
            status: "rolled_back",
            restored_count: restored.length,
            failed_count: failed.length,
            restored,
            failed,
          }, `Rolled back ${restored.length} files (${failed.length} failed).`);
        })
      )
  );

  // ── godot_list_transactions ────────────────────────────────────────────────
  server.tool(
    "godot_list_transactions",
    "List all transactions in .godot_mcp/tx/ with their status.",
    {
      filter_status: z.enum(["active", "committed", "rolled_back", "all"]).optional().default("all"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_list_transactions", config), async () => {
          const dir = txDir(config.projectRoot);
          let files: string[] = [];
          try {
            files = await readdir(dir);
          } catch {
            return createSuccessResponse({ transactions: [], count: 0 }, "No transactions yet.");
          }
          const txns: Transaction[] = [];
          for (const f of files) {
            if (!f.endsWith(".json")) continue;
            try {
              const content = await readFile(path.join(dir, f), "utf8");
              const tx = JSON.parse(content) as Transaction;
              if (params.filter_status === "all" || tx.status === params.filter_status) {
                txns.push(tx);
              }
            } catch { /* skip */ }
          }
          txns.sort((a, b) => b.started_at.localeCompare(a.started_at));
          return createSuccessResponse({
            transactions: txns.map((t) => ({
              tx_id: t.tx_id,
              label: t.label,
              status: t.status,
              started_at: t.started_at,
              files_count: t.files_tracked.length,
            })),
            count: txns.length,
          }, `Found ${txns.length} transactions.`);
        })
      )
  );
}
