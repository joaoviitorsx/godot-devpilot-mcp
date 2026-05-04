@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")
const InputTools = preload("res://addons/godot_devpilot_mcp/tools/input_tools.gd")

var _editor_interface
var _input_tools


func setup(p_editor_interface, p_input_tools = null) -> void:
	_editor_interface = p_editor_interface
	_input_tools = p_input_tools


func _require_editor() -> Dictionary:
	if _editor_interface == null:
		return ResponseFactory.error(
			"EDITOR_NOT_AVAILABLE",
			"Editor interface is not available.",
			{},
			["Ensure the plugin is loaded in the Godot editor (not headless)."]
		)
	return {}


func _require_running() -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check
	if not _editor_interface.is_playing_scene():
		return ResponseFactory.error(
			"RUNTIME_NOT_RUNNING",
			"This runtime tool requires the project to be running.",
			{},
			["Start the project with godot_run_project or godot_run_scene first."]
		)
	return {}


func _scene_root() -> Node:
	if _editor_interface == null:
		return null
	return _editor_interface.get_edited_scene_root()


func _serialize_node(node: Node, depth: int, max_depth: int, include_props: bool) -> Dictionary:
	var data := {
		"name": str(node.name),
		"type": node.get_class(),
		"path": str(node.get_path()) if node.is_inside_tree() else "",
		"groups": []
	}
	for g in node.get_groups():
		data["groups"].append(str(g))

	if include_props:
		data["properties"] = _common_properties(node)

	if depth < max_depth:
		var children: Array = []
		for child in node.get_children():
			children.append(_serialize_node(child, depth + 1, max_depth, include_props))
		data["children"] = children
	else:
		data["children"] = []
		data["truncated"] = true

	return data


func _common_properties(node: Node) -> Dictionary:
	var props := {}
	if node is Node2D:
		props["position"] = {"x": node.position.x, "y": node.position.y}
		props["rotation"] = node.rotation
		props["scale"] = {"x": node.scale.x, "y": node.scale.y}
		props["visible"] = node.visible
		props["z_index"] = node.z_index
	elif node is Node3D:
		props["position"] = {"x": node.position.x, "y": node.position.y, "z": node.position.z}
		props["rotation"] = {"x": node.rotation.x, "y": node.rotation.y, "z": node.rotation.z}
		props["visible"] = node.visible
	elif node is Control:
		props["position"] = {"x": node.position.x, "y": node.position.y}
		props["size"] = {"x": node.size.x, "y": node.size.y}
		props["visible"] = node.visible
	if node.has_method("get") and node.get_class() != "Node":
		pass
	return props


func _read_property(node: Node, name: String) -> Variant:
	if not node.has_method("get"):
		return null
	return node.get(name)


func get_tree_(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var root: Node = _scene_root()
	if root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene currently open.", {}, [])
	var max_depth: int = int(params.get("max_depth", 10))
	var include_props: bool = bool(params.get("include_properties", false))
	var tree := _serialize_node(root, 0, max_depth, include_props)
	return ResponseFactory.success(
		{"tree": tree, "max_depth": max_depth},
		"Runtime tree captured."
	)


func get_node_properties(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var root: Node = _scene_root()
	if root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene currently open.", {}, [])
	var node_path: String = str(params.get("node_path", "."))
	var node: Node = root if node_path == "." or node_path.is_empty() else root.get_node_or_null(node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var requested: Array = params.get("properties", [])
	var props := {}
	if requested.is_empty():
		props = _common_properties(node)
	else:
		for p in requested:
			var key := str(p)
			props[key] = _read_property(node, key)
	return ResponseFactory.success(
		{"node_path": node_path, "type": node.get_class(), "properties": props},
		"Node properties retrieved."
	)


func set_node_property(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var root: Node = _scene_root()
	if root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene currently open.", {}, [])
	var node_path: String = str(params.get("node_path", "."))
	var node: Node = root if node_path == "." or node_path.is_empty() else root.get_node_or_null(node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var property: String = str(params.get("property", ""))
	if property.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "property is required.", {}, [])
	var value: Variant = params.get("value", null)
	var prop_list: Array = node.get_property_list()
	var prop_found := false
	for p in prop_list:
		if str(p.get("name", "")) == property:
			prop_found = true
			break
	if not prop_found:
		return ResponseFactory.error(
			"INVALID_PROPERTY",
			"Property not found on node.",
			{"node_path": node_path, "property": property},
			["Use godot_get_runtime_node_properties to inspect available properties."]
		)
	node.set(property, value)
	return ResponseFactory.success(
		{"node_path": node_path, "property": property, "value": value},
		"Runtime property set (will revert when game stops)."
	)


func get_fps(_params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check
	return ResponseFactory.success(
		{
			"fps": Engine.get_frames_per_second(),
			"physics_fps": Engine.physics_ticks_per_second,
			"running": _editor_interface.is_playing_scene()
		},
		"FPS retrieved."
	)


func get_process_stats(_params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check
	var stats := {
		"fps": Performance.get_monitor(Performance.TIME_FPS),
		"frame_time_ms": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		"physics_frame_time_ms": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
		"static_memory_bytes": Performance.get_monitor(Performance.MEMORY_STATIC),
		"object_count": Performance.get_monitor(Performance.OBJECT_COUNT),
		"node_count": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
		"draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"running": _editor_interface.is_playing_scene()
	}
	return ResponseFactory.success(stats, "Process stats retrieved.")


func _walk(root: Node, callable: Callable, results: Array, limit: int) -> void:
	if results.size() >= limit:
		return
	if callable.call(root):
		results.append(root)
		if results.size() >= limit:
			return
	for child in root.get_children():
		_walk(child, callable, results, limit)


func find_node_(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var root: Node = _scene_root()
	if root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene currently open.", {}, [])

	var name_q: String = str(params.get("name", "")).to_lower()
	var type_q: String = str(params.get("type", ""))
	var group_q: String = str(params.get("group", ""))
	var limit: int = int(params.get("limit", 50))

	var matches: Array[Node] = []
	var matcher := func(n: Node) -> bool:
		var ok := true
		if not name_q.is_empty():
			ok = ok and str(n.name).to_lower().find(name_q) >= 0
		if not type_q.is_empty():
			ok = ok and (n.get_class() == type_q or n.is_class(type_q))
		if not group_q.is_empty():
			ok = ok and n.is_in_group(group_q)
		return ok
	_walk(root, matcher, matches, limit)

	var nodes: Array = []
	for n in matches:
		nodes.append({
			"name": str(n.name),
			"type": n.get_class(),
			"path": str(n.get_path())
		})
	return ResponseFactory.success(
		{"nodes": nodes, "count": nodes.size()},
		"Runtime nodes located."
	)


func get_current_camera(_params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var root: Node = _scene_root()
	if root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene currently open.", {}, [])

	var viewport: Viewport = root.get_viewport()
	var cam2d := viewport.get_camera_2d() if viewport != null else null
	var cam3d := viewport.get_camera_3d() if viewport != null else null

	if cam2d != null:
		return ResponseFactory.success(
			{
				"kind": "Camera2D",
				"path": str(cam2d.get_path()),
				"position": {"x": cam2d.global_position.x, "y": cam2d.global_position.y},
				"zoom": {"x": cam2d.zoom.x, "y": cam2d.zoom.y},
				"enabled": cam2d.enabled
			},
			"Current Camera2D retrieved."
		)
	if cam3d != null:
		return ResponseFactory.success(
			{
				"kind": "Camera3D",
				"path": str(cam3d.get_path()),
				"position": {"x": cam3d.global_position.x, "y": cam3d.global_position.y, "z": cam3d.global_position.z},
				"fov": cam3d.fov,
				"current": cam3d.current
			},
			"Current Camera3D retrieved."
		)
	return ResponseFactory.error(
		"NO_CAMERA",
		"No active Camera2D or Camera3D found.",
		{},
		["Add a Camera2D/Camera3D and mark it as current."]
	)


func _control_visible_text(node: Node) -> String:
	if node == null or not (node is Control):
		return ""
	if node.has_method("get_text"):
		return str(node.call("get_text"))
	if "text" in node:
		return str(node.get("text"))
	return ""


func find_ui_element(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var root: Node = _scene_root()
	if root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene currently open.", {}, [])

	var text_q: String = str(params.get("text", "")).to_lower()
	var name_q: String = str(params.get("name", "")).to_lower()
	var type_q: String = str(params.get("type", ""))

	var matches: Array[Node] = []
	var matcher := func(n: Node) -> bool:
		if not (n is Control):
			return false
		var ok := true
		if not type_q.is_empty():
			ok = ok and (n.get_class() == type_q or n.is_class(type_q))
		if not name_q.is_empty():
			ok = ok and str(n.name).to_lower().find(name_q) >= 0
		if not text_q.is_empty():
			var t := _control_visible_text(n).to_lower()
			ok = ok and t.find(text_q) >= 0
		return ok
	_walk(root, matcher, matches, 50)

	var nodes: Array = []
	for n in matches:
		var ctrl := n as Control
		var center := ctrl.global_position + ctrl.size * 0.5
		nodes.append({
			"name": str(ctrl.name),
			"type": ctrl.get_class(),
			"path": str(ctrl.get_path()),
			"text": _control_visible_text(ctrl),
			"position": {"x": ctrl.global_position.x, "y": ctrl.global_position.y},
			"size": {"x": ctrl.size.x, "y": ctrl.size.y},
			"center": {"x": center.x, "y": center.y}
		})
	return ResponseFactory.success(
		{"elements": nodes, "count": nodes.size()},
		"UI elements located."
	)


func click_ui_by_text(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	if _input_tools == null:
		return ResponseFactory.error(
			"INPUT_TOOLS_UNAVAILABLE",
			"InputTools not wired into RuntimeTools.",
			{},
			["Ensure the dispatcher initializes runtime_tools with input_tools reference."]
		)
	var text: String = str(params.get("text", ""))
	if text.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "text is required.", {}, [])

	var find_result := find_ui_element({"text": text})
	if not find_result.get("ok", false):
		return find_result
	var elements: Array = find_result.get("data", {}).get("elements", [])
	if elements.is_empty():
		return ResponseFactory.error(
			"UI_ELEMENT_NOT_FOUND",
			"No Control with matching text was found.",
			{"text": text},
			["Use godot_find_ui_element to inspect available UI."]
		)

	var first: Dictionary = elements[0]
	var center: Dictionary = first.get("center", {"x": 0, "y": 0})
	_input_tools.mouse_click({"x": center.x, "y": center.y, "button": "left"})
	return ResponseFactory.success(
		{"clicked": first.get("path", ""), "text": text, "center": center},
		"UI element clicked."
	)
