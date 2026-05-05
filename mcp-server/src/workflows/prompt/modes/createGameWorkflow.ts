import type { WorkflowPlan } from "../workflowTypes.js";

export function buildCreateGamePlan(prompt: string): WorkflowPlan {
  return {
    mode: "CREATE",
    goal: prompt,
    validation_required: true,
    report_required: true,
    rules: {
      may_create_new_structure: true,
      must_run_project_doctor_first: false,
      must_preserve_architecture: false,
    },
    next_prompts: [
      "Adicione um boss encounter com barra de vida e ataque em área.",
      "Adicione efeitos sonoros e música de fundo.",
      "Crie 3 upgrades novos para o jogador.",
    ],
    steps: [
      {
        id: "design",
        title: "Generate game design plan",
        description: "Parse prompt into a GameDesignPlan (genre, entities, systems, menus, scenes).",
        tools: ["devpilot_design_game_from_prompt"],
        required: true,
      },
      {
        id: "prototype",
        title: "Apply playable prototype",
        description: "Create main scene + player + enemies + collectibles + save.",
        tools: ["devpilot_create_playable_prototype"],
        required: true,
      },
      {
        id: "validation",
        title: "Validate prototype",
        description: "Run project briefly + capture errors + stop.",
        tools: ["godot_run_validation_loop"],
        required: false,
      },
    ],
  };
}
