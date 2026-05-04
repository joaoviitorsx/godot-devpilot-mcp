# Phase 4 Progress

Date: 2026-05-03

Purpose: record Phase 4 implementation steps after `docs/phase/phase_4_readiness.md`.

## 1. Step 1 — UndoRedo service + scene tools (2026-05-03)

### Files added or modified

```text
addons/godot_devpilot_mcp/core/undo_service.gd  — EditorUndoRedoManager null-safe wrapper
addons/godot_devpilot_mcp/tools/scene_tools.gd  — scene CRUD operations
addons/godot_devpilot_mcp/tools/node_tools.gd   — node mutations + property + groups
addons/godot_devpilot_mcp/plugin.gd             — pass get_undo_redo() to rpc_server
addons/godot_devpilot_mcp/core/rpc_server.gd    — forward undo_redo to dispatcher
addons/godot_devpilot_mcp/core/dispatcher.gd    — load SceneTools/NodeTools, route 17 Phase 4 methods,
                                                   update capabilities (undo_redo: true)
mcp-server/src/tools/sceneTools.ts              — 7 scene tools (TS proxy + dry_run)
mcp-server/src/tools/nodeTools.ts               — 10 node tools (TS proxy + dry_run)
mcp-server/src/config/modes.ts                  — PHASE4_TOOLS (17), ALL_TOOLS expanded,
                                                   undo_redo: true, scene/node categories
mcp-server/src/safety/permissions.ts            — Phase 4 read tools added to READ_ONLY_TOOL_ALLOWLIST
mcp-server/src/index.ts                         — registerSceneTools + registerNodeTools wired
mcp-server/tests/modes.test.ts                  — updated to assert PHASE4_TOOLS + undo_redo: true
mcp-server/tests/sceneTools.test.ts             — 10 TS unit tests
mcp-server/tests/nodeTools.test.ts              — 14 TS unit tests
tests/godot/phase4_test.gd                      — 17 Godot headless assertions
```

### Tools implemented

```text
godot_get_scene_tree        read   scene.get_tree
godot_get_scene_summary     read   scene.get_summary
godot_validate_scene        read   scene.validate
godot_create_scene          mutate dry_run server-side, scene.create
godot_open_scene            mutate scene.open
godot_save_scene            mutate scene.save
godot_duplicate_scene       mutate dry_run server-side, scene.duplicate
godot_add_node              mutate dry_run server-side, node.add + ClassDB validation + UndoRedo
godot_remove_node           mutate dry_run server-side, node.remove + root protection + UndoRedo
godot_rename_node           mutate dry_run server-side, node.rename + UndoRedo
godot_duplicate_node        mutate dry_run server-side, node.duplicate + UndoRedo
godot_reparent_node         mutate dry_run server-side, node.reparent + UndoRedo
godot_get_node_properties   read   node.get_properties (PROPERTY_USAGE_EDITOR filter)
godot_set_node_property     mutate dry_run server-side, node.set_property + type coercion + UndoRedo
godot_get_node_groups       read   node.get_groups
godot_add_node_to_group     mutate dry_run server-side, node.add_to_group + UndoRedo
godot_remove_node_from_group mutate dry_run server-side, node.remove_from_group + UndoRedo
```

### Guarantees

```text
[x] undo_service.gd is null-safe: headless mode executes operations directly, no undo history.
[x] scene_tools and node_tools each call _require_editor() before any operation.
[x] All mutation tools support dry_run server-side — no plugin roundtrip on dry_run.
[x] godot_add_node validates node_type via ClassDB.can_instantiate().
[x] godot_remove_node protects root: returns CANNOT_REMOVE_ROOT if node_path == ".".
[x] godot_set_node_property coerces value to match existing property type.
[x] get_node_properties filters by PROPERTY_USAGE_EDITOR, converts values to JSON-safe types.
[x] All Phase 4 read tools added to READ_ONLY_TOOL_ALLOWLIST.
[x] Dispatcher capabilities updated: undo_redo: true, 35 methods listed.
[x] var scene_root typed explicitly as Node (GDScript 4.x type inference limitation).
```

### Verification

```text
npm test:  17 files, 87 tests passed.
npm run build: passed.
godot --headless --path . --script tests/godot/phase4_test.gd: 17 passed, 0 failed.
```

## 2. Phase 4 complete

## 2. Step 2 — Validation follow-up hardening (2026-05-04)

Follow-up from `docs/PHASE_4_VALIDATION.md`.

### Changes

```text
godot_audit_scene / scene.audit added.
godot_get_scene_tree now supports max_depth.
godot_save_scene now supports dry_run in the MCP server and creates backup when scene_path/path is provided.
godot_create_scene and godot_duplicate_scene support overwrite with pre-overwrite backup.
Scene tools use server pathGuard.ts and plugin permissions.gd for res:// sandbox validation.
godot_add_node supports documented type/name aliases and initial properties.
UndoRedo wrapper now calls EditorUndoRedoManager with object/method args instead of Callable.
Node UndoRedo no longer frees nodes for undo; it removes/re-adds nodes to keep references valid.
Dry-run action logs are marked as dry_run.
```

### Verification

```text
npm test: 17 files, 95 tests passed.
npm run build: passed.
godot --headless --path . --script tests/godot/phase4_test.gd: 18 passed, 0 failed.
godot --headless --path . --script tests/godot/permissions_test.gd: passed.
godot --headless --editor --quit --path .: passed without plugin compile errors.
Practical WebSocket editor flow created/saved/validated/audited res://scenes/TestPhase4.tscn.
```

## 3. Phase 4 complete

All roadmap Phase 4 tools are implemented and tested except human Ctrl+Z confirmation, which must be done in the interactive editor.

```text
[x] IA consegue obter árvore de cena (godot_get_scene_tree)
[x] IA consegue criar, abrir, salvar e duplicar cenas (godot_create_scene, godot_open_scene, godot_save_scene, godot_duplicate_scene)
[x] IA consegue adicionar, remover, renomear, duplicar e reparentar nós com UndoRedo (godot_add_node … godot_reparent_node)
[x] IA consegue ler e definir propriedades de nós com coerção de tipos (godot_get_node_properties, godot_set_node_property)
[x] IA consegue gerenciar grupos de nós (godot_get_node_groups, godot_add_node_to_group, godot_remove_node_from_group)
[x] Todas as mutações suportam dry_run server-side
[x] UndoRedo obrigatório em mutações de nó no editor; retorna UNDO_FAILED se indisponível
[x] godot_audit_scene implementado
[x] Sandbox res:// aplicado em paths de cena no servidor e plugin
[x] Backup aplicado em save/create/duplicate quando há scene_path/path e sobrescrita
```
