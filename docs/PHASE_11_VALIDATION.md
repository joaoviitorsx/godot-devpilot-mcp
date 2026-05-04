# Validação da Fase 11 — Toolkits 2D

Projeto: **Godot DevPilot MCP**  
Fase: **11 — Toolkits 2D**  
Data: 2026-05-04  
Escopo: **completa (12 ferramentas)** — toda a lista do roadmap.

---

## 1. Objetivo

Acelerar criação de jogos 2D com tools compostas que combinam Phase 4 (nodes) + Phase 5 (scripts) em uma operação única.

Cada tool 2D é uma macro server-side que orquestra múltiplas chamadas RPC ao plugin Godot.

---

## 2. Ferramentas implementadas (12 — completo)

```text
[x] godot_create_player_2d                 (CharacterBody2D + Sprite2D + CollisionShape2D + script)
[x] godot_create_enemy_2d                  (CharacterBody2D + children + patrol script)
[x] godot_create_collectible_2d            (Area2D + children + collect script)
[x] godot_setup_camera_2d                  (Camera2D + enabled + zoom)
[x] godot_create_health_system             (script HealthSystem.gd com signals)
[x] godot_create_topdown_controller        (script template top-down)
[x] godot_create_platformer_controller     (script template platformer)
[x] godot_setup_collision_2d               (CollisionShape2D — shape via inspector)
[x] godot_setup_area_trigger_2d            (Area2D + script com body_entered/exited)
[x] godot_create_tilemap                   (TileMap — TileSet via inspector)
[x] godot_setup_parallax_background        (ParallaxBackground + N ParallaxLayer)
[x] godot_create_inventory_ui              (CanvasLayer + Control + GridContainer + script)
```

Arquivo: `mcp-server/src/tools/toolkit2dTools.ts`.

---

## 4. Templates GDScript embutidos

```text
TOPDOWN_CONTROLLER     CharacterBody2D + Input.get_axis + move_and_slide
PLATFORMER_CONTROLLER  CharacterBody2D + gravity + jump + is_on_floor
ENEMY_PATROL           CharacterBody2D com patrol_distance e _direction
HEALTH_SYSTEM          Node com signals health_changed e died
COLLECTIBLE            Area2D com signal collected e queue_free
AREA_TRIGGER           Area2D com body_entered/exited e signal triggered
INVENTORY_UI           CanvasLayer com add_item/clear_items via PackedScene
```

Todos templates seguem padrões Godot 4.x (signal.connect(callable), @export var, etc.).

---

## 5. Segurança

```text
[x] Todas as 12 ferramentas bloqueadas em read-only.
[x] Todas suportam dry_run com planned_changes detalhado.
[x] Script path validado via path sandbox (.gd obrigatório, dentro de res://).
[x] FILE_ALREADY_EXISTS retornado se script existe e overwrite=false.
[x] Operação aborta no primeiro erro RPC do plugin (retorna erro do plugin).
```

Limitação conhecida: **não há rollback automático**. Se `script.attach` falhar após `node.add` ter criado o nó, o nó permanece criado. UndoRedo do editor pode reverter manualmente.

---

## 6. Testes automatizados

`tests/toolkit2dTools.test.ts` — 18 testes:

```text
[x] read-only bloqueia create_player_2d
[x] create_player_2d dry_run retorna planned_changes
[x] create_topdown_controller dry_run
[x] create_topdown_controller escreve arquivo com get_axis e move_and_slide
[x] create_platformer_controller escreve template platformer
[x] rejeita path não-.gd → INVALID_PARAMS
[x] FILE_ALREADY_EXISTS sem overwrite=true
[x] create_player_2d emite node.add e script.attach RPC calls
[x] setup_camera_2d emite set_property para enabled e zoom
[x] create_health_system permite override de max_health
[x] setup_collision_2d adds CollisionShape2D
[x] setup_collision_2d blocked in read-only
[x] setup_area_trigger_2d cria Area2D + script (body_entered + triggered.emit)
[x] create_tilemap dry_run
[x] create_tilemap adds TileMap node
[x] setup_parallax_background cria background + N layers
[x] setup_parallax_background defaults a 3 layers
[x] create_inventory_ui CanvasLayer + Control + GridContainer + script (columns)
```

Total projeto: **27 files / 250 tests passing**.

---

## 7. Critério de aprovação (completo)

```text
[x] npm run build limpo
[x] npm test 250/250 passing
[x] 12/12 ferramentas registradas (escopo completo)
[x] Templates GDScript válidos (Godot 4.x)
[x] Orquestração RPC verificada via mock
[x] dry_run + read-only + path sandbox aplicados
[x] ISSUE-016 (toolkits faltantes) FECHADA

[x] Validação manual com Godot ativo (ISSUE-015) — executada 2026-05-04
```

---

## 8. Limitações conhecidas

```text
- setup_collision_2d, create_tilemap, parallax: Resources (Shape2D, TileSet,
  textures) precisam ser atribuídos no inspector — JSON-RPC não pode
  instanciar Resources diretamente.
- inventory_ui: slots devem ser PackedScenes externas adicionadas via
  add_item() em runtime ou no inspector da GridContainer.
```

---

## 9. Status

```text
[x] Aprovada (escopo completo)
```

Validação manual executada em **2026-05-04** com Godot 4.6.1-stable.  
Bug corrigido durante validação: `toolkit2dTools.ts` — `addChildNode` enviava `type`/`name` mas plugin espera `node_type`/`node_name`.  
Gate Fase 12: liberado.
