import { mkdtemp, rm, writeFile, mkdir, readFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { z, type ZodTypeAny } from "zod";

import type { GodotClient } from "../src/godot/client.js";

export type FakeGodot = GodotClient & {
  __callLog: Array<{ method: string; params: unknown }>;
};

export function makeFakeGodot(options: { connected?: boolean; callResult?: unknown } = {}): FakeGodot {
  const log: Array<{ method: string; params: unknown }> = [];
  const result = options.callResult ?? { ok: true, data: {}, message: "ok" };
  const f = {
    getStatus: vi.fn().mockReturnValue({ connected: options.connected ?? true, url: "ws://127.0.0.1:6505" }),
    connect: vi.fn().mockResolvedValue({ ok: true, data: {}, message: "connected" }),
    call: vi.fn().mockImplementation(async (method: string, params: unknown) => {
      log.push({ method, params });
      return result;
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    __callLog: log,
  } as unknown as FakeGodot;
  return f;
}

export function makeConfig(projectRoot: string, readOnly = false) {
  return {
    server: { name: "test", version: "0.0.0", protocolVersion: "1.0.0" },
    godot: { host: "127.0.0.1", port: 6505, timeoutMs: 5000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } },
    mode: "full" as const,
    security: { readOnly },
    projectRoot,
  };
}

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string; type: string }>; isError?: boolean }>;

export function makeServer() {
  const tools: Record<string, { handler: Handler; schema?: Record<string, ZodTypeAny> }> = {};
  return {
    tool: (name: string, _desc: string, schema: unknown, handler: Handler) => {
      const shape = (schema && typeof schema === "object") ? (schema as Record<string, ZodTypeAny>) : undefined;
      tools[name] = { handler, schema: shape };
    },
    run: (name: string, args: Record<string, unknown> = {}) => {
      if (!tools[name]) throw new Error(`Tool ${name} not registered`);
      const t = tools[name];
      let parsed: Record<string, unknown> = args;
      if (t.schema) {
        try {
          parsed = z.object(t.schema).parse(args);
        } catch (e) {
          // Pass-through; tests can opt out by skipping schema validation.
          parsed = args;
        }
      }
      return t.handler(parsed);
    },
    has: (name: string) => name in tools,
    names: () => Object.keys(tools),
  } as unknown as {
    tool: typeof tools.tool;
    run: (name: string, args?: Record<string, unknown>) => Promise<{ content: Array<{ text: string; type: string }>; isError?: boolean }>;
    has: (name: string) => boolean;
    names: () => string[];
  };
}

export function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

const _roots: string[] = [];

export async function makeTmpProject(opts: { withProjectGodot?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "devpilot-test-"));
  _roots.push(root);
  if (opts.withProjectGodot ?? true) {
    await writeFile(path.join(root, "project.godot"), `config_version=5\n\n[application]\nconfig/name="Test"\n`, "utf8");
  }
  return root;
}

export async function cleanupTmpProjects(): Promise<void> {
  await Promise.all(_roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
}

export async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function readText(p: string): Promise<string> {
  return readFile(p, "utf8");
}

export { mkdir, writeFile, readFile };
