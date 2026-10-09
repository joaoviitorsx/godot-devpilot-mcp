import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { readManifest } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function resToAbs(projectRoot: string, resPath: string): string {
  return path.join(projectRoot, resPath.replace(/^res:\/\//, ""));
}

async function readProjectGodot(projectRoot: string): Promise<Record<string, Record<string, string>>> {
  const file = path.join(projectRoot, "project.godot");
  if (!(await fileExists(file))) return {};
  const content = await readFile(file, "utf8");
  const sections: Record<string, Record<string, string>> = {};
  let current = "_root";
  sections[current] = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      current = sec[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    sections[current][key] = val;
  }
  return sections;
}

async function countFilesGlob(projectRoot: string, glob: string): Promise<number> {
  // Minimal glob: supports prefix dir + extension match. e.g., "scenes/**/*.tscn"
  const m = glob.match(/^([^*]*)\*\*\/\*\.(\w+)$/);
  let total = 0;
  if (m) {
    const dir = path.join(projectRoot, m[1].replace(/^res:\/\//, ""));
    const ext = "." + m[2];
    if (!(await fileExists(dir))) return 0;
    async function walk(d: string): Promise<void> {
      let entries;
      try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory() && !e.name.startsWith(".")) await walk(p);
        else if (e.isFile() && e.name.endsWith(ext)) total++;
      }
    }
    await walk(dir);
    return total;
  }
  // Fallback exact path
  const abs = resToAbs(projectRoot, glob);
  return (await fileExists(abs)) ? 1 : 0;
}

const CriterionSchema = z.union([
  z.object({ type: z.literal("file_exists"), path: z.string() }),
  z.object({ type: z.literal("file_count"), pattern: z.string(), min: z.number().optional(), max: z.number().optional() }),
  z.object({ type: z.literal("autoload_exists"), name: z.string() }),
  z.object({ type: z.literal("input_action_exists"), action: z.string() }),
  z.object({ type: z.literal("main_scene_is"), path: z.string() }),
  z.object({ type: z.literal("blueprint_applied"), name: z.string() }),
  z.object({ type: z.literal("script_extends"), path: z.string(), base: z.string() }),
  z.object({ type: z.literal("script_has_signal"), path: z.string(), signal: z.string() }),
  z.object({ type: z.literal("project_setting"), key: z.string(), expected: z.string().optional() }),
]);

type Criterion = z.infer<typeof CriterionSchema>;

type CheckResult = { criterion: Criterion; passed: boolean; detail: string; label: string };

async function evalCriterion(c: Criterion, config: ServerConfig): Promise<CheckResult> {
  const root = config.projectRoot;
  switch (c.type) {
    case "file_exists": {
      const ok = await fileExists(resToAbs(root, c.path));
      return { criterion: c, passed: ok, detail: ok ? "file present" : "file missing", label: `file_exists ${c.path}` };
    }
    case "file_count": {
      const n = await countFilesGlob(root, c.pattern);
      let ok = true;
      if (c.min !== undefined && n < c.min) ok = false;
      if (c.max !== undefined && n > c.max) ok = false;
      return { criterion: c, passed: ok, detail: `count=${n} (min=${c.min ?? "-"}, max=${c.max ?? "-"})`, label: `file_count ${c.pattern}` };
    }
    case "autoload_exists": {
      const sections = await readProjectGodot(root);
      const path = sections.autoload?.[c.name];
      if (!path) return { criterion: c, passed: false, detail: "not registered in [autoload]", label: `autoload ${c.name}` };
      const enabled = path.startsWith("\"*") || path.includes("\"*");
      return { criterion: c, passed: enabled, detail: enabled ? "registered + enabled (*)" : `registered but disabled (missing * prefix). path=${path}`, label: `autoload ${c.name}` };
    }
    case "input_action_exists": {
      const sections = await readProjectGodot(root);
      const ok = !!sections.input?.[c.action];
      return { criterion: c, passed: ok, detail: ok ? "action defined" : "action missing", label: `input ${c.action}` };
    }
    case "main_scene_is": {
      const sections = await readProjectGodot(root);
      const cur = (sections.application?.["run/main_scene"] ?? "").replace(/"/g, "");
      const ok = cur === c.path;
      return { criterion: c, passed: ok, detail: `current=${cur || "(none)"}`, label: `main_scene_is ${c.path}` };
    }
    case "blueprint_applied": {
      const m = await readManifest(root);
      const ok = m.blueprints_applied.some((b) => b.name === c.name);
      return { criterion: c, passed: ok, detail: ok ? "manifest records blueprint" : "blueprint never applied", label: `blueprint ${c.name}` };
    }
    case "script_extends": {
      const abs = resToAbs(root, c.path);
      if (!(await fileExists(abs))) return { criterion: c, passed: false, detail: "script not found", label: `extends ${c.path}` };
      const content = await readFile(abs, "utf8");
      const re = new RegExp(`^extends\\s+${c.base}\\b`, "m");
      const ok = re.test(content);
      return { criterion: c, passed: ok, detail: ok ? "matches" : "extends mismatch", label: `extends ${c.path} ${c.base}` };
    }
    case "script_has_signal": {
      const abs = resToAbs(root, c.path);
      if (!(await fileExists(abs))) return { criterion: c, passed: false, detail: "script not found", label: `signal ${c.path}` };
      const content = await readFile(abs, "utf8");
      const re = new RegExp(`^signal\\s+${c.signal}\\b`, "m");
      const ok = re.test(content);
      return { criterion: c, passed: ok, detail: ok ? "signal declared" : "signal missing", label: `signal ${c.signal}` };
    }
    case "project_setting": {
      const sections = await readProjectGodot(root);
      const [section, ...rest] = c.key.split("/");
      const restKey = rest.join("/");
      const value = sections[section]?.[restKey];
      if (value === undefined) return { criterion: c, passed: false, detail: "setting absent", label: `setting ${c.key}` };
      if (c.expected !== undefined) {
        const ok = value.replace(/"/g, "") === c.expected;
        return { criterion: c, passed: ok, detail: `value=${value}`, label: `setting ${c.key}` };
      }
      return { criterion: c, passed: true, detail: `value=${value}`, label: `setting ${c.key}` };
    }
  }
}

export function registerVerifySpecTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_verify_spec",
    "Run a checklist of acceptance criteria against the current project state. Each criterion is a typed check (file_exists, file_count, autoload_exists, input_action_exists, main_scene_is, blueprint_applied, script_extends, script_has_signal, project_setting). Returns pass/fail per criterion.",
    {
      criteria: z.array(CriterionSchema).describe("List of structured criteria to verify."),
    },
    async ({ criteria }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_verify_spec", config), async (): Promise<ToolResponse> => {
          const results: CheckResult[] = [];
          for (const c of criteria) {
            try {
              results.push(await evalCriterion(c as Criterion, config));
            } catch (e) {
              results.push({ criterion: c as Criterion, passed: false, detail: `check error: ${(e as Error).message}`, label: "error" });
            }
          }
          const passed = results.filter((r) => r.passed).length;
          const failed = results.length - passed;
          return createSuccessResponse(
            {
              results: results.map((r) => ({ label: r.label, passed: r.passed, detail: r.detail })),
              passed,
              failed,
              total: results.length,
            },
            `Spec verify: ${passed}/${results.length} passed.`
          );
        })
      )
  );
}
