# Example: rpg_topdown_complete

Reference project for a top-down RPG built fully via DevPilot MCP.

## What it covers

- Top-down player + 4-direction movement + interact
- Dialogue Resource graph + DialogueBox UI
- Quest Resource + QuestManager autoload
- Inventory grid + ItemData + InventoryUI panel
- Loot table (weighted)
- Save schema (Resource-based) + localization (en/pt)
- HUD RPG (HP/MP/XP/gold)
- Audio bus, settings persistence, scene transitions
- Behavior tree for NPCs, navigation agent

## Reproduce from scratch

```text
devpilot_init_wizard apply_fixes:true
devpilot_create_project_archetype name:rpg_topdown
devpilot_blueprint_behavior_tree
devpilot_blueprint_navigation
devpilot_blueprint_scene_transitions
devpilot_blueprint_settings_manager
devpilot_blueprint_vfx_library
devpilot_compose_main_scene rooms_layout:single set_as_main:true
devpilot_verify_spec criteria:[
  {"type": "blueprint_applied", "name": "dialogue_system"},
  {"type": "blueprint_applied", "name": "quest_system"},
  {"type": "blueprint_applied", "name": "inventory_grid"},
  {"type": "blueprint_applied", "name": "loot_table"},
  {"type": "autoload_exists", "name": "DialogueManager"},
  {"type": "autoload_exists", "name": "QuestManager"},
  {"type": "autoload_exists", "name": "InventoryGrid"},
  {"type": "autoload_exists", "name": "SaveManager"},
  {"type": "autoload_exists", "name": "LocaleManager"}
]
```

## Authoring next

After the playbook runs:

1. Open `scripts/DialogueGraph.gd` Resource (`.tres`) — author lines + branching choices in Inspector.
2. Open `scripts/QuestData.gd` Resource — instantiate per quest, fill objectives.
3. Open `scripts/ItemData.gd` Resource — create individual item resources.
4. `LootTable` resources reference ItemData ids + weights.
5. Compose your overworld map via `devpilot_define_scene` or manually in editor.

## Controls

- WASD / arrows — move
- E — interact (NPCs, chests)
- Esc — pause
