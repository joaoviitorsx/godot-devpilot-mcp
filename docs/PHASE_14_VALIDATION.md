# Validação da Fase 14 — Testes Automatizados

Projeto: **Godot DevPilot MCP**  
Fase: **14 — Testes automatizados**  
Data: 2026-05-04  
Escopo: **completa (8 ferramentas)** — assertions + scenario runner + persist + stress + regression generator.

---

## 1. Objetivo

Permitir que a IA construa cenários de teste usando ferramentas MCP, asserte estado runtime e capture regressões via screenshot diff.

Reusa Fase 6 (run/stop), Fase 7 (screenshots, input), Fase 8 (runtime introspection), Fase 9 (signal map).

---

## 2. Ferramentas implementadas (8)

Baseline (5):
```text
[x] godot_assert_node_exists           — verifica existência via runtime.get_node_properties
[x] godot_assert_property_equals       — compara propriedade com expected_value (JSON deep)
[x] godot_assert_signal_emitted        — verifica source node + signal via runtime.find_node
[x] godot_assert_screenshot_matches    — compara reference vs candidate com max_byte_diff
[x] godot_run_test_scenario            — executa lista de steps e agrega pass/fail
```

Completion (3):
```text
[x] godot_create_test_scenario         — persiste JSON em .godot_mcp/tests/<name>.json
[x] godot_stress_test_scene            — N iterações de probe runtime + stats avg/min/max/p95
[x] godot_generate_regression_test     — snapshot runtime tree → scenario JSON (+ baseline screenshot opcional)
```

`godot_assert_no_errors` já existe na Fase 6.

Arquivo: `mcp-server/src/tools/testTools.ts`.

---

## 4. Segurança

```text
[x] Todas as 5 ferramentas permitidas em read-only (apenas leitura).
[x] godot_assert_property_equals usa runtime.get_node_properties (Phase 8) — herda RUNTIME_NOT_RUNNING.
[x] godot_assert_screenshot_matches usa path sandbox + .png obrigatório.
[x] godot_run_test_scenario não modifica project files (apenas executa asserts).
[x] ASSERTION_FAILED retornado com payload completo (expected/actual/diff).
```

---

## 5. Erros padronizados

```text
ASSERTION_FAILED         # qualquer assertion falha
INVALID_PARAMS           # step type desconhecido
SCREENSHOT_NOT_FOUND     # arquivos PNG ausentes
NODE_NOT_FOUND           # propagado de Phase 8
RUNTIME_NOT_RUNNING      # propagado de Phase 8
```

---

## 6. Testes automatizados

`tests/testTools.test.ts` — 7 testes:

```text
[x] assert_node_exists passa quando plugin retorna ok
[x] assert_node_exists retorna ASSERTION_FAILED quando plugin retorna erro
[x] assert_property_equals passa quando valor casa
[x] assert_property_equals falha em mismatch
[x] assert_screenshot_matches passa para arquivos idênticos
[x] assert_screenshot_matches falha acima de threshold
[x] run_test_scenario agrega pass/fail
```

Total projeto: 26 files / 224 tests passing.

---

## 7. Exemplo de uso (run_test_scenario)

```json
{
  "steps": [
    { "name": "player exists", "type": "assert_node_exists", "params": { "node_path": "Player" } },
    { "name": "health full", "type": "assert_property_equals", "params": { "node_path": "Player", "property": "current_health", "expected_value": 100 } },
    { "name": "no visual regression", "type": "assert_screenshot_matches", "params": { "reference_path": "res://.godot_mcp/screenshots/baseline.png", "candidate_path": "res://.godot_mcp/screenshots/current.png", "max_byte_diff": 0 } }
  ]
}
```

Resposta:

```json
{
  "ok": true,
  "data": {
    "total": 3,
    "passed": 3,
    "failed": 0,
    "results": [...]
  }
}
```

---

## 8. Critério de aprovação (baseline)

```text
[x] npm run build limpo
[x] npm test 224/224 passing
[x] 5 ferramentas baseline registradas
[x] Compõe com Fases 6, 7, 8, 9
[x] read-only allowlist atualizado
```

---

## 9. Status

```text
[x] Aprovada como baseline
```

Próximo: persistência de scenarios + stress test + regression generator (futuras iterações).
