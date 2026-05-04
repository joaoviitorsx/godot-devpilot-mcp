# Phase 2 Progress

Date: 2026-05-03

Purpose: record the real start of Fase 2 after `docs/phase/phase_2_readiness.md`.

## 1. Implemented in this step

```text
mcp-server/src/safety/errors.ts
mcp-server/src/safety/pathGuard.ts
mcp-server/src/safety/permissions.ts
mcp-server/src/safety/actionLogger.ts
mcp-server/src/safety/dryRun.ts
mcp-server/src/safety/backup.ts
mcp-server/src/safety/safeTrash.ts
mcp-server/src/utils/logger.ts
addons/godot_devpilot_mcp/core/permissions.gd
tests/godot/permissions_test.gd
```

Implemented guarantees:

```text
[x] res:// path sandbox in the server.
[x] path traversal blocked with PATH_OUTSIDE_PROJECT.
[x] OS absolute paths and file:// URIs blocked.
[x] read-only mode blocks mutable tools with READ_ONLY_MODE.
[x] read-only mode defaults to enabled through GODOT_MCP_READ_ONLY.
[x] capabilities expose security.read_only.
[x] action logs can be appended as JSONL under .godot_mcp/logs/actions.jsonl.
[x] dry_run responses include planned_changes, affected_files and affected_nodes.
[x] file backups are copied to .godot_mcp/backups/YYYY-MM-DD/.
[x] backup failure raises BACKUP_FAILED before mutation can continue.
[x] backup name collisions use an incremental suffix instead of overwriting older backups.
[x] safe trash moves files to .godot_mcp/trash/YYYY-MM-DD/.
[x] safe trash name collisions use an incremental suffix instead of overwriting older trash entries.
[x] plugin-side path/read-only validation mirrors the server baseline.
```

## 2. Tests added

```text
mcp-server/tests/pathGuard.test.ts
mcp-server/tests/permissions.test.ts
mcp-server/tests/actionLogger.test.ts
mcp-server/tests/dryRun.test.ts
mcp-server/tests/backup.test.ts
mcp-server/tests/safeTrash.test.ts
tests/godot/permissions_test.gd
```

The first TypeScript run failed because `mcp-server/src/safety/*` did not exist yet.

The first Godot run failed because `addons/godot_devpilot_mcp/core/permissions.gd` did not exist yet.

## 3. What remains in Fase 2

```text
[ ] Wire safety modules into the first mutable tools when those tools are introduced.
[x] Add a shared tool execution wrapper for read-only, logging, dry_run, backup and error normalization.
[ ] Add executable path validation before CLI Bridge.
[ ] Add process timeout and process log helpers before CLI Bridge.
[ ] Add CLI tool allowlist before CLI Bridge.
[ ] Add backup retention/cleanup policy.
[ ] Add safe trash restore/list helpers if the roadmap requires restoration workflows.
```

## 5. Step 2 — Tool execution wrapper (2026-05-03)

```text
mcp-server/src/safety/toolWrapper.ts
mcp-server/tests/toolWrapper.test.ts
```

Guarantees added:

```text
[x] Read-only check runs before handler executes.
[x] SafetyError thrown by handler is caught and returned as ToolFailure.
[x] Unexpected errors are caught and returned as TOOL_EXECUTION_FAILED.
[x] Action log entry written for every outcome: success, error, blocked.
[x] Log write failure does not propagate to the caller.
[x] Read-only-allowed tools pass through in read-only mode.
```

Tests: 13 files, 38 tests passed. Build passed.

## 4. Current CLI Bridge gate

Coding-Solo CLI Bridge remains blocked.

Allowed after the remaining CLI-specific safety work:

```text
godot_detect_executable
godot_get_cli_version
godot_get_bridge_status
```

Still not allowed:

```text
godot_run_batch_operation
godot_create_scene_batch
godot_add_node_batch
godot_update_project_uids
```
