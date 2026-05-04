# Base Audit - MCP References

Date: 2026-05-03

References inspected at documentation level:

```text
tomyud1/godot-mcp
Coding-Solo/godot-mcp
```

This file records conceptual and functional audit notes. It does not copy source code from either project.

## tomyud1/godot-mcp findings

- The reference project is a Godot 4.x MCP integration with a Node.js MCP server and Godot plugin.
- It uses local communication between the MCP server and Godot, with port 6505 documented as the WebSocket bridge.
- Public documentation describes dozens of tools across file, scene, script, project, asset and visualization categories.
- The public README states the project is MIT licensed.
- The public README also lists current limitations, including local-only operation, one Godot instance at a time, and no undo support.

## Coding-Solo/godot-mcp findings

The complementary `docs/coding_solo_integration.md` document identifies a second reference style:

- External CLI bridge rather than editor-plugin-only bridge.
- Godot executable detection through environment/configuration.
- Opening the editor from the MCP server.
- Running projects through the Godot CLI.
- Capturing stdout/stderr for debug loops.
- Batch operations through allowlisted GDScript helpers.
- Project discovery and CI-friendly execution.

## Reuse decision for both references

This repository implements its own architecture rather than copying source code. The references are useful for validating the broad shape of the system:

- MCP over stdio for the AI client boundary.
- Local WebSocket bridge for the Godot editor boundary.
- Godot addon under `addons/`.
- TypeScript/Node.js server under `mcp-server/`.
- Future CLI Bridge under `mcp-server/src/cli/` only after Fase 2 safety is in place.

## Gaps to improve in Godot DevPilot MCP

- JSON-RPC 2.0 must be explicit and validated between server and plugin.
- Responses must always use the standard `ok`, `data`, `error`, `warnings`, `suggestions` envelope.
- UndoRedo support remains a later roadmap requirement and should not be hidden behind direct scene mutation.
- Security features such as path sandboxing, backup and dry run should be implemented before broad mutating tools.
- CLI process execution must use validated executables, `spawn`/`execFile` style argument separation, timeouts and logs.

## Remaining audit work

- Catalog `tomyud1/godot-mcp` tools in detail.
- Catalog `Coding-Solo/godot-mcp` tools in detail.
- Record exact licenses before direct reuse of any source code.
- Prefer clean-room implementation unless a dependency is explicitly approved.
