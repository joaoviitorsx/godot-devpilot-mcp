# Example: fps_3d_complete

Reference project for a 3D first-person shooter built via DevPilot MCP.

## Reproduce

```text
devpilot_init_wizard apply_fixes:true
devpilot_create_project_archetype name:fps_3d
devpilot_blueprint_audio_bus
devpilot_blueprint_settings_manager
devpilot_blueprint_scene_transitions
devpilot_compose_main_scene rooms_layout:single set_as_main:true
devpilot_verify_spec criteria:[
  {"type": "blueprint_applied", "name": "player_3d"},
  {"type": "blueprint_applied", "name": "enemy_3d"},
  {"type": "blueprint_applied", "name": "projectile_3d"},
  {"type": "blueprint_applied", "name": "dungeon_room_3d"}
]
```

## Controls

- WASD — move
- Mouse — look (capture on play)
- Space — jump
- LMB — fire (wire your own weapon to spawn PlayerProjectile3D)
- Esc — pause
