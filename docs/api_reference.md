# API Reference — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento descreve a referência inicial da API de ferramentas do **Godot DevPilot MCP**.

Ele cobre:

- Convenções gerais;
- Formato de resposta;
- Códigos de erro;
- Categorias de ferramentas;
- Ferramentas por modo;
- Parâmetros comuns;
- Referência funcional das ferramentas principais;
- Contrato entre servidor MCP e plugin Godot.

Este documento deve ser atualizado sempre que uma ferramenta for adicionada, removida ou tiver schema alterado.

---

## 2. Convenções gerais

## 2.1 Prefixo das ferramentas

Todas as ferramentas públicas expostas via MCP usam o prefixo:

```text
godot_
```

Exemplos:

```text
godot_get_project_info
godot_read_file
godot_add_node
godot_validate_script
```

## 2.2 Formato de nomes

Usar snake_case.

```text
godot_take_game_screenshot
godot_get_runtime_tree
godot_create_gameplay_system
```

## 2.3 Tipos de ferramentas

```text
read      — apenas leitura
mutate    — altera arquivos, cenas, nós ou configurações
runtime   — executa ou inspeciona jogo em execução
analysis  — analisa estrutura do projeto
agentic   — coordena múltiplas ferramentas
```

---

## 3. Formato padrão de resposta

## 3.1 Sucesso

```json
{
  "ok": true,
  "data": {},
  "message": "Operação concluída com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

## 3.2 Erro

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mensagem clara do erro.",
    "details": {},
    "suggestions": []
  }
}
```

## 3.3 Campos

```text
ok          indica sucesso ou falha
data        dados retornados pela ferramenta
message     resumo legível
warnings    alertas não fatais
suggestions próximos passos sugeridos
error       objeto de erro padronizado
```

---

## 4. Códigos de erro

```text
GODOT_NOT_CONNECTED
TIMEOUT
INVALID_PARAMS
METHOD_NOT_FOUND
TOOL_NOT_AVAILABLE_IN_MODE
READ_ONLY_MODE
PERMISSION_DENIED
PATH_OUTSIDE_PROJECT
SENSITIVE_FILE_BLOCKED
FILE_NOT_FOUND
FILE_ALREADY_EXISTS
DIRECTORY_NOT_FOUND
BACKUP_FAILED
PATCH_FAILED
SCENE_NOT_OPEN
SCENE_LOAD_FAILED
SCENE_SAVE_FAILED
NODE_NOT_FOUND
NODE_ALREADY_EXISTS
INVALID_NODE_TYPE
INVALID_NODE_PATH
INVALID_PROPERTY
INVALID_PROPERTY_VALUE
SCRIPT_NOT_FOUND
SCRIPT_PARSE_ERROR
SCRIPT_ATTACH_FAILED
SIGNAL_NOT_FOUND
SIGNAL_ALREADY_CONNECTED
SIGNAL_CONNECTION_FAILED
RUNTIME_NOT_RUNNING
RUNTIME_ALREADY_RUNNING
SCREENSHOT_FAILED
INPUT_ACTION_NOT_FOUND
UNDO_FAILED
DRY_RUN_REQUIRED
CONFIRMATION_REQUIRED
AGENTIC_SCOPE_TOO_LARGE
UNKNOWN_ERROR
```

---

## 5. Parâmetros comuns

## 5.1 `dry_run`

Simula a operação sem aplicar alterações.

Tipo:

```text
boolean
```

Padrão:

```text
false
```

Obrigatório em ferramentas destrutivas ou agentic.

## 5.2 `confirm`

Confirma operação crítica.

Tipo:

```text
boolean
```

Padrão:

```text
false
```

Usado em exclusão, refatoração ampla e aplicação de ferramentas agentic.

## 5.3 `path`

Caminho de arquivo dentro do projeto.

Formato recomendado:

```text
res://scripts/Player.gd
```

## 5.4 `scene_path`

Caminho de cena.

Formato:

```text
res://scenes/Main.tscn
```

## 5.5 `node_path`

Caminho de nó dentro da cena.

Exemplos:

```text
.
Player
Player/Sprite2D
UI/HUD/HealthBar
```

---

## 6. Modos de ferramentas

## 6.1 Minimal

Ferramentas essenciais para leitura, edição básica e debug simples.

## 6.2 Core

Ferramentas recomendadas para desenvolvimento diário.

## 6.3 Full

Todas as ferramentas granulares e toolkits especializados.

## 6.4 Agentic

Ferramentas compostas de alto nível.

---

# 7. Core Tools

## `godot_health_check`

Verifica conexão com o plugin Godot.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "connected": true,
    "godot_version": "4.2.2",
    "plugin_version": "0.1.0",
    "protocol_version": "1.0.0"
  },
  "message": "Godot DevPilot MCP conectado.",
  "warnings": [],
  "suggestions": []
}
```

### Erros

```text
GODOT_NOT_CONNECTED
TIMEOUT
```

---

## `godot_get_capabilities`

Retorna capacidades disponíveis.

Tipo: `read`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "mode": "core",
    "tools_count": 64,
    "features": {
      "undo_redo": true,
      "screenshots": true,
      "input_simulation": true,
      "runtime_tree": false
    }
  },
  "message": "Capacidades obtidas.",
  "warnings": [],
  "suggestions": []
}
```

---

# 8. Project Tools

## `godot_get_project_info`

Retorna informações do projeto Godot.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "project_name": "MyGame",
    "project_path": "C:/Projects/MyGame",
    "main_scene": "res://scenes/Main.tscn",
    "godot_version": "4.2.2"
  },
  "message": "Informações do projeto obtidas.",
  "warnings": [],
  "suggestions": []
}
```

---

## `godot_get_editor_context`

Retorna contexto atual do editor.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "current_scene": "res://scenes/Main.tscn",
    "selected_nodes": ["Player"],
    "is_playing": false
  },
  "message": "Contexto do editor obtido.",
  "warnings": [],
  "suggestions": []
}
```

---

## `godot_get_input_map`

Lista ações do Input Map.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "include_builtin": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "actions": [
      {
        "name": "move_left",
        "events": ["A", "Left"]
      }
    ]
  },
  "message": "Input Map obtido.",
  "warnings": [],
  "suggestions": []
}
```

---

## `godot_add_input_action`

Cria ou atualiza uma ação no Input Map.

Tipo: `mutate`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "name": "move_left",
  "events": [
    { "type": "key", "key": "A" }
  ],
  "overwrite": false,
  "dry_run": false
}
```

### Segurança

```text
read-only: bloqueado
backup: recomendado para project settings
dry_run: suportado
log: obrigatório
```

---

# 9. File Tools

## `godot_list_files`

Lista arquivos do projeto.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "root": "res://",
  "extensions": [".gd", ".tscn"],
  "recursive": true,
  "limit": 100
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "files": [
      "res://scripts/Player.gd",
      "res://scenes/Main.tscn"
    ],
    "count": 2,
    "truncated": false
  },
  "message": "Arquivos listados.",
  "warnings": [],
  "suggestions": []
}
```

---

## `godot_search_files`

Busca arquivos por nome, extensão ou conteúdo.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "query": "player",
  "extensions": [".gd", ".tscn"],
  "search_content": false,
  "limit": 20
}
```

---

## `godot_read_file`

Lê arquivo do projeto.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "path": "res://scripts/Player.gd"
}
```

### Segurança

```text
path sandbox: obrigatório
arquivos sensíveis: bloqueados por padrão
```

---

## `godot_write_file`

Escreve conteúdo completo em arquivo.

Tipo: `mutate`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "content": "extends CharacterBody2D\n",
  "overwrite": false,
  "dry_run": false
}
```

### Segurança

```text
path sandbox: obrigatório
backup: obrigatório se arquivo existir
dry_run: suportado
overwrite: explícito
log: obrigatório
```

---

## `godot_patch_file`

Aplica substituição incremental.

Tipo: `mutate`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "old_text": "var speed = 200",
  "new_text": "var speed = 300",
  "replace_all": false,
  "dry_run": false
}
```

### Segurança

```text
backup: obrigatório
old_text: obrigatório
replace_all: explícito
dry_run: suportado
```

---

# 10. Scene Tools

## `godot_create_scene`

Cria nova cena.

Tipo: `mutate`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "scene_path": "res://scenes/Player.tscn",
  "root_type": "CharacterBody2D",
  "root_name": "Player",
  "overwrite": false,
  "dry_run": false
}
```

### Segurança

```text
ClassDB validation: obrigatório
backup: se sobrescrever
dry_run: suportado
path sandbox: obrigatório
```

---

## `godot_open_scene`

Abre cena existente.

Tipo: `read/mutate editor state`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "scene_path": "res://scenes/Main.tscn"
}
```

---

## `godot_save_scene`

Salva cena atual.

Tipo: `mutate`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "scene_path": null,
  "dry_run": false
}
```

### Segurança

```text
backup: obrigatório
dry_run: suportado
log: obrigatório
```

---

## `godot_get_scene_tree`

Retorna árvore da cena aberta.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "include_properties": false,
  "max_depth": 10
}
```

---

## `godot_audit_scene`

Audita uma cena carregável e retorna issues estruturais.

Tipo: `read/analysis`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "scene_path": "res://scenes/Main.tscn"
}
```

### Segurança

```text
path sandbox: obrigatório
somente leitura
```

---

# 11. Node Tools

## `godot_add_node`

Adiciona nó à cena aberta.

Tipo: `mutate`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "parent_path": ".",
  "type": "Sprite2D",
  "name": "PlayerSprite",
  "properties": {},
  "dry_run": false
}
```

### Segurança

```text
ClassDB validation: obrigatório
UndoRedo: obrigatório
dry_run: suportado
log: obrigatório
```

---

## `godot_remove_node`

Remove nó da cena aberta.

Tipo: `mutate`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "node_path": "Enemy",
  "dry_run": false,
  "confirm": false
}
```

### Segurança

```text
UndoRedo: obrigatório
root node: exige confirm
dry_run: suportado
log: obrigatório
```

---

## `godot_set_node_property`

Define propriedade de nó.

Tipo: `mutate`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "node_path": "Player/Sprite2D",
  "property": "visible",
  "value": true,
  "dry_run": false
}
```

### Segurança

```text
validar propriedade: obrigatório
converter valor: obrigatório
UndoRedo: obrigatório
```

---

# 12. Script Tools

## `godot_create_script`

Cria script GDScript.

Tipo: `mutate`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "extends": "CharacterBody2D",
  "content": "extends CharacterBody2D\n",
  "overwrite": false,
  "dry_run": false
}
```

### Segurança

```text
path sandbox: obrigatório
backup: se sobrescrever
Godot 4 syntax: recomendado
```

---

## `godot_attach_script`

Anexa script a nó.

Tipo: `mutate`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "node_path": "Player",
  "script_path": "res://scripts/Player.gd",
  "dry_run": false
}
```

### Segurança

```text
validar nó: obrigatório
validar script: obrigatório
UndoRedo: obrigatório
```

---

## `godot_validate_script`

Valida script GDScript.

Tipo: `read/analysis`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "godot_version_target": "4.x"
}
```

---

## `godot_read_script`

Lê um script GDScript.

Tipo: `read`

### Entrada

```json
{
  "path": "res://scripts/Player.gd"
}
```

### Segurança

```text
path sandbox: obrigatório
arquivos sensíveis: bloqueados
somente .gd
```

---

## `godot_patch_script`

Aplica patch textual exato em um script.

Tipo: `mutate`

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "old_content": "var speed = 100",
  "new_content": "var speed = 200",
  "dry_run": false
}
```

### Segurança

```text
backup: obrigatório
dry_run: suportado
path sandbox: obrigatório
```

---

## `godot_get_classdb_info`

Consulta informações de uma classe Godot.

Tipo: `read`

### Entrada

```json
{
  "class_name": "CharacterBody2D"
}
```

---

## `godot_get_script_symbols`

Extrai símbolos básicos de um script.

Tipo: `read/analysis`

### Entrada

```json
{
  "path": "res://scripts/Player.gd"
}
```

---

## `godot_get_script_dependencies`

Extrai dependências `res://` de `preload`, `load` e `extends`.

Tipo: `read/analysis`

### Entrada

```json
{
  "path": "res://scripts/Enemy.gd"
}
```

---

## `godot_find_references`

Busca referências textuais em scripts.

Tipo: `read/analysis`

### Entrada

```json
{
  "query": "Player",
  "root": "res://scripts",
  "limit": 100
}
```

---

## `godot_format_script`

Aplica formatação conservadora em um script.

Tipo: `mutate`

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "dry_run": false
}
```

### Segurança

```text
backup: obrigatório
dry_run: suportado
path sandbox: obrigatório
```

---

# 13. Runtime and Debug Tools

## `godot_run_project`

Executa o projeto.

Tipo: `runtime`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "debug": true
}
```

---

## `godot_run_scene`

Executa cena específica ou cena atual.

Tipo: `runtime`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "scene_path": "res://scenes/Main.tscn",
  "debug": true
}
```

---

## `godot_stop_project`

Para execução do projeto.

Tipo: `runtime`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{}
```

---

## `godot_get_output_logs`

Retorna logs recentes.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "limit": 100,
  "severity": "all"
}
```

---

## `godot_get_debugger_errors`

Retorna erros do debugger.

Tipo: `read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "limit": 50
}
```

---

## `godot_get_runtime_tree`

Retorna árvore do jogo em execução.

Tipo: `runtime/read`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "max_depth": 10,
  "include_properties": false
}
```

### Erros

```text
RUNTIME_NOT_RUNNING
```

---

# 14. Screenshot Tools

## `godot_take_game_screenshot`

Captura screenshot do jogo.

Tipo: `runtime/read`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "output_path": ".godot_mcp/screenshots/game_latest.png"
}
```

### Segurança

```text
salvar dentro de .godot_mcp/screenshots
não capturar janelas externas quando possível
```

---

## `godot_take_editor_screenshot`

Captura screenshot do editor.

Tipo: `read`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "output_path": ".godot_mcp/screenshots/editor_latest.png"
}
```

---

# 15. Input Tools

## `godot_press_action`

Pressiona uma ação do Input Map.

Tipo: `runtime`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "action": "move_right",
  "duration_ms": 500
}
```

### Erros

```text
INPUT_ACTION_NOT_FOUND
RUNTIME_NOT_RUNNING
```

---

## `godot_run_input_sequence`

Executa sequência de inputs.

Tipo: `runtime`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "sequence": [
    {
      "type": "action_press",
      "action": "move_right",
      "duration_ms": 1000
    }
  ]
}
```

---

# 16. Signal Tools

## `godot_get_signal_connections`

Lista conexões de sinais.

Tipo: `read/analysis`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "node_path": "Player",
  "include_inherited": false
}
```

---

## `godot_connect_signal`

Conecta sinal.

Tipo: `mutate`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "source_node_path": "Button",
  "signal": "pressed",
  "target_node_path": "UIManager",
  "method": "_on_start_button_pressed",
  "dry_run": false
}
```

### Segurança

```text
validar source: obrigatório
validar signal: obrigatório
validar target: obrigatório
UndoRedo: obrigatório quando possível
```

---

# 17. Project Intelligence Tools

## `godot_project_summary`

Retorna resumo estrutural do projeto.

Tipo: `analysis`

Modos: `minimal`, `core`, `full`, `agentic`

### Entrada

```json
{
  "refresh": false,
  "include_assets": false
}
```

---

## `godot_impact_check`

Analisa impacto de alteração planejada.

Tipo: `analysis`

Modos: `core`, `full`, `agentic`

### Entrada

```json
{
  "change_type": "rename_signal",
  "target": "health_changed",
  "new_value": "player_health_changed"
}
```

---

# 18. Agentic Tools

## `godot_fix_errors`

Planeja ou aplica correções para erros detectados.

Tipo: `agentic`

Modos: `agentic`

### Entrada

```json
{
  "scope": "current_scene",
  "dry_run": true,
  "max_files": 5
}
```

### Segurança

```text
dry_run: obrigatório inicialmente
backup: obrigatório ao aplicar
limite de arquivos: obrigatório
validação final: obrigatória
```

---

## `godot_build_feature`

Planeja ou implementa feature descrita em linguagem natural.

Tipo: `agentic`

Modos: `agentic`

### Entrada

```json
{
  "description": "Crie uma porta que abre quando o jogador coleta uma chave.",
  "target_scene": "res://scenes/Level01.tscn",
  "dry_run": true,
  "confirm": false
}
```

### Segurança

```text
dry_run: obrigatório inicialmente
confirm: obrigatório para aplicar
backup: obrigatório
relatório: obrigatório
```

---

## `godot_create_gameplay_system`

Cria sistema de gameplay baseado em tipo predefinido.

Tipo: `agentic`

Modos: `agentic`

### Entrada

```json
{
  "system_type": "health",
  "target_scene": "res://scenes/Player.tscn",
  "options": {
    "max_health": 100
  },
  "dry_run": true,
  "confirm": false
}
```

---

# 19. Contrato interno JSON-RPC

## 19.1 Request

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "method": "scene.add_node",
  "params": {}
}
```

## 19.2 Response

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "result": {
    "ok": true,
    "data": {},
    "message": "OK",
    "warnings": [],
    "suggestions": []
  }
}
```

## 19.3 Error

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "error": {
    "code": "METHOD_NOT_FOUND",
    "message": "Método não encontrado.",
    "details": {},
    "suggestions": []
  }
}
```

---

## 20. Critérios de estabilidade da API

Uma ferramenta é considerada estável quando:

```text
[ ] schema definido
[ ] resposta padronizada
[ ] erros documentados
[ ] segurança documentada
[ ] testes implementados
[ ] exemplo de uso criado
[ ] comportamento validado em projeto Godot real
```

---

## 21. Conclusão

Esta API Reference define o contrato inicial do Godot DevPilot MCP.

Durante a fase inicial, a API pode mudar rapidamente. A partir da versão 1.0, mudanças incompatíveis devem ser tratadas como breaking changes e registradas no changelog.
