import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: false, projectRoot: config.projectRoot };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── WCAG contrast ratio ──────────────────────────────────────────────────────

function relativeLuminance(r: number, g: number, b: number): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  const l1 = relativeLuminance(c1.r, c1.g, c1.b);
  const l2 = relativeLuminance(c2.r, c2.g, c2.b);
  const [bright, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (bright + 0.05) / (dark + 0.05);
}

function parseColor(value: unknown): { r: number; g: number; b: number; a: number } | null {
  if (value && typeof value === "object" && "r" in value) {
    const c = value as { r?: number; g?: number; b?: number; a?: number };
    if (typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number") {
      return { r: c.r > 1 ? c.r : c.r * 255, g: c.g > 1 ? c.g : c.g * 255, b: c.b > 1 ? c.b : c.b * 255, a: c.a ?? 1 };
    }
  }
  if (typeof value === "string" && value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 6) {
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
    }
  }
  return null;
}

type RuntimeNode = { path?: string; name?: string; type?: string; children?: RuntimeNode[] };

function walkTree(node: RuntimeNode, parentPath: string, out: Array<{ path: string; type: string; name: string }>): void {
  const name = node.name ?? "";
  const fullPath = node.path ?? (parentPath === "" ? name : `${parentPath}/${name}`);
  out.push({ path: fullPath, type: node.type ?? "", name });
  for (const child of node.children ?? []) walkTree(child, fullPath, out);
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerQaAuditTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_performance_audit ─────────────────────────────────────────────
  server.tool(
    "devpilot_performance_audit",
    "Run the project for N seconds, sample FPS + process stats, write markdown report. Flags FPS<60, draw_calls>1000, nodes>5000.",
    {
      duration_s: z.number().int().min(1).max(30).optional().default(5),
      sample_count: z.number().int().min(2).max(30).optional().default(10),
      fps_threshold: z.number().int().positive().optional().default(60),
      draw_calls_threshold: z.number().int().positive().optional().default(1000),
      nodes_threshold: z.number().int().positive().optional().default(5000),
      report_path: z.string().optional().default(".godot_mcp/reports/performance_audit.md"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_performance_audit", config), async (): Promise<ToolResponse> => {
          const phases: Array<{ phase: string; ok: boolean }> = [];

          const runResp = await callRpc(godot, "debug.run_project", {});
          phases.push({ phase: "run_project", ok: runResp.ok });
          if (!runResp.ok) return createErrorResponse("RUN_FAILED", "Cannot start project.", { phases }, []) as ToolResponse;

          await sleep(1000); // initial settle

          const fpsSamples: number[] = [];
          const statsSamples: Array<Record<string, unknown>> = [];
          const interval = (params.duration_s * 1000) / params.sample_count;
          for (let i = 0; i < params.sample_count; i++) {
            await sleep(interval);
            const fps = await callRpc(godot, "runtime.get_fps", {});
            const stats = await callRpc(godot, "runtime.get_process_stats", {});
            if (fps.ok) fpsSamples.push((fps.data as { fps?: number }).fps ?? 0);
            if (stats.ok) statsSamples.push(stats.data as Record<string, unknown>);
          }

          await callRpc(godot, "debug.stop_project", {});
          phases.push({ phase: "stop_project", ok: true });

          const fpsAvg = fpsSamples.reduce((s, v) => s + v, 0) / Math.max(1, fpsSamples.length);
          const fpsMin = Math.min(...fpsSamples);
          const fpsMax = Math.max(...fpsSamples);
          const lastStats = statsSamples[statsSamples.length - 1] ?? {};
          const drawCalls = Number(lastStats.draw_calls ?? 0);
          const nodeCount = Number(lastStats.node_count ?? 0);

          const issues: string[] = [];
          if (fpsAvg < params.fps_threshold) issues.push(`Average FPS ${fpsAvg.toFixed(1)} < threshold ${params.fps_threshold}`);
          if (drawCalls > params.draw_calls_threshold) issues.push(`Draw calls ${drawCalls} > threshold ${params.draw_calls_threshold}`);
          if (nodeCount > params.nodes_threshold) issues.push(`Node count ${nodeCount} > threshold ${params.nodes_threshold}`);

          const md = [
            "# Performance Audit Report",
            "",
            `Generated: ${new Date().toISOString()}`,
            `Duration: ${params.duration_s}s, Samples: ${params.sample_count}`,
            "",
            "## FPS",
            `- Average: ${fpsAvg.toFixed(2)}`,
            `- Min: ${fpsMin}`,
            `- Max: ${fpsMax}`,
            "",
            "## Last sampled stats",
            "```json",
            JSON.stringify(lastStats, null, 2),
            "```",
            "",
            "## Issues",
            issues.length ? issues.map((i) => `- ⚠️ ${i}`).join("\n") : "✅ No issues detected.",
            "",
          ].join("\n");

          if (!config.security.readOnly) {
            const reportPath = path.isAbsolute(params.report_path) ? params.report_path : path.join(config.projectRoot, params.report_path);
            await mkdir(path.dirname(reportPath), { recursive: true });
            await writeFile(reportPath, md, "utf8");
          }

          return createSuccessResponse({
            passed: issues.length === 0,
            fps: { average: Math.round(fpsAvg * 100) / 100, min: fpsMin, max: fpsMax, samples: fpsSamples },
            last_stats: lastStats,
            issues,
            report_path: params.report_path,
            phases,
          }, issues.length === 0 ? "Performance audit passed." : `Performance audit found ${issues.length} issues.`);
        })
      )
  );

  // ── devpilot_accessibility_audit ───────────────────────────────────────────
  server.tool(
    "devpilot_accessibility_audit",
    "Server-side accessibility audit: WCAG contrast ratio, font_size minimums, focus chain on interactive controls. Markdown report.",
    {
      min_font_size: z.number().int().positive().optional().default(14),
      min_contrast_ratio: z.number().min(1).max(21).optional().default(4.5).describe("WCAG 2.1 AA: 4.5 for body text, 3.0 for large text"),
      report_path: z.string().optional().default(".godot_mcp/reports/accessibility_audit.md"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_accessibility_audit", config), async (): Promise<ToolResponse> => {
          const treeResp = await callRpc(godot, "scene.get_tree", {});
          if (!treeResp.ok) return treeResp;
          const tree = (treeResp.data as { tree?: RuntimeNode }).tree;
          if (!tree) return createErrorResponse("NO_SCENE", "No open scene.", {}, []) as ToolResponse;

          const allNodes: Array<{ path: string; type: string; name: string }> = [];
          walkTree(tree, "", allNodes);

          const interactives = allNodes.filter((n) => ["Button", "OptionButton", "CheckBox", "CheckButton", "HSlider", "VSlider", "LineEdit", "TextEdit", "MenuButton", "ColorPickerButton"].includes(n.type));
          const labels = allNodes.filter((n) => ["Label", "RichTextLabel"].includes(n.type));

          const fontIssues: Array<{ node: string; size: number }> = [];
          const contrastIssues: Array<{ node: string; ratio: number; foreground: string; background: string }> = [];
          const focusIssues: Array<{ node: string; reason: string }> = [];

          // Font size + contrast checks
          for (const n of [...labels, ...interactives]) {
            const propsResp = await callRpc(godot, "node.get_properties", { node_path: n.path });
            if (!propsResp.ok) continue;
            const props = (propsResp.data as { properties?: Record<string, unknown> })?.properties ?? {};

            const fontSizeOverride = (props["theme_override_font_sizes/font_size"] ?? props["theme_override_font_sizes"]) as number | undefined;
            if (typeof fontSizeOverride === "number" && fontSizeOverride < params.min_font_size) {
              fontIssues.push({ node: n.path, size: fontSizeOverride });
            }

            const fontColor = parseColor(props["theme_override_colors/font_color"]);
            const bgColor = parseColor(props["theme_override_colors/font_color_background"] ?? props["theme_override_colors/background"]);
            if (fontColor && bgColor) {
              const ratio = contrastRatio(fontColor, bgColor);
              if (ratio < params.min_contrast_ratio) {
                contrastIssues.push({
                  node: n.path,
                  ratio: Math.round(ratio * 100) / 100,
                  foreground: `rgb(${Math.round(fontColor.r)},${Math.round(fontColor.g)},${Math.round(fontColor.b)})`,
                  background: `rgb(${Math.round(bgColor.r)},${Math.round(bgColor.g)},${Math.round(bgColor.b)})`,
                });
              }
            }
          }

          // Focus chain check
          for (const n of interactives) {
            const propsResp = await callRpc(godot, "node.get_properties", { node_path: n.path });
            if (!propsResp.ok) continue;
            const props = (propsResp.data as { properties?: Record<string, unknown> })?.properties ?? {};
            const dirs = ["focus_neighbor_left", "focus_neighbor_right", "focus_neighbor_top", "focus_neighbor_bottom"];
            const setDirs = dirs.filter((d) => {
              const v = props[d];
              return v !== undefined && v !== null && v !== "" && v !== ".";
            });
            if (setDirs.length === 0 && interactives.length > 1) {
              focusIssues.push({ node: n.path, reason: "No focus_neighbor_* set" });
            }
          }

          const totalIssues = fontIssues.length + contrastIssues.length + focusIssues.length;
          const md = [
            "# Accessibility Audit Report",
            "",
            `Generated: ${new Date().toISOString()}`,
            `Standards: min_font_size=${params.min_font_size}px, min_contrast=${params.min_contrast_ratio} (WCAG 2.1 AA)`,
            `Interactives scanned: ${interactives.length}, Labels scanned: ${labels.length}`,
            `Total issues: ${totalIssues}`,
            "",
            "## Font Size Issues",
            fontIssues.length ? fontIssues.map((i) => `- ${i.node}: ${i.size}px (< ${params.min_font_size}px)`).join("\n") : "_(none)_",
            "",
            "## Contrast Issues",
            contrastIssues.length ? contrastIssues.map((i) => `- ${i.node}: ratio ${i.ratio} (need ≥ ${params.min_contrast_ratio}); fg=${i.foreground}, bg=${i.background}`).join("\n") : "_(none) — note: only checks explicit theme_override colors._",
            "",
            "## Focus Chain Issues",
            focusIssues.length ? focusIssues.map((i) => `- ${i.node}: ${i.reason}`).join("\n") : "_(none)_",
            "",
            "## Recommendations",
            "- Use a Theme resource with explicit font_color + background to enable contrast checking.",
            "- Set focus_neighbor_* on each Button to define keyboard/gamepad navigation.",
            "- Avoid font_size below 14px for body text and 18px for large/header text.",
          ].join("\n");

          if (!config.security.readOnly) {
            const reportPath = path.isAbsolute(params.report_path) ? params.report_path : path.join(config.projectRoot, params.report_path);
            await mkdir(path.dirname(reportPath), { recursive: true });
            await writeFile(reportPath, md, "utf8");
          }

          return createSuccessResponse({
            passed: totalIssues === 0,
            interactives_scanned: interactives.length,
            labels_scanned: labels.length,
            total_issues: totalIssues,
            font_issues: fontIssues,
            contrast_issues: contrastIssues,
            focus_issues: focusIssues,
            report_path: params.report_path,
          }, totalIssues === 0 ? "Accessibility audit passed." : `Accessibility audit found ${totalIssues} issues.`);
        })
      )
  );
}
