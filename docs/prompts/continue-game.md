# CONTINUE — iterate on existing project

Use DevPilot to continue the current Godot project.

> Goal: [DESCRIBE THE CHANGE]

Mandatory order:
1. `devpilot_execute_prompt_workflow` mode=`CONTINUE` dry_run=`true` → preview plan.
2. Inspect `executed_steps[diagnose]` and `executed_steps[architecture]`.
3. Re-run with dry_run=`false`.
4. Apply the actual mutation via the specific tool indicated in `executed_steps[incremental].warnings` (e.g. `devpilot_build_feature`).
5. Validate with `devpilot_execute_prompt_workflow` mode=`VALIDATE`.

Rules:
- Never replace existing systems.
- Reuse current scenes/scripts where possible.
- Preserve architecture.
