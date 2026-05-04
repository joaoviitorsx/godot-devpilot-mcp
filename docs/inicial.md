# Godot DevPilot MCP — Documentação Inicial

## 1. Visão Geral do Projeto

### 1.1 Nome provisório

**Godot DevPilot MCP**

Outras opções de nome:

- Godot Forge MCP
- Godot AI Studio MCP
- Godot GamePilot MCP
- Godot Agent MCP

### 1.2 Objetivo

O objetivo do projeto é criar um servidor **MCP — Model Context Protocol** integrado à engine **Godot**, permitindo que assistentes de IA interajam diretamente com o editor, os arquivos, as cenas, os scripts, os assets e a execução do jogo.

A proposta é partir de uma base open source, como o projeto `tomyud1/godot-mcp`, e evoluí-la para uma versão mais ampla, robusta e especializada em desenvolvimento de games.

A meta não é apenas permitir que uma IA edite arquivos. A meta é criar um ambiente onde a IA consiga:

- Entender a estrutura do projeto Godot;
- Criar cenas, nós, scripts e sistemas de gameplay;
- Rodar o jogo;
- Ler erros e logs;
- Capturar screenshots;
- Simular input;
- Corrigir bugs;
- Analisar dependências;
- Mapear sinais;
- Validar alterações;
- Ajudar no ciclo completo de criação de jogos.

### 1.3 Problema que o projeto resolve

Hoje, ferramentas pagas como Godot MCP Pro, GDAI MCP e GodotIQ oferecem integração entre IA e Godot, mas possuem limitações de acesso, custo ou escopo fechado.

Este projeto busca criar uma alternativa aberta e extensível, permitindo que desenvolvedores independentes utilizem IA no desenvolvimento de jogos sem depender de soluções comerciais fechadas.

### 1.4 Público-alvo

- Desenvolvedores indie usando Godot;
- Estudantes de desenvolvimento de games;
- Criadores de jogos 2D e 3D;
- Times pequenos que desejam automação com IA;
- Usuários de Cursor, Claude Desktop, Cline, Windsurf ou outros clientes compatíveis com MCP.

### 1.5 Princípios do projeto

1. **Open source first** — o projeto deve ser auditável, extensível e livre para estudo.
2. **Godot 4.x first** — o foco inicial será Godot 4.2+.
3. **Segurança por padrão** — ferramentas destrutivas devem ter proteção, backup e `dry_run`.
4. **Undo/Redo obrigatório** — toda mutação no editor deve, quando possível, usar o sistema de UndoRedo da Godot.
5. **IA com contexto real** — a IA deve compreender cenas, scripts, sinais, assets e dependências.
6. **Iteração completa** — criar, rodar, testar, observar, corrigir e validar.
7. **Modularidade** — as ferramentas devem ser organizadas em categorias e modos de uso.
8. **Escalabilidade** — o projeto deve suportar desde um modo mínimo até um modo avançado com ferramentas agentic.

---

# 2. Arquitetura do Projeto

## 2.1 Arquitetura geral

```text
Cliente de IA
Claude / Cursor / Cline / VS Code / Windsurf
        ↓ MCP via stdio
Servidor MCP local
TypeScript / Node.js
        ↓ WebSocket / JSON-RPC 2.0
Plugin Godot
GDScript / EditorPlugin
        ↓
Editor Godot / Runtime / Filesystem / Debugger
```

## 2.2 Componentes principais

### 2.2.1 Cliente de IA

É o ambiente onde o usuário interage com a IA.

Exemplos:

- Claude Desktop;
- Cursor;
- Cline;
- Windsurf;
- VS Code com cliente MCP;
- Outros agentes compatíveis com MCP.

O cliente não se comunica diretamente com a Godot. Ele se comunica com o servidor MCP.

### 2.2.2 Servidor MCP

O servidor MCP é responsável por expor ferramentas para a IA.

Responsabilidades:

- Registrar ferramentas MCP;
- Validar parâmetros com schemas;
- Receber chamadas do cliente IA;
- Encaminhar comandos para o plugin Godot;
- Padronizar respostas;
- Aplicar políticas de segurança;
- Registrar logs;
- Gerenciar modos de ferramenta: minimal, core, full e agentic.

Tecnologia recomendada:

```text
TypeScript + Node.js + @modelcontextprotocol/sdk + Zod + WebSocket
```

### 2.2.3 Plugin Godot

O plugin roda dentro do editor Godot.

Responsabilidades:

- Abrir conexão WebSocket local;
- Receber comandos do servidor MCP;
- Executar ações usando APIs da Godot;
- Manipular cenas, nós, propriedades e scripts;
- Ler informações do editor;
- Capturar screenshots;
- Ler logs e erros;
- Simular input;
- Gerenciar UndoRedo;
- Retornar respostas estruturadas.

Tecnologia recomendada:

```text
GDScript + EditorPlugin + EditorInterface + WebSocketPeer/WebSocketServer
```

### 2.2.4 Indexador do projeto

Componente responsável por mapear a estrutura do projeto.

Ele deve indexar:

- Cenas `.tscn`;
- Scripts `.gd`;
- Assets;
- Autoloads;
- Sinais;
- Grupos;
- Dependências;
- Input actions;
- Recursos `.tres` e `.res`.

O indexador pode existir parcialmente no servidor MCP e parcialmente no plugin Godot.

### 2.2.5 Memória do projeto

Camada persistente para guardar contexto útil para a IA.

Sugestão de diretório:

```text
.godot_mcp/
├── memory/
│   ├── project_summary.md
│   ├── architecture.md
│   ├── conventions.md
│   ├── decisions.md
│   └── gameplay_systems.md
├── index/
│   ├── scripts.json
│   ├── scenes.json
│   ├── signals.json
│   ├── assets.json
│   └── dependencies.json
└── logs/
    └── actions.jsonl
```

---

# 3. Estrutura Recomendada de Pastas

```text
godot-devpilot-mcp/
├── addons/
│   └── godot_devpilot_mcp/
│       ├── plugin.cfg
│       ├── plugin.gd
│       ├── core/
│       │   ├── rpc_server.gd
│       │   ├── dispatcher.gd
│       │   ├── protocol.gd
│       │   ├── permissions.gd
│       │   ├── undo_service.gd
│       │   └── response_factory.gd
│       ├── tools/
│       │   ├── project_tools.gd
│       │   ├── file_tools.gd
│       │   ├── scene_tools.gd
│       │   ├── node_tools.gd
│       │   ├── script_tools.gd
│       │   ├── signal_tools.gd
│       │   ├── runtime_tools.gd
│       │   ├── screenshot_tools.gd
│       │   ├── input_tools.gd
│       │   ├── physics_tools.gd
│       │   ├── animation_tools.gd
│       │   ├── audio_tools.gd
│       │   ├── shader_tools.gd
│       │   └── navigation_tools.gd
│       ├── analyzers/
│       │   ├── scene_analyzer.gd
│       │   ├── script_analyzer.gd
│       │   ├── signal_analyzer.gd
│       │   ├── dependency_analyzer.gd
│       │   └── project_analyzer.gd
│       └── ui/
│           ├── status_dock.gd
│           └── action_log_panel.gd
│
├── mcp-server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── config/
│   │   │   ├── config.ts
│   │   │   └── modes.ts
│   │   ├── godot/
│   │   │   ├── client.ts
│   │   │   ├── protocol.ts
│   │   │   ├── connection.ts
│   │   │   └── schemas.ts
│   │   ├── tools/
│   │   │   ├── projectTools.ts
│   │   │   ├── fileTools.ts
│   │   │   ├── sceneTools.ts
│   │   │   ├── nodeTools.ts
│   │   │   ├── scriptTools.ts
│   │   │   ├── signalTools.ts
│   │   │   ├── runtimeTools.ts
│   │   │   ├── screenshotTools.ts
│   │   │   ├── inputTools.ts
│   │   │   ├── physicsTools.ts
│   │   │   ├── animationTools.ts
│   │   │   ├── audioTools.ts
│   │   │   ├── shaderTools.ts
│   │   │   └── agenticTools.ts
│   │   ├── safety/
│   │   │   ├── pathGuard.ts
│   │   │   ├── permissions.ts
│   │   │   ├── backup.ts
│   │   │   └── dryRun.ts
│   │   ├── memory/
│   │   │   ├── memoryStore.ts
│   │   │   ├── projectSummary.ts
│   │   │   └── decisionRecords.ts
│   │   ├── indexer/
│   │   │   ├── projectIndexer.ts
│   │   │   ├── scriptIndexer.ts
│   │   │   ├── sceneIndexer.ts
│   │   │   └── dependencyGraph.ts
│   │   └── utils/
│   │       ├── logger.ts
│   │       └── errors.ts
│   ├── package.json
│   └── tsconfig.json
│
├── visualizer/
│   ├── src/
│   └── package.json
│
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── TOOL_GAP_ANALYSIS.md
│   ├── TOOL_SPECIFICATION.md
│   ├── ROADMAP.md
│   ├── SECURITY.md
│   ├── CONTRIBUTING.md
│   └── DEVELOPMENT_GUIDE.md
│
└── tests/
    ├── server/
    ├── plugin/
    └── e2e/
```

---

# 4. Análise de Lacunas — Tool Gap Analysis

## 4.1 Objetivo

Este documento compara três linhas de referência:

1. Base open source `tomyud1/godot-mcp`;
2. Soluções pagas como Godot MCP Pro e GDAI MCP;
3. Proposta planejada para o Godot DevPilot MCP.

O objetivo é mapear o que já existe, o que falta e o que pode ser implementado de forma superior.

## 4.2 Categorias comparativas

| Categoria | tomyud1/godot-mcp | Godot MCP Pro / GDAI / GodotIQ | Godot DevPilot MCP planejado |
|---|---|---|---|
| Arquivos | Sim | Sim | Sim, com backup, patch e proteção de path |
| Cenas | Sim | Sim | Sim, com UndoRedo e análise semântica |
| Nós | Sim | Sim | Sim, com duplicação, reparent, grupos e validação |
| Scripts | Sim | Sim | Sim, com análise de símbolos e dependências |
| Debugger | Parcial | Forte | Forte, com loop de correção automática |
| Runtime tree | Parcial | Sim | Sim, com inspeção e alteração controlada |
| Screenshots | Limitado/variável | Sim | Sim, editor + jogo + comparação visual |
| Input simulation | Parcial/variável | Sim | Sim, com sequências e testes E2E |
| 2D toolkit | Básico | Sim | Forte, com ferramentas agentic |
| 3D toolkit | Limitado | Forte | Forte, com primitivas, câmera, luz, colisão e navegação |
| Física | Parcial | Sim | Forte, com auditoria de colisão |
| Animação | Parcial | Sim | Forte, com AnimationPlayer e AnimationTree |
| Áudio | Parcial | Sim | Forte, com buses, players e effects |
| Partículas | Limitado | Sim | Sim, com presets 2D/3D |
| Shaders | Limitado | Sim | Sim, com validação e presets |
| Navegação | Limitado | Sim | Sim, com NavigationRegion e bake |
| Testes automatizados | Limitado | Sim | Forte, com assertions e screenshots |
| Grafo de dependência | Limitado | GodotIQ destaca | Forte |
| Signal flow | Limitado | GodotIQ destaca | Forte |
| Project memory | Não central | GodotIQ destaca | Forte |
| Modos minimal/core/full | Não central | Sim | Sim |
| Undo/Redo | Não | Sim/esperado | Obrigatório |
| Segurança | Básica | Não totalmente pública | Forte, por design |

## 4.3 Lacunas prioritárias

As lacunas mais importantes a resolver primeiro são:

1. **UndoRedo em toda mutação do editor**;
2. **Sistema de segurança para arquivos e comandos destrutivos**;
3. **Backups automáticos antes de alterações em arquivos**;
4. **Captura e leitura confiável de erros do editor e runtime**;
5. **Screenshots do jogo e editor**;
6. **Simulação de input**;
7. **Indexador de cenas, scripts, assets e sinais**;
8. **Grafo de dependências**;
9. **Memória do projeto**;
10. **Ferramentas agentic para criação de sistemas completos de gameplay**.

---

# 5. Especificação de Ferramentas

## 5.1 Convenção de resposta

Toda ferramenta deve retornar um objeto padronizado.

```json
{
  "ok": true,
  "data": {},
  "message": "Operação concluída com sucesso.",
  "warnings": [],
  "suggestions": []
}
```

Em caso de erro:

```json
{
  "ok": false,
  "error": {
    "code": "SCENE_NOT_OPEN",
    "message": "Nenhuma cena está aberta no editor.",
    "details": {}
  },
  "suggestions": [
    "Abra uma cena antes de adicionar nós.",
    "Use godot_open_scene para abrir uma cena existente."
  ]
}
```

## 5.2 Convenção de nomes

Todas as ferramentas devem usar o prefixo:

```text
godot_
```

Exemplos:

```text
godot_get_project_info
godot_create_scene
godot_add_node
godot_validate_script
```

## 5.3 Modos de ferramentas

### 5.3.1 Minimal

Modo enxuto para clientes MCP com limitação de quantidade de ferramentas.

Ferramentas previstas:

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
godot_get_errors
godot_take_game_screenshot
godot_press_action
godot_release_action
godot_project_summary
```

### 5.3.2 Core

Modo recomendado para uso diário.

Inclui ferramentas de:

```text
- Projeto
- Arquivos
- Cenas
- Nós
- Scripts
- Debug
- Runtime
- Screenshots
- Input
- Signals
- Indexação básica
```

### 5.3.3 Full

Modo completo.

Inclui ferramentas de:

```text
- 2D
- 3D
- Física
- Animação
- Áudio
- Partículas
- Shaders
- Navegação
- Testes
- Project intelligence
```

### 5.3.4 Agentic

Modo com ferramentas compostas e de alto nível.

Exemplos:

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

# 6. Catálogo Inicial de Ferramentas

## 6.1 Project Tools

```text
godot_health_check
godot_get_project_info
godot_get_editor_context
godot_get_godot_version
godot_get_open_scenes
godot_get_selected_nodes
godot_get_project_settings
godot_get_input_map
godot_add_input_action
godot_remove_input_action
godot_get_autoloads
godot_add_autoload
godot_remove_autoload
```

## 6.2 File Tools

```text
godot_list_files
godot_search_files
godot_read_file
godot_write_file
godot_patch_file
godot_move_file
godot_rename_file
godot_delete_file_safe
godot_file_exists
godot_create_directory
godot_rescan_filesystem
godot_find_asset
godot_get_asset_metadata
godot_preview_asset
```

## 6.3 Scene Tools

```text
godot_create_scene
godot_open_scene
godot_save_scene
godot_duplicate_scene
godot_close_scene
godot_get_scene_tree
godot_get_scene_summary
godot_get_scene_dependencies
godot_validate_scene
godot_audit_scene
```

## 6.4 Node Tools

```text
godot_add_node
godot_remove_node
godot_move_node
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_get_node_properties
godot_set_node_property
godot_get_node_groups
godot_add_node_to_group
godot_remove_node_from_group
godot_get_node_script
godot_attach_script
```

## 6.5 Script Tools

```text
godot_create_script
godot_read_script
godot_patch_script
godot_validate_script
godot_format_script
godot_get_script_symbols
godot_get_script_dependencies
godot_find_references
godot_rename_symbol
godot_extract_method
godot_get_classdb_info
```

## 6.6 Signal Tools

```text
godot_list_signals
godot_get_signal_connections
godot_connect_signal
godot_disconnect_signal
godot_analyze_signal_flow
godot_find_orphan_signals
godot_find_broken_connections
godot_impact_check
godot_trace_flow
```

## 6.7 Runtime Tools

```text
godot_run_project
godot_run_scene
godot_stop_project
godot_is_game_running
godot_get_runtime_tree
godot_get_runtime_node_properties
godot_set_runtime_node_property
godot_get_fps
godot_get_process_stats
godot_get_output_logs
godot_get_debugger_errors
godot_clear_logs
godot_wait_for_condition
godot_find_runtime_node
```

## 6.8 Screenshot Tools

```text
godot_take_editor_screenshot
godot_take_game_screenshot
godot_get_viewport_image
godot_compare_screenshots
godot_find_visual_element
godot_describe_current_view
```

## 6.9 Input Tools

```text
godot_press_key
godot_release_key
godot_tap_key
godot_mouse_move
godot_mouse_click
godot_mouse_drag
godot_press_action
godot_release_action
godot_run_input_sequence
godot_record_input
godot_replay_input
godot_click_ui_by_text
godot_find_ui_element
```

## 6.10 2D Toolkit

```text
godot_create_player_2d
godot_create_enemy_2d
godot_create_collectible_2d
godot_create_platformer_controller
godot_create_topdown_controller
godot_setup_camera_2d
godot_setup_collision_2d
godot_setup_area_trigger_2d
godot_create_tilemap
godot_setup_parallax_background
godot_create_health_system
godot_create_inventory_ui
```

## 6.11 3D Toolkit

```text
godot_add_mesh_instance
godot_create_primitive_mesh
godot_import_gltf
godot_setup_camera_3d
godot_setup_lighting
godot_setup_world_environment
godot_create_character_body_3d
godot_setup_collision_3d
godot_create_raycast
godot_create_navigation_region
godot_bake_navigation_mesh
godot_setup_third_person_controller
```

## 6.12 Agentic Tools

```text
godot_build_feature
godot_fix_errors
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

# 7. Roadmap

## 7.1 Fase 0 — Fundação

Objetivo: preparar a base do projeto.

Tarefas:

- Forkar ou estudar o `tomyud1/godot-mcp`;
- Rodar a integração localmente;
- Mapear as ferramentas existentes;
- Documentar a arquitetura atual;
- Separar responsabilidades entre servidor MCP e plugin Godot;
- Criar `docs/ARCHITECTURE.md`;
- Criar `docs/TOOL_GAP_ANALYSIS.md`;
- Criar `docs/ROADMAP.md`.

Critério de conclusão:

- Cliente MCP consegue conectar ao servidor;
- Servidor consegue conectar à Godot;
- IA consegue executar uma ferramenta simples, como `godot_get_project_info`.

## 7.2 Fase 1 — Robustez e segurança

Objetivo: tornar a base confiável.

Tarefas:

- Padronizar protocolo interno JSON-RPC;
- Criar `godot_health_check`;
- Criar heartbeat;
- Criar reconexão automática;
- Criar logs de ações em JSONL;
- Criar modo read-only;
- Criar proteção contra acesso fora de `res://`;
- Criar backup automático antes de alterações;
- Criar suporte a `dry_run`;
- Criar resposta padronizada com `ok`, `data`, `error`, `warnings` e `suggestions`.

Critério de conclusão:

- Toda ferramenta retorna resposta padronizada;
- Nenhuma ferramenta consegue alterar arquivos fora do projeto;
- Toda alteração em arquivo gera backup;
- Ferramentas destrutivas aceitam `dry_run`.

## 7.3 Fase 2 — UndoRedo e mutações seguras

Objetivo: evitar alterações irreversíveis no editor.

Tarefas:

- Implementar serviço `UndoService` no plugin;
- Usar UndoRedo em `add_node`;
- Usar UndoRedo em `remove_node`;
- Usar UndoRedo em `set_node_property`;
- Usar UndoRedo em `attach_script`;
- Usar UndoRedo em operações de grupos;
- Adicionar log de mutações.

Critério de conclusão:

- O usuário consegue desfazer pelo editor Godot as principais ações executadas pela IA.

## 7.4 Fase 3 — Debug loop

Objetivo: permitir que a IA rode, observe e corrija.

Tarefas:

- Melhorar leitura de output logs;
- Melhorar leitura de erros do debugger;
- Capturar erros de parse de GDScript;
- Implementar `godot_run_scene`;
- Implementar `godot_stop_project`;
- Implementar `godot_get_output_logs`;
- Implementar `godot_get_debugger_errors`;
- Implementar `godot_fix_errors` em modo inicial;
- Criar assertion `godot_assert_no_errors`.

Critério de conclusão:

- IA consegue rodar uma cena, detectar um erro, corrigir script e rodar novamente.

## 7.5 Fase 4 — Screenshots e input simulation

Objetivo: permitir validação visual e testes interativos.

Tarefas:

- Capturar screenshot do editor;
- Capturar screenshot do jogo;
- Capturar viewport atual;
- Simular teclado;
- Simular mouse;
- Simular input actions;
- Criar sequência de input;
- Criar testes E2E básicos.

Critério de conclusão:

- IA consegue clicar, mover personagem, capturar screenshot e validar estado visual.

## 7.6 Fase 5 — Project intelligence

Objetivo: permitir que a IA entenda o projeto.

Tarefas:

- Indexar scripts;
- Indexar cenas;
- Indexar assets;
- Indexar sinais;
- Gerar grafo de dependências;
- Gerar signal map;
- Criar `impact_check`;
- Criar `trace_flow`;
- Criar `project_summary`;
- Criar memória persistente.

Critério de conclusão:

- IA consegue responder perguntas estruturais sobre o projeto e prever impacto de alterações.

## 7.7 Fase 6 — Toolkits especializados

Objetivo: acelerar criação de jogos reais.

Tarefas:

- Toolkit 2D;
- Toolkit 3D;
- Toolkit de física;
- Toolkit de animação;
- Toolkit de áudio;
- Toolkit de partículas;
- Toolkit de shaders;
- Toolkit de navegação.

Critério de conclusão:

- IA consegue criar protótipos jogáveis com sistemas comuns de gameplay.

## 7.8 Fase 7 — Ferramentas agentic

Objetivo: elevar o nível de automação.

Tarefas:

- `godot_build_feature`;
- `godot_fix_errors` avançado;
- `godot_create_gameplay_system`;
- `godot_refactor_safely`;
- `godot_generate_scene_from_prompt`;
- `godot_create_playable_prototype`;
- `godot_run_validation_loop`.

Critério de conclusão:

- IA consegue receber uma descrição de feature, implementá-la, rodar, validar e gerar relatório.

---

# 8. Segurança

## 8.1 Objetivo

A integração MCP dá à IA capacidade de alterar projetos reais. Por isso, segurança deve ser tratada como parte central da arquitetura.

## 8.2 Riscos principais

1. Sobrescrever scripts importantes;
2. Excluir arquivos acidentalmente;
3. Alterar arquivos fora do projeto;
4. Criar código inseguro;
5. Travar o editor com comandos pesados;
6. Executar ações destrutivas sem intenção do usuário;
7. Corromper cenas `.tscn`;
8. Gerar mudanças difíceis de desfazer.

## 8.3 Regras obrigatórias

### 8.3.1 Path sandbox

Toda operação de arquivo deve ficar limitada a:

```text
res://
```

O servidor também deve validar caminhos no sistema operacional.

Bloquear:

```text
../
C:\Users\...
/home/usuario/...
/tmp/...
```

### 8.3.2 Backup automático

Antes de qualquer escrita em arquivo existente, criar backup.

Sugestão:

```text
.godot_mcp/backups/YYYY-MM-DD/<arquivo>.<timestamp>.bak
```

### 8.3.3 Dry run

Ferramentas destrutivas ou de grande impacto devem aceitar:

```json
{
  "dry_run": true
}
```

Nesse modo, a ferramenta retorna o que faria, mas não executa a alteração.

### 8.3.4 Modo read-only

Modo onde a IA só pode ler e analisar.

Permitido:

```text
read_file
list_files
get_scene_tree
get_project_info
get_errors
project_summary
```

Bloqueado:

```text
write_file
patch_file
delete_file
add_node
remove_node
set_property
run_project
```

### 8.3.5 UndoRedo

Toda mutação no editor deve tentar usar o sistema UndoRedo da Godot.

Exemplos:

```text
add_node
remove_node
rename_node
set_node_property
attach_script
connect_signal
```

### 8.3.6 Logs de ação

Toda ferramenta chamada deve registrar:

```json
{
  "timestamp": "2026-05-03T12:00:00Z",
  "tool": "godot_add_node",
  "params": {},
  "result": "ok",
  "duration_ms": 42
}
```

### 8.3.7 Confirmação para ações críticas

Algumas ações devem exigir confirmação ou estar bloqueadas por padrão:

```text
- delete_file_safe
- remove_scene
- bulk_rename
- refactor_safely com muitos arquivos
- clear_project_cache
- overwrite_scene
```

---

# 9. Guia de Desenvolvimento

## 9.1 Requisitos

- Godot 4.2 ou superior;
- Node.js 18 ou superior;
- npm ou pnpm;
- Cliente MCP compatível;
- Sistema operacional Windows, Linux ou macOS.

## 9.2 Instalação local planejada

```bash
npm install
npm run build
```

Dentro da Godot:

1. Copiar `addons/godot_devpilot_mcp` para o projeto;
2. Abrir `Project > Project Settings > Plugins`;
3. Ativar `Godot DevPilot MCP`;
4. Verificar se a porta WebSocket foi iniciada;
5. Configurar o cliente MCP para apontar para o servidor.

## 9.3 Configuração MCP exemplo

```json
{
  "mcpServers": {
    "godot-devpilot-mcp": {
      "command": "node",
      "args": [
        "C:/caminho/godot-devpilot-mcp/mcp-server/dist/index.js"
      ],
      "env": {
        "GODOT_MCP_PORT": "6505",
        "GODOT_MCP_MODE": "core"
      }
    }
  }
}
```

## 9.4 Convenções de código

### TypeScript

- Usar `strict: true`;
- Validar entradas com Zod;
- Não confiar em parâmetros vindos da IA;
- Separar tool registration da lógica de negócio;
- Usar erros tipados;
- Manter schemas versionados.

### GDScript

- Usar `@tool` nos scripts do plugin;
- Separar dispatcher de handlers;
- Não colocar lógica extensa em `plugin.gd`;
- Usar `EditorInterface` para acessar cena atual;
- Usar UndoRedo em mutações;
- Retornar dicionários padronizados.

---

# 10. Protocolo Interno

## 10.1 Requisição

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "method": "scene.add_node",
  "params": {
    "parent_path": ".",
    "type": "CharacterBody2D",
    "name": "Player"
  }
}
```

## 10.2 Resposta de sucesso

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "result": {
    "ok": true,
    "data": {
      "node_path": "Player"
    },
    "message": "Nó criado com sucesso.",
    "warnings": [],
    "suggestions": []
  }
}
```

## 10.3 Resposta de erro

```json
{
  "jsonrpc": "2.0",
  "id": "request-001",
  "error": {
    "code": "INVALID_NODE_TYPE",
    "message": "O tipo de nó informado não existe na ClassDB.",
    "details": {
      "type": "CharacterBodi2D"
    },
    "suggestions": [
      "Verifique se o tipo correto seria CharacterBody2D."
    ]
  }
}
```

---

# 11. Exemplos de Fluxos

## 11.1 Criar player 2D

Pedido do usuário:

```text
Crie um player 2D com movimento top-down.
```

Fluxo esperado:

```text
1. godot_create_scene
2. godot_add_node CharacterBody2D
3. godot_add_node Sprite2D
4. godot_add_node CollisionShape2D
5. godot_add_node Camera2D
6. godot_create_script PlayerController.gd
7. godot_attach_script
8. godot_add_input_action move_left
9. godot_add_input_action move_right
10. godot_add_input_action move_up
11. godot_add_input_action move_down
12. godot_validate_script
13. godot_save_scene
14. godot_run_scene
15. godot_get_errors
```

## 11.2 Corrigir erro de script

Pedido do usuário:

```text
Rode o projeto e corrija os erros.
```

Fluxo esperado:

```text
1. godot_run_project
2. godot_get_output_logs
3. godot_get_debugger_errors
4. godot_read_script
5. godot_patch_script
6. godot_validate_script
7. godot_run_project
8. godot_assert_no_errors
```

## 11.3 Verificar impacto de alteração

Pedido do usuário:

```text
Posso renomear o sinal health_changed para player_health_changed?
```

Fluxo esperado:

```text
1. godot_analyze_signal_flow
2. godot_find_references
3. godot_impact_check
4. godot_refactor_safely com dry_run
5. relatório de impacto
```

---

# 12. Critérios de Qualidade

## 12.1 Qualidade técnica

- Ferramentas pequenas e previsíveis;
- Ferramentas agentic compostas, mas auditáveis;
- Logs completos;
- Tratamento robusto de erro;
- Sem acesso fora do projeto;
- Testes automatizados;
- Documentação atualizada.

## 12.2 Qualidade de uso com IA

Uma ferramenta é considerada boa quando:

- O nome é claro;
- O schema é específico;
- A descrição ajuda o modelo a escolher corretamente;
- O retorno é estruturado;
- Os erros são acionáveis;
- A ferramenta não exige contexto oculto;
- A ferramenta reduz ambiguidade.

## 12.3 Critério de versão 1.0

A versão 1.0 deve permitir:

```text
- Conectar cliente MCP à Godot;
- Ler projeto;
- Criar/editar arquivos;
- Criar/editar cenas;
- Criar/editar nós;
- Criar/anexar scripts;
- Rodar cenas;
- Ler erros;
- Capturar screenshot;
- Simular input básico;
- Executar UndoRedo nas mutações principais;
- Gerar project summary;
- Mapear dependências básicas;
- Mapear sinais básicos;
- Criar um protótipo 2D jogável simples.
```

---

# 13. README Inicial

## Godot DevPilot MCP

**Godot DevPilot MCP** é uma integração open source entre assistentes de IA e a engine Godot por meio do Model Context Protocol.

O projeto permite que clientes compatíveis com MCP interajam com o editor Godot para criar cenas, editar scripts, manipular nós, rodar o jogo, capturar erros, simular input e validar alterações.

### Objetivo

Criar uma alternativa aberta, extensível e robusta a soluções pagas de MCP para Godot, com foco em desenvolvimento real de games.

### Funcionalidades planejadas

- Controle do editor Godot por IA;
- Manipulação de cenas e nós;
- Leitura e escrita de scripts;
- Validação de GDScript;
- Debug loop com logs e erros;
- Screenshots do editor e do jogo;
- Simulação de input;
- Análise de sinais;
- Grafo de dependências;
- Memória do projeto;
- Toolkits 2D e 3D;
- Ferramentas agentic para criação de features completas.

### Status

Projeto em fase de planejamento e documentação inicial.

### Arquitetura

```text
AI Client → MCP Server → WebSocket → Godot Plugin → Godot Editor
```

### Licença

A licença ainda deve ser definida. Sugestão inicial: MIT ou Apache 2.0.

---

# 14. Próximos Arquivos a Criar no Repositório

Quando o repositório for iniciado, recomenda-se criar os seguintes arquivos:

```text
README.md
docs/ARCHITECTURE.md
docs/TOOL_GAP_ANALYSIS.md
docs/TOOL_SPECIFICATION.md
docs/ROADMAP.md
docs/SECURITY.md
docs/DEVELOPMENT_GUIDE.md
docs/CONTRIBUTING.md
```

Ordem recomendada de implementação:

```text
1. README.md
2. ARCHITECTURE.md
3. ROADMAP.md
4. TOOL_SPECIFICATION.md
5. SECURITY.md
6. DEVELOPMENT_GUIDE.md
7. TOOL_GAP_ANALYSIS.md
8. CONTRIBUTING.md
```

---

# 15. Conclusão

O Godot DevPilot MCP deve ser construído como uma camada de automação e inteligência sobre a Godot.

A vantagem competitiva do projeto não deve estar apenas na quantidade de ferramentas, mas na combinação de:

```text
- segurança;
- UndoRedo;
- debug loop;
- screenshots;
- input simulation;
- análise de dependências;
- signal flow;
- memória do projeto;
- ferramentas agentic;
- criação de sistemas completos de gameplay.
```

A base open source existente pode acelerar a implementação, mas a evolução deve seguir uma arquitetura própria, modular, segura e orientada a desenvolvimento real de jogos.

