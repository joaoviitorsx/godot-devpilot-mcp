import type { PromptRouteResult, WorkflowMode } from "./workflowTypes.js";

type ModeRule = {
  mode: WorkflowMode;
  intent: string;
  recommendedWorkflow: string;
  riskLevel: "low" | "medium" | "high";
  requiresProjectScan: boolean;
  keywords: string[];
};

const MODE_RULES: ModeRule[] = [
  {
    mode: "CREATE",
    intent: "create_game_from_prompt",
    recommendedWorkflow: "createGameWorkflow",
    riskLevel: "medium",
    requiresProjectScan: false,
    keywords: [
      "crie um jogo", "criar um jogo", "criar jogo", "novo jogo",
      "protótipo", "prototipo", "prototype", "from scratch",
      "create a game", "build a game", "make a game", "start a new game",
      "novo projeto", "novo prototipo", "novo protótipo",
    ],
  },
  {
    mode: "CONTINUE",
    intent: "continue_existing_game",
    recommendedWorkflow: "continueGameWorkflow",
    riskLevel: "medium",
    requiresProjectScan: true,
    keywords: [
      "continue", "continuar", "continue o projeto", "continuar projeto",
      "projeto atual", "este projeto", "esse projeto", "no projeto",
      "existing project", "current project", "ongoing project",
      "iterate", "iterar",
    ],
  },
  {
    mode: "FIX_BUG",
    intent: "fix_bug",
    recommendedWorkflow: "fixBugWorkflow",
    riskLevel: "medium",
    requiresProjectScan: true,
    keywords: [
      "corrija", "corrigir", "conserte", "consertar",
      "bug", "erro", "não funciona", "nao funciona", "quebrou", "quebra",
      "trava", "travando", "trava ao", "crash",
      "fix", "broken", "doesn't work", "does not work", "not working",
      "issue", "problem",
    ],
  },
  {
    mode: "POLISH",
    intent: "polish_game",
    recommendedWorkflow: "polishWorkflow",
    riskLevel: "low",
    requiresProjectScan: true,
    keywords: [
      "melhore", "melhorar", "polir", "refinar", "ajustar",
      "game feel", "sensação", "sensacao",
      "câmera", "camera",
      "performance", "fps", "otimizar", "otimização",
      "acessibilidade", "accessibility",
      "polish", "tune", "improve feel", "smooth",
    ],
  },
  {
    mode: "VALIDATE",
    intent: "validate_project",
    recommendedWorkflow: "validateWorkflow",
    riskLevel: "low",
    requiresProjectScan: true,
    keywords: [
      "valide", "validar", "validação", "validacao",
      "analise", "analisar", "analise o projeto", "auditar", "auditoria",
      "saúde do projeto", "saude do projeto", "doctor", "diagnóstico", "diagnostico",
      "health check", "audit", "validate", "review project", "project health",
      "checklist", "release ready",
    ],
  },
  {
    mode: "ADD_FEATURE",
    intent: "add_feature",
    recommendedWorkflow: "addFeatureWorkflow",
    riskLevel: "medium",
    requiresProjectScan: true,
    keywords: [
      "adicione", "adicionar", "acrescente", "acrescentar",
      "implemente", "implementar", "criar feature", "nova feature",
      "inventário", "inventario", "save", "load", "quest", "boss",
      "add", "implement", "create feature", "new feature",
      "inventory", "saving", "loading",
    ],
  },
];

function countMatches(lower: string, keywords: string[]): { count: number; matched: string[] } {
  const matched: string[] = [];
  for (const k of keywords) {
    if (lower.includes(k)) matched.push(k);
  }
  return { count: matched.length, matched };
}

function confidenceFor(matches: number, totalKeywords: number): number {
  if (matches === 0) return 0;
  const base = 0.6 + Math.min(matches, 3) * 0.1;
  const ratio = matches / Math.max(totalKeywords, 1);
  return Math.min(0.98, base + Math.min(ratio, 0.2));
}

export function routePrompt(prompt: string): PromptRouteResult {
  const lower = prompt.toLowerCase();

  let best: { rule: ModeRule; matches: number; matched: string[] } | null = null;
  for (const rule of MODE_RULES) {
    const { count, matched } = countMatches(lower, rule.keywords);
    if (count === 0) continue;
    if (!best || count > best.matches) {
      best = { rule, matches: count, matched };
    }
  }

  if (!best) {
    return {
      mode: "ADD_FEATURE",
      intent: "add_feature",
      confidence: 0.3,
      requires_project_scan: true,
      risk_level: "medium",
      recommended_workflow: "addFeatureWorkflow",
      matched_keywords: [],
    };
  }

  return {
    mode: best.rule.mode,
    intent: best.rule.intent,
    confidence: confidenceFor(best.matches, best.rule.keywords.length),
    requires_project_scan: best.rule.requiresProjectScan,
    risk_level: best.rule.riskLevel,
    recommended_workflow: best.rule.recommendedWorkflow,
    matched_keywords: best.matched,
  };
}
