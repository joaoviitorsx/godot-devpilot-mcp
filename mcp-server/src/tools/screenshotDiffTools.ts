import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PNG } from "pngjs";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: false, projectRoot: config.projectRoot };
}

async function loadPng(filePath: string): Promise<PNG> {
  const buf = await readFile(filePath);
  return new Promise((resolve, reject) => {
    new PNG().parse(buf, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function pixelDistance(a: number, b: number, c: number, d: number, e: number, f: number): number {
  const dr = a - d, dg = b - e, db = c - f;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function registerScreenshotDiffTools(server: McpServer, _godot: unknown, config: ServerConfig): void {
  // ── godot_compare_screenshots_pixel ────────────────────────────────────────
  server.tool(
    "godot_compare_screenshots_pixel",
    "Pixel-aware PNG screenshot diff. Returns similarity_pct, diff_pixels, and optionally writes diff_image highlighting differences. Closes ISSUE-009.",
    {
      path_a: z.string().describe("First PNG path (res://)"),
      path_b: z.string().describe("Second PNG path (res://)"),
      threshold: z.number().min(0).max(255).optional().default(10).describe("Per-pixel RGB Euclidean distance threshold (0-255). Pixels above this are counted as different."),
      output_diff_path: z.string().optional().describe("Optional res:// path to write a diff highlight PNG (red where pixels differ)"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_compare_screenshots_pixel", config), async () => {
          const resolvedA = resolveProjectPath(params.path_a, config.projectRoot);
          const resolvedB = resolveProjectPath(params.path_b, config.projectRoot);
          let pngA: PNG, pngB: PNG;
          try {
            pngA = await loadPng(resolvedA.absolutePath);
            pngB = await loadPng(resolvedB.absolutePath);
          } catch (e) {
            return createErrorResponse("PNG_DECODE_FAILED", e instanceof Error ? e.message : String(e), {}, ["Verify both files are valid PNGs"]) as ToolResponse;
          }
          if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
            return createErrorResponse("DIMENSION_MISMATCH", `Images differ in size: ${pngA.width}x${pngA.height} vs ${pngB.width}x${pngB.height}`, {}, []) as ToolResponse;
          }

          const total = pngA.width * pngA.height;
          let diffPixels = 0;
          let diffImage: PNG | null = null;
          if (params.output_diff_path) {
            diffImage = new PNG({ width: pngA.width, height: pngA.height });
          }

          for (let y = 0; y < pngA.height; y++) {
            for (let x = 0; x < pngA.width; x++) {
              const idx = (pngA.width * y + x) << 2;
              const dist = pixelDistance(
                pngA.data[idx], pngA.data[idx + 1], pngA.data[idx + 2],
                pngB.data[idx], pngB.data[idx + 1], pngB.data[idx + 2]
              );
              const isDiff = dist > params.threshold;
              if (isDiff) diffPixels++;
              if (diffImage) {
                if (isDiff) {
                  diffImage.data[idx] = 255;
                  diffImage.data[idx + 1] = 0;
                  diffImage.data[idx + 2] = 0;
                  diffImage.data[idx + 3] = 255;
                } else {
                  diffImage.data[idx] = pngA.data[idx];
                  diffImage.data[idx + 1] = pngA.data[idx + 1];
                  diffImage.data[idx + 2] = pngA.data[idx + 2];
                  diffImage.data[idx + 3] = 64;
                }
              }
            }
          }

          const similarityPct = ((total - diffPixels) / total) * 100;
          let diff_image_path: string | null = null;
          if (diffImage && params.output_diff_path) {
            const resolved = resolveProjectPath(params.output_diff_path, config.projectRoot);
            await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
            const buf = PNG.sync.write(diffImage);
            await writeFile(resolved.absolutePath, buf);
            diff_image_path = resolved.resPath;
          }

          return createSuccessResponse({
            width: pngA.width,
            height: pngA.height,
            total_pixels: total,
            diff_pixels: diffPixels,
            similarity_pct: Math.round(similarityPct * 10000) / 10000,
            threshold: params.threshold,
            diff_image_path,
          }, `Similarity: ${similarityPct.toFixed(2)}% (${diffPixels} diff pixels of ${total})`);
        })
      )
  );

  // ── godot_assert_screenshot_matches_pixel ──────────────────────────────────
  server.tool(
    "godot_assert_screenshot_matches_pixel",
    "Pixel-aware assertion. Pass if similarity_pct ≥ min_similarity. Fails with diff stats and optional diff image.",
    {
      path_a: z.string(),
      path_b: z.string(),
      min_similarity_pct: z.number().min(0).max(100).optional().default(95),
      threshold: z.number().min(0).max(255).optional().default(10),
      output_diff_path: z.string().optional(),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_assert_screenshot_matches_pixel", config), async () => {
          const resolvedA = resolveProjectPath(params.path_a, config.projectRoot);
          const resolvedB = resolveProjectPath(params.path_b, config.projectRoot);
          let pngA: PNG, pngB: PNG;
          try {
            pngA = await loadPng(resolvedA.absolutePath);
            pngB = await loadPng(resolvedB.absolutePath);
          } catch (e) {
            return createErrorResponse("PNG_DECODE_FAILED", e instanceof Error ? e.message : String(e), {}, []) as ToolResponse;
          }
          if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
            return createErrorResponse("ASSERTION_FAILED", "Dimension mismatch", { a: { w: pngA.width, h: pngA.height }, b: { w: pngB.width, h: pngB.height } }, []) as ToolResponse;
          }
          const total = pngA.width * pngA.height;
          let diffPixels = 0;
          for (let i = 0; i < total; i++) {
            const idx = i << 2;
            const dist = pixelDistance(
              pngA.data[idx], pngA.data[idx + 1], pngA.data[idx + 2],
              pngB.data[idx], pngB.data[idx + 1], pngB.data[idx + 2]
            );
            if (dist > params.threshold) diffPixels++;
          }
          const similarityPct = ((total - diffPixels) / total) * 100;
          const passed = similarityPct >= params.min_similarity_pct;

          if (!passed) {
            return createErrorResponse("ASSERTION_FAILED", `Similarity ${similarityPct.toFixed(2)}% < required ${params.min_similarity_pct}%`, {
              similarity_pct: similarityPct,
              required: params.min_similarity_pct,
              diff_pixels: diffPixels,
              total_pixels: total,
            }, ["Lower min_similarity_pct or update baseline"]) as ToolResponse;
          }

          return createSuccessResponse({
            passed: true,
            similarity_pct: Math.round(similarityPct * 10000) / 10000,
            diff_pixels: diffPixels,
            total_pixels: total,
            min_similarity_pct: params.min_similarity_pct,
          }, `Match: ${similarityPct.toFixed(2)}% ≥ ${params.min_similarity_pct}%`);
        })
      )
  );
}
