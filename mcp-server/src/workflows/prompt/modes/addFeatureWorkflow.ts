import type { WorkflowPlan } from "../workflowTypes.js";

export function buildAddFeaturePlan(prompt: string): WorkflowPlan {
  return {
    mode: "ADD_FEATURE",
    goal: prompt,
    validation_required: true,
    report_required: true,
    rules: {
      must_run_project_doctor_first: true,
      must_preserve_architecture: true,
      may_create_new_structure: true,
    },
    next_prompts: [
      "Conecte a feature à UI existente.",
      "Adicione testes de regressão para a nova feature.",
      "Valide o projeto após a integração.",
    ],
    steps: [
      {
        id: "diagnose",
        title: "Project doctor",
        description: "Capture current state before adding feature.",
        tools: ["godot_project_doctor"],
        required: true,
      },
      {
        id: "feature",
        title: "Build feature scaffold",
        description: "Delegate to devpilot_build_feature (scene + script + test).",
        tools: ["devpilot_build_feature"],
        required: true,
      },
      {
        id: "validation",
        title: "Validate",
        description: "Run validation pipeline.",
        tools: ["godot_run_validation_pipeline"],
        required: true,
      },
    ],
  };
}
