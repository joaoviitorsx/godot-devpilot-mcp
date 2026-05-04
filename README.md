# Godot DevPilot MCP

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
| 13 | Specialized toolkits (Physics/Animation/Audio/Particles/Shader/Navigation) | ✅ |
| 14 | Test scenarios + assertions + stress test | ✅ |
| 15 | Agentic orchestrators (build_feature, refactor, validation loop) | ✅ |
| 16 | Release prep (CHANGELOG, demos) | 🟡 |

**Build:** clean (`npm run build`).  
**Tests:** 294 / 294 passing across 29 files.  
**Tools registered:** ~145 `godot_*` MCP tools.

---

## Architecture

```text
AI Client
  └─> MCP server (TypeScript, stdio transport)
        └─> WebSocket (127.0.0.1:6505)
              └─> Godot EditorPlugin
                    └─> Godot editor / runtime
```

Server: `mcp-server/` (Node 18+, TypeScript).  
Plugin: `addons/godot_devpilot_mcp/` (GDScript, EditorPlugin).

---

## Quick start

### 1. Install + build

```bash
cd mcp-server
npm install
npm run build
npm test
```

### 2. Open Godot project + activate plugin

```bash
godot --editor --path .
```

In the editor: `Project → Project Settings → Plugins → Godot DevPilot MCP → Enable`.

Console should print: `[Godot DevPilot MCP] WebSocket listening on 127.0.0.1:6505`.

### 3. Configure MCP client

Add to your client config (Claude Desktop / Claude Code / etc.):

```json
{
  "mcpServers": {
    "godot-devpilot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-devpilot-mcp/mcp-server/dist/index.js"],
      "env": {
        "GODOT_MCP_READ_ONLY": "false",
        "GODOT_MCP_PROJECT_ROOT": "/absolute/path/to/godot-devpilot-mcp"
      }
    }
  }
}
```

> **Security:** `GODOT_MCP_PROJECT_ROOT` must point to a directory containing `project.godot`. The server validates this on startup and refuses to launch otherwise (prevents accidental exposure of `$HOME` files via `res://` shortcuts).

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
Phase 13  Specialized       godot_setup_physics_body, godot_create_animation_player, godot_create_shader, …
Phase 14  Testing           godot_assert_property_equals, godot_run_test_scenario, godot_stress_test_scene
Phase 15  Agentic           godot_build_feature, godot_refactor_safely, godot_run_validation_loop, …
```

Full reference: `docs/api_reference.md`.  
Per-phase validation: `docs/PHASE_<N>_VALIDATION.md`.

---

## Security model

- **Path sandbox:** every `res://` path resolved + checked against the project root. Traversal (`..`), absolute paths, foreign URIs all rejected.
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
```

Each example has its own `project.godot` and a README with a suggested tool sequence.

---

## Development

```bash
cd mcp-server
npm run dev          # tsx watch mode
npm test             # vitest run
npm run build        # tsc → dist/
```

Tests are excluded from `tsconfig.json` and run via vitest only.

Manual validation with Godot editor: see `docs/MANUAL_TESTING_GUIDE.md`.

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
│                        testTools, agenticTools
└── tests/               29 vitest files

addons/godot_devpilot_mcp/
├── plugin.cfg, plugin.gd
├── core/                rpc_server, dispatcher, protocol, response_factory,
│                        permissions, undo_service
└── tools/               scene_tools, node_tools, script_tools, debug_tools,
                         screenshot_tools, input_tools, runtime_tools

docs/                    31+ markdown documents (architecture, security, validations, roadmap)
examples/                demo_2d_project, demo_3d_project (Phase 16)
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
