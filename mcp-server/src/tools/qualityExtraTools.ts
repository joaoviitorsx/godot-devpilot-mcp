import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readdir, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const TUTORIAL_STEPS: Record<number, { title: string; body: string }> = {
  1: {
    title: "1. Setup check",
    body: `Run \`devpilot_init_wizard apply_fixes:true\`. This verifies project.godot, addon installed/enabled, scenes/scripts dirs, autoloads and bridge connection. Auto-fixes folders if missing.

Make sure GODOT_MCP_READ_ONLY=false in your MCP client config — without it, mutating tools no-op.`,
  },
  2: {
    title: "2. Pick an archetype",
    body: `Run \`devpilot_list_archetypes\` to see canonical playbooks: shooter_2d, dungeon_crawler, rpg_topdown, platformer, fps_3d, rts_2d, physics_puzzle.

Then \`devpilot_create_project_archetype name:<choice>\` returns a call_plan: a sequence of MCP tool invocations. Iterate it.`,
  },
  3: {
    title: "3. Compose the main scene",
    body: `After running playbook tools, call \`devpilot_compose_main_scene\` with:
- rooms_layout: "single" or "grid"
- include_hud: true / false
- include_pause: true / false
- set_as_main: true (updates project.godot run/main_scene)

It instances Player + Rooms + HUD from manifest.`,
  },
  4: {
    title: "4. Verify dependencies + spec",
    body: `Run \`devpilot_check_blueprint_dependencies\` to see missing requires.

Run \`devpilot_verify_spec\` with criteria array (file_exists, autoload_exists, main_scene_is, blueprint_applied, etc) to confirm acceptance.`,
  },
  5: {
    title: "5. Iterate via prompts",
    body: `For changes:
- Light delta: \`devpilot_refine_plan delta_prompt:"add 3 enemies"\`
- Diff-aware apply: \`devpilot_apply_refinement target_blueprints:[...]\`
- Risk-prone change: \`devpilot_snapshot_project\` first, then mutate, rollback if needed.`,
  },
  6: {
    title: "6. Validate runtime",
    body: `\`devpilot_run_headless seconds:5\` runs project headless and captures stderr fully (catches errors the editor's Output panel hides).

\`devpilot_get_script_parse_errors\` — static parse check.

If errors: \`devpilot_auto_fix_parse_errors\` runs heuristic fixes (lint + autoload * prefix).`,
  },
  7: {
    title: "7. Polish + ship",
    body: `\`devpilot_blueprint_audio_bus\` + \`devpilot_blueprint_settings_manager\` + \`devpilot_blueprint_scene_transitions\` add infrastructure pretty much every game needs.

\`devpilot_setup_export_preset target:windows\` (and others) for builds.

\`devpilot_explain_project\` writes a markdown overview at \`.devpilot/project_overview.md\` for documentation.`,
  },
};

export function registerQualityExtraTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "devpilot_tutorial",
    "Step-by-step interactive tutorial. Pass step:1..7 to get focused guidance for that phase. Combined with devpilot_help for overview-level info.",
    {
      step: z.number().int().min(1).max(7).optional().default(1),
    },
    async ({ step }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_tutorial", config), async (): Promise<ToolResponse> => {
          const s = TUTORIAL_STEPS[step];
          if (!s) {
            return createSuccessResponse({ available_steps: Object.keys(TUTORIAL_STEPS) }, "Unknown step.");
          }
          return createSuccessResponse(
            { step, title: s.title, body: s.body, total_steps: Object.keys(TUTORIAL_STEPS).length, next: step < 7 ? step + 1 : null },
            `Tutorial ${s.title}`,
          );
        })
      )
  );

  server.tool(
    "devpilot_detect_language_support",
    "Detect whether the project uses GDScript only, C#, both. DevPilot blueprints generate GDScript; on C# projects, blueprints still place .gd files but the code base may not use them directly — flagged here.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_detect_language_support", config), async (): Promise<ToolResponse> => {
          const root = config.projectRoot;
          const csproj = await fileExists(path.join(root, ".csproj")) || (await readdir(root)).some((f) => f.endsWith(".csproj"));
          let gdCount = 0;
          let csCount = 0;
          async function walk(dir: string): Promise<void> {
            try {
              const entries = await readdir(dir, { withFileTypes: true });
              for (const e of entries) {
                const p = path.join(dir, e.name);
                if (e.isDirectory() && !e.name.startsWith(".")) await walk(p);
                else if (e.isFile()) {
                  if (e.name.endsWith(".gd")) gdCount++;
                  else if (e.name.endsWith(".cs")) csCount++;
                }
              }
            } catch { /* ignore */ }
          }
          await walk(path.join(root, "scripts"));
          await walk(path.join(root, "scenes"));
          const using_csharp = csproj || csCount > 0;
          const warnings: string[] = [];
          if (using_csharp) warnings.push("Project appears to use C# — DevPilot blueprints generate GDScript. They will still place .gd files but you may need to bridge or convert manually.");
          return createSuccessResponse(
            { gd_files: gdCount, cs_files: csCount, csproj_present: csproj, using_csharp, primary_language: using_csharp && gdCount === 0 ? "csharp" : "gdscript" },
            using_csharp ? "C# detected — GDScript blueprints emit .gd files." : "GDScript-only project.",
            warnings,
          );
        })
      )
  );

  server.tool(
    "devpilot_stream_runtime_metrics",
    "Sample debug.get_process_stats over N seconds to capture FPS, memory and draw calls timeline. Useful while game is running to spot performance dips.",
    {
      seconds: z.number().int().min(1).max(60).optional().default(5),
      interval_ms: z.number().int().min(100).max(2000).optional().default(500),
    },
    async ({ seconds, interval_ms }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_stream_runtime_metrics", config), async (): Promise<ToolResponse> => {
          if (!godot.getStatus().connected) {
            const c = await godot.connect();
            if (!c.ok) return createSuccessResponse({ samples: [], note: "bridge not connected" }, "no samples (bridge offline)");
          }
          const samples: Array<{ t: number; data: unknown }> = [];
          const start = Date.now();
          while (Date.now() - start < seconds * 1000) {
            try {
              const r = await godot.call("debug.get_process_stats", {});
              if (r.ok) samples.push({ t: Date.now() - start, data: r.data });
            } catch { /* ignore */ }
            await new Promise((res) => setTimeout(res, interval_ms));
          }
          return createSuccessResponse({ samples, sample_count: samples.length, duration_ms: Date.now() - start }, `Captured ${samples.length} sample(s).`);
        })
      )
  );
}
