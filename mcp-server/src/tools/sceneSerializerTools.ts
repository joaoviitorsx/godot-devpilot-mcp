import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { serializeSceneToTscn, validateSceneSpec, type SceneSpec } from "../utils/sceneSerializer.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const NodeSpecSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string().optional(),
    instance: z.string().optional(),
    script: z.string().optional(),
    props: z.record(z.unknown()).optional(),
    groups: z.array(z.string()).optional(),
    children: z.array(NodeSpecSchema).optional(),
  })
);

const SceneSpecSchema = z.object({
  path: z.string().describe("res:// path ending in .tscn"),
  ext_resources: z.array(z.object({
    id: z.string(),
    type: z.string(),
    path: z.string(),
  })).optional(),
  sub_resources: z.array(z.object({
    id: z.string(),
    type: z.string(),
    props: z.record(z.unknown()).optional(),
  })).optional(),
  root: NodeSpecSchema,
});

export function registerSceneSerializerTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_define_scene",
    "Serialize a JSON SceneSpec into a Godot 4 .tscn file. Faster than dozens of node.add RPCs. Use {__sub:'id'} for SubResource refs (e.g. shapes), {__ext:'id'} for ExtResource refs. Vectors as {x,y}, colors as {r,g,b,a}. Polygon arrays via {__packed_vector2:[x1,y1,...]}. Returns absolute + res:// path.",
    {
      spec: SceneSpecSchema.describe("Full scene description: ext_resources, sub_resources, root node tree"),
      overwrite: z.boolean().optional().describe("Overwrite if file exists. Default false."),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_define_scene", config), async (): Promise<ToolResponse> => {
          const spec = params.spec as SceneSpec;
          if (!spec.path.endsWith(".tscn")) {
            return createErrorResponse("INVALID_PARAMS", "spec.path must end in .tscn", { path: spec.path }, []);
          }
          const resolved = resolveProjectPath(spec.path, config.projectRoot);
          if (await exists(resolved.absolutePath) && !params.overwrite) {
            return createErrorResponse(
              "SCENE_ALREADY_EXISTS",
              "Scene file already exists.",
              { path: spec.path },
              ["Pass overwrite=true to replace."]
            );
          }
          if (config.security.readOnly) {
            return createErrorResponse("READ_ONLY", "Cannot write scene in read-only mode.", {}, []);
          }
          const issues = validateSceneSpec(spec);
          const errors = issues.filter((i) => i.severity === "error");
          if (errors.length > 0) {
            return createErrorResponse(
              "SCHEMA_VALIDATION_FAILED",
              `${errors.length} validation error(s).`,
              { issues },
              errors.map((e) => `${e.path}: ${e.message}`),
            );
          }
          const content = serializeSceneToTscn(spec);
          await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
          await writeFile(resolved.absolutePath, content, "utf8");
          return createSuccessResponse(
            {
              res_path: spec.path,
              absolute_path: resolved.absolutePath,
              ext_resources: (spec.ext_resources ?? []).length,
              sub_resources: (spec.sub_resources ?? []).length,
            },
            `Scene written: ${spec.path}`
          );
        })
      )
  );
}
