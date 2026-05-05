import type { WorkflowPlan } from "../workflowTypes.js";

export const CONTINUE_RULES = {
  must_run_project_doctor_first: true,
  must_analyze_architecture_first: true,
  must_prefer_incremental_changes: true,
  must_avoid_replacing_existing_systems: true,
  must_run_validation_after: true,
  may_create_new_structure: false,
  must_preserve_architecture: true,
} as const;

export function buildContinueGamePlan(prompt: string): WorkflowPlan {
  return {
    mode: "CONTINUE",
    goal: prompt,
    validation_required: true,
    report_required: true,
    rules: { ...CONTINUE_RULES },
    next_prompts: [
      "Valide o projeto inteiro e gere relatório de saúde.",
      "Adicione testes de regressão para a feature recém-modificada.",
      "Faça polish (game feel, câmera, performance).",
    ],
    steps: [
      {
        id: "diagnose",
        title: "Project doctor (read-only)",
        description: "Run diagnostics before any change.",
        tools: ["godot_project_doctor"],
        required: true,
      },
      {
        id: "architecture",
        title: "Analyze architecture",
        description: "Capture project summary + dependency hubs + signal map.",
        tools: ["godot_explain_project_architecture"],
        required: true,
      },
      {
        id: "incremental",
        title: "Plan incremental change",
        description: "Decide minimal, additive change. Defer mutation to dedicated tools.",
        tools: [],
        required: true,
      },
      {
        id: "validation",
        title: "Validate after change",
        description: "Run validation pipeline + log errors.",
        tools: ["godot_run_validation_pipeline"],
        required: true,
      },
    ],
  };
}
