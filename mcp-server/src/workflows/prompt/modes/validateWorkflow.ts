import type { WorkflowPlan } from "../workflowTypes.js";

export function buildValidatePlan(prompt: string): WorkflowPlan {
  return {
    mode: "VALIDATE",
    goal: prompt,
    validation_required: true,
    report_required: true,
    rules: {
      read_only: true,
      must_preserve_architecture: true,
      may_create_new_structure: false,
    },
    next_prompts: [
      "Corrija o item de maior risco listado no relatório.",
      "Gere release checklist.",
      "Audite arquitetura e dependências.",
    ],
    steps: [
      {
        id: "doctor",
        title: "Project doctor",
        description: "Run project diagnostics.",
        tools: ["godot_project_doctor"],
        required: true,
      },
      {
        id: "validation_pipeline",
        title: "Validation pipeline",
        description: "Run full validation pipeline.",
        tools: ["godot_run_validation_pipeline"],
        required: true,
      },
      {
        id: "architecture",
        title: "Architecture report",
        description: "Generate architecture markdown.",
        tools: ["godot_explain_project_architecture"],
        required: false,
      },
      {
        id: "release_checklist",
        title: "Release checklist",
        description: "Produce checklist of release blockers.",
        tools: ["godot_prepare_release_checklist"],
        required: false,
      },
    ],
  };
}
