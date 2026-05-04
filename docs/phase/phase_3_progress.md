# Phase 3 Progress

Date: 2026-05-03

Purpose: record Phase 3 implementation steps after `docs/phase/phase_3_readiness.md`.

## 1. Step 1 — Essential project tools (2026-05-03)

### Files added or modified

```text
mcp-server/src/config/config.ts         — added projectRoot (GODOT_MCP_PROJECT_ROOT, defaults to cwd)
mcp-server/src/config/modes.ts          — added PHASE3_TOOLS, ALL_TOOLS, project_tools feature flag
mcp-server/src/tools/projectTools.ts    — new file: registerProjectTools
mcp-server/src/index.ts                 — registerProjectTools wired
addons/godot_devpilot_mcp/core/dispatcher.gd — project.get_info, project.get_editor_context added
mcp-server/tests/projectTools.test.ts   — new file: 12 TS unit tests
mcp-server/tests/modes.test.ts          — updated to assert ALL_TOOLS and project_tools flag
tests/godot/project_tools_test.gd       — new file: 9 Godot headless assertions
```

### Tools implemented

```text
godot_list_files         read  filesystem (no Godot required)
godot_read_file          read  filesystem (no Godot required)
godot_get_project_info   read  plugin → project.get_info
godot_get_editor_context read  plugin → project.get_editor_context
```

### Verification

```text
npm test:  14 files, 50 tests passed.
npm run build: passed.
godot --headless --path . --script tests/godot/project_tools_test.gd: 9 passed, 0 failed.
```

---

## 2. Step 2 — Remaining Phase 3 tools (2026-05-03)

### Files added or modified

```text
mcp-server/src/safety/permissions.ts      — expanded READ_ONLY_TOOL_ALLOWLIST with Phase 3 read tools
mcp-server/src/config/modes.ts            — PHASE3_TOOLS expanded to all 16 Phase 3 tools
mcp-server/src/tools/projectTools.ts      — added 9 tools: project settings, open scenes, selected nodes,
                                            input map CRUD, autoloads CRUD
mcp-server/src/tools/fileTools.ts         — new file: godot_search_files, godot_write_file, godot_patch_file
mcp-server/src/index.ts                   — registerFileTools wired
addons/godot_devpilot_mcp/core/dispatcher.gd — 9 new methods: get_project_settings, get_open_scenes,
                                             get_selected_nodes, get_input_map, add/remove_input_action,
                                             get_autoloads, add/remove_autoload
mcp-server/tests/fileTools.test.ts        — new file: 13 TS unit tests
tests/godot/project_tools_extended_test.gd — new file: 26 Godot headless assertions
```

### Tools implemented

```text
godot_get_project_settings   read    plugin → project.get_project_settings
godot_get_open_scenes        read    plugin → project.get_open_scenes (EDITOR_NOT_AVAILABLE headless)
godot_get_selected_nodes     read    plugin → project.get_selected_nodes (EDITOR_NOT_AVAILABLE headless)
godot_get_input_map          read    plugin → project.get_input_map
godot_add_input_action       mutate  dry_run server-side, plugin → project.add_input_action
godot_remove_input_action    mutate  dry_run server-side, plugin → project.remove_input_action
godot_get_autoloads          read    plugin → project.get_autoloads
godot_add_autoload           mutate  dry_run server-side + pathGuard validates path, plugin → project.add_autoload
godot_remove_autoload        mutate  dry_run server-side, plugin → project.remove_autoload
godot_search_files           read    filesystem (no Godot required), substring pattern match
godot_write_file             mutate  filesystem + pathGuard + backup + dry_run + READ_ONLY_MODE
godot_patch_file             mutate  filesystem + pathGuard + backup + dry_run + READ_ONLY_MODE
```

### Guarantees

```text
[x] All tools wired through executeToolSafely.
[x] READ_ONLY_TOOL_ALLOWLIST expanded with all Phase 3 read tools.
[x] godot_write_file creates backup before overwriting; returns FILE_ALREADY_EXISTS if overwrite=false.
[x] godot_patch_file reads file first, returns PATCH_CONTENT_NOT_FOUND if old_content missing.
[x] Both file mutation tools return dry_run payload without touching filesystem.
[x] godot_add_input_action returns ACTION_ALREADY_EXISTS; remove returns ACTION_NOT_FOUND.
[x] godot_add_autoload returns AUTOLOAD_ALREADY_EXISTS; remove returns AUTOLOAD_NOT_FOUND.
[x] Plugin save() called after each InputMap/ProjectSettings mutation.
[x] godot_add_autoload runs pathGuard on the res:// path before dry_run check.
[x] get_open_scenes and get_selected_nodes return EDITOR_NOT_AVAILABLE in headless mode.
```

### Verification

```text
npm test:  15 files, 63 tests passed.
npm run build: passed.
godot --headless --path . --script tests/godot/project_tools_extended_test.gd: 26 passed, 0 failed.
```

## 3. Phase 3 complete

All roadmap Phase 3 tools are implemented and tested.

```text
[x] IA consegue saber nome, caminho e versão do projeto (godot_get_project_info)
[x] IA consegue identificar cena atual (godot_get_editor_context)
[x] IA consegue listar ações do Input Map (godot_get_input_map)
[x] IA consegue criar ações de Input Map com dry_run (godot_add_input_action)
[x] IA consegue consultar Autoloads (godot_get_autoloads)
[x] IA consegue ler e escrever arquivos com segurança (godot_read_file, godot_write_file, godot_patch_file)
[x] IA consegue buscar arquivos por padrão (godot_search_files)
```

Next: Phase 4 — Cenas, nós e UndoRedo.
