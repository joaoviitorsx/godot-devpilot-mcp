# GodoPilot — Godot DevPilot MCP

Open source MCP integration for **Godot 4.3+**. Exposes a local TypeScript MCP server that talks to a Godot editor plugin via WebSocket / JSON-RPC 2.0.

The AI sees the editor as a typed tool surface — scenes, nodes, scripts, debug runs, screenshots, input simulation, runtime introspection, project intelligence, persistent memory, gameplay toolkits and agentic plans.

---

## Status

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Foundation, audit, docs | ✅ |
| 1 | Core MCP + WebSocket | ✅ |
| 2 | Security (sandbox, backups, logs) | ✅ |
| 3 | Project tools (info, autoloads, input map) | ✅ |
| 4 | Scenes, nodes, UndoRedo | ✅ |
| 5 | GDScript tooling (create/patch/validate/symbols) | ✅ |
| 6 | Debug loop (run/stop/logs/fix) | ✅ |
| 7 | Screenshots + input simulation | ✅ |
| 8 | Runtime analysis (tree, FPS, find UI) | ✅ |
| 9 | Project intelligence (deps, signals, impact) | ✅ |
| 10 | Project memory (`.godot_mcp/memory/`) | ✅ |
| 11 | Toolkits 2D (player, enemy, hud, parallax, …) | ✅ |
| 12 | Toolkits 3D (camera, character, lighting, raycast, …) | ✅ |
| 12+ | Auditoria de cenas 3D (colisão, mesh, navegação, ambiente, câmera) e prompt de fatia jogável | ✅ |
| 12+ | Starter FPS/TPS jogável com cena, controle e recursos 3D atribuídos | ✅ |
| 13 | Specialized toolkits (Physics/Animation/Audio/Particles/Shader/Navigation) | ✅ |
| 14 | Test scenarios + assertions + stress test | ✅ |
| 15 | Agentic orchestrators (build_feature, refactor, validation loop) | ✅ |
| 16 | Release prep (CHANGELOG, demos) | ✅ |
| 2.x | Prompt-first workflows, genre blueprints, blueprint library, snapshots, CI | ✅ |

**Version:** 2.6.0 — see `CHANGELOG.md`.  
**Build:** clean (`npm run build`).  
**Tests:** run `npm test` in `mcp-server/` for the current count.
**Tools registered:** varies by `minimal`, `core`, `full`, and `agentic`; `godot_get_capabilities` returns the exact active list.

---

## Architecture

```text
AI Client
  └─> MCP server (TypeScript, stdio transport)
        └─> WebSocket (127.0.0.1:6505)
              └─> Godot EditorPlugin
                    └─> Godot editor / runtime
```

Server: `mcp-server/` (Node 22.12+, TypeScript).
Plugin: `addons/godot_devpilot_mcp/` (GDScript, EditorPlugin).

---

## Quick start

Requirements: Godot 4.3+, Node.js 22.12+ with npm, and Claude Code or Codex CLI. Open a terminal **inside your game project** (the directory containing `project.godot`). After these installer files are published on the `main` branch, run:

```sh
curl -fsSL https://raw.githubusercontent.com/joaoviitorsx/godot-devpilot-mcp/main/install.sh | sh
```

On Windows PowerShell, use:

```powershell
irm https://raw.githubusercontent.com/joaoviitorsx/godot-devpilot-mcp/main/install.ps1 | iex
```

The installer detects Claude Code and/or Codex CLI, installs a stable MCP runtime under `.godot_mcp/runtime/`, copies and enables the Godot plugin, configures the detected clients, and adds short guidance to `CLAUDE.md` and/or `AGENTS.md` without removing existing instructions. It defaults to read-write with the `full` tool set. For a local checkout before publication, run `node /absolute/path/to/godot-devpilot-mcp/bin/godopilot.mjs` from your game project. Use `--read-only`, `--mode core`, `--client codex`, or `--dry-run` when needed.

Open your game in Godot and start a new AI session in that directory. Ask *"Use GodoPilot to inspect this game."* The AI can then call `godot_health_check` and `devpilot_game_context`. The editor and MCP server use local WebSocket port 6505 by default.

Detailed steps, manual configuration, updates, and troubleshooting: [installation guide](docs/installation.md). This repository's `project.godot` is a plugin development sandbox saved with Godot 4.6.

For maintainers: [Graphify setup](docs/graphify.md) and [review plan](docs/review_plan.md).

Product naming proposal: [GodoPilot](docs/branding.md).

Tiles and terrain: [Better Tile Editor integration](docs/better_tile_editor.md) (optional, Godot 4.6+).

To start a 3D game, ask the AI to call `devpilot_create_3d_starter` with `mode="fps"` or `mode="tps"` (available in `full` and `agentic`). It creates a playable arena and controller in one call. If your project already has a main scene, it keeps it and you can play the generated scene with F6. Use `dry_run=true` to preview the files. See the [3D workflow](docs/ai_game_development_roadmap.md#trilha-específica-para-jogos-3d).

First prompt to try: *"Call `devpilot_game_context`, tell me the main scene and the next playable feature, then use `devpilot_feature_loop` to implement and verify it."* The MCP also exposes `godot://project/context` and prompts for features, playtesting, and tiles. See [AI game-development workflow](docs/ai_game_development_roadmap.md) and `docs/cookbook.md`.

---

## Tool catalog (high-level)

```text
Phase 1   Core              godot_health_check, godot_ping, godot_get_capabilities, …
Phase 3   Project           godot_get_project_info, godot_get_input_map, godot_add_autoload, …
Phase 4   Scenes/Nodes      godot_create_scene, godot_add_node, godot_set_node_property, …
Phase 5   Scripts           godot_create_script, godot_patch_script, godot_validate_script, …
Phase 6   Debug             godot_run_project, godot_get_output_logs, godot_fix_errors, …
Phase 7   Screenshots/Input godot_take_game_screenshot, godot_press_action, godot_run_input_sequence, …
Phase 8   Runtime           godot_get_runtime_tree, godot_find_runtime_node, godot_wait_for_condition, …
Phase 9   Intelligence      godot_project_summary, godot_build_dependency_graph, godot_impact_check, …
Phase 10  Memory            godot_update_project_memory, godot_create_decision_record, godot_search_memory
Phase 11  Toolkit 2D        godot_create_player_2d, godot_setup_camera_2d, godot_create_inventory_ui, …
Phase 12  Toolkit 3D        godot_create_character_body_3d, godot_setup_lighting, godot_create_raycast_3d, …
3D start  Playable scene    devpilot_create_3d_starter (FPS/TPS)
Phase 13  Specialized       godot_setup_physics_body, godot_create_animation_player, godot_create_shader, …
Phase 14  Testing           godot_assert_property_equals, godot_run_test_scenario, godot_stress_test_scene
Phase 15  Agentic           godot_build_feature, godot_refactor_safely, godot_run_validation_loop, …
Tiles     Atlas/terrain     godot_create_tile_atlas, godot_better_tile_editor_* (optional addon)
Context   Game overview     devpilot_game_context, godot://project/context, MCP workflow prompts
Tests     Automated         devpilot_run_headless, devpilot_run_gut_tests (optional GUT addon)

v2.x      Prompt-first      devpilot_route_prompt, devpilot_execute_prompt_workflow, devpilot_refine_plan, …
v2.x      Onboarding        devpilot_init_wizard, devpilot_help, devpilot_tutorial, devpilot_game, …
v2.x      Blueprints        devpilot_list_blueprints, devpilot_blueprint_* (2D, 3D, RPG, A/V, genres, C#), …
v2.x      Composition       devpilot_create_project_archetype, devpilot_compose_main_scene, devpilot_define_scene, …
v2.x      Lifecycle         devpilot_snapshot_project, devpilot_rollback_to_snapshot, devpilot_setup_ci, …
v2.x      Quality           devpilot_verify_spec, devpilot_auto_fix_parse_errors, devpilot_generate_tests, …
```

Full reference: `docs/api_reference.md`.  
Per-phase validation: `docs/PHASE_<N>_VALIDATION.md`.

---

## Security model

- **Path sandbox:** every `res://` path resolved + checked against the project root. Traversal (`..`), absolute paths, foreign URIs all rejected.
- **Editor bridge:** listens only on loopback, requires a random session token in `.godot_mcp/bridge-token`, and verifies the project path and protocol version before MCP tools reach the editor. The installer ignores the token in Git.
- **Read-only mode:** `GODOT_MCP_READ_ONLY=true` blocks every mutating tool with `READ_ONLY_MODE`. Read-only allowlist is explicit per tool.
- **Backups:** every script/file overwrite copies the original to `.godot_mcp/backups/YYYY-MM-DD/<file>.bak`.
- **Dry run:** mutating tools accept `dry_run=true` and return a `planned_changes` list without touching the filesystem or the editor.
- **Action logs:** every call appended to `.godot_mcp/logs/actions.jsonl` with status (`success`/`error`/`blocked`/`dry_run`).
- **UndoRedo:** node mutations and script attaches go through Godot's UndoRedo so Ctrl+Z reverts them.

See `docs/security.md`.

---

## Examples

```text
examples/demo_2d_project/   Minimal 2D platformer scaffold
examples/demo_3d_project/   Minimal 3D character + camera scaffold
examples/shooter_2d_complete/   Full 2D shooter walkthrough
examples/rpg_topdown_complete/  Full top-down RPG walkthrough
examples/fps_3d_complete/       Full 3D FPS walkthrough
```

Each example has a README with a suggested tool sequence.

---

## Development

```bash
cd mcp-server
npm run dev          # build and start the server
npm test             # vitest run
npm run build        # tsc → dist/
```

Tests are excluded from `tsconfig.json` and run via vitest only.

Manual validation with Godot editor: see `docs/MANUAL_TESTING_GUIDE.md`.

Run `node evals/runner.js --all --project .` with the editor open to execute the eight baseline MCP cases. `node scripts/package-release.mjs` creates a versioned install archive and SHA-256 checksum after `npm run build`.

---

## Project structure

```text
mcp-server/
├── src/
│   ├── config/          loadConfig, validateProjectRoot, modes
│   ├── godot/           WebSocket client, JSON-RPC protocol
│   ├── safety/          pathGuard, backup, dryRun, permissions, toolWrapper, actionLogger
│   ├── indexer/         projectIndexer (Phase 9)
│   └── tools/           coreTools, projectTools, sceneTools, nodeTools, scriptTools,
│                        fileTools, debugTools, screenshotTools, inputTools,
│                        runtimeTools, intelligenceTools, memoryTools,
│                        toolkit2dTools, toolkit3dTools, toolkit13Tools,
│                        testTools, agenticTools, blueprintLibrary*, …
└── tests/               vitest files

addons/godot_devpilot_mcp/
├── plugin.cfg, plugin.gd
├── core/                rpc_server, dispatcher, protocol, response_factory,
│                        permissions, undo_service
└── tools/               scene_tools, node_tools, script_tools, debug_tools,
                         screenshot_tools, input_tools, runtime_tools

docs/                    31+ markdown documents (architecture, security, validations, roadmap)
examples/                demo_2d/3d scaffolds + shooter_2d / rpg_topdown / fps_3d complete
.godot_mcp/              Runtime artefacts (backups/, logs/, screenshots/,
                         intel/, memory/, tests/, reports/)
```

---

## License

MIT — see `LICENSE`.

---

## Contributing

- `docs/contributing.md` for coding conventions.
- `docs/OPEN_ISSUES.md` for outstanding work.
- `docs/IMPLEMENTATION_PROGRESS.md` for current phase status.
- `docs/MANUAL_TESTING_GUIDE.md` before opening a PR that touches editor-side flows.

Pull requests welcome.
