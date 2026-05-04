# Phase 4 Readiness

Date: 2026-05-03

Purpose: define baseline required to start Fase 4 — Cenas, nós e UndoRedo.

Progress is tracked in `docs/phase/phase_4_progress.md`.

## 1. Baseline after Phase 3

```text
[x] All Phase 3 tools implemented and tested (15 TS test files, 63 tests).
[x] godot_write_file and godot_patch_file wired through createFileBackup.
[x] executeToolSafely wraps all tools (read-only, logging, error normalization).
[x] projectRoot in ServerConfig (GODOT_MCP_PROJECT_ROOT).
```

## 2. Phase 4 scope

```text
godot_get_scene_tree        read   current edited scene tree
godot_get_scene_summary     read   node count, type breakdown
godot_validate_scene        read   check .tscn is loadable
godot_create_scene          mutate create .tscn with root node + ClassDB validation
godot_open_scene            mutate open scene in editor
godot_save_scene            mutate save current scene
godot_duplicate_scene       mutate copy .tscn to new path
godot_add_node              mutate add child node + ClassDB + UndoRedo
godot_remove_node           mutate remove node + root protection + UndoRedo
godot_rename_node           mutate rename node + UndoRedo
godot_duplicate_node        mutate duplicate node + UndoRedo
godot_reparent_node         mutate reparent node + UndoRedo
godot_get_node_properties   read   node property list with values
godot_set_node_property     mutate set node property + type coercion + UndoRedo
godot_get_node_groups       read   node group membership
godot_add_node_to_group     mutate add node to group + UndoRedo
godot_remove_node_from_group mutate remove node from group + UndoRedo
```

## 3. UndoRedo architecture

```text
EditorPlugin.get_undo_redo() → passed through plugin.gd → rpc_server.gd → dispatcher.gd
addons/godot_devpilot_mcp/core/undo_service.gd wraps EditorUndoRedoManager
When undo_redo is null (headless): operations execute directly, no undo history
```

## 4. New GDScript files

```text
addons/godot_devpilot_mcp/core/undo_service.gd  — EditorUndoRedoManager wrapper
addons/godot_devpilot_mcp/tools/scene_tools.gd  — scene operations
addons/godot_devpilot_mcp/tools/node_tools.gd   — node operations
```

## 5. Implementation order

```text
1. undo_service.gd
2. scene_tools.gd + node_tools.gd
3. Update plugin.gd + rpc_server.gd to pass undo_redo
4. Update dispatcher.gd to delegate to scene_tools/node_tools
5. sceneTools.ts + nodeTools.ts (TS proxy + dry_run server-side)
6. Update modes.ts, permissions.ts, index.ts
7. Tests (TS unit + Godot headless)
```

## 6. Definition of ready

```text
[x] Phase 3 tests pass.
[x] TypeScript build passes.
[x] Phase 4 readiness document exists.
```
