#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(repositoryRoot, "mcp-server");
const addonSource = path.join(repositoryRoot, "addons", "godot_devpilot_mcp");
const entryPoint = path.join(serverRoot, "dist", "index.js");

function usage() {
  console.log(`Usage: godopilot [init] [options]

Run this command from the directory containing project.godot.

Options:
  --project <path>               Use another Godot project (default: current directory)
  --client <auto|claude|codex|both|none>  Configure the MCP client (default: auto-detect)
  --read-only                    Prevent AI tools from editing the project
  --mode <minimal|core|full|agentic>  Choose the registered tool set (default: full)
  --force                        Back up and replace an existing addon
  --skip-build                   Use an already built server
  --dry-run                      Validate and show the installation without changes
  --help                         Show this help`);
}

function parseArgs(argv) {
  const options = { project: process.cwd(), client: "auto", mode: "full", readWrite: true, force: false, skipBuild: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "init" || arg === "install") continue;
    if (arg === "--help") { options.help = true; continue; }
    if (arg === "--project" || arg === "--client" || arg === "--mode") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++i];
      continue;
    }
    if (arg === "--read-write") options.readWrite = true;
    else if (arg === "--read-only") options.readWrite = false;
    else if (arg === "--force") options.force = true;
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!["auto", "claude", "codex", "both", "none"].includes(options.client)) throw new Error("--client must be auto, claude, codex, both or none");
  if (!["minimal", "core", "full", "agentic"].includes(options.mode)) throw new Error("--mode must be minimal, core, full or agentic");
  return options;
}

function run(command, args, cwd) {
  // All npm arguments here are fixed tokens controlled by this installer.
  const windowsNpm = process.platform === "win32" && command === "npm";
  const executable = windowsNpm ? (process.env.ComSpec || "cmd.exe") : command;
  const commandArgs = windowsNpm ? ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] : args;
  const result = spawnSync(executable, commandArgs, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`);
}

function serverName(projectRoot) {
  const slug = path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "project";
  const hash = createHash("sha256").update(projectRoot.toLowerCase()).digest("hex").slice(0, 8);
  return `godot-devpilot-${slug}-${hash}`;
}

function readClaudeConfig(projectRoot) {
  const configPath = path.join(projectRoot, ".mcp.json");
  if (existsSync(configPath) && lstatSync(configPath).isSymbolicLink()) throw new Error(`Refusing to read symlink: ${configPath}`);
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Existing .mcp.json must contain an object");
  if (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) {
    throw new Error("Existing .mcp.json has an invalid mcpServers field");
  }
  config.mcpServers ??= {};
  return config;
}

function configureClaude(projectRoot, name, environment, config, runtimeEntry) {
  const configPath = path.join(projectRoot, ".mcp.json");
  const entry = { type: "stdio", command: process.execPath, args: [runtimeEntry], env: environment };
  if (JSON.stringify(config.mcpServers[name]) === JSON.stringify(entry)) {
    console.log(`Claude Code: ${configPath} (already configured)`);
    return;
  }
  config.mcpServers[name] = entry;
  const temporaryPath = `${configPath}.devpilot-tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
  try { renameSync(temporaryPath, configPath); }
  catch (error) { rmSync(temporaryPath, { force: true }); throw error; }
  console.log(`Claude Code: ${configPath}`);
}

function configureCodex(projectRoot, name, environment, runtimeEntry) {
  const args = ["mcp", "add", name];
  for (const [key, value] of Object.entries(environment)) args.push("--env", `${key}=${value}`);
  args.push("--", process.execPath, runtimeEntry);
  run("codex", args, projectRoot);
  console.log(`Codex: ${name} (codex mcp list)`);
}

function installAddon(projectRoot, force) {
  const destination = path.join(projectRoot, "addons", "godot_devpilot_mcp");
  mkdirSync(path.dirname(destination), { recursive: true });
  let backupPath;
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${destination}`);
    if (sameDirectoryContents(addonSource, destination)) {
      console.log(`Godot addon: ${destination} (already current)`);
      return;
    }
    if (!force) throw new Error(`Addon already exists at ${destination}; use --force to back it up and replace it`);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = path.join(projectRoot, ".godot_mcp", "install-backups", `${stamp}-godot_devpilot_mcp`);
    mkdirSync(path.dirname(backupPath), { recursive: true });
    renameSync(destination, backupPath);
  }
  try { cpSync(addonSource, destination, { recursive: true, errorOnExist: true, force: false }); }
  catch (error) {
    rmSync(destination, { recursive: true, force: true });
    if (backupPath) renameSync(backupPath, destination);
    throw error;
  }
  console.log(`Godot addon: ${destination}${backupPath ? ` (backup: ${backupPath})` : ""}`);
}

function sameDirectoryContents(source, destination) {
  if (!existsSync(destination) || !lstatSync(destination).isDirectory()) return false;
  const generated = (name) => name.endsWith(".gd.uid") || name.endsWith(".import");
  const sourceEntries = readdirSync(source).filter((name) => !generated(name)).sort();
  const destinationEntries = readdirSync(destination).filter((name) => !generated(name)).sort();
  if (sourceEntries.length !== destinationEntries.length || sourceEntries.some((name, index) => name !== destinationEntries[index])) return false;
  return sourceEntries.every((name) => {
    const left = path.join(source, name);
    const right = path.join(destination, name);
    const leftStat = lstatSync(left);
    const rightStat = lstatSync(right);
    if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) return false;
    if (leftStat.isDirectory() && rightStat.isDirectory()) return sameDirectoryContents(left, right);
    return leftStat.isFile() && rightStat.isFile() && leftStat.size === rightStat.size && readFileSync(left).equals(readFileSync(right));
  });
}

function sameFileContents(left, right) {
  return existsSync(right) && lstatSync(right).isFile() && readFileSync(left).equals(readFileSync(right));
}

function installRuntime(projectRoot) {
  const stateRoot = path.join(projectRoot, ".godot_mcp");
  if (existsSync(stateRoot) && (lstatSync(stateRoot).isSymbolicLink() || !lstatSync(stateRoot).isDirectory())) {
    throw new Error(`.godot_mcp must be a regular directory: ${stateRoot}`);
  }
  const destination = path.join(stateRoot, "runtime");
  const sourceLock = path.join(serverRoot, "package-lock.json");
  const installedLock = path.join(destination, "package-lock.json");
  const runtimeDependencies = ["@modelcontextprotocol/sdk", "pngjs", "ws", "zod"];
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${destination}`);
  if (existsSync(path.join(destination, ".gdignore")) && sameFileContents(path.join(repositoryRoot, "scripts", "doctor.mjs"), path.join(destination, "doctor.mjs")) && runtimeDependencies.every((dependency) => existsSync(path.join(destination, "node_modules", ...dependency.split("/")))) && sameFileContents(sourceLock, installedLock) && sameDirectoryContents(path.join(serverRoot, "dist"), path.join(destination, "dist"))) {
    console.log(`MCP runtime: ${destination} (already current)`);
    return path.join(destination, "dist", "index.js");
  }
  mkdirSync(stateRoot, { recursive: true });
  const stage = mkdtempSync(path.join(stateRoot, "runtime-stage-"));
  let backup;
  try {
    copyFileSync(path.join(serverRoot, "package.json"), path.join(stage, "package.json"));
    copyFileSync(sourceLock, path.join(stage, "package-lock.json"));
    copyFileSync(path.join(repositoryRoot, "scripts", "doctor.mjs"), path.join(stage, "doctor.mjs"));
    cpSync(path.join(serverRoot, "dist"), path.join(stage, "dist"), { recursive: true });
    // Godot should not scan Node modules and generated JavaScript as game assets.
    writeFileSync(path.join(stage, ".gdignore"), "");
    run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], stage);
    if (existsSync(destination)) {
      const backupRoot = path.join(stateRoot, "install-backups");
      mkdirSync(backupRoot, { recursive: true });
      backup = path.join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-runtime`);
      renameSync(destination, backup);
    }
    renameSync(stage, destination);
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    if (backup && !existsSync(destination) && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
  console.log(`MCP runtime: ${destination}${backup ? ` (previous version: ${backup})` : ""}`);
  return path.join(destination, "dist", "index.js");
}

function cliAvailable(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (!result.error && result.status === 0) return true;
  // npm-installed Claude Code can be a .cmd shim on Windows. We only need its
  // presence: Claude configuration is written to .mcp.json, not invoked here.
  if (process.platform === "win32" && command === "claude") {
    const located = spawnSync("where.exe", ["claude"], { stdio: "ignore" });
    return !located.error && located.status === 0;
  }
  return false;
}

function resolveClient(requested) {
  if (requested !== "auto") return requested;
  const claude = cliAvailable("claude", ["--version"]);
  const codex = cliAvailable("codex", ["mcp", "--help"]);
  if (claude && codex) return "both";
  if (claude) return "claude";
  if (codex) return "codex";
  throw new Error("No Claude Code or Codex CLI found. Install one, or pass --client none to install only the Godot addon.");
}

function ignoreBridgeToken(projectRoot) {
  const file = path.join(projectRoot, ".gitignore");
  const entries = ["/.godot_mcp/bridge-token", "/.godot_mcp/runtime/", "/.godot_mcp/runtime-stage-*/", "/.godot_mcp/install-backups/"];
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error(`Refusing to edit symlink: ${file}`);
  const original = existsSync(file) ? readFileSync(file, "utf8") : "";
  let content = original;
  for (const entry of entries) if (!content.split(/\r?\n/).includes(entry)) {
    content = `${content}${content && !content.endsWith("\n") ? "\n" : ""}${entry}\n`;
  }
  if (content !== original) writeFileSync(file, content);
}

function writeAiGuidance(projectRoot, filename, name) {
  const file = path.join(projectRoot, filename);
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error(`Refusing to edit symlink: ${file}`);
  const original = existsSync(file) ? readFileSync(file, "utf8") : "";
  const begin = "<!-- GODOPILOT MCP BEGIN -->";
  const end = "<!-- GODOPILOT MCP END -->";
  const block = `${begin}\nEste projeto usa o servidor MCP ${name} do GodoPilot. As ferramentas do Godot estão disponíveis quando o editor deste jogo estiver aberto. No início de uma tarefa de jogo, consulte devpilot_game_context; use godot_health_check se a ponte do editor for necessária. Para criar ou alterar funcionalidades, defina um resultado observável, inspecione a cena e os scripts relevantes, faça a menor mudança jogável e valide com testes, execução e logs. Use devpilot_find_tools com a descrição da tarefa para achar poucas ferramentas relevantes; godot_get_capabilities mostra a lista completa. Antes de editar recursos, consulte godot_inspect_object ou godot_get_classdb_info. Para GDScript e nós, siga as convenções existentes, prefira cenas autocontidas, nomes claros e tipos explícitos quando úteis; use devpilot_review_gdscript e valide no Godot. Tiles avançados exigem o addon opcional Better Tile Editor.\n${end}`;
  const start = original.indexOf(begin);
  const finish = original.indexOf(end);
  if ((start < 0) !== (finish < 0)) throw new Error(`${filename} has an incomplete GodoPilot section`);
  const updated = start >= 0
    ? `${original.slice(0, start)}${block}${original.slice(finish + end.length)}`
    : `${original}${original && !original.endsWith("\n") ? "\n" : ""}${original ? "\n" : ""}${block}\n`;
  if (updated === original) {
    console.log(`${filename}: already configured`);
    return;
  }
  if (original) {
    const backupRoot = path.join(projectRoot, ".godot_mcp", "install-backups");
    mkdirSync(backupRoot, { recursive: true });
    copyFileSync(file, path.join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${filename}`), 1);
  }
  writeFileSync(file, updated);
  console.log(`${filename}: GodoPilot guidance added`);
}

function enableEditorPlugin(projectRoot) {
  const file = path.join(projectRoot, "project.godot");
  if (lstatSync(file).isSymbolicLink()) throw new Error(`Refusing to edit symlink: ${file}`);
  const original = readFileSync(file, "utf8");
  const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const pluginPath = "res://addons/godot_devpilot_mcp/plugin.cfg";
  const section = /^\[editor_plugins\][ \t]*$(?:\r?\n)?/m.exec(original);
  let updated;
  let manualPluginActivation = false;
  if (!section) {
    updated = `${original}${original.endsWith("\n") ? "" : lineEnding}${lineEnding}[editor_plugins]${lineEnding}${lineEnding}enabled=PackedStringArray("${pluginPath}")${lineEnding}`;
  } else {
    const start = section.index + section[0].length;
    const next = /^\[[^\]\r\n]+\]/gm;
    next.lastIndex = start;
    const end = next.exec(original)?.index ?? original.length;
    const body = original.slice(start, end);
    const enabled = /^enabled[ \t]*=[ \t]*PackedStringArray\(([^\r\n]*)\)[ \t]*$/m.exec(body);
    if (!enabled) {
      if (/^enabled\s*=/m.test(body)) {
        console.warn("Godot plugin activation: unsupported enabled setting; enable Godot DevPilot MCP in Project Settings > Plugins.");
        updated = original;
        manualPluginActivation = true;
      } else {
        updated = `${original.slice(0, end)}enabled=PackedStringArray("${pluginPath}")${lineEnding}${original.slice(end)}`;
      }
    } else if (enabled[1].includes(`"${pluginPath}"`)) {
      updated = original;
    } else {
      const value = enabled[1].trim();
      const replacement = `enabled=PackedStringArray(${value ? `${value}, ` : ""}"${pluginPath}")`;
      const offset = start + enabled.index;
      updated = `${original.slice(0, offset)}${replacement}${original.slice(offset + enabled[0].length)}`;
    }
  }
  const bridgePath = "*res://addons/godot_devpilot_mcp/core/runtime_bridge.gd";
  const autoload = /^\[autoload\][ \t]*$(?:\r?\n)?/m.exec(updated);
  if (!autoload) {
    updated += `${updated.endsWith("\n") ? "" : lineEnding}${lineEnding}[autoload]${lineEnding}${lineEnding}DevPilotRuntimeBridge="${bridgePath}"${lineEnding}`;
  } else {
    const start = autoload.index + autoload[0].length;
    const next = /^\[[^\]\r\n]+\]/gm;
    next.lastIndex = start;
    const end = next.exec(updated)?.index ?? updated.length;
    const body = updated.slice(start, end);
    const entry = /^DevPilotRuntimeBridge[ \t]*=[ \t]*"([^"]+)"/m.exec(body);
    if (entry && entry[1] !== bridgePath) throw new Error("DevPilotRuntimeBridge autoload already points to a different script.");
    if (!entry) updated = `${updated.slice(0, end)}DevPilotRuntimeBridge="${bridgePath}"${lineEnding}${updated.slice(end)}`;
  }
  if (updated === original) {
    console.log(manualPluginActivation ? "Game runtime bridge: already configured; activate the editor plugin manually." : "Godot plugin activation: already enabled");
    return;
  }
  const backupDir = path.join(projectRoot, ".godot_mcp", "install-backups");
  mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-project.godot`);
  copyFileSync(file, backup, 1);
  writeFileSync(file, updated);
  console.log(manualPluginActivation ? `Game runtime bridge: configured (project.godot backup: ${backup}); activate the editor plugin manually.` : `Godot plugin activation: enabled (project.godot backup: ${backup})`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }
  options.client = resolveClient(options.client);
  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 12)) throw new Error("Node.js 22.12 or newer is required.");
  const requestedRoot = path.resolve(options.project);
  if (!existsSync(requestedRoot) || !lstatSync(requestedRoot).isDirectory() || !existsSync(path.join(requestedRoot, "project.godot"))) {
    throw new Error(`Not a Godot project (project.godot missing): ${requestedRoot}`);
  }
  const projectRoot = realpathSync(requestedRoot);
  if (!lstatSync(path.join(projectRoot, "project.godot")).isFile()) {
    throw new Error(`Not a Godot project (project.godot missing): ${projectRoot}`);
  }
  if (!existsSync(addonSource) || !existsSync(path.join(addonSource, "plugin.cfg"))) throw new Error("Addon source is missing");
  const addonsRoot = path.join(projectRoot, "addons");
  if (existsSync(addonsRoot) && (lstatSync(addonsRoot).isSymbolicLink() || !lstatSync(addonsRoot).isDirectory())) {
    throw new Error(`addons must be a regular directory: ${addonsRoot}`);
  }
  const destination = path.join(projectRoot, "addons", "godot_devpilot_mcp");
  const isDevelopmentSandbox = path.resolve(destination).toLowerCase() === addonSource.toLowerCase();
  if (!isDevelopmentSandbox && existsSync(destination) && !options.force && !sameDirectoryContents(addonSource, destination)) throw new Error(`Addon already exists at ${destination}; use --force to back it up and replace it`);
  if (!isDevelopmentSandbox && existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${destination}`);
  if (options.skipBuild && !existsSync(entryPoint)) throw new Error(`Built server missing: ${entryPoint}`);
  if (options.client === "codex" || options.client === "both") {
    const probe = spawnSync("codex", ["mcp", "--help"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) throw new Error("Codex CLI is unavailable; install it or choose another --client value");
  }
  const name = serverName(projectRoot);
  const environment = { GODOT_MCP_PROJECT_ROOT: projectRoot, GODOT_MCP_READ_ONLY: options.readWrite ? "false" : "true", GODOT_MCP_MODE: options.mode };
  const claudeConfig = options.client === "claude" || options.client === "both" ? readClaudeConfig(projectRoot) : null;
  const hasSource = existsSync(path.join(serverRoot, "src", "index.ts"));
  const needsBuild = !options.skipBuild && hasSource;
  console.log(`Project: ${projectRoot}\nMCP name: ${name}\nPermissions: ${options.readWrite ? "read-write" : "read-only"}\nTool mode: ${options.mode}\nBuild: ${needsBuild ? "npm ci + npm run build" : "use packaged dist"}\nRuntime: ${path.join(projectRoot, ".godot_mcp", "runtime")}\nAddon: ${isDevelopmentSandbox ? "already present in development sandbox" : destination}\nClient: ${options.client}`);
  if (options.dryRun) { console.log("Dry run: no files or client settings changed."); return; }
  if (needsBuild) {
    run("npm", ["ci"], serverRoot);
    run("npm", ["run", "build"], serverRoot);
  }
  if (!existsSync(entryPoint)) throw new Error(`Built server missing: ${entryPoint}`);
  const runtimeEntry = installRuntime(projectRoot);
  if (!isDevelopmentSandbox) installAddon(projectRoot, options.force);
  enableEditorPlugin(projectRoot);
  ignoreBridgeToken(projectRoot);
  if (claudeConfig) configureClaude(projectRoot, name, environment, claudeConfig, runtimeEntry);
  if (options.client === "codex" || options.client === "both") configureCodex(projectRoot, name, environment, runtimeEntry);
  if (claudeConfig) writeAiGuidance(projectRoot, "CLAUDE.md", name);
  if (options.client === "codex" || options.client === "both") writeAiGuidance(projectRoot, "AGENTS.md", name);
  console.log("Ready. Open this project in Godot, then run: node .godot_mcp/runtime/doctor.mjs");
  console.log("Start a new Claude Code or Codex session here and ask: 'Use GodoPilot to inspect this game.'");
}

try { main(); }
catch (error) { console.error(`Install failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
