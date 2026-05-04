# Phase 3 Readiness

Date: 2026-05-03

Purpose: define the baseline required to start Fase 3 — Ferramentas essenciais de projeto.

This document captures the gate condition. Implementation progress is tracked in `docs/phase/phase_3_progress.md`.

## 1. Baseline after Fase 2

Fase 2 safety foundation (non-CLI):

```text
[x] pathGuard: res:// sandbox and path traversal blocking.
[x] permissions: read-only mode and allowlist.
[x] actionLogger: JSONL audit log under .godot_mcp/logs/actions.jsonl.
[x] dryRun: dry run response helper.
[x] backup: pre-mutation file backup under .godot_mcp/backups/.
[x] safeTrash: safe file removal under .godot_mcp/trash/.
[x] toolWrapper: executeToolSafely wraps read-only check, error normalization and logging.
[x] plugin-side permissions.gd mirrors server validation.
```

CLI Bridge remains blocked:

```text
[ ] executable path validation
[ ] process timeout/logging
[ ] CLI allowlist
```

## 2. Fase 3 scope

Ferramentas essenciais de projeto (read-only first):

```text
godot_list_files        — list files in a res:// directory (filesystem, no Godot needed)
godot_read_file         — read file content (filesystem, no Godot needed)
godot_get_project_info  — project name, path, version, main scene (plugin)
godot_get_editor_context — current scene, selected nodes, is_playing (plugin)
```

Mutable tools come after read tools are stable:

```text
godot_write_file
godot_patch_file
```

## 3. Implementation order

```text
1. Add projectRoot to ServerConfig.
2. Add Phase 3 tools to modes.ts tool list.
3. Implement godot_list_files and godot_read_file (filesystem).
4. Implement godot_get_project_info and godot_get_editor_context (plugin).
5. Add project.get_info and project.get_editor_context to dispatcher.gd.
6. Wire all tools through executeToolSafely.
7. Write TS unit tests and Godot headless test.
```

## 4. Definition of ready to start Fase 3

```text
[x] Fase 2 tests pass (13 files, 38 tests).
[x] TypeScript build passes.
[x] toolWrapper.ts exists and tests pass.
[x] No mutable tool exists yet (safety modules not bypassed).
[x] Phase 3 readiness document exists.
```
