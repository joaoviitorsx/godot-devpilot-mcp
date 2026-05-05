import type { WorkflowMode, WorkflowPlan } from "./workflowTypes.js";
import { buildCreateGamePlan } from "./modes/createGameWorkflow.js";
import { buildContinueGamePlan } from "./modes/continueGameWorkflow.js";
import { buildAddFeaturePlan } from "./modes/addFeatureWorkflow.js";
import { buildFixBugPlan } from "./modes/fixBugWorkflow.js";
import { buildPolishPlan } from "./modes/polishWorkflow.js";
import { buildValidatePlan } from "./modes/validateWorkflow.js";

export function generatePromptPlan(prompt: string, mode: WorkflowMode): WorkflowPlan {
  switch (mode) {
    case "CREATE": return buildCreateGamePlan(prompt);
    case "CONTINUE": return buildContinueGamePlan(prompt);
    case "ADD_FEATURE": return buildAddFeaturePlan(prompt);
    case "FIX_BUG": return buildFixBugPlan(prompt);
    case "POLISH": return buildPolishPlan(prompt);
    case "VALIDATE": return buildValidatePlan(prompt);
    default: return buildAddFeaturePlan(prompt);
  }
}
