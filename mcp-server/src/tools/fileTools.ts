import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createFileBackup } from "../safety/backup.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely, type ToolExecutionContext } from "../safety/toolWrapper.js";

function ctx(toolName: string, config: ServerConfig): ToolExecutionContext {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function fileExists(absolutePath: string): Promise<boolean> {
  return access(absolutePath).then(() => true).catch(() => false);
}

type SearchEntry = { name: string; path: string };

async function searchFilesInDirectory(
  absoluteDir: string,
  resRelativeDir: string,
  pattern: string,
  extensions: string[],
  recursive: boolean,
  limit: number,
  results: SearchEntry[],
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
      if (recursive) {
        await searchFilesInDirectory(
          path.join(absoluteDir, entry.name),
          entryRes,
          pattern,
          extensions,
          recursive,
          limit,
          results,
          truncated
        );
      }
    } else {
      const matchesPattern = pattern === "" || entry.name.toLowerCase().includes(pattern.toLowerCase());
      const matchesExt =
        extensions.length === 0 || extensions.some((ext) => entry.name.endsWith(ext));

      if (matchesPattern && matchesExt) {
        results.push({ name: entry.name, path: entryResPath });
      }
    }
  }
}

export function registerFileTools(server: McpServer, config: ServerConfig): void {
  server.registerTool(
    "godot_search_files",
    {
      title: "Search Godot Project Files",
      description:
        "Searches for files whose name contains the given pattern. Does not require Godot to be running.",
      inputSchema: {
        pattern: z.string().describe("Substring to match against filenames (case-insensitive)."),
        root: z
          .string()
          .optional()
          .default("res://")
          .describe("res:// directory to search. Defaults to the project root."),
        extensions: z
          .array(z.string())
          .optional()
          .default([])
          .describe("Filter by extension, e.g. [\".gd\", \".tscn\"]. Empty means all files."),
        recursive: z.boolean().optional().default(true).describe("Recurse into subdirectories."),
        limit: z
          .number()
          .int()
          .positive()
          .max(MAX_LIMIT)
          .optional()
          .default(DEFAULT_LIMIT)
          .describe(`Maximum results to return (max ${MAX_LIMIT}).`)
      }
    },
    async ({ pattern, root, extensions, recursive, limit }) => {
      return toMcpResult(
        await executeToolSafely(
          {
            toolName: "godot_search_files",
            readOnly: config.security.readOnly,
            projectRoot: config.projectRoot
          },
          async () => {
            const projectRootAbs = path.resolve(config.projectRoot);
            const resolvedRoot =
              root === "res://" || root === "res:///"
                ? { resPath: "res://", relativePath: "", absolutePath: projectRootAbs }
                : resolveProjectPath(root, projectRootAbs);

            const results: SearchEntry[] = [];
            const truncated = { value: false };
            await searchFilesInDirectory(
              resolvedRoot.absolutePath,
              resolvedRoot.relativePath,
              pattern,
              extensions ?? [],
              recursive ?? true,
              Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT),
              results,
              truncated
            );

            return createSuccessResponse(
              {
                pattern,
                root: resolvedRoot.resPath,
                files: results.map((e) => e.path),
                count: results.length,
                truncated: truncated.value
              },
              truncated.value
                ? `Found ${results.length} files matching "${pattern}" (truncated at limit).`
                : `Found ${results.length} files matching "${pattern}".`
            );
          }
        )
      );
    }
  );

  server.registerTool(
    "godot_write_file",
    {
      title: "Write Godot Project File",
      description:
        "Writes content to a file inside the Godot project. Creates the file if it does not exist. Requires read-only mode to be disabled. Creates a backup before overwriting.",
      inputSchema: {
        path: z.string().describe("res:// path of the file to write."),
        content: z.string().describe("Full content to write."),
        overwrite: z
          .boolean()
          .optional()
          .default(false)
          .describe("Allow overwriting an existing file. Defaults to false."),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("Preview planned changes without applying them.")
      }
    },
    async ({ path: resPath, content, overwrite, dry_run }) => {
      return toMcpResult(
        await executeToolSafely(
          ctx("godot_write_file", config),
          async (): Promise<ToolResponse> => {
            const resolved = resolveProjectPath(resPath, config.projectRoot);
            const exists = await fileExists(resolved.absolutePath);

            if (dry_run) {
              return createDryRunResponse({
                toolName: "godot_write_file",
                plannedChanges: exists
                  ? [`Overwrite ${resolved.resPath} (backup will be created first)`]
                  : [`Create ${resolved.resPath}`],
                affectedFiles: [resolved.resPath]
              });
            }

            if (exists && !overwrite) {
              return createErrorResponse(
                "FILE_ALREADY_EXISTS",
                "File already exists. Set overwrite=true to overwrite.",
                { path: resolved.resPath },
                ["Pass overwrite=true to replace the existing file, or use godot_patch_file for partial edits."]
              );
            }

            if (exists) {
              await createFileBackup({
                projectRoot: config.projectRoot,
                resPath: resolved.resPath,
                toolName: "godot_write_file",
                reason: "pre-write backup"
              });
            }

            await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
            await writeFile(resolved.absolutePath, content, "utf8");

            return createSuccessResponse(
              {
                path: resolved.resPath,
                size_bytes: Buffer.byteLength(content, "utf8"),
                created: !exists,
                backed_up: exists
              },
              exists ? "File overwritten successfully." : "File created successfully."
            );
          }
        )
      );
    }
  );

  server.registerTool(
    "godot_patch_file",
    {
      title: "Patch Godot Project File",
      description:
        "Replaces the first occurrence of old_content with new_content in a file. Creates a backup before patching. Requires read-only mode to be disabled.",
      inputSchema: {
        path: z.string().describe("res:// path of the file to patch."),
        old_content: z.string().describe("Exact string to find and replace."),
        new_content: z.string().describe("Replacement string."),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe("Preview planned changes without applying them.")
      }
    },
    async ({ path: resPath, old_content, new_content, dry_run }) => {
      return toMcpResult(
        await executeToolSafely(
          ctx("godot_patch_file", config),
          async (): Promise<ToolResponse> => {
            const resolved = resolveProjectPath(resPath, config.projectRoot);

            let current: string;
            try {
              current = await readFile(resolved.absolutePath, "utf8");
            } catch (error) {
              return createErrorResponse(
                "FILE_READ_FAILED",
                "Cannot read file to patch.",
                { path: resolved.resPath, cause: error instanceof Error ? error.message : String(error) },
                ["Verify the file exists and the path is correct."]
              );
            }

            if (!current.includes(old_content)) {
              return createErrorResponse(
                "PATCH_CONTENT_NOT_FOUND",
                "old_content not found in the file.",
                { path: resolved.resPath },
                [
                  "Check that old_content matches exactly, including whitespace and line endings.",
                  "Use godot_read_file to inspect the current file content first."
                ]
              );
            }

            if (dry_run) {
              return createDryRunResponse({
                toolName: "godot_patch_file",
                plannedChanges: [`Replace content in ${resolved.resPath} (backup will be created first)`],
                affectedFiles: [resolved.resPath]
              });
            }

            await createFileBackup({
              projectRoot: config.projectRoot,
              resPath: resolved.resPath,
              toolName: "godot_patch_file",
              reason: "pre-patch backup"
            });

            const patched = current.replace(old_content, new_content);
            await writeFile(resolved.absolutePath, patched, "utf8");

            return createSuccessResponse(
              {
                path: resolved.resPath,
                size_bytes: Buffer.byteLength(patched, "utf8"),
                backed_up: true
              },
              "File patched successfully."
            );
          }
        )
      );
    }
  );
}
