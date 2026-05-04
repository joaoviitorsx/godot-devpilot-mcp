# Evals — Godot DevPilot MCP Benchmark

Benchmark eval cases for regression-testing MCP tool quality. Each `.eval.json` file describes an input prompt, the expected tool call(s), and pass/fail criteria.

## Running

```bash
# Manual: inspect expected vs actual tool calls in a live Godot session
# Automated: integrate with an LLM eval harness (e.g., promptfoo, evals SDK)
node evals/runner.js --case evals/cases/01_health_check.eval.json
```

## Structure

```
evals/
  cases/              # 8 baseline eval cases
  runner.js           # Simple Node.js runner (reads case, calls MCP server)
  results/            # Auto-generated per-run results (gitignored)
```

## Pass criteria

Each case defines `expected_tool`, `expected_response_contains`, and optionally `expected_ok: true`.
The runner compares actual MCP response JSON against these fields.
