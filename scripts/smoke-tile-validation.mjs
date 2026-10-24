import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GodotClient } from "../mcp-server/dist/godot/client.js";

const godotBin = process.argv[2];
if (!godotBin || process.argv[3]) throw new Error("Usage: node scripts/smoke-tile-validation.mjs <godot-editor-binary>");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(readFileSync(path.join(repo, "mcp-server", "package.json"), "utf8")).version;
const root = mkdtempSync(path.join(os.tmpdir(), "godopilot-tile-smoke-"));
const port = 21000 + Math.floor(Math.random() * 20000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let editor;
let client;
let output = "";

try {
  cpSync(path.join(repo, "addons", "godot_devpilot_mcp"), path.join(root, "addons", "godot_devpilot_mcp"), { recursive: true });
  writeFileSync(path.join(root, "project.godot"), `config_version=5\n[application]\nconfig/name="GodoPilot Tile Smoke"\n[godot_devpilot_mcp]\nserver/port=${port}\n[editor_plugins]\nenabled=PackedStringArray("res://addons/godot_devpilot_mcp/plugin.cfg")\n`);
  editor = spawn(godotBin, ["--headless", "--path", root, "--editor"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  editor.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  editor.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  client = new GodotClient({ host: "127.0.0.1", port, timeoutMs: 2500, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 1000 } }, { projectRoot: root, pluginVersion: packageVersion, protocolVersion: "1.0.0" });
  let connected = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (editor.exitCode !== null) throw new Error(`Editor exited (${editor.exitCode}): ${output}`);
    if (existsSync(path.join(root, ".godot_mcp", "bridge-token"))) {
      const response = await client.connect();
      if (response.ok) { connected = true; break; }
    }
    await delay(500);
  }
  assert.equal(connected, true, `Could not connect to editor: ${output}`);
  for (const [method, params] of [
    ["scene.create", { path: "res://tile_smoke.tscn", root_type: "Node2D" }],
    ["scene.open", { path: "res://tile_smoke.tscn" }],
    ["node.add", { parent_path: ".", node_type: "TileMapLayer", node_name: "Floor" }]
  ]) {
    const result = await client.call(method, params);
    assert.equal(result.ok, true, `${method}: ${JSON.stringify(result)}\n${output}`);
  }
  const selection = { node_path: "Floor", source_id: 0, atlas_x: 0, atlas_y: 0 };
  const missingSet = await client.call("tilemap.set_cell", { ...selection, x: 0, y: 0 });
  assert.equal(missingSet.ok, false, JSON.stringify(missingSet));
  assert.equal(missingSet.error.code, "TILESET_MISSING");
  const missingFill = await client.call("tilemap.fill_rect", { ...selection, x: 0, y: 0, width: 10, height: 2 });
  assert.equal(missingFill.ok, false, JSON.stringify(missingFill));
  assert.equal(missingFill.error.code, "TILESET_MISSING");
  const oversized = await client.call("tilemap.fill_rect", { ...selection, x: 0, y: 0, width: 1000, height: 1000 });
  assert.equal(oversized.ok, false, JSON.stringify(oversized));
  assert.equal(oversized.error.code, "INVALID_FILL_SIZE");
  const wrapped = await client.call("tilemap.set_cell", { ...selection, x: 32768, y: 0 });
  assert.equal(wrapped.ok, false, JSON.stringify(wrapped));
  assert.equal(wrapped.error.code, "TILE_COORDINATE_OUT_OF_RANGE");
  assert.doesNotMatch(output, /(?:SCRIPT ERROR|Parse Error)/, output);
  console.log("Tile operations reject missing TileSets and oversized edits without reporting success.");
} finally {
  if (client) await client.disconnect().catch(() => undefined);
  if (editor && editor.exitCode === null) {
    editor.kill();
    if (process.platform === "win32" && editor.pid) spawnSync("taskkill", ["/PID", String(editor.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await Promise.race([new Promise((resolve) => editor.once("exit", resolve)), delay(5000)]);
  }
  editor?.stdout?.destroy();
  editor?.stderr?.destroy();
  editor?.unref();
  if (path.dirname(realpathSync(root)) === realpathSync(os.tmpdir())) {
    let removed = false;
    for (let attempt = 0; attempt < 3 && !removed; attempt++) {
      try { rmSync(root, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 }); removed = true; }
      catch (error) {
        if (attempt === 2) console.warn(`Could not remove temporary smoke project ${root}: ${error.message}`);
        else await delay(300);
      }
    }
  }
}
