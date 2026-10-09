import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { BLUEPRINT_REGISTRY } from "./blueprintLibraryTools.js";
import { BLUEPRINT_3D_REGISTRY } from "./blueprintLibrary3DTools.js";

const ALL_REGISTRY = [...BLUEPRINT_REGISTRY, ...BLUEPRINT_3D_REGISTRY];

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

export function registerBlueprintRegistryTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_list_blueprints",
    "List all DevPilot blueprints with their categories + summaries. Use to discover composable building blocks before planning a project. Pair with devpilot_describe_blueprint(name) for details.",
    {
      category: z.string().optional().describe("Filter by category (e.g., 'player', 'combat', 'level', 'dungeon'). Omit for all."),
    },
    async ({ category }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_list_blueprints", config), async (): Promise<ToolResponse> => {
          const list = category
            ? ALL_REGISTRY.filter((b) => b.category === category)
            : ALL_REGISTRY;
          return createSuccessResponse(
            {
              blueprints: list.map((b) => ({ name: b.name, category: b.category, description: b.description })),
              count: list.length,
              categories: Array.from(new Set(ALL_REGISTRY.map((b) => b.category))),
            },
            `${list.length} blueprint(s) available.`
          );
        })
      )
  );

  server.tool(
    "devpilot_describe_blueprint",
    "Describe a specific blueprint: full description, files it creates, parameter schema, example invocation. Use after devpilot_list_blueprints to plan which blueprints to apply.",
    {
      name: z.string().describe("Blueprint name (e.g., 'twin_stick', 'dungeon_room', 'projectile_system')."),
    },
    async ({ name }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_describe_blueprint", config), async (): Promise<ToolResponse> => {
          const b = ALL_REGISTRY.find((x) => x.name === name);
          if (!b) {
            return createErrorResponse(
              "BLUEPRINT_NOT_FOUND",
              `Blueprint '${name}' not registered.`,
              { name, available: ALL_REGISTRY.map((x) => x.name) },
              ["Use devpilot_list_blueprints to see available blueprints."]
            );
          }
          return createSuccessResponse(b, `Blueprint '${b.name}' (category: ${b.category}).`);
        })
      )
  );
}
