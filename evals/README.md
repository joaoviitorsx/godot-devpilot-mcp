# Evals — Godot DevPilot MCP Benchmark

Benchmark eval cases for regression-testing MCP tool quality. Each `.eval.json` file describes an input prompt, the expected tool call(s), and pass/fail criteria.

## Running

```bash
# Execute um caso com o editor Godot e o plugin abertos
node evals/runner.js --case evals/cases/01_health_check.eval.json
# Execute todos os oito casos contra um jogo específico
node evals/runner.js --all --project /caminho/do/jogo
```

## Structure

```
evals/
  cases/              # 8 baseline eval cases
  runner.js           # Cliente MCP real; inicia o servidor e verifica as respostas
  results/            # Auto-generated per-run results (gitignored)
```

## Pass criteria

Each case defines `expected_tool`, `expected_response_contains`, and optionally `expected_ok: true`.
The runner compares actual MCP response JSON against these fields and exits with status 1 if any case fails. It runs with `GODOT_MCP_MODE=full` and write access so every baseline tool is available; the cases that inspect planned changes pass `dry_run=true`.
