import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { registerStarter3DTools } from "../mcp-server/dist/tools/starter3dTools.js";

const godotBin = process.argv[2];
if (!godotBin || process.argv[3]) throw new Error("Usage: node scripts/smoke-3d-starter.mjs <godot-editor-binary>");

function runGodot(root, args) {
  const result = spawnSync(godotBin, ["--headless", "--path", root, ...args], { encoding: "utf8", timeout: 90_000 });
  if (result.error) throw result.error;
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /(?:SCRIPT ERROR|Parse Error|ERROR:)/, output);
}

for (const mode of ["fps", "tps"]) {
  const root = mkdtempSync(path.join(os.tmpdir(), "godopilot-3d-smoke-"));
  try {
    writeFileSync(path.join(root, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="GodoPilot 3D Smoke"\n');
    let handler;
    registerStarter3DTools({ registerTool: (_name, _definition, callback) => { handler = callback; } }, {
      projectRoot: root, security: { readOnly: false }
    });
    const response = await handler({
      mode,
      scene_path: "res://scenes/godopilot_3d_starter.tscn",
      script_path: "res://scripts/godopilot_3d_controller.gd",
      set_main_scene_if_empty: true
    });
    const payload = JSON.parse(response.content[0].text);
    assert.equal(payload.ok, true, JSON.stringify(payload));
    assert.match(readFileSync(path.join(root, "project.godot"), "utf8"), /run\/main_scene=/);
    runGodot(root, ["--import"]);
    runGodot(root, ["--quit-after", "30"]);
    console.log(`${mode.toUpperCase()}: scene imported and ran for 30 frames without Godot errors.`);
  } finally {
    if (path.dirname(realpathSync(root)) === realpathSync(os.tmpdir())) rmSync(root, { recursive: true, force: true });
  }
}
