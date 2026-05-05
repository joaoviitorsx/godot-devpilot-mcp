# Using Godot DevPilot with AI assistants

Godot DevPilot is designed for prompt-first game development. AI assistants (Claude, Codex, etc.) should not pick individual MCP tools by hand — they should let the **Prompt Workflow Layer** do the routing.

## Default flow

1. `devpilot_route_prompt` — classify intent (CREATE / CONTINUE / ADD_FEATURE / FIX_BUG / POLISH / VALIDATE).
2. `devpilot_generate_prompt_plan` — get a structured plan.
3. `devpilot_execute_prompt_workflow` — run it (use `dry_run: true` first when in doubt).
4. `devpilot_generate_workflow_report` — render the latest result as Markdown.

`devpilot_execute_prompt_workflow` does steps 1+2+3 in one call. Use it as the default entry point.

## Mode rules

| Mode | When | Rule |
|---|---|---|
| CREATE | "crie um jogo / create a game / from scratch" | May generate full new structure. |
| CONTINUE | "continue o projeto / existing project" | Must run `godot_project_doctor` and `godot_explain_project_architecture` first. Incremental changes only. Never replaces existing systems. |
| ADD_FEATURE | "adicione X / add X" | Delegates to `devpilot_build_feature`. |
| FIX_BUG | "não funciona / fix / broken" | Delegates to `devpilot_fix_bug` after capturing logs. |
| POLISH | "melhore game feel / polish / performance" | Read-mostly tuning + audits. |
| VALIDATE | "valide / audit / health" | Read-only diagnostics + report. |

## Safety contract

- Every execution returns: `mode`, `goal`, `plan`, `executed_steps`, `created_files`, `modified_files`, `validation`, `report_path`, `next_prompts`, `warnings`, `errors`.
- `dry_run: true` returns a preview only — no Godot mutation, no tool with side effects called.
- File diffs are computed via filesystem snapshot (mtime) when the bridge has no `fs.list_changed`. Never invents changes.
- Reports persist to `.devpilot/reports/<timestamp>-<mode>-<slug>.{md,json}` and `latest.{md,json}`.
- `read_only` mode skips mutation steps and emits a warning.

## Prompt templates

See `docs/prompts/` for ready-to-paste prompts per mode.
