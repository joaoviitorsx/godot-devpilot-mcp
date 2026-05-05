# CREATE — new game from prompt

Use the DevPilot Prompt Workflow Layer to create a playable Godot prototype from this idea:

> [DESCRIBE THE GAME — genre, mechanics, entities, win/lose, UI]

Steps:
1. Call `devpilot_execute_prompt_workflow` with mode `auto` (or `CREATE`).
2. Review `created_files`, `validation`, `next_prompts` from the result.
3. Render the report with `devpilot_generate_workflow_report`.

Constraints:
- Do not leave broken scenes.
- Configure InputMap actions used by generated scripts.
- Connect signals properly.
- Return created files and 3 next recommended prompts.
