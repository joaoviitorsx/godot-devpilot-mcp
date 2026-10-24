import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { audit3DSceneSource, registerScene3DAuditTools } from "../src/tools/scene3dAuditTools.js";
import { cleanupTmpProjects, makeConfig, makeTmpProject, mkdir, writeFile } from "./_helpers.js";

afterEach(async () => cleanupTmpProjects());

const goodScene = `[gd_scene format=3]
[sub_resource type="CapsuleShape3D" id="Shape"]
[sub_resource type="CapsuleMesh" id="Mesh"]
[node name="Player" type="CharacterBody3D"]
[node name="Visual" type="MeshInstance3D" parent="."]
mesh = SubResource("Mesh")
[node name="Collision" type="CollisionShape3D" parent="."]
shape = SubResource("Shape")
[node name="Camera" type="Camera3D" parent="."]
`;

describe("3D scene audit", () => {
  it("accepts a complete player scene and reports missing resources precisely", () => {
    expect(audit3DSceneSource(goodScene, "playable").findings).toEqual([]);
    const incomplete = `[gd_scene format=3]
[node name="World" type="Node3D"]
[node name="Enemy" type="CharacterBody3D" parent="."]
[node name="Visual" type="MeshInstance3D" parent="Enemy"]
[node name="Navigation" type="NavigationRegion3D" parent="."]
[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
`;
    expect(audit3DSceneSource(incomplete, "playable").findings.map((item) => item.code)).toEqual([
      "BODY_WITHOUT_COLLISION", "MESH_MISSING", "NAVIGATION_MESH_MISSING", "ENVIRONMENT_MISSING", "CAMERA_MISSING"
    ]);
  });

  it("offers a read-only MCP tool and confines scene paths to the project", async () => {
    const root = await makeTmpProject();
    await mkdir(path.join(root, "scenes"));
    await writeFile(path.join(root, "scenes", "player.tscn"), goodScene);
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    registerScene3DAuditTools(server, makeConfig(root, true));
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      expect(tools.tools.find((tool) => tool.name === "devpilot_audit_3d_scene")?.annotations?.readOnlyHint).toBe(true);
      const valid = await client.callTool({ name: "devpilot_audit_3d_scene", arguments: { scene_path: "res://scenes/player.tscn", role: "playable" } });
      expect(JSON.parse(valid.content[0].type === "text" ? valid.content[0].text : "{}").data.findings).toEqual([]);
      const escaped = await client.callTool({ name: "devpilot_audit_3d_scene", arguments: { scene_path: "res://../outside.tscn" } });
      expect(escaped.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
