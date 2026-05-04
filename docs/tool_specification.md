# Tool Specification — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento define a especificação inicial das ferramentas do **Godot DevPilot MCP**.

Ele descreve:

- Convenções de nomes;
- Formato de entrada e saída;
- Categorias de ferramentas;
- Modos de carregamento;
- Padrões de erro;
- Regras de segurança por ferramenta;
- Lista inicial de ferramentas planejadas;
- Especificação funcional das ferramentas prioritárias.

A intenção é servir como referência para implementação do servidor MCP e do plugin Godot.

---

## 2. Princípios de design das ferramentas

As ferramentas devem ser projetadas para serem previsíveis, seguras e úteis para modelos de IA.

## 2.1 Clareza

Cada ferramenta deve ter:

```text
- Nome explícito;
- Descrição objetiva;
- Schema de entrada restrito;
- Resposta estruturada;
- Erros acionáveis.
```

Exemplo bom:

```text
godot_add_node
```

Exemplo ruim:

```text
godot_do_action
```

## 2.2 Baixa ambiguidade

Ferramentas não devem depender de contexto oculto quando os parâmetros forem essenciais.

Exemplo:

```json
{
  "parent_path": ".",
  "type": "CharacterBody2D",
  "name": "Player"
}
```

É melhor do que:

```json
{
  "thing": "player"
}
```

## 2.3 Segurança por padrão

Ferramentas que alteram estado devem ter proteções.

Exemplos:

```text
- dry_run;
- backup;
- path sandbox;
- UndoRedo;
- confirmação para ações críticas;
- logs auditáveis.
```

## 2.4 Respostas úteis para IA

A resposta deve ajudar o modelo a decidir o próximo passo.

Uma ferramenta não deve retornar apenas:

```json
{
  "ok": false
}
```

Ela deve retornar:

```json
{
  "ok": false,
  "error": {
    "code": "SCENE_NOT_OPEN",
    "message": "Nenhuma cena está aberta no editor.",
    "details": {},
    "suggestions": [
      "Use godot_open_scene para abrir uma cena existente.",
      "Use godot_create_scene para criar uma nova cena."
    ]
  }
}
```

---

## 3. Convenção de nomes

## 3.1 Prefixo obrigatório

Todas as ferramentas MCP expostas ao cliente devem iniciar com:

```text
godot_
```

Exemplos:

```text
godot_get_project_info
godot_open_scene
godot_add_node
godot_validate_script
```

## 3.2 Padrão de verbo

Usar verbos claros:

```text
get
list
search
create
open
save
read
write
patch
add
remove
rename
duplicate
set
validate
audit
run
stop
take
press
release
build
analyze
trace
```

## 3.3 Padrão de domínio

O nome deve indicar o domínio.

Exemplos:

```text
godot_get_project_info
godot_read_file
godot_open_scene
godot_add_node
godot_validate_script
godot_get_signal_map
godot_take_game_screenshot
```

## 3.4 Nomes proibidos

Evitar nomes genéricos como:

```text
godot_execute
godot_action
godot_modify
godot_update
godot_manage
godot_process
```

Esses nomes dificultam a escolha correta pela IA.

---

## 4. Formato padrão de resposta

## 4.1 Sucesso

Toda ferramenta deve retornar uma resposta equivalente a:

```json
{
  "ok": true,
  "data": {},
  "message": "Operação concluída com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

Campos:

```text
ok          booleano indicando sucesso
data        objeto com dados úteis
message     resumo legível da operação
warnings    lista de alertas não fatais
suggestions lista de próximos passos ou melhorias
```

## 4.2 Erro

Formato padrão:

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

Campos:

```text
code        código estável para tratamento programático
message     descrição clara do erro
details     dados técnicos opcionais
suggestions ações recomendadas para correção
```

## 4.3 Warnings

Warnings devem ser usados quando a operação foi concluída, mas há algo a observar.

Exemplo:

```json
{
  "ok": true,
  "data": {
    "script_path": "res://scripts/Player.gd"
  },
  "message": "Script criado com sucesso.",
  "warnings": [
    "A ação move_right já existia no Input Map e não foi duplicada."
  ],
  "suggestions": [
    "Execute godot_validate_script para verificar sintaxe."
  ]
}
```

---

## 5. Códigos de erro padrão

Os códigos devem ser estáveis e reutilizáveis.

```text
GODOT_NOT_CONNECTED
TIMEOUT
INVALID_PARAMS
METHOD_NOT_FOUND
TOOL_NOT_AVAILABLE_IN_MODE
READ_ONLY_MODE
PERMISSION_DENIED
PATH_OUTSIDE_PROJECT
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
DRY_RUN_ONLY
UNKNOWN_ERROR
```

---

## 6. Parâmetros comuns

Alguns parâmetros devem seguir o mesmo padrão em todas as ferramentas.

## 6.1 `dry_run`

Indica que a ferramenta deve simular a operação sem aplicar alterações.

```json
{
  "dry_run": true
}
```

Obrigatório em ferramentas destrutivas ou de grande impacto.

## 6.2 `confirm`

Indica confirmação explícita para ações críticas.

```json
{
  "confirm": true
}
```

Deve ser exigido em:

```text
- delete_file_safe definitivo;
- operações em lote;
- refatorações amplas;
- sobrescrita de cena;
- limpeza de backups;
- exclusão de diretórios.
```

## 6.3 `path`

Caminhos de projeto devem usar preferencialmente `res://`.

Exemplo:

```json
{
  "path": "res://scripts/Player.gd"
}
```

O servidor deve bloquear caminhos fora do projeto.

## 6.4 `node_path`

Caminhos de nós devem ser relativos à cena aberta ou absolutos dentro da árvore da cena.

Exemplos:

```json
{
  "node_path": "Player/Sprite2D"
}
```

```json
{
  "node_path": "."
}
```

## 6.5 `scene_path`

Caminho de cena deve apontar para `.tscn` ou `.scn`.

Exemplo:

```json
{
  "scene_path": "res://scenes/Player.tscn"
}
```

---

## 7. Modos de ferramentas

O servidor MCP deve permitir carregar subconjuntos de ferramentas para evitar excesso de ferramentas em clientes MCP.

## 7.1 Minimal

Ferramentas essenciais.

Objetivo:

```text
Leitura, edição simples, execução e debug básico.
```

Ferramentas sugeridas:

```text
godot_health_check
godot_get_project_info
godot_list_files
godot_search_files
godot_read_file
godot_write_file
godot_open_scene
godot_save_scene
godot_get_scene_tree
godot_add_node
godot_remove_node
godot_set_node_property
godot_create_script
godot_attach_script
godot_run_project
godot_stop_project
godot_get_output_logs
godot_get_debugger_errors
godot_take_game_screenshot
godot_press_action
godot_release_action
godot_project_summary
```

## 7.2 Core

Modo recomendado para uso diário.

Inclui:

```text
- Project tools
- File tools
- Scene tools
- Node tools
- Script tools
- Runtime tools
- Debug tools
- Screenshot tools
- Input básico
- Signal básico
- Project summary
```

## 7.3 Full

Modo completo.

Inclui:

```text
- Todas as ferramentas granulares
- Toolkits 2D
- Toolkits 3D
- Física
- Animação
- Áudio
- Partículas
- Shaders
- Navegação
- Testes automatizados
- Project intelligence
```

## 7.4 Agentic

Modo com ferramentas compostas.

Inclui:

```text
godot_build_feature
godot_fix_errors
godot_create_gameplay_system
godot_refactor_safely
godot_generate_scene_from_prompt
godot_create_playable_prototype
godot_run_validation_loop
```

---

## 8. Categorias de ferramentas

```text
1. Core Tools
2. Project Tools
3. File Tools
4. Asset Tools
5. Scene Tools
6. Node Tools
7. Script Tools
8. Signal Tools
9. Runtime Tools
10. Debug Tools
11. Screenshot Tools
12. Input Tools
13. Test Tools
14. Project Intelligence Tools
15. Project Memory Tools
16. 2D Toolkit
17. 3D Toolkit
18. Physics Toolkit
19. Animation Toolkit
20. Audio Toolkit
21. Particles/VFX Toolkit
22. Shader/Material Toolkit
23. Navigation Toolkit
24. Agentic Tools
```

---

# 9. Especificação das ferramentas prioritárias

## 9.1 Core Tools

## `godot_health_check`

Verifica se o servidor MCP consegue se comunicar com o plugin Godot.

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
    "protocol_version": "1.0.0",
    "project_path": "res://"
  },
  "message": "Godot DevPilot MCP conectado.",
  "warnings": [],
  "suggestions": []
}
```

### Erros possíveis

```text
GODOT_NOT_CONNECTED
TIMEOUT
```

### Segurança

Somente leitura.

---

## `godot_get_capabilities`

Retorna capacidades disponíveis no plugin e no modo atual do servidor.

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
    "available_categories": [
      "project",
      "files",
      "scenes",
      "nodes",
      "scripts",
      "runtime"
    ],
    "tools_count": 64,
    "features": {
      "undo_redo": true,
      "screenshots": true,
      "input_simulation": true,
      "runtime_tree": false
    }
  },
  "message": "Capacidades carregadas com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

Somente leitura.

---

# 9.2 Project Tools

## `godot_get_project_info`

Retorna informações básicas do projeto Godot aberto.

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
    "godot_version": "4.2.2",
    "main_scene": "res://scenes/Main.tscn",
    "renderer": "Forward+"
  },
  "message": "Informações do projeto obtidas.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

Somente leitura.

---

## `godot_get_editor_context`

Retorna o contexto atual do editor.

### Entrada

```json
{}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "current_scene": "res://scenes/Level01.tscn",
    "selected_nodes": [
      "Player",
      "Player/Camera2D"
    ],
    "is_playing": false,
    "active_tool": "2D"
  },
  "message": "Contexto do editor obtido.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

Somente leitura.

---

## `godot_get_input_map`

Retorna ações configuradas no Input Map.

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
      },
      {
        "name": "move_right",
        "events": ["D", "Right"]
      }
    ]
  },
  "message": "Input Map obtido.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

Somente leitura.

---

## `godot_add_input_action`

Cria ou atualiza uma ação no Input Map.

### Entrada

```json
{
  "name": "move_left",
  "events": [
    {
      "type": "key",
      "key": "A"
    },
    {
      "type": "key",
      "key": "Left"
    }
  ],
  "overwrite": false,
  "dry_run": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "action": "move_left",
    "created": true,
    "events_added": 2
  },
  "message": "Ação de input criada com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Erros possíveis

```text
READ_ONLY_MODE
INVALID_PARAMS
```

### Segurança

- Respeita read-only mode;
- Deve suportar dry_run;
- Deve evitar sobrescrita sem `overwrite: true`.

---

# 9.3 File Tools

## `godot_list_files`

Lista arquivos do projeto.

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
      "res://scenes/Main.tscn",
      "res://scripts/Player.gd"
    ],
    "count": 2,
    "truncated": false
  },
  "message": "Arquivos listados com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

Somente leitura. Deve bloquear root fora de `res://`.

---

## `godot_search_files`

Busca arquivos por nome, extensão ou conteúdo.

### Entrada

```json
{
  "query": "player",
  "extensions": [".gd", ".tscn"],
  "search_content": false,
  "limit": 20
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "path": "res://scripts/Player.gd",
        "type": "script",
        "score": 0.98
      }
    ]
  },
  "message": "Busca concluída.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

Somente leitura.

---

## `godot_read_file`

Lê um arquivo dentro do projeto.

### Entrada

```json
{
  "path": "res://scripts/Player.gd"
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "path": "res://scripts/Player.gd",
    "content": "extends CharacterBody2D\n",
    "size_bytes": 24
  },
  "message": "Arquivo lido com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Erros possíveis

```text
PATH_OUTSIDE_PROJECT
FILE_NOT_FOUND
```

### Segurança

- Somente leitura;
- Bloquear paths fora de `res://`;
- Pode aplicar limite de tamanho.

---

## `godot_write_file`

Escreve conteúdo completo em um arquivo.

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "content": "extends CharacterBody2D\n",
  "overwrite": false,
  "dry_run": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "path": "res://scripts/Player.gd",
    "created": true,
    "backup_path": null
  },
  "message": "Arquivo criado com sucesso.",
  "warnings": [],
  "suggestions": [
    "Execute godot_validate_script se o arquivo for um script GDScript."
  ]
}
```

### Erros possíveis

```text
READ_ONLY_MODE
PATH_OUTSIDE_PROJECT
FILE_ALREADY_EXISTS
BACKUP_FAILED
```

### Segurança

- Bloquear path fora de `res://`;
- Criar backup se arquivo existir;
- Exigir `overwrite: true` para sobrescrever;
- Suportar `dry_run`;
- Registrar log.

---

## `godot_patch_file`

Aplica alteração incremental em arquivo existente.

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

### Saída

```json
{
  "ok": true,
  "data": {
    "path": "res://scripts/Player.gd",
    "replacements": 1,
    "backup_path": ".godot_mcp/backups/2026-05-03/scripts/Player.gd.120000.bak"
  },
  "message": "Patch aplicado com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Backup obrigatório;
- `old_text` deve existir;
- `replace_all` deve ser explícito;
- Suportar `dry_run`;
- Registrar log.

---

# 9.4 Scene Tools

## `godot_open_scene`

Abre uma cena no editor Godot.

### Entrada

```json
{
  "scene_path": "res://scenes/Main.tscn"
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "scene_path": "res://scenes/Main.tscn",
    "root_node": "Main"
  },
  "message": "Cena aberta com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Erros possíveis

```text
FILE_NOT_FOUND
SCENE_LOAD_FAILED
```

### Segurança

Somente abre arquivos dentro de `res://`.

---

## `godot_create_scene`

Cria uma nova cena.

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

### Saída

```json
{
  "ok": true,
  "data": {
    "scene_path": "res://scenes/Player.tscn",
    "root_node": "Player",
    "root_type": "CharacterBody2D"
  },
  "message": "Cena criada com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Validar `root_type` via ClassDB;
- Backup se sobrescrever;
- Suportar `dry_run`;
- Bloquear path fora de `res://`.

---

## `godot_get_scene_tree`

Retorna a árvore da cena aberta.

### Entrada

```json
{
  "include_properties": false,
  "max_depth": 10
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "scene_path": "res://scenes/Main.tscn",
    "tree": {
      "name": "Main",
      "type": "Node2D",
      "path": ".",
      "children": [
        {
          "name": "Player",
          "type": "CharacterBody2D",
          "path": "Player",
          "children": []
        }
      ]
    }
  },
  "message": "Árvore da cena obtida.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

Somente leitura.

---

## `godot_audit_scene`

Audita uma cena e retorna problemas estruturais comuns.

### Entrada

```json
{
  "scene_path": "res://scenes/Main.tscn"
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "scene_path": "res://scenes/Main.tscn",
    "valid": true,
    "errors": 0,
    "warnings": 0,
    "issues": []
  },
  "message": "Auditoria de cena concluída.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Somente leitura;
- Bloquear path fora de `res://`;
- Reutilizar carregamento via Godot API, não edição textual de `.tscn`.

---

## `godot_save_scene`

Salva a cena atual.

### Entrada

```json
{
  "scene_path": null,
  "dry_run": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "scene_path": "res://scenes/Main.tscn",
    "backup_path": ".godot_mcp/backups/2026-05-03/scenes/Main.tscn.120000.bak"
  },
  "message": "Cena salva com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Backup antes de salvar cena existente;
- Suportar `dry_run`;
- Registrar log.

---

# 9.5 Node Tools

## `godot_add_node`

Adiciona um nó à cena aberta.

### Entrada

```json
{
  "parent_path": ".",
  "type": "Sprite2D",
  "name": "PlayerSprite",
  "properties": {
    "position": { "x": 100, "y": 100 }
  },
  "dry_run": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "node_path": "PlayerSprite",
    "type": "Sprite2D",
    "parent_path": "."
  },
  "message": "Nó criado com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Erros possíveis

```text
SCENE_NOT_OPEN
NODE_NOT_FOUND
INVALID_NODE_TYPE
INVALID_PROPERTY
UNDO_FAILED
```

### Segurança

- Validar tipo via ClassDB;
- Validar parent;
- Usar UndoRedo;
- Suportar `dry_run`;
- Registrar log.

---

## `godot_remove_node`

Remove um nó da cena aberta.

### Entrada

```json
{
  "node_path": "Enemy",
  "dry_run": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "removed_node": "Enemy"
  },
  "message": "Nó removido com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Usar UndoRedo;
- Suportar `dry_run`;
- Não remover root sem confirmação explícita;
- Relatar impacto se o nó possuir filhos.

---

## `godot_set_node_property`

Altera propriedade de um nó.

### Entrada

```json
{
  "node_path": "Player/Sprite2D",
  "property": "visible",
  "value": true,
  "dry_run": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "node_path": "Player/Sprite2D",
    "property": "visible",
    "old_value": false,
    "new_value": true
  },
  "message": "Propriedade alterada com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Validar existência da propriedade;
- Converter valor com segurança;
- Usar UndoRedo;
- Suportar `dry_run`.

---

# 9.6 Script Tools

## `godot_create_script`

Cria um script GDScript.

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "extends": "CharacterBody2D",
  "content": "extends CharacterBody2D\n\nfunc _physics_process(delta):\n    pass\n",
  "overwrite": false,
  "dry_run": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "script_path": "res://scripts/Player.gd",
    "extends": "CharacterBody2D"
  },
  "message": "Script criado com sucesso.",
  "warnings": [],
  "suggestions": [
    "Use godot_validate_script para validar a sintaxe."
  ]
}
```

### Segurança

- Path sandbox;
- Backup se sobrescrever;
- `overwrite` explícito;
- `dry_run`;
- Log.

---

## `godot_read_script`

Lê um script GDScript dentro do projeto.

### Entrada

```json
{
  "path": "res://scripts/Player.gd"
}
```

### Segurança

- Path sandbox;
- Apenas `.gd`;
- Bloquear arquivos sensíveis.

---

## `godot_patch_script`

Aplica patch textual exato em um script GDScript.

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

- Path sandbox;
- Backup obrigatório antes de alterar;
- Suportar `dry_run`;
- `old_content` deve existir.

---

## `godot_attach_script`

Anexa um script a um nó.

### Entrada

```json
{
  "node_path": "Player",
  "script_path": "res://scripts/Player.gd",
  "dry_run": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "node_path": "Player",
    "script_path": "res://scripts/Player.gd"
  },
  "message": "Script anexado ao nó com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Validar nó;
- Validar script;
- Usar UndoRedo;
- Suportar `dry_run`.

---

## `godot_validate_script`

Valida sintaxe e compatibilidade básica de um script GDScript.

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "godot_version_target": "4.x"
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "errors": [],
    "warnings": [
      {
        "line": 12,
        "message": "A variável delta não está sendo usada."
      }
    ]
  },
  "message": "Script validado.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Path sandbox;
- Apenas `.gd`;
- Erros estruturados com arquivo, linha, coluna e mensagem quando possível;
- Alertar padrões antigos de Godot 3 quando target for Godot 4.x.

---

## `godot_get_classdb_info`

Consulta informações úteis de uma classe na ClassDB.

### Entrada

```json
{
  "class_name": "CharacterBody2D"
}
```

### Segurança

Somente leitura.

---

## `godot_get_script_symbols`

Extrai `class_name`, `extends`, funções, sinais e variáveis de um script.

### Entrada

```json
{
  "path": "res://scripts/Player.gd"
}
```

### Segurança

Somente leitura.

---

## `godot_get_script_dependencies`

Extrai dependências `res://` em `preload`, `load` e `extends "res://..."`.

### Entrada

```json
{
  "path": "res://scripts/Enemy.gd"
}
```

### Segurança

Somente leitura.

---

## `godot_find_references`

Busca referências textuais em arquivos `.gd`.

### Entrada

```json
{
  "query": "Player",
  "root": "res://scripts",
  "limit": 100
}
```

### Segurança

Somente leitura.

---

## `godot_format_script`

Aplica formatação conservadora em um script: LF, remove espaços finais e garante newline final.

### Entrada

```json
{
  "path": "res://scripts/Player.gd",
  "dry_run": false
}
```

### Segurança

- Path sandbox;
- Backup obrigatório antes de alterar;
- Suportar `dry_run`.

---

# 9.7 Debug and Runtime Tools

## `godot_run_project`

Executa o projeto.

### Entrada

```json
{
  "debug": true
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "running": true,
    "started_at": "2026-05-03T12:00:00.000Z"
  },
  "message": "Projeto iniciado.",
  "warnings": [],
  "suggestions": [
    "Use godot_get_output_logs para verificar logs da execução."
  ]
}
```

### Segurança

Pode ser bloqueado em modo read-only estrito.

---

## `godot_stop_project`

Para o projeto em execução.

### Entrada

```json
{}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "running": false
  },
  "message": "Projeto parado.",
  "warnings": [],
  "suggestions": []
}
```

---

## `godot_get_output_logs`

Obtém logs recentes do output.

### Entrada

```json
{
  "limit": 100,
  "severity": "all"
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "logs": [
      {
        "level": "error",
        "message": "Invalid get index 'speed'",
        "file": "res://scripts/Player.gd",
        "line": 24
      }
    ]
  },
  "message": "Logs obtidos.",
  "warnings": [],
  "suggestions": [
    "Leia res://scripts/Player.gd na linha 24 para investigar."
  ]
}
```

### Segurança

Somente leitura.

---

## `godot_get_runtime_tree`

Retorna a árvore de nós do jogo em execução.

### Entrada

```json
{
  "max_depth": 10,
  "include_properties": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "running": true,
    "tree": {
      "name": "Main",
      "type": "Node2D",
      "children": []
    }
  },
  "message": "Árvore de runtime obtida.",
  "warnings": [],
  "suggestions": []
}
```

### Erros possíveis

```text
RUNTIME_NOT_RUNNING
```

---

# 9.8 Screenshot Tools

## `godot_take_game_screenshot`

Captura screenshot do jogo em execução.

### Entrada

```json
{
  "output_path": ".godot_mcp/screenshots/game_latest.png"
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "path": ".godot_mcp/screenshots/game_latest.png",
    "width": 1280,
    "height": 720
  },
  "message": "Screenshot do jogo capturado.",
  "warnings": [],
  "suggestions": []
}
```

### Erros possíveis

```text
RUNTIME_NOT_RUNNING
SCREENSHOT_FAILED
```

---

## `godot_take_editor_screenshot`

Captura screenshot do editor.

### Entrada

```json
{
  "output_path": ".godot_mcp/screenshots/editor_latest.png"
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "path": ".godot_mcp/screenshots/editor_latest.png"
  },
  "message": "Screenshot do editor capturado.",
  "warnings": [],
  "suggestions": []
}
```

---

# 9.9 Input Tools

## `godot_press_action`

Simula pressionamento de uma ação do Input Map.

### Entrada

```json
{
  "action": "move_right",
  "duration_ms": 500
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "action": "move_right",
    "duration_ms": 500
  },
  "message": "Ação de input executada.",
  "warnings": [],
  "suggestions": []
}
```

### Erros possíveis

```text
INPUT_ACTION_NOT_FOUND
RUNTIME_NOT_RUNNING
```

---

## `godot_run_input_sequence`

Executa sequência de inputs.

### Entrada

```json
{
  "sequence": [
    {
      "type": "action_press",
      "action": "move_right",
      "duration_ms": 1000
    },
    {
      "type": "action_press",
      "action": "jump",
      "duration_ms": 100
    }
  ]
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "events_executed": 2
  },
  "message": "Sequência de input executada.",
  "warnings": [],
  "suggestions": []
}
```

---

# 9.10 Signal Tools

## `godot_get_signal_connections`

Lista conexões de sinais da cena aberta.

### Entrada

```json
{
  "node_path": "Player",
  "include_inherited": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "connections": [
      {
        "source_node": "Player",
        "signal": "health_changed",
        "target_node": "HUD",
        "method": "_on_player_health_changed"
      }
    ]
  },
  "message": "Conexões de sinais obtidas.",
  "warnings": [],
  "suggestions": []
}
```

---

## `godot_connect_signal`

Conecta um sinal de um nó a um método de outro nó.

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

### Saída

```json
{
  "ok": true,
  "data": {
    "source_node": "Button",
    "signal": "pressed",
    "target_node": "UIManager",
    "method": "_on_start_button_pressed"
  },
  "message": "Sinal conectado com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- Validar existência de source;
- Validar sinal;
- Validar target;
- Usar UndoRedo quando possível;
- Suportar `dry_run`.

---

# 9.11 Project Intelligence Tools

## `godot_project_summary`

Gera ou retorna resumo estrutural do projeto.

### Entrada

```json
{
  "refresh": false,
  "include_assets": false
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "summary": {
      "scenes": 12,
      "scripts": 34,
      "assets": 128,
      "main_scene": "res://scenes/Main.tscn",
      "systems_detected": ["player", "inventory", "hud"]
    }
  },
  "message": "Resumo do projeto obtido.",
  "warnings": [],
  "suggestions": []
}
```

---

## `godot_impact_check`

Analisa impacto de uma alteração planejada.

### Entrada

```json
{
  "change_type": "rename_signal",
  "target": "health_changed",
  "new_value": "player_health_changed"
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "impact_level": "medium",
    "affected_files": [
      "res://scripts/PlayerHealth.gd",
      "res://scripts/HUD.gd"
    ],
    "affected_scenes": [
      "res://scenes/Main.tscn"
    ],
    "risks": [
      "HUD pode parar de receber atualização de vida se a conexão não for atualizada."
    ]
  },
  "message": "Análise de impacto concluída.",
  "warnings": [],
  "suggestions": [
    "Execute godot_refactor_safely com dry_run antes de aplicar."
  ]
}
```

---

# 9.12 Agentic Tools

## `godot_fix_errors`

Tenta corrigir erros detectados no projeto.

### Entrada

```json
{
  "scope": "current_scene",
  "dry_run": true,
  "max_files": 5
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "errors_found": 2,
    "planned_changes": [
      {
        "file": "res://scripts/Player.gd",
        "reason": "Variável speed não declarada.",
        "change_summary": "Adicionar var speed: float = 200.0"
      }
    ],
    "applied": false
  },
  "message": "Plano de correção gerado em dry_run.",
  "warnings": [],
  "suggestions": [
    "Execute novamente com dry_run=false para aplicar as alterações."
  ]
}
```

### Segurança

- Deve rodar primeiro em `dry_run` por padrão;
- Deve limitar número de arquivos;
- Deve criar backup antes de aplicar;
- Deve validar scripts após patch;
- Deve registrar relatório.

---

## `godot_create_gameplay_system`

Cria um sistema de gameplay a partir de um tipo predefinido.

### Entrada

```json
{
  "system_type": "health",
  "target_scene": "res://scenes/Player.tscn",
  "options": {
    "max_health": 100,
    "create_hud_binding": true
  },
  "dry_run": true
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "system_type": "health",
    "planned_files": [
      "res://scripts/components/HealthComponent.gd"
    ],
    "planned_nodes": [
      "Player/HealthComponent"
    ],
    "planned_signals": [
      "health_changed",
      "died"
    ],
    "applied": false
  },
  "message": "Plano de sistema de gameplay criado.",
  "warnings": [],
  "suggestions": []
}
```

### Segurança

- `dry_run` recomendado por padrão;
- Backup obrigatório;
- Validação após criação;
- Relatório final obrigatório.

---

## `godot_build_feature`

Ferramenta composta para criar uma feature descrita em linguagem natural.

### Entrada

```json
{
  "description": "Crie uma porta que abre quando o jogador coleta uma chave.",
  "target_scene": "res://scenes/Level01.tscn",
  "dry_run": true
}
```

### Saída

```json
{
  "ok": true,
  "data": {
    "feature": "porta com chave",
    "plan": [
      "Criar nó Key como Area2D",
      "Criar nó Door como StaticBody2D",
      "Criar script Key.gd",
      "Criar script Door.gd",
      "Conectar sinal key_collected",
      "Validar execução"
    ],
    "applied": false
  },
  "message": "Plano de feature gerado.",
  "warnings": [],
  "suggestions": [
    "Revise o plano antes de aplicar."
  ]
}
```

### Segurança

- Deve gerar plano antes de aplicar;
- Deve suportar `dry_run`;
- Deve limitar escopo;
- Deve criar backups;
- Deve executar validação final.

---

## 10. Ferramentas por modo

## 10.1 Minimal

```text
godot_health_check
godot_get_project_info
godot_get_editor_context
godot_list_files
godot_search_files
godot_read_file
godot_write_file
godot_open_scene
godot_save_scene
godot_get_scene_tree
godot_add_node
godot_remove_node
godot_set_node_property
godot_create_script
godot_attach_script
godot_validate_script
godot_run_project
godot_stop_project
godot_get_output_logs
godot_get_debugger_errors
godot_take_game_screenshot
godot_press_action
godot_release_action
godot_project_summary
```

## 10.2 Core

Inclui todas do Minimal e adiciona:

```text
godot_get_capabilities
godot_get_project_settings
godot_get_godot_version
godot_get_open_scenes
godot_get_selected_nodes
godot_get_input_map
godot_add_input_action
godot_remove_input_action
godot_get_autoloads
godot_add_autoload
godot_remove_autoload
godot_patch_file
godot_move_file
godot_rename_file
godot_delete_file_safe
godot_rescan_filesystem
godot_find_asset
godot_create_scene
godot_duplicate_scene
godot_get_scene_summary
godot_validate_scene
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_get_node_properties
godot_get_node_groups
godot_add_node_to_group
godot_remove_node_from_group
godot_read_script
godot_patch_script
godot_get_script_symbols
godot_find_references
godot_get_signal_connections
godot_connect_signal
godot_disconnect_signal
godot_run_scene
godot_is_game_running
godot_get_runtime_tree
godot_take_editor_screenshot
godot_run_input_sequence
```

## 10.3 Full

Inclui todas do Core e adiciona toolkits especializados:

```text
2D Toolkit
3D Toolkit
Physics Toolkit
Animation Toolkit
Audio Toolkit
Particles/VFX Toolkit
Shader/Material Toolkit
Navigation Toolkit
Test Tools
Project Intelligence completo
Project Memory completo
```

## 10.4 Agentic

Inclui ferramentas compostas:

```text
godot_fix_errors
godot_build_feature
godot_create_gameplay_system
godot_refactor_safely
godot_generate_scene_from_prompt
godot_create_playable_prototype
godot_run_validation_loop
godot_create_game_jam_prototype
godot_explain_project_architecture
godot_prepare_release_checklist
```

---

## 11. Regras de implementação

## 11.1 Toda ferramenta deve ter schema

No servidor TypeScript, cada ferramenta deve validar entrada com Zod ou mecanismo equivalente.

## 11.2 Toda ferramenta deve ter descrição otimizada para IA

A descrição deve explicar quando usar e quando não usar.

## 11.3 Toda ferramenta deve retornar resposta padronizada

Não retornar texto solto quando dados estruturados forem necessários.

## 11.4 Toda ferramenta mutável deve registrar log

Registrar:

```text
- timestamp
- tool
- params resumidos
- resultado
- duração
- arquivos afetados
```

## 11.5 Toda ferramenta destrutiva deve aceitar dry_run

Obrigatório para:

```text
write_file com overwrite
patch_file
delete_file_safe
remove_node
rename_file
move_file
refactor_safely
build_feature
create_gameplay_system
```

## 11.6 Toda alteração de arquivo deve gerar backup

Obrigatório para:

```text
.gd
.tscn
.tres
.res
.cfg
.import
```

## 11.7 Toda mutação de editor deve usar UndoRedo

Obrigatório para:

```text
add_node
remove_node
rename_node
duplicate_node
reparent_node
set_node_property
attach_script
connect_signal
disconnect_signal
```

---

## 12. Critérios para aceitar uma nova ferramenta

Uma ferramenta só deve ser adicionada se responder positivamente à maioria destes critérios:

```text
1. O nome é claro?
2. O schema é específico?
3. A ferramenta reduz ambiguidade para a IA?
4. A ferramenta é diferente de outras já existentes?
5. A ferramenta pode ser testada?
6. A ferramenta tem erros previsíveis?
7. A ferramenta respeita segurança?
8. A ferramenta retorna dados úteis?
9. A ferramenta melhora o fluxo de criação de jogos?
10. A ferramenta pertence a um modo adequado?
```

---

## 13. Critérios de versão 1.0 para ferramentas

A versão 1.0 deve conter pelo menos:

```text
Core:
- health_check
- capabilities
- project_info
- editor_context

Files:
- list_files
- search_files
- read_file
- write_file
- patch_file

Scenes:
- create_scene
- open_scene
- save_scene
- get_scene_tree
- get_scene_summary

Nodes:
- add_node
- remove_node
- rename_node
- set_node_property
- get_node_properties
- attach_script

Scripts:
- create_script
- read_script
- patch_script
- validate_script

Runtime/Debug:
- run_project
- run_scene
- stop_project
- get_output_logs
- get_debugger_errors
- assert_no_errors

Visual/Input:
- take_game_screenshot
- press_action
- release_action
- run_input_sequence

Intelligence:
- project_summary
- build_dependency_graph
- build_signal_map
- impact_check
```

---

## 14. Conclusão

Esta especificação define a base de ferramentas do Godot DevPilot MCP.

A prioridade inicial não deve ser criar o maior número possível de ferramentas, mas criar ferramentas:

```text
- seguras;
- previsíveis;
- bem descritas;
- com schemas fortes;
- com respostas padronizadas;
- com logs;
- com backup;
- com UndoRedo;
- úteis no fluxo real de criação de jogos.
```

Com essa base, o projeto pode evoluir de forma controlada para toolkits especializados e ferramentas agentic de alto nível.
