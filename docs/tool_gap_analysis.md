# Tool Gap Analysis — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento mapeia as diferenças entre a base open source que será usada como referência inicial e as soluções comerciais existentes para integração entre IA e Godot via MCP.

O objetivo é identificar:

- O que já existe em soluções open source;
- O que as soluções pagas oferecem publicamente;
- Quais lacunas precisam ser preenchidas;
- Quais funcionalidades devem ser priorizadas;
- Onde o Godot DevPilot MCP pode ser tecnicamente superior.

Este documento não tem o objetivo de copiar código, lógica fechada, prompts privados, binários ou assets proprietários de soluções comerciais. A comparação serve apenas como referência funcional pública para orientar uma implementação própria.

---

## 2. Referências analisadas

## 2.1 Base open source

### `tomyud1/godot-mcp`

Projeto open source que já oferece uma integração MCP com Godot.

Características relevantes:

- Servidor MCP em Node.js;
- Plugin para Godot;
- Comunicação local;
- Ferramentas para arquivos, cenas, nós e scripts;
- Algumas operações de execução e debugging;
- Licença aberta;
- Boa base para estudo, fork e evolução.

Papel neste projeto:

```text
Base inicial de referência técnica e ponto de partida para evolução.
```

---

## 2.2 Soluções comerciais e referências funcionais

### Godot MCP Pro

Solução paga com foco em uma grande quantidade de ferramentas e automação ampla do editor Godot.

Pontos públicos relevantes:

- Grande número de ferramentas;
- Organização por categorias;
- Modos de carregamento como full/lite/minimal;
- Manipulação ampla de cenas, nós, scripts e runtime;
- Suporte a 2D, 3D, física, áudio, partículas, shaders e navegação;
- Ênfase em Undo/Redo, runtime analysis, input simulation e automated testing.

### GDAI MCP

Solução paga com foco prático em desenvolvimento assistido por IA.

Pontos públicos relevantes:

- Criação de cenas e scripts;
- Manipulação de nós;
- Debugger integration;
- Leitura de logs e erros;
- Screenshots automáticos;
- Simulação de input;
- Testes end-to-end;
- Fluxo de criação, execução, observação e correção.

### GodotIQ

Solução com foco em inteligência estrutural do projeto.

Pontos públicos relevantes:

- Scene map;
- Dependency graph;
- Signal map;
- Impact check;
- Trace flow;
- Project memory;
- Otimização de contexto para IA;
- Validação de impacto.

---

## 3. Estratégia de comparação

As ferramentas e capacidades foram agrupadas por domínio técnico:

```text
1. Core e conexão
2. Projeto
3. Arquivos e assets
4. Cenas
5. Nós
6. Scripts
7. Signals
8. Debug e logs
9. Runtime analysis
10. Screenshots
11. Input simulation
12. 2D toolkit
13. 3D toolkit
14. Física
15. Animação
16. Áudio
17. Partículas e VFX
18. Shaders e materiais
19. Navegação
20. Testes automatizados
21. Project intelligence
22. Project memory
23. Segurança
24. Ferramentas agentic
```

Cada categoria será classificada em quatro níveis:

```text
Ausente       — não há evidência clara da funcionalidade.
Básico        — existe, mas cobre apenas operações simples.
Intermediário — cobre operações úteis, mas ainda sem robustez completa.
Forte         — cobre bem o fluxo real de uso.
Superior      — proposta planejada com melhorias além das referências.
```

---

## 4. Matriz comparativa geral

| Categoria | tomyud1/godot-mcp | Godot MCP Pro / GDAI / GodotIQ | Godot DevPilot MCP planejado |
|---|---|---|---|
| Core e conexão | Intermediário | Forte | Superior |
| Projeto | Básico/Intermediário | Forte | Superior |
| Arquivos | Intermediário | Forte | Superior |
| Assets | Básico | Forte | Superior |
| Cenas | Intermediário | Forte | Superior |
| Nós | Intermediário | Forte | Superior |
| Scripts | Intermediário | Forte | Superior |
| Signals | Básico/Limitado | Forte | Superior |
| Debug e logs | Básico/Intermediário | Forte | Superior |
| Runtime analysis | Limitado | Forte | Superior |
| Screenshots | Limitado | Forte | Forte/Superior |
| Input simulation | Limitado | Forte | Forte/Superior |
| 2D toolkit | Básico | Forte | Superior |
| 3D toolkit | Limitado | Forte | Forte/Superior |
| Física | Básico/Limitado | Forte | Superior |
| Animação | Limitado | Forte | Forte/Superior |
| Áudio | Limitado | Forte | Forte/Superior |
| Partículas/VFX | Limitado | Forte | Forte/Superior |
| Shaders/Materiais | Limitado | Forte | Forte/Superior |
| Navegação | Limitado | Forte | Forte/Superior |
| Testes automatizados | Limitado | Forte | Superior |
| Project intelligence | Limitado | Forte no GodotIQ | Superior |
| Project memory | Ausente/Limitado | Forte no GodotIQ | Superior |
| Segurança | Básico | Variável | Superior |
| Agentic tools | Limitado | Parcial | Superior |

---

## 5. Análise por categoria

# 5.1 Core e conexão

## Situação atual esperada na base open source

A base open source já possui comunicação entre cliente MCP, servidor local e plugin Godot. Esse é o núcleo necessário para qualquer evolução.

## Lacunas identificadas

```text
- Health check mais robusto;
- Heartbeat periódico;
- Reconexão automática;
- Timeouts configuráveis;
- Diagnóstico de conexão;
- Suporte futuro a múltiplas instâncias;
- Respostas padronizadas;
- Versionamento de protocolo.
```

## Proposta para Godot DevPilot MCP

Ferramentas planejadas:

```text
godot_health_check
godot_ping
godot_get_capabilities
godot_get_connection_status
godot_get_protocol_version
godot_reconnect
godot_set_mode
```

Melhorias:

```text
- Protocolo interno JSON-RPC 2.0;
- Envelope padronizado de erro e sucesso;
- Diagnóstico acionável quando a Godot não estiver conectada;
- Mensagens de erro com sugestões;
- Log de conexão;
- Separação entre erro MCP e erro do plugin.
```

Prioridade: **Alta**

---

# 5.2 Projeto

## Situação atual

Ferramentas básicas costumam permitir obter informações do projeto e listar alguns dados do ambiente.

## Lacunas identificadas

```text
- Leitura estruturada de ProjectSettings;
- Consulta de Input Map;
- Gerenciamento de Input Actions;
- Consulta de Autoloads;
- Consulta de plugins ativos;
- Consulta de versão Godot e renderer;
- Consulta de features habilitadas;
- Contexto atual do editor.
```

## Proposta

Ferramentas planejadas:

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
godot_get_enabled_plugins
```

Melhorias:

```text
- Contexto rico para IA antes de alterações;
- Operações seguras de Input Map;
- Operações seguras de Autoload;
- Detecção de versão para evitar sintaxe antiga de Godot 3;
- Retorno compacto para reduzir tokens.
```

Prioridade: **Alta**

---

# 5.3 Arquivos e assets

## Situação atual

A base open source tende a cobrir leitura, escrita e listagem de arquivos.

## Lacunas identificadas

```text
- Patch incremental em vez de sobrescrita total;
- Backup automático;
- Bloqueio de paths fora de res://;
- Dry run;
- Busca inteligente de assets;
- Metadados de recursos;
- Preview de assets;
- Reimport/rescan do filesystem;
- Proteção contra exclusão acidental.
```

## Proposta

Ferramentas planejadas:

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
godot_import_asset
```

Melhorias:

```text
- Backup antes de qualquer escrita;
- Diferença entre write_file e patch_file;
- Exclusão segura movendo para .godot_mcp/trash;
- Busca por tipo, extensão, dimensão e uso provável;
- Retorno de candidatos de asset com score de relevância;
- Proteção dupla no servidor e no plugin.
```

Prioridade: **Alta**

---

# 5.4 Cenas

## Situação atual

A base open source geralmente permite criar, abrir, salvar e obter árvore da cena.

## Lacunas identificadas

```text
- Validação semântica de cena;
- Duplicação segura;
- Auditoria de cena;
- Dependências da cena;
- Resumo compacto da cena;
- Detecção de nós órfãos;
- Detecção de scripts ausentes;
- UndoRedo em alterações estruturais.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Resumo de cena otimizado para IA;
- Auditoria com alertas acionáveis;
- Validação antes de salvar;
- Backup antes de salvar cena existente;
- Dependências de scripts, texturas, materiais e recursos;
- Integração com indexador.
```

Prioridade: **Alta**

---

# 5.5 Nós

## Situação atual

A base open source deve cobrir adicionar/remover nós e alterar propriedades.

## Lacunas identificadas

```text
- UndoRedo obrigatório;
- Renomear nó;
- Duplicar nó;
- Reparentar nó;
- Mover nó na árvore;
- Gerenciar grupos;
- Validar tipo via ClassDB;
- Validar propriedade antes de aplicar;
- Converter valores de forma segura;
- Retornar propriedades relevantes sem excesso de tokens.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Todas as mutações usando UndoRedo;
- Validação de tipo via ClassDB;
- Sugestão de tipo correto quando houver erro de digitação;
- Conversão segura de Vector2, Vector3, Color, NodePath e Resource;
- Suporte a dry_run em operações estruturais;
- Relatório de impacto em remoção de nó.
```

Prioridade: **Alta**

---

# 5.6 Scripts

## Situação atual

Ferramentas básicas permitem criar, ler e editar scripts.

## Lacunas identificadas

```text
- Validação de GDScript;
- Detecção de sintaxe Godot 3 incompatível;
- Busca de símbolos;
- Busca de referências;
- Dependências entre scripts;
- Refatoração segura;
- Formatação;
- Extração de método;
- Detecção de sinais emitidos e conectados.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Validação orientada a Godot 4.x;
- Avisos para padrões antigos;
- Backup antes de patch;
- Refatoração com análise de impacto;
- Índice de classes, métodos, sinais e exports;
- Respostas compactas para IA.
```

Prioridade: **Alta**

---

# 5.7 Signals

## Situação atual

Em muitas bases, sinais são tratados de forma parcial ou manual.

## Lacunas identificadas

```text
- Mapear sinais definidos em scripts;
- Mapear emits;
- Mapear connects;
- Identificar conexões quebradas;
- Identificar sinais órfãos;
- Analisar fluxo de eventos;
- Prever impacto de renomeação;
- Conectar/desconectar sinais com segurança.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Signal map persistente;
- Integração com dependency graph;
- Detecção de padrões Godot 3 para connect;
- Sugestão de sintaxe Godot 4;
- Refatoração segura de nomes de sinais;
- Relatório de impacto antes da alteração.
```

Prioridade: **Alta/Média**

---

# 5.8 Debug e logs

## Situação atual

A base open source pode ter alguma leitura de erros, mas normalmente esse ponto precisa de robustez.

## Lacunas identificadas

```text
- Separar output logs, debugger errors e parse errors;
- Limpar logs;
- Filtrar por severidade;
- Associar erro a arquivo e linha;
- Sugerir correção;
- Manter histórico por execução;
- Integrar com ferramenta de fix automático.
```

## Proposta

Ferramentas planejadas:

```text
godot_get_output_logs
godot_get_debugger_errors
godot_get_script_parse_errors
godot_clear_logs
godot_get_last_run_report
godot_assert_no_errors
godot_fix_errors
```

Melhorias:

```text
- Relatório de execução estruturado;
- Classificação de erros;
- Detecção de arquivo e linha;
- Sugestões acionáveis;
- Integração com patch_script;
- Loop rodar → observar → corrigir → validar.
```

Prioridade: **Alta**

---

# 5.9 Runtime analysis

## Situação atual

Runtime analysis costuma ser limitado em bases open source simples.

## Lacunas identificadas

```text
- Obter árvore viva do jogo rodando;
- Inspecionar propriedades em runtime;
- Alterar propriedades em runtime;
- Localizar nó por nome/tipo/grupo;
- Medir FPS;
- Consultar estado de câmera;
- Aguardar condição;
- Capturar estado de UI.
```

## Proposta

Ferramentas planejadas:

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
godot_wait_for_condition
godot_find_runtime_node
godot_get_current_camera
```

Melhorias:

```text
- Runtime tree compacto;
- Consultas filtradas para reduzir tokens;
- Wait conditions para testes;
- Integração com input simulation;
- Integração com screenshots;
- Relatório de runtime por execução.
```

Prioridade: **Alta/Média**

---

# 5.10 Screenshots

## Situação atual

A captura visual costuma ser limitada ou ausente em implementações básicas.

## Lacunas identificadas

```text
- Screenshot do editor;
- Screenshot do jogo;
- Screenshot do viewport;
- Comparação visual;
- Armazenamento organizado;
- Associação screenshot ↔ execução;
- Retorno de caminho local para análise pelo cliente.
```

## Proposta

Ferramentas planejadas:

```text
godot_take_editor_screenshot
godot_take_game_screenshot
godot_get_viewport_image
godot_compare_screenshots
godot_find_visual_element
godot_describe_current_view
```

Melhorias:

```text
- Screenshots por execução;
- Nomeação automática;
- Captura antes/depois;
- Comparação pixel-level ou heurística;
- Integração com testes visuais;
- Relatório visual de validação.
```

Prioridade: **Média/Alta**

---

# 5.11 Input simulation

## Situação atual

Input simulation costuma ser limitado em bases abertas.

## Lacunas identificadas

```text
- Simular teclas;
- Simular mouse;
- Simular InputMap actions;
- Criar sequências;
- Gravar input;
- Reproduzir input;
- Clicar UI por texto ou nó;
- Integrar com testes E2E.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Sequências com tempo entre eventos;
- Ações baseadas no Input Map do projeto;
- Validação de resultado pós-input;
- Integração com screenshots e runtime tree;
- Possibilidade de gerar testes reprodutíveis.
```

Prioridade: **Média/Alta**

---

# 5.12 2D toolkit

## Situação atual

Ferramentas básicas criam nós, mas não necessariamente sistemas completos.

## Lacunas identificadas

```text
- Criar player 2D completo;
- Criar controller top-down;
- Criar controller platformer;
- Criar inimigo simples;
- Criar coletáveis;
- Criar HUD;
- Criar health system;
- Criar inventory UI;
- Configurar câmera 2D;
- Configurar colisões 2D;
- Criar TileMap.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Templates reutilizáveis;
- Scripts Godot 4.x corretos;
- Configuração automática de InputMap;
- Nós e scripts criados em estrutura organizada;
- Validação automática após criação;
- Geração de cena jogável mínima.
```

Prioridade: **Média**

---

# 5.13 3D toolkit

## Situação atual

Soluções abertas tendem a ter suporte 3D limitado.

## Lacunas identificadas

```text
- Criar primitivas 3D;
- Importar glTF/GLB;
- Configurar câmera 3D;
- Configurar iluminação;
- Configurar WorldEnvironment;
- Criar CharacterBody3D;
- Configurar colisão 3D;
- Criar RayCast3D;
- Configurar NavigationRegion3D;
- Bake de navmesh;
- Criar controller third-person.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Templates 3D funcionais;
- Setup completo de cena 3D inicial;
- Validação de colisão;
- Setup de câmera e luz coerente;
- Integração com materiais e navegação.
```

Prioridade: **Média**

---

# 5.14 Física

## Lacunas identificadas

```text
- Auditar nós físicos sem CollisionShape;
- Verificar collision layers e masks;
- Testar colisão entre categorias;
- Criar RayCast;
- Sugerir correções;
- Detectar configurações inconsistentes.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Auditoria automática de física;
- Relatório de colisões ausentes;
- Sugestões de layer/mask;
- Correção semi-automática com dry_run.
```

Prioridade: **Média**

---

# 5.15 Animação

## Lacunas identificadas

```text
- Criar AnimationPlayer;
- Criar animações;
- Adicionar keyframes;
- Criar AnimationTree;
- Configurar state machine;
- Configurar blend tree;
- Validar referências quebradas;
- Preview de animação.
```

## Proposta

Ferramentas planejadas:

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

Prioridade: **Média/Baixa no início**

---

# 5.16 Áudio

## Lacunas identificadas

```text
- Gerenciar audio buses;
- Criar AudioStreamPlayer;
- Atribuir arquivos de áudio;
- Configurar volume;
- Adicionar efeitos;
- Auditar referências ausentes.
```

## Proposta

Ferramentas planejadas:

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

Prioridade: **Baixa/Média**

---

# 5.17 Partículas e VFX

## Lacunas identificadas

```text
- Criar partículas 2D e 3D;
- Aplicar presets;
- Criar efeitos comuns;
- Preview;
- Ajustar materiais de partículas.
```

## Proposta

Ferramentas planejadas:

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

Prioridade: **Baixa/Média**

---

# 5.18 Shaders e materiais

## Lacunas identificadas

```text
- Criar shader;
- Validar shader;
- Anexar shader;
- Criar materiais 2D/3D;
- Configurar PBR;
- Criar presets comuns;
- Preview de material.
```

## Proposta

Ferramentas planejadas:

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

Prioridade: **Baixa/Média**

---

# 5.19 Navegação

## Lacunas identificadas

```text
- Criar NavigationRegion2D/3D;
- Configurar NavigationAgent;
- Fazer bake de navmesh;
- Auditar caminhos;
- Testar pathfinding.
```

## Proposta

Ferramentas planejadas:

```text
godot_create_navigation_region
godot_create_navigation_agent
godot_bake_navigation_mesh
godot_test_navigation_path
godot_audit_navigation_setup
godot_fix_navigation_layers
```

Prioridade: **Média**

---

# 5.20 Testes automatizados

## Situação atual

Implementações abertas costumam ter pouca automação de testes do jogo.

## Lacunas identificadas

```text
- Criar cenários de teste;
- Rodar sequência de input;
- Assert de nó existente;
- Assert de propriedade;
- Assert de sinal emitido;
- Assert de ausência de erros;
- Comparação de screenshot;
- Teste de stress de cena.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Testes gerados a partir de ações da IA;
- Reexecução de input sequences;
- Relatório por execução;
- Integração com screenshots;
- Base para regressão.
```

Prioridade: **Média/Alta**

---

# 5.21 Project intelligence

## Situação atual

Essa é uma das principais oportunidades de diferenciação.

## Lacunas identificadas

```text
- Mapa semântico de cenas;
- Grafo de dependências;
- Mapa de sinais;
- Análise de impacto;
- Rastreamento de fluxo;
- Detecção de sistemas de gameplay;
- Resumo arquitetural;
- Otimização de contexto para IA.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Entendimento estrutural real do projeto;
- Relatórios compactos para IA;
- Identificação de sistemas como inventory, health, dialogue, quest;
- Análise antes de refatorações;
- Uso combinado de cenas, scripts e sinais.
```

Prioridade: **Alta/Média**

---

# 5.22 Project memory

## Lacunas identificadas

```text
- Guardar decisões técnicas;
- Guardar convenções;
- Guardar resumo do projeto;
- Guardar sistemas existentes;
- Atualizar contexto entre sessões;
- Consultar memória de forma compacta.
```

## Proposta

Ferramentas planejadas:

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

Arquivos planejados:

```text
.godot_mcp/memory/project_summary.md
.godot_mcp/memory/architecture.md
.godot_mcp/memory/conventions.md
.godot_mcp/memory/decisions.md
.godot_mcp/memory/gameplay_systems.md
```

Prioridade: **Média**

---

# 5.23 Segurança

## Situação atual

Muitos MCPs priorizam funcionalidade antes de segurança.

## Lacunas identificadas

```text
- Path sandbox;
- Modo read-only;
- Backup automático;
- Dry run;
- UndoRedo;
- Permissões por ferramenta;
- Log auditável;
- Confirmação para ações críticas;
- Proteção contra exclusão irreversível.
```

## Proposta

Recursos planejados:

```text
- pathGuard no servidor;
- validação res:// no plugin;
- backups em .godot_mcp/backups;
- trash seguro em .godot_mcp/trash;
- dry_run em operações destrutivas;
- permission presets;
- log actions.jsonl;
- UndoRedo obrigatório em mutações do editor.
```

Prioridade: **Crítica**

---

# 5.24 Ferramentas agentic

## Situação atual

A maioria das ferramentas MCP é granular. Isso é útil, mas obriga a IA a coordenar muitas chamadas.

## Lacunas identificadas

```text
- Criar feature completa;
- Corrigir erros em loop;
- Criar sistema de gameplay;
- Refatorar com segurança;
- Criar protótipo jogável;
- Validar alteração automaticamente;
- Gerar relatório final.
```

## Proposta

Ferramentas planejadas:

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

Melhorias:

```text
- Coordenação de múltiplas ferramentas menores;
- Relatórios estruturados;
- Dry run em tarefas grandes;
- Checkpoints de validação;
- Integração com logs, screenshots, input e testes;
- Redução de complexidade para o usuário final.
```

Prioridade: **Média, após core estável**

---

## 6. Priorização geral

## 6.1 Prioridade crítica

Essas funcionalidades devem vir antes de adicionar grande quantidade de ferramentas.

```text
1. Path sandbox
2. Backup automático
3. Respostas padronizadas
4. Health check
5. Reconexão/heartbeat
6. UndoRedo em mutações principais
7. Logs auditáveis
8. Modo read-only
9. Dry run
10. Validação de schemas
```

## 6.2 Prioridade alta

Funcionalidades necessárias para desenvolvimento real com IA.

```text
1. Arquivos com patch seguro
2. Cenas e nós com UndoRedo
3. Scripts com validação
4. Debug logs estruturados
5. Rodar/parar projeto
6. Ler erros do debugger
7. Input Map
8. Autoloads
9. Scene summary
10. Project info/context
```

## 6.3 Prioridade média

Funcionalidades que elevam a experiência.

```text
1. Screenshots
2. Input simulation
3. Runtime tree
4. Signal map
5. Dependency graph
6. Impact check
7. Project memory
8. Test scenarios
9. 2D toolkit
10. 3D toolkit básico
```

## 6.4 Prioridade baixa inicial

Funcionalidades importantes, mas que podem vir depois da base estável.

```text
1. Partículas avançadas
2. Shaders avançados
3. Audio effects avançados
4. AnimationTree avançado
5. Visual diff sofisticado
6. Multi-instance Godot
7. Modo remoto seguro
8. Integração Git avançada
```

---

## 7. Roadmap derivado da análise de lacunas

## 7.1 Fase 1 — Base segura

Objetivo:

```text
Transformar a base MCP em uma fundação confiável.
```

Inclui:

```text
- Health check
- Protocolo interno padronizado
- Path sandbox
- Backup
- Logs
- Read-only
- Dry run
- Resposta padronizada
```

## 7.2 Fase 2 — Editor control robusto

Objetivo:

```text
Manipular cenas, nós e scripts com segurança.
```

Inclui:

```text
- UndoRedo
- Scene tools
- Node tools
- Script tools
- InputMap
- Autoloads
```

## 7.3 Fase 3 — Debug loop

Objetivo:

```text
Permitir que a IA rode, observe, corrija e valide.
```

Inclui:

```text
- Runtime run/stop
- Output logs
- Debugger errors
- Script parse errors
- godot_fix_errors inicial
- assert_no_errors
```

## 7.4 Fase 4 — Visão e interação

Objetivo:

```text
Dar à IA visão e capacidade de interação com o jogo.
```

Inclui:

```text
- Screenshots
- Input simulation
- Runtime tree
- Wait conditions
- Test scenarios
```

## 7.5 Fase 5 — Inteligência estrutural

Objetivo:

```text
Permitir que a IA entenda o projeto como um sistema.
```

Inclui:

```text
- Script indexer
- Scene indexer
- Asset indexer
- Dependency graph
- Signal map
- Impact check
- Trace flow
- Project memory
```

## 7.6 Fase 6 — Toolkits de criação

Objetivo:

```text
Acelerar desenvolvimento de jogos 2D e 3D.
```

Inclui:

```text
- 2D toolkit
- 3D toolkit
- Physics toolkit
- Animation toolkit
- Audio toolkit
- Shader toolkit
- Navigation toolkit
```

## 7.7 Fase 7 — Ferramentas agentic

Objetivo:

```text
Criar automações compostas e de alto nível.
```

Inclui:

```text
- godot_build_feature
- godot_create_gameplay_system
- godot_refactor_safely
- godot_create_playable_prototype
- godot_run_validation_loop
```

---

## 8. Definição de superioridade técnica

O Godot DevPilot MCP será considerado superior quando entregar não apenas mais ferramentas, mas melhor fluxo de desenvolvimento.

## 8.1 Critérios técnicos

```text
- Mais seguro que a base open source;
- Mais organizado que um conjunto grande de tools soltas;
- Melhor debug loop;
- Melhor análise estrutural;
- Melhor suporte a UndoRedo;
- Melhor memória de projeto;
- Melhor validação antes/depois de mudanças;
- Melhor suporte a criação de sistemas completos.
```

## 8.2 Critérios de uso real

A IA deve conseguir:

```text
1. Entender o projeto atual;
2. Criar uma cena funcional;
3. Criar scripts compatíveis com Godot 4;
4. Rodar o jogo;
5. Ler erros;
6. Corrigir erros;
7. Tirar screenshot;
8. Simular input;
9. Validar resultado;
10. Explicar impacto das alterações.
```

## 8.3 Critérios de segurança

```text
1. Nenhuma alteração fora de res://;
2. Nenhuma sobrescrita sem backup;
3. Nenhuma mutação de editor sem UndoRedo quando aplicável;
4. Nenhuma exclusão irreversível por padrão;
5. Toda ação registrada em log;
6. Operações críticas com dry_run;
7. Erros sempre acionáveis.
```

---

## 9. Backlog consolidado

## 9.1 Core

```text
[ ] godot_health_check
[ ] godot_ping
[ ] godot_get_capabilities
[ ] godot_get_connection_status
[ ] godot_get_protocol_version
[ ] JSON-RPC interno
[ ] Resposta padronizada
[ ] Error codes estáveis
```

## 9.2 Segurança

```text
[ ] pathGuard
[ ] read-only mode
[ ] dry_run
[ ] backup automático
[ ] safe trash
[ ] permission presets
[ ] action logs
[ ] UndoRedo service
```

## 9.3 Projeto

```text
[ ] godot_get_project_info
[ ] godot_get_project_settings
[ ] godot_get_godot_version
[ ] godot_get_editor_context
[ ] godot_get_open_scenes
[ ] godot_get_selected_nodes
[ ] godot_get_input_map
[ ] godot_add_input_action
[ ] godot_remove_input_action
[ ] godot_get_autoloads
```

## 9.4 Arquivos

```text
[ ] godot_list_files
[ ] godot_search_files
[ ] godot_read_file
[ ] godot_write_file
[ ] godot_patch_file
[ ] godot_move_file
[ ] godot_rename_file
[ ] godot_delete_file_safe
[ ] godot_rescan_filesystem
[ ] godot_find_asset
```

## 9.5 Cenas e nós

```text
[ ] godot_create_scene
[ ] godot_open_scene
[ ] godot_save_scene
[ ] godot_get_scene_tree
[ ] godot_get_scene_summary
[ ] godot_validate_scene
[ ] godot_add_node
[ ] godot_remove_node
[ ] godot_rename_node
[ ] godot_duplicate_node
[ ] godot_reparent_node
[ ] godot_set_node_property
[ ] godot_get_node_properties
```

## 9.6 Scripts

```text
[ ] godot_create_script
[ ] godot_read_script
[ ] godot_patch_script
[ ] godot_validate_script
[ ] godot_get_script_symbols
[ ] godot_get_script_dependencies
[ ] godot_find_references
[ ] godot_get_classdb_info
```

## 9.7 Debug e runtime

```text
[ ] godot_run_project
[ ] godot_run_scene
[ ] godot_stop_project
[ ] godot_get_output_logs
[ ] godot_get_debugger_errors
[ ] godot_get_script_parse_errors
[ ] godot_assert_no_errors
[ ] godot_get_runtime_tree
[ ] godot_get_runtime_node_properties
```

## 9.8 Screenshots e input

```text
[ ] godot_take_editor_screenshot
[ ] godot_take_game_screenshot
[ ] godot_get_viewport_image
[ ] godot_press_key
[ ] godot_release_key
[ ] godot_press_action
[ ] godot_release_action
[ ] godot_run_input_sequence
```

## 9.9 Inteligência de projeto

```text
[ ] godot_project_summary
[ ] godot_build_dependency_graph
[ ] godot_get_dependency_graph
[ ] godot_build_signal_map
[ ] godot_get_signal_map
[ ] godot_impact_check
[ ] godot_trace_flow
[ ] godot_detect_gameplay_systems
```

## 9.10 Agentic

```text
[ ] godot_fix_errors
[ ] godot_build_feature
[ ] godot_create_gameplay_system
[ ] godot_refactor_safely
[ ] godot_create_playable_prototype
[ ] godot_run_validation_loop
```

---

## 10. Conclusão

A análise mostra que a base open source é suficiente para iniciar o projeto, mas ainda há lacunas importantes em robustez, segurança, debug loop, runtime analysis, screenshots, input simulation, project intelligence e ferramentas agentic.

A estratégia recomendada é não tentar competir inicialmente pela quantidade total de ferramentas. A prioridade deve ser criar uma base confiável e superior em qualidade.

A ordem correta é:

```text
1. Segurança e protocolo
2. Controle robusto do editor
3. Debug loop
4. Screenshots e input
5. Inteligência estrutural
6. Toolkits especializados
7. Ferramentas agentic
```

Com essa abordagem, o Godot DevPilot MCP pode evoluir de uma alternativa open source para uma plataforma mais poderosa, segura e útil para desenvolvimento real de jogos com Godot e IA.

