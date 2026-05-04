# Open Issues — Godot DevPilot MCP

Pendências não bloqueantes registradas após validação consolidada das Fases 0 a 5.
Referência: `docs/PHASE_0_TO_5_VALIDATION_REPORT.md`.

---

## ISSUE-001 — Validar UndoRedo GUI (Ctrl+Z / Ctrl+Y) — RESOLVIDA 2026-05-04

**Fase:** 4  
**Tipo:** Validação manual  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim  
**Status:** Fechada

Executado em 2026-05-04 com Godot 4.6.1-stable + plugin ativo:
- `godot_add_node` {node_type:"Sprite2D", node_name:"TestUndo"} → Ctrl+Z removeu o nó. ✅
- `godot_set_node_property` {node_path:"TestUndo", property:"visible", value:false} → Ctrl+Z reverteu visible para true. ✅

---

## ISSUE-002 — Rodar suíte tests/godot/*.gd em ambiente Godot real — RESOLVIDA 2026-05-04

**Fase:** 1–5  
**Tipo:** Testes automatizados GDScript  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim  
**Status:** Fechada

Executados em 2026-05-04 com Godot 4.6.1-stable.fedora (headless):

```
phase4_test.gd              18/18 PASS
phase5_test.gd              14/14 PASS
project_tools_test.gd        9/9  PASS
project_tools_extended_test.gd 26/26 PASS
permissions_test.gd          exit 0 (sem erros)
```

Total: **67 testes GDScript — 0 falhas.**

---

## ISSUE-003 — Executar fluxo prático integrado Fases 0 a 5 via MCP + Godot real — RESOLVIDA 2026-05-04

**Fase:** 0–5  
**Tipo:** Teste de integração  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim  
**Status:** Fechada

Fluxo completo executado em 2026-05-04 com Godot 4.6.1-stable e servidor MCP conectado.

Resultados:
- health_check → ok=true. ✅
- Cena TestIntegrated05.tscn criada, script IntegratedTest.gd criado e anexado, nó TestSprite(Sprite2D) adicionado, cena salva com backup. ✅
- patch_script criou backup em `.godot_mcp/backups/2026-05-04/scripts/IntegratedTest.gd.203651.bak`. ✅
- `.godot_mcp/logs/actions.jsonl` confirmado presente. ✅
- Path traversal `res://../../../etc/passwd` → PATH_OUTSIDE_PROJECT rejeitado. ✅

---

## ISSUE-004 — Avaliar criação de godot_get_godot_version dedicada

**Fase:** 3  
**Tipo:** Decisão de design de API  
**Prioridade:** Média  
**Bloqueante para v1.0:** Não

A versão Godot já é retornada por `godot_get_project_info` e `godot_health_check`.

Avaliar se expor `godot_get_godot_version` como ferramenta autônoma é necessário para o contrato da Fase 3, ou se o dado já disponível é suficiente para os clientes MCP.

Decisão recomendada: expor como alias simples se qualquer cliente MCP precisar consultar a versão sem o restante de `project_info`.

---

## ISSUE-005 — Garantir backup em save_scene com scene_path implícito

**Fase:** 4  
**Tipo:** Segurança / melhoria  
**Prioridade:** Média  
**Bloqueante para v1.0:** Não

Atualmente, `godot_save_scene` sem `scene_path` explícito delega ao plugin, que salva a cena editada. O backup server-side depende de conhecer o `scene_path` antecipadamente.

Proposta: retornar o `scene_path` usado no payload de resposta do plugin e criar backup retroativo, ou exigir `scene_path` explícito para acionar backup.

---

## ISSUE-007 — Validar fluxo manual da Fase 6 (Debug Loop) com Godot ativo — RESOLVIDA 2026-05-04

**Fase:** 6  
**Tipo:** Validação manual  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim  
**Status:** Fechada

Todos os 15 testes manuais da seção 8 de `docs/PHASE_6_VALIDATION.md` executados e aprovados com Godot 4.6.1-stable em 2026-05-04. Gate para Fase 7 desbloqueado.

---

## ISSUE-008 — Validar fluxo manual da Fase 7 (Screenshots + Input) com Godot ativo — RESOLVIDA 2026-05-04

**Fase:** 7  
**Tipo:** Validação manual  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim

Todos os 20 testes manuais (seção 9.1 + 9.2) executados e aprovados em 2026-05-04 com Godot 4.6.1-stable.  
Bug encontrado e corrigido: `screenshot_tools.gd` — screen_get_image retorna null no Wayland; fallback para editor viewport aplicado. Gate para Fase 8 desbloqueado.

---

## ISSUE-009 — Pixel-aware screenshot diff

**Fase:** 7  
**Tipo:** Melhoria  
**Prioridade:** Baixa  
**Bloqueante para v1.0:** Não

`godot_compare_screenshots` faz diff byte-a-byte. Adicionar PNG decoder (ex.: `pngjs`) para diff por pixel + threshold de similaridade.

---

## ISSUE-010 — Captura precisa do viewport do jogo (não tela inteira)

**Fase:** 7 → resolver na Fase 8  
**Tipo:** Melhoria  
**Prioridade:** Média  
**Bloqueante para v1.0:** Não

`godot_take_game_screenshot` usa `DisplayServer.screen_get_image()` como baseline, capturando tela inteira. Captura precisa do viewport do jogo precisa de `EditorDebuggerPlugin` ou bridge runtime, planejado para Fase 8.

---

## ISSUE-011 — Validar manualmente Phase 8 (Runtime Analysis) com Godot ativo — RESOLVIDA 2026-05-04

**Fase:** 8  
**Tipo:** Validação manual  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim

Todos os 13 testes executados e aprovados em 2026-05-04 com Godot 4.6.1-stable.  
Limitação descoberta: `wait_for_condition` com Vector2 falha por comparação float vs int — documentada em §9.  
Gate para Fase 9: já liberado.

---

## ISSUE-012 — Indexar signals conectados via código GDScript

**Fase:** 9  
**Tipo:** Melhoria  
**Prioridade:** Média  
**Bloqueante para v1.0:** Não

Atual: `buildSignalMap` parseia apenas `[connection]` em .tscn. Connect() em runtime via GDScript não é capturado. Solução requer runtime introspection (Phase 8) ou parser AST GDScript.

---

## ISSUE-013 — trace_flow com BFS

**Fase:** 9  
**Tipo:** Melhoria  
**Prioridade:** Baixa  
**Bloqueante para v1.0:** Não

`trace_flow` usa DFS e pode perder o caminho mais curto. Substituir por BFS ou Dijkstra para garantir shortest path.

---

## ISSUE-014 — Convention rules customizadas

**Fase:** 9–10  
**Tipo:** Feature  
**Prioridade:** Média  
**Bloqueante para v1.0:** Não

`checkConventions` tem regras built-in. Adicionar mecanismo para ler regras de `.godot_mcp/memory/conventions.md` (Phase 10) e aplicá-las em `validate_conventions` (Phase 9).

---

## ISSUE-017 — Sandbox de filesystem: validar projectRoot ao iniciar (RESOLVIDO 2026-05-04)

**Fase:** 2 (Segurança)  
**Tipo:** Bug crítico de segurança  
**Prioridade:** Crítica  
**Status:** Corrigido

Quando `GODOT_MCP_PROJECT_ROOT` não era definido, `process.cwd()` virava o `projectRoot`. Lançado via Claude Desktop (cwd=$HOME), o `res://` resolvia para o home dir e `godot_search_files` expunha `.bash_history`, `.Xauthority`, caches de browser, etc.

**Correção aplicada:**
1. `loadConfig` agora normaliza `projectRoot` via `path.resolve()`.
2. Novo `validateProjectRoot()` em `src/config/config.ts` exige presença de `project.godot`.
3. `index.ts` chama `validateProjectRoot` no startup; falha com `process.exit(1)` se inválido.
4. `fileTools.searchFiles` aplica `path.resolve` antes de usar `projectRoot` no atalho `res://`.
5. `getModeCapabilities` agora reporta `screenshots/input_simulation/runtime_tree/debug_loop/project_intelligence/project_memory = true` (refletindo Fases 6–10).
6. 5 novos testes em `tests/config.test.ts` cobrem validação.

**Arquivos modificados:**
- `mcp-server/src/config/config.ts`
- `mcp-server/src/config/modes.ts`
- `mcp-server/src/index.ts`
- `mcp-server/src/tools/fileTools.ts`
- `mcp-server/tests/config.test.ts`
- `mcp-server/tests/modes.test.ts`

---

## ISSUE-015 — Validar manualmente Phase 11 baseline (Toolkits 2D) com Godot ativo — RESOLVIDA 2026-05-04

**Fase:** 11  
**Tipo:** Validação manual  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim

Em cena Godot aberta, executar:
- `godot_create_player_2d` → confirmar tree e script criados.
- `godot_create_enemy_2d` → patrol funciona.
- `godot_create_collectible_2d` → signal collected disparado.
- `godot_setup_camera_2d` → camera ativa.
- `godot_create_health_system` com attach_to=Player.

---

## ISSUE-016 — Completar Toolkits 2D (RESOLVIDA 2026-05-04)

**Fase:** 11  
**Tipo:** Feature  
**Prioridade:** Média  
**Status:** Fechada

5 ferramentas restantes implementadas em `toolkit2dTools.ts`:
- `godot_setup_collision_2d`
- `godot_setup_area_trigger_2d` (+ template AreaTrigger.gd)
- `godot_create_tilemap`
- `godot_setup_parallax_background` (configurable layer_count)
- `godot_create_inventory_ui` (+ template InventoryUI.gd com columns)

9 testes adicionais cobrem read-only, dry_run, orquestração RPC e geração de scripts.

---

## ISSUE-021 — Validar fluxo agentic ponta-a-ponta (Phase 15) com Godot ativo

**Fase:** 15  
**Tipo:** Validação manual  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim

Executar seção 7 de `docs/PHASE_15_VALIDATION.md`. 11 passos cobrindo build_feature, gameplay_system, refactor_safely, generate_scene_from_prompt, playable_prototype, run_validation_loop, game_jam_prototype, explain_project_architecture, prepare_release_checklist, fix_errors_agentic.

---

## ISSUE-022 — Validar demo projects ponta-a-ponta (Phase 16)

**Fase:** 16  
**Tipo:** Validação manual + integração  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim

Em ambos `examples/demo_2d_project/` e `examples/demo_3d_project/`:
1. Copiar/symlinkar `addons/godot_devpilot_mcp/` para o diretório do demo.
2. Abrir no editor Godot e ativar plugin.
3. Iniciar servidor MCP com `GODOT_MCP_PROJECT_ROOT` apontando para o demo.
4. Executar a sequência de tools no respectivo README.md.
5. Confirmar `godot_run_validation_loop` boot sem erros.
6. Anexar screenshots ao relatório de validação.

---

## ISSUE-023 — Validação cross-platform (macOS + Windows)

**Fase:** 16  
**Tipo:** QA / instalação  
**Prioridade:** Média  
**Bloqueante para v1.0:** Sim (ou documentar suporte explicitamente Linux-only para v1.0)

Atualmente validado em Linux Fedora + Godot 4.6.1. Validar:
- macOS (Apple Silicon + Intel): npm install + build + plugin loading + WebSocket.
- Windows: PowerShell + cmd npm install + path separators (`path.sep`) em `pathGuard`.

Pontos de atenção:
- `path.resolve` deve normalizar separators corretamente.
- `DisplayServer.screen_get_image()` testado em Linux/Wayland (fallback existe).
- Caminhos com espaços em macOS / Windows (`Application Support`, `Program Files`).

---

## ISSUE-020 — Validar manualmente Phase 13 (Toolkits especializados) com Godot ativo — RESOLVIDA 2026-05-04

**Fase:** 13  
**Tipo:** Validação manual  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim

Todos os 15 testes da seção 9 executados em 2026-05-04 com Godot 4.6.1-stable. Testes 5+13 retornam instruções (limitação Resource). Teste 15 pendente inspector (não-bloqueante).

---

## ISSUE-018 — Validar manualmente Phase 12 (Toolkits 3D) com Godot ativo — RESOLVIDA 2026-05-04

**Fase:** 12  
**Tipo:** Validação manual  
**Prioridade:** Alta  
**Bloqueante para v1.0:** Sim

Testes MCP (1+2+6+7+8) executados e aprovados em 2026-05-04. Testes 3+4+5 (inspector + runtime visual) pendentes não-bloqueantes.

---

## ISSUE-019 — Bug em addChildNode dos toolkits 2D/3D (RESOLVIDA 2026-05-04)

**Fase:** 11–12  
**Tipo:** Bug crítico  
**Prioridade:** Crítica  
**Status:** Corrigido

Helper `addChildNode` de `toolkit2dTools.ts` e `toolkit3dTools.ts` enviava campos `type`/`name` ao plugin, mas `node_tools.gd` espera `node_type`/`node_name`. Resultado: criação de nós via toolkits silenciosamente caía em defaults (Node + nome do tipo). Toolkits criariam só Nodes vazios em vez dos tipos solicitados.

**Correção:** ambos os helpers agora enviam `node_type` e `node_name`. Tests atualizados para verificar campos corretos.

---

## ISSUE-006 — Robustecer get_script_dependencies e find_references

**Fase:** 5  
**Tipo:** Melhoria  
**Prioridade:** Baixa  
**Bloqueante para v1.0:** Não

Implementação atual usa análise textual simples. Melhorias planejadas:
- Resolver paths relativos em `extends "..."`.
- Identificar dependências implícitas via `class_name`.
- Limitar resultados de `find_references` por tipo de símbolo.

---

*Atualizado em: 2026-05-04*
