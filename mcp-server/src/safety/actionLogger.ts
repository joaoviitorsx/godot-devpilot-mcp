import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type ActionLogStatus = "success" | "error" | "blocked" | "dry_run";

export type AppendActionLogInput = {
  projectRoot: string;
  toolName: string;
  status: ActionLogStatus;
  durationMs: number;
  requestId?: string;
  summary?: string;
  details?: Record<string, unknown>;
  now?: Date;
};

function omitUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export async function appendActionLog(input: AppendActionLogInput): Promise<string> {
  const logDir = path.join(input.projectRoot, ".godot_mcp", "logs");
  const logPath = path.join(logDir, "actions.jsonl");
  const now = input.now ?? new Date();

  await mkdir(logDir, { recursive: true });
  await appendFile(
    logPath,
    `${JSON.stringify(
      omitUndefined({
        timestamp: now.toISOString(),
        tool: input.toolName,
        status: input.status,
        duration_ms: input.durationMs,
        request_id: input.requestId,
        summary: input.summary,
        details: input.details
      })
    )}\n`,
    "utf8"
  );

  return logPath;
}
