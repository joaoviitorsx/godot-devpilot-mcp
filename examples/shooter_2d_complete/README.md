# Example: shooter_2d_complete

Reference project for a top-down twin-stick dungeon-crawler shooter built fully via DevPilot MCP.

## What it covers

- Twin-stick player + dodge roll + reload + HP
- Player + enemy bullets via projectile_system
- Dungeon w/ rooms + doors + chest + shop + pickups
- Boss arena w/ 3 attack patterns (radial / burst / sweep)
- HUD: HP / coins / ammo / boss bar / messages
- Audio bus, save schema, settings persistence
- VFX library + scene transitions

## Reproduce from scratch

1. Empty Godot 4 project, addon installed, MCP connected.
2. Run:

```text
devpilot_init_wizard apply_fixes:true
devpilot_create_project_archetype name:shooter_2d
# Iterate the returned call_plan one tool at a time
devpilot_blueprint_vfx_library
devpilot_blueprint_scene_transitions
devpilot_blueprint_settings_manager
devpilot_compose_main_scene rooms_layout:grid set_as_main:true
devpilot_check_blueprint_dependencies
devpilot_verify_spec criteria:[
  {"type": "main_scene_is", "path": "res://scenes/Main.tscn"},
  {"type": "autoload_exists", "name": "DungeonManager"},
  {"type": "autoload_exists", "name": "AudioManager"},
  {"type": "autoload_exists", "name": "SaveManager"},
  {"type": "autoload_exists", "name": "SettingsManager"},
  {"type": "blueprint_applied", "name": "boss_arena"},
  {"type": "blueprint_applied", "name": "projectile_system"},
  {"type": "input_action_exists", "action": "shoot_mouse"}
]
devpilot_run_headless seconds:5
```

## Files generated

```
scripts/
  PlayerTwinStick.gd, PlayerWeapon.gd
  Bullet.gd, PlayerBullet.gd, EnemyBullet.gd
  RoomManager.gd, DungeonManager.gd, Door.gd
  BossBase.gd
  ShopItem.gd, Chest.gd, Pickup.gd
  HUD.gd, AudioManager.gd, SaveManager.gd, SettingsManager.gd
  VFXBurst.gd, SceneTransitions.gd
scenes/
  Main.tscn (composed via devpilot_compose_main_scene)
  PlayerTwinStick.tscn, PlayerBullet.tscn, EnemyBullet.tscn
  Room.tscn, Door.tscn, Boss.tscn
  ShopItem.tscn, Chest.tscn, Pickup.tscn
  HUD.tscn
  vfx/VFX_explosion.tscn, VFX_fire.tscn, VFX_blood.tscn, VFX_sparkle.tscn, VFX_dust.tscn
default_bus_layout.tres
```

## Controls (post-build)

- WASD / arrows — move
- Mouse — aim, LMB — fire
- IJKL — alternate keyboard aim
- Space — dodge roll
- R — reload
- E — interact (chest/shop)
- Esc — pause

## Acceptance criteria

See `devpilot_verify_spec` block above; all 8 should pass after running playbook.
