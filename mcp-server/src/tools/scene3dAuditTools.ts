import { readFile, stat } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createErrorResponse, createSuccessResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

type SceneRole = "component" | "playable";
type SceneNode = { name: string; type: string; nodePath: string; parent: string; properties: Set<string> };
type Finding = { code: string; severity: "warning" | "info"; node: string; message: string };

function parseNodes(source: string): SceneNode[] {
  const nodes: SceneNode[] = [];
  let current: SceneNode | undefined;
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("[")) {
      const match = /^\[node\s+name="([^"]+)"[^\]]*\]/.exec(line);
      if (!match) { current = undefined; continue; }
      const type = /(?:^|\s)type="([^"]+)"/.exec(line)?.[1] ?? "instance";
      const parent = /(?:^|\s)parent="([^"]+)"/.exec(line)?.[1] ?? "";
      const nodePath = parent === "." ? match[1] : parent ? `${parent}/${match[1]}` : ".";
      current = { name: match[1], type, parent, nodePath, properties: new Set() };
      nodes.push(current);
      continue;
    }
    const property = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (current && property) current.properties.add(property[1]);
  }
  return nodes;
}

export function audit3DSceneSource(source: string, role: SceneRole) {
  const nodes = parseNodes(source);
  const findings: Finding[] = [];
  const add = (code: string, node: SceneNode, message: string) => findings.push({ code, severity: "warning", node: node.nodePath, message });
  if (nodes.length === 0) return { nodes_scanned: 0, findings: [{ code: "NO_NODES", severity: "warning" as const, node: ".", message: "No scene nodes found." }] };

  const bodyTypes = new Set(["CharacterBody3D", "RigidBody3D", "StaticBody3D", "AnimatableBody3D", "Area3D"]);
  for (const node of nodes) {
    if (bodyTypes.has(node.type) && !nodes.some((child) => child.parent === node.nodePath && child.type === "CollisionShape3D")) {
      add("BODY_WITHOUT_COLLISION", node, `${node.type} has no direct CollisionShape3D child in this scene.`);
    }
    if (node.type === "CollisionShape3D" && !node.properties.has("shape")) {
      add("COLLISION_SHAPE_MISSING", node, "CollisionShape3D has no assigned Shape3D resource.");
    }
    if (node.type === "MeshInstance3D" && !node.properties.has("mesh")) {
      add("MESH_MISSING", node, "MeshInstance3D has no assigned mesh resource.");
    }
    if (node.type === "NavigationRegion3D" && !node.properties.has("navigation_mesh")) {
      add("NAVIGATION_MESH_MISSING", node, "NavigationRegion3D has no assigned NavigationMesh resource.");
    }
    if (node.type === "WorldEnvironment" && !node.properties.has("environment")) {
      add("ENVIRONMENT_MISSING", node, "WorldEnvironment has no assigned Environment resource.");
    }
  }
  if (role === "playable" && !nodes.some((node) => node.type === "Camera3D")) {
    findings.push({ code: "CAMERA_MISSING", severity: "warning", node: ".", message: "No Camera3D is declared in this playable scene; check instanced scenes and runtime creation." });
  }
  return { nodes_scanned: nodes.length, findings };
}

export function registerScene3DAuditTools(server: McpServer, config: ServerConfig): void {
  server.registerTool("devpilot_audit_3d_scene", {
    description: "Inspect a Godot .tscn for common 3D setup gaps: collision shapes, meshes, navigation, environment and playable-scene camera. Static read-only check; instanced or scripted resources need editor verification.",
    inputSchema: {
      scene_path: z.string().describe("Project-local res://... .tscn path"),
      role: z.enum(["component", "playable"]).optional().default("component")
    },
    annotations: { readOnlyHint: true }
  }, async ({ scene_path, role }): Promise<CallToolResult> => {
    const response = await executeToolSafely(
      { toolName: "devpilot_audit_3d_scene", readOnly: config.security.readOnly, projectRoot: config.projectRoot },
      async () => {
        const resolved = resolveProjectPath(scene_path, config.projectRoot);
        if (!resolved.resPath.endsWith(".tscn")) return createErrorResponse("INVALID_SCENE_PATH", "Expected a .tscn scene.", { scene_path: resolved.resPath });
        const file = await stat(resolved.absolutePath);
        if (!file.isFile() || file.size > 5_000_000) return createErrorResponse("INVALID_SCENE_FILE", "Scene must be a regular file no larger than 5 MB.", { scene_path: resolved.resPath });
        const audit = audit3DSceneSource(await readFile(resolved.absolutePath, "utf8"), role);
        return createSuccessResponse({ scene_path: resolved.resPath, role, ...audit, static_analysis_only: true }, `3D scene audit found ${audit.findings.length} finding(s).`, [], ["Open the scene in Godot and playtest it to verify instanced and scripted resources."]);
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], isError: !response.ok };
  });
}
