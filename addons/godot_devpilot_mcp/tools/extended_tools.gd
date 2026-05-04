@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")

var _editor_interface
var _undo_service


func setup(p_editor_interface, p_undo_service) -> void:
	_editor_interface = p_editor_interface
	_undo_service = p_undo_service


# ── Shared helpers ────────────────────────────────────────────────────────────

func _require_editor() -> Dictionary:
	if _editor_interface == null:
		return ResponseFactory.error("EDITOR_NOT_AVAILABLE", "Editor interface is not available.", {}, ["Ensure the plugin is loaded in the Godot editor."])
	return {}


func _require_scene_root():
	if _editor_interface == null:
		return null
	return _editor_interface.get_edited_scene_root()


func _resolve_node(scene_root: Node, path: String) -> Node:
	if path == "." or path.is_empty():
		return scene_root
	return scene_root.get_node_or_null(path)


func _require_undo_redo(tool_name: String) -> Dictionary:
	if _undo_service == null or not _undo_service.has_undo_redo():
		return ResponseFactory.error("UNDO_FAILED", "UndoRedo not available.", {"tool": tool_name}, [])
	return {}


func _variant_to_json(value) -> Variant:
	match typeof(value):
		TYPE_NIL: return null
		TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING: return value
		TYPE_VECTOR2: return {"x": value.x, "y": value.y}
		TYPE_VECTOR3: return {"x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR: return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_RECT2: return {"x": value.position.x, "y": value.position.y, "w": value.size.x, "h": value.size.y}
		TYPE_NODE_PATH: return str(value)
		TYPE_STRING_NAME: return str(value)
		_: return str(value)


func _parse_color(hex: String) -> Color:
	if hex.begins_with("#"):
		return Color.html(hex)
	if hex.begins_with("rgba("):
		var inner := hex.trim_prefix("rgba(").trim_suffix(")")
		var parts := inner.split(",")
		if parts.size() >= 4:
			return Color(float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]))
	return Color.WHITE


# ── Phase 17: execute_editor_script ──────────────────────────────────────────

func execute_editor_script(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var code: String = str(params.get("code", ""))
	if code.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "code is required.", {}, [])

	var wrapped := "@tool\nextends RefCounted\n\nvar _output: Array = []\n\nfunc _print(msg) -> void:\n\t_output.append(str(msg))\n\nfunc execute(editor_interface) -> Array:\n"
	for line in code.split("\n"):
		wrapped += "\t" + line + "\n"
	wrapped += "\treturn _output\n"

	var temp_dir := ProjectSettings.globalize_path("res://.godot_mcp/temp")
	DirAccess.make_dir_recursive_absolute(temp_dir)
	var temp_path := temp_dir + "/exec_editor.gd"

	var file := FileAccess.open(temp_path, FileAccess.WRITE)
	if file == null:
		return ResponseFactory.error("WRITE_ERROR", "Cannot write temp script.", {}, [])
	file.store_string(wrapped)
	file.close()

	var script: GDScript = GDScript.new()
	script.source_code = wrapped
	var err := script.reload()
	if err != OK:
		return ResponseFactory.error("SCRIPT_ERROR", "Script compile error (code %d). Check syntax." % err, {"code": err}, [])

	var instance = script.new()
	var output = []
	if instance.has_method("execute"):
		output = instance.execute(_editor_interface)

	return ResponseFactory.success(
		{"output": output, "lines": output.size()},
		"Editor script executed."
	)


func execute_game_script(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	if not EditorInterface.is_playing_scene():
		return ResponseFactory.error("RUNTIME_NOT_RUNNING", "Project must be running to execute game scripts.", {}, ["Call godot_run_project first."])

	var code: String = str(params.get("code", ""))
	if code.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "code is required.", {}, [])

	var wrapped := "@tool\nextends RefCounted\n\nvar _output: Array = []\n\nfunc execute(scene_tree) -> Array:\n"
	for line in code.split("\n"):
		wrapped += "\t" + line + "\n"
	wrapped += "\treturn _output\n"

	var script: GDScript = GDScript.new()
	script.source_code = wrapped
	var err := script.reload()
	if err != OK:
		return ResponseFactory.error("SCRIPT_ERROR", "Script compile error (code %d)." % err, {"code": err}, [])

	var instance = script.new()
	var output = []
	if instance.has_method("execute"):
		var main_loop = Engine.get_main_loop()
		output = instance.execute(main_loop)

	return ResponseFactory.success({"output": output, "lines": output.size()}, "Game script executed.")


# ── Phase 17: connect/disconnect signal ───────────────────────────────────────

func connect_signal(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_connect_signal")
	if not undo_check.is_empty():
		return undo_check

	var source_path: String = str(params.get("source_path", "."))
	var signal_name: String = str(params.get("signal_name", ""))
	var target_path: String = str(params.get("target_path", "."))
	var method_name: String = str(params.get("method_name", ""))
	var flags: int = int(params.get("flags", 0))

	if signal_name.is_empty() or method_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "signal_name and method_name are required.", {}, [])

	var source := _resolve_node(scene_root, source_path)
	if source == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Source node not found.", {"path": source_path}, [])

	var target := _resolve_node(scene_root, target_path)
	if target == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Target node not found.", {"path": target_path}, [])

	if not source.has_signal(signal_name):
		return ResponseFactory.error("SIGNAL_NOT_FOUND", "Signal '%s' not found on node." % signal_name, {"signal": signal_name, "node_type": source.get_class()}, [])

	if not target.has_method(method_name):
		return ResponseFactory.error("METHOD_NOT_FOUND", "Method '%s' not found on target node." % method_name, {"method": method_name, "node_type": target.get_class()}, [])

	if source.is_connected(signal_name, Callable(target, method_name)):
		return ResponseFactory.error("ALREADY_CONNECTED", "Signal is already connected.", {"signal": signal_name, "method": method_name}, [])

	_undo_service.create_action("Connect %s.%s → %s.%s" % [source.name, signal_name, target.name, method_name])
	_undo_service.add_do_method(self, "_do_connect", [source, signal_name, target, method_name, flags])
	_undo_service.add_undo_method(self, "_do_disconnect", [source, signal_name, target, method_name])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{"source_path": source_path, "signal": signal_name, "target_path": target_path, "method": method_name},
		"Signal connected."
	)


func disconnect_signal(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_disconnect_signal")
	if not undo_check.is_empty():
		return undo_check

	var source_path: String = str(params.get("source_path", "."))
	var signal_name: String = str(params.get("signal_name", ""))
	var target_path: String = str(params.get("target_path", "."))
	var method_name: String = str(params.get("method_name", ""))

	var source := _resolve_node(scene_root, source_path)
	var target := _resolve_node(scene_root, target_path)

	if source == null or target == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Source or target node not found.", {}, [])

	if not source.is_connected(signal_name, Callable(target, method_name)):
		return ResponseFactory.error("NOT_CONNECTED", "Signal is not connected.", {"signal": signal_name}, [])

	_undo_service.create_action("Disconnect %s.%s → %s.%s" % [source.name, signal_name, target.name, method_name])
	_undo_service.add_do_method(self, "_do_disconnect", [source, signal_name, target, method_name])
	_undo_service.add_undo_method(self, "_do_connect", [source, signal_name, target, method_name, 0])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{"source_path": source_path, "signal": signal_name, "target_path": target_path, "method": method_name},
		"Signal disconnected."
	)


func _do_connect(source: Node, sig: String, target: Node, method: String, flags: int) -> void:
	if source != null and target != null and source.has_signal(sig):
		source.connect(sig, Callable(target, method), flags)


func _do_disconnect(source: Node, sig: String, target: Node, method: String) -> void:
	if source != null and target != null and source.is_connected(sig, Callable(target, method)):
		source.disconnect(sig, Callable(target, method))


# ── Phase 17: add_scene_instance ─────────────────────────────────────────────

func add_scene_instance(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_add_scene_instance")
	if not undo_check.is_empty():
		return undo_check

	var scene_path: String = str(params.get("scene_path", ""))
	var parent_path: String = str(params.get("parent_path", "."))
	var instance_name: String = str(params.get("instance_name", ""))

	if scene_path.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "scene_path is required.", {}, [])

	if not scene_path.ends_with(".tscn") and not scene_path.ends_with(".scn"):
		return ResponseFactory.error("INVALID_PARAMS", "scene_path must be a .tscn or .scn file.", {}, [])

	var packed_scene: PackedScene = load(scene_path) as PackedScene
	if packed_scene == null:
		return ResponseFactory.error("SCENE_NOT_FOUND", "Scene file not found or invalid.", {"path": scene_path}, [])

	var parent := _resolve_node(scene_root, parent_path)
	if parent == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Parent node not found.", {"path": parent_path}, [])

	var instance: Node = packed_scene.instantiate()
	if not instance_name.is_empty():
		instance.name = instance_name

	_undo_service.create_action("Add scene instance %s" % instance.name)
	_undo_service.add_do_method(self, "_add_child_owned", [parent, instance, scene_root])
	_undo_service.add_undo_method(self, "_remove_child_if_parent", [parent, instance])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{
			"scene_path": scene_path,
			"instance_name": str(instance.name),
			"parent_path": parent_path,
			"node_path": str(scene_root.get_path_to(instance))
		},
		"Scene instanced."
	)


func _add_child_owned(parent: Node, child: Node, owner: Node) -> void:
	if child.get_parent() != null:
		child.get_parent().remove_child(child)
	parent.add_child(child, true)
	child.owner = owner


func _remove_child_if_parent(parent: Node, child: Node) -> void:
	if child.get_parent() == parent:
		parent.remove_child(child)


# ── Phase 17: TileMap tools ───────────────────────────────────────────────────

func _get_tilemap(params: Dictionary):
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var node_path: String = str(params.get("node_path", "."))
	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"path": node_path}, [])

	if not node.is_class("TileMap") and not node.is_class("TileMapLayer"):
		return ResponseFactory.error("INVALID_NODE_TYPE", "Node is not a TileMap or TileMapLayer.", {"type": node.get_class()}, [])

	return node


func tilemap_set_cell(params: Dictionary) -> Dictionary:
	var tilemap = _get_tilemap(params)
	if tilemap is Dictionary:
		return tilemap

	var layer: int = int(params.get("layer", 0))
	var x: int = int(params.get("x", 0))
	var y: int = int(params.get("y", 0))
	var source_id: int = int(params.get("source_id", 0))
	var atlas_x: int = int(params.get("atlas_x", 0))
	var atlas_y: int = int(params.get("atlas_y", 0))
	var alt: int = int(params.get("alternative_tile", 0))

	if tilemap.is_class("TileMap"):
		tilemap.set_cell(layer, Vector2i(x, y), source_id, Vector2i(atlas_x, atlas_y), alt)
	else:
		tilemap.set_cell(Vector2i(x, y), source_id, Vector2i(atlas_x, atlas_y), alt)

	return ResponseFactory.success(
		{"x": x, "y": y, "source_id": source_id, "atlas": [atlas_x, atlas_y]},
		"Cell set."
	)


func tilemap_fill_rect(params: Dictionary) -> Dictionary:
	var tilemap = _get_tilemap(params)
	if tilemap is Dictionary:
		return tilemap

	var layer: int = int(params.get("layer", 0))
	var x: int = int(params.get("x", 0))
	var y: int = int(params.get("y", 0))
	var width: int = int(params.get("width", 1))
	var height: int = int(params.get("height", 1))
	var source_id: int = int(params.get("source_id", 0))
	var atlas_x: int = int(params.get("atlas_x", 0))
	var atlas_y: int = int(params.get("atlas_y", 0))
	var alt: int = int(params.get("alternative_tile", 0))
	var cells_set := 0

	for cx in range(x, x + width):
		for cy in range(y, y + height):
			if tilemap.is_class("TileMap"):
				tilemap.set_cell(layer, Vector2i(cx, cy), source_id, Vector2i(atlas_x, atlas_y), alt)
			else:
				tilemap.set_cell(Vector2i(cx, cy), source_id, Vector2i(atlas_x, atlas_y), alt)
			cells_set += 1

	return ResponseFactory.success(
		{"cells_set": cells_set, "rect": {"x": x, "y": y, "w": width, "h": height}},
		"Rect filled."
	)


func tilemap_get_cell(params: Dictionary) -> Dictionary:
	var tilemap = _get_tilemap(params)
	if tilemap is Dictionary:
		return tilemap

	var layer: int = int(params.get("layer", 0))
	var x: int = int(params.get("x", 0))
	var y: int = int(params.get("y", 0))
	var coords := Vector2i(x, y)

	var source_id: int
	var atlas_coords: Vector2i
	var alt: int

	if tilemap.is_class("TileMap"):
		source_id = tilemap.get_cell_source_id(layer, coords)
		atlas_coords = tilemap.get_cell_atlas_coords(layer, coords)
		alt = tilemap.get_cell_alternative_tile(layer, coords)
	else:
		source_id = tilemap.get_cell_source_id(coords)
		atlas_coords = tilemap.get_cell_atlas_coords(coords)
		alt = tilemap.get_cell_alternative_tile(coords)

	return ResponseFactory.success(
		{
			"x": x, "y": y,
			"source_id": source_id,
			"atlas_x": atlas_coords.x,
			"atlas_y": atlas_coords.y,
			"alternative_tile": alt,
			"is_empty": source_id == -1
		},
		"Cell info loaded."
	)


func tilemap_clear(params: Dictionary) -> Dictionary:
	var tilemap = _get_tilemap(params)
	if tilemap is Dictionary:
		return tilemap

	var layer: int = int(params.get("layer", 0))

	if tilemap.is_class("TileMap"):
		tilemap.clear_layer(layer)
	else:
		tilemap.clear()

	return ResponseFactory.success({"layer": layer}, "TileMap layer cleared.")


func tilemap_get_info(params: Dictionary) -> Dictionary:
	var tilemap = _get_tilemap(params)
	if tilemap is Dictionary:
		return tilemap

	var info: Dictionary = {"type": tilemap.get_class(), "node_path": str(tilemap.get_path())}

	if tilemap.is_class("TileMap"):
		info["layer_count"] = tilemap.get_layers_count()
		var layers_info: Array = []
		for i in tilemap.get_layers_count():
			layers_info.append({
				"index": i,
				"name": tilemap.get_layer_name(i),
				"enabled": tilemap.is_layer_enabled(i),
				"used_rect": _variant_to_json(tilemap.get_used_rect())
			})
		info["layers"] = layers_info
		if tilemap.tile_set != null:
			info["tile_set_sources"] = tilemap.tile_set.get_source_count()
		else:
			info["tile_set_sources"] = 0
	else:
		info["layer_count"] = 1
		info["used_rect"] = _variant_to_json(tilemap.get_used_rect())
		if tilemap.tile_set != null:
			info["tile_set_sources"] = tilemap.tile_set.get_source_count()
		else:
			info["tile_set_sources"] = 0

	return ResponseFactory.success(info, "TileMap info loaded.")


func tilemap_get_used_cells(params: Dictionary) -> Dictionary:
	var tilemap = _get_tilemap(params)
	if tilemap is Dictionary:
		return tilemap

	var layer: int = int(params.get("layer", 0))
	var cells: Array = []

	var used: Array
	if tilemap.is_class("TileMap"):
		used = tilemap.get_used_cells(layer)
	else:
		used = tilemap.get_used_cells()

	for coord in used:
		cells.append({"x": coord.x, "y": coord.y})

	return ResponseFactory.success({"cells": cells, "count": cells.size()}, "Used cells loaded.")


# ── Phase 18: AnimationTree state machine ─────────────────────────────────────

func _get_anim_tree(params: Dictionary):
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, [])

	var node_path: String = str(params.get("node_path", "."))
	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"path": node_path}, [])

	if not node.is_class("AnimationTree"):
		return ResponseFactory.error("INVALID_NODE_TYPE", "Node is not an AnimationTree.", {"type": node.get_class()}, [])

	return node


func get_animation_tree_structure(params: Dictionary) -> Dictionary:
	var tree_node = _get_anim_tree(params)
	if tree_node is Dictionary:
		return tree_node

	var root_node = tree_node.tree_root
	if root_node == null:
		return ResponseFactory.error("NO_TREE_ROOT", "AnimationTree has no tree_root set.", {}, [])

	var result: Dictionary = {
		"root_type": root_node.get_class(),
		"anim_player": str(tree_node.anim_player),
		"active": tree_node.active
	}

	if root_node.is_class("AnimationNodeStateMachine"):
		var states: Array = []
		for state_name in root_node.get_node_list():
			var state_node = root_node.get_node(state_name)
			states.append({"name": state_name, "type": state_node.get_class() if state_node else "unknown"})

		var transitions: Array = []
		for from_state in root_node.get_node_list():
			for to_state in root_node.get_node_list():
				if from_state != to_state and root_node.has_transition(from_state, to_state):
					var t = root_node.get_transition(from_state, to_state)
					transitions.append({
						"from": from_state,
						"to": to_state,
						"switch_mode": t.switch_mode if t else 0,
						"auto_advance": t.advance_mode == 1 if t else false
					})

		result["states"] = states
		result["transitions"] = transitions
		result["state_count"] = states.size()
		result["transition_count"] = transitions.size()

	elif root_node.is_class("AnimationNodeBlendTree"):
		var nodes: Array = []
		for node_name in root_node.get_node_list():
			var bt_node = root_node.get_node(node_name)
			nodes.append({"name": node_name, "type": bt_node.get_class() if bt_node else "unknown"})
		result["blend_nodes"] = nodes

	return ResponseFactory.success(result, "Animation tree structure loaded.")


func add_state_machine_state(params: Dictionary) -> Dictionary:
	var tree_node = _get_anim_tree(params)
	if tree_node is Dictionary:
		return tree_node

	var state_name: String = str(params.get("state_name", ""))
	if state_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "state_name is required.", {}, [])

	var sm = tree_node.tree_root as AnimationNodeStateMachine
	if sm == null:
		return ResponseFactory.error("NO_STATE_MACHINE", "AnimationTree root is not an AnimationNodeStateMachine.", {}, [])

	if sm.has_node(state_name):
		return ResponseFactory.error("ALREADY_EXISTS", "State '%s' already exists." % state_name, {}, [])

	var anim_name: String = str(params.get("animation_name", ""))
	var anim_node: AnimationNode
	if not anim_name.is_empty():
		var an := AnimationNodeAnimation.new()
		an.animation = anim_name
		anim_node = an
	else:
		anim_node = AnimationNodeAnimation.new()

	sm.add_node(state_name, anim_node)

	return ResponseFactory.success({"state_name": state_name}, "State added to AnimationStateMachine.")


func remove_state_machine_state(params: Dictionary) -> Dictionary:
	var tree_node = _get_anim_tree(params)
	if tree_node is Dictionary:
		return tree_node

	var state_name: String = str(params.get("state_name", ""))
	var sm = tree_node.tree_root as AnimationNodeStateMachine
	if sm == null:
		return ResponseFactory.error("NO_STATE_MACHINE", "Root is not AnimationNodeStateMachine.", {}, [])

	if not sm.has_node(state_name):
		return ResponseFactory.error("NOT_FOUND", "State '%s' not found." % state_name, {}, [])

	sm.remove_node(state_name)
	return ResponseFactory.success({"state_name": state_name}, "State removed.")


func add_state_machine_transition(params: Dictionary) -> Dictionary:
	var tree_node = _get_anim_tree(params)
	if tree_node is Dictionary:
		return tree_node

	var from_state: String = str(params.get("from_state", ""))
	var to_state: String = str(params.get("to_state", ""))
	var sm = tree_node.tree_root as AnimationNodeStateMachine
	if sm == null:
		return ResponseFactory.error("NO_STATE_MACHINE", "Root is not AnimationNodeStateMachine.", {}, [])

	var t := AnimationNodeStateMachineTransition.new()

	var switch_mode_str: String = str(params.get("switch_mode", "immediate"))
	match switch_mode_str:
		"sync": t.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_SYNC
		"at_end": t.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_AT_END
		_: t.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_IMMEDIATE

	if bool(params.get("auto_advance", false)):
		t.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO
	else:
		t.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_ENABLED

	sm.add_transition(from_state, to_state, t)
	return ResponseFactory.success({"from": from_state, "to": to_state}, "Transition added.")


func remove_state_machine_transition(params: Dictionary) -> Dictionary:
	var tree_node = _get_anim_tree(params)
	if tree_node is Dictionary:
		return tree_node

	var from_state: String = str(params.get("from_state", ""))
	var to_state: String = str(params.get("to_state", ""))
	var sm = tree_node.tree_root as AnimationNodeStateMachine
	if sm == null:
		return ResponseFactory.error("NO_STATE_MACHINE", "Root is not AnimationNodeStateMachine.", {}, [])

	if not sm.has_transition(from_state, to_state):
		return ResponseFactory.error("NOT_FOUND", "Transition not found.", {"from": from_state, "to": to_state}, [])

	sm.remove_transition(from_state, to_state)
	return ResponseFactory.success({"from": from_state, "to": to_state}, "Transition removed.")


func set_blend_tree_node(params: Dictionary) -> Dictionary:
	var tree_node = _get_anim_tree(params)
	if tree_node is Dictionary:
		return tree_node

	var blend_node_name: String = str(params.get("blend_node_name", ""))
	var blend_node_type: String = str(params.get("blend_node_type", "Animation"))
	if blend_node_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "blend_node_name is required.", {}, [])

	var bt = tree_node.tree_root as AnimationNodeBlendTree
	if bt == null:
		return ResponseFactory.error("NO_BLEND_TREE", "AnimationTree root is not an AnimationNodeBlendTree.", {}, [])

	var new_node: AnimationNode
	match blend_node_type:
		"Add2": new_node = AnimationNodeAdd2.new()
		"Blend2": new_node = AnimationNodeBlend2.new()
		"Blend3": new_node = AnimationNodeBlend3.new()
		"TimeScale": new_node = AnimationNodeTimeScale.new()
		"TimeSeek": new_node = AnimationNodeTimeSeek.new()
		"OneShot": new_node = AnimationNodeOneShot.new()
		_: new_node = AnimationNodeAnimation.new()

	var pos_x: float = float(params.get("position_x", 0.0))
	var pos_y: float = float(params.get("position_y", 0.0))

	bt.add_node(blend_node_name, new_node, Vector2(pos_x, pos_y))
	return ResponseFactory.success({"blend_node_name": blend_node_name, "type": blend_node_type}, "Blend tree node added.")


func set_tree_parameter(params: Dictionary) -> Dictionary:
	var tree_node = _get_anim_tree(params)
	if tree_node is Dictionary:
		return tree_node

	var parameter: String = str(params.get("parameter", ""))
	var value = params.get("value", null)
	if parameter.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "parameter is required.", {}, [])

	tree_node.set(parameter, value)
	return ResponseFactory.success({"parameter": parameter, "value": _variant_to_json(tree_node.get(parameter))}, "Tree parameter set.")


# ── Phase 18: Audio bus ───────────────────────────────────────────────────────

func get_audio_bus_layout(_params: Dictionary) -> Dictionary:
	var buses: Array = []
	for i in AudioServer.bus_count:
		var effects: Array = []
		for j in AudioServer.get_bus_effect_count(i):
			var effect = AudioServer.get_bus_effect(i, j)
			effects.append({"index": j, "type": effect.get_class(), "enabled": AudioServer.is_bus_effect_enabled(i, j)})
		buses.append({
			"index": i,
			"name": AudioServer.get_bus_name(i),
			"volume_db": AudioServer.get_bus_volume_db(i),
			"mute": AudioServer.is_bus_mute(i),
			"solo": AudioServer.is_bus_solo(i),
			"send": AudioServer.get_bus_send(i),
			"effects": effects,
			"effect_count": effects.size()
		})
	return ResponseFactory.success({"buses": buses, "count": buses.size()}, "Audio bus layout loaded.")


func add_audio_bus(params: Dictionary) -> Dictionary:
	var bus_name: String = str(params.get("name", ""))
	if bus_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "name is required.", {}, [])

	var existing_idx := AudioServer.get_bus_index(bus_name)
	if existing_idx != -1:
		return ResponseFactory.error("ALREADY_EXISTS", "Bus '%s' already exists." % bus_name, {}, [])

	var idx: int = AudioServer.bus_count
	AudioServer.add_bus(idx)
	AudioServer.set_bus_name(idx, bus_name)

	var send_to: String = str(params.get("send_to", "Master"))
	if send_to != bus_name:
		AudioServer.set_bus_send(idx, send_to)

	if params.has("volume_db"):
		AudioServer.set_bus_volume_db(idx, float(params.get("volume_db")))

	AudioServer.set_bus_layout(AudioServer.generate_bus_layout())
	return ResponseFactory.success({"name": bus_name, "index": idx, "send_to": send_to}, "Audio bus added.")


func set_audio_bus(params: Dictionary) -> Dictionary:
	var bus_name: String = str(params.get("bus_name", ""))
	var idx := AudioServer.get_bus_index(bus_name)
	if idx == -1:
		return ResponseFactory.error("NOT_FOUND", "Bus '%s' not found." % bus_name, {}, [])

	if params.has("volume_db"):
		AudioServer.set_bus_volume_db(idx, float(params.get("volume_db")))
	if params.has("mute"):
		AudioServer.set_bus_mute(idx, bool(params.get("mute")))
	if params.has("solo"):
		AudioServer.set_bus_solo(idx, bool(params.get("solo")))
	if params.has("send_to"):
		AudioServer.set_bus_send(idx, str(params.get("send_to")))

	AudioServer.set_bus_layout(AudioServer.generate_bus_layout())
	return ResponseFactory.success({"bus_name": bus_name, "index": idx}, "Audio bus updated.")


func add_audio_bus_effect(params: Dictionary) -> Dictionary:
	var bus_name: String = str(params.get("bus_name", ""))
	var effect_type: String = str(params.get("effect_type", "reverb"))
	var idx := AudioServer.get_bus_index(bus_name)
	if idx == -1:
		return ResponseFactory.error("NOT_FOUND", "Bus '%s' not found." % bus_name, {}, [])

	var effect: AudioEffect
	match effect_type:
		"reverb": effect = AudioEffectReverb.new()
		"delay": effect = AudioEffectDelay.new()
		"compressor": effect = AudioEffectCompressor.new()
		"equalizer": effect = AudioEffectEQ10.new()
		"limiter": effect = AudioEffectLimiter.new()
		"chorus": effect = AudioEffectChorus.new()
		"distortion": effect = AudioEffectDistortion.new()
		"phaser": effect = AudioEffectPhaser.new()
		_: return ResponseFactory.error("INVALID_PARAMS", "Unknown effect type '%s'." % effect_type, {}, [])

	var effect_idx: int = AudioServer.get_bus_effect_count(idx)
	AudioServer.add_bus_effect(idx, effect, effect_idx)
	AudioServer.set_bus_layout(AudioServer.generate_bus_layout())
	return ResponseFactory.success({"bus_name": bus_name, "effect_type": effect_type, "effect_index": effect_idx}, "Effect added.")


func get_audio_info(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, [])

	var root_path: String = str(params.get("node_path", "."))
	var scan_root := _resolve_node(scene_root, root_path)
	if scan_root == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Root node not found.", {}, [])

	var audio_nodes: Array = []
	_collect_audio_nodes(scan_root, audio_nodes)

	return ResponseFactory.success({"audio_nodes": audio_nodes, "count": audio_nodes.size()}, "Audio info loaded.")


func _collect_audio_nodes(node: Node, result: Array) -> void:
	if node.is_class("AudioStreamPlayer") or node.is_class("AudioStreamPlayer2D") or node.is_class("AudioStreamPlayer3D"):
		var info: Dictionary = {
			"name": node.name,
			"path": str(node.get_path()),
			"type": node.get_class(),
			"bus": str(node.get("bus") if node.get("bus") else "Master"),
			"autoplay": bool(node.get("autoplay")) if node.has_method("get") else false,
			"volume_db": float(node.get("volume_db")) if node.get("volume_db") != null else 0.0
		}
		result.append(info)
	for child in node.get_children():
		_collect_audio_nodes(child, result)


# ── Phase 18: Theme tools ─────────────────────────────────────────────────────

func create_theme(params: Dictionary) -> Dictionary:
	var path: String = str(params.get("path", "res://theme/default.tres"))
	var overwrite: bool = bool(params.get("overwrite", false))

	if not path.ends_with(".tres"):
		return ResponseFactory.error("INVALID_PARAMS", "path must end in .tres.", {}, [])

	var abs_path := ProjectSettings.globalize_path(path)
	if FileAccess.file_exists(abs_path) and not overwrite:
		return ResponseFactory.error("FILE_ALREADY_EXISTS", "Theme file already exists. Set overwrite=true to replace.", {"path": path}, [])

	var dir := abs_path.get_base_dir()
	DirAccess.make_dir_recursive_absolute(dir)

	var theme := Theme.new()
	var err := ResourceSaver.save(theme, path)
	if err != OK:
		return ResponseFactory.error("SAVE_ERROR", "Failed to save theme (error %d)." % err, {}, [])

	return ResponseFactory.success({"path": path}, "Theme created.")


func set_theme_color(params: Dictionary) -> Dictionary:
	var theme_path: String = str(params.get("theme_path", ""))
	var type: String = str(params.get("type", ""))
	var name: String = str(params.get("name", ""))
	var color_str: String = str(params.get("color", "#ffffff"))

	var theme: Theme = load(theme_path) as Theme
	if theme == null:
		return ResponseFactory.error("NOT_FOUND", "Theme not found at '%s'." % theme_path, {}, [])

	theme.set_color(name, type, _parse_color(color_str))
	ResourceSaver.save(theme, theme_path)
	return ResponseFactory.success({"theme_path": theme_path, "type": type, "name": name, "color": color_str}, "Color set.")


func set_theme_constant(params: Dictionary) -> Dictionary:
	var theme_path: String = str(params.get("theme_path", ""))
	var type: String = str(params.get("type", ""))
	var name: String = str(params.get("name", ""))
	var value: int = int(params.get("value", 0))

	var theme: Theme = load(theme_path) as Theme
	if theme == null:
		return ResponseFactory.error("NOT_FOUND", "Theme not found.", {}, [])

	theme.set_constant(name, type, value)
	ResourceSaver.save(theme, theme_path)
	return ResponseFactory.success({"theme_path": theme_path, "type": type, "name": name, "value": value}, "Constant set.")


func set_theme_font_size(params: Dictionary) -> Dictionary:
	var theme_path: String = str(params.get("theme_path", ""))
	var type: String = str(params.get("type", ""))
	var name: String = str(params.get("name", ""))
	var size: int = int(params.get("size", 16))

	var theme: Theme = load(theme_path) as Theme
	if theme == null:
		return ResponseFactory.error("NOT_FOUND", "Theme not found.", {}, [])

	theme.set_font_size(name, type, size)
	ResourceSaver.save(theme, theme_path)
	return ResponseFactory.success({"theme_path": theme_path, "type": type, "name": name, "size": size}, "Font size set.")


func set_theme_stylebox(params: Dictionary) -> Dictionary:
	var theme_path: String = str(params.get("theme_path", ""))
	var type: String = str(params.get("type", ""))
	var name: String = str(params.get("name", "normal"))

	var theme: Theme = load(theme_path) as Theme
	if theme == null:
		return ResponseFactory.error("NOT_FOUND", "Theme not found.", {}, [])

	var sb := StyleBoxFlat.new()
	if params.has("bg_color"):
		sb.bg_color = _parse_color(str(params.get("bg_color")))
	if params.has("border_color"):
		sb.border_color = _parse_color(str(params.get("border_color")))
	if params.has("border_width"):
		var bw: int = int(params.get("border_width"))
		sb.set_border_width_all(bw)
	if params.has("corner_radius"):
		var cr: int = int(params.get("corner_radius"))
		sb.set_corner_radius_all(cr)

	theme.set_stylebox(name, type, sb)
	ResourceSaver.save(theme, theme_path)
	return ResponseFactory.success({"theme_path": theme_path, "type": type, "name": name}, "StyleBox set.")


func get_theme_info(params: Dictionary) -> Dictionary:
	var theme_path: String = str(params.get("theme_path", ""))
	var theme: Theme = load(theme_path) as Theme
	if theme == null:
		return ResponseFactory.error("NOT_FOUND", "Theme not found.", {}, [])

	var types: Array = []
	for t in theme.get_type_list():
		var entry: Dictionary = {"type": t, "colors": [], "constants": [], "font_sizes": [], "styleboxes": []}
		for c in theme.get_color_list(t):
			entry["colors"].append({"name": c, "value": _variant_to_json(theme.get_color(c, t))})
		for c in theme.get_constant_list(t):
			entry["constants"].append({"name": c, "value": theme.get_constant(c, t)})
		for c in theme.get_font_size_list(t):
			entry["font_sizes"].append({"name": c, "value": theme.get_font_size(c, t)})
		for c in theme.get_stylebox_list(t):
			entry["styleboxes"].append({"name": c, "type": theme.get_stylebox(c, t).get_class()})
		types.append(entry)

	return ResponseFactory.success({"theme_path": theme_path, "types": types, "type_count": types.size()}, "Theme info loaded.")


# ── Phase 18: Shader params ───────────────────────────────────────────────────

func _get_shader_material(scene_root: Node, node_path: String):
	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return null

	var mat = null
	if "material" in node:
		mat = node.material
	elif "material_override" in node:
		mat = node.material_override
	elif "surface_material_override/0" in node:
		mat = node.get("surface_material_override/0")

	if mat is ShaderMaterial:
		return mat
	return null


func set_shader_param(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, [])

	var node_path: String = str(params.get("node_path", "."))
	var param: String = str(params.get("param", ""))
	var value = params.get("value", null)

	if param.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "param is required.", {}, [])

	var mat = _get_shader_material(scene_root, node_path)
	if mat == null:
		return ResponseFactory.error("NO_SHADER_MATERIAL", "Node has no ShaderMaterial on 'material' or 'material_override'.", {"node_path": node_path}, [])

	var coerced_value = value
	if typeof(value) == TYPE_DICTIONARY and value.has("r"):
		coerced_value = Color(float(value.get("r", 1.0)), float(value.get("g", 1.0)), float(value.get("b", 1.0)), float(value.get("a", 1.0)))

	mat.set_shader_parameter(param, coerced_value)
	return ResponseFactory.success({"node_path": node_path, "param": param, "value": _variant_to_json(coerced_value)}, "Shader parameter set.")


func get_shader_params(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, [])

	var node_path: String = str(params.get("node_path", "."))
	var mat = _get_shader_material(scene_root, node_path)
	if mat == null:
		return ResponseFactory.error("NO_SHADER_MATERIAL", "Node has no ShaderMaterial.", {"node_path": node_path}, [])

	var shader_params: Array = []
	if mat.shader != null:
		for prop in mat.shader.get_shader_uniform_list():
			var pname: String = str(prop.get("name", ""))
			shader_params.append({"name": pname, "value": _variant_to_json(mat.get_shader_parameter(pname))})

	return ResponseFactory.success({"node_path": node_path, "params": shader_params, "count": shader_params.size()}, "Shader params loaded.")


# ── Phase 19: Export tools ────────────────────────────────────────────────────

func list_export_presets(_params: Dictionary) -> Dictionary:
	var cfg := ConfigFile.new()
	var cfg_path := ProjectSettings.globalize_path("res://export_presets.cfg")
	var err := cfg.load(cfg_path)
	if err != OK:
		return ResponseFactory.success({"presets": [], "count": 0}, "No export_presets.cfg found.")

	var presets: Array = []
	for section in cfg.get_sections():
		if section.begins_with("preset.") and not section.contains(".options"):
			presets.append({
				"index": int(section.replace("preset.", "")),
				"name": str(cfg.get_value(section, "name", "")),
				"platform": str(cfg.get_value(section, "platform", "")),
				"export_path": str(cfg.get_value(section, "export_path", "")),
				"export_filter": str(cfg.get_value(section, "export_filter", "all_resources"))
			})

	return ResponseFactory.success({"presets": presets, "count": presets.size()}, "Export presets loaded.")


func export_project(params: Dictionary) -> Dictionary:
	var preset_name: String = str(params.get("preset_name", ""))
	var export_path: String = str(params.get("export_path", ""))
	var debug: bool = bool(params.get("debug", false))

	if preset_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "preset_name is required.", {}, [])

	var flag: String = "--export-debug" if debug else "--export-release"
	var godot_bin: String = OS.get_executable_path()
	var project_dir: String = ProjectSettings.globalize_path("res://")
	var cmd: String = '"%s" %s "%s" "%s"' % [godot_bin, flag, preset_name, export_path]

	return ResponseFactory.success({
		"command": cmd,
		"preset_name": preset_name,
		"export_path": export_path if not export_path.is_empty() else "(preset default)",
		"debug": debug,
		"note": "Run this command in your terminal to export. Godot cannot export while the editor is running another export."
	}, "Export command generated.")


func get_export_info(params: Dictionary) -> Dictionary:
	var preset_name: String = str(params.get("preset_name", ""))
	var cfg := ConfigFile.new()
	var err := cfg.load(ProjectSettings.globalize_path("res://export_presets.cfg"))
	if err != OK:
		return ResponseFactory.error("NOT_FOUND", "No export_presets.cfg found.", {}, [])

	for section in cfg.get_sections():
		if section.begins_with("preset.") and not section.contains(".options"):
			if str(cfg.get_value(section, "name", "")) == preset_name:
				var options_section := section + ".options"
				var options: Dictionary = {}
				if cfg.has_section(options_section):
					for key in cfg.get_section_keys(options_section):
						options[key] = cfg.get_value(options_section, key, null)
				return ResponseFactory.success({
					"name": preset_name,
					"platform": str(cfg.get_value(section, "platform", "")),
					"export_path": str(cfg.get_value(section, "export_path", "")),
					"include_filter": str(cfg.get_value(section, "include_filter", "")),
					"exclude_filter": str(cfg.get_value(section, "exclude_filter", "")),
					"options": options
				}, "Export info loaded.")

	return ResponseFactory.error("NOT_FOUND", "Preset '%s' not found." % preset_name, {}, [])


# ── Phase 19: Resource tools ──────────────────────────────────────────────────

func read_resource(params: Dictionary) -> Dictionary:
	var path: String = str(params.get("path", ""))
	if path.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "path is required.", {}, [])

	var resource = load(path)
	if resource == null:
		return ResponseFactory.error("NOT_FOUND", "Resource not found at '%s'." % path, {}, [])

	var properties: Array = []
	for prop in resource.get_property_list():
		var usage: int = int(prop.get("usage", 0))
		if usage & PROPERTY_USAGE_STORAGE == 0:
			continue
		var pname: String = str(prop.get("name", ""))
		if pname.begins_with("_") or pname.is_empty():
			continue
		properties.append({
			"name": pname,
			"type": int(prop.get("type", 0)),
			"value": _variant_to_json(resource.get(pname))
		})

	return ResponseFactory.success({
		"path": path,
		"type": resource.get_class(),
		"property_count": properties.size(),
		"properties": properties
	}, "Resource loaded.")


func edit_resource(params: Dictionary) -> Dictionary:
	var path: String = str(params.get("path", ""))
	var property: String = str(params.get("property", ""))
	var value = params.get("value", null)

	if path.is_empty() or property.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "path and property are required.", {}, [])

	var resource = load(path)
	if resource == null:
		return ResponseFactory.error("NOT_FOUND", "Resource not found.", {"path": path}, [])

	var old_value = resource.get(property)
	resource.set(property, value)
	var err := ResourceSaver.save(resource, path)
	if err != OK:
		return ResponseFactory.error("SAVE_ERROR", "Failed to save resource (error %d)." % err, {}, [])

	return ResponseFactory.success({
		"path": path,
		"property": property,
		"old_value": _variant_to_json(old_value),
		"new_value": _variant_to_json(resource.get(property))
	}, "Resource updated.")


func create_resource(params: Dictionary) -> Dictionary:
	var path: String = str(params.get("path", ""))
	var resource_type: String = str(params.get("resource_type", "Resource"))
	var overwrite: bool = bool(params.get("overwrite", false))
	var properties: Dictionary = params.get("properties", {})

	if path.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "path is required.", {}, [])

	if not path.ends_with(".tres"):
		return ResponseFactory.error("INVALID_PARAMS", "path must end in .tres.", {}, [])

	var abs_path := ProjectSettings.globalize_path(path)
	if FileAccess.file_exists(abs_path) and not overwrite:
		return ResponseFactory.error("FILE_ALREADY_EXISTS", "Resource already exists. Set overwrite=true.", {"path": path}, [])

	if not ClassDB.can_instantiate(resource_type):
		return ResponseFactory.error("INVALID_TYPE", "Cannot instantiate type '%s'." % resource_type, {}, [])

	DirAccess.make_dir_recursive_absolute(abs_path.get_base_dir())

	var resource = ClassDB.instantiate(resource_type)
	for pname in properties.keys():
		resource.set(str(pname), properties[pname])

	var err := ResourceSaver.save(resource, path)
	if err != OK:
		return ResponseFactory.error("SAVE_ERROR", "Failed to save resource (error %d)." % err, {}, [])

	return ResponseFactory.success({"path": path, "type": resource_type}, "Resource created.")


# ── Phase 19: Batch tools ─────────────────────────────────────────────────────

func find_nodes_by_type(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, [])

	var class_name_str: String = str(params.get("class_name", ""))
	if class_name_str.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "class_name is required.", {}, [])

	var exact: bool = bool(params.get("exact_match", false))
	var matches: Array = []
	_find_by_type(scene_root, class_name_str, exact, matches)

	return ResponseFactory.success({"class_name": class_name_str, "nodes": matches, "count": matches.size()}, "Nodes found.")


func _find_by_type(node: Node, class_name_str: String, exact: bool, results: Array) -> void:
	var match_found: bool = (exact and node.get_class() == class_name_str) or (not exact and node.is_class(class_name_str))
	if match_found:
		results.append({"name": node.name, "type": node.get_class(), "path": str(node.get_path())})
	for child in node.get_children():
		_find_by_type(child, class_name_str, exact, results)


func batch_set_property(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, [])

	var undo_check := _require_undo_redo("godot_batch_set_property")
	if not undo_check.is_empty():
		return undo_check

	var node_paths: Array = params.get("node_paths", [])
	var property: String = str(params.get("property", ""))
	var value = params.get("value", null)

	if node_paths.is_empty() or property.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "node_paths and property are required.", {}, [])

	_undo_service.create_action("Batch set %s" % property)
	var results: Array = []

	for raw_path in node_paths:
		var np: String = str(raw_path)
		var node := _resolve_node(scene_root, np)
		if node == null:
			results.append({"path": np, "ok": false, "error": "node not found"})
			continue
		if not property in node:
			results.append({"path": np, "ok": false, "error": "property not found"})
			continue
		var old_val = node.get(property)
		_undo_service.add_do_property(node, property, value)
		_undo_service.add_undo_property(node, property, old_val)
		results.append({"path": np, "ok": true})

	_undo_service.commit_action()
	var updated: int = results.filter(func(r): return r.ok).size()
	return ResponseFactory.success({"results": results, "updated": updated, "total": results.size()}, "Batch complete.")


func cross_scene_set_property(params: Dictionary) -> Dictionary:
	var class_name_str: String = str(params.get("class_name", ""))
	var property: String = str(params.get("property", ""))
	var value = params.get("value", null)

	if class_name_str.is_empty() or property.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "class_name and property are required.", {}, [])

	var project_root := ProjectSettings.globalize_path("res://")
	var scene_files: Array = []
	_collect_files(project_root, ".tscn", scene_files)

	var results: Array = []
	for scene_file in scene_files:
		var packed: PackedScene = load(scene_file) as PackedScene
		if packed == null:
			continue
		var scene_instance: Node = packed.instantiate()
		var matches: Array = []
		_find_by_type(scene_instance, class_name_str, false, matches)
		if matches.is_empty():
			scene_instance.queue_free()
			continue
		for match_info in matches:
			var node := scene_instance.get_node_or_null(match_info.path.replace(str(scene_instance.get_path()) + "/", ""))
			if node == null:
				continue
			if property in node:
				node.set(property, value)
		var pscn := PackedScene.new()
		pscn.pack(scene_instance)
		ResourceSaver.save(pscn, scene_file)
		scene_instance.queue_free()
		results.append({"scene": scene_file.replace(project_root, "res://"), "nodes_updated": matches.size()})

	return ResponseFactory.success({"results": results, "scenes_modified": results.size()}, "Cross-scene property set complete.")


func find_unused_resources(params: Dictionary) -> Dictionary:
	var extensions: Array = params.get("extensions", [".tres", ".res", ".png", ".jpg", ".wav", ".ogg", ".mp3"])
	var project_root := ProjectSettings.globalize_path("res://")

	var all_resources: Array = []
	for ext in extensions:
		_collect_files(project_root, str(ext), all_resources)

	var all_text_files: Array = []
	for ext in [".tscn", ".gd", ".tres", ".res"]:
		_collect_files(project_root, ext, all_text_files)

	var referenced: Dictionary = {}
	for text_file in all_text_files:
		var content := FileAccess.get_file_as_string(text_file)
		for res_file in all_resources:
			var res_rel: String = res_file.replace(project_root, "")
			if res_rel in content or res_file in content:
				referenced[res_file] = true

	var unused: Array = []
	for res_file in all_resources:
		if not referenced.has(res_file):
			var size: int = 0
			var fa := FileAccess.open(res_file, FileAccess.READ)
			if fa:
				size = fa.get_length()
				fa.close()
			unused.append({
				"path": "res://" + res_file.replace(project_root, ""),
				"size_bytes": size
			})

	return ResponseFactory.success({"unused": unused, "count": unused.size()}, "Unused resources scan complete.")


func detect_circular_dependencies(_params: Dictionary) -> Dictionary:
	var project_root := ProjectSettings.globalize_path("res://")
	var gd_files: Array = []
	_collect_files(project_root, ".gd", gd_files)

	var dep_map: Dictionary = {}
	for gd_file in gd_files:
		var content := FileAccess.get_file_as_string(gd_file)
		var deps: Array = []
		for line in content.split("\n"):
			var stripped := line.strip_edges()
			if stripped.begins_with("extends ") and stripped.contains(".gd"):
				var parts := stripped.split(" ")
				if parts.size() > 1:
					deps.append(parts[1].strip_edges().trim_prefix("\"").trim_suffix("\""))
		dep_map[gd_file.replace(project_root, "res://")] = deps

	var cycles: Array = []
	for start_file in dep_map.keys():
		var visited: Array = [start_file]
		_detect_cycle(start_file, dep_map, visited, cycles)

	return ResponseFactory.success({"cycles": cycles, "cycle_count": cycles.size()}, "Circular dependency scan complete.")


func _detect_cycle(current: String, dep_map: Dictionary, visited: Array, cycles: Array) -> void:
	var deps: Array = dep_map.get(current, [])
	for dep in deps:
		if dep in visited:
			cycles.append({"cycle": visited.duplicate() + [dep]})
			return
		if dep_map.has(dep):
			var new_visited := visited.duplicate()
			new_visited.append(dep)
			_detect_cycle(dep, dep_map, new_visited, cycles)


func _collect_files(dir_path: String, extension: String, result: Array) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var fname := dir.get_next()
	while fname != "":
		if fname == "." or fname == ".." or fname.begins_with("."):
			fname = dir.get_next()
			continue
		var full_path := dir_path.path_join(fname)
		if dir.current_is_dir():
			_collect_files(full_path, extension, result)
		elif fname.ends_with(extension):
			result.append(full_path)
		fname = dir.get_next()
	dir.list_dir_end()


# ── Phase 19: UID tools ───────────────────────────────────────────────────────

func uid_to_project_path(params: Dictionary) -> Dictionary:
	var uid_str: String = str(params.get("uid", ""))
	if uid_str.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "uid is required.", {}, [])

	var uid_int: int = ResourceUID.text_to_id(uid_str)
	if uid_int == ResourceUID.INVALID_ID:
		return ResponseFactory.error("INVALID_UID", "Invalid UID format.", {"uid": uid_str}, [])

	if not ResourceUID.has_id(uid_int):
		return ResponseFactory.error("NOT_FOUND", "UID not found in project.", {"uid": uid_str}, [])

	var path: String = ResourceUID.get_id_path(uid_int)
	return ResponseFactory.success({"uid": uid_str, "path": path}, "UID resolved.")


func project_path_to_uid(params: Dictionary) -> Dictionary:
	var path: String = str(params.get("path", ""))
	if path.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "path is required.", {}, [])

	var uid_int: int = ResourceLoader.get_resource_uid(path)
	if uid_int == ResourceUID.INVALID_ID:
		return ResponseFactory.error("NOT_FOUND", "Resource not found or has no UID.", {"path": path}, [])

	var uid_str: String = ResourceUID.id_to_text(uid_int)
	return ResponseFactory.success({"path": path, "uid": uid_str}, "Path resolved to UID.")


# ── Phase 19: test.create_scenario alias ─────────────────────────────────────
# (Used by Phase 20 generate_test_from_behavior TypeScript orchestration)

func create_scenario_rpc(params: Dictionary) -> Dictionary:
	var name_str: String = str(params.get("name", ""))
	var description: String = str(params.get("description", ""))
	var steps: Array = params.get("steps", [])
	var overwrite: bool = bool(params.get("overwrite", false))

	if name_str.is_empty() or steps.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "name and steps are required.", {}, [])

	var dir_path := ProjectSettings.globalize_path("res://.godot_mcp/tests")
	DirAccess.make_dir_recursive_absolute(dir_path)
	var file_path := dir_path.path_join(name_str + ".json")

	if FileAccess.file_exists(file_path) and not overwrite:
		return ResponseFactory.error("FILE_ALREADY_EXISTS", "Scenario already exists. Set overwrite=true.", {"path": file_path}, [])

	var scenario: Dictionary = {
		"name": name_str,
		"description": description,
		"created_at": Time.get_datetime_string_from_system(true, true),
		"steps": steps
	}

	var file := FileAccess.open(file_path, FileAccess.WRITE)
	if file == null:
		return ResponseFactory.error("WRITE_ERROR", "Cannot write scenario file.", {}, [])
	file.store_string(JSON.stringify(scenario, "\t"))
	file.close()

	return ResponseFactory.success(
		{"scenario": name_str, "path": "res://.godot_mcp/tests/" + name_str + ".json", "step_count": steps.size()},
		"Test scenario persisted."
	)


# ── Infer: bind_key / bind_joypad ─────────────────────────────────────────────

func bind_key(params: Dictionary) -> Dictionary:
	var action_name: String = str(params.get("action", ""))
	var key_str: String = str(params.get("key", ""))
	var modifiers: Dictionary = params.get("modifiers", {})

	if action_name.is_empty() or key_str.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "action and key are required.", {}, [])

	var keycode: Key = OS.find_keycode_from_string(key_str)
	if keycode == KEY_NONE:
		return ResponseFactory.error("INVALID_KEY", "Unknown key '%s'." % key_str, {}, ["Use key name like 'Space', 'A', 'F1'"])

	if not InputMap.has_action(action_name):
		InputMap.add_action(action_name)

	var ev := InputEventKey.new()
	ev.keycode = keycode
	ev.shift_pressed = bool(modifiers.get("shift", false))
	ev.ctrl_pressed = bool(modifiers.get("ctrl", false))
	ev.alt_pressed = bool(modifiers.get("alt", false))
	InputMap.action_add_event(action_name, ev)

	return ResponseFactory.success(
		{"action": action_name, "key": key_str, "keycode": keycode},
		"Key bound to action."
	)


func bind_joypad(params: Dictionary) -> Dictionary:
	var action_name: String = str(params.get("action", ""))
	var button_index: int = int(params.get("button_index", -1))
	var device: int = int(params.get("device", -1))

	if action_name.is_empty() or button_index < 0:
		return ResponseFactory.error("INVALID_PARAMS", "action and button_index are required.", {}, [])

	if not InputMap.has_action(action_name):
		InputMap.add_action(action_name)

	var ev := InputEventJoypadButton.new()
	ev.button_index = button_index
	ev.device = device
	InputMap.action_add_event(action_name, ev)

	return ResponseFactory.success(
		{"action": action_name, "button_index": button_index, "device": device},
		"Joypad button bound to action."
	)
