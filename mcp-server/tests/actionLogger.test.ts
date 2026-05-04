import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendActionLog } from "../src/utils/logger";

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-log-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("appendActionLog", () => {
  it("appends one valid JSONL action entry", async () => {
    const root = await makeProjectRoot();

    const logPath = await appendActionLog({
      projectRoot: root,
      toolName: "godot_health_check",
      status: "success",
      durationMs: 17,
      requestId: "request-1",
      summary: "health checked",
      now: new Date("2026-05-03T10:00:00.000Z")
    });

    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-05-03T10:00:00.000Z",
      tool: "godot_health_check",
      status: "success",
      duration_ms: 17,
      request_id: "request-1",
      summary: "health checked"
    });
  });
});
