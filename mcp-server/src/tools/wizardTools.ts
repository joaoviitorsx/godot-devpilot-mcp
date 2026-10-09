import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { access, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

type Severity = "ok" | "warn" | "error";

type Check = {
  id: string;
  label: string;
  severity: Severity;
  detail: string;
  fix?: string;          // suggested fix description
  autofix?: () => Promise<{ applied: boolean; note?: string }>;
};

const STANDARD_ACTIONS = [
  "move_left", "move_right", "move_up", "move_down",
  "jump", "interact", "attack", "pause",
];

async function checkProjectGodot(projectRoot: string): Promise<Check> {
  const p = path.join(projectRoot, "project.godot");
  if (!(await exists(p))) {
    return {
      id: "project_godot",
      label: "project.godot present",
      severity: "error",
      detail: "project.godot not found at project root.",
      fix: `Create or open the project at: ${projectRoot}`,
    };
  }
  return { id: "project_godot", label: "project.godot present", severity: "ok", detail: "Found at project root." };
}

async function checkScenesDir(projectRoot: string): Promise<Check> {
  const p = path.join(projectRoot, "scenes");
  if (await exists(p)) return { id: "scenes_dir", label: "scenes/ directory", severity: "ok", detail: "exists" };
  return {
    id: "scenes_dir",
    label: "scenes/ directory",
    severity: "warn",
    detail: "scenes/ folder does not exist yet.",
    fix: "Will be created automatically on first scene write.",
    autofix: async () => {
      await mkdir(p, { recursive: true });
      return { applied: true, note: "Created scenes/." };
    },
  };
}

async function checkScriptsDir(projectRoot: string): Promise<Check> {
  const p = path.join(projectRoot, "scripts");
  if (await exists(p)) return { id: "scripts_dir", label: "scripts/ directory", severity: "ok", detail: "exists" };
  return {
    id: "scripts_dir",
    label: "scripts/ directory",
    severity: "warn",
    detail: "scripts/ folder does not exist yet.",
    autofix: async () => {
      await mkdir(p, { recursive: true });
      return { applied: true, note: "Created scripts/." };
    },
  };
}

async function checkAddonInstalled(projectRoot: string): Promise<Check> {
  // Find any addon under addons/ that contains "devpilot" in its name.
  const addonsDir = path.join(projectRoot, "addons");
  if (!(await exists(addonsDir))) {
    return {
      id: "devpilot_addon_installed",
      label: "godot_devpilot addon installed",
      severity: "warn",
      detail: "No addons/ folder found. The DevPilot Godot bridge addon is required for runtime mutations.",
      fix: "Copy the addons/godot_devpilot folder from this repo into your Godot project.",
    };
  }
  try {
    const entries = await readdir(addonsDir, { withFileTypes: true });
    const found = entries.find((e) => e.isDirectory() && /devpilot/i.test(e.name));
    if (found) return { id: "devpilot_addon_installed", label: "godot_devpilot addon installed", severity: "ok", detail: `Found addons/${found.name}.` };
  } catch { /* ignore */ }
  return {
    id: "devpilot_addon_installed",
    label: "godot_devpilot addon installed",
    severity: "warn",
    detail: "addons/ exists but no devpilot addon detected.",
    fix: "Copy the addons/godot_devpilot folder from this repo into your project's addons/ directory.",
  };
}

function parseProjectGodot(content: string): Record<string, Record<string, string>> {
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

async function checkAddonEnabled(projectRoot: string): Promise<Check> {
  const p = path.join(projectRoot, "project.godot");
  if (!(await exists(p))) {
    return { id: "devpilot_addon_enabled", label: "godot_devpilot addon enabled", severity: "warn", detail: "project.godot missing — cannot verify." };
  }
  const content = await readFile(p, "utf8");
  const sections = parseProjectGodot(content);
  const editor = sections["editor_plugins"] ?? sections["plugins"] ?? {};
  const enabled = editor["enabled"] ?? "";
  if (/devpilot/i.test(enabled)) {
    return { id: "devpilot_addon_enabled", label: "godot_devpilot addon enabled", severity: "ok", detail: "Listed in project.godot [editor_plugins]." };
  }
  return {
    id: "devpilot_addon_enabled",
    label: "godot_devpilot addon enabled",
    severity: "warn",
    detail: "DevPilot addon is not enabled in project.godot. The MCP bridge will not be reachable until the addon runs in the editor.",
    fix: "Open the project in Godot → Project → Project Settings → Plugins → enable 'godot_devpilot'.",
  };
}

async function checkInputMap(projectRoot: string): Promise<Check> {
  const p = path.join(projectRoot, "project.godot");
  if (!(await exists(p))) {
    return { id: "input_map", label: "input map standard actions", severity: "warn", detail: "project.godot missing." };
  }
  const content = await readFile(p, "utf8");
  const sections = parseProjectGodot(content);
  const input = sections["input"] ?? {};
  const present = Object.keys(input);
  const missing = STANDARD_ACTIONS.filter((a) => !present.includes(a));
  if (missing.length === 0) {
    return { id: "input_map", label: "input map standard actions", severity: "ok", detail: `All ${STANDARD_ACTIONS.length} standard actions present.` };
  }
  return {
    id: "input_map",
    label: "input map standard actions",
    severity: missing.length > 4 ? "warn" : "ok",
    detail: `Missing: ${missing.join(", ")}`,
    fix: `Run devpilot_game with a CREATE prompt or call godot_add_input_action / godot_bind_key for each missing action.`,
  };
}

async function checkAutoloads(projectRoot: string): Promise<Check> {
  const p = path.join(projectRoot, "project.godot");
  if (!(await exists(p))) {
    return { id: "autoloads", label: "autoloads", severity: "warn", detail: "project.godot missing." };
  }
  const content = await readFile(p, "utf8");
  const sections = parseProjectGodot(content);
  const autoload = sections["autoload"] ?? {};
  const list = Object.keys(autoload);
  return {
    id: "autoloads",
    label: "autoloads",
    severity: "ok",
    detail: list.length === 0 ? "No autoloads registered yet." : `Registered: ${list.join(", ")}`,
  };
}

function checkReadOnly(config: ServerConfig): Check {
  if (!config.security.readOnly) {
    return { id: "read_only", label: "read-only mode", severity: "ok", detail: "Server can apply mutations." };
  }
  return {
    id: "read_only",
    label: "read-only mode",
    severity: "warn",
    detail: "GODOT_MCP_READ_ONLY is true (default). Mutating tools (devpilot_game CREATE, applyPlan, etc.) will be skipped.",
    fix: "Set GODOT_MCP_READ_ONLY=false in your MCP client config to enable writes.",
  };
}

async function checkBridgeConnected(godot: GodotClient): Promise<Check> {
  const status = godot.getStatus();
  if (status.connected) return { id: "bridge", label: "DevPilot bridge connected", severity: "ok", detail: `Connected to ${status.url ?? "?"}.` };
  // Try to connect once.
  const r = await godot.connect();
  if (r.ok) return { id: "bridge", label: "DevPilot bridge connected", severity: "ok", detail: "Connected on demand." };
  return {
    id: "bridge",
    label: "DevPilot bridge connected",
    severity: "warn",
    detail: `Bridge is not reachable: ${r.error.code} ${r.error.message}`,
    fix: "Open the project in Godot, ensure the DevPilot addon is enabled, and that the editor is running.",
  };
}

export function registerWizardTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "devpilot_init_wizard",
    "Run a first-run health check: verifies project.godot, addon install/enable, input map, autoloads, scenes/scripts dirs, read-only flag, and bridge reachability. Returns a checklist with severities and actionable fixes. Pass apply_fixes=true to auto-create missing folders (non-mutating in read-only).",
    {
      apply_fixes: z.boolean().optional().describe("Apply auto-fixable issues (create missing folders). Default false."),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_init_wizard", config), async (): Promise<ToolResponse> => {
          const checks: Check[] = [];
          checks.push(await checkProjectGodot(config.projectRoot));
          checks.push(await checkScenesDir(config.projectRoot));
          checks.push(await checkScriptsDir(config.projectRoot));
          checks.push(await checkAddonInstalled(config.projectRoot));
          checks.push(await checkAddonEnabled(config.projectRoot));
          checks.push(await checkInputMap(config.projectRoot));
          checks.push(await checkAutoloads(config.projectRoot));
          checks.push(checkReadOnly(config));
          checks.push(await checkBridgeConnected(godot));

          const applied: Array<{ id: string; note: string }> = [];
          if (params.apply_fixes && !config.security.readOnly) {
            for (const c of checks) {
              if (c.autofix && c.severity !== "ok") {
                try {
                  const r = await c.autofix();
                  if (r.applied) {
                    c.severity = "ok";
                    c.detail = `${c.detail}\n[autofix] ${r.note ?? "applied"}`;
                    applied.push({ id: c.id, note: r.note ?? "applied" });
                  }
                } catch (e) {
                  c.detail += `\n[autofix failed] ${(e as Error).message}`;
                }
              }
            }
          }

          const errors = checks.filter((c) => c.severity === "error").length;
          const warns = checks.filter((c) => c.severity === "warn").length;
          const oks = checks.filter((c) => c.severity === "ok").length;

          // Persist a compact markdown so the user has a paste-ready report.
          let reportPath: string | null = null;
          if (!config.security.readOnly) {
            const md = renderWizardMarkdown(checks);
            const mdPath = path.join(config.projectRoot, ".devpilot", "init_wizard.md");
            try {
              await mkdir(path.dirname(mdPath), { recursive: true });
              await writeFile(mdPath, md, "utf8");
              reportPath = mdPath;
            } catch { /* ignore */ }
          }

          const nextPrompts = errors > 0
            ? ["Fix the errors above, then re-run devpilot_init_wizard."]
            : warns > 0
              ? ["Run devpilot_init_wizard with apply_fixes=true to auto-create missing folders.", "Set GODOT_MCP_READ_ONLY=false in your MCP client config to enable writes."]
              : ["Run: devpilot_game with a prompt like 'create a top-down zelda-like with 3 enemies and inventory'."];

          return createSuccessResponse(
            {
              checks: checks.map((c) => ({ id: c.id, label: c.label, severity: c.severity, detail: c.detail, fix: c.fix })),
              applied_fixes: applied,
              report_path: reportPath,
              counts: { ok: oks, warn: warns, error: errors },
              read_only: config.security.readOnly,
            },
            `Wizard: ${oks} ok / ${warns} warn / ${errors} error.`,
            warns > 0 || errors > 0 ? checks.filter((c) => c.severity !== "ok").map((c) => `${c.label}: ${c.detail}`) : [],
            nextPrompts,
          );
        })
      )
  );
}

function renderWizardMarkdown(checks: Check[]): string {
  const lines: string[] = [
    "# DevPilot Init Wizard",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];
  for (const c of checks) {
    const icon = c.severity === "ok" ? "✓" : c.severity === "warn" ? "!" : "✗";
    lines.push(`## [${icon}] ${c.label}`);
    lines.push("");
    lines.push(c.detail);
    if (c.fix) {
      lines.push("");
      lines.push(`**Fix:** ${c.fix}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
