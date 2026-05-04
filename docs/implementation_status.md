# Implementation Status

This file tracks what has been implemented against `docs/roadmap.md`.

## Phase 0 - Preparation and audit

- [x] Initial documentation exists under `docs/`.
- [x] Repository structure for `mcp-server/` and `addons/godot_devpilot_mcp/` has been created.
- [x] MIT license decision has been materialized in `LICENSE`.
- [x] Public reference audit notes are recorded in `docs/base_audit.md`.
- [x] Local environment has Node.js and npm available.
- [x] A Godot 4.6.1 headless editor session loads the plugin and starts the WebSocket server.
- [x] Root README conflict resolved; `README.md` is canonical.
- [x] Lowercase documentation naming convention recorded in `docs/documentation_conventions.md`.
- [x] Coding-Solo CLI Bridge integration analyzed as a gated complementary track.

## Phase 1 - Core MCP and protocol

- [x] TypeScript MCP server scaffold exists in `mcp-server/src/index.ts`.
- [x] Configuration loader supports host, port, timeout, reconnect and mode.
- [x] JSON-RPC 2.0 request and response helpers exist.
- [x] Godot WebSocket client supports status, connect, disconnect, call timeout and reconnect scheduling.
- [x] Phase 1 MCP tools are registered.
- [x] Godot plugin scaffold exists under `addons/godot_devpilot_mcp/`.
- [x] Plugin WebSocket RPC server exists.
- [x] Plugin dispatcher supports phase 1 system methods.
- [x] Plugin response factory returns the standard response envelope.
- [x] End-to-end `system.health_check` succeeds through compiled Node client -> WebSocket -> Godot plugin.
- [x] Reconnect delay uses capped exponential backoff.
- [x] Capabilities payload can include plugin capabilities when the editor bridge is connected.

## Phase 2 readiness

- [x] Linear readiness document exists at `docs/phase/phase_2_readiness.md`.
- [x] CLI Bridge is explicitly blocked behind Fase 2 safety foundations.
- [x] First Fase 2 failing tests were written and observed failing for missing safety modules.

## Phase 2 - Safety and reliability foundation

- [x] Server path sandbox exists in `mcp-server/src/safety/pathGuard.ts`.
- [x] Server read-only permission guard exists in `mcp-server/src/safety/permissions.ts`.
- [x] Server read-only mode is configurable through `GODOT_MCP_READ_ONLY` and defaults to enabled.
- [x] Capabilities payload exposes `security.read_only`.
- [x] JSONL action logger exists through `mcp-server/src/utils/logger.ts`.
- [x] Dry-run response helper exists in `mcp-server/src/safety/dryRun.ts`.
- [x] File backup helper exists in `mcp-server/src/safety/backup.ts`.
- [x] Safe trash helper exists in `mcp-server/src/safety/safeTrash.ts`.
- [x] Plugin-side path and read-only validation exists in `addons/godot_devpilot_mcp/core/permissions.gd`.
- [x] Godot headless test exists at `tests/godot/permissions_test.gd`.
- [x] Shared tool execution wrapper exists in `mcp-server/src/safety/toolWrapper.ts` (read-only check, action logging, SafetyError normalization, unexpected error normalization).
- [ ] Safety modules are not yet wired into mutable MCP tools because those tools have not been implemented.
- [ ] CLI Bridge remains blocked until executable validation, process timeout/logging and CLI allowlist exist.

## Phase 3 - Essential project tools

- [x] `GODOT_MCP_PROJECT_ROOT` env var added to `ServerConfig.projectRoot`.
- [x] `PHASE3_TOOLS` and `ALL_TOOLS` exported from `mcp-server/src/config/modes.ts`.
- [x] `godot_list_files` implemented (filesystem, pathGuard, extension filter, recursive, limit).
- [x] `godot_read_file` implemented (filesystem, pathGuard).
- [x] `godot_get_project_info` implemented (plugin → `project.get_info`).
- [x] `godot_get_editor_context` implemented (plugin → `project.get_editor_context`).
- [x] All Phase 3 tools wired through `executeToolSafely`.
- [x] `project.get_info` and `project.get_editor_context` added to Godot plugin dispatcher.
- [x] All Phase 3 tools implemented: `godot_get_project_settings`, `godot_get_open_scenes`, `godot_get_selected_nodes`, `godot_get_input_map`, `godot_add_input_action`, `godot_remove_input_action`, `godot_get_autoloads`, `godot_add_autoload`, `godot_remove_autoload`, `godot_search_files`, `godot_write_file`, `godot_patch_file`.
- [x] `godot_write_file` and `godot_patch_file` wired through `createFileBackup` + `executeToolSafely`.
- [x] InputMap CRUD persists to `project.godot` via `ProjectSettings.save()`.
- [x] Phase 3 complete. Next: Phase 4 — Cenas, nós e UndoRedo.

## Phase 4 readiness

- [x] Phase 4 readiness document exists at `docs/phase/phase_4_readiness.md`.

## Phase 4 - Scenes, nodes, and UndoRedo

- [x] `undo_service.gd` wraps `EditorUndoRedoManager`; null-safe for headless mode.
- [x] `scene_tools.gd` implements all 7 scene operations.
- [x] `node_tools.gd` implements all 10 node operations with UndoRedo + type coercion.
- [x] `plugin.gd` passes `get_undo_redo()` to `rpc_server`.
- [x] `rpc_server.gd` forwards `undo_redo` to `dispatcher`.
- [x] `dispatcher.gd` routes all 17 Phase 4 methods via scene_tools/node_tools instances.
- [x] Dispatcher capabilities updated: `undo_redo: true`, 35 methods listed.
- [x] `sceneTools.ts` registers 7 MCP tools with dry_run support.
- [x] `nodeTools.ts` registers 10 MCP tools with dry_run support.
- [x] `PHASE4_TOOLS` (17 tools) added to `modes.ts`; `ALL_TOOLS` expanded to 38.
- [x] Phase 4 read tools added to `READ_ONLY_TOOL_ALLOWLIST`.
- [x] Phase 4 complete. 17 TS tests + 17 Godot headless tests pass.
