# Validação da Fase 15 — Ferramentas Agentic

Projeto: **Godot DevPilot MCP**  
Fase: **15 — Ferramentas agentic**  
Data: 2026-05-04  
Escopo: **completa (10 ferramentas)** orquestradoras compostas.

---

## 1. Objetivo

Compor múltiplas fases (4–13) em sequências dirigidas por intenção: build_feature, refactor_safely, run_validation_loop, etc.

Cada tool agentic:
- Default `dry_run=true` retorna **plano de passos** (`planned_changes`) sem mutação.
- `dry_run=false` orquestra chamadas RPC/server-side reusando tools existentes.
- Tools sensíveis (refactor) **não auto-renomeiam** referências — retornam impacto + plano para edição manual.

---

## 2. Ferramentas implementadas (10)

```text
[x] godot_build_feature                  scene + script + nodes (kinds: scene_with_script | script_only | ui_panel)
[x] godot_create_gameplay_system         presets: player_2d, enemy_patrol_2d, collectible_swarm,
                                                   health_hud, third_person_3d
[x] godot_refactor_safely                rename_file | delete_file | rename_signal — impact_check
                                          + dry_run plan; nunca auto-edita referências
[x] godot_generate_scene_from_prompt     tags → nodes (player, enemy, hud, camera2d/3d, light, parallax)
[x] godot_create_playable_prototype      scene base + suggestion of next toolkit calls
[x] godot_run_validation_loop            run + sleep N ms + stop + report
[x] godot_create_game_jam_prototype      scene + WorldEnvironment + light(3d) + HUD opcional
[x] godot_explain_project_architecture   markdown report (summary + hubs + signals + memory notes)
[x] godot_prepare_release_checklist      8 checks + persist em .godot_mcp/reports/release_checklist.md
[x] godot_fix_errors_agentic             alias/wrapper — guia loop seguro p/ godot_fix_errors (Phase 6)
```

Arquivo: `mcp-server/src/tools/agenticTools.ts`.

---

## 3. Segurança

```text
[x] 8 ferramentas mutáveis bloqueadas em read-only.
[x] 2 read-only allowed: explain_project_architecture, fix_errors_agentic (apenas leitura/guia).
[x] dry_run=true por DEFAULT em todas tools que orquestram múltiplas mutações.
[x] refactor_safely NUNCA auto-renomeia referências (decisão consciente, não bug).
[x] Todas erram com VALIDATION_LOOP_STOP_FAILED se debug.stop_project falhar (run_validation_loop).
[x] Composição reusa tools existentes — herda toda segurança upstream (path sandbox, backup, UndoRedo).
```

---

## 4. Erros padronizados

```text
READ_ONLY_MODE                  # mutação em read-only
VALIDATION_LOOP_STOP_FAILED     # stop falhou em run_validation_loop
INVALID_PARAMS                  # filtros/tags inválidos
TOOL_EXECUTION_FAILED           # erro inesperado (toolWrapper genérico)
```

Resultados de plan steps preservam payload original do plugin (success ou error).

---

## 5. Testes automatizados

`tests/agenticTools.test.ts` — 14 testes:

```text
[x] build_feature dry_run by default
[x] build_feature script_only kind skips scene
[x] build_feature dry_run=false dispara scene.create + script.create
[x] gameplay_system health_hud preset adiciona CanvasLayer + Label
[x] gameplay_system collectible_swarm cria 5 markers
[x] refactor_safely impact reportado, applied=false
[x] refactor_safely dry_run=false ainda manual (note explicativa)
[x] generate_scene_from_prompt tags → planned_changes
[x] generate_scene_from_prompt 3d + light → DirectionalLight3D
[x] playable_prototype dry_run plan
[x] run_validation_loop chama run + stop
[x] run_validation_loop usa scene.run quando scene_path
[x] game_jam_prototype 3d inclui WorldEnvironment + light
[x] game_jam_prototype include_hud=false omite HUD
[x] explain_project_architecture retorna markdown (read-only allowed)
[x] prepare_release_checklist persist arquivo em .godot_mcp/reports/
[x] prepare_release_checklist write_report=false skip write
[x] fix_errors_agentic retorna recommended_loop (5 steps)
```

Total projeto: **29 files / 294 tests passing**.

---

## 6. Critério de aprovação

```text
[x] npm run build limpo
[x] npm test 294/294 passing
[x] 10 ferramentas Phase 15 registradas
[x] Composição reusa Phases 4–13
[x] dry_run default + read-only allowlist + sandbox propagado
[x] refactor_safely conservador (sem auto-rename)

[ ] Validação manual ponta-a-ponta (ISSUE-021)
```

---

## 7. Testes manuais sugeridos (Godot ativo)

```text
1. godot_build_feature {feature_name:"InventoryHUD", kind:"scene_with_script", dry_run:true}
   → revisar planned_changes (5 passos esperados).
2. godot_build_feature {dry_run:false} → confirmar arquivos criados + nó com script.
3. godot_create_gameplay_system {system:"health_hud", dry_run:false} → tree HUD/Root/HealthLabel.
4. godot_refactor_safely {change_type:"delete_file", target:"res://scripts/InventoryHUD.gd"}
   → impact + affected_files; nada deletado (manual).
5. godot_generate_scene_from_prompt {scene_name:"Lab", tags:["player","camera2d","hud"], dimension:"2d", dry_run:false}
   → cena Lab.tscn com Player + Camera2D + HUD.
6. godot_create_playable_prototype {name:"Demo", dimension:"2d", dry_run:false}
   → scene scaffold; rodar next_steps sugeridos.
7. godot_run_validation_loop {hold_ms:2000} → run + stop + report; godot_get_last_run_report.
8. godot_create_game_jam_prototype {name:"JamGame", dimension:"3d", dry_run:false}
   → scene + light + WorldEnvironment + HUD.
9. godot_explain_project_architecture → markdown com hubs e signal density.
10. godot_prepare_release_checklist → 8 checks; abrir .godot_mcp/reports/release_checklist.md.
11. godot_fix_errors_agentic → recommended_loop (5 passos).
```

---

## 8. Limitações conhecidas

```text
- refactor_safely NÃO auto-edita referências (decisão de segurança). Usar
  godot_patch_script + godot_validate_script per-file após revisar plano.
- generate_scene_from_prompt mapeia apenas tags conhecidas: player, enemy,
  camera2d, camera3d, light, hud, parallax. Tags desconhecidas são ignoradas.
- run_validation_loop espera tempo fixo (hold_ms); não detecta convergência.
  Para testes precisos use godot_wait_for_condition (Phase 8).
- prepare_release_checklist tem 8 checks built-in. Customização requer fork
  ou wrapper externo.
- Composições não têm rollback transacional. Falha mid-plan deixa estado
  parcial — recomenda-se revisar plan via dry_run antes.
```

---

## 9. Status

```text
[x] Aprovada (escopo completo: 10 ferramentas)
```

Gate Fase 16 (Release prep): liberado.
