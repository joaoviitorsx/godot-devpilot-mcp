import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ServerConfig } from "../../config/config.js";
import type { GodotClient } from "../../godot/client.js";
import { callAfterConnect } from "../../tools/agenticTools.js";
import {
  applyPlan,
  parsePromptToPlan,
  persistDesignPlan,
} from "../../tools/prototypeTools.js";
import type {
  ExecutedStep,
  ExecutionOptions,
  WorkflowExecutionResult,
  WorkflowPlan,
  WorkflowValidation,
} from "./workflowTypes.js";

const SNAPSHOT_DIRS = ["scenes", "scripts", "shaders", "addons"];
const SNAPSHOT_EXTS = new Set([".tscn", ".gd", ".tres", ".cs", ".gdshader", ".shader"]);
const SNAPSHOT_MAX_FILES = 5000;

type FileSnapshot = Map<string, number>;

async function snapshotProjectFiles(projectRoot: string): Promise<{ snap: FileSnapshot; warning: string | null }> {
  const snap: FileSnapshot = new Map();
  let count = 0;
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (count >= SNAPSHOT_MAX_FILES) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (count >= SNAPSHOT_MAX_FILES) {
        truncated = true;
        return;
      }
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        await walk(p);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!SNAPSHOT_EXTS.has(ext)) continue;
        try {
          const st = await stat(p);
          snap.set(p, st.mtimeMs);
          count++;
        } catch {
          /* ignore */
        }
      }
    }
  }

  for (const sub of SNAPSHOT_DIRS) {
    await walk(path.join(projectRoot, sub));
  }

  return { snap, warning: truncated ? `File snapshot truncated at ${SNAPSHOT_MAX_FILES} files.` : null };
}

function diffSnapshots(before: FileSnapshot, after: FileSnapshot, projectRoot: string): { created: string[]; modified: string[] } {
  const created: string[] = [];
  const modified: string[] = [];
  for (const [p, mtime] of after) {
    const prev = before.get(p);
    const rel = toResPath(p, projectRoot);
    if (prev === undefined) created.push(rel);
    else if (mtime > prev) modified.push(rel);
  }
  created.sort();
  modified.sort();
  return { created, modified };
}

function toResPath(absPath: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, absPath).split(path.sep).join("/");
  return `res://${rel}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyValidation(): WorkflowValidation {
  return {
    health_score: null,
    runtime_errors: null,
    broken_signals: null,
    missing_input_actions: null,
  };
}

function extractValidation(rawDoctor: unknown): WorkflowValidation {
  const v = emptyValidation();
  if (!rawDoctor || typeof rawDoctor !== "object") return v;
  const r = rawDoctor as Record<string, unknown>;
  if (typeof r.health_score === "number") v.health_score = r.health_score;
  if (typeof r.score === "number" && v.health_score === null) v.health_score = r.score;
  if (Array.isArray(r.errors)) v.runtime_errors = r.errors.length;
  if (Array.isArray(r.broken_signals)) v.broken_signals = r.broken_signals.length;
  if (Array.isArray(r.missing_input_actions)) v.missing_input_actions = r.missing_input_actions.length;
  v.raw = rawDoctor;
  return v;
}

async function runRpcStep(godot: GodotClient, executed: ExecutedStep, method: string, params: unknown = {}): Promise<unknown> {
  const r = await callAfterConnect(godot, method, params);
  executed.tools_called.push(`rpc:${method}`);
  if (!r.ok) {
    executed.errors.push(`${method}: ${r.error.code} ${r.error.message}`);
    return null;
  }
  return r.data;
}

export async function executePromptWorkflow(
  prompt: string,
  plan: WorkflowPlan,
  options: ExecutionOptions,
  godot: GodotClient,
  config: ServerConfig,
): Promise<WorkflowExecutionResult> {
  const startedAt = nowIso();
  const result: WorkflowExecutionResult = {
    success: true,
    mode: plan.mode,
    goal: plan.goal,
    plan,
    executed_steps: [],
    created_files: [],
    modified_files: [],
    validation: null,
    report_path: null,
    next_prompts: plan.next_prompts,
    warnings: [],
    errors: [],
    dry_run: options.dry_run,
    summary: "",
    started_at: startedAt,
    finished_at: startedAt,
  };

  // Dry run: no mutations, no godot.call. Just preview plan.
  if (options.dry_run) {
    for (const step of plan.steps) {
      result.executed_steps.push({
        id: step.id,
        title: step.title,
        success: true,
        tools_called: step.tools.slice(),
        warnings: ["dry_run: not executed"],
        errors: [],
      });
    }
    result.summary = `Dry-run preview for ${plan.mode}: ${plan.steps.length} steps planned.`;
    result.finished_at = nowIso();
    return result;
  }

  if (config.security.readOnly && plan.mode !== "VALIDATE") {
    result.warnings.push("Server is in read-only mode; mutating steps will be skipped.");
  }

  const { snap: snapBefore, warning: snapWarn } = await snapshotProjectFiles(config.projectRoot);
  if (snapWarn) result.warnings.push(snapWarn);

  // Mode-specific orchestration. Reuses internal helpers; uses godot.call only for bridge RPC.
  switch (plan.mode) {
    case "CREATE":
      await runCreate(prompt, plan, options, godot, config, result);
      break;
    case "CONTINUE":
      await runContinue(plan, options, godot, result);
      break;
    case "ADD_FEATURE":
      await runAddFeature(plan, godot, result);
      break;
    case "FIX_BUG":
      await runFixBug(plan, godot, result);
      break;
    case "POLISH":
      await runPolish(plan, godot, result);
      break;
    case "VALIDATE":
      await runValidate(plan, godot, result);
      break;
  }

  // Snapshot diff for changed files (fallback when bridge has no fs.list_changed).
  const { snap: snapAfter } = await snapshotProjectFiles(config.projectRoot);
  const diff = diffSnapshots(snapBefore, snapAfter, config.projectRoot);
  result.created_files = mergeUnique(result.created_files, diff.created);
  result.modified_files = mergeUnique(result.modified_files, diff.modified);

  if (options.validate_after && plan.mode !== "VALIDATE") {
    await runValidationStep(godot, result);
  }

  result.success = result.errors.length === 0 && result.executed_steps.every((s) => s.success || !planStepRequired(plan, s.id));
  result.summary = result.success
    ? `${plan.mode} workflow completed (${result.executed_steps.length} steps).`
    : `${plan.mode} workflow finished with ${result.errors.length} error(s).`;
  result.finished_at = nowIso();
  return result;
}

function planStepRequired(plan: WorkflowPlan, stepId: string): boolean {
  return plan.steps.find((s) => s.id === stepId)?.required ?? false;
}

function mergeUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b])).sort();
}

// ── Mode runners ─────────────────────────────────────────────────────────────

async function runCreate(
  prompt: string,
  plan: WorkflowPlan,
  options: ExecutionOptions,
  godot: GodotClient,
  config: ServerConfig,
  result: WorkflowExecutionResult,
): Promise<void> {
  // 1. Design
  const designStep: ExecutedStep = makeStep(plan, "design");
  const gamePlan = parsePromptToPlan(prompt);
  designStep.tools_called.push("internal:parsePromptToPlan");
  if (!config.security.readOnly) {
    try {
      const persisted = await persistDesignPlan(config.projectRoot, gamePlan);
      designStep.data = { plan: gamePlan, persisted_path: persisted };
    } catch (e) {
      designStep.warnings.push(`persistDesignPlan failed: ${(e as Error).message}`);
      designStep.data = { plan: gamePlan };
    }
  } else {
    designStep.data = { plan: gamePlan };
    designStep.warnings.push("read-only: skipped persistDesignPlan");
  }
  result.executed_steps.push(designStep);

  // 2. Prototype
  const protoStep: ExecutedStep = makeStep(plan, "prototype");
  if (config.security.readOnly) {
    protoStep.success = false;
    protoStep.errors.push("read-only mode: cannot apply playable prototype");
    result.errors.push("CREATE prototype step blocked by read-only mode.");
  } else {
    try {
      const applied = await applyPlan(godot, config, gamePlan, { skipExisting: false, runValidation: false });
      protoStep.tools_called.push("internal:applyPlan");
      protoStep.data = { steps_executed: applied.steps.length, steps_failed: applied.failed, files: applied.files_created };
      if (applied.failed > 0) {
        protoStep.warnings.push(`${applied.failed} sub-step(s) failed in applyPlan`);
      }
      result.created_files = mergeUnique(result.created_files, applied.files_created);
    } catch (e) {
      protoStep.success = false;
      protoStep.errors.push((e as Error).message);
      result.errors.push(`CREATE prototype error: ${(e as Error).message}`);
    }
  }
  result.executed_steps.push(protoStep);

  // 3. Validation
  const valStep: ExecutedStep = makeStep(plan, "validation");
  if (options.validate_after) {
    const runR = await runRpcStep(godot, valStep, "debug.run_project", {});
    await new Promise((r) => setTimeout(r, 2000));
    const logs = await runRpcStep(godot, valStep, "debug.get_output_logs", {});
    await runRpcStep(godot, valStep, "debug.stop_project", {});
    valStep.data = { run: runR, logs };
  } else {
    valStep.warnings.push("validate_after=false: skipped");
  }
  result.executed_steps.push(valStep);
}

async function runContinue(
  plan: WorkflowPlan,
  options: ExecutionOptions,
  godot: GodotClient,
  result: WorkflowExecutionResult,
): Promise<void> {
  // 1. Diagnose (always required)
  const diag = makeStep(plan, "diagnose");
  const errors = await runRpcStep(godot, diag, "debug.get_debugger_errors", {});
  const info = await runRpcStep(godot, diag, "project.get_info", {});
  diag.data = { errors, project_info: info };
  result.executed_steps.push(diag);

  // 2. Architecture
  const arch = makeStep(plan, "architecture");
  const summary = await runRpcStep(godot, arch, "project.get_info", {});
  arch.data = { project_summary: summary };
  arch.warnings.push("Architecture report uses RPC primitives only; for full markdown call godot_explain_project_architecture.");
  result.executed_steps.push(arch);

  // 3. Incremental — declarative; actual mutation deferred to specific tools
  const inc = makeStep(plan, "incremental");
  inc.warnings.push(
    "CONTINUE mode does not auto-mutate. Call devpilot_build_feature / devpilot_fix_bug / specific tools for the target change."
  );
  result.executed_steps.push(inc);

  // 4. Validation
  const val = makeStep(plan, "validation");
  if (options.validate_after) {
    await runValidationRpcs(godot, val);
  } else {
    val.warnings.push("validate_after=false: skipped");
  }
  result.executed_steps.push(val);
}

async function runAddFeature(plan: WorkflowPlan, godot: GodotClient, result: WorkflowExecutionResult): Promise<void> {
  const diag = makeStep(plan, "diagnose");
  const errors = await runRpcStep(godot, diag, "debug.get_debugger_errors", {});
  diag.data = { errors };
  result.executed_steps.push(diag);

  const feat = makeStep(plan, "feature");
  feat.warnings.push(
    "ADD_FEATURE delegates feature scaffolding to devpilot_build_feature. Invoke it directly with feature_name + kind."
  );
  result.executed_steps.push(feat);

  const val = makeStep(plan, "validation");
  await runValidationRpcs(godot, val);
  result.executed_steps.push(val);
}

async function runFixBug(plan: WorkflowPlan, godot: GodotClient, result: WorkflowExecutionResult): Promise<void> {
  const diag = makeStep(plan, "diagnose");
  const errors = await runRpcStep(godot, diag, "debug.get_debugger_errors", {});
  diag.data = { errors };
  result.executed_steps.push(diag);

  const logs = makeStep(plan, "logs");
  const out = await runRpcStep(godot, logs, "debug.get_output_logs", {});
  logs.data = { output_logs: out };
  result.executed_steps.push(logs);

  const fix = makeStep(plan, "fix");
  fix.warnings.push(
    "FIX_BUG delegates the actual repair to devpilot_fix_bug. Invoke it with the failing target after reviewing logs."
  );
  result.executed_steps.push(fix);

  const val = makeStep(plan, "validation");
  const run = await runRpcStep(godot, val, "debug.run_project", {});
  await new Promise((r) => setTimeout(r, 2000));
  const after = await runRpcStep(godot, val, "debug.get_output_logs", {});
  await runRpcStep(godot, val, "debug.stop_project", {});
  val.data = { run, logs_after: after };
  result.executed_steps.push(val);
}

async function runPolish(plan: WorkflowPlan, godot: GodotClient, result: WorkflowExecutionResult): Promise<void> {
  const perf = makeStep(plan, "performance_audit");
  const stats = await runRpcStep(godot, perf, "debug.get_process_stats", {});
  perf.data = { process_stats: stats };
  result.executed_steps.push(perf);

  const acc = makeStep(plan, "accessibility_audit");
  const inputMap = await runRpcStep(godot, acc, "project.get_input_map", {});
  acc.data = { input_map: inputMap };
  acc.warnings.push("Run devpilot_accessibility_audit for full audit (menus + contrast).");
  result.executed_steps.push(acc);

  const val = makeStep(plan, "validation");
  await runValidationRpcs(godot, val);
  result.executed_steps.push(val);
}

async function runValidate(plan: WorkflowPlan, godot: GodotClient, result: WorkflowExecutionResult): Promise<void> {
  const doc = makeStep(plan, "doctor");
  const errors = await runRpcStep(godot, doc, "debug.get_debugger_errors", {});
  const info = await runRpcStep(godot, doc, "project.get_info", {});
  doc.data = { errors, project_info: info };
  result.validation = extractValidation({ errors: Array.isArray(errors) ? errors : [], project_info: info });
  result.executed_steps.push(doc);

  const pipe = makeStep(plan, "validation_pipeline");
  await runValidationRpcs(godot, pipe);
  result.executed_steps.push(pipe);

  const arch = makeStep(plan, "architecture");
  const inputMap = await runRpcStep(godot, arch, "project.get_input_map", {});
  arch.data = { input_map: inputMap };
  arch.warnings.push("For full architecture markdown call godot_explain_project_architecture.");
  result.executed_steps.push(arch);

  const rel = makeStep(plan, "release_checklist");
  rel.warnings.push("Call godot_prepare_release_checklist for the persisted markdown checklist.");
  result.executed_steps.push(rel);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function runValidationRpcs(godot: GodotClient, step: ExecutedStep): Promise<void> {
  const errors = await runRpcStep(godot, step, "debug.get_debugger_errors", {});
  const info = await runRpcStep(godot, step, "project.get_info", {});
  step.data = { errors, project_info: info };
}

async function runValidationStep(godot: GodotClient, result: WorkflowExecutionResult): Promise<void> {
  const step: ExecutedStep = {
    id: "post_validation",
    title: "Post-execution validation",
    success: true,
    tools_called: [],
    warnings: [],
    errors: [],
  };
  const errors = await runRpcStep(godot, step, "debug.get_debugger_errors", {});
  const info = await runRpcStep(godot, step, "project.get_info", {});
  step.data = { errors, project_info: info };
  result.validation = extractValidation({ errors: Array.isArray(errors) ? errors : [], project_info: info });
  result.executed_steps.push(step);
}

function makeStep(plan: WorkflowPlan, id: string): ExecutedStep {
  const def = plan.steps.find((s) => s.id === id);
  return {
    id,
    title: def?.title ?? id,
    success: true,
    tools_called: [],
    warnings: [],
    errors: [],
  };
}
