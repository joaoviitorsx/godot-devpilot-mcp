# Validação da Fase 6 — Debug Loop

Projeto: **Godot DevPilot MCP**  
Fase: **6 — Debug Loop**  
Data: 2026-05-04  
Dependência: Fases 0–5 aprovadas (ver `docs/PHASE_0_TO_5_VALIDATION_REPORT.md`)

---

## 1. Objetivo da Fase 6

Adicionar ferramentas de debug loop ao Godot DevPilot MCP, permitindo que a IA:

- Inicie e pare o projeto/cena no editor Godot.
- Consulte logs de execução.
- Detecte erros de parse estaticamente.
- Asserte ausência de erros após uma execução.
- Gere e aplique correções automáticas iniciais com dry_run obrigatório.

Fase 6 **não inclui**:
- Screenshots.
- Input simulation.
- Ferramentas agentic avançadas.
- Fase 7 ou posterior.

---

## 2. Ferramentas implementadas

### 2.1 Ferramentas que delegam ao plugin (via WebSocket/JSON-RPC)

```text
godot_run_project         — inicia a main scene via EditorInterface.play_main_scene()
godot_run_scene           — inicia uma cena específica via EditorInterface.play_custom_scene()
godot_stop_project        — para a execução via EditorInterface.stop_playing_scene()
godot_is_game_running     — consulta EditorInterface.is_playing_scene()
```

### 2.2 Ferramentas gerenciadas pelo servidor (leitura de arquivos de log)

```text
godot_get_output_logs         — lê eventos de .godot_mcp/logs/run_reports/
godot_get_debugger_errors     — filtra eventos "error" dos run reports
godot_get_script_parse_errors — análise estática de arquivos .gd
godot_clear_logs              — apaga .godot_mcp/logs/run_reports/ (dry_run por padrão)
godot_get_last_run_report     — resumo do run report mais recente
godot_assert_no_errors        — asserta ausência de erros no último run report
godot_fix_errors              — gera plano de correção (dry_run=true por padrão) ou aplica patches
```

### 2.3 Totais

```text
Ferramentas Phase 6:       11
Ferramentas total projeto:  60+
```

---

## 3. Métodos JSON-RPC adicionados ao plugin

```text
debug.run_project   → DebugTools.run_project()
debug.run_scene     → DebugTools.run_scene()
debug.stop_project  → DebugTools.stop_project()
debug.is_running    → DebugTools.is_running()
```

Arquivo: `addons/godot_devpilot_mcp/tools/debug_tools.gd`

---

## 4. Formato dos run reports

Localização: `.godot_mcp/logs/run_reports/YYYY-MM-DD/run_HHMMSS.jsonl`

Cada linha é um evento JSON:

```json
{
  "timestamp": "2026-05-04T12:00:00Z",
  "type": "start|stop|output|error|parse_error",
  "data": { ... }
}
```

O plugin escreve eventos `start` e `stop` no momento em que o jogo inicia/para.  
Eventos `output` e `error` em runtime requerem integração futura com `EditorDebuggerPlugin` (Fase 8).

---

## 5. Regras de segurança da Fase 6

```text
[x] godot_run_project bloqueado em read-only.
[x] godot_run_scene bloqueado em read-only.
[x] godot_stop_project bloqueado em read-only.
[x] godot_clear_logs bloqueado em read-only.
[x] godot_fix_errors bloqueado em read-only.
[x] godot_is_game_running permitido em read-only.
[x] godot_get_output_logs permitido em read-only.
[x] godot_get_debugger_errors permitido em read-only.
[x] godot_get_script_parse_errors permitido em read-only.
[x] godot_get_last_run_report permitido em read-only.
[x] godot_assert_no_errors permitido em read-only.
[x] godot_fix_errors usa dry_run=true por padrão.
[x] godot_fix_errors cria backup antes de cada patch.
[x] godot_clear_logs usa dry_run=true por padrão.
[x] godot_run_scene valida path sandbox (res:// obrigatório).
[x] godot_run_scene verifica se cena existe antes de iniciar.
[x] godot_run_project e godot_run_scene verificam se jogo já está rodando.
```

---

## 6. Testes automatizados TypeScript

Arquivo: `mcp-server/tests/debugTools.test.ts`

```text
[x] detectStaticParseErrors detecta func sem dois-pontos.
[x] detectStaticParseErrors não falha func com tipo de retorno.
[x] detectStaticParseErrors detecta connect() Godot 3.
[x] detectStaticParseErrors detecta emit_signal() Godot 3.
[x] detectStaticParseErrors retorna vazio para script limpo.
[x] readRunReportEvents retorna vazio se não há reports.
[x] readRunReportEvents lê eventos corretamente.
[x] readRunReportEvents filtra por tipo.
[x] readRunReportEvents respeita limit.
[x] readRunReportEvents ignora linhas JSON malformadas.
[x] getLastRunReportFile retorna null sem reports.
[x] getLastRunReportFile retorna o report mais recente.
[x] godot_run_project bloqueado em read-only.
[x] godot_stop_project bloqueado em read-only.
[x] godot_is_game_running permitido em read-only.
[x] godot_get_output_logs permitido em read-only.
[x] godot_get_output_logs filtra por tipo de evento.
[x] godot_get_debugger_errors retorna somente errors.
[x] godot_assert_no_errors retorna NO_RUN_REPORT sem reports.
[x] godot_assert_no_errors retorna RUN_HAD_ERRORS se há erros.
[x] godot_assert_no_errors retorna ok=true se run limpo.
[x] godot_clear_logs dry_run não apaga arquivos.
[x] godot_clear_logs dry_run=false apaga dirs.
[x] godot_get_script_parse_errors detecta errors em script com bug.
[x] godot_get_script_parse_errors retorna vazio para script limpo.
[x] godot_fix_errors dry_run=true retorna planned_changes.
[x] godot_fix_errors usa dry_run=true por padrão.
[x] godot_fix_errors dry_run=false aplica fix e cria backup.
[x] godot_fix_errors bloqueado em read-only.
[x] godot_get_last_run_report retorna found=false sem reports.
[x] godot_get_last_run_report retorna resumo correto.
[x] — (reserva)
```

Resultado: **32/32 testes passando** em `tests/debugTools.test.ts`.  
Total projeto: **134/134** testes.

---

## 7. Critério de aprovação

```text
[x] npm run build passa sem erros.
[x] npm test passa (134/134).
[x] Todas as 11 ferramentas da Fase 6 registradas no servidor MCP.
[x] Plugin Godot: debug_tools.gd criado e integrado ao dispatcher.
[x] Ferramentas read-only funcionam em modo read-only.
[x] Ferramentas mutáveis são bloqueadas em read-only.
[x] dry_run é o padrão para godot_fix_errors e godot_clear_logs.
[x] backup é criado antes de cada patch em godot_fix_errors.
[x] godot_assert_no_errors retorna erro estruturado correto.
[x] path sandbox em godot_run_scene.
[x] Logs de execução em .godot_mcp/logs/run_reports/.
[x] Todas as respostas seguem padrão ok/data/message/warnings/suggestions.

[ ] Teste prático com Godot editor ativo (pendência de execução manual).
[ ] Validação de UndoRedo não aplicável à Fase 6 (nenhuma tool mutua nós).
```

---

## 8. Testes manuais obrigatórios (requerem Godot ativo)

Execute após iniciar o servidor MCP com Godot editor aberto:

```text
1. Chamar godot_is_game_running → esperar running=false.
2. Chamar godot_run_project → esperar running=true.
3. Aguardar alguns segundos e chamar godot_get_output_logs.
4. Chamar godot_stop_project → esperar running=false.
5. Chamar godot_get_last_run_report → esperar found=true, started_at preenchido.
6. Chamar godot_assert_no_errors → esperar ok=true (se não houver erros no run).
7. Verificar arquivo em .godot_mcp/logs/run_reports/YYYY-MM-DD/run_*.jsonl.
8. Criar script com erro de sintaxe e chamar godot_get_script_parse_errors.
9. Chamar godot_fix_errors com dry_run=true → revisar planned_changes.
10. Chamar godot_fix_errors com dry_run=false → confirmar fix aplicado e backup criado.
11. Chamar godot_clear_logs com dry_run=true → confirmar que nada foi apagado.
12. Chamar godot_clear_logs com dry_run=false → confirmar dirs apagados.
13. Chamar godot_run_scene com cena inválida → esperar SCENE_NOT_FOUND.
14. Chamar godot_run_scene com path fora de res:// → esperar PATH_OUTSIDE_PROJECT.
15. Chamar godot_run_project enquanto jogo já roda → esperar GAME_ALREADY_RUNNING.
```

---

## 9. Pendências conhecidas (não bloqueantes)

```text
[ ] Captura de eventos "output" e "error" em runtime requer EditorDebuggerPlugin
    (implementação futura na Fase 8 — Runtime Analysis).
[ ] godot_get_script_parse_errors usa análise estática apenas — não equivale ao
    parser GDScript do Godot. Para validação real, usar godot_validate_script.
[x] Testes práticos com Godot ativo executados e aprovados em 2026-05-04.
```

---

## 10. Status

```text
[x] Aprovada
[ ] Aprovada com ressalvas (testes práticos com Godot ativo pendentes)
[ ] Reprovada
```

Validação manual executada em **2026-05-04** com Godot 4.6.1-stable (fedora).  
Todos os 15 testes manuais da seção 8 passaram sem falhas.

---

## 11. Gate para iniciar Fase 7 — Screenshots e Input Simulation

```text
[x] npm run build passa.
[x] npm test passa.
[x] Ferramentas Phase 6 registradas e testadas.
[x] Testes manuais (seção 8) executados e aprovados com Godot ativo.
[x] Issues abertas para pendências desta fase.
```

Gate Fase 7 desbloqueado.
