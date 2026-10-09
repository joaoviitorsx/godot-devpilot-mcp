import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

const QUICKSTART = `# DevPilot MCP — Quickstart

## Recommended flow for new projects

1. **Init wizard** → \`devpilot_init_wizard\` (apply_fixes=true on first run)
2. **Pick archetype** → \`devpilot_list_archetypes\` then \`devpilot_create_project_archetype name=<X>\`
3. **Run playbook** → iterate the call_plan: each step is a tool to invoke
4. **Verify** → \`devpilot_verify_spec\` with your acceptance criteria
5. **Iterate** → use \`devpilot_refine_plan\`, \`devpilot_blueprint_*\`, \`devpilot_define_scene\`
6. **Snapshot before risky changes** → \`devpilot_snapshot_project\`
7. **Auto-fix** if errors appear → \`devpilot_auto_fix_parse_errors\`

## Tool tiers (call these first when discovering)

### Core (start here)
- \`devpilot_init_wizard\` — first-run setup check
- \`devpilot_list_archetypes\` / \`devpilot_create_project_archetype\` — fast-start playbooks
- \`devpilot_list_blueprints\` / \`devpilot_describe_blueprint\` — discover building blocks
- \`devpilot_list_presets\` / \`devpilot_apply_preset\` — input/layer/HUD presets
- \`devpilot_recommend_blueprints\` — prompt → suggested blueprints+presets
- \`devpilot_explain_project\` — current project state as markdown
- \`devpilot_define_scene\` — JSON → .tscn (declarative scene authoring)
- \`devpilot_manifest_get\` — what DevPilot knows about the project
- \`devpilot_verify_spec\` — checklist verification
- \`devpilot_auto_fix_parse_errors\` — heuristic fixer

### Blueprints (composable building blocks)
- 2D player + combat: \`twin_stick\`, \`projectile_system\`
- 3D: \`player_3d\` (fps/tps), \`enemy_3d\`, \`projectile_3d\`, \`dungeon_room_3d\`
- Level: \`dungeon_room\`, \`tilemap\`, \`procedural_dungeon\`
- Combat: \`boss_arena\`
- Dungeon objects: \`shop_item\`, \`chest\`, \`pickup\`
- RPG: \`dialogue_system\`, \`quest_system\`, \`inventory_grid\`, \`loot_table\`
- Animation/audio: \`animation_state_machine\`, \`audio_bus\`
- Genres: \`rts_unit\`, \`physics_puzzle\`
- Infra: \`save_schema\`, \`localization\`

### Iteration
- \`devpilot_snapshot_project\` / \`devpilot_list_snapshots\` / \`devpilot_rollback_to_snapshot\`
- \`devpilot_refine_plan\` / \`devpilot_apply_game_design_plan\`
- \`devpilot_signal_graph\` / \`devpilot_auto_wire_signals\`
- \`devpilot_validate_blueprint_compat\`

### Quality
- \`devpilot_run_headless\` — CI-style stderr capture
- \`devpilot_performance_budget\` — static scene scan
- \`devpilot_generate_tests\` — GUT scaffolds

### Legacy (still work, but prefer the blueprint equivalents)
- \`devpilot_create_player_controller_2d\` → use \`devpilot_blueprint_twin_stick\`
- \`devpilot_create_health_system\` / \`devpilot_create_damage_system\` → composable blueprints often replace these
- \`devpilot_create_*_blueprint\` (legacy genre) → equivalents in \`devpilot_blueprint_*\`

## Conventions

- Read-only mode is **on by default**. Set GODOT_MCP_READ_ONLY=false in MCP client env to enable mutations.
- After mutating project.godot externally, reload via Godot's *Project → Reload Current Project*.
- Autoloads must include the \`*\` prefix to be enabled (DevPilot adds it automatically since v0.x).
- Generated GDScript passes through gdscriptLint (drops \`:=\` Variant inference, hoists \`@onready\` ternaries, casts return types).
- Manifest at \`.godot_mcp/manifest.json\` is source-of-truth for what DevPilot generated.

## When stuck

- Errors in script: \`devpilot_get_script_parse_errors\` then \`devpilot_auto_fix_parse_errors\`.
- Editor stale: reload project; or rerun \`devpilot_init_wizard\`.
- Bridge offline: ensure Godot editor is open with \`godot_devpilot_mcp\` plugin enabled.
- Output not appearing: bridge captures via EditorDebuggerPlugin — check \`.devpilot/logs/run_reports/\`.
`;

const TEMPLATE_SHOOTER_2D = `# Prompt template — Shooter 2D top-down

> "Create a top-down 2D shooter with twin-stick aim, dungeon rooms, projectiles, a boss, shop and chest. HUD shows HP/coins/ammo. Save system."

## Recommended call sequence
1. \`devpilot_create_project_archetype name=shooter_2d\`
2. Iterate the returned call_plan
3. \`devpilot_define_scene\` for Main.tscn (compose Player + Rooms + HUD instances)
4. \`devpilot_verify_spec\` with criteria like file_exists/main_scene_is/blueprint_applied
5. If errors: \`devpilot_auto_fix_parse_errors\`
`;

const TEMPLATE_RPG = `# Prompt template — Top-down RPG

> "Crie um RPG top-down com NPCs com diálogo ramificado, sistema de quests, inventário em grade e tabela de loot. Salvar progresso e suportar localização."

## Recommended call sequence
1. \`devpilot_create_project_archetype name=rpg_topdown\`
2. Iterate playbook
3. Add NPCs with \`devpilot_define_scene\`
4. \`devpilot_blueprint_dialogue_system\` already in playbook — author DialogueGraph .tres in editor
5. \`devpilot_verify_spec\` to confirm autoloads + scenes
`;

const TEMPLATE_FPS_3D = `# Prompt template — FPS 3D

> "Crie um FPS 3D simples com um jogador first-person, inimigos básicos que perseguem, projéteis, e uma sala 3D de exemplo. Mira com mouse e tiro com botão esquerdo."

## Recommended call sequence
1. \`devpilot_create_project_archetype name=fps_3d\`
2. \`devpilot_define_scene\` — Main.tscn instancing Room3D + Player3D + HUD
3. Set Main.tscn as run/main_scene
`;

export function registerHelpTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_help",
    "Show DevPilot quickstart, tool tier list (core/blueprints/iteration/quality/legacy), and conventions. First call when starting a session — gives an overview of available capabilities and recommended workflow.",
    {
      topic: z.enum(["overview", "shooter_2d", "rpg", "fps_3d"]).optional().default("overview"),
    },
    async ({ topic }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_help", config), async (): Promise<ToolResponse> => {
          let md = QUICKSTART;
          if (topic === "shooter_2d") md = TEMPLATE_SHOOTER_2D;
          else if (topic === "rpg") md = TEMPLATE_RPG;
          else if (topic === "fps_3d") md = TEMPLATE_FPS_3D;
          return createSuccessResponse({ topic, markdown: md }, `Help: ${topic}`);
        })
      )
  );
}
