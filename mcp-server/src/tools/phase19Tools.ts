import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely, type ToolExecutionContext } from "../safety/toolWrapper.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { createFileBackup } from "../safety/backup.js";
import { access, copyFile, mkdir, readFile, stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

function toMcpResult(response: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], isError: !response.ok };
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
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function requirePluginField(response: ToolResponse, field: string, method: string): ToolResponse {
  if (response.ok && (typeof response.data !== "object" || response.data === null || !(field in response.data))) {
    return createErrorResponse("EMPTY_PLUGIN_RESULT", "Godot did not confirm the change. Check the editor output.", { method, expected_field: field }, []);
  }
  return response;
}

async function hasExportPreset(projectRoot: string, name: string): Promise<boolean> {
  const content = await readFile(path.join(projectRoot, "export_presets.cfg"), "utf8").catch(() => "");
  let section = "";
  for (const line of content.split(/\r?\n/)) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1]; continue; }
    if (/^preset\.\d+$/.test(section) && line.startsWith("name=")) {
      const raw = line.slice(5).trim();
      let parsed: string;
      try { parsed = raw.startsWith('"') ? JSON.parse(raw) as string : raw; }
      catch { continue; }
      if (parsed === name) return true;
    }
  }
  return false;
}

function runExport(godotBin: string, projectRoot: string, preset: string, output: string, debug: boolean, timeoutMs: number): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(godotBin, ["--headless", "--path", projectRoot, debug ? "--export-debug" : "--export-release", preset, output], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    let timedOut = false;
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, output: log.slice(-12000), timedOut });
    };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", (chunk) => { log = (log + chunk.toString()).slice(-12000); });
    child.stderr.on("data", (chunk) => { log = (log + chunk.toString()).slice(-12000); });
    child.on("close", finish);
    child.on("error", (error) => { log += `\n${error.message}`; finish(-1); });
  });
}

export function registerPhase19Tools(server: McpServer, godot: GodotClient, config: ServerConfig): void {

  // 1. godot_list_export_presets
  server.tool(
    "godot_list_export_presets",
    "List all export presets configured in export_presets.cfg.",
    {},
    async () => {
      const result = await executeToolSafely(ctx("godot_list_export_presets", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "export.list_presets", {});
      });
      return toMcpResult(result);
    }
  );

  // 2. godot_export_project
  server.tool(
    "godot_export_project",
    "Export a real build with a configured Godot preset and verify the output. Works without an open editor; requires installed export templates and writes under res://builds/.",
    {
      preset_name: z.string().describe("Export preset name as shown in Project > Export."),
      export_path: z.string().describe("Output file under res://builds/, e.g. res://builds/game.exe."),
      debug: z.boolean().optional().describe("Export debug build. Defaults to false."),
      godot_bin: z.string().optional().describe("Godot editor executable. Defaults to 'godot' on PATH."),
      timeout_seconds: z.number().int().min(10).max(1800).optional(),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ preset_name, export_path, debug, godot_bin, timeout_seconds, overwrite, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_export_project", config), async (): Promise<ToolResponse> => {
        if (!(await hasExportPreset(config.projectRoot, preset_name))) return createErrorResponse("EXPORT_PRESET_NOT_FOUND", "Export preset was not found in export_presets.cfg.", { preset_name }, []);
        const resPath = export_path;
        if (!resPath.startsWith("res://builds/") || resPath.endsWith("/")) return createErrorResponse("INVALID_EXPORT_PATH", "Provide an output file under res://builds/.", { export_path: resPath }, []);
        const target = resolveProjectPath(resPath, config.projectRoot);
        if (dry_run) return createDryRunResponse({ toolName: "godot_export_project", plannedChanges: [`Export preset '${preset_name}' to ${resPath} with ${debug ? "debug" : "release"} templates`], affectedFiles: [resPath], affectedNodes: [] });
        const exists = await access(target.absolutePath).then(() => true, () => false);
        if (exists && !overwrite) return createErrorResponse("EXPORT_EXISTS", "Export target exists. Set overwrite=true to replace it.", { export_path: resPath }, []);
        const backupPath = exists ? (await createFileBackup({ projectRoot: config.projectRoot, resPath, toolName: "godot_export_project", reason: "Overwrite exported build" })).backupResPath : null;
        // Remove the previous build after backing it up. Otherwise a successful
        // editor exit without output could make the old file look newly exported.
        if (exists) await unlink(target.absolutePath);
        await mkdir(path.dirname(target.absolutePath), { recursive: true });
        const run = await runExport(godot_bin ?? "godot", config.projectRoot, preset_name, target.absolutePath, debug ?? false, (timeout_seconds ?? 300) * 1000);
        const exported = await stat(target.absolutePath).catch(() => null);
        if (run.timedOut || run.code !== 0 || !exported?.isFile() || exported.size === 0) {
          if (exported?.isFile()) await unlink(target.absolutePath);
          if (backupPath) await copyFile(resolveProjectPath(backupPath, config.projectRoot).absolutePath, target.absolutePath);
          const failed = run.timedOut || run.code !== 0;
          return createErrorResponse(failed ? "EXPORT_FAILED" : "EXPORT_MISSING", failed ? (run.timedOut ? "Godot export timed out." : "Godot export failed.") : "Godot exited successfully but produced no nonempty build file.", { exit_code: run.code, output: run.output, export_path: resPath, backup_path: backupPath, previous_build_restored: Boolean(backupPath) }, ["Check the preset and install export templates for this Godot version."]);
        }
        return createSuccessResponse({ preset_name, export_path: resPath, bytes: exported.size, debug: debug ?? false, output: run.output, backup_path: backupPath }, "Build exported and verified.");
      });
      return toMcpResult(result);
    }
  );

  // 3. godot_get_export_info
  server.tool(
    "godot_get_export_info",
    "Get detailed export info for a specific preset (features, patches, templates).",
    {
      preset_name: z.string()
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_get_export_info", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "export.get_info", params);
      });
      return toMcpResult(result);
    }
  );

  // 4. godot_read_resource
  server.tool(
    "godot_read_resource",
    "Inspect all storage properties of a .tres or .res resource file.",
    {
      path: z.string().describe("res:// path to resource file (.tres/.res).")
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_read_resource", config), async (): Promise<ToolResponse> => {
        resolveProjectPath(params.path, config.projectRoot);
        return callAfterConnect(godot, "resource.read", params);
      });
      return toMcpResult(result);
    }
  );

  // 5. godot_edit_resource
  server.tool(
    "godot_edit_resource",
    "Modify a typed stored property on an existing .tres or .res resource and save it after creating a recoverable backup.",
    {
      path: z.string(),
      property: z.string().describe("Property name to modify."),
      value: z.unknown().describe("New value."),
      dry_run: z.boolean().optional()
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_edit_resource", config), async (): Promise<ToolResponse> => {
        resolveProjectPath(params.path, config.projectRoot);
        if (!/\.(tres|res)$/i.test(params.path)) return createErrorResponse("INVALID_RESOURCE_PATH", "Use an existing .tres or .res project resource.", {}, []);
        if (params.dry_run) {
          return createDryRunResponse({
            toolName: "godot_edit_resource",
            plannedChanges: [`Set property '${params.property}' on resource '${params.path}'`],
            affectedFiles: [params.path],
            affectedNodes: []
          });
        }
        const backup = await createFileBackup({ projectRoot: config.projectRoot, resPath: params.path, toolName: "godot_edit_resource", reason: `Edit ${params.property}` });
        const result = requirePluginField(await callAfterConnect(godot, "resource.edit", params), "resource_path", "resource.edit");
        return result.ok && typeof result.data === "object" && result.data !== null
          ? { ...result, data: { ...result.data, backup_path: backup.backupResPath } }
          : result;
      });
      return toMcpResult(result);
    }
  );

  // 6. godot_create_resource
  server.tool(
    "godot_create_resource",
    "Create a typed .tres resource. Existing resources require overwrite=true and receive a recoverable backup.",
    {
      path: z.string().describe("res:// output path (must end in .tres)."),
      resource_type: z.string().describe("ClassDB resource type e.g. 'Environment', 'PhysicsMaterial', 'AudioStreamWAV'."),
      properties: z.record(z.string(), z.unknown()).optional().describe("Initial property values."),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_create_resource", config), async (): Promise<ToolResponse> => {
        const target = resolveProjectPath(params.path, config.projectRoot);
        if (!params.path.endsWith(".tres")) return createErrorResponse("INVALID_RESOURCE_PATH", "Resource output must end in .tres.", {}, []);
        if (params.dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_resource",
            plannedChanges: [`Create ${params.resource_type} resource at '${params.path}'`],
            affectedFiles: [params.path],
            affectedNodes: []
          });
        }
        let backupPath: string | null = null;
        if (params.overwrite) {
          const exists = await access(target.absolutePath).then(() => true, () => false);
          if (exists) {
            const backup = await createFileBackup({ projectRoot: config.projectRoot, resPath: params.path, toolName: "godot_create_resource", reason: "Overwrite resource" });
            backupPath = backup.backupResPath;
          }
        }
        const result = requirePluginField(await callAfterConnect(godot, "resource.create", params), "path", "resource.create");
        return backupPath && result.ok && typeof result.data === "object" && result.data !== null
          ? { ...result, data: { ...result.data, backup_path: backupPath } }
          : result;
      });
      return toMcpResult(result);
    }
  );

  // 7. godot_find_nodes_by_type
  server.tool(
    "godot_find_nodes_by_type",
    "Find all nodes of a given class type in the current scene (or recursively in all open scenes).",
    {
      class_name: z.string().describe("ClassDB class name e.g. 'RigidBody2D'."),
      exact_match: z.boolean().optional().describe("Exact class match vs is_class() inheritance check. Default false (includes subclasses).")
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_find_nodes_by_type", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "batch.find_by_type", params);
      });
      return toMcpResult(result);
    }
  );

  // 8. godot_batch_set_property
  server.tool(
    "godot_batch_set_property",
    "Set the same property to the same value on multiple nodes at once (UndoRedo-backed).",
    {
      node_paths: z.array(z.string()).min(1).describe("List of NodePaths to update."),
      property: z.string().describe("Property name."),
      value: z.unknown().describe("Value to set."),
      dry_run: z.boolean().optional()
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_batch_set_property", config), async (): Promise<ToolResponse> => {
        if (params.dry_run) {
          return createDryRunResponse({
            toolName: "godot_batch_set_property",
            plannedChanges: params.node_paths.map(p => `Set '${params.property}' on ${p}`),
            affectedFiles: [],
            affectedNodes: params.node_paths
          });
        }
        return callAfterConnect(godot, "batch.set_property", params);
      });
      return toMcpResult(result);
    }
  );

  // 9. godot_cross_scene_set_property
  server.tool(
    "godot_cross_scene_set_property",
    "Set a property on a node in every .tscn file in the project that matches a class filter.",
    {
      class_name: z.string().describe("Target node class (e.g. 'Label')."),
      property: z.string().describe("Property to set."),
      value: z.unknown(),
      dry_run: z.boolean().optional()
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_cross_scene_set_property", config), async (): Promise<ToolResponse> => {
        if (params.dry_run) {
          return createDryRunResponse({
            toolName: "godot_cross_scene_set_property",
            plannedChanges: [`Set '${params.property}' on all '${params.class_name}' nodes across all .tscn files`],
            affectedFiles: [],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "batch.cross_scene_set", params);
      });
      return toMcpResult(result);
    }
  );

  // 10. godot_find_unused_resources
  server.tool(
    "godot_find_unused_resources",
    "Scan the project for resource files (.tres/.res/.png/.wav etc.) not referenced by any scene or script.",
    {
      extensions: z.array(z.string()).optional().describe("File extensions to check. Defaults to ['.tres','.res','.png','.wav','.ogg','.mp3'].")
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_find_unused_resources", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "batch.find_unused", params);
      });
      return toMcpResult(result);
    }
  );

  // 11. godot_detect_circular_dependencies
  server.tool(
    "godot_detect_circular_dependencies",
    "Detect circular script dependencies (A extends B extends A) in the project.",
    {},
    async () => {
      const result = await executeToolSafely(ctx("godot_detect_circular_dependencies", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "batch.detect_circular", {});
      });
      return toMcpResult(result);
    }
  );

  // 12. godot_uid_to_project_path
  server.tool(
    "godot_uid_to_project_path",
    "Convert a Godot UID (uid://xxxxx) to its res:// path.",
    {
      uid: z.string().describe("UID string in format uid://xxxxxxxxxxxxxxx.")
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_uid_to_project_path", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "project.uid_to_path", params);
      });
      return toMcpResult(result);
    }
  );

  // 13. godot_project_path_to_uid
  server.tool(
    "godot_project_path_to_uid",
    "Convert a res:// path to its Godot UID.",
    {
      path: z.string().describe("res:// path to any resource.")
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_project_path_to_uid", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "project.path_to_uid", params);
      });
      return toMcpResult(result);
    }
  );
}
