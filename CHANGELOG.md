# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com) and [Semantic Versioning](https://semver.org).

---

## [2.1.0] — 2026-05-04 — Genre Blueprints

### Added

#### Genre blueprints (`genreBlueprintTools.ts`)
Each tool produces a fully wired opinionated game template (scene + multiple systems) — not just a controller.

- `devpilot_create_platformer_blueprint(level_length, enemy_count, collectible_count)` — TileMap floor (N×10 cells), platformer player + camera, enemies with patrol, collectibles, scene saved.
- `devpilot_create_top_down_rpg_blueprint(npc_count)` — 8-dir player + N NPCs in `interactable` group + DialogueBox (Panel/Speaker/Text).
- `devpilot_create_survivor_like_blueprint(spawn_interval)` — player + AutoShooter (group-based targeting) + SpawnManager (radial spawn) + XPSystem (level-up signals).
- `devpilot_create_puzzle_blueprint(grid_width, grid_height)` — Puzzle Node2D with tile-swap mechanic + score HUD.
- `devpilot_create_visual_novel_blueprint(dialogue_data_path)` — Background + Character sprites + DialogueBox + sample `dialogue.json` with branching.
- `devpilot_create_tower_defense_blueprint(starting_currency, tower_cost, enemies_per_wave)` — Path2D + TowerPlacement (mouse-click to place) + EnemyWaves (PathFollow2D-based) + currency HUD.

Each returns `{scene_path, files_created[], systems_used[], steps_executed/failed, next_steps[]}`.

### Reusable templates added
- `AUTO_SHOOTER` — group-based nearest-enemy targeting + cooldown firing.
- `SPAWN_MANAGER` — radial random spawn at fixed interval.
- `XP_SYSTEM` — leveling with growth_factor + xp_changed/level_up signals.
- `DIALOGUE_BOX` — line-by-line advance on `ui_accept`/`interact`.
- `TILE_SWAP_PUZZLE` — 4-dir adjacency swap with score.
- `TOWER_PLACEMENT` — currency-gated mouse placement.
- `ENEMY_WAVES` — PathFollow2D-based enemy spawning per wave.

### Stats
- New tools: 6 (genre blueprints)
- Total tools: ~239
- Build: clean, 294/294 tests passing

---

## [2.0.0] — 2026-05-04 — Playable Prototype Generator (MAJOR RELEASE)

> **Describe a game idea. DevPilot creates a playable Godot prototype with scenes, systems, UI, validation and tests.**

### Added

#### Prototype tools (`prototypeTools.ts`)
- `devpilot_design_game_from_prompt(prompt, override_plan?, persist?)` — heuristic keyword parser converts natural-language description into structured `GameDesignPlan` `{genre, title, entities[], systems[], menus[], scenes[]}`. Persists to `.godot_mcp/memory/game_design.{md,json}`. Genres: platformer/topdown/rpg/survivor/puzzle/visual_novel/tower_defense. LLM client can pass `override_plan` to skip parsing.
- `devpilot_create_playable_prototype(plan?, validate?, dry_run?)` — orchestrates full prototype: creates main scene, player (style by genre), enemies (count parsed from prompt), collectibles, scripts, attaches all, saves scene, optionally runs project for 3s and checks errors. Falls back to persisted plan if none provided.
- `devpilot_apply_game_design_plan(plan, validate?)` — idempotent re-application of a plan (skip-on-existing).

### Genre-aware controller selection
Player controller automatically chosen by genre:
- `platformer` → gravity + jump_velocity + horizontal axis
- `topdown / rpg / survivor` → 8-directional Vector2 movement
- 4-directional / sidescroller fall back to topdown logic

### Persistence
Game design plans stored as both:
- `.godot_mcp/memory/game_design.md` — human-readable
- `.godot_mcp/memory/game_design.json` — re-applicable structured

### Stats
- New tools: 3 (the headline release tools)
- Total tools: ~233
- Build: clean, 294/294 tests passing

---

## [1.9.0] — 2026-05-04 — UI, Menus & Settings + Menu Validator

### Added

#### Menu tools (`menuTools.ts`)
- `devpilot_create_main_menu(play_scene_path, settings_scene_path)` — VBox + Play/Settings/Quit; first button auto-grabs focus.
- `devpilot_create_settings_menu` — hub menu with Audio/Video/Keybindings/Back buttons.
- `devpilot_create_keybinding_menu` — auto-iterates non-`ui_*` InputMap actions; press-to-rebind via `_input` handler.
- `devpilot_create_audio_settings` — Master/Music/SFX HSliders bound to AudioServer buses (linear↔dB conversion).
- `devpilot_create_video_settings` — resolution OptionButton + fullscreen + vsync CheckBoxes; calls `DisplayServer.window_set_*`.
- `devpilot_create_game_over_screen(main_scene_path, menu_scene_path)` — Retry/MainMenu buttons; PROCESS_MODE_ALWAYS for paused-tree usage.
- `devpilot_create_level_select_screen(levels_dir)` — auto-discovers .tscn files via DirAccess; first button auto-focused.

(`devpilot_create_pause_menu` already exists in v1.8.0; not redefined here.)

#### Menu validator (`uiValidatorTools.ts`)
- `devpilot_validate_menu(menu_path, require_theme, require_back_button)` — checks:
  - **Focus chain**: warns when interactive controls have no `focus_neighbor_*` set.
  - **Signal connections**: scans scene.audit for `pressed` connections on Buttons.
  - **Anchors**: errors when Control has zero size + zero anchors (likely invisible).
  - **Theme**: optional check for assigned theme.
  - **Navigation**: warns when no back/close/cancel button found.
- Returns categorized issues (`focus_issues`, `signal_issues`, `anchor_issues`, `theme_issues`, `navigation_issues`) with severity (`error`/`warning`).

### Stats
- New tools: 8 (7 menus + 1 validator)
- Total tools: ~230
- Build: clean, 294/294 tests passing

---

## [1.8.0] — 2026-05-04 — Game System Generators

### Added

#### Game system tools (`gameSystemTools.ts`)
- `devpilot_create_player_controller_2d(style, ...)` — full 2D player tree (CharacterBody2D + Sprite2D + CollisionShape2D + Camera2D + script). Style: `platformer | topdown | sidescroller`.
- `devpilot_create_health_system(max_health, invincibility_time)` — Node + script with `health_changed/damaged/died` signals + i-frames.
- `devpilot_create_damage_system(kind: dealer|receiver|both)` — DamageDealer (Area2D) + DamageReceiver (Node). Group-based ("damageable") integration.
- `devpilot_create_interaction_system(interact_action)` — Area2D detector for "interactable" group + signal on input.
- `devpilot_create_inventory_system(max_slots)` — InventoryItem Resource subclass + Inventory Node with add/remove/has helpers.
- `devpilot_create_save_system(autoload_name)` — JSON save/load singleton; auto-registers as autoload.
- `devpilot_create_hud(player_health_path)` — CanvasLayer + Control + Label + ProgressBar wired via NodePath.
- `devpilot_create_pause_menu(pause_action)` — CanvasLayer + dim ColorRect + Resume/Quit buttons with tree-pause toggle.

All tools support `dry_run`, return structured response with paths/scripts created. Reuse `addChildNode` + `setProp` + `attachScript` + `writeScriptFile` helpers.

### Stats
- New tools: 8 (all `devpilot_*` namespace)
- Total tools: ~222
- Build: clean, 294/294 tests passing

---

## [1.7.0] — 2026-05-04 — Markdown Eval Reports

### Added

#### Eval reports (`evalReportTools.ts`)
- `godot_run_eval_case(case_path)` — execute a single eval case via internal RPC, validate response (`expected_ok` + `expected_response_contains`), write `evals/results/<id>.result.json`.
- `godot_run_all_evals(cases_dir, report_path)` — batch-execute every `.eval.json` in cases dir; writes per-result JSON + combined `REPORT.md`.
- `godot_export_eval_report(results_dir, output_path)` — read existing result files → generate fresh markdown report (no re-execution). Useful for CI dashboards.

External-tool-name → internal-RPC-method mapping table for current MCP cases (extendable per case via `mcp_method` field).

### Stats
- New tools: 3 (eval runner + batch runner + report exporter)
- Total tools: ~214
- Build: clean, 294/294 tests passing

### Roadmap delivered
All 10 prioritized features from v1.3.0–v1.7.0 plan now shipped:
- v1.3.0: Transaction + Diff Preview + Convention Detector
- v1.4.0: Validation Score + Autoload Manager
- v1.5.0: Input Recording/Replay + Pixel Screenshot Diff
- v1.6.0: Behavior Test Replay + Safe Refactor v2
- v1.7.0: Markdown Eval Reports

---

## [1.6.0] — 2026-05-04 — Behavior Test Replay + Safe Refactor v2

### Added

#### Behavior replay (`behaviorReplayTools.ts`)
- `godot_replay_behavior_test(test_name, hold_ms, speed_factor, capture_after_ms)` — full pipeline: load scenario JSON → run project → optional input recording replay → wait → run assertions (node_exists / property_equals / fps_in_range) → stop project → return per-assertion + per-phase report.

#### Safe Refactor v2 (`safeRefactorV2Tools.ts`)
- `godot_safe_refactor_symbol_v2(old_symbol, new_symbol, contexts, file_extensions, dry_run)` — context-aware GDScript refactor.
- Classifies each occurrence as: identifier, type_hint (`: Symbol` / `-> Symbol`), function_name (after `func`), class_name (after `class_name`), string, or comment.
- String/comment masking via per-character scanner that respects escape sequences.
- Default contexts: `[identifier, type_hint, function_name, class_name]` — strings and comments preserved by default.
- Returns `by_context` breakdown + per-occurrence detail (truncated at 200).

### Stats
- New tools: 2 (1 behavior replay + 1 safe refactor v2)
- Total tools: ~211
- Build: clean, 294/294 tests passing

---

## [1.5.0] — 2026-05-04 — Input Recording/Replay + Pixel Screenshot Diff

### Added

#### Recording tools (`recordingTools.ts`)
- `godot_save_input_recording(name, events, description, overwrite)` — persists input event sequence as JSON in `.godot_mcp/recordings/`.
- `godot_list_input_recordings` — lists all recordings with metadata.
- `godot_replay_input_recording(name, speed_factor, stop_on_error)` — reads recording → calls input RPC per event → respects per-event delay_ms scaled by speed_factor.

Event types: press_key, release_key, tap_key, press_action, release_action, mouse_click, mouse_move, mouse_drag.

#### Screenshot pixel diff (`screenshotDiffTools.ts`) — closes ISSUE-009
- `godot_compare_screenshots_pixel(path_a, path_b, threshold, output_diff_path)` — RGB Euclidean distance per pixel. Returns similarity_pct + diff_pixels. Optional diff highlight PNG.
- `godot_assert_screenshot_matches_pixel(path_a, path_b, min_similarity_pct, threshold)` — assertion form for tests.

### Dependencies
- Added `pngjs` ^7.0.0 + `@types/pngjs` ^6.0.5

### Stats
- New tools: 5 (3 recording + 2 pixel diff)
- Total tools: ~209
- Build: clean, 294/294 tests passing

---

## [1.4.0] — 2026-05-04 — Validation Score + Autoload Manager Full

### Added

#### Score tools (`scoreTools.ts`)
- `godot_validation_snapshot` — captures health snapshot (errors, circular deps, unused resources, FPS) and computes 0-100 score.
- `godot_validation_compare(before, after)` — diffs two snapshots; returns regressions/improvements/score_delta/verdict.
- `godot_run_with_score(method, params)` — captures before → executes RPC → captures after → returns full diff. Single-call impact measurement.

#### Autoload Manager (`autoloadTools.ts` + GDScript)
- `godot_list_autoloads_full` — returns name, path, enabled (* prefix), script_exists, loads_ok, class_name per autoload.
- `godot_reload_autoload(name)` — remove + re-add to pick up script changes.
- `godot_reorder_autoloads(order[])` — full ordered list; reorders load priority.

#### GDScript (`dispatcher.gd`)
- `_project_get_autoloads_full`, `_project_reload_autoload`, `_project_reorder_autoloads`
- Routes: `project.get_autoloads_full`, `project.reload_autoload`, `project.reorder_autoloads`

### Stats
- New tools: 6 (3 score + 3 autoload)
- Total tools: ~204
- Build: clean, 294/294 tests passing

---

## [1.3.0] — 2026-05-04 — Transaction + Diff Preview + Convention Detector

### Added

#### Transaction tools (`transactionTools.ts`)
- `godot_begin_transaction(label, files)` — snapshot listed files to `.godot_mcp/tx/<tx_id>/`. Returns `tx_id`.
- `godot_commit_transaction(tx_id, cleanup_snapshots)` — mark transaction committed; optional snapshot cleanup.
- `godot_rollback_transaction(tx_id)` — restore all snapshotted files; remove files that didn't exist before.
- `godot_list_transactions(filter_status)` — list active/committed/rolled_back transactions.

#### Diff tools (`diffTools.ts`, pure server-side)
- `godot_diff_file(path, proposed_content)` — LCS-based line diff with unified diff output. Returns `{added, removed, unchanged, unified_diff}`.
- `godot_diff_scene(scene_path, proposed_tscn)` — node-level scene tree diff with `nodes_added/removed/changed` + per-node property changes.

#### Convention tools (`conventionTools.ts`)
- `godot_detect_conventions` — scans `.gd/.tscn` and infers naming (functions/vars/consts/classes/signals), indent style, script coverage %, max node depth. Optional persist to `.godot_mcp/memory/conventions.md`.
- `godot_enforce_conventions(rules, dry_run)` — checks violations against rules; writes markdown report when `dry_run=false`.

### Stats
- New tools: 8 (4 transaction + 2 diff + 2 convention)
- Total tools: ~198 godot_*/devpilot_*
- Build: clean, 294/294 tests passing

---

## [1.2.0] — 2026-05-04 — Doctor + Infer + Workflow + Evals

### Added

#### Doctor tools (`doctorTools.ts`)
- `godot_project_doctor` — 8-pass diagnostic (errors, unused resources, circular deps, input map drift, autoload drift, export presets, main scene, conventions). Health score 0–100.
- `godot_run_validation_pipeline` — 10-step pipeline: project info → baseline errors → optional scene open → run → sleep → runtime tree → FPS → post errors → stop → optional regression file.
- `godot_analyze_scene_architecture` — scene tree walk detecting design smells (deep nesting, default names, many same-type children, inconsistent script coverage). Returns suggestions.

#### Infer tools (`inferTools.ts`)
- `godot_infer_input_map_from_scripts` — server-side GDScript scan for `Input.is_action_*()` calls; diffs against registered InputMap; optional `auto_add`.
- `godot_infer_autoloads_from_scripts` — extracts PascalCase singleton usages from `.gd` files; compares against autoloads; 35 built-in classes filtered.
- `godot_bind_key` — `InputEventKey` + `InputMap.action_add_event()` via GDScript. `dry_run` supported.
- `godot_bind_joypad_button` — `InputEventJoypadButton` + `InputMap.action_add_event()` via GDScript.
- `godot_validate_input_map` — cross-checks script-found actions vs registered actions with event count.
- `godot_validate_autoloads` — verifies each registered autoload script is readable.
- `godot_safe_refactor_symbol` — find/replace across `.gd/.tscn/.tres`; optional file rename; post-refactor circular dep check.
- `godot_detect_missing_singletons` — lists PascalCase singletons used in scripts but not in autoloads.

#### Workflow tools (`workflowTools.ts`)
- `devpilot_build_feature` — scene + script + attach + save + memory note. `dry_run` returns plan.
- `devpilot_fix_bug` — logs → patch → validate → run → check errors → stop.
- `devpilot_create_gameplay_loop` — player + enemy + level scene with instances + camera. `platformer/topdown/rpg`.
- `devpilot_refactor_scene_safely` — validate → audit → apply rename/reparent/remove/set_property ops → save → re-validate.
- `devpilot_validate_project` — runs doctor + conventions + optional 3s run test. Returns health score.
- `devpilot_prepare_export_release` — conventions → list presets → export → memory release note.

#### GDScript (`extended_tools.gd`)
- `bind_key()` — `InputEventKey.new()` + `OS.find_keycode_from_string()`.
- `bind_joypad()` — `InputEventJoypadButton.new()` + configurable device.

#### Dispatcher (`dispatcher.gd`)
- Routes: `infer.bind_key`, `infer.bind_joypad`.

#### Evals benchmark (`evals/`)
- 8 eval cases: health check, project doctor, infer input map, build feature dry run, safe refactor, scene architecture, behavior test, full validation.
- `evals/runner.js` — minimal Node.js runner outputting result stubs.

### Stats
- Tools registered: ~190 godot_* / devpilot_* MCP tools
- Build: clean (`tsc -p tsconfig.json`)
- Tests: 294/294 passing

---

## [1.1.0] — 2026-05-04 — Phases 17–20

### Added

#### Phase 17 — Editor scripting + TileMap + node signals + scene instancing
- `godot_execute_editor_script`, `godot_execute_game_script`
- `godot_connect_signal`, `godot_disconnect_signal`
- `godot_add_scene_instance`
- `godot_tilemap_set_cell`, `godot_tilemap_fill_rect`, `godot_tilemap_get_cell`, `godot_tilemap_clear`, `godot_tilemap_get_info`, `godot_tilemap_get_used_cells`

#### Phase 18 — AnimationTree + Audio buses + Theme + Shader params
- AnimationTree: `get_tree_structure`, `add_state`, `remove_state`, `add_transition`, `remove_transition`, `set_blend_node`, `set_tree_param`
- Audio: `get_bus_layout`, `add_bus`, `set_bus`, `add_bus_effect`, `get_info`
- Theme: `create`, `set_color`, `set_constant`, `set_font_size`, `set_stylebox`, `get_info`
- Shader: `set_param`, `get_params`

#### Phase 19 — Export presets + Resource CRUD + Batch ops + UID tools
- Export: `list_presets`, `export`, `get_info`
- Resource: `read`, `edit`, `create`
- Batch: `find_by_type`, `set_property`, `cross_scene_set`, `find_unused`, `detect_circular`
- UID: `uid_to_project_path`, `project_path_to_uid`

#### Phase 20 — Behavior-driven test generation
- `godot_generate_test_from_behavior` — run → capture tree + FPS (5 samples) + property snapshots → stop → build assertions → persist scenario.

---

## [1.0.0] — 2026-05-04 — Phase 16 release prep

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
