#!/usr/bin/env node
// Minimal eval runner — reads a .eval.json case and reports pass/fail
// Usage: node evals/runner.js --case evals/cases/01_health_check.eval.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const args = process.argv.slice(2);
const caseFlag = args.indexOf("--case");
if (caseFlag === -1 || !args[caseFlag + 1]) {
  console.error("Usage: node evals/runner.js --case <path/to/case.eval.json>");
  process.exit(1);
}

const casePath = args[caseFlag + 1];
const evalCase = JSON.parse(readFileSync(casePath, "utf8"));

console.log(`\n=== Eval: ${evalCase.id} ===`);
console.log(`Description: ${evalCase.description}`);
console.log(`Expected tool: ${evalCase.expected_tool}`);
console.log(`\nThis runner validates the eval case structure. For live testing,`);
console.log(`call the MCP server with the params in params: ${JSON.stringify(evalCase.params ?? {}, null, 2)}`);
console.log(`and verify the response contains: ${JSON.stringify(evalCase.expected_response_contains)}`);

// Write a result stub
const resultsDir = join(import.meta.dirname ?? ".", "results");
mkdirSync(resultsDir, { recursive: true });
const resultPath = join(resultsDir, basename(casePath).replace(".eval.json", ".result.json"));
writeFileSync(resultPath, JSON.stringify({
  id: evalCase.id,
  status: "pending",
  expected_tool: evalCase.expected_tool,
  expected_response_contains: evalCase.expected_response_contains,
  actual_response: null,
  passed: null,
  ran_at: new Date().toISOString(),
}, null, 2));

console.log(`\nResult stub written to: ${resultPath}`);
console.log("Run against a live Godot session to populate actual_response and passed.");
