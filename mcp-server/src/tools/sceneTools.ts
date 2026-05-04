import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { access } from "node:fs/promises";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createFileBackup } from "../safety/backup.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { createSafetyError } from "../safety/errors.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely, type ToolExecutionContext } from "../safety/toolWrapper.js";

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig): ToolExecutionContext {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function requireScenePath(pathValue: unknown, config: ServerConfig): string {
  if (typeof pathValue !== "string") {
    throw createSafetyError(
      "INVALID_PARAMS",
      "scene_path/path must be a string.",
      { path: pathValue },
      ["Pass a res:// path ending in .tscn."]
    );
  }
  const resolved = resolveProjectPath(pathValue, config.projectRoot);
  if (!resolved.resPath.endsWith(".tscn")) {
    throw createSafetyError(
      "INVALID_PARAMS",
      "Scene path must end in .tscn.",
      { path: resolved.resPath },
      ["Pass a res:// path ending in .tscn."]
    );
  }
  return resolved.resPath;
}

export function registerSceneTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "godot_get_scene_tree",
    "Get the current edited scene tree as a nested node hierarchy.",
    {
      include_properties: z.boolean().optional().describe("Include editor-visible properties for each node."),
      max_depth: z.number().int().positive().optional().describe("Maximum tree depth to return. Defaults to 10.")
    },
    async ({ include_properties, max_depth }) => {
      const result = await executeToolSafely(ctx("godot_get_scene_tree", config), async () =>
        callAfterConnect(godot, "scene.get_tree", { include_properties: include_properties ?? false, max_depth: max_depth ?? 10 })
      );
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_get_scene_summary",
    "Get a summary of the current scene: root name, type, total node count, and node type breakdown.",
    {},
    async () => {
      const result = await executeToolSafely(ctx("godot_get_scene_summary", config), async () =>
        callAfterConnect(godot, "scene.get_summary", {})
      );
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_validate_scene",
    "Validate that a .tscn file is loadable. Uses the currently open scene if path is omitted.",
    {
      path: z.string().optional().describe("res:// path to the .tscn file to validate."),
      scene_path: z.string().optional().describe("Alias for path.")
    },
    async ({ path, scene_path }) => {
      const result = await executeToolSafely(ctx("godot_validate_scene", config), async (): Promise<ToolResponse> => {
        const requestedPath = path ?? scene_path;
        return callAfterConnect(godot, "scene.validate", { path: requestedPath ? requireScenePath(requestedPath, config) : "" });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_audit_scene",
    "Audit a scene for structural issues, invalid ownership, missing scripts and common scene hygiene problems.",
    {
      path: z.string().optional().describe("res:// path to the .tscn file to audit. Uses current scene if omitted."),
      scene_path: z.string().optional().describe("Alias for path.")
    },
    async ({ path, scene_path }) => {
      const result = await executeToolSafely(ctx("godot_audit_scene", config), async (): Promise<ToolResponse> => {
        const requestedPath = path ?? scene_path;
        return callAfterConnect(godot, "scene.audit", { path: requestedPath ? requireScenePath(requestedPath, config) : "" });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_create_scene",
    "Create a new .tscn file with a root node of the given type.",
    {
      path: z.string().optional().describe("res:// path ending in .tscn where the scene will be created."),
      scene_path: z.string().optional().describe("Alias for path."),
      root_type: z.string().optional().describe("ClassDB node type for the root node (default: Node2D)."),
      root_name: z.string().optional().describe("Name for the root node (default: filename without extension)."),
      overwrite: z.boolean().optional().describe("Allow overwriting an existing scene after creating a backup."),
      dry_run: z.boolean().optional().describe("Preview changes without writing to disk.")
    },
    async ({ path, scene_path, root_type, root_name, overwrite, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_create_scene", config), async (): Promise<ToolResponse> => {
        const resolvedPath = requireScenePath(path ?? scene_path, config);
        const resolved = resolveProjectPath(resolvedPath, config.projectRoot);
        const exists = await fileExists(resolved.absolutePath);
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_scene",
            plannedChanges: [
              exists
                ? `Overwrite scene '${resolved.resPath}' with root type '${root_type ?? "Node2D"}' (backup will be created first)`
                : `Create scene '${resolved.resPath}' with root type '${root_type ?? "Node2D"}'`
            ],
            affectedFiles: [resolved.resPath]
          });
        }

        if (exists && !overwrite) {
          return createErrorResponse(
            "FILE_ALREADY_EXISTS",
            "Scene already exists. Set overwrite=true to overwrite.",
            { path: resolved.resPath },
            ["Use overwrite=true only after reviewing the target scene path."]
          );
        }

        let backupPath: string | null = null;
        if (exists) {
          const backup = await createFileBackup({
            projectRoot: config.projectRoot,
            resPath: resolved.resPath,
            toolName: "godot_create_scene",
            reason: "pre-scene-overwrite backup"
          });
          backupPath = backup.backupResPath;
        }

        const response = await callAfterConnect(godot, "scene.create", {
          path: resolved.resPath,
          root_type: root_type ?? "Node2D",
          root_name: root_name ?? "",
          overwrite: overwrite ?? false
        });

        if (response.ok) {
          return createSuccessResponse(
            { ...response.data as Record<string, unknown>, backup_path: backupPath },
            response.message,
            response.warnings,
            response.suggestions
          );
        }

        return response;
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_open_scene",
    "Open a scene in the Godot editor.",
    {
      path: z.string().optional().describe("res:// path to the .tscn file to open."),
      scene_path: z.string().optional().describe("Alias for path.")
    },
    async ({ path, scene_path }) => {
      const result = await executeToolSafely(ctx("godot_open_scene", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "scene.open", { path: requireScenePath(path ?? scene_path, config) })
      );
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_save_scene",
    "Save the currently open scene in the Godot editor.",
    {
      path: z.string().optional().describe("Optional res:// path to save. Defaults to current scene."),
      scene_path: z.string().optional().describe("Alias for path."),
      dry_run: z.boolean().optional().describe("Preview save without writing.")
    },
    async ({ path, scene_path, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_save_scene", config), async (): Promise<ToolResponse> => {
        const requestedPath = path ?? scene_path;
        let resolvedPath = requestedPath ? requireScenePath(requestedPath, config) : "";

        if (!resolvedPath) {
          const context = await callAfterConnect(godot, "project.get_editor_context", {});
          if (!context.ok) return context;

          const currentScene = typeof (context.data as { current_scene?: unknown }).current_scene === "string"
            ? (context.data as { current_scene: string }).current_scene
            : "";

          if (!currentScene) {
            return createErrorResponse(
              "SCENE_NOT_OPEN",
              "No current scene is open, so save_scene cannot create a safe backup.",
              {},
              ["Open a scene or pass scene_path explicitly before saving."]
            );
          }

          resolvedPath = requireScenePath(currentScene, config);
        }

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_save_scene",
            plannedChanges: [`Save scene '${resolvedPath}' (backup will be created first if file exists)`],
            affectedFiles: [resolvedPath]
          });
        }

        let backupPath: string | null = null;
        const resolved = resolveProjectPath(resolvedPath, config.projectRoot);
        if (await fileExists(resolved.absolutePath)) {
          const backup = await createFileBackup({
            projectRoot: config.projectRoot,
            resPath: resolved.resPath,
            toolName: "godot_save_scene",
            reason: "pre-scene-save backup"
          });
          backupPath = backup.backupResPath;
        }

        const response = await callAfterConnect(godot, "scene.save", { path: resolvedPath });
        if (response.ok) {
          return createSuccessResponse(
            { ...response.data as Record<string, unknown>, backup_path: backupPath },
            response.message,
            response.warnings,
            response.suggestions
          );
        }
        return response;
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_duplicate_scene",
    "Duplicate a .tscn file to a new path.",
    {
      source: z.string().describe("res:// path of the source .tscn file."),
      destination: z.string().describe("res:// path where the copy will be written."),
      overwrite: z.boolean().optional().describe("Allow overwriting destination after backup."),
      dry_run: z.boolean().optional().describe("Preview changes without copying.")
    },
    async ({ source, destination, overwrite, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_duplicate_scene", config), async (): Promise<ToolResponse> => {
        const sourcePath = requireScenePath(source, config);
        const destinationPath = requireScenePath(destination, config);
        const destinationResolved = resolveProjectPath(destinationPath, config.projectRoot);
        const destinationExists = await fileExists(destinationResolved.absolutePath);
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_duplicate_scene",
            plannedChanges: [
              destinationExists
                ? `Copy scene '${sourcePath}' → '${destinationPath}' (destination backup will be created first)`
                : `Copy scene '${sourcePath}' → '${destinationPath}'`
            ],
            affectedFiles: [destinationPath]
          });
        }

        if (destinationExists && !overwrite) {
          return createErrorResponse(
            "FILE_ALREADY_EXISTS",
            "Destination scene already exists. Set overwrite=true to overwrite.",
            { path: destinationPath },
            ["Choose a different destination or pass overwrite=true after reviewing the target."]
          );
        }

        let backupPath: string | null = null;
        if (destinationExists) {
          const backup = await createFileBackup({
            projectRoot: config.projectRoot,
            resPath: destinationPath,
            toolName: "godot_duplicate_scene",
            reason: "pre-scene-duplicate overwrite backup"
          });
          backupPath = backup.backupResPath;
        }

        const response = await callAfterConnect(godot, "scene.duplicate", { source: sourcePath, destination: destinationPath, overwrite: overwrite ?? false });
        if (response.ok) {
          return createSuccessResponse(
            { ...response.data as Record<string, unknown>, backup_path: backupPath },
            response.message,
            response.warnings,
            response.suggestions
          );
        }
        return response;
      });
      return toMcpResult(result);
    }
  );
}
