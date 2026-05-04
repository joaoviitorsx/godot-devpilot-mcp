import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { registerMemoryTools } from "../src/tools/memoryTools";

function makeConfig(readOnly = false, projectRoot = "/fake/project") {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full",
    security: { readOnly },
    projectRoot
  };
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

async function makeRoot(): Promise<string> {
  const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-mem-"));
  roots.push(r);
  return r;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("memoryTools — read & write", () => {
  it("update + get summary roundtrip", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);

    const wrote = parse(await server.run("godot_update_project_memory", { file: "summary", content: "# Summary\n\nMy game." }) as { content: Array<{ text: string }> });
    expect(wrote.ok).toBe(true);

    const read = parse(await server.run("godot_get_project_memory") as { content: Array<{ text: string }> });
    expect(read.ok).toBe(true);
    expect(read.data.found).toBe(true);
    expect(read.data.content).toContain("My game");
  });

  it("get_project_memory returns found=false when file missing", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);
    const result = parse(await server.run("godot_get_project_memory") as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.found).toBe(false);
  });

  it("update with append=true preserves existing content", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);

    await server.run("godot_update_project_memory", { file: "architecture", content: "# Arch\n\nLine 1." });
    await server.run("godot_update_project_memory", { file: "architecture", content: "Line 2.", append: true });

    const read = parse(await server.run("godot_get_architecture_notes") as { content: Array<{ text: string }> });
    expect(read.data.content).toContain("Line 1");
    expect(read.data.content).toContain("Line 2");
  });

  it("set_convention writes a rule", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);

    await server.run("godot_set_convention", { key: "naming", rule: "Use PascalCase for scenes.", rationale: "Editor convention." });
    const read = parse(await server.run("godot_get_conventions") as { content: Array<{ text: string }> });
    expect(read.data.found).toBe(true);
    expect(read.data.content).toContain("PascalCase");
    expect(read.data.content).toContain("Editor convention");
  });

  it("set_convention upserts existing key", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);

    await server.run("godot_set_convention", { key: "naming", rule: "Old rule." });
    await server.run("godot_set_convention", { key: "naming", rule: "New rule." });
    const content = await readFile(path.join(root, ".godot_mcp/memory/conventions.md"), "utf8");
    expect(content).toContain("New rule");
    expect(content).not.toContain("Old rule");
  });

  it("create_decision_record writes ADR file", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);

    const result = parse(await server.run("godot_create_decision_record", {
      title: "Use Godot 4",
      context: "Need modern features.",
      decision: "Adopt Godot 4.3+.",
      consequences: "Some plugins must be migrated."
    }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.file).toMatch(/^0001-use-godot-4\.md$/);

    const content = await readFile(result.data.path, "utf8");
    expect(content).toContain("# ADR 0001");
    expect(content).toContain("Adopt Godot 4.3+");
  });

  it("create_decision_record increments numbering", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);

    await server.run("godot_create_decision_record", { title: "First", context: "a", decision: "b" });
    const second = parse(await server.run("godot_create_decision_record", { title: "Second", context: "a", decision: "b" }) as { content: Array<{ text: string }> });
    expect(second.data.number).toBe(2);
    expect(second.data.file).toMatch(/^0002-/);
  });

  it("search_memory finds substring across files", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);

    await server.run("godot_update_project_memory", { file: "summary", content: "# Summary\n\nThe goal is platformer." });
    await server.run("godot_update_project_memory", { file: "architecture", content: "# Arch\n\nWe use platformer controller." });

    const result = parse(await server.run("godot_search_memory", { query: "platformer" }) as { content: Array<{ text: string }> });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(2);
  });

  it("get_current_task_context returns content when file present", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(false, root) as never);

    await server.run("godot_update_project_memory", { file: "current_task", content: "Implement combat." });
    const result = parse(await server.run("godot_get_current_task_context") as { content: Array<{ text: string }> });
    expect(result.data.found).toBe(true);
    expect(result.data.content).toContain("combat");
  });

  it("read-only blocks update but allows get", async () => {
    const root = await makeRoot();
    const server = makeServer();
    registerMemoryTools(server as never, makeConfig(true, root) as never);

    const blocked = parse(await server.run("godot_update_project_memory", { file: "summary", content: "x" }) as { content: Array<{ text: string }> });
    expect(blocked.ok).toBe(false);
    expect(blocked.error.code).toBe("READ_ONLY_MODE");

    const allowed = parse(await server.run("godot_get_project_memory") as { content: Array<{ text: string }> });
    expect(allowed.ok).toBe(true);
  });
});
