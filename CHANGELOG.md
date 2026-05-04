# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com) and [Semantic Versioning](https://semver.org).

---

## [Unreleased] — Phase 16 release prep

### Added
- `CHANGELOG.md` consolidating phase deltas.
- `examples/demo_2d_project/` and `examples/demo_3d_project/` minimal scaffolds.
- README rewritten with full phase status table, tool catalog, security model, project structure.

### Pending for v1.0.0
- Manual validation with Godot 4.6.1: ISSUE-018 (Phase 12), ISSUE-020 (Phase 13).
- Cross-platform install validation (Linux verified; macOS/Windows pending).
- Tag `v1.0.0` after manual validation closes all blocking issues.

---

## [0.15.0] — 2026-05-04 — Phase 15 (Agentic)

### Added
- `mcp-server/src/tools/agenticTools.ts` — 10 orchestrator tools:
  - `godot_build_feature`, `godot_create_gameplay_system`, `godot_refactor_safely`,
  - `godot_generate_scene_from_prompt`, `godot_create_playable_prototype`,
  - `godot_run_validation_loop`, `godot_create_game_jam_prototype`,
  - `godot_explain_project_architecture`, `godot_prepare_release_checklist`,
  - `godot_fix_errors_agentic` (alias / loop guidance).
- All agentic tools default to `dry_run=true`. `refactor_safely` never auto-renames references.
- Architecture report writer (markdown to `.godot_mcp/reports/release_checklist.md`).
- `tests/agenticTools.test.ts` — 14 vitest cases.

---

## [0.14.0] — 2026-05-04 — Phase 14 (Testing) full

### Added
- `godot_create_test_scenario` — persists JSON scenarios to `.godot_mcp/tests/`.
- `godot_stress_test_scene` — repeated runtime probes with latency stats (avg/p95).
- `godot_generate_regression_test` — snapshots runtime tree + optional baseline screenshot into a scenario.
- 4 new vitest cases in `tests/testTools.test.ts`.

### Notes
- Phase 14 baseline assertions (`assert_node_exists`, `assert_property_equals`, `assert_signal_emitted`, `assert_screenshot_matches`, `run_test_scenario`) shipped previously; this release closes the roadmap scope.

---

## [0.13.0] — 2026-05-04 — Phase 13 (Specialized toolkits)

### Added
- `mcp-server/src/tools/toolkit13Tools.ts` — 12 tools across 6 sub-toolkits:
  - **Physics:** `setup_physics_body`, `set_collision_layers`, `add_raycast_2d`.
  - **Animation:** `create_animation_player`, `add_animation_track` (instructional), `create_animation_tree`.
  - **Audio:** `create_audio_stream_player_2d`, `create_audio_stream_player_3d`.
  - **Particles:** `create_gpu_particles_2d`, `create_gpu_particles_3d`.
  - **Shader:** `create_shader` (canvas_item / spatial templates), `assign_shader_material` (instructional).
  - **Navigation:** `setup_navigation_region_2d`.
- 22 vitest cases.

### Notes
- Resources (PhysicsMaterial, AnimationLibrary, AudioStream, ParticleProcessMaterial, ShaderMaterial, NavigationPolygon) cannot be instanced via JSON-RPC. Tools either add the node + suggest the resource, or return a textual workflow.

---

## [0.12.1] — 2026-05-04 — Phase 12 extension

### Added
- `godot_create_navigation_region_3d`, `godot_create_raycast_3d`, `godot_import_gltf` (placeholder + instructions).
- 4 new vitest cases.

### Fixed
- `addChildNode` helper in toolkit2d/3d sent `type`/`name`; plugin expects `node_type`/`node_name`. Fixed; tests updated. (ISSUE-019)

---

## [0.12.0] — 2026-05-04 — Phase 12 (Toolkits 3D) baseline

### Added
- `mcp-server/src/tools/toolkit3dTools.ts` — `setup_camera_3d`, `create_character_body_3d`,
  `setup_lighting`, `setup_third_person_controller`, `create_primitive_mesh`.
- `THIRD_PERSON_CONTROLLER` GDScript template (mouse capture + camera-relative move).
- 11 vitest cases.

---

## [0.11.0] — 2026-05-04 — Phase 11 (Toolkits 2D) full

### Added
- 12 / 12 tools in `toolkit2dTools.ts`:
  - Baseline (7): `create_player_2d`, `create_enemy_2d`, `create_collectible_2d`, `setup_camera_2d`, `create_health_system`, `create_topdown_controller`, `create_platformer_controller`.
  - Completion (5): `setup_collision_2d`, `setup_area_trigger_2d`, `create_tilemap`, `setup_parallax_background`, `create_inventory_ui`.
- Templates: `TOPDOWN_CONTROLLER`, `PLATFORMER_CONTROLLER`, `ENEMY_PATROL`, `HEALTH_SYSTEM`, `COLLECTIBLE`, `AREA_TRIGGER`, `INVENTORY_UI`.

### Validated
- Manual validation 2026-05-04 with Godot 4.6.1. ISSUE-015 + ISSUE-016 closed.

---

## [0.10.0] — 2026-05-04 — Phase 10 (Project Memory)

### Added
- 8 tools backing `.godot_mcp/memory/`:
  `update_project_memory`, `get_project_memory`, `get_architecture_notes`, `get_conventions`,
  `set_convention` (upsert by key), `create_decision_record` (numbered ADR), `search_memory`,
  `get_current_task_context`.
- `tests/memoryTools.test.ts` — 10 cases.

---

## [0.9.0] — 2026-05-04 — Phase 9 (Project Intelligence)

### Added
- `mcp-server/src/indexer/projectIndexer.ts` — file index, dependency graph (preload/load/extends/scene_resource), signal map (.tscn `[connection]` parsing), conventions checker.
- 10 tools: `project_summary`, `build_dependency_graph`, `get_dependency_graph`, `build_signal_map`, `get_signal_map`, `impact_check`, `trace_flow`, `detect_gameplay_systems`, `analyze_architecture`, `validate_conventions`.
- 16 vitest cases.

---

## [0.8.0] — 2026-05-04 — Phase 8 (Runtime Analysis)

### Added
- `mcp-server/src/tools/runtimeTools.ts` + `addons/.../runtime_tools.gd` — 10 tools:
  `get_runtime_tree`, `get_runtime_node_properties`, `set_runtime_node_property`, `get_fps`,
  `get_process_stats`, `wait_for_condition`, `find_runtime_node`, `get_current_camera`,
  `find_ui_element`, `click_ui_by_text` (composite using input_tools).
- 17 vitest cases.

### Validated
- Manual validation 2026-05-04 with Godot 4.6.1. ISSUE-011 closed.
- Limitation documented: `wait_for_condition` deep equality fails with float vs int (Vector2). Use scalar properties.

---

## [0.7.0] — 2026-05-04 — Phase 7 (Screenshots + Input)

### Added
- 4 screenshot tools (`take_game`, `take_editor`, `get_viewport`, `compare_screenshots` — byte-aware).
- 9 input tools (action/key press/release/tap, mouse_move/click/drag, run_input_sequence).
- Refactored `dispatcher.gd` + `rpc_server.gd` to be `await`-aware (input duration_ms hold).
- 30 vitest cases (12 screenshot + 18 input).

### Fixed
- `screenshot_tools.gd`: `DisplayServer.screen_get_image()` returns `null` on Wayland; added editor viewport fallback.

### Validated
- Manual validation 2026-05-04 with Godot 4.6.1. ISSUE-008 closed.

---

## [0.6.0] — 2026-05-04 — Phase 6 (Debug Loop)

### Added
- 11 tools: `run_project`, `run_scene`, `stop_project`, `is_game_running`, `get_output_logs`,
  `get_debugger_errors`, `get_script_parse_errors`, `clear_logs`, `get_last_run_report`,
  `assert_no_errors`, `fix_errors` (dry_run by default).
- Run reports persisted to `.godot_mcp/logs/run_reports/YYYY-MM-DD/run_HHMMSS.jsonl`.
- 32 vitest cases.

### Validated
- Manual validation 2026-05-04 with Godot 4.6.1. ISSUE-007 closed.

---

## [0.5.0] — Phase 5 (Scripts) full

### Added
- Phase 5.1: `create_script`, `read_script`, `patch_script` (backup), `attach_script` (UndoRedo), `validate_script`, `get_classdb_info`.
- Phase 5.2: `get_script_symbols`, `get_script_dependencies`, `find_references`, `format_script`.

---

## [0.4.0] — Phase 4 (Scenes, Nodes, UndoRedo)

### Added
- 8 scene tools + 10 node tools, all node mutations through Godot UndoRedo.

---

## [0.3.0] — Phase 3 (Project tools)

### Added
- 11 project / file / input map / autoload tools.

---

## [0.2.0] — Phase 2 (Security)

### Added
- pathGuard (sandbox), backup service, dryRun helper, permissions allowlist, toolWrapper, actionLogger, safeTrash.

### Fixed (post-validation)
- ISSUE-017: `loadConfig` now `path.resolve`s `projectRoot` and `validateProjectRoot()` requires `project.godot`. `index.ts` exits with status 1 if invalid. Prevents `$HOME` exposure when launched without `GODOT_MCP_PROJECT_ROOT`.
- `getModeCapabilities` reports `debug_loop / screenshots / input_simulation / runtime_tree / project_intelligence / project_memory = true` matching active phases.

---

## [0.1.0] — Phase 1 (Core MCP) + Phase 0

### Added
- TypeScript MCP server scaffold (stdio transport).
- Godot EditorPlugin scaffold (WebSocket on 127.0.0.1:6505).
- JSON-RPC 2.0 protocol layer.
- Phase 1 tools: `health_check`, `ping`, `get_capabilities`, `get_connection_status`, `get_protocol_version`.
- Phase 0 docs: README, ARCHITECTURE, SECURITY, ROADMAP, TOOL_SPECIFICATION, base audit, MIT license.
