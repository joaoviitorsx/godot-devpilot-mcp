import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { createFileBackup } from "../safety/backup.js";

const toMcp = (response: ToolResponse): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(response) }], isError: !response.ok });
const context = (toolName: string, config: ServerConfig) => ({ toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot });
async function call(godot: GodotClient, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  const response = await godot.call(method, params, { timeoutMs });
  if (response.ok && (typeof response.data !== "object" || response.data === null || Object.keys(response.data).length === 0)) {
    return createErrorResponse("EMPTY_PLUGIN_RESULT", "Godot returned no result data. Check the editor output for a script error.", { method }, []);
  }
  return response;
}

export function registerResourceTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool("godot_reimport_asset", "Reimport an existing project image, audio or glTF asset through Godot. Optionally update existing scalar import settings; creates a backup of .import settings first.", {
    asset_path: z.string().describe("Existing res:// image, audio, .gltf or .glb path."),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Existing keys from the asset's .import [params] section, with matching value types."),
    dry_run: z.boolean().optional()
  }, async ({ asset_path, options, dry_run }) => toMcp(await executeToolSafely(context("godot_reimport_asset", config), async () => {
    const asset = resolveProjectPath(asset_path, config.projectRoot);
    if (!/\.(gltf|glb|png|jpe?g|webp|wav|ogg|mp3)$/i.test(asset.resPath)) return createErrorResponse("INVALID_ASSET_PATH", "Supported assets are images, audio, glTF and GLB.", {}, []);
    const importSettings = resolveProjectPath(`${asset.resPath}.import`, config.projectRoot);
    if (dry_run) return createDryRunResponse({ toolName: "godot_reimport_asset", plannedChanges: [`Reimport ${asset.resPath}${options && Object.keys(options).length ? ` with ${Object.keys(options).length} import setting changes` : ""}`], affectedFiles: options && Object.keys(options).length ? [importSettings.resPath] : [], affectedNodes: [] });
    let backupPath: string | null = null;
    if (options && Object.keys(options).length) {
      const backup = await createFileBackup({ projectRoot: config.projectRoot, resPath: importSettings.resPath, toolName: "godot_reimport_asset", reason: "Change import settings" });
      backupPath = backup.backupResPath;
    }
    const response = await call(godot, "asset.reimport", { asset_path: asset.resPath, options: options ?? {} }, 120_000);
    if (response.ok && typeof response.data === "object" && response.data !== null) return { ...response, data: { ...response.data, backup_path: backupPath } };
    if (!response.ok && backupPath) return { ...response, error: { ...response.error, details: { ...response.error.details, backup_path: backupPath } } };
    return response;
  })));

  server.tool("godot_inspect_object", "Inspect a scene node, an assigned subresource, or an existing .tres/.res resource. Returns paginated stored/editor properties and optionally methods/signals, including script-defined members.", {
    node_path: z.string().optional().describe("Node path relative to the edited scene root; defaults to '.'."),
    resource_property: z.string().optional().describe("Resource property of node_path, e.g. material_override or environment."),
    resource_path: z.string().optional().describe("Existing project .tres or .res path; mutually exclusive with node_path."),
    offset: z.number().int().min(0).max(5000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    include_methods: z.boolean().optional(), include_signals: z.boolean().optional()
  }, async ({ node_path, resource_property, resource_path, offset, limit, include_methods, include_signals }) => toMcp(await executeToolSafely(context("godot_inspect_object", config), async () => {
    if (resource_path && (node_path || resource_property)) return createErrorResponse("INVALID_PARAMS", "resource_path cannot be combined with a node target.", {}, []);
    if (resource_path) resolveProjectPath(resource_path, config.projectRoot);
    return call(godot, "resource.inspect_object", { node_path, resource_property, resource_path, offset, limit, include_methods, include_signals });
  })));

  server.tool("godot_assign_resource", "Assign a compatible built-in Resource class or existing .tres/.res file to a typed node property, with UndoRedo.", {
    node_path: z.string().describe("Node path relative to the edited scene root."),
    property: z.string().min(1).describe("Typed Resource property, e.g. material_override, mesh, environment."),
    resource_type: z.string().optional().describe("Instantiable built-in Resource class, e.g. StandardMaterial3D."),
    resource_path: z.string().optional().describe("Existing project .tres or .res file."),
    dry_run: z.boolean().optional()
  }, async ({ node_path, property: propertyName, resource_type, resource_path, dry_run }) => toMcp(await executeToolSafely(context("godot_assign_resource", config), async () => {
    if (Boolean(resource_type) === Boolean(resource_path)) return createErrorResponse("INVALID_PARAMS", "Provide exactly one of resource_type or resource_path.", {}, []);
    if (resource_path) resolveProjectPath(resource_path, config.projectRoot);
    if (dry_run) return createDryRunResponse({ toolName: "godot_assign_resource", plannedChanges: [`Assign ${resource_type ?? resource_path} to ${node_path}.${propertyName}`], affectedFiles: [], affectedNodes: [node_path] });
    return call(godot, "resource.assign", { node_path, property: propertyName, resource_type, resource_path });
  })));

  server.tool("godot_set_resource_property", "Set a stored scalar, Vector2, Vector3 or Color property on a node's assigned subresource with UndoRedo. Inspect the object first for its type.", {
    node_path: z.string().describe("Node path relative to the edited scene root."),
    resource_property: z.string().min(1).describe("Resource property on the node, e.g. material_override."),
    property: z.string().min(1).describe("Stored property on the assigned resource, e.g. albedo_color."),
    value: z.unknown().describe("Typed JSON value; Color accepts #RRGGBB[AA], vectors accept coordinate objects."),
    dry_run: z.boolean().optional()
  }, async ({ node_path, resource_property, property: propertyName, value, dry_run }) => toMcp(await executeToolSafely(context("godot_set_resource_property", config), async () => {
    if (dry_run) return createDryRunResponse({ toolName: "godot_set_resource_property", plannedChanges: [`Set ${node_path}.${resource_property}.${propertyName}`], affectedFiles: [], affectedNodes: [node_path] });
    return call(godot, "resource.set_property", { node_path, resource_property, property: propertyName, value });
  })));
}
