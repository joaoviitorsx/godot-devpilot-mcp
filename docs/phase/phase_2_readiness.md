# Phase 2 Readiness

Date: 2026-05-03

Purpose: define the linear state required to start Fase 2 - Segurança e confiabilidade.

This document prepared Fase 2. The initial safety foundation has now started; current implementation progress is tracked in `docs/phase/phase_2_progress.md`.

## 1. Linear baseline

The project should move in this order:

```text
Fase 0 documentation and audit baseline
    ↓
Fase 1 core MCP and protocol
    ↓
Fase 1 hardening adjustments
    ↓
Fase 2 safety foundation
    ↓
CLI Bridge Foundation
```

Reason:

```text
The CLI Bridge proposed in docs/coding_solo_integration.md handles executables, OS paths and processes. It should not expose tools before the Fase 2 safety layer exists.
```

## 2. Current baseline after adjustments

Fase 0:

```text
[x] Root README conflict resolved by keeping README.md only.
[x] Documentation filename convention recorded in docs/documentation_conventions.md.
[x] MIT license exists.
[x] Reference audit includes tomyud1 and Coding-Solo conceptual findings.
[ ] Detailed tool-by-tool catalog for references remains pending.
[ ] Running external reference projects locally remains pending.
```

Fase 1:

```text
[x] Core MCP server exists.
[x] Godot plugin WebSocket bridge exists.
[x] JSON-RPC 2.0 helpers exist.
[x] Health check and ping exist.
[x] Capabilities can include plugin capabilities when the editor bridge is connected.
[x] Reconnect delay now uses capped exponential backoff.
[x] Tests cover config, modes, protocol, client disconnected behavior, capabilities payload and reconnect delay.
[ ] MCP Inspector or real MCP client validation remains pending.
[ ] Automated Godot headless E2E test remains pending.
```

## 3. Fase 2 implementation order

Recommended implementation order:

```text
1. pathGuard
2. permissionService and read-only mode
3. actionLogger JSONL
4. dryRun service
5. backup service
6. safeTrash
7. plugin-side permissions.gd and path validation
8. integration into future file/project tools
```

This order prevents mutable tools from being added before basic blocking and audit mechanisms exist.

## 4. Fase 2 first tests

These tests were written before the initial production safety modules:

```text
[x] path traversal returns PATH_OUTSIDE_PROJECT.
[x] absolute paths outside project return PATH_OUTSIDE_PROJECT.
[x] read-only mode blocks a simulated mutable tool with READ_ONLY_MODE.
[x] actionLogger appends one valid JSONL line.
[x] dry_run returns planned changes and does not invoke mutation.
[x] backup failure prevents a write operation.
[x] safeTrash moves a file inside .godot_mcp/trash instead of deleting it.
[x] plugin-side permissions.gd blocks unsafe paths and mutable tools in read-only mode.
```

## 5. CLI Bridge gating

Before implementing any Coding-Solo-inspired CLI tool, Fase 2 must provide:

```text
[x] project path validation for res:// project resources
[ ] executable path validation
[ ] no shell command string execution
[ ] timeout enforcement
[ ] process logs
[x] read-only tool allowlist for project tools
[ ] no arbitrary GDScript execution from AI input
```

Allowed earliest CLI Bridge tools after safety baseline:

```text
godot_detect_executable
godot_get_cli_version
godot_get_bridge_status
```

Not allowed until later:

```text
godot_run_batch_operation
godot_create_scene_batch
godot_add_node_batch
godot_update_project_uids
```

## 6. Definition of ready to start Fase 2

The project is ready to start Fase 2 when:

```text
[x] Fase 1 tests pass.
[x] TypeScript build passes.
[x] Documentation no longer has conflicting root README instructions.
[x] Fase 2 readiness order is documented.
[x] Coding-Solo integration is gated behind Fase 2 safety.
[x] The first Fase 2 test file is written and fails for the expected missing safety module.
```
