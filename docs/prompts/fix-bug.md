# FIX_BUG

> Symptom: [WHAT IS BROKEN — node, scene, expected vs actual]

1. `devpilot_execute_prompt_workflow` mode=`FIX_BUG`.
2. Read `executed_steps[logs].data.output_logs` for the actual error.
3. Call `devpilot_fix_bug` with the failing target.
4. Re-run the validation step.

Rules: minimal safe fix, preserve architecture, no broad refactors.
