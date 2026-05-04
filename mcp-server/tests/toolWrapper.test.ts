import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSuccessResponse, createErrorResponse } from "../src/godot/protocol";
import { SafetyError } from "../src/safety/errors";
import { executeToolSafely, type ToolExecutionContext } from "../src/safety/toolWrapper";

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-wrapper-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function readActionLog(projectRoot: string): Promise<string> {
  const logPath = path.join(projectRoot, ".godot_mcp", "logs", "actions.jsonl");
  return readFile(logPath, "utf8").catch(() => "");
}

describe("executeToolSafely", () => {
  it("returns handler result on success and logs it", async () => {
    const root = await makeProjectRoot();
    const ctx: ToolExecutionContext = {
      toolName: "godot_get_project_info",
      readOnly: false,
      projectRoot: root,
      requestId: "req-1"
    };

    const result = await executeToolSafely(ctx, async () =>
      createSuccessResponse({ name: "MyProject" }, "Project loaded.")
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ name: "MyProject" });
    }

    const log = await readActionLog(root);
    expect(log).toContain('"status":"success"');
    expect(log).toContain('"tool":"godot_get_project_info"');
    expect(log).toContain('"request_id":"req-1"');
  });

  it("returns error response and logs it when handler returns failure", async () => {
    const root = await makeProjectRoot();
    const ctx: ToolExecutionContext = { toolName: "godot_write_file", readOnly: false, projectRoot: root };

    const result = await executeToolSafely(ctx, async () =>
      createErrorResponse("GODOT_NOT_CONNECTED", "Godot is not connected.", {}, [])
    );

    expect(result.ok).toBe(false);

    const log = await readActionLog(root);
    expect(log).toContain('"status":"error"');
    expect(log).toContain('"tool":"godot_write_file"');
  });

  it("blocks mutable tool in read-only mode and logs blocked", async () => {
    const root = await makeProjectRoot();
    const ctx: ToolExecutionContext = { toolName: "godot_write_file", readOnly: true, projectRoot: root };

    const result = await executeToolSafely(ctx, async () =>
      createSuccessResponse({}, "Should not reach this.")
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("READ_ONLY_MODE");
    }

    const log = await readActionLog(root);
    expect(log).toContain('"status":"blocked"');
    expect(log).toContain('"tool":"godot_write_file"');
  });

  it("allows read-only tools in read-only mode", async () => {
    const root = await makeProjectRoot();
    const ctx: ToolExecutionContext = { toolName: "godot_read_file", readOnly: true, projectRoot: root };

    const result = await executeToolSafely(ctx, async () =>
      createSuccessResponse({ content: "extends Node" }, "File read.")
    );

    expect(result.ok).toBe(true);
  });

  it("catches SafetyError thrown by handler and returns error response", async () => {
    const root = await makeProjectRoot();
    const ctx: ToolExecutionContext = { toolName: "godot_write_file", readOnly: false, projectRoot: root };

    const result = await executeToolSafely(ctx, async () => {
      throw new SafetyError("PATH_OUTSIDE_PROJECT", "Path escapes sandbox.", { path: "../evil" }, []);
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PATH_OUTSIDE_PROJECT");
    }

    const log = await readActionLog(root);
    expect(log).toContain('"status":"blocked"');
  });

  it("catches unexpected errors thrown by handler and returns TOOL_EXECUTION_FAILED", async () => {
    const root = await makeProjectRoot();
    const ctx: ToolExecutionContext = { toolName: "godot_write_file", readOnly: false, projectRoot: root };

    const result = await executeToolSafely(ctx, async () => {
      throw new Error("Disk full");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TOOL_EXECUTION_FAILED");
      expect(result.error.details).toMatchObject({ cause: "Disk full" });
    }

    const log = await readActionLog(root);
    expect(log).toContain('"status":"error"');
  });

  it("does not throw when action log cannot be written", async () => {
    const ctx: ToolExecutionContext = {
      toolName: "godot_get_project_info",
      readOnly: false,
      projectRoot: "/nonexistent/path/that/cannot/be/created"
    };

    await expect(
      executeToolSafely(ctx, async () => createSuccessResponse({}, "ok"))
    ).resolves.toMatchObject({ ok: true });
  });
});
