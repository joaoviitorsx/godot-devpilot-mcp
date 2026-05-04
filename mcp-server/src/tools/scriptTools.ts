import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createFileBackup } from "../safety/backup.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { createSafetyError } from "../safety/errors.js";
import { resolveProjectPath, type ResolvedProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely, type ToolExecutionContext } from "../safety/toolWrapper.js";

type ScriptSymbol = {
  name: string;
  line: number;
};

type ScriptReference = {
  path: string;
  line: number;
  column: number;
  text: string;
};

const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "id_rsa",
  "id_dsa",
  "id_ed25519"
]);

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

function requireScriptPath(inputPath: unknown, config: ServerConfig): ResolvedProjectPath {
  if (typeof inputPath !== "string") {
    throw createSafetyError(
      "INVALID_PARAMS",
      "path/script_path must be a string.",
      { path: inputPath },
      ["Use a res:// path ending in .gd."]
    );
  }

  const resolved = resolveProjectPath(inputPath, config.projectRoot);
  const basename = path.posix.basename(resolved.relativePath);
  if (SENSITIVE_BASENAMES.has(basename) || !resolved.resPath.endsWith(".gd")) {
    throw createSafetyError(
      "SENSITIVE_FILE_BLOCKED",
      "Only non-sensitive .gd script files are allowed.",
      { path: resolved.resPath },
      ["Use a res:// path ending in .gd that is not a secret or config file."]
    );
  }

  return resolved;
}

function makeScriptContent(extendsName: string, content?: string): string {
  const body = content ?? "\nfunc _ready():\n\tpass\n";
  const normalizedBody = body.startsWith("extends ") ? body : `extends ${extendsName}\n${body.startsWith("\n") ? body : `\n${body}`}`;
  return normalizedBody.endsWith("\n") ? normalizedBody : `${normalizedBody}\n`;
}

function extractSymbols(content: string) {
  const lines = content.split(/\r?\n/);
  const functions: ScriptSymbol[] = [];
  const signals: ScriptSymbol[] = [];
  const variables: ScriptSymbol[] = [];
  let className = "";
  let extendsName = "";

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    const classMatch = /^class_name\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
    const extendsMatch = /^extends\s+([A-Za-z_][A-Za-z0-9_./":-]*)/.exec(trimmed);
    const funcMatch = /^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(trimmed);
    const signalMatch = /^signal\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
    const varMatch = /^(?:@export\s+)?(?:var|const)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);

    if (classMatch) className = classMatch[1];
    if (extendsMatch) extendsName = extendsMatch[1].replace(/^"|"$/g, "");
    if (funcMatch) functions.push({ name: funcMatch[1], line: lineNo });
    if (signalMatch) signals.push({ name: signalMatch[1], line: lineNo });
    if (varMatch) variables.push({ name: varMatch[1], line: lineNo });
  });

  return { class_name: className, extends: extendsName, functions, signals, variables };
}

function extractDependencies(content: string): string[] {
  const dependencies = new Set<string>();
  const pattern = /\b(?:preload|load)\(\s*"([^"]+)"\s*\)|^extends\s+"([^"]+)"/gm;
  for (const match of content.matchAll(pattern)) {
    const dep = match[1] ?? match[2];
    if (dep?.startsWith("res://")) dependencies.add(dep);
  }
  return [...dependencies].sort();
}

function detectGodot3Warnings(content: string, target: string): Array<{ line: number; column: number; message: string }> {
  if (!target.startsWith("4")) return [];
  const warnings: Array<{ line: number; column: number; message: string }> = [];
  const patterns = [
    { regex: /\bexport\s*\(/, message: "Godot 3 export(...) syntax detected. Use @export in Godot 4.x." },
    { regex: /\bonready\s+var\b/, message: "Godot 3 onready var syntax detected. Use @onready var in Godot 4.x." },
    { regex: /\byield\s*\(/, message: "Godot 3 yield(...) syntax detected. Use await in Godot 4.x." },
    { regex: /\bKinematicBody2D\b/, message: "KinematicBody2D was replaced by CharacterBody2D in Godot 4.x." },
    { regex: /\bKinematicBody3D\b/, message: "KinematicBody3D was replaced by CharacterBody3D in Godot 4.x." }
  ];

  content.split(/\r?\n/).forEach((line, index) => {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line);
      if (match) {
        warnings.push({ line: index + 1, column: match.index + 1, message: pattern.message });
      }
    }
  });

  return warnings;
}

function formatScriptContent(content: string): string {
  return `${content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n*$/g, "")}\n`;
}

async function collectGdFiles(dir: string, relativeDir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== ".godot" && entry.name !== ".godot_mcp") {
        await collectGdFiles(abs, rel, out);
      }
    } else if (entry.name.endsWith(".gd")) {
      out.push(`res://${rel}`);
    }
  }
}

export function registerScriptTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "godot_create_script",
    "Create a GDScript file inside the Godot project.",
    {
      path: z.string().describe("res:// path ending in .gd."),
      extends: z.string().optional().describe("Base class. Defaults to Node."),
      content: z.string().optional().describe("Optional script body or full script content."),
      overwrite: z.boolean().optional().describe("Allow overwriting an existing script after backup."),
      dry_run: z.boolean().optional().describe("Preview without writing.")
    },
    async ({ path: resPath, extends: extendsName, content, overwrite, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_create_script", config), async (): Promise<ToolResponse> => {
        const resolved = requireScriptPath(resPath, config);
        const exists = await fileExists(resolved.absolutePath);
        const finalContent = makeScriptContent(extendsName ?? "Node", content);

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_script",
            plannedChanges: [exists ? `Overwrite ${resolved.resPath} with backup` : `Create ${resolved.resPath}`],
            affectedFiles: [resolved.resPath]
          });
        }

        if (exists && !overwrite) {
          return createErrorResponse(
            "FILE_ALREADY_EXISTS",
            "Script already exists. Set overwrite=true to overwrite.",
            { path: resolved.resPath },
            ["Use godot_patch_script for targeted edits, or overwrite=true after review."]
          );
        }

        let backupPath: string | null = null;
        if (exists) {
          const backup = await createFileBackup({
            projectRoot: config.projectRoot,
            resPath: resolved.resPath,
            toolName: "godot_create_script",
            reason: "pre-script-overwrite backup"
          });
          backupPath = backup.backupResPath;
        }

        await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
        await writeFile(resolved.absolutePath, finalContent, "utf8");
        return createSuccessResponse(
          {
            script_path: resolved.resPath,
            extends: extendsName ?? "Node",
            size_bytes: Buffer.byteLength(finalContent, "utf8"),
            backup_path: backupPath
          },
          "Script created successfully.",
          [],
          ["Use godot_validate_script to validate syntax."]
        );
      })
    )
  );

  server.tool(
    "godot_read_script",
    "Read a GDScript file inside the Godot project.",
    { path: z.string().describe("res:// path ending in .gd.") },
    async ({ path: resPath }) => toMcpResult(
      await executeToolSafely(ctx("godot_read_script", config), async (): Promise<ToolResponse> => {
        const resolved = requireScriptPath(resPath, config);
        const content = await readFile(resolved.absolutePath, "utf8").catch((error: unknown) => {
          throw createSafetyError(
            "FILE_READ_FAILED",
            "Could not read script.",
            { path: resolved.resPath, cause: error instanceof Error ? error.message : String(error) },
            ["Verify the script exists."]
          );
        });
        return createSuccessResponse(
          { script_path: resolved.resPath, content, size_bytes: Buffer.byteLength(content, "utf8") },
          "Script read successfully."
        );
      })
    )
  );

  server.tool(
    "godot_patch_script",
    "Patch a GDScript file by replacing exact content. Creates backup before applying.",
    {
      path: z.string().describe("res:// path ending in .gd."),
      old_content: z.string().describe("Exact content to replace."),
      new_content: z.string().describe("Replacement content."),
      dry_run: z.boolean().optional().describe("Preview without writing.")
    },
    async ({ path: resPath, old_content, new_content, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_patch_script", config), async (): Promise<ToolResponse> => {
        const resolved = requireScriptPath(resPath, config);
        const current = await readFile(resolved.absolutePath, "utf8").catch((error: unknown) => {
          throw createSafetyError("FILE_READ_FAILED", "Could not read script to patch.", { path: resolved.resPath, cause: error instanceof Error ? error.message : String(error) }, []);
        });

        if (!current.includes(old_content)) {
          return createErrorResponse(
            "PATCH_CONTENT_NOT_FOUND",
            "old_content not found in script.",
            { path: resolved.resPath },
            ["Read the script first and pass an exact old_content string."]
          );
        }

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_patch_script",
            plannedChanges: [`Patch ${resolved.resPath} (backup will be created first)`],
            affectedFiles: [resolved.resPath]
          });
        }

        const backup = await createFileBackup({
          projectRoot: config.projectRoot,
          resPath: resolved.resPath,
          toolName: "godot_patch_script",
          reason: "pre-script-patch backup"
        });
        const patched = current.replace(old_content, new_content);
        await writeFile(resolved.absolutePath, patched, "utf8");
        return createSuccessResponse(
          { script_path: resolved.resPath, backup_path: backup.backupResPath, size_bytes: Buffer.byteLength(patched, "utf8") },
          "Script patched successfully."
        );
      })
    )
  );

  server.tool(
    "godot_attach_script",
    "Attach a GDScript file to a node using Godot editor UndoRedo.",
    {
      node_path: z.string().describe("Node path relative to scene root."),
      script_path: z.string().describe("res:// script path ending in .gd."),
      dry_run: z.boolean().optional().describe("Preview without mutating.")
    },
    async ({ node_path, script_path, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_attach_script", config), async (): Promise<ToolResponse> => {
        const resolved = requireScriptPath(script_path, config);
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_attach_script",
            plannedChanges: [`Attach ${resolved.resPath} to node ${node_path}`],
            affectedFiles: [resolved.resPath],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "script.attach", { node_path, script_path: resolved.resPath });
      })
    )
  );

  server.tool(
    "godot_validate_script",
    "Validate a GDScript file with Godot and report Godot 3 syntax warnings for Godot 4 targets.",
    {
      path: z.string().describe("res:// script path ending in .gd."),
      godot_version_target: z.string().optional().describe("Target Godot version. Defaults to 4.x.")
    },
    async ({ path: resPath, godot_version_target }) => toMcpResult(
      await executeToolSafely(ctx("godot_validate_script", config), async (): Promise<ToolResponse> => {
        const resolved = requireScriptPath(resPath, config);
        return callAfterConnect(godot, "script.validate", { path: resolved.resPath, godot_version_target: godot_version_target ?? "4.x" });
      })
    )
  );

  server.tool(
    "godot_get_classdb_info",
    "Get ClassDB information for a Godot class.",
    { class_name: z.string().describe("Godot class name.") },
    async ({ class_name }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_classdb_info", config), async (): Promise<ToolResponse> =>
        callAfterConnect(godot, "script.get_classdb_info", { class_name })
      )
    )
  );

  server.tool(
    "godot_get_script_symbols",
    "Extract class_name, extends, functions, signals and variables from a GDScript file.",
    { path: z.string().describe("res:// script path ending in .gd.") },
    async ({ path: resPath }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_script_symbols", config), async (): Promise<ToolResponse> => {
        const resolved = requireScriptPath(resPath, config);
        const content = await readFile(resolved.absolutePath, "utf8");
        return createSuccessResponse({ script_path: resolved.resPath, ...extractSymbols(content) }, "Script symbols extracted.");
      })
    )
  );

  server.tool(
    "godot_get_script_dependencies",
    "Extract res:// script/resource dependencies from preload/load/extends.",
    { path: z.string().describe("res:// script path ending in .gd.") },
    async ({ path: resPath }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_script_dependencies", config), async (): Promise<ToolResponse> => {
        const resolved = requireScriptPath(resPath, config);
        const content = await readFile(resolved.absolutePath, "utf8");
        return createSuccessResponse({ script_path: resolved.resPath, dependencies: extractDependencies(content) }, "Script dependencies extracted.");
      })
    )
  );

  server.tool(
    "godot_find_references",
    "Find text references in GDScript files.",
    {
      query: z.string().describe("Text to search."),
      root: z.string().optional().describe("res:// directory to search. Defaults to res://."),
      limit: z.number().int().positive().max(500).optional().describe("Max references. Defaults to 100.")
    },
    async ({ query, root, limit }) => toMcpResult(
      await executeToolSafely(ctx("godot_find_references", config), async (): Promise<ToolResponse> => {
        const rootPath = root && root !== "res://" ? resolveProjectPath(root, config.projectRoot) : { absolutePath: config.projectRoot, resPath: "res://", relativePath: "", inputPath: "res://" };
        const files: string[] = [];
        await collectGdFiles(rootPath.absolutePath, rootPath.relativePath, files);
        const references: ScriptReference[] = [];
        const max = limit ?? 100;

        for (const file of files) {
          if (references.length >= max) break;
          const resolved = requireScriptPath(file, config);
          const content = await readFile(resolved.absolutePath, "utf8");
          content.split(/\r?\n/).forEach((line, index) => {
            const col = line.indexOf(query);
            if (col >= 0 && references.length < max) {
              references.push({ path: resolved.resPath, line: index + 1, column: col + 1, text: line.trim() });
            }
          });
        }

        return createSuccessResponse({ query, references, count: references.length, truncated: references.length >= max }, "References found.");
      })
    )
  );

  server.tool(
    "godot_format_script",
    "Apply conservative GDScript formatting: LF endings, trim trailing whitespace and final newline.",
    {
      path: z.string().describe("res:// script path ending in .gd."),
      dry_run: z.boolean().optional().describe("Preview without writing.")
    },
    async ({ path: resPath, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_format_script", config), async (): Promise<ToolResponse> => {
        const resolved = requireScriptPath(resPath, config);
        const current = await readFile(resolved.absolutePath, "utf8");
        const formatted = formatScriptContent(current);

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_format_script",
            plannedChanges: current === formatted ? [] : [`Format ${resolved.resPath} (backup will be created first)`],
            affectedFiles: [resolved.resPath]
          });
        }

        if (current === formatted) {
          return createSuccessResponse({ script_path: resolved.resPath, changed: false, backup_path: null }, "Script already formatted.");
        }

        const backup = await createFileBackup({
          projectRoot: config.projectRoot,
          resPath: resolved.resPath,
          toolName: "godot_format_script",
          reason: "pre-script-format backup"
        });
        await writeFile(resolved.absolutePath, formatted, "utf8");
        return createSuccessResponse({ script_path: resolved.resPath, changed: true, backup_path: backup.backupResPath }, "Script formatted successfully.");
      })
    )
  );
}

export const __scriptToolInternals = {
  detectGodot3Warnings
};
