import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GodotClient } from "../mcp-server/dist/godot/client.js";
import { audit3DSceneSource } from "../mcp-server/dist/tools/scene3dAuditTools.js";
import { registerToolkit3dTools } from "../mcp-server/dist/tools/toolkit3dTools.js";

const godotBin = process.argv[2];
if (!godotBin || process.argv[3]) throw new Error("Usage: node scripts/smoke-3d-toolkit.mjs <godot-editor-binary>");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(readFileSync(path.join(repo, "mcp-server", "package.json"), "utf8")).version;
const root = mkdtempSync(path.join(os.tmpdir(), "godopilot-toolkit3d-"));
let editor;
let client;
let editorOutput = "";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, params = {}) {
  const response = await client.call(method, params);
  assert.equal(response.ok, true, `${method}: ${JSON.stringify(response)}\n${editorOutput.slice(-3000)}`);
  return response;
}

try {
  cpSync(path.join(repo, "addons", "godot_devpilot_mcp"), path.join(root, "addons", "godot_devpilot_mcp"), { recursive: true });
  writeFileSync(path.join(root, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="GodoPilot Toolkit 3D Smoke"\n\n[editor_plugins]\nenabled=PackedStringArray("res://addons/godot_devpilot_mcp/plugin.cfg")\n');
  writeFileSync(path.join(root, "model.gltf"), JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "ModelRoot" }] }));
  editor = spawn(godotBin, ["--headless", "--path", root, "--editor"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  editor.stdout.on("data", (data) => { editorOutput = `${editorOutput}${data}`.slice(-8000); });
  editor.stderr.on("data", (data) => { editorOutput = `${editorOutput}${data}`.slice(-8000); });

  const config = {
    host: "127.0.0.1", port: 6505, timeoutMs: 2500,
    reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 1000 }
  };
  client = new GodotClient(config, { projectRoot: root, pluginVersion: packageVersion, protocolVersion: "1.0.0" });
  let connected = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (editor.exitCode !== null) throw new Error(`Godot editor exited: ${editor.exitCode}\n${editorOutput}`);
    if (existsSync(path.join(root, ".godot_mcp", "bridge-token"))) {
      const response = await client.connect();
      if (response.ok) { connected = true; break; }
    }
    await delay(500);
  }
  assert.equal(connected, true, `Could not connect to Godot editor.\n${editorOutput}`);

  await call("scene.create", { path: "res://toolkit_3d_smoke.tscn", root_type: "Node3D", root_name: "Toolkit3D" });
  await call("scene.open", { path: "res://toolkit_3d_smoke.tscn" });
  const handlers = {};
  registerToolkit3dTools({ tool: (name, _description, _schema, handler) => { handlers[name] = handler; } }, client, {
    projectRoot: root, security: { readOnly: false }
  });
  const primitivePaths = [];
  for (const [name, args] of [
    ["godot_create_character_body_3d", { script_path: "res://player_3d.gd" }],
    ["godot_setup_lighting", {}],
    ["godot_create_primitive_mesh", { primitive: "SphereMesh", name: "Sphere" }],
    ["godot_create_primitive_mesh", { primitive: "BoxMesh", name: "Sphere" }],
    ["godot_create_navigation_region_3d", { width: 12, depth: 8 }],
    ["godot_import_gltf", { gltf_path: "res://model.gltf", name: "ImportedModel" }]
  ]) {
    const result = await handlers[name](args);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.ok, true, `${name}: ${JSON.stringify(payload)}\n${editorOutput.slice(-3000)}`);
    if (name === "godot_create_primitive_mesh") primitivePaths.push(payload.data.mesh_path);
  }
  assert.notEqual(primitivePaths[0], primitivePaths[1], "Duplicate names must resolve to distinct actual node paths.");
  const forbidden = await client.call("node.assign_3d_resource", { node_path: "Sphere", property: "mesh", resource_type: "GDScript" });
  assert.equal(forbidden.ok, false, "Resource assignment must reject types outside its allowlist.");
  await call("scene.save");
  const scene = readFileSync(path.join(root, "toolkit_3d_smoke.tscn"), "utf8");
  assert.match(scene, /\[sub_resource type="CapsuleMesh"/);
  assert.match(scene, /\[sub_resource type="CapsuleShape3D"/);
  assert.match(scene, /\[sub_resource type="SphereMesh"/);
  assert.match(scene, /\[sub_resource type="BoxMesh"/);
  assert.match(scene, /\[sub_resource type="Environment"/);
  assert.match(scene, /\[sub_resource type="NavigationMesh"/);
  assert.match(scene, /mesh = SubResource\(/);
  assert.match(scene, /shape = SubResource\(/);
  assert.match(scene, /environment = SubResource\(/);
  assert.match(scene, /navigation_mesh = SubResource\(/);
  assert.match(scene, /polygons = \[PackedInt32Array\(0, 3, 2, 1\)\]/);
  assert.match(scene, /path="res:\/\/model\.gltf"/);
  assert.match(scene, /name="ImportedModel"/);
  assert.equal((scene.match(/\[node name="Sphere[^\"]*" type="MeshInstance3D"/g) ?? []).length, 2);
  assert.deepEqual(audit3DSceneSource(scene, "playable").findings, []);
  assert.doesNotMatch(editorOutput, /(?:SCRIPT ERROR|Parse Error)/, editorOutput);
  console.log("3D toolkit assigned resources and instanced a glTF model in a saved Godot scene.");
} finally {
  if (client) await client.disconnect().catch(() => undefined);
  if (editor && editor.exitCode === null) {
    editor.kill();
    await Promise.race([new Promise((resolve) => editor.once("exit", resolve)), delay(3000)]);
  }
  if (path.dirname(realpathSync(root)) === realpathSync(os.tmpdir())) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
