import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
  const triangle = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => triangle.writeFloatLE(value, index * 4));
  writeFileSync(path.join(root, "triangle.gltf"), JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "Triangle" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ uri: `data:application/octet-stream;base64,${triangle.toString("base64")}`, byteLength: 36 }]
  }));
  const importResult = spawnSync(godotBin, ["--headless", "--path", root, "--import"], { windowsHide: true, encoding: "utf8", timeout: 60000 });
  assert.equal(importResult.status, 0, `Godot import failed: ${importResult.error?.message ?? ""}\n${importResult.stdout}\n${importResult.stderr}`);
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
  const gltfAudit = JSON.parse((await handlers.godot_audit_gltf({ gltf_path: "res://model.gltf" })).content[0].text);
  assert.equal(gltfAudit.ok, true, `${JSON.stringify(gltfAudit)}\n${editorOutput.slice(-3000)}`);
  assert.equal(gltfAudit.data.mesh_count, 0, "The fixture intentionally has no mesh and should be reported honestly.");
  assert.ok(gltfAudit.warnings.some((warning) => warning.includes("no MeshInstance3D")));
  const triangleAudit = JSON.parse((await handlers.godot_audit_gltf({ gltf_path: "res://triangle.gltf" })).content[0].text);
  assert.equal(triangleAudit.ok, true, `${JSON.stringify(triangleAudit)}\n${editorOutput.slice(-3000)}`);
  assert.ok(triangleAudit.data.mesh_count >= 1, JSON.stringify(triangleAudit));
  assert.ok(triangleAudit.data.surface_count >= 1, JSON.stringify(triangleAudit));
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

  await call("scene.create", { path: "res://navigation_bake_smoke.tscn", root_type: "Node3D", root_name: "NavigationBake" });
  await call("scene.open", { path: "res://navigation_bake_smoke.tscn" });
  await call("node.add", { parent_path: ".", node_type: "MeshInstance3D", node_name: "Floor" });
  await call("node.assign_3d_resource", { node_path: "Floor", property: "mesh", resource_type: "BoxMesh" });
  await call("node.set_property", { node_path: "Floor", property: "scale", value: { x: 20, y: 0.2, z: 20 } });
  const region = JSON.parse((await handlers.godot_create_navigation_region_3d({ width: 20, depth: 20 })).content[0].text);
  assert.equal(region.ok, true, JSON.stringify(region));
  const bake = JSON.parse((await handlers.godot_bake_navigation_mesh_3d({ region_path: region.data.navigation_path, agent_radius: 0.5 })).content[0].text);
  assert.equal(bake.ok, true, `${JSON.stringify(bake)}\n${editorOutput.slice(-3000)}`);
  assert.ok(bake.data.polygon_count > 0, JSON.stringify(bake));
  const grid = JSON.parse((await handlers.godot_create_gridmap_3d({ cell_size: 2 })).content[0].text);
  assert.equal(grid.ok, true, `${JSON.stringify(grid)}\n${editorOutput.slice(-3000)}`);
  const palette = JSON.parse((await handlers.godot_get_gridmap_palette({ gridmap_path: grid.data.gridmap_path })).content[0].text);
  assert.equal(palette.ok, true, `${JSON.stringify(palette)}\n${editorOutput.slice(-3000)}`);
  assert.equal(palette.data.items[0].name, "Block");
  assert.equal(palette.data.items[0].has_collision, true);
  const painted = JSON.parse((await handlers.godot_paint_gridmap_cells({ gridmap_path: grid.data.gridmap_path, cells: [{ x: 0, y: 0, z: 0, item: 0 }, { x: 1, y: 0, z: 0, item: 0 }] })).content[0].text);
  assert.equal(painted.ok, true, `${JSON.stringify(painted)}\n${editorOutput.slice(-3000)}`);
  assert.equal(painted.data.cells_changed, 2);
  await call("scene.save");
  const navigationScene = readFileSync(path.join(root, "navigation_bake_smoke.tscn"), "utf8");
  assert.match(navigationScene, /navigation_mesh = SubResource\(/);
  assert.match(navigationScene, /name="GridMap3D" type="GridMap"/);
  assert.match(navigationScene, /"cells": PackedInt32Array\(0, 0, 0, 1, 0, 0\)/);
  assert.doesNotMatch(editorOutput, /(?:SCRIPT ERROR|Parse Error)/, editorOutput);
  console.log("3D toolkit assigned resources, instanced glTF, and baked navigation from scene geometry.");
} finally {
  if (client) await client.disconnect().catch(() => undefined);
  if (editor && editor.exitCode === null) {
    if (process.platform === "win32" && editor.pid) spawnSync("taskkill", ["/PID", String(editor.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else editor.kill();
    await Promise.race([new Promise((resolve) => editor.once("exit", resolve)), delay(5000)]);
  }
  if (path.dirname(realpathSync(root)) === realpathSync(os.tmpdir())) {
    let removed = false;
    for (let attempt = 0; attempt < 10 && !removed; attempt++) {
      try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); removed = true; }
      catch (error) {
        if (attempt === 9) console.warn(`Could not remove temporary smoke project ${root}: ${error.message}`);
        else await delay(500);
      }
    }
  }
}
