# Examples — Godot DevPilot MCP

## 1. Objetivo deste documento

Este documento reúne exemplos práticos de uso do **Godot DevPilot MCP**.

Os exemplos demonstram como um usuário pode pedir ações a uma IA e como o MCP deve coordenar ferramentas para executar essas ações na Godot.

Este documento cobre:

- Verificação de conexão;
- Leitura do projeto;
- Criação de cenas;
- Manipulação de nós;
- Criação de scripts;
- Configuração de Input Map;
- Execução e debug;
- Screenshots;
- Input simulation;
- Análise de impacto;
- Criação de sistemas de gameplay;
- Ferramentas agentic.

---

## 2. Convenção dos exemplos

Cada exemplo possui:

```text
Pedido do usuário
Ferramentas esperadas
Resultado esperado
Observações
```

Os exemplos não representam necessariamente comandos diretos que o usuário precisa executar. Eles mostram o fluxo ideal entre IA e ferramentas MCP.

---

# 3. Exemplo 1 — Verificar conexão com Godot

## Pedido do usuário

```text
Verifique se você está conectado à Godot.
```

## Ferramentas esperadas

```text
godot_health_check
```

## Resposta esperada

```json
{
  "ok": true,
  "data": {
    "connected": true,
    "godot_version": "4.2.2",
    "plugin_version": "0.1.0"
  },
  "message": "Godot DevPilot MCP conectado.",
  "warnings": [],
  "suggestions": []
}
```

## Observações

Este deve ser o primeiro teste após instalação.

---

# 4. Exemplo 2 — Obter informações do projeto

## Pedido do usuário

```text
Me diga qual projeto Godot está aberto e qual é a cena principal.
```

## Ferramentas esperadas

```text
godot_get_project_info
godot_get_editor_context
```

## Resultado esperado

A IA deve informar:

```text
- Nome do projeto;
- Caminho do projeto;
- Versão da Godot;
- Cena principal;
- Cena atualmente aberta;
- Se o jogo está rodando.
```

---

# 5. Exemplo 3 — Listar scripts do projeto

## Pedido do usuário

```text
Liste os scripts GDScript do projeto.
```

## Ferramentas esperadas

```text
godot_list_files
```

## Entrada esperada

```json
{
  "root": "res://",
  "extensions": [".gd"],
  "recursive": true,
  "limit": 100
}
```

## Resultado esperado

```text
res://scripts/Player.gd
res://scripts/Enemy.gd
res://scripts/HUD.gd
```

---

# 6. Exemplo 4 — Criar uma cena Player

## Pedido do usuário

```text
Crie uma cena Player.tscn com um CharacterBody2D como nó raiz.
```

## Ferramentas esperadas

```text
godot_create_scene
```

## Entrada esperada

```json
{
  "scene_path": "res://scenes/Player.tscn",
  "root_type": "CharacterBody2D",
  "root_name": "Player",
  "overwrite": false,
  "dry_run": false
}
```

## Resultado esperado

```text
Cena res://scenes/Player.tscn criada com root CharacterBody2D chamado Player.
```

## Observações

A ferramenta deve validar `CharacterBody2D` via ClassDB.

---

# 7. Exemplo 5 — Adicionar nós ao Player

## Pedido do usuário

```text
Adicione Sprite2D, CollisionShape2D e Camera2D como filhos do Player.
```

## Ferramentas esperadas

```text
godot_open_scene
godot_add_node
godot_add_node
godot_add_node
godot_save_scene
```

## Fluxo esperado

```text
1. Abrir res://scenes/Player.tscn
2. Adicionar Sprite2D em Player
3. Adicionar CollisionShape2D em Player
4. Adicionar Camera2D em Player
5. Salvar cena
```

## Entradas esperadas

```json
{
  "parent_path": ".",
  "type": "Sprite2D",
  "name": "Sprite2D",
  "dry_run": false
}
```

```json
{
  "parent_path": ".",
  "type": "CollisionShape2D",
  "name": "CollisionShape2D",
  "dry_run": false
}
```

```json
{
  "parent_path": ".",
  "type": "Camera2D",
  "name": "Camera2D",
  "dry_run": false
}
```

## Observações

Cada mutação deve usar UndoRedo.

---

# 8. Exemplo 6 — Criar script de movimento top-down

## Pedido do usuário

```text
Crie um script Player.gd para movimento top-down usando CharacterBody2D.
```

## Ferramentas esperadas

```text
godot_create_script
godot_validate_script
godot_attach_script
godot_save_scene
```

## Script esperado

```gdscript
extends CharacterBody2D

@export var speed: float = 220.0

func _physics_process(_delta: float) -> void:
    var direction := Vector2.ZERO

    direction.x = Input.get_axis("move_left", "move_right")
    direction.y = Input.get_axis("move_up", "move_down")

    if direction.length() > 1.0:
        direction = direction.normalized()

    velocity = direction * speed
    move_and_slide()
```

## Observações

O código deve usar padrões Godot 4.x.

---

# 9. Exemplo 7 — Configurar Input Map

## Pedido do usuário

```text
Configure os inputs move_left, move_right, move_up e move_down para WASD e setas.
```

## Ferramentas esperadas

```text
godot_get_input_map
godot_add_input_action
godot_add_input_action
godot_add_input_action
godot_add_input_action
```

## Exemplo de entrada

```json
{
  "name": "move_left",
  "events": [
    { "type": "key", "key": "A" },
    { "type": "key", "key": "Left" }
  ],
  "overwrite": false,
  "dry_run": false
}
```

## Resultado esperado

```text
Ações adicionadas ao Input Map:
- move_left
- move_right
- move_up
- move_down
```

---

# 10. Exemplo 8 — Rodar cena e verificar erros

## Pedido do usuário

```text
Rode a cena Player e veja se há erros.
```

## Ferramentas esperadas

```text
godot_run_scene
godot_get_output_logs
godot_get_debugger_errors
godot_assert_no_errors
```

## Resultado esperado

Caso sem erros:

```json
{
  "ok": true,
  "data": {
    "errors": 0
  },
  "message": "Nenhum erro encontrado.",
  "warnings": [],
  "suggestions": []
}
```

Caso com erro:

```text
A IA deve indicar arquivo, linha e sugerir correção.
```

---

# 11. Exemplo 9 — Corrigir erro automaticamente

## Pedido do usuário

```text
Rode o projeto e corrija os erros encontrados.
```

## Ferramentas esperadas

```text
godot_run_project
godot_get_debugger_errors
godot_get_output_logs
godot_fix_errors
godot_patch_file
godot_validate_script
godot_run_project
godot_assert_no_errors
```

## Fluxo seguro esperado

```text
1. Rodar projeto
2. Ler erros
3. Criar plano de correção com dry_run
4. Aplicar patch com backup
5. Validar script
6. Rodar novamente
7. Confirmar ausência de erro
```

## Observações

`godot_fix_errors` deve executar primeiro em `dry_run`.

---

# 12. Exemplo 10 — Capturar screenshot do jogo

## Pedido do usuário

```text
Tire uma screenshot da cena rodando.
```

## Ferramentas esperadas

```text
godot_run_scene
godot_take_game_screenshot
```

## Entrada esperada

```json
{
  "output_path": ".godot_mcp/screenshots/player_scene.png"
}
```

## Resultado esperado

```text
Screenshot salva em .godot_mcp/screenshots/player_scene.png
```

---

# 13. Exemplo 11 — Simular movimento do player

## Pedido do usuário

```text
Rode a cena e mova o Player para a direita por 2 segundos. Depois verifique se ele saiu do lugar.
```

## Ferramentas esperadas

```text
godot_run_scene
godot_get_runtime_node_properties
godot_press_action
godot_get_runtime_node_properties
godot_stop_project
```

## Fluxo esperado

```text
1. Rodar cena
2. Ler posição inicial do Player
3. Pressionar move_right por 2000ms
4. Ler posição final do Player
5. Comparar posição X
```

## Resultado esperado

```text
O valor X final deve ser maior que o valor X inicial.
```

---

# 14. Exemplo 12 — Criar inimigo simples 2D

## Pedido do usuário

```text
Crie um inimigo 2D simples que patrulha horizontalmente.
```

## Ferramentas esperadas

```text
godot_create_scene
godot_add_node
godot_add_node
godot_create_script
godot_attach_script
godot_validate_script
godot_save_scene
```

## Script esperado

```gdscript
extends CharacterBody2D

@export var speed: float = 80.0
@export var patrol_distance: float = 120.0

var start_x: float
var direction: float = 1.0

func _ready() -> void:
    start_x = global_position.x

func _physics_process(_delta: float) -> void:
    velocity.x = direction * speed
    move_and_slide()

    if abs(global_position.x - start_x) >= patrol_distance:
        direction *= -1.0
```

---

# 15. Exemplo 13 — Criar sistema de vida

## Pedido do usuário

```text
Crie um sistema de vida para o Player com sinais health_changed e died.
```

## Ferramentas esperadas

```text
godot_create_gameplay_system
```

## Entrada esperada

```json
{
  "system_type": "health",
  "target_scene": "res://scenes/Player.tscn",
  "options": {
    "max_health": 100,
    "create_hud_binding": false
  },
  "dry_run": true
}
```

## Plano esperado

```text
- Criar HealthComponent.gd
- Adicionar Node chamado HealthComponent ao Player
- Anexar script
- Criar sinais health_changed e died
- Criar métodos damage, heal e die
- Validar script
```

## Observações

A ferramenta deve retornar plano antes de aplicar.

---

# 16. Exemplo 14 — Analisar impacto de renomear sinal

## Pedido do usuário

```text
Posso renomear o sinal health_changed para player_health_changed?
```

## Ferramentas esperadas

```text
godot_build_signal_map
godot_impact_check
godot_find_references
```

## Entrada esperada

```json
{
  "change_type": "rename_signal",
  "target": "health_changed",
  "new_value": "player_health_changed"
}
```

## Resultado esperado

```text
A IA deve listar:
- scripts afetados;
- cenas afetadas;
- conexões afetadas;
- nível de risco;
- recomendação de refatoração segura.
```

---

# 17. Exemplo 15 — Refatorar com segurança

## Pedido do usuário

```text
Renomeie PlayerController.gd para TopDownPlayerController.gd e atualize as referências.
```

## Ferramentas esperadas

```text
godot_impact_check
godot_refactor_safely
```

## Primeira execução esperada

```json
{
  "change_type": "rename_file",
  "target": "res://scripts/PlayerController.gd",
  "new_value": "res://scripts/TopDownPlayerController.gd",
  "dry_run": true
}
```

## Resultado esperado

```text
Plano de refatoração, sem aplicar alterações.
```

## Aplicação

Após revisar:

```json
{
  "dry_run": false,
  "confirm": true
}
```

---

# 18. Exemplo 16 — Criar uma porta com chave

## Pedido do usuário

```text
Na cena Level01, crie uma chave coletável e uma porta que abre quando a chave for coletada.
```

## Ferramentas esperadas

```text
godot_build_feature
```

## Entrada esperada

```json
{
  "description": "Criar uma chave coletável e uma porta que abre quando a chave for coletada.",
  "target_scene": "res://scenes/Level01.tscn",
  "dry_run": true
}
```

## Plano esperado

```text
- Adicionar Area2D Key
- Adicionar Sprite2D e CollisionShape2D à Key
- Criar Key.gd com sinal key_collected
- Adicionar StaticBody2D Door
- Adicionar CollisionShape2D à Door
- Criar Door.gd com método open
- Conectar key_collected à Door.open
- Validar scripts
- Rodar cena
```

---

# 19. Exemplo 17 — Criar protótipo jogável 2D

## Pedido do usuário

```text
Crie um protótipo jogável top-down com player, inimigo, coletável e HUD simples.
```

## Ferramentas esperadas

```text
godot_create_playable_prototype
```

## Entrada esperada

```json
{
  "game_type": "top_down_2d",
  "features": [
    "player_movement",
    "enemy_patrol",
    "collectible",
    "hud"
  ],
  "target_directory": "res://prototype",
  "dry_run": true
}
```

## Resultado esperado

Primeiro retorno:

```text
Plano detalhado do protótipo.
```

Após confirmação:

```text
Cenas, scripts e inputs criados.
```

---

# 20. Exemplo 18 — Auditar colisões

## Pedido do usuário

```text
Verifique se existem nós de física sem CollisionShape na cena atual.
```

## Ferramentas esperadas

```text
godot_audit_collision_setup
```

## Resultado esperado

```text
- CharacterBody2D Player possui CollisionShape2D: OK
- Area2D Key não possui CollisionShape2D: problema
- StaticBody2D Door possui CollisionShape2D: OK
```

## Sugestão esperada

```text
Adicionar CollisionShape2D em Key.
```

---

# 21. Exemplo 19 — Gerar resumo do projeto

## Pedido do usuário

```text
Analise o projeto e gere um resumo da arquitetura atual.
```

## Ferramentas esperadas

```text
godot_project_summary
godot_build_dependency_graph
godot_build_signal_map
godot_detect_gameplay_systems
```

## Resultado esperado

```text
- Quantidade de cenas
- Quantidade de scripts
- Cena principal
- Sistemas detectados
- Dependências principais
- Sinais importantes
- Riscos ou inconsistências
```

---

# 22. Exemplo 20 — Criar decisão técnica na memória

## Pedido do usuário

```text
Registre que vamos usar composição por componentes para sistemas como vida, inventário e armas.
```

## Ferramentas esperadas

```text
godot_create_decision_record
godot_update_project_memory
```

## Registro esperado

```md
# Decision: Component-based gameplay systems

## Context

O projeto terá sistemas de vida, inventário e armas.

## Decision

Usar composição por componentes em vez de herança profunda.

## Consequences

- HealthComponent, InventoryComponent e WeaponComponent podem ser reutilizados.
- Cenas ficam mais modulares.
- Scripts precisam de sinais bem documentados.
```

---

# 23. Exemplo 21 — Criar cena 3D básica

## Pedido do usuário

```text
Crie uma cena 3D básica com câmera, luz, chão e um personagem CharacterBody3D.
```

## Ferramentas esperadas

```text
godot_create_scene
godot_create_primitive_mesh
godot_setup_camera_3d
godot_setup_lighting
godot_create_character_body_3d
godot_setup_collision_3d
godot_save_scene
```

## Resultado esperado

```text
Cena 3D com:
- Node3D root
- chão com colisão
- DirectionalLight3D
- Camera3D
- CharacterBody3D Player
```

---

# 24. Exemplo 22 — Criar shader simples

## Pedido do usuário

```text
Crie um shader de outline para sprites 2D.
```

## Ferramentas esperadas

```text
godot_create_shader
godot_validate_shader
godot_create_canvas_item_material
godot_attach_shader
```

## Resultado esperado

```text
- Shader criado em res://shaders/outline_2d.gdshader
- Material criado
- Shader validado
- Material pronto para ser anexado a Sprite2D
```

---

# 25. Exemplo 23 — Criar teste de regressão

## Pedido do usuário

```text
Crie um teste que verifica se o player consegue se mover para a direita.
```

## Ferramentas esperadas

```text
godot_create_test_scenario
godot_run_test_scenario
godot_assert_property_equals
godot_run_input_sequence
```

## Fluxo esperado

```text
1. Rodar cena Player
2. Capturar posição inicial
3. Pressionar move_right
4. Capturar posição final
5. Assert final_x > initial_x
6. Salvar relatório
```

---

# 26. Exemplo 24 — Preparar checklist de release

## Pedido do usuário

```text
Prepare um checklist antes de exportar o jogo.
```

## Ferramentas esperadas

```text
godot_prepare_release_checklist
godot_project_summary
godot_validate_scene
godot_get_debugger_errors
godot_audit_missing_audio
godot_audit_collision_setup
```

## Resultado esperado

```text
Checklist com:
- erros de script
- cenas inválidas
- assets ausentes
- colisões incompletas
- áudio ausente
- configurações de exportação pendentes
- main scene definida
```

---

# 27. Exemplo completo — MVP

## Pedido do usuário

```text
Crie um player 2D controlável do zero e rode a cena para validar.
```

## Fluxo completo esperado

```text
1. godot_health_check
2. godot_get_project_info
3. godot_create_scene
4. godot_add_node Sprite2D
5. godot_add_node CollisionShape2D
6. godot_add_node Camera2D
7. godot_add_input_action move_left
8. godot_add_input_action move_right
9. godot_add_input_action move_up
10. godot_add_input_action move_down
11. godot_create_script Player.gd
12. godot_validate_script
13. godot_attach_script
14. godot_save_scene
15. godot_run_scene
16. godot_get_output_logs
17. godot_get_debugger_errors
18. godot_assert_no_errors
19. godot_take_game_screenshot
20. godot_press_action move_right
21. godot_get_runtime_node_properties
```

## Resultado esperado

```text
Uma cena Player.tscn funcional, com movimento top-down, sem erros de runtime e com validação básica de movimento.
```

---

## 28. Boas práticas ao pedir ações para a IA

## 28.1 Bons pedidos

```text
Crie uma cena Player.tscn com CharacterBody2D, Sprite2D, CollisionShape2D e Camera2D.
```

```text
Rode a cena atual, leia os erros e proponha correções antes de aplicar.
```

```text
Analise o impacto de renomear o sinal health_changed.
```

```text
Crie primeiro um plano em dry_run para o sistema de inventário.
```

## 28.2 Pedidos arriscados

```text
Refatore todo o projeto.
```

```text
Delete os arquivos que não são usados.
```

```text
Reescreva todos os scripts.
```

```text
Corrija tudo automaticamente sem me perguntar.
```

Esses pedidos devem acionar ferramentas com `dry_run`, limite de escopo e confirmação.

---

## 29. Conclusão

Os exemplos deste documento demonstram o fluxo ideal do Godot DevPilot MCP:

```text
entender → planejar → alterar com segurança → executar → observar → corrigir → validar
```

O valor do projeto não está apenas em chamar ferramentas isoladas, mas em permitir que a IA participe de um ciclo real de desenvolvimento de jogos com Godot.

