export type WorkflowMode =
  | "CREATE"
  | "CONTINUE"
  | "ADD_FEATURE"
  | "FIX_BUG"
  | "POLISH"
  | "VALIDATE";

export const WORKFLOW_MODES: WorkflowMode[] = [
  "CREATE",
  "CONTINUE",
  "ADD_FEATURE",
  "FIX_BUG",
  "POLISH",
  "VALIDATE",
];

export type RiskLevel = "low" | "medium" | "high";

export type PromptRouteResult = {
  mode: WorkflowMode;
  intent: string;
  confidence: number;
  requires_project_scan: boolean;
  risk_level: RiskLevel;
  recommended_workflow: string;
  matched_keywords: string[];
};

export type WorkflowPlanStep = {
  id: string;
  title: string;
  description: string;
  tools: string[];
  required: boolean;
};

export type WorkflowPlan = {
  mode: WorkflowMode;
  goal: string;
  steps: WorkflowPlanStep[];
  validation_required: boolean;
  report_required: boolean;
  next_prompts: string[];
  rules: Record<string, boolean>;
};

export type ExecutedStep = {
  id: string;
  title: string;
  success: boolean;
  tools_called: string[];
  warnings: string[];
  errors: string[];
  data?: unknown;
};

export type WorkflowValidation = {
  health_score: number | null;
  runtime_errors: number | null;
  broken_signals: number | null;
  missing_input_actions: number | null;
  raw?: unknown;
};

export type WorkflowExecutionResult = {
  success: boolean;
  mode: WorkflowMode;
  goal: string;
  plan: WorkflowPlan;
  executed_steps: ExecutedStep[];
  created_files: string[];
  modified_files: string[];
  validation: WorkflowValidation | null;
  report_path: string | null;
  next_prompts: string[];
  warnings: string[];
  errors: string[];
  dry_run: boolean;
  summary: string;
  started_at: string;
  finished_at: string;
};

export type ExecutionOptions = {
  dry_run: boolean;
  validate_after: boolean;
  generate_report: boolean;
  explain_steps: boolean;
};
