import type { WorkflowPlan } from "../workflowTypes.js";

export function buildFixBugPlan(prompt: string): WorkflowPlan {
  return {
    mode: "FIX_BUG",
    goal: prompt,
    validation_required: true,
    report_required: true,
    rules: {
      must_run_project_doctor_first: true,
      must_preserve_architecture: true,
      must_use_minimal_safe_fix: true,
    },
    next_prompts: [
      "Adicione um teste de regressão para esse bug.",
      "Valide o projeto inteiro após o fix.",
      "Documente a causa raiz na memória do projeto.",
    ],
    steps: [
      {
        id: "diagnose",
        title: "Project doctor",
        description: "Diagnose project + capture errors.",
        tools: ["godot_project_doctor"],
        required: true,
      },
      {
        id: "logs",
        title: "Capture runtime logs",
        description: "Read debugger errors + output logs.",
        tools: ["godot_get_debugger_errors", "godot_get_output_logs"],
        required: true,
      },
      {
        id: "fix",
        title: "Apply minimal fix",
        description: "Delegate to devpilot_fix_bug for the actual repair.",
        tools: ["devpilot_fix_bug"],
        required: true,
      },
      {
        id: "validation",
        title: "Validate fix",
        description: "Run validation loop.",
        tools: ["godot_run_validation_loop"],
        required: true,
      },
    ],
  };
}
