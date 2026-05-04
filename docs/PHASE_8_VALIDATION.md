# Validação da Fase 8 — Runtime Analysis

Projeto: **Godot DevPilot MCP**  
Fase: **8 — Runtime Analysis**  
Data: 2026-05-04  
Dependências: Fases 0–7 aprovadas.

---

## 1. Objetivo

Permitir inspeção e mutação temporária do estado do jogo em runtime: árvore, propriedades, FPS, estatísticas, busca e localização de UI.

Fase 8 **não inclui**: profiling avançado, debugger remoto via rede, análise de memória detalhada (futuro).

---

## 2. Ferramentas implementadas (10)

```text
godot_get_runtime_tree
godot_get_runtime_node_properties
godot_set_runtime_node_property
godot_get_fps
godot_get_process_stats
godot_wait_for_condition
godot_find_runtime_node
godot_get_current_camera
godot_find_ui_element
godot_click_ui_by_text
```

Arquivos:
- `mcp-server/src/tools/runtimeTools.ts`
- `addons/godot_devpilot_mcp/tools/runtime_tools.gd`

---

## 3. Métodos JSON-RPC

```text
runtime.get_tree
runtime.get_node_properties
runtime.set_node_property
runtime.get_fps
runtime.get_process_stats
runtime.find_node
runtime.get_current_camera
runtime.find_ui_element
runtime.click_ui_by_text
```

Plugin: `runtime_tools.gd` recebe referência opcional para `input_tools` para suportar `click_ui_by_text` (composto: find + mouse_click).

---

## 4. Segurança

```text
[x] godot_get_runtime_tree                 read-only allowed
[x] godot_get_runtime_node_properties      read-only allowed
[x] godot_get_fps                          read-only allowed
[x] godot_get_process_stats                read-only allowed
[x] godot_wait_for_condition               read-only allowed (apenas leitura)
[x] godot_find_runtime_node                read-only allowed
[x] godot_get_current_camera               read-only allowed
[x] godot_find_ui_element                  read-only allowed
[x] godot_set_runtime_node_property        bloqueado em read-only
[x] godot_click_ui_by_text                 bloqueado em read-only
[x] Todos os métodos requerem game running → RUNTIME_NOT_RUNNING
[x] get_fps e get_process_stats funcionam mesmo no editor (retornam stats do editor)
[x] Todos retornam erros padronizados (NODE_NOT_FOUND, INVALID_PROPERTY, NO_CAMERA, etc.)
```

---

## 5. Erros padronizados

```text
RUNTIME_NOT_RUNNING        # jogo não está em execução
NODE_NOT_FOUND             # node_path inválido
INVALID_PROPERTY           # propriedade não existe no node
INVALID_PARAMS             # filtros de busca ausentes
NO_SCENE_OPEN              # nenhuma cena aberta no editor
NO_CAMERA                  # nenhuma Camera2D/3D ativa
WAIT_TIMEOUT               # condição não atingida em wait_for_condition
UI_ELEMENT_NOT_FOUND       # nenhum Control com texto solicitado
INPUT_TOOLS_UNAVAILABLE    # click_ui_by_text sem input_tools wired
EDITOR_NOT_AVAILABLE       # plugin headless
READ_ONLY_MODE             # ferramenta mutante em read-only
```

---

## 6. Testes automatizados

`tests/runtimeTools.test.ts` — 17 testes:

```text
[x] 7 read-only tools permitidos em read-only
[x] godot_set_runtime_node_property bloqueado em read-only
[x] godot_click_ui_by_text bloqueado em read-only
[x] get_runtime_tree delega com defaults max_depth=10, include_properties=false
[x] set_runtime_node_property delega
[x] get_fps delega
[x] find_runtime_node sem filtros → INVALID_PARAMS
[x] find_ui_element sem filtros → INVALID_PARAMS
[x] wait_for_condition retorna matched=true imediatamente quando valor já correto
[x] wait_for_condition retorna WAIT_TIMEOUT quando valor nunca casa
[x] wait_for_condition propaga erro de plugin
```

Total projeto: **24/24 files, 207/207 tests passing**.

---

## 7. Critério de aprovação

```text
[x] npm run build limpo
[x] npm test 207/207 passing
[x] 10 ferramentas Phase 8 registradas
[x] Plugin runtime_tools.gd integrado ao dispatcher
[x] Capabilities advertise runtime_tree=true
[x] read-only allowlist atualizado com 8 read-only runtime tools
[x] click_ui_by_text é composto (find + mouse_click via input_tools)

[ ] Testes manuais com Godot ativo (seção 8) pendentes
```

---

## 8. Testes manuais obrigatórios (Godot ativo)

```text
1. godot_run_project. Aguardar jogo rodar.
2. godot_get_runtime_tree → tree não vazia, root presente.
3. godot_get_runtime_node_properties {node_path:"Player"} → properties incluem position.
4. godot_set_runtime_node_property {node_path:"Player", property:"position", value:{x:0,y:0}} → success.
5. godot_get_fps → fps > 0, running=true.
6. godot_get_process_stats → object_count > 0.
7. godot_find_runtime_node {type:"CharacterBody2D"} → encontra Player.
8. godot_find_runtime_node {group:"players"} → encontra Player se em grupo.
9. godot_get_current_camera → retorna Camera2D ou Camera3D.
10. godot_find_ui_element {text:"Start"} → encontra botão se existir.
11. godot_click_ui_by_text {text:"Start"} → success se botão existe.
12. godot_wait_for_condition {node_path:"Player", property:"health", expected_value:100, timeout_ms:1000} → matched=true.
13. godot_stop_project. godot_get_runtime_tree → RUNTIME_NOT_RUNNING.
```

---

## 9. Pendências (não bloqueantes)

```text
[ ] Captura precisa de game viewport (resolver junto com Phase 7 ISSUE-010)
[ ] Profiling avançado (memória detalhada, hot-path, GPU stats) — futuro
[ ] Inspeção remota via rede (necessária para builds standalone) — futuro
[ ] wait_for_condition com Vector2/Vector3: deep equality falha int vs float.
    Workaround: usar propriedades escalares (bool, int) para condições confiáveis.
```

---

## 10. Status

```text
[x] Aprovada
```

Validação manual executada em **2026-05-04** com Godot 4.6.1-stable (fedora).  
Todos os 13 testes passaram. ISSUE-011 fechada. Gate Fase 9: liberado.
