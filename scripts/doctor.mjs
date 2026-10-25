#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = { project: process.cwd(), offline: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) options.project = argv[++i];
    else if (argv[i] === "--offline") options.offline = true;
    else if (argv[i] === "--json") options.json = true;
    else if (argv[i] === "--help") options.help = true;
    else throw new Error(`Unknown doctor option: ${argv[i]}`);
  }
  return options;
}

function serverName(projectRoot) {
  const slug = path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "project";
  const hash = createHash("sha256").update(projectRoot.toLowerCase()).digest("hex").slice(0, 8);
  return `godot-devpilot-${slug}-${hash}`;
}

function regularFile(filename) {
  return existsSync(filename) && lstatSync(filename).isFile();
}

function checkClient(projectRoot, name, runtimeEntry) {
  const configured = [];
  const issues = [];
  const claudePath = path.join(projectRoot, ".mcp.json");
  if (regularFile(claudePath)) {
    try {
      const entry = JSON.parse(readFileSync(claudePath, "utf8"))?.mcpServers?.[name];
      if (entry?.args?.includes(runtimeEntry) && entry?.env?.GODOT_MCP_PROJECT_ROOT === projectRoot) configured.push("Claude Code");
      else if (entry) issues.push("Claude Code entry points to a different runtime or project; rerun godopilot in this folder.");
    } catch {
      issues.push(".mcp.json is invalid JSON.");
    }
  }
  const codex = spawnSync("codex", ["mcp", "list"], { encoding: "utf8", timeout: 4000 });
  if (!codex.error && codex.status === 0 && codex.stdout.includes(name)) configured.push("Codex CLI");
  return { ok: configured.length > 0, detail: configured.length ? configured.join(", ") : issues.join(" ") || "No matching Claude Code or Codex MCP registration found.", issues };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: godopilot doctor [--project <path>] [--offline] [--json]");
    return;
  }
  const projectRoot = realpathSync(path.resolve(options.project));
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const projectFile = path.join(projectRoot, "project.godot");
  if (!regularFile(projectFile)) {
    add("project", false, "project.godot is missing. Run from the game project root.");
  } else add("project", true, projectRoot);

  const runtimeRoot = path.join(projectRoot, ".godot_mcp", "runtime");
  const runtimeEntry = path.join(runtimeRoot, "dist", "index.js");
  const runtimePackage = path.join(runtimeRoot, "package.json");
  let runtimeVersion = "";
  try { runtimeVersion = JSON.parse(readFileSync(runtimePackage, "utf8")).version ?? ""; } catch { /* reported below */ }
  add("server", regularFile(runtimeEntry) && Boolean(runtimeVersion), runtimeVersion ? `v${runtimeVersion} at ${runtimeEntry}` : "Runtime missing or incomplete; rerun godopilot.");

  const pluginCfg = path.join(projectRoot, "addons", "godot_devpilot_mcp", "plugin.cfg");
  const pluginText = regularFile(pluginCfg) ? readFileSync(pluginCfg, "utf8") : "";
  const pluginVersion = /^version="([^"]+)"/m.exec(pluginText)?.[1] ?? "";
  add("plugin", Boolean(pluginVersion) && pluginVersion === runtimeVersion, pluginVersion ? `v${pluginVersion}${runtimeVersion && pluginVersion !== runtimeVersion ? `; server is v${runtimeVersion}` : ""}` : "Addon missing; rerun godopilot.");

  const projectText = regularFile(projectFile) ? readFileSync(projectFile, "utf8") : "";
  const pluginHeader = /^\[editor_plugins\][ \t]*$/m.exec(projectText);
  const sectionTail = pluginHeader ? projectText.slice(pluginHeader.index + pluginHeader[0].length) : "";
  const nextSection = /^\[[^\]]+\][ \t]*$/m.exec(sectionTail);
  const pluginSection = sectionTail.slice(0, nextSection?.index ?? sectionTail.length);
  const active = /^enabled\s*=\s*PackedStringArray\([^\r\n]*"res:\/\/addons\/godot_devpilot_mcp\/plugin.cfg"/m.test(pluginSection);
  add("plugin activation", active, active ? "Enabled in project.godot." : "Enable the addon in Project Settings > Plugins.");
  const autoloadHeader = /^\[autoload\][ \t]*$/m.exec(projectText);
  const autoloadTail = autoloadHeader ? projectText.slice(autoloadHeader.index + autoloadHeader[0].length) : "";
  const nextAutoloadSection = /^\[[^\]]+\][ \t]*$/m.exec(autoloadTail);
  const autoloadSection = autoloadTail.slice(0, nextAutoloadSection?.index ?? autoloadTail.length);
  const runtimeBridge = /^DevPilotRuntimeBridge\s*=\s*"\*res:\/\/addons\/godot_devpilot_mcp\/core\/runtime_bridge.gd"[ \t]*$/m.test(autoloadSection);
  add("game runtime bridge", runtimeBridge && regularFile(path.join(projectRoot, "addons", "godot_devpilot_mcp", "core", "runtime_bridge.gd")), runtimeBridge ? "Runtime autoload configured." : "Runtime autoload missing; rerun godopilot and restart Godot.");

  const name = serverName(projectRoot);
  const client = checkClient(projectRoot, name, runtimeEntry);
  add("AI client", client.ok, client.detail);

  const tokenPath = path.join(projectRoot, ".godot_mcp", "bridge-token");
  const tokenValid = regularFile(tokenPath) && /^[0-9a-f]{64}$/.test(readFileSync(tokenPath, "utf8").trim());
  if (!options.offline) {
    add("bridge token", tokenValid, tokenValid ? "Present and well formed." : "Open this project in Godot; the active plugin creates the token.");
    if (tokenValid && regularFile(runtimeEntry) && pluginVersion) {
      try {
        const clientModule = path.join(runtimeRoot, "dist", "godot", "client.js");
        const { GodotClient } = await import(pathToFileURL(clientModule).href);
        const port = Number(/^godot_devpilot_mcp\/server\/port\s*=\s*(\d+)\s*$/m.exec(projectText)?.[1] ?? 6505);
        const bridge = new GodotClient({ host: "127.0.0.1", port, timeoutMs: 3000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 } }, { projectRoot, pluginVersion: runtimeVersion, protocolVersion: "1.0.0" });
        const response = await bridge.connect();
        add("editor connection", response.ok, response.ok ? `Authenticated bridge at 127.0.0.1:${port}; project and version match.` : `${response.error.code}: ${response.error.message}`);
        await bridge.disconnect();
      } catch (error) {
        add("editor connection", false, error instanceof Error ? error.message : String(error));
      }
    } else add("editor connection", false, "Cannot verify connection until server, plugin, and token are available.");
  }

  const passed = checks.every((check) => check.ok);
  if (options.json) console.log(JSON.stringify({ project: projectRoot, passed, checks }, null, 2));
  else {
    console.log(`GodoPilot doctor — ${projectRoot}`);
    for (const check of checks) console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    console.log(passed ? "Ready for AI-assisted Godot work." : "Fix the failed checks, then run godopilot doctor again.");
  }
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Doctor failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
