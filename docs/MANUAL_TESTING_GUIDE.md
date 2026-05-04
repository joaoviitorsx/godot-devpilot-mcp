# Manual Testing Guide — Godot DevPilot MCP

Guia consolidado para executar manualmente todos os fluxos que requerem sessão Godot ativa.

Cobre: Fases 1, 4, 5, 6, 7, 8. Fases 0, 2, 3 são validadas por análise estática + suíte TypeScript.

---

## 1. Pré-requisitos

```text
- Godot 4.3+ instalado (binário godot ou godot4 no PATH)
- Node.js 18+ instalado
- Repo do projeto clonado em /caminho/para/godot-devpilot-mcp
```

Build do servidor MCP:

```bash
cd /caminho/para/godot-devpilot-mcp/mcp-server
npm install
npm run build
npm test
```

Esperado: `npm test` passa **230/230** (ou superior conforme novas fases).

---

## 2. Iniciar ambiente de validação

### 2.1 Abrir projeto Godot com plugin ativo

```bash
cd /caminho/para/godot-devpilot-mcp
godot --editor --path .
```

No editor:
1. `Project > Project Settings > Plugins`
2. Ativar `Godot DevPilot MCP`
3. Confirmar console: `[Godot DevPilot MCP] WebSocket listening on 127.0.0.1:6505`

### 2.2 Iniciar servidor MCP em terminal separado

```bash
cd /caminho/para/godot-devpilot-mcp/mcp-server
GODOT_MCP_READ_ONLY=false GODOT_MCP_PROJECT_ROOT=/caminho/para/godot-devpilot-mcp npm run dev
```

> **CRÍTICO — sempre defina `GODOT_MCP_PROJECT_ROOT` como path absoluto contendo `project.godot`.**  
> Sem essa variável, o servidor usa `process.cwd()`. Quando lançado via Claude Desktop, o cwd costuma ser o diretório `$HOME` — `res://` resolveria para o home dir e `godot_search_files` exporia arquivos pessoais.  
> A partir desta versão o servidor falha imediatamente com `FATAL: invalid project root` se o diretório não contiver `project.godot`. Confira a primeira linha do stderr ao iniciar:
> ```
> [Godot DevPilot MCP] project root: /caminho/absoluto/para/projeto
> ```

### 2.3 Conectar cliente MCP

Use Claude Desktop, Claude Code ou outro cliente MCP. Adicione ao config:

```json
{
  "mcpServers": {
    "godot-devpilot": {
      "command": "node",
      "args": ["/caminho/para/godot-devpilot-mcp/mcp-server/dist/index.js"],
      "env": {
        "GODOT_MCP_READ_ONLY": "false",
        "GODOT_MCP_PROJECT_ROOT": "/caminho/para/godot-devpilot-mcp"
      }
    }
  }
}
```

### 2.4 Sanity check

Pelo cliente MCP execute:

```text
godot_health_check       → ok=true, plugin connected
godot_get_capabilities   → data.features.json_rpc=true, debug_loop=true, screenshots=true,
                           input_simulation=true, runtime_tree=true,
                           project_intelligence=true, project_memory=true
                           E também data.plugin.features.* idem (capabilities reportadas pelo plugin)
godot_get_project_info   → retorna nome, path, godot_version
```

> Antes da correção, `data.features.screenshots/input_simulation/runtime_tree` retornava `false` mesmo com Fases 7/8 ativas — apenas `data.plugin.features.*` refletia a verdade. Agora ambos batem.

Se algum falhar com `GODOT_NOT_CONNECTED`, verifique passos 2.1 e 2.2.

---

## 3. Fluxo Fase 1 — Core MCP

```text
[ ] godot_health_check          → ok=true, plugin_version, godot_version preenchidos
[ ] godot_ping                  → pong=true
[ ] godot_get_protocol_version  → protocol_version="1.0.0"
[ ] godot_get_connection_status → connected=true, port=6505
[ ] Parar plugin (desativar) e chamar godot_health_check → GODOT_NOT_CONNECTED
[ ] Reativar plugin → godot_health_check volta a ok=true
```

---

## 4. Fluxo Fase 4 — Cenas, nós, UndoRedo

### 4.1 Criação básica

```text
[ ] godot_create_scene {scene_path:"res://scenes/TestPhase4.tscn", root_node_type:"Node2D", root_node_name:"TestRoot"}
[ ] godot_open_scene {scene_path:"res://scenes/TestPhase4.tscn"}
[ ] godot_add_node {parent_path:".", type:"CharacterBody2D", name:"Player"}
[ ] godot_add_node {parent_path:"Player", type:"Sprite2D", name:"Sprite2D"}
[ ] godot_set_node_property {node_path:"Player", property:"position", value:{x:100,y:200}}
[ ] godot_rename_node {node_path:"Player/Sprite2D", new_name:"PlayerSprite"}
[ ] godot_duplicate_node {node_path:"Player/PlayerSprite"}
[ ] godot_reparent_node {node_path:"Player/PlayerSprite2", new_parent_path:"."}
[ ] godot_add_node_to_group {node_path:"Player", group:"players"}
[ ] godot_get_node_groups {node_path:"Player"} → contém "players"
[ ] godot_get_node_properties {node_path:"Player"} → position={100,200}
[ ] godot_get_scene_tree → árvore coerente
[ ] godot_save_scene
[ ] godot_validate_scene {scene_path:"res://scenes/TestPhase4.tscn"}
[ ] godot_audit_scene {scene_path:"res://scenes/TestPhase4.tscn"} → errors=0
```

### 4.2 UndoRedo GUI (CRÍTICO — só validável visualmente)

```text
[ ] No editor com TestPhase4.tscn aberta:
[ ] godot_add_node {parent_path:".", type:"Node2D", name:"UndoTest"}
[ ] Confirmar UndoTest visível no SceneTree dock
[ ] Pressionar Ctrl+Z → UndoTest desaparece
[ ] Pressionar Ctrl+Y → UndoTest reaparece
[ ] godot_set_node_property {node_path:"UndoTest", property:"position", value:{x:50,y:50}}
[ ] Pressionar Ctrl+Z → position volta ao valor anterior
```

### 4.3 Negativos

```text
[ ] godot_create_scene {scene_path:"../bad.tscn"} → PATH_OUTSIDE_PROJECT
[ ] godot_add_node {parent_path:".", type:"CharactrBody2D"} → INVALID_NODE_TYPE
[ ] godot_set_node_property {node_path:"Player", property:"propriedade_inexistente", value:true} → INVALID_PROPERTY
[ ] dry_run=true em qualquer mutação → planned_changes retornado, nada altera
```

---

## 5. Fluxo Fase 5 — Scripts e GDScript

### 5.1 Criação e validação

```text
[ ] godot_create_script {path:"res://scripts/Player.gd", extends:"CharacterBody2D"}
[ ] godot_read_script {path:"res://scripts/Player.gd"} → conteúdo retornado
[ ] godot_validate_script {path:"res://scripts/Player.gd"} → valid=true
[ ] godot_attach_script {node_path:"Player", script_path:"res://scripts/Player.gd"}
[ ] godot_save_scene
[ ] Reabrir cena → Player tem ícone de script anexado
```

### 5.2 Patch + backup

```text
[ ] godot_patch_script {path:"res://scripts/Player.gd", old_content:"extends CharacterBody2D\n", new_content:"extends CharacterBody2D\n\n@export var speed: float = 200.0\n"}
[ ] Confirmar arquivo .godot_mcp/backups/YYYY-MM-DD/scripts/Player.gd.<time>.bak existe
[ ] godot_validate_script novamente → valid=true
```

### 5.3 Erros e símbolos

```text
[ ] Criar res://scripts/Invalid.gd com "func _ready()\n\tprint(1)\n" (sem dois-pontos)
[ ] godot_validate_script {path:"res://scripts/Invalid.gd"} → valid=false, errors[].line=3
[ ] godot_get_script_symbols {path:"res://scripts/Player.gd"} → exports inclui "speed"
[ ] godot_get_script_dependencies {path:"res://scripts/Player.gd"} → array (pode estar vazio)
[ ] godot_find_references {query:"speed", root:"res://scripts"} → encontra ocorrência
[ ] godot_get_classdb_info {class_name:"CharacterBody2D"} → retorna methods/properties
[ ] godot_format_script {path:"res://scripts/Player.gd", dry_run:true}
    → planned_changes preenchido se houver alterações, vazio se já está formatado
[ ] Editar Player.gd manualmente adicionando trailing whitespace e CRLF, então:
[ ] godot_format_script {path:"res://scripts/Player.gd", dry_run:false}
    → changed=true, backup_path criado em .godot_mcp/backups/
[ ] godot_format_script novamente → changed=false (idempotente)
```

### 5.4 Negativos

```text
[ ] godot_read_script {path:"res://.env"} → SENSITIVE_FILE_BLOCKED
[ ] godot_attach_script {node_path:"Player", script_path:"res://nope.gd"} → SCRIPT_NOT_FOUND
[ ] godot_patch_script com old_content que não existe → PATCH_CONTENT_NOT_FOUND
```

---

## 6. Fluxo Fase 6 — Debug Loop

### 6.1 Run / stop

```text
[ ] godot_is_game_running → running=false
[ ] godot_run_project → running=true, log_path preenchido
[ ] Confirmar janela do jogo abriu
[ ] godot_is_game_running → running=true
[ ] godot_run_project novamente → GAME_ALREADY_RUNNING
[ ] godot_stop_project → running=false
[ ] Confirmar janela do jogo fechou
[ ] godot_run_scene {scene_path:"res://scenes/TestPhase4.tscn"} → custom_scene
[ ] godot_stop_project
```

### 6.2 Logs

```text
[ ] Confirmar arquivo .godot_mcp/logs/run_reports/YYYY-MM-DD/run_*.jsonl criado
[ ] godot_get_output_logs → eventos start e stop retornados
[ ] godot_get_last_run_report → started_at, stopped_at preenchidos, error_count=0
[ ] godot_assert_no_errors → ok=true, has_errors=false
[ ] godot_get_debugger_errors → array vazio (sem erros)
```

### 6.3 Parse errors + fix

```text
[ ] godot_get_script_parse_errors {path:"res://scripts/Invalid.gd"} → error_count > 0
[ ] godot_fix_errors {path:"res://scripts/Invalid.gd", dry_run:true} → planned_changes preenchido
[ ] godot_fix_errors {path:"res://scripts/Invalid.gd", dry_run:false} → applied > 0
[ ] Confirmar backup criado em .godot_mcp/backups/
[ ] godot_get_script_parse_errors {path:"res://scripts/Invalid.gd"} → error_count=0
```

### 6.4 Clear logs

```text
[ ] godot_clear_logs {dry_run:true} → planned_changes preenchido, dirs intactos
[ ] godot_clear_logs {dry_run:false} → dirs apagados
[ ] godot_get_last_run_report → found=false
```

### 6.5 Negativos

```text
[ ] godot_run_scene {scene_path:"res://nope.tscn"} → SCENE_NOT_FOUND
[ ] godot_run_scene {scene_path:"/etc/passwd"} → PATH_OUTSIDE_PROJECT
[ ] godot_assert_no_errors sem reports → NO_RUN_REPORT
```

---

## 7. Fluxo Fase 7 — Screenshots e Input

### 7.1 Screenshots

```text
[ ] godot_take_editor_screenshot → PNG criado em .godot_mcp/screenshots/editor_*.png, width/height>0
[ ] godot_get_viewport_image → PNG criado, dimensões da viewport
[ ] godot_run_project, aguardar 2s
[ ] godot_take_game_screenshot → PNG criado
[ ] godot_take_game_screenshot novamente
[ ] godot_compare_screenshots {path_a:<primeiro>, path_b:<segundo>} → identical=false (frames diferem)
[ ] godot_compare_screenshots {path_a:<X>, path_b:<X>} → identical=true
[ ] godot_stop_project
[ ] godot_take_game_screenshot → RUNTIME_NOT_RUNNING
[ ] godot_take_editor_screenshot {output_path:"../bad.png"} → PATH_OUTSIDE_PROJECT
[ ] godot_take_editor_screenshot {output_path:"res://x.txt"} → INVALID_PARAMS
```

### 7.2 Input simulation (requer Input Map com "jump")

```text
[ ] godot_add_input_action {action_name:"jump", deadzone:0.5}
[ ] godot_run_project
[ ] godot_press_action {action:"jump", duration_ms:300} → success
[ ] Verificar visualmente que o jogo recebeu o input
[ ] godot_press_action {action:"acao_inexistente"} → INPUT_ACTION_NOT_FOUND
[ ] godot_tap_key {keycode:"Space"} → success
[ ] godot_press_key {keycode:"Tecla_Inexistente"} → INVALID_KEYCODE
[ ] godot_mouse_click {x:400, y:300} → success
[ ] godot_mouse_drag {from_x:100, from_y:100, to_x:200, to_y:200} → success
[ ] godot_run_input_sequence com sequência mista → events_executed=N
[ ] godot_stop_project
[ ] godot_press_action {action:"jump"} → RUNTIME_NOT_RUNNING
```

---

## 8. Fluxo Fase 8 — Runtime Analysis

> Requer jogo rodando. Execute `godot_run_project` antes de qualquer tool de runtime.  
> Cena `TestPhase4.tscn` tem `Player` (CharacterBody2D) no grupo `players` — use-a para esses testes.

### 8.1 Inspeção básica

```text
[ ] godot_run_project → ok=true, janela do jogo abre
[ ] godot_get_runtime_tree → root presente, tree não vazia
[ ] godot_get_runtime_tree {max_depth:2, include_properties:true}
    → nodes com properties incluídas
[ ] godot_get_fps → fps > 0, running=true
[ ] godot_get_process_stats → object_count > 0, node_count > 0
```

### 8.2 Propriedades de node em runtime

```text
[ ] godot_get_runtime_node_properties {node_path:"Player"}
    → properties inclui position, velocity ou equivalente
[ ] godot_get_runtime_node_properties {node_path:"Player", properties:["position"]}
    → retorna apenas position
[ ] godot_set_runtime_node_property {node_path:"Player", property:"position", value:{x:0,y:0}}
    → ok=true
[ ] godot_get_runtime_node_properties {node_path:"Player", properties:["position"]}
    → position = {x:0, y:0} (confirmar mutação aplicada)
```

### 8.3 Busca de nodes e câmera

```text
[ ] godot_find_runtime_node {type:"CharacterBody2D"} → encontra Player
[ ] godot_find_runtime_node {group:"players"} → encontra Player
[ ] godot_get_current_camera → retorna Camera2D ou Camera3D (se cena tiver câmera)
```

### 8.4 UI elements

```text
[ ] godot_find_ui_element {text:"Start"} → encontra botão se existir na cena;
    caso não exista, retorna UI_ELEMENT_NOT_FOUND (esperado para TestPhase4)
[ ] godot_click_ui_by_text {text:"Start"} → idem (success ou UI_ELEMENT_NOT_FOUND)
```

### 8.5 Wait for condition

```text
[ ] godot_wait_for_condition {node_path:"Player", property:"position",
    expected_value:{x:0,y:0}, timeout_ms:1000}
    → matched=true (position já foi setada para {0,0} no 8.2)
[ ] godot_wait_for_condition {node_path:"Player", property:"position",
    expected_value:{x:9999,y:9999}, timeout_ms:500}
    → WAIT_TIMEOUT (posição nunca atinge esse valor)
```

### 8.6 Negativos e read-only

```text
[ ] godot_get_runtime_tree sem jogo rodando → RUNTIME_NOT_RUNNING
[ ] godot_find_runtime_node sem filtros (sem type e sem group) → INVALID_PARAMS
[ ] godot_find_ui_element sem parâmetros → INVALID_PARAMS
[ ] godot_get_runtime_node_properties {node_path:"NaoExiste"} → NODE_NOT_FOUND
[ ] godot_set_runtime_node_property {node_path:"Player", property:"prop_inexistente", value:0}
    → INVALID_PROPERTY
[ ] Em modo read-only:
    godot_set_runtime_node_property → READ_ONLY_MODE
    godot_click_ui_by_text → READ_ONLY_MODE
[ ] godot_get_fps e godot_get_process_stats → ok=true em read-only (leitura)
```

### 8.7 Cleanup

```text
[ ] godot_stop_project → ok=true
[ ] godot_get_runtime_tree → RUNTIME_NOT_RUNNING (confirmar gate encerrado)
```

---

## 9. Verificação de read-only mode

Reinicie o servidor com:

```bash
GODOT_MCP_READ_ONLY=true GODOT_MCP_PROJECT_ROOT=/caminho/para/godot-devpilot-mcp npm run dev
```

```text
[ ] godot_get_project_info → ok=true (read-only allowed)
[ ] godot_get_scene_tree → ok=true
[ ] godot_compare_screenshots → ok=true
[ ] godot_create_scene → READ_ONLY_MODE
[ ] godot_add_node → READ_ONLY_MODE
[ ] godot_create_script → READ_ONLY_MODE
[ ] godot_run_project → READ_ONLY_MODE
[ ] godot_take_game_screenshot → READ_ONLY_MODE
[ ] godot_press_action → READ_ONLY_MODE
[ ] godot_fix_errors {dry_run:false} → READ_ONLY_MODE
```

---

### 9.1 Sandbox de filesystem (regressão CRÍTICA)

```text
[ ] Iniciar servidor SEM GODOT_MCP_PROJECT_ROOT em diretório sem project.godot
    → servidor falha com FATAL: invalid project root e exit code 1
[ ] godot_search_files {pattern:"", root:"res://"} dentro do projeto válido
    → resultados ficam restritos ao projectRoot, NÃO listam $HOME/.bash_history,
      .Xauthority, caches de browser, etc.
[ ] godot_search_files {pattern:".env", root:"res://"} → não retorna .env do home
[ ] godot_read_script {path:"res://../../etc/passwd"} → PATH_OUTSIDE_PROJECT
[ ] godot_read_script {path:"res://.env"} → SENSITIVE_FILE_BLOCKED
```

---

## 10. Reportar resultados

Após executar todos os fluxos, marcar status nos relatórios:

```text
docs/PHASE_4_VALIDATION.md      seção 8.7
docs/PHASE_5_VALIDATION.md      seção 9.9
docs/PHASE_6_VALIDATION.md      seção 8
docs/PHASE_7_VALIDATION.md      seção 9
docs/PHASE_8_VALIDATION.md      seção 8
```

E fechar issues correspondentes em `docs/OPEN_ISSUES.md`:

```text
ISSUE-001 — UndoRedo GUI (Fase 4)
ISSUE-002 — Suíte tests/godot/*.gd (Fases 1-5)
ISSUE-003 — Fluxo integrado 0–5
ISSUE-004 — godot_get_godot_version dedicada (Fase 3)
ISSUE-005 — Backup save_scene scene_path implícito (Fase 4)
ISSUE-006 — Robustecer dependencies + references (Fase 5)
ISSUE-007 — Fluxo Fase 6
ISSUE-008 — Fluxo Fase 7
ISSUE-009 — Pixel-aware screenshot diff (Fase 7)
ISSUE-010 — Captura precisa do viewport do jogo (Fase 7)
ISSUE-011 — Fluxo Fase 8
ISSUE-012 — Indexar signals via código GDScript (Fase 9)
ISSUE-013 — trace_flow com BFS (Fase 9)
ISSUE-014 — Convention rules customizadas (Fases 9–10)
ISSUE-015 — Fluxo Fase 11
ISSUE-016 — Toolkit 2D faltantes
```

> Fluxo manual Fase 11 (Toolkits 2D) está em `docs/PHASE_11_VALIDATION.md` (ISSUE-015).

---

## 11. Resolução de problemas

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `GODOT_NOT_CONNECTED` | Plugin não ativo ou porta diferente | Reativar plugin, verificar `GODOT_MCP_PORT` |
| `READ_ONLY_MODE` | Servidor iniciou em read-only | `GODOT_MCP_READ_ONLY=false` |
| `PATH_OUTSIDE_PROJECT` | path fora de res:// | Usar res:// path |
| `EDITOR_NOT_AVAILABLE` | Plugin rodando headless | Abrir editor gráfico |
| `RUNTIME_NOT_RUNNING` | Jogo não está em execução | `godot_run_project` antes |
| `NODE_NOT_FOUND` | node_path inválido em runtime | Confirmar path com `godot_get_runtime_tree` |
| `WAIT_TIMEOUT` | Condição não atingida no timeout | Aumentar `timeout_ms` ou checar lógica do jogo |
| `NO_CAMERA` | Nenhuma câmera ativa na cena | Adicionar Camera2D/3D à cena |
| `UI_ELEMENT_NOT_FOUND` | Control com texto não existe | Confirmar cena tem Label/Button com esse texto |
| Screenshot vazio | Viewport não acessível | Confirmar editor visível na tela |
| Input não chega ao jogo | Foco em outra janela | Clicar na janela do jogo |
