import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely, type ToolExecutionContext } from "../safety/toolWrapper.js";

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
    "Generate the CLI command to export the project with a given preset. Returns the command string (does not execute it — use your terminal).",
    {
      preset_name: z.string().describe("Export preset name as shown in Project > Export."),
      export_path: z.string().optional().describe("Output path. Defaults to preset's configured path."),
      debug: z.boolean().optional().describe("Export debug build. Defaults to false.")
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_export_project", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "export.export", params);
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
        return callAfterConnect(godot, "resource.read", params);
      });
      return toMcpResult(result);
    }
  );

  // 5. godot_edit_resource
  server.tool(
    "godot_edit_resource",
    "Modify a single property on a .tres or .res resource and save it.",
    {
      path: z.string(),
      property: z.string().describe("Property name to modify."),
      value: z.unknown().describe("New value."),
      dry_run: z.boolean().optional()
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_edit_resource", config), async (): Promise<ToolResponse> => {
        if (params.dry_run) {
          return createDryRunResponse({
            toolName: "godot_edit_resource",
            plannedChanges: [`Set property '${params.property}' on resource '${params.path}'`],
            affectedFiles: [params.path],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "resource.edit", params);
      });
      return toMcpResult(result);
    }
  );

  // 6. godot_create_resource
  server.tool(
    "godot_create_resource",
    "Create a new .tres resource of a given Godot class type.",
    {
      path: z.string().describe("res:// output path (must end in .tres)."),
      resource_type: z.string().describe("ClassDB resource type e.g. 'Environment', 'PhysicsMaterial', 'AudioStreamWAV'."),
      properties: z.record(z.unknown()).optional().describe("Initial property values."),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async (params) => {
      const result = await executeToolSafely(ctx("godot_create_resource", config), async (): Promise<ToolResponse> => {
        if (params.dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_resource",
            plannedChanges: [`Create ${params.resource_type} resource at '${params.path}'`],
            affectedFiles: [params.path],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "resource.create", params);
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
