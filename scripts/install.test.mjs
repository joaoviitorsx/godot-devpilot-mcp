import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const installer = fileURLToPath(new URL("./install.mjs", import.meta.url));
const cli = fileURLToPath(new URL("../bin/godopilot.mjs", import.meta.url));

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "devpilot-install-"));
  writeFileSync(path.join(root, "project.godot"), "config_version=5\n");
  return root;
}

function invoke(root, args = [], env = process.env) {
  const clientArgs = args.includes("--client") ? [] : ["--client", "none"];
  return spawnSync(process.execPath, [installer, "--project", root, "--skip-build", ...clientArgs, ...args], { encoding: "utf8", env });
}

test("installs addon and merges Claude config without losing another server", () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "example" } } }));
    writeFileSync(path.join(root, "CLAUDE.md"), "# Minha regra\n\nPreserve meus arquivos.\n");
    const result = spawnSync(process.execPath, [cli, "--skip-build", "--client", "claude"], { encoding: "utf8", cwd: root });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(root, "addons", "godot_devpilot_mcp", "plugin.cfg")));
    const config = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
    assert.equal(config.mcpServers.other.command, "example");
    const entry = Object.entries(config.mcpServers).find(([name]) => name.startsWith("godot-devpilot-"))?.[1];
    assert.equal(entry.env.GODOT_MCP_PROJECT_ROOT, root);
    assert.equal(entry.env.GODOT_MCP_READ_ONLY, "false");
    assert.equal(entry.env.GODOT_MCP_MODE, "full");
    assert.ok(entry.args[0].startsWith(path.join(root, ".godot_mcp", "runtime")));
    assert.match(readFileSync(path.join(root, ".gitignore"), "utf8"), /\/\.godot_mcp\/bridge-token/);
    assert.match(readFileSync(path.join(root, ".gitignore"), "utf8"), /\/\.godot_mcp\/runtime\//);
    assert.ok(existsSync(entry.args[0]));
    assert.equal(readFileSync(path.join(root, ".godot_mcp", "runtime", ".gdignore"), "utf8"), "");
    const instructions = readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    assert.match(instructions, /Preserve meus arquivos/);
    assert.match(instructions, /devpilot_game_context/);
    assert.match(readFileSync(path.join(root, "project.godot"), "utf8"), /enabled=PackedStringArray\("res:\/\/addons\/godot_devpilot_mcp\/plugin.cfg"\)/);
    const repeat = spawnSync(process.execPath, [cli, "--skip-build", "--client", "claude"], { encoding: "utf8", cwd: root });
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.match(repeat.stdout, /already current/);
    assert.match(repeat.stdout, /already configured/);
    assert.match(repeat.stdout, /already enabled/);
    assert.equal(readFileSync(path.join(root, "CLAUDE.md"), "utf8"), instructions);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("enables the addon alongside existing Godot editor plugins", () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, "project.godot"), 'config_version=5\n\n[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n\n[application]\nconfig/name="Game"\n');
    const result = invoke(root);
    assert.equal(result.status, 0, result.stderr);
    const project = readFileSync(path.join(root, "project.godot"), "utf8");
    assert.match(project, /enabled=PackedStringArray\("res:\/\/addons\/other\/plugin.cfg", "res:\/\/addons\/godot_devpilot_mcp\/plugin.cfg"\)/);
    assert.match(project, /\[application\]\nconfig\/name="Game"/);
    const backupRoot = path.join(root, ".godot_mcp", "install-backups");
    assert.ok(readdirSync(backupRoot).some((name) => name.endsWith("project.godot")));
    assert.equal(invoke(root).status, 0);
    assert.equal(readdirSync(backupRoot).filter((name) => name.endsWith("project.godot")).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("dry run leaves project untouched; force backs up existing addon", () => {
  const root = fixture();
  try {
    const preview = invoke(root, ["--dry-run", "--client", "claude"]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.deepEqual(readdirSync(root), ["project.godot"]);
    assert.equal(invoke(root).status, 0);
    const addon = path.join(root, "addons", "godot_devpilot_mcp");
    writeFileSync(path.join(addon, "plugin.gd.uid"), "generated UID");
    assert.equal(invoke(root).status, 0, "Godot-generated UID should not force an update");
    writeFileSync(path.join(addon, "local-note.txt"), "keep me");
    const refused = invoke(root);
    assert.equal(refused.status, 1);
    assert.equal(invoke(root, ["--force"]).status, 0);
    const backupRoot = path.join(root, ".godot_mcp", "install-backups");
    const backup = path.join(backupRoot, readdirSync(backupRoot).find((name) => name.endsWith("-godot_devpilot_mcp")));
    assert.equal(readFileSync(path.join(backup, "local-note.txt"), "utf8"), "keep me");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("registers Codex without changing the real user configuration", { skip: !!spawnSync("codex", ["mcp", "--help"], { encoding: "utf8" }).error }, () => {
  const root = fixture();
  const codexHome = mkdtempSync(path.join(os.tmpdir(), "devpilot-codex-"));
  try {
    writeFileSync(path.join(root, "AGENTS.md"), "# Minha regra\n\nUse cenas pequenas.\n");
    const env = { ...process.env, CODEX_HOME: codexHome };
    const result = invoke(root, ["--client", "codex"], env);
    assert.equal(result.status, 0, result.stderr);
    const config = readFileSync(path.join(codexHome, "config.toml"), "utf8");
    assert.match(config, /godot-devpilot-/);
    assert.match(config, /GODOT_MCP_PROJECT_ROOT/);
    assert.match(config, /GODOT_MCP_READ_ONLY/);
    assert.match(config, /GODOT_MCP_MODE = "full"|GODOT_MCP_MODE="full"/);
    assert.match(readFileSync(path.join(root, "AGENTS.md"), "utf8"), /Use cenas pequenas/);
    assert.match(readFileSync(path.join(root, "AGENTS.md"), "utf8"), /devpilot_game_context/);
    const update = invoke(root, ["--client", "codex", "--force", "--read-only"], env);
    assert.equal(update.status, 0, update.stderr);
    assert.match(readFileSync(path.join(codexHome, "config.toml"), "utf8"), /GODOT_MCP_READ_ONLY = "true"|GODOT_MCP_READ_ONLY="true"/);
    assert.equal((readFileSync(path.join(root, "AGENTS.md"), "utf8").match(/GODOPILOT MCP BEGIN/g) ?? []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("auto client selection gives an actionable error when no CLI is available", () => {
  const root = fixture();
  try {
    const result = spawnSync(process.execPath, [installer, "--project", root, "--skip-build"], {
      encoding: "utf8",
      env: { ...process.env, PATH: "", Path: "" }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No Claude Code or Codex CLI found/);
    assert.deepEqual(readdirSync(root), ["project.godot"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
