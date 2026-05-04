import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
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

type Issue = { node: string; reason: string; severity: "error" | "warning" };

function isInteractiveType(type: string): boolean {
  return ["Button", "OptionButton", "CheckBox", "CheckButton", "HSlider", "VSlider", "LineEdit", "TextEdit", "MenuButton", "ColorPickerButton"].includes(type);
}

type RuntimeNode = { path?: string; name?: string; type?: string; children?: RuntimeNode[] };

function walkTree(node: RuntimeNode, parentPath: string, out: Array<{ path: string; type: string; name: string }>): void {
  const name = node.name ?? "";
  const fullPath = node.path ?? (parentPath === "" ? name : `${parentPath}/${name}`);
  out.push({ path: fullPath, type: node.type ?? "", name });
  for (const child of node.children ?? []) walkTree(child, fullPath, out);
}

export function registerUiValidatorTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_validate_menu ────────────────────────────────────────────────
  server.tool(
    "devpilot_validate_menu",
    "Validate a menu UI: checks focus chain (focus_neighbor_*), pressed signal connections, anchors, theme assignment, and back-navigation. Reports issues by category.",
    {
      menu_path: z.string().describe("Editor scene tree path to the menu root (e.g., 'MainMenu' or '/root/MainMenu')"),
      require_theme: z.boolean().optional().default(false),
      require_back_button: z.boolean().optional().default(true),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_validate_menu", config), async (): Promise<ToolResponse> => {
          const focusIssues: Issue[] = [];
          const signalIssues: Issue[] = [];
          const anchorIssues: Issue[] = [];
          const themeIssues: Issue[] = [];
          const navIssues: Issue[] = [];

          // Get scene tree (editor-time)
          const treeResp = await callRpc(godot, "scene.get_tree", {});
          if (!treeResp.ok) return treeResp;
          const tree = treeResp.data as { tree?: RuntimeNode };

          const allNodes: Array<{ path: string; type: string; name: string }> = [];
          if (tree.tree) walkTree(tree.tree, "", allNodes);

          // Filter to nodes under menu_path
          const menuPrefix = params.menu_path.replace(/^\/root\//, "");
          const inMenu = allNodes.filter((n) => n.path === menuPrefix || n.path.startsWith(menuPrefix + "/"));
          if (inMenu.length === 0) {
            return createSuccessResponse({ passed: false, error: `No nodes found under '${params.menu_path}'` }, "Menu not found.");
          }

          const interactives = inMenu.filter((n) => isInteractiveType(n.type));

          // Focus chain check
          for (const node of interactives) {
            const propsResp = await callRpc(godot, "node.get_properties", { node_path: node.path });
            if (!propsResp.ok) continue;
            const props = (propsResp.data as { properties?: Record<string, unknown> })?.properties ?? {};
            const dirs = ["focus_neighbor_left", "focus_neighbor_right", "focus_neighbor_top", "focus_neighbor_bottom"];
            const setDirs = dirs.filter((d) => {
              const v = props[d];
              return v !== undefined && v !== null && v !== "" && v !== ".";
            });
            if (setDirs.length === 0 && interactives.length > 1) {
              focusIssues.push({ node: node.path, reason: "No focus_neighbor_* set; relies on default focus order which may break with non-trivial layouts.", severity: "warning" });
            }

            // Theme check
            if (params.require_theme && (props.theme === null || props.theme === undefined || props.theme === "")) {
              themeIssues.push({ node: node.path, reason: "No theme assigned.", severity: "warning" });
            }
          }

          // Signal connection check via scene.audit (returns connection list)
          const auditResp = await callRpc(godot, "scene.audit", {});
          if (auditResp.ok) {
            const audit = auditResp.data as { connections?: Array<{ source: string; signal: string; target: string }> };
            const connections = audit.connections ?? [];
            for (const btn of interactives.filter((n) => n.type === "Button")) {
              const hasPressed = connections.some((c) => c.source === btn.path && c.signal === "pressed");
              const inMenuRoot = btn.path.startsWith(menuPrefix);
              if (!hasPressed && inMenuRoot) {
                // Buttons may connect via script — only warn
                signalIssues.push({ node: btn.path, reason: "No 'pressed' signal connection found in scene file. May be connected via script (check at runtime).", severity: "warning" });
              }
            }
          }

          // Anchor check on top-level Control children of menu root
          const controls = inMenu.filter((n) => ["Control", "ColorRect", "VBoxContainer", "HBoxContainer", "GridContainer", "ScrollContainer", "TabContainer"].includes(n.type));
          for (const ctrl of controls) {
            const propsResp = await callRpc(godot, "node.get_properties", { node_path: ctrl.path });
            if (!propsResp.ok) continue;
            const props = (propsResp.data as { properties?: Record<string, unknown> })?.properties ?? {};
            const ar = props.anchor_right;
            const ab = props.anchor_bottom;
            const sz = props.size as { x?: number; y?: number } | undefined;
            const w = sz?.x ?? 0;
            const h = sz?.y ?? 0;
            if ((ar === 0 || ar === undefined) && (ab === 0 || ab === undefined) && w === 0 && h === 0) {
              anchorIssues.push({ node: ctrl.path, reason: "Zero size and zero anchors — control may be invisible.", severity: "error" });
            }
          }

          // Back button check
          if (params.require_back_button) {
            const backNames = new Set(["back", "close", "cancel", "return", "main", "menu"]);
            const hasBack = interactives.some((n) => {
              const lower = n.name.toLowerCase();
              return backNames.has(lower) || Array.from(backNames).some((b) => lower.includes(b));
            });
            if (!hasBack) {
              navIssues.push({ node: params.menu_path, reason: "No back/close/cancel button found. User may be unable to leave the menu.", severity: "warning" });
            }
          }

          const totalIssues = focusIssues.length + signalIssues.length + anchorIssues.length + themeIssues.length + navIssues.length;
          const errorCount = [focusIssues, signalIssues, anchorIssues, themeIssues, navIssues].flat().filter((i) => i.severity === "error").length;
          const passed = errorCount === 0;

          return createSuccessResponse({
            passed,
            menu_path: params.menu_path,
            interactives_found: interactives.length,
            controls_found: controls.length,
            total_issues: totalIssues,
            error_count: errorCount,
            warning_count: totalIssues - errorCount,
            focus_issues: focusIssues,
            signal_issues: signalIssues,
            anchor_issues: anchorIssues,
            theme_issues: themeIssues,
            navigation_issues: navIssues,
          }, passed ? `Menu validated: ${totalIssues} warnings.` : `Menu has ${errorCount} errors and ${totalIssues - errorCount} warnings.`);
        })
      )
  );
}
