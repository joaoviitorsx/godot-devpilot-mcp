@tool
extends RefCounted

const Protocol = preload("res://addons/godot_devpilot_mcp/core/protocol.gd")
const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")
const UndoService = preload("res://addons/godot_devpilot_mcp/core/undo_service.gd")
const SceneTools = preload("res://addons/godot_devpilot_mcp/tools/scene_tools.gd")
const NodeTools = preload("res://addons/godot_devpilot_mcp/tools/node_tools.gd")
const ScriptTools = preload("res://addons/godot_devpilot_mcp/tools/script_tools.gd")
const DebugTools = preload("res://addons/godot_devpilot_mcp/tools/debug_tools.gd")
const ScreenshotTools = preload("res://addons/godot_devpilot_mcp/tools/screenshot_tools.gd")
const InputTools = preload("res://addons/godot_devpilot_mcp/tools/input_tools.gd")
const RuntimeTools = preload("res://addons/godot_devpilot_mcp/tools/runtime_tools.gd")
const ExtendedTools = preload("res://addons/godot_devpilot_mcp/tools/extended_tools.gd")

const PLUGIN_VERSION := "2.6.0"
const PROTOCOL_VERSION := "1.0.0"

var editor_interface
var _undo_service: UndoService
var _scene_tools: SceneTools
var _node_tools: NodeTools
var _script_tools: ScriptTools
var _debug_tools: DebugTools
var _screenshot_tools: ScreenshotTools
var _input_tools: InputTools
var _runtime_tools: RuntimeTools
var _extended_tools: ExtendedTools


func setup(p_editor_interface, p_undo_redo = null) -> void:
	editor_interface = p_editor_interface

	_undo_service = UndoService.new()
	_undo_service.setup(p_undo_redo)

	_scene_tools = SceneTools.new()
	_scene_tools.setup(editor_interface, _undo_service)

	_node_tools = NodeTools.new()
	_node_tools.setup(editor_interface, _undo_service)

	_script_tools = ScriptTools.new()
	_script_tools.setup(editor_interface, _undo_service)

	_debug_tools = DebugTools.new()
	_debug_tools.setup(editor_interface)

	_screenshot_tools = ScreenshotTools.new()
	_screenshot_tools.setup(editor_interface)

	_input_tools = InputTools.new()
	_input_tools.setup(editor_interface)

	_runtime_tools = RuntimeTools.new()
	_runtime_tools.setup(editor_interface, _input_tools)

	_extended_tools = ExtendedTools.new()
	_extended_tools.setup(editor_interface, _undo_service)


func dispatch(request: Variant) -> Dictionary:
	var validation := Protocol.validate_request(request)
	var request_id = request.get("id") if typeof(request) == TYPE_DICTIONARY else null

	if not validation.get("ok", false):
		return Protocol.error_envelope(request_id, validation["error"])

	var method := str(request["method"])
	var params: Dictionary = request.get("params", {})

	match method:
		"system.health_check":
			return Protocol.success_envelope(request_id, _health_check(params))
		"system.ping":
			return Protocol.success_envelope(request_id, _ping(params))
		"system.get_capabilities":
			return Protocol.success_envelope(request_id, _get_capabilities(params))
		"system.get_connection_status":
			return Protocol.success_envelope(request_id, _get_connection_status(params))
		"system.get_protocol_version":
			return Protocol.success_envelope(request_id, _get_protocol_version(params))
		"project.get_info":
			return Protocol.success_envelope(request_id, _project_get_info(params))
		"project.get_editor_context":
			return Protocol.success_envelope(request_id, _project_get_editor_context(params))
		"project.get_project_settings":
			return Protocol.success_envelope(request_id, _project_get_project_settings(params))
		"project.get_open_scenes":
			return Protocol.success_envelope(request_id, _project_get_open_scenes(params))
		"project.get_selected_nodes":
			return Protocol.success_envelope(request_id, _project_get_selected_nodes(params))
		"project.get_input_map":
			return Protocol.success_envelope(request_id, _project_get_input_map(params))
		"project.add_input_action":
			return Protocol.success_envelope(request_id, _project_add_input_action(params))
		"project.remove_input_action":
			return Protocol.success_envelope(request_id, _project_remove_input_action(params))
		"project.get_autoloads":
			return Protocol.success_envelope(request_id, _project_get_autoloads(params))
		"project.add_autoload":
			return Protocol.success_envelope(request_id, _project_add_autoload(params))
		"project.remove_autoload":
			return Protocol.success_envelope(request_id, _project_remove_autoload(params))
		"project.get_autoloads_full":
			return Protocol.success_envelope(request_id, _project_get_autoloads_full(params))
		"project.reload_autoload":
			return Protocol.success_envelope(request_id, _project_reload_autoload(params))
		"project.reorder_autoloads":
			return Protocol.success_envelope(request_id, _project_reorder_autoloads(params))
		"scene.get_tree":
			return Protocol.success_envelope(request_id, _scene_tools.get_tree(params))
		"scene.get_summary":
			return Protocol.success_envelope(request_id, _scene_tools.get_scene_summary(params))
		"scene.validate":
			return Protocol.success_envelope(request_id, _scene_tools.validate_scene(params))
		"scene.audit":
			return Protocol.success_envelope(request_id, _scene_tools.audit_scene(params))
		"scene.create":
			return Protocol.success_envelope(request_id, _scene_tools.create_scene(params))
		"scene.open":
			return Protocol.success_envelope(request_id, _scene_tools.open_scene(params))
		"scene.save":
			return Protocol.success_envelope(request_id, _scene_tools.save_scene(params))
		"scene.duplicate":
			return Protocol.success_envelope(request_id, _scene_tools.duplicate_scene(params))
		"node.add":
			return Protocol.success_envelope(request_id, _node_tools.add_node(params))
		"node.remove":
			return Protocol.success_envelope(request_id, _node_tools.remove_node(params))
		"node.rename":
			return Protocol.success_envelope(request_id, _node_tools.rename_node(params))
		"node.duplicate":
			return Protocol.success_envelope(request_id, _node_tools.duplicate_node(params))
		"node.reparent":
			return Protocol.success_envelope(request_id, _node_tools.reparent_node(params))
		"node.get_properties":
			return Protocol.success_envelope(request_id, _node_tools.get_node_properties(params))
		"node.set_property":
			return Protocol.success_envelope(request_id, _node_tools.set_node_property(params))
		"node.get_groups":
			return Protocol.success_envelope(request_id, _node_tools.get_node_groups(params))
		"node.add_to_group":
			return Protocol.success_envelope(request_id, _node_tools.add_node_to_group(params))
		"node.remove_from_group":
			return Protocol.success_envelope(request_id, _node_tools.remove_node_from_group(params))
		"script.attach":
			return Protocol.success_envelope(request_id, _script_tools.attach_script(params))
		"script.validate":
			return Protocol.success_envelope(request_id, _script_tools.validate_script(params))
		"script.get_classdb_info":
			return Protocol.success_envelope(request_id, _script_tools.get_classdb_info(params))
		"debug.run_project":
			return Protocol.success_envelope(request_id, _debug_tools.run_project(params))
		"debug.run_scene":
			return Protocol.success_envelope(request_id, _debug_tools.run_scene(params))
		"debug.stop_project":
			return Protocol.success_envelope(request_id, _debug_tools.stop_project(params))
		"debug.is_running":
			return Protocol.success_envelope(request_id, _debug_tools.is_running(params))
		"screenshot.take_game":
			return Protocol.success_envelope(request_id, _screenshot_tools.take_game_screenshot(params))
		"screenshot.take_editor":
			return Protocol.success_envelope(request_id, _screenshot_tools.take_editor_screenshot(params))
		"screenshot.get_viewport":
			return Protocol.success_envelope(request_id, _screenshot_tools.get_viewport_image(params))
		"input.press_action":
			return Protocol.success_envelope(request_id, await _input_tools.press_action(params))
		"input.release_action":
			return Protocol.success_envelope(request_id, _input_tools.release_action(params))
		"input.press_key":
			return Protocol.success_envelope(request_id, await _input_tools.press_key(params))
		"input.release_key":
			return Protocol.success_envelope(request_id, _input_tools.release_key(params))
		"input.tap_key":
			return Protocol.success_envelope(request_id, _input_tools.tap_key(params))
		"input.mouse_move":
			return Protocol.success_envelope(request_id, _input_tools.mouse_move(params))
		"input.mouse_click":
			return Protocol.success_envelope(request_id, _input_tools.mouse_click(params))
		"input.mouse_drag":
			return Protocol.success_envelope(request_id, _input_tools.mouse_drag(params))
		"input.run_sequence":
			return Protocol.success_envelope(request_id, await _input_tools.run_input_sequence(params))
		"runtime.get_tree":
			return Protocol.success_envelope(request_id, _runtime_tools.get_tree_(params))
		"runtime.get_node_properties":
			return Protocol.success_envelope(request_id, _runtime_tools.get_node_properties(params))
		"runtime.set_node_property":
			return Protocol.success_envelope(request_id, _runtime_tools.set_node_property(params))
		"runtime.get_fps":
			return Protocol.success_envelope(request_id, _runtime_tools.get_fps(params))
		"runtime.get_process_stats":
			return Protocol.success_envelope(request_id, _runtime_tools.get_process_stats(params))
		"runtime.find_node":
			return Protocol.success_envelope(request_id, _runtime_tools.find_node_(params))
		"runtime.get_current_camera":
			return Protocol.success_envelope(request_id, _runtime_tools.get_current_camera(params))
		"runtime.find_ui_element":
			return Protocol.success_envelope(request_id, _runtime_tools.find_ui_element(params))
		"runtime.click_ui_by_text":
			return Protocol.success_envelope(request_id, _runtime_tools.click_ui_by_text(params))
		# Phase 17 — execute script
		"script.execute_editor":
			return Protocol.success_envelope(request_id, _extended_tools.execute_editor_script(params))
		"script.execute_game":
			return Protocol.success_envelope(request_id, _extended_tools.execute_game_script(params))
		# Phase 17 — signal wiring
		"node.connect_signal":
			return Protocol.success_envelope(request_id, _extended_tools.connect_signal(params))
		"node.disconnect_signal":
			return Protocol.success_envelope(request_id, _extended_tools.disconnect_signal(params))
		# Phase 17 — scene instance
		"scene.add_instance":
			return Protocol.success_envelope(request_id, _extended_tools.add_scene_instance(params))
		# Phase 17 — TileMap
		"tilemap.set_cell":
			return Protocol.success_envelope(request_id, _extended_tools.tilemap_set_cell(params))
		"tilemap.fill_rect":
			return Protocol.success_envelope(request_id, _extended_tools.tilemap_fill_rect(params))
		"tilemap.get_cell":
			return Protocol.success_envelope(request_id, _extended_tools.tilemap_get_cell(params))
		"tilemap.clear":
			return Protocol.success_envelope(request_id, _extended_tools.tilemap_clear(params))
		"tilemap.get_info":
			return Protocol.success_envelope(request_id, _extended_tools.tilemap_get_info(params))
		"tilemap.get_used_cells":
			return Protocol.success_envelope(request_id, _extended_tools.tilemap_get_used_cells(params))
		# Phase 18 — AnimationTree
		"anim.get_tree_structure":
			return Protocol.success_envelope(request_id, _extended_tools.get_animation_tree_structure(params))
		"anim.add_state":
			return Protocol.success_envelope(request_id, _extended_tools.add_state_machine_state(params))
		"anim.remove_state":
			return Protocol.success_envelope(request_id, _extended_tools.remove_state_machine_state(params))
		"anim.add_transition":
			return Protocol.success_envelope(request_id, _extended_tools.add_state_machine_transition(params))
		"anim.remove_transition":
			return Protocol.success_envelope(request_id, _extended_tools.remove_state_machine_transition(params))
		"anim.set_blend_node":
			return Protocol.success_envelope(request_id, _extended_tools.set_blend_tree_node(params))
		"anim.set_tree_param":
			return Protocol.success_envelope(request_id, _extended_tools.set_tree_parameter(params))
		# Phase 18 — Audio bus
		"audio.get_bus_layout":
			return Protocol.success_envelope(request_id, _extended_tools.get_audio_bus_layout(params))
		"audio.add_bus":
			return Protocol.success_envelope(request_id, _extended_tools.add_audio_bus(params))
		"audio.set_bus":
			return Protocol.success_envelope(request_id, _extended_tools.set_audio_bus(params))
		"audio.add_bus_effect":
			return Protocol.success_envelope(request_id, _extended_tools.add_audio_bus_effect(params))
		"audio.get_info":
			return Protocol.success_envelope(request_id, _extended_tools.get_audio_info(params))
		# Phase 18 — Theme
		"theme.create":
			return Protocol.success_envelope(request_id, _extended_tools.create_theme(params))
		"theme.set_color":
			return Protocol.success_envelope(request_id, _extended_tools.set_theme_color(params))
		"theme.set_constant":
			return Protocol.success_envelope(request_id, _extended_tools.set_theme_constant(params))
		"theme.set_font_size":
			return Protocol.success_envelope(request_id, _extended_tools.set_theme_font_size(params))
		"theme.set_stylebox":
			return Protocol.success_envelope(request_id, _extended_tools.set_theme_stylebox(params))
		"theme.get_info":
			return Protocol.success_envelope(request_id, _extended_tools.get_theme_info(params))
		# Phase 18 — Shader params
		"shader.set_param":
			return Protocol.success_envelope(request_id, _extended_tools.set_shader_param(params))
		"shader.get_params":
			return Protocol.success_envelope(request_id, _extended_tools.get_shader_params(params))
		# Phase 19 — Export
		"export.list_presets":
			return Protocol.success_envelope(request_id, _extended_tools.list_export_presets(params))
		"export.export":
			return Protocol.success_envelope(request_id, _extended_tools.export_project(params))
		"export.get_info":
			return Protocol.success_envelope(request_id, _extended_tools.get_export_info(params))
		# Phase 19 — Resource
		"resource.read":
			return Protocol.success_envelope(request_id, _extended_tools.read_resource(params))
		"resource.edit":
			return Protocol.success_envelope(request_id, _extended_tools.edit_resource(params))
		"resource.create":
			return Protocol.success_envelope(request_id, _extended_tools.create_resource(params))
		# Phase 19 — Batch
		"batch.find_by_type":
			return Protocol.success_envelope(request_id, _extended_tools.find_nodes_by_type(params))
		"batch.set_property":
			return Protocol.success_envelope(request_id, _extended_tools.batch_set_property(params))
		"batch.cross_scene_set":
			return Protocol.success_envelope(request_id, _extended_tools.cross_scene_set_property(params))
		"batch.find_unused":
			return Protocol.success_envelope(request_id, _extended_tools.find_unused_resources(params))
		"batch.detect_circular":
			return Protocol.success_envelope(request_id, _extended_tools.detect_circular_dependencies(params))
		# Phase 19 — UID
		"project.uid_to_path":
			return Protocol.success_envelope(request_id, _extended_tools.uid_to_project_path(params))
		"project.path_to_uid":
			return Protocol.success_envelope(request_id, _extended_tools.project_path_to_uid(params))
		# Phase 20 — Test scenario (used by generate_test_from_behavior)
		"test.create_scenario":
			return Protocol.success_envelope(request_id, _extended_tools.create_scenario_rpc(params))
		# Infer — bind input events at runtime
		"infer.bind_key":
			return Protocol.success_envelope(request_id, _extended_tools.bind_key(params))
		"infer.bind_joypad":
			return Protocol.success_envelope(request_id, _extended_tools.bind_joypad(params))
		_:
			return Protocol.error_envelope(
				request_id,
				ResponseFactory.error(
					"METHOD_NOT_FOUND",
					"Unsupported internal method.",
					{ "method": method },
					["Check the server-to-plugin dispatcher method map."]
				)["error"]
			)


func _health_check(_params: Dictionary) -> Dictionary:
	return ResponseFactory.success(
		{
			"connected": true,
			"godot_version": _get_godot_version(),
			"plugin_version": PLUGIN_VERSION,
			"protocol_version": PROTOCOL_VERSION,
			"project_name": str(ProjectSettings.get_setting("application/config/name", "")),
			"project_path": ProjectSettings.globalize_path("res://")
		},
		"Godot DevPilot MCP plugin is connected."
	)


func _ping(_params: Dictionary) -> Dictionary:
	return ResponseFactory.success(
		{
			"pong": true,
			"timestamp": Time.get_datetime_string_from_system(true, true)
		},
		"Pong."
	)


func _get_capabilities(_params: Dictionary) -> Dictionary:
	return ResponseFactory.success(
		{
			"plugin_version": PLUGIN_VERSION,
			"protocol_version": PROTOCOL_VERSION,
			"available_methods": [
				"system.health_check",
				"system.ping",
				"system.get_capabilities",
				"system.get_connection_status",
				"system.get_protocol_version",
				"project.get_info",
				"project.get_editor_context",
				"project.get_project_settings",
				"project.get_open_scenes",
				"project.get_selected_nodes",
				"project.get_input_map",
				"project.add_input_action",
				"project.remove_input_action",
				"project.get_autoloads",
				"project.add_autoload",
				"project.remove_autoload",
				"scene.get_tree",
				"scene.get_summary",
				"scene.validate",
				"scene.audit",
				"scene.create",
				"scene.open",
				"scene.save",
				"scene.duplicate",
				"node.add",
				"node.remove",
				"node.rename",
				"node.duplicate",
				"node.reparent",
				"node.get_properties",
				"node.set_property",
				"node.get_groups",
				"node.add_to_group",
				"node.remove_from_group",
				"script.attach",
				"script.validate",
				"script.get_classdb_info",
				"debug.run_project",
				"debug.run_scene",
				"debug.stop_project",
				"debug.is_running",
				"screenshot.take_game",
				"screenshot.take_editor",
				"screenshot.get_viewport",
				"input.press_action",
				"input.release_action",
				"input.press_key",
				"input.release_key",
				"input.tap_key",
				"input.mouse_move",
				"input.mouse_click",
				"input.mouse_drag",
				"input.run_sequence",
				"runtime.get_tree",
				"runtime.get_node_properties",
				"runtime.set_node_property",
				"runtime.get_fps",
				"runtime.get_process_stats",
				"runtime.find_node",
				"runtime.get_current_camera",
				"runtime.find_ui_element",
				"runtime.click_ui_by_text"
			],
			"features": {
				"json_rpc": true,
				"health_check": true,
				"heartbeat": true,
				"undo_redo": true,
				"debug_loop": true,
				"screenshots": true,
				"input_simulation": true,
				"runtime_tree": true
			}
		},
		"Plugin capabilities loaded successfully."
	)


func _get_connection_status(_params: Dictionary) -> Dictionary:
	return ResponseFactory.success(
		{
			"connected": true,
			"transport": "websocket",
			"host": "127.0.0.1",
			"port": ProjectSettings.get_setting("godot_devpilot_mcp/server/port", 6505)
		},
		"Plugin connection status obtained."
	)


func _get_protocol_version(_params: Dictionary) -> Dictionary:
	return ResponseFactory.success(
		{
			"protocol_version": PROTOCOL_VERSION,
			"jsonrpc": "2.0"
		},
		"Protocol version obtained."
	)


func _project_get_info(_params: Dictionary) -> Dictionary:
	var main_scene: String = str(ProjectSettings.get_setting("application/run/main_scene", ""))
	return ResponseFactory.success(
		{
			"project_name": str(ProjectSettings.get_setting("application/config/name", "")),
			"project_path": ProjectSettings.globalize_path("res://"),
			"main_scene": main_scene,
			"godot_version": _get_godot_version(),
			"plugin_version": PLUGIN_VERSION,
			"protocol_version": PROTOCOL_VERSION
		},
		"Project info loaded successfully."
	)


func _project_get_editor_context(_params: Dictionary) -> Dictionary:
	if editor_interface == null:
		return ResponseFactory.error(
			"EDITOR_NOT_AVAILABLE",
			"Editor interface is not available.",
			{},
			["Ensure the plugin is loaded in the Godot editor (not headless)."]
		)

	var edited_scene_root: Node = editor_interface.get_edited_scene_root()
	var current_scene: String = ""
	if edited_scene_root != null:
		current_scene = str(edited_scene_root.scene_file_path)

	var selected: Array[String] = []
	var selection: EditorSelection = editor_interface.get_selection()
	if selection != null:
		for node in selection.get_selected_nodes():
			selected.append(str(node.name))

	return ResponseFactory.success(
		{
			"current_scene": current_scene,
			"selected_nodes": selected,
			"is_playing": EditorInterface.is_playing_scene()
		},
		"Editor context obtained."
	)


func _project_get_project_settings(_params: Dictionary) -> Dictionary:
	var settings := {
		"application": {
			"name": str(ProjectSettings.get_setting("application/config/name", "")),
			"main_scene": str(ProjectSettings.get_setting("application/run/main_scene", "")),
			"icon": str(ProjectSettings.get_setting("application/config/icon", ""))
		},
		"display": {
			"width": int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)),
			"height": int(ProjectSettings.get_setting("display/window/size/viewport_height", 648)),
			"resizable": bool(ProjectSettings.get_setting("display/window/size/resizable", true))
		},
		"physics": {
			"2d_default_gravity": float(ProjectSettings.get_setting("physics/2d/default_gravity", 980.0))
		},
		"rendering": {
			"renderer": str(ProjectSettings.get_setting("rendering/renderer/rendering_method", ""))
		}
	}
	return ResponseFactory.success(settings, "Project settings loaded.")


func _project_get_open_scenes(_params: Dictionary) -> Dictionary:
	if editor_interface == null:
		return ResponseFactory.error(
			"EDITOR_NOT_AVAILABLE",
			"Editor interface is not available.",
			{},
			["Ensure the plugin is loaded in the Godot editor (not headless)."]
		)
	var open_scenes: Array[String] = []
	for scene_path in editor_interface.get_open_scenes():
		open_scenes.append(str(scene_path))
	return ResponseFactory.success(
		{"scenes": open_scenes, "count": open_scenes.size()},
		"Open scenes loaded."
	)


func _project_get_selected_nodes(_params: Dictionary) -> Dictionary:
	if editor_interface == null:
		return ResponseFactory.error(
			"EDITOR_NOT_AVAILABLE",
			"Editor interface is not available.",
			{},
			["Ensure the plugin is loaded in the Godot editor (not headless)."]
		)
	var nodes: Array[Dictionary] = []
	var selection: EditorSelection = editor_interface.get_selection()
	if selection != null:
		for node in selection.get_selected_nodes():
			nodes.append({
				"name": str(node.name),
				"type": node.get_class(),
				"path": str(node.get_path()),
				"scene_file_path": str(node.scene_file_path) if not node.scene_file_path.is_empty() else ""
			})
	return ResponseFactory.success(
		{"nodes": nodes, "count": nodes.size()},
		"Selected nodes loaded."
	)


func _project_get_input_map(_params: Dictionary) -> Dictionary:
	var actions: Array[Dictionary] = []
	for action_name in InputMap.get_actions():
		var events: Array[String] = []
		for event in InputMap.action_get_events(action_name):
			events.append(str(event))
		actions.append({
			"name": str(action_name),
			"deadzone": InputMap.action_get_deadzone(action_name),
			"events": events
		})
	return ResponseFactory.success(
		{"actions": actions, "count": actions.size()},
		"Input map loaded."
	)


func _project_add_input_action(params: Dictionary) -> Dictionary:
	var action_name: String = str(params.get("action_name", ""))
	if action_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "action_name is required.", {}, [])

	if InputMap.has_action(action_name):
		return ResponseFactory.error(
			"ACTION_ALREADY_EXISTS",
			"Input action already exists.",
			{"action_name": action_name},
			["Use godot_remove_input_action first, or choose a different name."]
		)

	var deadzone: float = float(params.get("deadzone", 0.5))
	InputMap.add_action(action_name, deadzone)
	ProjectSettings.save()

	return ResponseFactory.success(
		{"action_name": action_name, "deadzone": deadzone},
		"Input action added."
	)


func _project_remove_input_action(params: Dictionary) -> Dictionary:
	var action_name: String = str(params.get("action_name", ""))
	if action_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "action_name is required.", {}, [])

	if not InputMap.has_action(action_name):
		return ResponseFactory.error(
			"ACTION_NOT_FOUND",
			"Input action does not exist.",
			{"action_name": action_name},
			["Use godot_get_input_map to list available actions."]
		)

	InputMap.erase_action(action_name)
	ProjectSettings.save()

	return ResponseFactory.success(
		{"action_name": action_name},
		"Input action removed."
	)


func _project_get_autoloads(_params: Dictionary) -> Dictionary:
	var autoloads: Array[Dictionary] = []
	for prop in ProjectSettings.get_property_list():
		var prop_name: String = str(prop.get("name", ""))
		if prop_name.begins_with("autoload/"):
			var singleton_name: String = prop_name.substr("autoload/".length())
			var singleton_path: String = str(ProjectSettings.get_setting(prop_name, ""))
			autoloads.append({"name": singleton_name, "path": singleton_path})
	return ResponseFactory.success(
		{"autoloads": autoloads, "count": autoloads.size()},
		"Autoloads loaded."
	)


func _project_add_autoload(params: Dictionary) -> Dictionary:
	var singleton_name: String = str(params.get("name", ""))
	var singleton_path: String = str(params.get("path", ""))

	if singleton_name.is_empty() or singleton_path.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "name and path are required.", {}, [])

	var key: String = "autoload/" + singleton_name
	if ProjectSettings.has_setting(key):
		return ResponseFactory.error(
			"AUTOLOAD_ALREADY_EXISTS",
			"Autoload singleton already exists.",
			{"name": singleton_name},
			["Use godot_remove_autoload first, or choose a different name."]
		)

	# Autoloads must be prefixed with "*" to be enabled in Godot 4.x.
	# Without the prefix the singleton is registered but disabled, leading
	# to "Identifier not declared in current scope" parse errors.
	var stored_path: String = singleton_path if singleton_path.begins_with("*") else "*" + singleton_path
	ProjectSettings.set_setting(key, stored_path)
	ProjectSettings.save()

	return ResponseFactory.success(
		{"name": singleton_name, "path": stored_path},
		"Autoload registered (enabled)."
	)


func _project_remove_autoload(params: Dictionary) -> Dictionary:
	var singleton_name: String = str(params.get("name", ""))
	if singleton_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "name is required.", {}, [])

	var key: String = "autoload/" + singleton_name
	if not ProjectSettings.has_setting(key):
		return ResponseFactory.error(
			"AUTOLOAD_NOT_FOUND",
			"Autoload singleton not found.",
			{"name": singleton_name},
			["Use godot_get_autoloads to list registered autoloads."]
		)

	ProjectSettings.set_setting(key, null)
	ProjectSettings.save()

	return ResponseFactory.success(
		{"name": singleton_name},
		"Autoload removed."
	)


func _project_get_autoloads_full(_params: Dictionary) -> Dictionary:
	var autoloads: Array[Dictionary] = []
	for prop in ProjectSettings.get_property_list():
		var prop_name: String = str(prop.get("name", ""))
		if not prop_name.begins_with("autoload/"):
			continue
		var singleton_name: String = prop_name.substr("autoload/".length())
		var raw_path: String = str(ProjectSettings.get_setting(prop_name, ""))
		var enabled: bool = raw_path.begins_with("*")
		var clean_path: String = raw_path.substr(1) if enabled else raw_path
		var script_exists: bool = FileAccess.file_exists(clean_path)
		var loads_ok: bool = false
		var class_name_value: String = ""
		if script_exists and clean_path.ends_with(".gd"):
			var script: GDScript = load(clean_path) as GDScript
			loads_ok = script != null
			if loads_ok:
				class_name_value = str(script.get_global_name()) if script.has_method("get_global_name") else ""
		autoloads.append({
			"name": singleton_name,
			"path": clean_path,
			"raw_path": raw_path,
			"enabled": enabled,
			"script_exists": script_exists,
			"loads_ok": loads_ok,
			"class_name": class_name_value
		})
	return ResponseFactory.success(
		{"autoloads": autoloads, "count": autoloads.size()},
		"Autoloads (full) loaded."
	)


func _project_reload_autoload(params: Dictionary) -> Dictionary:
	var singleton_name: String = str(params.get("name", ""))
	if singleton_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "name is required.", {}, [])
	var key: String = "autoload/" + singleton_name
	if not ProjectSettings.has_setting(key):
		return ResponseFactory.error("AUTOLOAD_NOT_FOUND", "Autoload not found.", {"name": singleton_name}, [])
	var raw_path: String = str(ProjectSettings.get_setting(key, ""))
	ProjectSettings.set_setting(key, null)
	ProjectSettings.set_setting(key, raw_path)
	ProjectSettings.save()
	return ResponseFactory.success({"name": singleton_name, "path": raw_path}, "Autoload reloaded.")


func _project_reorder_autoloads(params: Dictionary) -> Dictionary:
	var order: Array = params.get("order", [])
	if order.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "order array is required.", {}, [])
	var current_paths: Dictionary = {}
	for prop in ProjectSettings.get_property_list():
		var prop_name: String = str(prop.get("name", ""))
		if prop_name.begins_with("autoload/"):
			var singleton_name: String = prop_name.substr("autoload/".length())
			current_paths[singleton_name] = str(ProjectSettings.get_setting(prop_name, ""))
	var missing: Array = []
	for n in order:
		if not current_paths.has(str(n)):
			missing.append(str(n))
	if not missing.is_empty():
		return ResponseFactory.error("AUTOLOAD_NOT_FOUND", "Some autoloads in order do not exist.", {"missing": missing}, [])
	# Remove all then re-add in given order
	for n in current_paths.keys():
		ProjectSettings.set_setting("autoload/" + str(n), null)
	for n in order:
		ProjectSettings.set_setting("autoload/" + str(n), current_paths[str(n)])
	ProjectSettings.save()
	return ResponseFactory.success({"order": order, "count": order.size()}, "Autoloads reordered.")


func _get_godot_version() -> String:
	var version := Engine.get_version_info()
	return str(version.get("string", "unknown"))
