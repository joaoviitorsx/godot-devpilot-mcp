#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverRoot, "..");
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const projectRoot = path.resolve(option("--project") ?? repoRoot);
const caseArg = option("--case");
if ((!caseArg && !args.includes("--all")) || (caseArg && args.includes("--all")) || !existsSync(path.join(projectRoot, "project.godot"))) {
  console.error("Usage: node evals/runner.js (--case <case.eval.json> | --all) [--project <Godot project>]");
  process.exitCode = 2;
} else {
  const casesDir = path.join(repoRoot, "evals", "cases");
  const casePaths = caseArg ? [path.resolve(caseArg)] : readdirSync(casesDir).filter((f) => f.endsWith(".eval.json")).map((f) => path.join(casesDir, f));
  const resultDir = path.join(repoRoot, "evals", "results");
  mkdirSync(resultDir, { recursive: true });
  const client = new Client({ name: "devpilot-eval-runner", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(serverRoot, "dist", "index.js")], cwd: projectRoot, env: { ...process.env, GODOT_MCP_PROJECT_ROOT: projectRoot, GODOT_MCP_READ_ONLY: "false", GODOT_MCP_MODE: "full" }, stderr: "inherit" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const available = new Set(tools.map((tool) => tool.name));
    let failures = 0;
    for (const casePath of casePaths) {
      const testCase = JSON.parse(readFileSync(casePath, "utf8"));
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(testCase.id)) throw new Error(`Invalid case id in ${casePath}`);
      const reasons = [];
      let actual = null;
      const started = Date.now();
      if (!available.has(testCase.expected_tool)) reasons.push(`Tool unavailable: ${testCase.expected_tool}`);
      else {
        try {
          const response = await client.callTool({ name: testCase.expected_tool, arguments: testCase.params ?? {} });
          const text = response.content?.find((item) => item.type === "text")?.text;
          try { actual = text ? JSON.parse(text) : response; }
          catch { actual = { ok: false, error: { code: "MCP_ERROR", message: text ?? "No text response" } }; }
          if (Boolean(actual?.ok) !== (testCase.expected_ok ?? true)) reasons.push(`Expected ok=${testCase.expected_ok ?? true}, got ${actual?.ok}`);
          for (const key of testCase.expected_response_contains ?? []) {
            if (!JSON.stringify(actual).includes(key)) reasons.push(`Missing response content: ${key}`);
          }
        } catch (error) { reasons.push(error instanceof Error ? error.message : String(error)); }
      }
      const passed = reasons.length === 0;
      if (!passed) failures++;
      const result = { id: testCase.id, status: passed ? "passed" : "failed", expected_tool: testCase.expected_tool, actual_response: actual, passed, duration_ms: Date.now() - started, failure_reasons: reasons, ran_at: new Date().toISOString() };
      writeFileSync(path.join(resultDir, `${testCase.id}.result.json`), JSON.stringify(result, null, 2));
      console.log(`${passed ? "PASS" : "FAIL"} ${testCase.id}${passed ? "" : `: ${reasons.join("; ")}`}`);
    }
    console.log(`${casePaths.length - failures}/${casePaths.length} evals passed.`);
    if (failures) process.exitCode = 1;
  } finally { await client.close(); }
}
