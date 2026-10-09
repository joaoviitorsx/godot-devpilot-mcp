# DevPilot Prompt Cookbook

Canonical prompts → MCP call sequences. Use as templates. Each ends with verify + iterate steps.

---

## 1. Top-down dungeon-crawler shooter (Bullet Crypt-style)

**Prompt**:
> "Crie um dungeon-crawler 2D top-down com twin-stick aim, projéteis, salas conectadas com portas, boss com 3 padrões, baú, loja, pickups (moedas/coração), HUD shooter, save."

**Calls**:
```
devpilot_init_wizard apply_fixes:true
devpilot_create_project_archetype name:shooter_2d
# iterate the returned call_plan...
devpilot_compose_main_scene rooms_layout:grid
devpilot_check_blueprint_dependencies
devpilot_verify_spec criteria:[
  { type: "main_scene_is", path: "res://scenes/Main.tscn" },
  { type: "autoload_exists", name: "DungeonManager" },
  { type: "blueprint_applied", name: "boss_arena" },
  { type: "input_action_exists", action: "shoot_mouse" },
]
devpilot_run_headless seconds:5
```

**Expected**: project boots, Player walks WASD, mouse aim shoots, rooms transition via doors, boss spawns in last room.

---

## 2. RPG top-down (Diablo-lite)

**Prompt**:
> "Crie um RPG top-down com NPCs com diálogo ramificado, sistema de quests, inventário em grade, tabela de loot weighted. HUD RPG (HP/MP/XP/gold). Salvar progresso em slot 1."

**Calls**:
```
devpilot_create_project_archetype name:rpg_topdown
# iterate playbook
devpilot_blueprint_navigation       # for NPC pathfinding
devpilot_blueprint_behavior_tree    # for NPC AI
devpilot_compose_main_scene
devpilot_verify_spec criteria:[
  { type: "blueprint_applied", name: "dialogue_system" },
  { type: "blueprint_applied", name: "quest_system" },
  { type: "autoload_exists", name: "InventoryGrid" },
  { type: "autoload_exists", name: "SaveManager" },
]
```

---

## 3. FPS 3D minimal

**Prompt**:
> "Crie um FPS 3D simples: jogador first-person, inimigos básicos que perseguem, projéteis, sala 3D com paredes. Crosshair HUD. Pause Esc."

**Calls**:
```
devpilot_create_project_archetype name:fps_3d
# iterate playbook (player_3d fps mode + enemy_3d + projectile_3d + room_3d + presets)
devpilot_compose_main_scene rooms_layout:single
devpilot_run_headless seconds:5
```

---

## 4. Platformer

**Prompt**:
> "Plataforma 2D estilo Mario: pulo, gravidade, inimigos básicos, coletáveis, save."

**Calls**:
```
devpilot_create_project_archetype name:platformer
devpilot_blueprint_animation_state_machine
devpilot_blueprint_vfx_library    # explosion/dust for jumps + hits
devpilot_blueprint_shader_library # hit_flash on damage
godot_create_platformer_controller name:Player
# user authors level via TileMap manually or via devpilot_define_tilemap
devpilot_compose_main_scene
```

---

## 5. RTS prototype

**Prompt**:
> "Protótipo RTS 2D: unidades selecionáveis, click esquerdo seleciona, click direito move. Drag-rectangle seleciona grupo."

**Calls**:
```
devpilot_create_project_archetype name:rts_2d
devpilot_blueprint_navigation
# instance multiple RtsUnit.tscn manually + RtsController as child of Main
devpilot_compose_main_scene rooms_layout:single include_pause:false
```

---

## 6. Physics puzzle

**Prompt**:
> "Puzzle físico com corpos arrastáveis e correntes pin-jointed."

**Calls**:
```
devpilot_create_project_archetype name:physics_puzzle
devpilot_blueprint_shader_library
devpilot_compose_main_scene
```

---

## 7. Survivor-like (Vampire Survivors-ish)

**Prompt**:
> "Survivor-like top-down auto-shooter, ondas crescentes de inimigos, drops de XP, upgrades por nível."

**Calls**:
```
devpilot_apply_preset category:input_map name:topdown
devpilot_apply_preset category:physics_layers name:shooter
devpilot_apply_preset category:hud name:survivor
devpilot_blueprint_audio_bus
devpilot_blueprint_projectile_system
devpilot_blueprint_pickup
devpilot_blueprint_save_schema
devpilot_blueprint_vfx_library
# player + auto-shooter (legacy genre blueprint)
devpilot_create_survivor_like_blueprint
```

---

## 8. Iteration: refining an existing project

**Prompt**:
> "No projeto atual, adicione 2 inimigos atiradores na sala mixed e remova o sistema de save."

**Calls**:
```
devpilot_snapshot_project label:before-refine
devpilot_refine_plan delta_prompt:"adicione 2 inimigos atiradores e remova o save"
# inspect the diff returned
devpilot_apply_refinement target_blueprints:[<final list without save_schema>]
# if errors: devpilot_rollback_to_snapshot id:before-refine confirm:true
```

---

## 9. Custom blueprint registration

Save a project-specific blueprint to share with the team:

```
devpilot_register_custom_blueprint blueprint:{
  name: "my_shop_keeper",
  description: "Specific shopkeeper NPC for our game",
  scripts: [
    { path: "res://scripts/ShopKeeper.gd", content: "extends CharacterBody2D\n..." }
  ],
  scenes: [
    { path: "res://scenes/ShopKeeper.tscn", root: { name: "ShopKeeper", type: "CharacterBody2D" } }
  ]
}
```

Apply later with:
```
devpilot_apply_custom_blueprint name:my_shop_keeper
```

---

## 10. Performance + ship

```
devpilot_performance_budget          # static scan
devpilot_stream_runtime_metrics seconds:10  # live FPS/draw calls during play
devpilot_setup_export_preset target:windows
devpilot_setup_export_preset target:linux
devpilot_setup_export_preset target:web
devpilot_explain_project             # writes overview md
godot_prepare_release_checklist      # legacy tool
```

---

## Conventions

- **Always start with** `devpilot_init_wizard` on a new project.
- **Snapshot before** large mutations (`devpilot_snapshot_project`).
- **Use `devpilot_verify_spec`** in CI to assert acceptance criteria.
- **Check dependencies** between blueprints with `devpilot_check_blueprint_dependencies` before composing.
- **Auto-fix** parse errors with `devpilot_auto_fix_parse_errors` before reporting "broken".
- **Read manifest** (`devpilot_manifest_get`) to know what's already applied — avoid re-running.
