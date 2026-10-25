extends Node

# Runs inside the game, never inside the editor. The editor debugger transports
# requests here so input and scene inspection affect the actual running scene.
const InputTools = preload("res://addons/godot_devpilot_mcp/tools/input_tools.gd")
const RuntimeTools = preload("res://addons/godot_devpilot_mcp/tools/runtime_tools.gd")
const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")
const Permissions = preload("res://addons/godot_devpilot_mcp/core/permissions.gd")

class GameContext:
	extends RefCounted
	var scene_tree: SceneTree
	func is_playing_scene() -> bool:
		return scene_tree.current_scene != null
	func get_edited_scene_root() -> Node:
		return scene_tree.current_scene

var _context: GameContext
var _input_tools
var _runtime_tools


func _ready() -> void:
	if not EngineDebugger.is_active():
		return
	_context = GameContext.new()
	_context.scene_tree = get_tree()
	_input_tools = InputTools.new()
	_input_tools.setup(_context)
	_runtime_tools = RuntimeTools.new()
	_runtime_tools.setup(_context, _input_tools)
	EngineDebugger.register_message_capture("devpilot_runtime", _capture)


func _exit_tree() -> void:
	if EngineDebugger.is_active():
		EngineDebugger.unregister_message_capture("devpilot_runtime")


func _capture(message: String, data: Array) -> bool:
	if message != "request" or data.size() != 3:
		return false
	call_deferred("_execute", int(data[0]), str(data[1]), data[2])
	return true


func _execute(id: int, method: String, params: Dictionary) -> void:
	var result: Dictionary
	match method:
		"input.press_action": result = await _input_tools.press_action(params)
		"input.release_action": result = _input_tools.release_action(params)
		"input.press_key": result = await _input_tools.press_key(params)
		"input.release_key": result = _input_tools.release_key(params)
		"input.tap_key": result = await _input_tools.tap_key(params)
		"input.mouse_move": result = _input_tools.mouse_move(params)
		"input.mouse_click": result = await _input_tools.mouse_click(params)
		"input.mouse_drag": result = await _input_tools.mouse_drag(params)
		"input.run_sequence": result = await _input_tools.run_input_sequence(params)
		"runtime.get_tree": result = _runtime_tools.get_tree_(params)
		"runtime.get_node_properties": result = _runtime_tools.get_node_properties(params)
		"runtime.set_node_property": result = _runtime_tools.set_node_property(params)
		"runtime.get_fps": result = _runtime_tools.get_fps(params)
		"runtime.get_process_stats": result = _runtime_tools.get_process_stats(params)
		"runtime.find_node": result = _runtime_tools.find_node_(params)
		"runtime.get_current_camera": result = _runtime_tools.get_current_camera(params)
		"runtime.find_ui_element": result = _runtime_tools.find_ui_element(params)
		"runtime.click_ui_by_text": result = await _runtime_tools.click_ui_by_text(params)
		"screenshot.take_game": result = await _take_screenshot(params)
		_: result = ResponseFactory.error("METHOD_NOT_FOUND", "Unknown game runtime method.", {"method": method})
	if EngineDebugger.is_active():
		EngineDebugger.send_message("devpilot_runtime:response", [id, _json_safe(result)])


func _take_screenshot(params: Dictionary) -> Dictionary:
	var output_path := str(params.get("output_path", ""))
	if not Permissions.is_res_path_allowed(output_path) or not output_path.ends_with(".png"):
		return ResponseFactory.error("INVALID_PARAMS", "Use a .png path inside the project.", {"path": output_path})
	if get_tree().current_scene == null:
		return ResponseFactory.error("RUNTIME_NOT_RUNNING", "No game scene is running.")
	if DisplayServer.get_name() == "headless":
		return ResponseFactory.error("SCREENSHOT_UNAVAILABLE_HEADLESS", "The game has no rendered viewport in headless mode.", {}, ["Run Godot with a graphics renderer for screenshots."])
	await RenderingServer.frame_post_draw
	var image: Image = get_viewport().get_texture().get_image()
	if image == null or image.is_empty():
		return ResponseFactory.error("SCREENSHOT_FAILED", "Could not read the game viewport.")
	var absolute := ProjectSettings.globalize_path(output_path)
	if DirAccess.make_dir_recursive_absolute(absolute.get_base_dir()) != OK:
		return ResponseFactory.error("SCREENSHOT_FAILED", "Could not create screenshot directory.", {"path": output_path})
	var err := image.save_png(output_path)
	if err != OK:
		return ResponseFactory.error("SCREENSHOT_FAILED", "Could not save game screenshot.", {"path": output_path, "error_code": err})
	return ResponseFactory.success({"path": output_path, "width": image.get_width(), "height": image.get_height()}, "Game viewport screenshot saved.")


func _json_safe(value: Variant, depth: int = 0) -> Variant:
	if depth > 64:
		return "<max depth>"
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_DICTIONARY:
			var out := {}
			for key in value:
				out[str(key)] = _json_safe(value[key], depth + 1)
			return out
		TYPE_ARRAY:
			var out := []
			for item in value:
				out.append(_json_safe(item, depth + 1))
			return out
		TYPE_VECTOR2:
			return {"x": value.x, "y": value.y}
		TYPE_VECTOR3:
			return {"x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR:
			return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_OBJECT:
			if value == null:
				return null
			return {"type": value.get_class(), "path": str(value.resource_path) if value is Resource else str(value.get_path()) if value is Node and value.is_inside_tree() else ""}
		_:
			return str(value)
