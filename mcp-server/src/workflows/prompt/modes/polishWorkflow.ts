import type { WorkflowPlan } from "../workflowTypes.js";

export function buildPolishPlan(prompt: string): WorkflowPlan {
  return {
    mode: "POLISH",
    goal: prompt,
    validation_required: true,
    report_required: true,
    rules: {
      must_preserve_architecture: true,
      may_create_new_structure: false,
    },
    next_prompts: [
      "Compare métricas antes/depois do polish.",
      "Adicione opções de acessibilidade.",
      "Valide performance em dispositivos alvo.",
    ],
    steps: [
      {
        id: "performance_audit",
        title: "Performance audit",
        description: "Capture FPS + process stats baseline.",
        tools: ["devpilot_performance_audit"],
        required: false,
      },
      {
        id: "accessibility_audit",
        title: "Accessibility audit",
        description: "Check menus + contrast + input bindings.",
        tools: ["devpilot_accessibility_audit"],
        required: false,
      },
      {
        id: "validation",
        title: "Validate after tuning",
        description: "Run validation pipeline.",
        tools: ["godot_run_validation_pipeline"],
        required: true,
      },
    ],
  };
}
