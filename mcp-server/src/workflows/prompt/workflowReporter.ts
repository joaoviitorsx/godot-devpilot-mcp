import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

import type { WorkflowExecutionResult } from "./workflowTypes.js";

const REPORTS_DIR = path.join(".devpilot", "reports");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "workflow";
}

function timestampSlug(iso: string): string {
  return iso.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

export function renderReportMarkdown(r: WorkflowExecutionResult): string {
  const lines: string[] = [];
  lines.push(`# DevPilot Workflow Report`);
  lines.push("");
  lines.push(`**Mode:** ${r.mode}  `);
  lines.push(`**Started:** ${r.started_at}  `);
  lines.push(`**Finished:** ${r.finished_at}  `);
  lines.push(`**Status:** ${r.success ? "success" : "failed"}${r.dry_run ? " (dry run)" : ""}`);
  lines.push("");
  lines.push("## Goal");
  lines.push(r.goal);
  lines.push("");

  lines.push("## Plan");
  for (const s of r.plan.steps) {
    lines.push(`- [${s.required ? "x" : " "}] **${s.id}** — ${s.title}`);
  }
  lines.push("");

  lines.push("## Executed steps");
  for (const s of r.executed_steps) {
    const mark = s.success ? "✓" : "✗";
    lines.push(`- ${mark} **${s.id}** — ${s.title}`);
    if (s.tools_called.length) lines.push(`    - tools: ${s.tools_called.join(", ")}`);
    for (const w of s.warnings) lines.push(`    - warning: ${w}`);
    for (const e of s.errors) lines.push(`    - error: ${e}`);
  }
  lines.push("");

  lines.push("## Created files");
  if (r.created_files.length) {
    for (const f of r.created_files) lines.push(`- ${f}`);
  } else {
    lines.push("_(none)_");
  }
  lines.push("");

  lines.push("## Modified files");
  if (r.modified_files.length) {
    for (const f of r.modified_files) lines.push(`- ${f}`);
  } else {
    lines.push("_(none)_");
  }
  lines.push("");

  lines.push("## Validation");
  if (r.validation) {
    lines.push(`- health_score: ${r.validation.health_score ?? "n/a"}`);
    lines.push(`- runtime_errors: ${r.validation.runtime_errors ?? "n/a"}`);
    lines.push(`- broken_signals: ${r.validation.broken_signals ?? "n/a"}`);
    lines.push(`- missing_input_actions: ${r.validation.missing_input_actions ?? "n/a"}`);
  } else {
    lines.push("_(not collected)_");
  }
  lines.push("");

  if (r.warnings.length) {
    lines.push("## Warnings");
    for (const w of r.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  if (r.errors.length) {
    lines.push("## Errors");
    for (const e of r.errors) lines.push(`- ${e}`);
    lines.push("");
  }

  lines.push("## Next recommended prompts");
  for (const p of r.next_prompts) lines.push(`- ${p}`);
  lines.push("");

  return lines.join("\n");
}

export async function writeReport(projectRoot: string, result: WorkflowExecutionResult): Promise<{ markdown_path: string; json_path: string; latest_markdown: string; latest_json: string }> {
  const dir = path.join(projectRoot, REPORTS_DIR);
  await mkdir(dir, { recursive: true });

  const stamp = timestampSlug(result.started_at);
  const slug = slugify(`${result.mode}-${result.goal}`);
  const baseName = `${stamp}-${slug}`;

  const md = renderReportMarkdown(result);
  const json = JSON.stringify(result, null, 2);

  const markdown_path = path.join(dir, `${baseName}.md`);
  const json_path = path.join(dir, `${baseName}.json`);
  const latest_markdown = path.join(dir, "latest.md");
  const latest_json = path.join(dir, "latest.json");

  await writeFile(markdown_path, md, "utf8");
  await writeFile(json_path, json, "utf8");
  await writeFile(latest_markdown, md, "utf8");
  await writeFile(latest_json, json, "utf8");

  return { markdown_path, json_path, latest_markdown, latest_json };
}

export async function readLatestResult(projectRoot: string): Promise<WorkflowExecutionResult | null> {
  try {
    const raw = await readFile(path.join(projectRoot, REPORTS_DIR, "latest.json"), "utf8");
    return JSON.parse(raw) as WorkflowExecutionResult;
  } catch {
    return null;
  }
}
