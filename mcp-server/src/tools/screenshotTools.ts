import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createSafetyError } from "../safety/errors.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

const DEFAULT_SCREENSHOT_DIR = ".godot_mcp/screenshots";

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

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

export function defaultScreenshotPath(kind: "game" | "editor" | "viewport", config: ServerConfig): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `res://${DEFAULT_SCREENSHOT_DIR}/${kind}_${ts}.png`;
}

async function ensureScreenshotDir(projectRoot: string, resPath: string): Promise<string> {
  const resolved = resolveProjectPath(resPath, projectRoot);
  if (!resolved.resPath.endsWith(".png")) {
    throw createSafetyError(
      "INVALID_PARAMS",
      "Screenshot output path must end in .png.",
      { path: resPath },
      ["Use a res:// path ending in .png inside .godot_mcp/screenshots/."]
    );
  }
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  return resolved.resPath;
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  // PNG signature: 8 bytes, then IHDR chunk: 4 (length) + 4 ("IHDR") + 4 (width) + 4 (height) + ...
  if (buffer.length < 24) return null;
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

export async function compareScreenshotFiles(absA: string, absB: string): Promise<{
  identical: boolean;
  size_a: number;
  size_b: number;
  hash_a: string;
  hash_b: string;
  dimensions_a: { width: number; height: number } | null;
  dimensions_b: { width: number; height: number } | null;
  byte_diff_count: number;
}> {
  const [bufA, bufB] = await Promise.all([readFile(absA), readFile(absB)]);
  const hashA = createHash("sha256").update(bufA).digest("hex");
  const hashB = createHash("sha256").update(bufB).digest("hex");
  const dimA = readPngDimensions(bufA);
  const dimB = readPngDimensions(bufB);

  let byteDiffCount = 0;
  if (bufA.length !== bufB.length) {
    byteDiffCount = Math.abs(bufA.length - bufB.length);
    const minLen = Math.min(bufA.length, bufB.length);
    for (let i = 0; i < minLen; i++) {
      if (bufA[i] !== bufB[i]) byteDiffCount++;
    }
  } else if (hashA !== hashB) {
    for (let i = 0; i < bufA.length; i++) {
      if (bufA[i] !== bufB[i]) byteDiffCount++;
    }
  }

  return {
    identical: hashA === hashB,
    size_a: bufA.length,
    size_b: bufB.length,
    hash_a: hashA,
    hash_b: hashB,
    dimensions_a: dimA,
    dimensions_b: dimB,
    byte_diff_count: byteDiffCount
  };
}

export function registerScreenshotTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_take_game_screenshot ─────────────────────────────────────────────
  server.tool(
    "godot_take_game_screenshot",
    "Capture a screenshot of the running Godot game and save it as PNG inside the project.",
    {
      output_path: z.string().optional().describe("res:// PNG path. Defaults to .godot_mcp/screenshots/game_<timestamp>.png.")
    },
    async ({ output_path }) => toMcpResult(
      await executeToolSafely(ctx("godot_take_game_screenshot", config), async (): Promise<ToolResponse> => {
        const target = output_path ?? defaultScreenshotPath("game", config);
        const resPath = await ensureScreenshotDir(config.projectRoot, target);
        return callAfterConnect(godot, "screenshot.take_game", { output_path: resPath });
      })
    )
  );

  // ── godot_take_editor_screenshot ──────────────────────────────────────────
  server.tool(
    "godot_take_editor_screenshot",
    "Capture a screenshot of the Godot editor main viewport and save it as PNG inside the project.",
    {
      output_path: z.string().optional().describe("res:// PNG path. Defaults to .godot_mcp/screenshots/editor_<timestamp>.png.")
    },
    async ({ output_path }) => toMcpResult(
      await executeToolSafely(ctx("godot_take_editor_screenshot", config), async (): Promise<ToolResponse> => {
        const target = output_path ?? defaultScreenshotPath("editor", config);
        const resPath = await ensureScreenshotDir(config.projectRoot, target);
        return callAfterConnect(godot, "screenshot.take_editor", { output_path: resPath });
      })
    )
  );

  // ── godot_get_viewport_image ───────────────────────────────────────────────
  server.tool(
    "godot_get_viewport_image",
    "Capture the currently edited scene's viewport (2D/3D canvas) as PNG inside the project.",
    {
      output_path: z.string().optional().describe("res:// PNG path. Defaults to .godot_mcp/screenshots/viewport_<timestamp>.png.")
    },
    async ({ output_path }) => toMcpResult(
      await executeToolSafely(ctx("godot_get_viewport_image", config), async (): Promise<ToolResponse> => {
        const target = output_path ?? defaultScreenshotPath("viewport", config);
        const resPath = await ensureScreenshotDir(config.projectRoot, target);
        return callAfterConnect(godot, "screenshot.get_viewport", { output_path: resPath });
      })
    )
  );

  // ── godot_compare_screenshots ──────────────────────────────────────────────
  server.tool(
    "godot_compare_screenshots",
    "Compare two screenshot PNG files using SHA256 hash, file size, dimensions, and byte-level diff count.",
    {
      path_a: z.string().describe("res:// path to first PNG."),
      path_b: z.string().describe("res:// path to second PNG.")
    },
    async ({ path_a, path_b }) => toMcpResult(
      await executeToolSafely(ctx("godot_compare_screenshots", config), async (): Promise<ToolResponse> => {
        const resolvedA = resolveProjectPath(path_a, config.projectRoot);
        const resolvedB = resolveProjectPath(path_b, config.projectRoot);

        if (!resolvedA.resPath.endsWith(".png") || !resolvedB.resPath.endsWith(".png")) {
          return createErrorResponse(
            "INVALID_PARAMS",
            "Both paths must end in .png.",
            { path_a, path_b },
            ["Pass res:// paths to existing PNG screenshot files."]
          );
        }

        try {
          await Promise.all([stat(resolvedA.absolutePath), stat(resolvedB.absolutePath)]);
        } catch (error) {
          return createErrorResponse(
            "SCREENSHOT_NOT_FOUND",
            "One or both screenshot files do not exist.",
            { path_a: resolvedA.resPath, path_b: resolvedB.resPath, cause: error instanceof Error ? error.message : String(error) },
            ["Verify both screenshots were captured before comparing."]
          );
        }

        const result = await compareScreenshotFiles(resolvedA.absolutePath, resolvedB.absolutePath);

        return createSuccessResponse(
          {
            path_a: resolvedA.resPath,
            path_b: resolvedB.resPath,
            ...result
          },
          result.identical ? "Screenshots are byte-identical." : "Screenshots differ.",
          [],
          result.identical ? [] : ["Use byte_diff_count and dimensions to evaluate the magnitude of the difference."]
        );
      })
    )
  );
}
