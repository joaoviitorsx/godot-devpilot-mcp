import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createErrorResponse, type ToolResponse } from "../godot/protocol.js";

/** Invoke another tool in this MCP server, preserving its schema and safety wrapper. */
export async function callLocalTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<ToolResponse> {
  type Registered = { enabled: boolean; inputSchema: z.ZodType; handler: (args: Record<string, unknown>) => Promise<CallToolResult> };
  const registry = (server as unknown as { _registeredTools: Record<string, Registered> })._registeredTools;
  const tool = registry?.[name];
  if (!tool?.enabled) return createErrorResponse("TOOL_UNAVAILABLE", `${name} is not registered or is disabled.`);
  try {
    const parsedArgs = tool.inputSchema.parse(args) as Record<string, unknown>;
    const result = await tool.handler(parsedArgs);
    const firstText = result.content.find((item) => item.type === "text");
    const response = firstText?.type === "text" ? JSON.parse(firstText.text) as ToolResponse : null;
    if (response && typeof response.ok === "boolean") return response;
    return createErrorResponse("TOOL_RESPONSE_INVALID", `${name} returned an invalid response.`);
  } catch (error) {
    return createErrorResponse("TOOL_CALL_FAILED", `${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
