# Roadmap — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento define o roadmap de desenvolvimento do **Godot DevPilot MCP**.

O roadmap organiza a evolução do projeto em fases técnicas, cada uma com:

- Objetivo;
- Escopo;
- Entregáveis;
- Critérios de conclusão;
- Prioridade;
- Dependências;
- Riscos principais.

A meta é evoluir o projeto de uma base MCP funcional para uma plataforma robusta de desenvolvimento de jogos com IA integrada à Godot.

---

## 2. Estratégia geral

O projeto não deve começar tentando implementar centenas de ferramentas.

A ordem correta é:

```text
1. Conexão confiável
2. Segurança
3. Manipulação básica de projeto
4. Manipulação segura de cenas, nós e scripts
5. Debug loop
6. Screenshots e input simulation
7. Inteligência estrutural
8. Toolkits 2D/3D
9. Ferramentas agentic
```

Essa ordem evita criar uma grande quantidade de ferramentas instáveis, inseguras ou difíceis de manter.

---

## 3. Fases do roadmap

```text
Fase 0 — Preparação e auditoria
Fase 1 — Core MCP e protocolo
Fase 2 — Segurança e confiabilidade
Fase 3 — Ferramentas essenciais de projeto
Fase 4 — Cenas, nós e UndoRedo
Fase 5 — Scripts e validação GDScript
Fase 6 — Debug loop
Fase 7 — Screenshots e input simulation
Fase 8 — Runtime analysis
Fase 9 — Project intelligence
Fase 10 — Project memory
Fase 11 — Toolkits 2D
Fase 12 — Toolkits 3D
Fase 13 — Toolkits especializados
Fase 14 — Testes automatizados
Fase 15 — Ferramentas agentic
Fase 16 — Preparação da versão 1.0
```

---

# 4. Fase 0 — Preparação e auditoria

## 4.1 Objetivo

Entender a base open source existente, preparar a estrutura do repositório e definir os documentos técnicos iniciais.

## 4.2 Escopo

- Estudar `tomyud1/godot-mcp`;
- Rodar a base localmente;
- Mapear arquitetura atual;
- Mapear ferramentas existentes;
- Identificar pontos reutilizáveis;
- Identificar pontos que precisam ser reescritos;
- Criar documentação inicial;
- Definir nome, estrutura e licença do projeto.

## 4.3 Entregáveis

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

## 4.4 Critérios de conclusão

```text
[ ] Base open source analisada
[ ] Ferramentas existentes catalogadas
[ ] Estrutura planejada do projeto definida
[ ] Documentação inicial criada
[ ] Decisão de licença registrada
[ ] Ambiente local validado
```

## 4.5 Prioridade

Crítica.

## 4.6 Riscos

```text
- Subestimar complexidade da base existente
- Reaproveitar código sem entender arquitetura
- Criar documentação distante da implementação real
```

---

# 5. Fase 1 — Core MCP e protocolo

## 5.1 Objetivo

Criar a base de comunicação entre cliente IA, servidor MCP e plugin Godot.

## 5.2 Escopo

- Servidor MCP em TypeScript;
- Plugin Godot com WebSocket local;
- Protocolo interno JSON-RPC 2.0;
- Health check;
- Ping;
- Capabilities;
- Versionamento de protocolo;
- Timeouts;
- Tratamento básico de erro.

## 5.3 Ferramentas previstas

```text
godot_health_check
godot_ping
godot_get_capabilities
godot_get_connection_status
godot_get_protocol_version
```

## 5.4 Entregáveis

```text
mcp-server/src/index.ts
mcp-server/src/godot/client.ts
mcp-server/src/godot/protocol.ts
mcp-server/src/config/config.ts
addons/godot_devpilot_mcp/plugin.gd
addons/godot_devpilot_mcp/core/rpc_server.gd
addons/godot_devpilot_mcp/core/dispatcher.gd
addons/godot_devpilot_mcp/core/response_factory.gd
```

## 5.5 Critérios de conclusão

```text
[ ] Cliente MCP inicia servidor
[ ] Servidor conecta ao plugin Godot
[ ] Plugin responde health_check
[ ] JSON-RPC interno funcionando
[ ] Erros de conexão são claros
[ ] Timeout configurável funcionando
[ ] Capabilities retornam modo e recursos disponíveis
```

## 5.6 Prioridade

Crítica.

## 5.7 Dependências

Fase 0.

## 5.8 Riscos

```text
- Instabilidade na conexão WebSocket
- Diferenças entre versões da Godot
- Falta de mensagens de erro úteis
```

---

# 6. Fase 2 — Segurança e confiabilidade

## 6.1 Objetivo

Garantir que a IA não consiga executar alterações perigosas sem proteção.

## 6.2 Escopo

- Path sandbox;
- Bloqueio fora de `res://`;
- Modo read-only;
- Backup automático;
- `dry_run`;
- Logs auditáveis;
- Permission presets;
- Safe trash;
- Normalização de erros;
- Validação duplicada no servidor e no plugin.

## 6.3 Ferramentas e recursos previstos

```text
pathGuard
backupService
dryRunService
permissionService
actionLogger
safeTrash
readOnlyMode
```

## 6.4 Entregáveis

```text
mcp-server/src/safety/pathGuard.ts
mcp-server/src/safety/backup.ts
mcp-server/src/safety/dryRun.ts
mcp-server/src/safety/permissions.ts
mcp-server/src/utils/logger.ts
addons/godot_devpilot_mcp/core/permissions.gd
addons/godot_devpilot_mcp/core/protocol.gd
.godot_mcp/backups/
.godot_mcp/logs/actions.jsonl
.godot_mcp/trash/
```

## 6.5 Critérios de conclusão

```text
[ ] Paths fora de res:// são bloqueados
[ ] Modo read-only bloqueia ferramentas mutáveis
[ ] Alterações em arquivo criam backup
[ ] Ferramentas destrutivas aceitam dry_run
[ ] Logs são registrados em JSONL
[ ] Exclusão segura move para trash em vez de apagar definitivamente
[ ] Erros têm código, mensagem, detalhes e sugestões
```

## 6.6 Prioridade

Crítica.

## 6.7 Dependências

Fase 1.

## 6.8 Riscos

```text
- Segurança aplicada apenas no servidor e não no plugin
- Backups excessivos ocuparem muito espaço
- dry_run divergir da execução real
```

---

# 7. Fase 3 — Ferramentas essenciais de projeto

## 7.1 Objetivo

Permitir que a IA entenda o contexto básico do projeto Godot.

## 7.2 Escopo

- Informações do projeto;
- Versão da Godot;
- Configurações principais;
- Cena principal;
- Contexto atual do editor;
- Cenas abertas;
- Nós selecionados;
- Input Map;
- Autoloads.

## 7.3 Ferramentas previstas

```text
godot_get_project_info
godot_get_project_settings
godot_get_godot_version
godot_get_editor_context
godot_get_open_scenes
godot_get_selected_nodes
godot_get_input_map
godot_add_input_action
godot_remove_input_action
godot_get_autoloads
godot_add_autoload
godot_remove_autoload
```

## 7.4 Entregáveis

```text
mcp-server/src/tools/projectTools.ts
addons/godot_devpilot_mcp/tools/project_tools.gd
```

## 7.5 Critérios de conclusão

```text
[ ] IA consegue saber nome, caminho e versão do projeto
[ ] IA consegue identificar cena atual
[ ] IA consegue listar ações do Input Map
[ ] IA consegue criar ações de Input Map com dry_run
[ ] IA consegue consultar Autoloads
[ ] Respostas são compactas e úteis para contexto
```

## 7.6 Prioridade

Alta.

## 7.7 Dependências

Fases 1 e 2.

## 7.8 Riscos

```text
- Retornos grandes demais para uso por IA
- Alterações de Input Map sem persistência correta
- Autoloads mal configurados quebrarem o projeto
```

---

# 8. Fase 4 — Cenas, nós e UndoRedo

## 8.1 Objetivo

Permitir manipulação segura de cenas e nós dentro do editor Godot.

## 8.2 Escopo

- Criar cena;
- Abrir cena;
- Salvar cena;
- Duplicar cena;
- Obter árvore da cena;
- Resumir cena;
- Validar cena;
- Adicionar nós;
- Remover nós;
- Renomear nós;
- Duplicar nós;
- Reparentar nós;
- Alterar propriedades;
- Gerenciar grupos;
- Usar UndoRedo em mutações.

## 8.3 Ferramentas previstas

```text
godot_create_scene
godot_open_scene
godot_save_scene
godot_duplicate_scene
godot_get_scene_tree
godot_get_scene_summary
godot_validate_scene
godot_audit_scene
godot_add_node
godot_remove_node
godot_rename_node
godot_duplicate_node
godot_reparent_node
godot_get_node_properties
godot_set_node_property
godot_get_node_groups
godot_add_node_to_group
godot_remove_node_from_group
```

## 8.4 Entregáveis

```text
mcp-server/src/tools/sceneTools.ts
mcp-server/src/tools/nodeTools.ts
addons/godot_devpilot_mcp/tools/scene_tools.gd
addons/godot_devpilot_mcp/tools/node_tools.gd
addons/godot_devpilot_mcp/core/undo_service.gd
```

## 8.5 Critérios de conclusão

```text
[ ] IA consegue criar cena com root node válido
[ ] IA consegue abrir e salvar cena
[ ] IA consegue obter árvore de cena compacta
[ ] IA consegue adicionar nó com UndoRedo
[ ] IA consegue remover nó com UndoRedo
[ ] IA consegue alterar propriedade com UndoRedo
[ ] IA não consegue remover root node sem confirmação
[ ] Tipos de nós são validados via ClassDB
[ ] Propriedades inválidas retornam erro acionável
```

## 8.6 Prioridade

Alta.

## 8.7 Dependências

Fases 1, 2 e 3.

## 8.8 Riscos

```text
- UndoRedo não cobrir todas as mutações
- Propriedades complexas não serem convertidas corretamente
- Cenas serem salvas em estado inválido
```

---

# 9. Fase 5 — Scripts e validação GDScript

## 9.1 Objetivo

Permitir criação, edição, anexação e validação de scripts GDScript com foco em Godot 4.x.

## 9.2 Escopo

- Criar script;
- Ler script;
- Aplicar patch;
- Anexar script a nó;
- Validar sintaxe;
- Detectar padrões incompatíveis com Godot 4;
- Buscar símbolos;
- Buscar referências;
- Mapear dependências;
- Consultar ClassDB.

## 9.3 Ferramentas previstas

```text
godot_create_script
godot_read_script
godot_patch_script
godot_attach_script
godot_validate_script
godot_format_script
godot_get_script_symbols
godot_get_script_dependencies
godot_find_references
godot_get_classdb_info
```

## 9.4 Entregáveis

```text
mcp-server/src/tools/scriptTools.ts
addons/godot_devpilot_mcp/tools/script_tools.gd
addons/godot_devpilot_mcp/analyzers/script_analyzer.gd
```

## 9.5 Critérios de conclusão

```text
[ ] IA consegue criar script Godot 4 válido
[ ] IA consegue anexar script a nó com UndoRedo
[ ] IA consegue aplicar patch com backup
[ ] Validação detecta erro de sintaxe
[ ] Validação aponta arquivo e linha quando possível
[ ] Analyzer detecta classes, métodos, sinais e exports básicos
[ ] ClassDB retorna informação útil sobre classes Godot
```

## 9.6 Prioridade

Alta.

## 9.7 Dependências

Fases 2 e 4.

## 9.8 Riscos

```text
- Validação de GDScript ser limitada fora do runtime
- IA gerar sintaxe antiga de Godot 3
- Patches causarem alterações fora do escopo
```

---

# 10. Fase 6 — Debug loop

## 10.1 Objetivo

Permitir que a IA execute o projeto, leia erros, corrija scripts e valide novamente.

## 10.2 Escopo

- Rodar projeto;
- Rodar cena atual;
- Parar execução;
- Ler output logs;
- Ler debugger errors;
- Ler script parse errors;
- Limpar logs;
- Criar relatório da última execução;
- Criar assertion de ausência de erros;
- Criar primeira versão de `godot_fix_errors`.

## 10.3 Ferramentas previstas

```text
godot_run_project
godot_run_scene
godot_stop_project
godot_is_game_running
godot_get_output_logs
godot_get_debugger_errors
godot_get_script_parse_errors
godot_clear_logs
godot_get_last_run_report
godot_assert_no_errors
godot_fix_errors
```

## 10.4 Entregáveis

```text
mcp-server/src/tools/runtimeTools.ts
mcp-server/src/tools/debugTools.ts
addons/godot_devpilot_mcp/tools/runtime_tools.gd
addons/godot_devpilot_mcp/tools/debug_tools.gd
.godot_mcp/logs/run_reports/
```

## 10.5 Critérios de conclusão

```text
[ ] IA consegue rodar projeto
[ ] IA consegue parar projeto
[ ] IA consegue ler logs recentes
[ ] IA consegue identificar erro com arquivo e linha
[ ] IA consegue aplicar correção simples
[ ] IA consegue rodar novamente
[ ] IA consegue confirmar ausência de erros
```

## 10.6 Prioridade

Alta.

## 10.7 Dependências

Fases 3, 4 e 5.

## 10.8 Riscos

```text
- Acesso aos logs da Godot ser limitado
- Erros não virem estruturados
- Runtime travar e exigir timeout
- Correção automática aplicar patch errado
```

---

# 11. Fase 7 — Screenshots e input simulation

## 11.1 Objetivo

Dar à IA capacidade de observar visualmente o jogo/editor e interagir com o jogo em execução.

## 11.2 Escopo

- Screenshot do jogo;
- Screenshot do editor;
- Screenshot do viewport;
- Pressionar/relevar ações do Input Map;
- Pressionar teclas;
- Simular mouse;
- Executar sequência de input;
- Criar base para testes E2E.

## 11.3 Ferramentas previstas

```text
godot_take_game_screenshot
godot_take_editor_screenshot
godot_get_viewport_image
godot_compare_screenshots
godot_press_key
godot_release_key
godot_tap_key
godot_mouse_move
godot_mouse_click
godot_mouse_drag
godot_press_action
godot_release_action
godot_run_input_sequence
```

## 11.4 Entregáveis

```text
mcp-server/src/tools/screenshotTools.ts
mcp-server/src/tools/inputTools.ts
addons/godot_devpilot_mcp/tools/screenshot_tools.gd
addons/godot_devpilot_mcp/tools/input_tools.gd
.godot_mcp/screenshots/
```

## 11.5 Critérios de conclusão

```text
[ ] IA consegue capturar screenshot do jogo
[ ] IA consegue capturar screenshot do editor
[ ] IA consegue pressionar ação do Input Map
[ ] IA consegue executar sequência de input
[ ] Screenshot é associado à execução atual
[ ] Falhas de screenshot retornam erro claro
```

## 11.6 Prioridade

Média/Alta.

## 11.7 Dependências

Fase 6.

## 11.8 Riscos

```text
- Captura de janela variar por sistema operacional
- Input simulation não funcionar igualmente em editor e runtime
- Screenshots grandes consumirem armazenamento
```

---

# 12. Fase 8 — Runtime analysis

## 12.1 Objetivo

Permitir inspeção do jogo enquanto ele está rodando.

## 12.2 Escopo

- Árvore de runtime;
- Propriedades de nós em runtime;
- Alteração temporária de propriedades;
- Localização de nós por nome, tipo ou grupo;
- FPS;
- Estatísticas básicas;
- Wait conditions;
- Estado da câmera atual;
- Estado de UI.

## 12.3 Ferramentas previstas

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

## 12.4 Entregáveis

```text
mcp-server/src/tools/runtimeTools.ts
addons/godot_devpilot_mcp/tools/runtime_tools.gd
addons/godot_devpilot_mcp/analyzers/runtime_analyzer.gd
```

## 12.5 Critérios de conclusão

```text
[ ] IA consegue listar runtime tree
[ ] IA consegue obter propriedades de nó em runtime
[ ] IA consegue aguardar condição simples
[ ] IA consegue localizar nó por tipo ou grupo
[ ] IA consegue consultar FPS
[ ] Runtime analysis funciona junto com input simulation
```

## 12.6 Prioridade

Média/Alta.

## 12.7 Dependências

Fases 6 e 7.

## 12.8 Riscos

```text
- Diferença entre árvore do editor e árvore runtime
- Nós criados dinamicamente dificultarem mapeamento
- Excesso de dados gerar respostas grandes demais
```

---

# 13. Fase 9 — Project intelligence

## 13.1 Objetivo

Permitir que a IA entenda o projeto como um sistema de cenas, scripts, sinais, assets e dependências.

## 13.2 Escopo

- Indexar scripts;
- Indexar cenas;
- Indexar assets;
- Criar grafo de dependências;
- Criar mapa de sinais;
- Detectar sistemas de gameplay;
- Fazer análise de impacto;
- Rastrear fluxo entre objetos;
- Auditar arquitetura.

## 13.3 Ferramentas previstas

```text
godot_project_summary
godot_build_dependency_graph
godot_get_dependency_graph
godot_build_signal_map
godot_get_signal_map
godot_impact_check
godot_trace_flow
godot_detect_gameplay_systems
godot_analyze_architecture
godot_validate_conventions
```

## 13.4 Entregáveis

```text
mcp-server/src/indexer/projectIndexer.ts
mcp-server/src/indexer/scriptIndexer.ts
mcp-server/src/indexer/sceneIndexer.ts
mcp-server/src/indexer/dependencyGraph.ts
addons/godot_devpilot_mcp/analyzers/scene_analyzer.gd
addons/godot_devpilot_mcp/analyzers/script_analyzer.gd
addons/godot_devpilot_mcp/analyzers/signal_analyzer.gd
.godot_mcp/index/scripts.json
.godot_mcp/index/scenes.json
.godot_mcp/index/assets.json
.godot_mcp/index/signals.json
.godot_mcp/index/dependencies.json
```

## 13.5 Critérios de conclusão

```text
[ ] IA consegue obter resumo do projeto
[ ] IA consegue listar cenas e scripts indexados
[ ] IA consegue consultar dependências de arquivo
[ ] IA consegue consultar sinais emitidos e conectados
[ ] IA consegue fazer impact_check de alteração simples
[ ] IA consegue rastrear fluxo básico entre sinal e método
```

## 13.6 Prioridade

Média/Alta.

## 13.7 Dependências

Fases 4, 5 e 6.

## 13.8 Riscos

```text
- Parser de GDScript incompleto
- Cenas complexas difíceis de analisar estaticamente
- Cache ficar desatualizado
```

---

# 14. Fase 10 — Project memory

## 14.1 Objetivo

Criar uma memória persistente do projeto para reduzir perda de contexto entre sessões e auxiliar a IA em decisões futuras.

## 14.2 Escopo

- Resumo do projeto;
- Convenções do projeto;
- Decisões técnicas;
- Sistemas de gameplay existentes;
- Histórico de alterações relevantes;
- Contexto da tarefa atual.

## 14.3 Ferramentas previstas

```text
godot_update_project_memory
godot_get_project_memory
godot_get_architecture_notes
godot_get_conventions
godot_set_convention
godot_create_decision_record
godot_search_memory
godot_get_current_task_context
```

## 14.4 Entregáveis

```text
mcp-server/src/memory/memoryStore.ts
mcp-server/src/memory/projectSummary.ts
mcp-server/src/memory/decisionRecords.ts
.godot_mcp/memory/project_summary.md
.godot_mcp/memory/architecture.md
.godot_mcp/memory/conventions.md
.godot_mcp/memory/decisions.md
.godot_mcp/memory/gameplay_systems.md
```

## 14.5 Critérios de conclusão

```text
[ ] IA consegue ler memória do projeto
[ ] IA consegue atualizar resumo do projeto
[ ] IA consegue registrar decisão técnica
[ ] IA consegue consultar convenções
[ ] Memória não substitui leitura real dos arquivos
[ ] Memória é compacta e útil para contexto
```

## 14.6 Prioridade

Média.

## 14.7 Dependências

Fase 9.

## 14.8 Riscos

```text
- Memória ficar desatualizada
- IA confiar na memória em vez de ler arquivos reais
- Arquivos de memória crescerem demais
```

---

# 15. Fase 11 — Toolkits 2D

## 15.1 Objetivo

Acelerar criação de jogos 2D com ferramentas compostas e templates funcionais.

## 15.2 Escopo

- Player 2D;
- Controller top-down;
- Controller platformer;
- Inimigo simples;
- Coletável;
- Câmera 2D;
- Colisão 2D;
- Trigger Area2D;
- TileMap;
- Parallax background;
- Health system;
- Inventory UI.

## 15.3 Ferramentas previstas

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

## 15.4 Entregáveis

```text
mcp-server/src/tools/toolkit2dTools.ts
addons/godot_devpilot_mcp/tools/toolkit_2d_tools.gd
templates/2d/player_topdown/
templates/2d/player_platformer/
templates/2d/health_system/
templates/2d/inventory_ui/
```

## 15.5 Critérios de conclusão

```text
[ ] IA consegue criar player top-down funcional
[ ] IA consegue criar player platformer funcional
[ ] IA consegue configurar Input Map automaticamente
[ ] IA consegue criar health system básico
[ ] IA consegue criar cena 2D jogável mínima
[ ] Scripts gerados validam em Godot 4.x
```

## 15.6 Prioridade

Média.

## 15.7 Dependências

Fases 4, 5, 6 e 7.

## 15.8 Riscos

```text
- Templates ficarem rígidos demais
- Geração de scripts sem considerar arquitetura do projeto
- Controllers não funcionarem em todos os estilos de jogo
```

---

# 16. Fase 12 — Toolkits 3D

## 16.1 Objetivo

Acelerar criação de jogos 3D com cenas, personagens, câmeras, iluminação e colisão.

## 16.2 Escopo

- MeshInstance3D;
- Primitivas 3D;
- Importação glTF/GLB;
- Camera3D;
- Iluminação;
- WorldEnvironment;
- CharacterBody3D;
- Colisão 3D;
- RayCast3D;
- NavigationRegion3D;
- Bake navmesh;
- Controller third-person.

## 16.3 Ferramentas previstas

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

## 16.4 Entregáveis

```text
mcp-server/src/tools/toolkit3dTools.ts
addons/godot_devpilot_mcp/tools/toolkit_3d_tools.gd
templates/3d/third_person_controller/
templates/3d/basic_level/
templates/3d/navigation_agent/
```

## 16.5 Critérios de conclusão

```text
[ ] IA consegue criar cena 3D básica
[ ] IA consegue configurar câmera, luz e ambiente
[ ] IA consegue criar CharacterBody3D com colisão
[ ] IA consegue criar controller third-person simples
[ ] IA consegue configurar navegação básica
```

## 16.6 Prioridade

Média.

## 16.7 Dependências

Fases 4, 5, 6 e 8.

## 16.8 Riscos

```text
- 3D exigir mais validação visual
- Importação de assets variar conforme projeto
- Navegação e colisão exigirem ajustes manuais
```

---

# 17. Fase 13 — Toolkits especializados

## 17.1 Objetivo

Expandir o suporte para áreas específicas da Godot.

## 17.2 Escopo

Toolkits previstos:

```text
- Physics Toolkit
- Animation Toolkit
- Audio Toolkit
- Particles/VFX Toolkit
- Shader/Material Toolkit
- Navigation Toolkit
```

## 17.3 Ferramentas previstas

### Physics

```text
godot_setup_physics_body
godot_setup_collision_shape
godot_set_collision_layers
godot_get_collision_info
godot_audit_collision_setup
godot_add_raycast
godot_test_collision_between
godot_fix_missing_collision_shapes
```

### Animation

```text
godot_create_animation_player
godot_add_animation
godot_add_keyframe
godot_create_animation_tree
godot_setup_state_machine
godot_setup_blend_tree
godot_get_animation_list
godot_preview_animation
godot_audit_animation_references
```

### Audio

```text
godot_create_audio_bus
godot_add_audio_effect
godot_create_audio_stream_player
godot_assign_audio_file
godot_play_audio_preview
godot_get_audio_buses
godot_set_bus_volume
godot_audit_missing_audio
```

### Particles/VFX

```text
godot_create_gpu_particles_2d
godot_create_gpu_particles_3d
godot_apply_particle_preset
godot_create_explosion_effect
godot_create_fire_effect
godot_create_smoke_effect
godot_create_trail_effect
godot_preview_particles
```

### Shader/Material

```text
godot_create_shader
godot_attach_shader
godot_validate_shader
godot_create_canvas_item_material
godot_create_standard_3d_material
godot_set_pbr_material
godot_create_outline_shader
godot_create_dissolve_shader
godot_create_water_shader
godot_preview_material
```

## 17.4 Critérios de conclusão

```text
[ ] Cada toolkit possui pelo menos 3 ferramentas úteis
[ ] Cada toolkit possui exemplos documentados
[ ] Ferramentas respeitam UndoRedo quando aplicável
[ ] Ferramentas geram warnings úteis
[ ] Ferramentas não quebram cenas existentes
```

## 17.5 Prioridade

Baixa/Média.

## 17.6 Dependências

Fases 11 e 12.

## 17.7 Riscos

```text
- Escopo crescer demais
- Ferramentas especializadas serem difíceis de testar
- Excesso de ferramentas prejudicar clientes MCP
```

---

# 18. Fase 14 — Testes automatizados

## 18.1 Objetivo

Criar base para testes automatizados de cenas, scripts e fluxos interativos.

## 18.2 Escopo

- Cenários de teste;
- Assertions;
- Input sequences;
- Screenshot matching;
- Stress test;
- Testes de regressão;
- Relatórios de teste.

## 18.3 Ferramentas previstas

```text
godot_create_test_scenario
godot_run_test_scenario
godot_assert_node_exists
godot_assert_property_equals
godot_assert_signal_emitted
godot_assert_no_errors
godot_assert_screenshot_matches
godot_stress_test_scene
godot_generate_regression_test
```

## 18.4 Entregáveis

```text
mcp-server/src/tools/testTools.ts
addons/godot_devpilot_mcp/tools/test_tools.gd
.godot_mcp/tests/
.godot_mcp/test_reports/
```

## 18.5 Critérios de conclusão

```text
[ ] IA consegue criar cenário de teste simples
[ ] IA consegue rodar teste
[ ] IA consegue validar ausência de erros
[ ] IA consegue validar existência de nó
[ ] IA consegue executar input sequence em teste
[ ] Relatório de teste é salvo
```

## 18.6 Prioridade

Média.

## 18.7 Dependências

Fases 6, 7 e 8.

## 18.8 Riscos

```text
- Testes frágeis por depender de tempo
- Screenshot matching gerar falsos positivos/negativos
- Diferenças entre sistemas operacionais
```

---

# 19. Fase 15 — Ferramentas agentic

## 19.1 Objetivo

Criar ferramentas compostas capazes de planejar, executar, validar e reportar tarefas maiores.

## 19.2 Escopo

- Corrigir erros;
- Criar feature completa;
- Criar sistema de gameplay;
- Refatorar com segurança;
- Criar protótipo jogável;
- Gerar cena a partir de prompt;
- Rodar ciclo de validação.

## 19.3 Ferramentas previstas

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

## 19.4 Entregáveis

```text
mcp-server/src/tools/agenticTools.ts
mcp-server/src/agents/featureBuilder.ts
mcp-server/src/agents/errorFixer.ts
mcp-server/src/agents/refactorPlanner.ts
mcp-server/src/agents/validationLoop.ts
.godot_mcp/reports/agentic/
```

## 19.5 Critérios de conclusão

```text
[ ] Ferramentas agentic executam primeiro em dry_run
[ ] Plano é apresentado antes de aplicar alterações
[ ] Escopo é limitado por parâmetro
[ ] Backups são criados antes de aplicar
[ ] Validação final é executada
[ ] Relatório final é salvo
[ ] Usuário consegue auditar arquivos alterados
```

## 19.6 Prioridade

Média, após core estável.

## 19.7 Dependências

Fases 6, 7, 8, 9 e 10.

## 19.8 Riscos

```text
- Ferramentas agentic fazerem mudanças amplas demais
- Dificuldade de prever impacto completo
- Necessidade de confirmação explícita em tarefas grandes
```

---

# 20. Fase 16 — Preparação da versão 1.0

## 20.1 Objetivo

Consolidar uma versão estável, documentada e utilizável por desenvolvedores Godot.

## 20.2 Escopo

- Revisar documentação;
- Criar exemplos;
- Criar projeto demo;
- Criar testes automatizados;
- Fechar ferramentas da versão 1.0;
- Definir licença;
- Criar guia de instalação;
- Criar guia de troubleshooting;
- Criar release inicial.

## 20.3 Entregáveis

```text
README.md atualizado
docs/INSTALLATION.md
docs/TROUBLESHOOTING.md
docs/EXAMPLES.md
docs/API_REFERENCE.md
examples/demo_2d_project/
examples/demo_3d_project/
CHANGELOG.md
LICENSE
v1.0.0 release
```

## 20.4 Critérios de conclusão

```text
[ ] Instalação documentada
[ ] Projeto demo funcionando
[ ] Ferramentas core testadas
[ ] Segurança validada
[ ] UndoRedo validado
[ ] Debug loop funcionando
[ ] Screenshot e input funcionando
[ ] Project summary funcionando
[ ] Release versionada publicada
```

## 20.5 Prioridade

Alta quando as fases anteriores essenciais estiverem completas.

## 20.6 Dependências

Fases 1 a 10, pelo menos parcialmente.

## 20.7 Riscos

```text
- Escopo da 1.0 ficar grande demais
- Documentação não acompanhar implementação
- Falta de testes em sistemas operacionais diferentes
```

---

# 21. Marcos de versão

## 21.1 Versão 0.1.0 — Conexão básica

Objetivo:

```text
IA conecta à Godot e executa ferramentas de leitura básicas.
```

Inclui:

```text
- MCP server inicial
- Plugin Godot inicial
- WebSocket local
- health_check
- project_info
- editor_context
- get_scene_tree
```

## 21.2 Versão 0.2.0 — Arquivos e segurança

Inclui:

```text
- path sandbox
- read_file
- write_file
- patch_file
- backup
- logs
- read-only
- dry_run
```

## 21.3 Versão 0.3.0 — Cenas e nós

Inclui:

```text
- create_scene
- open_scene
- save_scene
- add_node
- remove_node
- set_node_property
- UndoRedo inicial
```

## 21.4 Versão 0.4.0 — Scripts

Inclui:

```text
- create_script
- read_script
- patch_script
- attach_script
- validate_script
- ClassDB info
```

## 21.5 Versão 0.5.0 — Debug loop

Inclui:

```text
- run_project
- run_scene
- stop_project
- output_logs
- debugger_errors
- assert_no_errors
- fix_errors inicial
```

## 21.6 Versão 0.6.0 — Visual e input

Inclui:

```text
- game screenshot
- editor screenshot
- press_action
- release_action
- run_input_sequence
```

## 21.7 Versão 0.7.0 — Runtime analysis

Inclui:

```text
- runtime_tree
- runtime_node_properties
- fps
- wait_for_condition
- find_runtime_node
```

## 21.8 Versão 0.8.0 — Project intelligence

Inclui:

```text
- project_summary
- script indexer
- scene indexer
- dependency graph
- signal map
- impact_check
```

## 21.9 Versão 0.9.0 — Toolkits básicos

Inclui:

```text
- 2D player toolkit
- top-down controller
- platformer controller
- health system
- basic 3D scene toolkit
```

## 21.10 Versão 1.0.0 — Release estável

Inclui:

```text
- Core tools estáveis
- Segurança validada
- UndoRedo validado
- Debug loop funcional
- Screenshots e input simulation
- Project intelligence básica
- Documentação completa
- Projeto demo
```

---

# 22. Matriz de prioridade por valor

## 22.1 Alto valor e baixa complexidade

Implementar primeiro.

```text
- health_check
- project_info
- read_file
- list_files
- get_scene_tree
- get_editor_context
- output_logs
- backup
- pathGuard
```

## 22.2 Alto valor e média complexidade

Implementar logo após a base.

```text
- patch_file
- add_node com UndoRedo
- set_node_property com UndoRedo
- create_script
- validate_script
- run_project
- debugger_errors
- screenshot
- input_action simulation
```

## 22.3 Alto valor e alta complexidade

Planejar bem antes de implementar.

```text
- runtime_tree
- dependency_graph
- signal_map
- impact_check
- fix_errors
- refactor_safely
- build_feature
```

## 22.4 Médio valor e alta complexidade

Deixar para fases posteriores.

```text
- AnimationTree avançado
- shader presets avançados
- visual diff sofisticado
- multi-instance Godot
- remote mode seguro
```

---

# 23. Critérios de não escopo inicial

Para manter o projeto viável, os seguintes itens não devem entrar no MVP:

```text
- Suporte remoto pela internet
- Marketplace de plugins
- Geração de assets por IA generativa
- Integração nativa com Git avançada
- Suporte completo a todas as versões Godot 3.x
- Editor visual próprio completo
- Sistema de autenticação multiusuário
- Cloud sync
- Multiplayer testing avançado
```

Esses itens podem ser avaliados no futuro, mas não pertencem à fundação do projeto.

---

# 24. Critério de sucesso do MVP

O MVP será considerado bem-sucedido quando a IA conseguir executar o seguinte fluxo:

```text
1. Conectar à Godot
2. Obter informações do projeto
3. Criar uma cena Player.tscn
4. Adicionar CharacterBody2D
5. Adicionar Sprite2D
6. Adicionar CollisionShape2D
7. Criar Player.gd
8. Anexar script ao Player
9. Criar ações no Input Map
10. Salvar cena
11. Rodar cena
12. Ler erros
13. Corrigir erro simples
14. Rodar novamente
15. Confirmar ausência de erros
```

Esse fluxo cobre o núcleo real do projeto:

```text
conectar → criar → editar → rodar → observar → corrigir → validar
```

---

# 25. Conclusão

O roadmap do Godot DevPilot MCP prioriza uma evolução progressiva e segura.

A versão inicial deve focar em confiabilidade, segurança e fluxo real de desenvolvimento, não em quantidade de ferramentas.

A sequência estratégica é:

```text
Core estável
    ↓
Segurança
    ↓
Cenas, nós e scripts
    ↓
Debug loop
    ↓
Screenshots e input
    ↓
Runtime analysis
    ↓
Project intelligence
    ↓
Toolkits
    ↓
Agentic tools
```

Seguindo essa ordem, o projeto pode evoluir para uma alternativa aberta, robusta e tecnicamente superior para desenvolvimento de jogos com Godot e IA.

