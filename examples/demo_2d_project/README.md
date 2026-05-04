# Demo 2D Project — Godot DevPilot MCP

Minimal 2D scaffold designed to be populated entirely via MCP tools. Open this directory as a separate Godot project (it has its own `project.godot`).

## Setup

```bash
cd examples/demo_2d_project
godot --editor --path .
```

Activate `Godot DevPilot MCP` plugin (copy the `addons/godot_devpilot_mcp/` folder from the parent project, or symlink it).

Start the MCP server pointing at this folder:

```bash
cd ../../mcp-server
GODOT_MCP_READ_ONLY=false GODOT_MCP_PROJECT_ROOT="$(realpath ../examples/demo_2d_project)" npm run dev
```

## Suggested AI tool sequence

```text
1. godot_health_check
2. godot_get_project_info                   # confirm project path
3. godot_open_scene {scene_path:"res://scenes/Main.tscn"}
4. godot_create_player_2d {controller:"platformer"}    # adds Player + Sprite2D + CollisionShape2D + script
5. godot_setup_camera_2d {parent_path:"Player", zoom:1.5}
6. godot_create_enemy_2d {name:"Slime"}
7. godot_create_collectible_2d {name:"Coin"}
8. godot_create_health_system {attach_to:"Player"}
9. godot_create_inventory_ui {columns:6}
10. godot_save_scene
11. godot_run_validation_loop {hold_ms:3000}            # boot the demo
12. godot_assert_no_errors
13. godot_take_game_screenshot                          # capture the result
```

## Pre-configured Input Map

```text
move_left   = A
move_right  = D
move_up     = W
move_down   = S
jump        = Space
```

These match the templates produced by `godot_create_topdown_controller` and `godot_create_platformer_controller`.

## Notes

- Sprite textures and collision shapes are NOT pre-assigned. Open each node in the inspector and assign placeholders to make the scene runnable.
- For a no-asset boot test, replace Sprite2D textures with `ColorRect`/`ReferenceRect` nodes via `godot_add_node`.
- This demo has its own `.godot_mcp/` runtime directory once tools start writing logs/backups.
