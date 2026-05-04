# Demo 3D Project — Godot DevPilot MCP

Minimal 3D scaffold (CharacterBody3D + camera + lighting). Populate via MCP tools.

## Setup

```bash
cd examples/demo_3d_project
godot --editor --path .
```

Activate the `Godot DevPilot MCP` plugin (copy/symlink `addons/godot_devpilot_mcp/`).

Start the MCP server pointing at this folder:

```bash
cd ../../mcp-server
GODOT_MCP_READ_ONLY=false GODOT_MCP_PROJECT_ROOT="$(realpath ../examples/demo_3d_project)" npm run dev
```

## Suggested AI tool sequence

```text
1. godot_health_check
2. godot_open_scene {scene_path:"res://scenes/Main.tscn"}
3. godot_setup_lighting
4. godot_create_character_body_3d {name:"Player", include_camera:true}
5. godot_create_primitive_mesh {parent_path:"Player/Mesh", primitive:"CapsuleMesh"}
6. godot_create_navigation_region_3d
7. godot_setup_physics_body {name:"Floor", body_type:"StaticBody3D", include_visual:true}
8. godot_save_scene
9. godot_run_validation_loop {hold_ms:3000}
10. godot_assert_no_errors
11. godot_take_game_screenshot
```

## Pre-configured Input Map

```text
move_forward = W
move_back    = S
move_left    = A
move_right   = D
jump         = Space
```

These match the `THIRD_PERSON_CONTROLLER` template attached by `godot_create_character_body_3d`.

## Manual steps (Resources require inspector)

After scaffolding:

1. Assign a `BoxMesh` / `CapsuleMesh` to `Player/Mesh.mesh`.
2. Assign a matching `BoxShape3D` / `CapsuleShape3D` to `Player/Collision.shape`.
3. Create an `Environment.tres` and assign to `WorldEnvironment.environment` (sky_mode = AUTOMATIC for default sky).
4. Press F6 in the editor or call `godot_run_project` to test.

The demo intentionally ships with no .tres resources — they are user-authored.
