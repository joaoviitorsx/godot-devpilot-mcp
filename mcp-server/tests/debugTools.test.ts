import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client";
import {
  detectStaticParseErrors,
  readRunReportEvents,
  getLastRunReportFile,
  registerDebugTools,
  runReportsDir,
  type RunReportEvent
} from "../src/tools/debugTools";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeConfig(readOnly = false, projectRoot = "/fake/project") {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full",
    security: { readOnly },
    projectRoot
  };
}

function makeGodot(callResult: unknown = { ok: true, data: {}, message: "" }): GodotClient {
  return {
    getStatus: vi.fn().mockReturnValue({ connected: true }),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    call: vi.fn().mockResolvedValue(callResult)
  } as unknown as GodotClient;
}

function makeServer() {
  const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  return {
    tool: (name: string, _desc: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      tools[name] = handler;
    },
    run: (name: string, args: Record<string, unknown> = {}) => tools[name](args)
  };
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-debug-tools-"));
  roots.push(root);
  return root;
}

async function writeRunEvent(baseDir: string, dateDir: string, fileName: string, events: RunReportEvent[]): Promise<void> {
  const dir = path.join(baseDir, dateDir);
  await mkdir(dir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(path.join(dir, fileName), lines, "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// ── detectStaticParseErrors ───────────────────────────────────────────────────

describe("detectStaticParseErrors", () => {
  it("detects missing colon on func declaration", () => {
    const content = "extends Node\n\nfunc _ready()\n\tpass\n";
    const errors = detectStaticParseErrors(content, "res://test.gd");
    expect(errors.some((e) => e.line === 3 && e.severity === "error")).toBe(true);
  });

  it("does not flag valid func with colon", () => {
    const content = "extends Node\n\nfunc _ready():\n\tpass\n";
    const errors = detectStaticParseErrors(content, "res://test.gd");
    const funcErrors = errors.filter((e) => e.message.includes("colon"));
    expect(funcErrors).toHaveLength(0);
  });

  it("does not flag func with return type annotation", () => {
    const content = "extends Node\n\nfunc get_value() -> int:\n\treturn 0\n";
    const errors = detectStaticParseErrors(content, "res://test.gd");
    const funcErrors = errors.filter((e) => e.message.includes("colon"));
    expect(funcErrors).toHaveLength(0);
  });

  it("detects Godot 3 connect syntax as warning", () => {
    const content = 'extends Node\n\nfunc _ready():\n\t$Btn.connect("pressed", self, "_on_btn")\n';
    const errors = detectStaticParseErrors(content, "res://test.gd");
    expect(errors.some((e) => e.severity === "warning" && e.message.includes("connect"))).toBe(true);
  });

  it("detects emit_signal as warning", () => {
    const content = 'extends Node\n\nfunc foo():\n\temit_signal("my_signal")\n';
    const errors = detectStaticParseErrors(content, "res://test.gd");
    expect(errors.some((e) => e.severity === "warning" && e.message.includes("emit_signal"))).toBe(true);
  });

  it("returns empty array for clean script", () => {
    const content = "extends Node\n\nfunc _ready() -> void:\n\tpass\n";
    const errors = detectStaticParseErrors(content, "res://clean.gd");
    expect(errors).toHaveLength(0);
  });
});

// ── readRunReportEvents ───────────────────────────────────────────────────────

describe("readRunReportEvents", () => {
  it("returns empty array when no run reports exist", async () => {
    const root = await makeProjectRoot();
    const events = await readRunReportEvents(root);
    expect(events).toHaveLength(0);
  });

  it("reads events from run report files", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [
      { timestamp: "2026-05-04T12:00:00Z", type: "start", data: { mode: "main_scene" } },
      { timestamp: "2026-05-04T12:00:10Z", type: "stop", data: { reason: "stopped_by_mcp" } }
    ]);

    const events = await readRunReportEvents(root);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("start");
    expect(events[1].type).toBe("stop");
  });

  it("filters events by type", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [
      { timestamp: "2026-05-04T12:00:00Z", type: "start", data: {} },
      { timestamp: "2026-05-04T12:00:05Z", type: "error", data: { message: "Script failed" } },
      { timestamp: "2026-05-04T12:00:10Z", type: "stop", data: {} }
    ]);

    const errors = await readRunReportEvents(root, 100, ["error"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe("error");
  });

  it("respects limit", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    const events: RunReportEvent[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: `2026-05-04T12:00:0${i}Z`,
      type: "output" as const,
      data: { line: i }
    }));
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", events);

    const result = await readRunReportEvents(root, 5);
    expect(result).toHaveLength(5);
  });

  it("skips malformed JSON lines gracefully", async () => {
    const root = await makeProjectRoot();
    const baseDir = path.join(runReportsDir(root), "2026-05-04");
    await mkdir(baseDir, { recursive: true });
    await writeFile(
      path.join(baseDir, "run_120000.jsonl"),
      '{"timestamp":"T","type":"start","data":{}}\nNOT_JSON\n{"timestamp":"T2","type":"stop","data":{}}\n',
      "utf8"
    );

    const events = await readRunReportEvents(root);
    expect(events).toHaveLength(2);
  });
});

// ── getLastRunReportFile ──────────────────────────────────────────────────────

describe("getLastRunReportFile", () => {
  it("returns null when no reports exist", async () => {
    const root = await makeProjectRoot();
    const result = await getLastRunReportFile(root);
    expect(result).toBeNull();
  });

  it("returns the most recent run report file", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-03", "run_090000.jsonl", [{ timestamp: "T", type: "start", data: {} }]);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [{ timestamp: "T", type: "start", data: {} }]);

    const result = await getLastRunReportFile(root);
    expect(result).not.toBeNull();
    expect(result?.date).toBe("2026-05-04");
    expect(result?.file).toBe("run_120000.jsonl");
  });
});

// ── Tool registration and behavior ────────────────────────────────────────────

describe("registerDebugTools — read-only behavior", () => {
  it("godot_run_project is blocked in read-only mode", async () => {
    const root = await makeProjectRoot();
    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(true, root) as never);

    const result = parse(await server.run("godot_run_project") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("READ_ONLY_MODE");
  });

  it("godot_stop_project is blocked in read-only mode", async () => {
    const root = await makeProjectRoot();
    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(true, root) as never);

    const result = parse(await server.run("godot_stop_project") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("READ_ONLY_MODE");
  });

  it("godot_is_game_running is allowed in read-only mode", async () => {
    const root = await makeProjectRoot();
    const server = makeServer();
    registerDebugTools(server as never, makeGodot({ ok: true, data: { running: false }, message: "Running: false." }), makeConfig(true, root) as never);

    const result = parse(await server.run("godot_is_game_running") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
  });

  it("godot_get_output_logs is allowed in read-only mode", async () => {
    const root = await makeProjectRoot();
    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(true, root) as never);

    const result = parse(await server.run("godot_get_output_logs") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.events).toHaveLength(0);
  });
});

describe("registerDebugTools — output logs", () => {
  it("godot_get_output_logs returns events from run reports", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [
      { timestamp: "T", type: "output", data: { line: "Player spawned" } },
      { timestamp: "T2", type: "error", data: { message: "NullReference" } }
    ]);

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_get_output_logs", { type: "error" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.events[0].type).toBe("error");
  });

  it("godot_get_debugger_errors filters to errors only", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [
      { timestamp: "T", type: "output", data: {} },
      { timestamp: "T2", type: "error", data: { message: "Err1" } },
      { timestamp: "T3", type: "error", data: { message: "Err2" } }
    ]);

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_get_debugger_errors") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(2);
  });
});

describe("registerDebugTools — assert_no_errors", () => {
  it("returns error when no run report exists", async () => {
    const root = await makeProjectRoot();
    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_assert_no_errors") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("NO_RUN_REPORT");
  });

  it("returns ok=false when last run had errors", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [
      { timestamp: "T", type: "start", data: {} },
      { timestamp: "T2", type: "error", data: { message: "boom" } }
    ]);

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_assert_no_errors") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("RUN_HAD_ERRORS");
  });

  it("returns ok=true when last run had no errors", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [
      { timestamp: "T", type: "start", data: {} },
      { timestamp: "T2", type: "stop", data: {} }
    ]);

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_assert_no_errors") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.has_errors).toBe(false);
  });
});

describe("registerDebugTools — clear_logs", () => {
  it("dry_run=true does not delete files", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [{ timestamp: "T", type: "start", data: {} }]);

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_clear_logs", { dry_run: true }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);

    const stillExists = await readRunReportEvents(root);
    expect(stillExists).toHaveLength(1);
  });

  it("dry_run=false deletes run report dirs", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [{ timestamp: "T", type: "start", data: {} }]);

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    await server.run("godot_clear_logs", { dry_run: false });
    const events = await readRunReportEvents(root);
    expect(events).toHaveLength(0);
  });
});

describe("registerDebugTools — get_script_parse_errors", () => {
  it("returns parse errors for a single script", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Bad.gd"), "extends Node\n\nfunc broken()\n\tpass\n", "utf8");

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_get_script_parse_errors", { path: "res://scripts/Bad.gd" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.error_count).toBeGreaterThan(0);
  });

  it("returns no errors for a clean script", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Good.gd"), "extends Node\n\nfunc _ready() -> void:\n\tpass\n", "utf8");

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_get_script_parse_errors", { path: "res://scripts/Good.gd" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.error_count).toBe(0);
  });
});

describe("registerDebugTools — fix_errors", () => {
  it("dry_run=true returns planned_changes without modifying files", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Bad.gd"), "extends Node\n\nfunc broken()\n\tpass\n", "utf8");

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_fix_errors", { path: "res://scripts/Bad.gd", dry_run: true }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);
    expect(result.data.planned_changes.length).toBeGreaterThan(0);
  });

  it("dry_run defaults to true when omitted", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Bad.gd"), "extends Node\n\nfunc broken()\n\tpass\n", "utf8");

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_fix_errors", { path: "res://scripts/Bad.gd" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);
  });

  it("dry_run=false applies fix and creates backup", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    const scriptPath = path.join(root, "scripts", "Fixable.gd");
    await writeFile(scriptPath, "extends Node\n\nfunc broken()\n\tpass\n", "utf8");

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_fix_errors", { path: "res://scripts/Fixable.gd", dry_run: false }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.applied).toBeGreaterThan(0);

    const { readFile: rf } = await import("node:fs/promises");
    const fixed = await rf(scriptPath, "utf8");
    expect(fixed).toContain("func broken():");
  });

  it("fix_errors is blocked in read-only mode", async () => {
    const root = await makeProjectRoot();
    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(true, root) as never);

    const result = parse(await server.run("godot_fix_errors", { path: "res://scripts/X.gd", dry_run: false }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("READ_ONLY_MODE");
  });
});

describe("registerDebugTools — get_last_run_report", () => {
  it("returns found=false when no reports exist", async () => {
    const root = await makeProjectRoot();
    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_get_last_run_report") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.found).toBe(false);
  });

  it("returns run summary from most recent report", async () => {
    const root = await makeProjectRoot();
    const baseDir = runReportsDir(root);
    await writeRunEvent(baseDir, "2026-05-04", "run_120000.jsonl", [
      { timestamp: "2026-05-04T12:00:00Z", type: "start", data: { mode: "main_scene" } },
      { timestamp: "2026-05-04T12:00:05Z", type: "error", data: { message: "boom" } },
      { timestamp: "2026-05-04T12:00:10Z", type: "stop", data: {} }
    ]);

    const server = makeServer();
    registerDebugTools(server as never, makeGodot(), makeConfig(false, root) as never);

    const result = parse(await server.run("godot_get_last_run_report") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.found).toBe(true);
    expect(result.data.error_count).toBe(1);
    expect(result.data.output_count).toBe(0);
  });
});
