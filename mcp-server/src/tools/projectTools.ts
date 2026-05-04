import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) {
      return connection;
    }
  }

  return godot.call(method, params);
}

type FileEntry = {
  name: string;
  type: "file" | "directory";
  path: string;
};

async function collectFiles(
  absoluteDir: string,
  resRelativeDir: string,
  extensions: string[],
  recursive: boolean,
  limit: number,
  results: FileEntry[],
  truncated: { value: boolean }
): Promise<void> {
  if (results.length >= limit) {
    truncated.value = true;
    return;
  }

  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= limit) {
      truncated.value = true;
      break;
    }

    const entryRes = resRelativeDir ? `${resRelativeDir}/${entry.name}` : entry.name;
    const entryResPath = `res://${entryRes}`;

    if (entry.isDirectory()) {
      results.push({ name: entry.name, type: "directory", path: entryResPath });
      if (recursive) {
        await collectFiles(
          path.join(absoluteDir, entry.name),
          entryRes,
          extensions,
          recursive,
          limit,
          results,
          truncated
        );
      }
    } else {
      const include =
        extensions.length === 0 || extensions.some((ext) => entry.name.endsWith(ext));
      if (include) {
        results.push({ name: entry.name, type: "file", path: entryResPath });
      }
    }
  }
}

export function registerProjectTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.registerTool(
    "godot_list_files",
    {
      title: "List Godot Project Files",
      description:
        "Lists files and directories inside a res:// path. Does not require Godot to be running.",
      inputSchema: {
        root: z
          .string()
          .optional()
          .default("res://")
          .describe("res:// directory to list. Defaults to the project root."),
        extensions: z
          .array(z.string())
          .optional()
          .default([])
          .describe("Filter by file extension, e.g. [\".gd\", \".tscn\"]. Empty means all files."),
        recursive: z
          .boolean()
          .optional()
          .default(false)
          .describe("Recurse into subdirectories."),
        limit: z
          .number()
          .int()
          .positive()
          .max(MAX_LIST_LIMIT)
          .optional()
          .default(DEFAULT_LIST_LIMIT)
          .describe(`Maximum number of entries to return (max ${MAX_LIST_LIMIT}).`)
      }
    },
    async ({ root, extensions, recursive, limit }) => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_list_files",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => {
            const resolvedRoot =
              root === "res://" || root === "res:///"
                ? { resPath: "res://", relativePath: "", absolutePath: config.projectRoot }
                : resolveProjectPath(root, config.projectRoot);

            const rootStat = await stat(resolvedRoot.absolutePath).catch(() => null);
            if (!rootStat || !rootStat.isDirectory()) {
              return createErrorResponse(
                "PATH_NOT_FOUND",
                "Directory not found or path is not a directory.",
                { path: resolvedRoot.resPath },
                ["Verify the path exists inside the Godot project."]
              );
            }

            const results: FileEntry[] = [];
            const truncated = { value: false };
            await collectFiles(
              resolvedRoot.absolutePath,
              resolvedRoot.relativePath,
              extensions ?? [],
              recursive ?? false,
              Math.min(limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
              results,
              truncated
            );

            return createSuccessResponse(
              {
                root: resolvedRoot.resPath,
                files: results.filter((e) => e.type === "file").map((e) => e.path),
                entries: results,
                count: results.length,
                truncated: truncated.value
              },
              truncated.value
                ? `Listed ${results.length} entries (truncated at limit).`
                : `Listed ${results.length} entries.`
            );
          }
        )
      );
    }
  );

  server.registerTool(
    "godot_read_file",
    {
      title: "Read Godot Project File",
      description:
        "Reads the full content of a file inside the Godot project. Does not require Godot to be running.",
      inputSchema: {
        path: z.string().describe("res:// path of the file to read.")
      }
    },
    async ({ path: resPath }) => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_read_file",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => {
            const resolved = resolveProjectPath(resPath, config.projectRoot);

            let content: string;
            try {
              content = await readFile(resolved.absolutePath, "utf8");
            } catch (error) {
              const cause = error instanceof Error ? error.message : String(error);
              return createErrorResponse(
                "FILE_READ_FAILED",
                "Could not read the requested file.",
                { path: resolved.resPath, cause },
                ["Verify the file exists and the path is correct."]
              );
            }

            return createSuccessResponse(
              { path: resolved.resPath, content, size_bytes: Buffer.byteLength(content, "utf8") },
              "File read successfully."
            );
          }
        )
      );
    }
  );

  server.registerTool(
    "godot_get_project_info",
    {
      title: "Get Godot Project Info",
      description:
        "Returns project name, path, Godot version and main scene. Requires Godot editor to be running with the plugin active.",
      inputSchema: {}
    },
    async () => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_get_project_info",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => callAfterConnect(godot, "project.get_info", {})
        )
      );
    }
  );

  server.registerTool(
    "godot_get_editor_context",
    {
      title: "Get Godot Editor Context",
      description:
        "Returns the current scene, selected nodes and play state from the Godot editor. Requires Godot editor to be running with the plugin active.",
      inputSchema: {}
    },
    async () => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_get_editor_context",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => callAfterConnect(godot, "project.get_editor_context", {})
        )
      );
    }
  );

  server.registerTool(
    "godot_get_project_settings",
    {
      title: "Get Godot Project Settings",
      description:
        "Returns the most relevant project settings (application, display, physics, rendering). Requires Godot editor to be running with the plugin active.",
      inputSchema: {}
    },
    async () => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_get_project_settings",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => callAfterConnect(godot, "project.get_project_settings", {})
        )
      );
    }
  );

  server.registerTool(
    "godot_get_open_scenes",
    {
      title: "Get Open Scenes",
      description:
        "Returns the list of scenes currently open in the Godot editor. Requires Godot editor to be running with the plugin active.",
      inputSchema: {}
    },
    async () => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_get_open_scenes",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => callAfterConnect(godot, "project.get_open_scenes", {})
        )
      );
    }
  );

  server.registerTool(
    "godot_get_selected_nodes",
    {
      title: "Get Selected Nodes",
      description:
        "Returns detailed information about nodes currently selected in the Godot editor. Requires Godot editor to be running with the plugin active.",
      inputSchema: {}
    },
    async () => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_get_selected_nodes",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => callAfterConnect(godot, "project.get_selected_nodes", {})
        )
      );
    }
  );

  server.registerTool(
    "godot_get_input_map",
    {
      title: "Get Input Map",
      description:
        "Returns all Input Map actions and their events. Requires Godot editor to be running with the plugin active.",
      inputSchema: {}
    },
    async () => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_get_input_map",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => callAfterConnect(godot, "project.get_input_map", {})
        )
      );
    }
  );

  server.registerTool(
    "godot_add_input_action",
    {
      title: "Add Input Action",
      description:
        "Adds a new Input Map action to the project. Persists to project.godot. Requires read-only mode to be disabled.",
      inputSchema: {
        action_name: z.string().describe("Name of the new input action."),
        deadzone: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .default(0.5)
          .describe("Deadzone for the action (0.0–1.0). Defaults to 0.5."),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("Preview planned changes without applying them.")
      }
    },
    async ({ action_name, deadzone, dry_run }) => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_add_input_action",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => {
            if (dry_run) {
              return createDryRunResponse({
                toolName: "godot_add_input_action",
                plannedChanges: [`Add input action '${action_name}' with deadzone=${deadzone}`],
                affectedFiles: ["res://project.godot"]
              });
            }

            return callAfterConnect(godot, "project.add_input_action", { action_name, deadzone });
          }
        )
      );
    }
  );

  server.registerTool(
    "godot_remove_input_action",
    {
      title: "Remove Input Action",
      description:
        "Removes an Input Map action from the project. Persists to project.godot. Requires read-only mode to be disabled.",
      inputSchema: {
        action_name: z.string().describe("Name of the input action to remove."),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("Preview planned changes without applying them.")
      }
    },
    async ({ action_name, dry_run }) => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_remove_input_action",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => {
            if (dry_run) {
              return createDryRunResponse({
                toolName: "godot_remove_input_action",
                plannedChanges: [`Remove input action '${action_name}'`],
                affectedFiles: ["res://project.godot"]
              });
            }

            return callAfterConnect(godot, "project.remove_input_action", { action_name });
          }
        )
      );
    }
  );

  server.registerTool(
    "godot_get_autoloads",
    {
      title: "Get Autoloads",
      description:
        "Returns all autoload singletons registered in the project. Requires Godot editor to be running with the plugin active.",
      inputSchema: {}
    },
    async () => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_get_autoloads",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => callAfterConnect(godot, "project.get_autoloads", {})
        )
      );
    }
  );

  server.registerTool(
    "godot_add_autoload",
    {
      title: "Add Autoload",
      description:
        "Registers a new autoload singleton in the project. Persists to project.godot. Requires read-only mode to be disabled.",
      inputSchema: {
        name: z.string().describe("Singleton name (used in code as a global)."),
        path: z.string().describe("res:// path to the script or scene to autoload."),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("Preview planned changes without applying them.")
      }
    },
    async ({ name, path: resPath, dry_run }) => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_add_autoload",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => {
            resolveProjectPath(resPath, config.projectRoot);

            if (dry_run) {
              return createDryRunResponse({
                toolName: "godot_add_autoload",
                plannedChanges: [`Register autoload '${name}' → ${resPath}`],
                affectedFiles: ["res://project.godot"]
              });
            }

            return callAfterConnect(godot, "project.add_autoload", { name, path: resPath });
          }
        )
      );
    }
  );

  server.registerTool(
    "godot_remove_autoload",
    {
      title: "Remove Autoload",
      description:
        "Removes an autoload singleton from the project. Persists to project.godot. Requires read-only mode to be disabled.",
      inputSchema: {
        name: z.string().describe("Singleton name to remove."),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("Preview planned changes without applying them.")
      }
    },
    async ({ name, dry_run }) => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_remove_autoload",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => {
            if (dry_run) {
              return createDryRunResponse({
                toolName: "godot_remove_autoload",
                plannedChanges: [`Remove autoload '${name}'`],
                affectedFiles: ["res://project.godot"]
              });
            }

            return callAfterConnect(godot, "project.remove_autoload", { name });
          }
        )
      );
    }
  );
}
