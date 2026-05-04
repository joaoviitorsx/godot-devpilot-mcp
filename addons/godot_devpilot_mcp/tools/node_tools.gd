@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")

var _editor_interface
var _undo_service


func setup(p_editor_interface, p_undo_service) -> void:
	_editor_interface = p_editor_interface
	_undo_service = p_undo_service


func _require_editor() -> Dictionary:
	if _editor_interface == null:
		return ResponseFactory.error(
			"EDITOR_NOT_AVAILABLE",
			"Editor interface is not available.",
			{},
			["Ensure the plugin is loaded in the Godot editor (not headless)."]
		)
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
		return ResponseFactory.error(
			"UNDO_FAILED",
			"Could not register the action in UndoRedo. Mutation was cancelled.",
			{"tool": tool_name},
			["Run this operation inside the Godot editor with UndoRedo available."]
		)
	return {}


# ── Node mutations ────────────────────────────────────────────────────────────

func add_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_add_node")
	if not undo_check.is_empty():
		return undo_check

	var node_type: String = str(params.get("node_type", "Node"))
	var node_name: String = str(params.get("node_name", node_type))
	var parent_path: String = str(params.get("parent_path", "."))
	var properties: Dictionary = params.get("properties", {})

	if not ClassDB.can_instantiate(node_type):
		return ResponseFactory.error(
			"INVALID_NODE_TYPE",
			"Node type '%s' cannot be instantiated." % node_type,
			{"node_type": node_type},
			["Check ClassDB for valid instantiable node types."]
		)

	var parent := _resolve_node(scene_root, parent_path)
	if parent == null:
		return ResponseFactory.error(
			"NODE_NOT_FOUND",
			"Parent node not found.",
			{"parent_path": parent_path},
			["Use godot_get_scene_tree to check available node paths."]
		)

	var new_node: Node = ClassDB.instantiate(node_type)
	new_node.name = node_name

	for prop_name in properties.keys():
		var prop := str(prop_name)
		var old_value = new_node.get(prop)
		if old_value == null and not prop in new_node:
			new_node.free()
			return ResponseFactory.error(
				"INVALID_PROPERTY",
				"Property not found on node.",
				{"property": prop, "node_type": node_type},
				["Use godot_get_node_properties to list available properties."]
			)
		var coerced := _coerce_property_value(old_value, properties[prop_name])
		if not coerced.get("ok", false):
			new_node.free()
			return ResponseFactory.error(
				"INVALID_PROPERTY_VALUE",
				"Property value could not be converted safely.",
				{"property": prop, "node_type": node_type, "value": _variant_to_json(properties[prop_name])},
				["Use a JSON value compatible with the current Godot property type."]
			)
		new_node.set(prop, coerced["value"])

	_undo_service.create_action("Add node %s" % node_name)
	_undo_service.add_do_method(self, "_add_child_owned", [parent, new_node, scene_root])
	_undo_service.add_undo_method(self, "_remove_child_if_parent", [parent, new_node])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{
			"node_name": str(new_node.name),
			"node_type": node_type,
			"parent_path": parent_path,
			"path": str(scene_root.get_path_to(new_node))
		},
		"Node added."
	)


func remove_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_remove_node")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	if node_path.is_empty() or node_path == ".":
		return ResponseFactory.error(
			"CANNOT_REMOVE_ROOT",
			"Cannot remove the scene root node.",
			{},
			["Use godot_delete_scene to remove the entire scene."]
		)

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error(
			"NODE_NOT_FOUND",
			"Node not found.",
			{"node_path": node_path},
			["Use godot_get_scene_tree to check available node paths."]
		)

	var parent := node.get_parent()
	var node_index := node.get_index()

	_undo_service.create_action("Remove node %s" % node.name)
	_undo_service.add_do_method(self, "_remove_child_if_parent", [parent, node])
	_undo_service.add_undo_method(self, "_add_child_owned_at", [parent, node, scene_root, node_index])
	_undo_service.commit_action()

	return ResponseFactory.success({"node_path": node_path}, "Node removed.")


func rename_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_rename_node")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var new_name: String = str(params.get("new_name", ""))

	if new_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "new_name is required.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error(
			"NODE_NOT_FOUND", "Node not found.", {"node_path": node_path},
			["Use godot_get_scene_tree to check available node paths."]
		)

	var old_name := str(node.name)

	_undo_service.create_action("Rename node %s → %s" % [old_name, new_name])
	_undo_service.add_do_property(node, "name", new_name)
	_undo_service.add_undo_property(node, "name", old_name)
	_undo_service.commit_action()

	return ResponseFactory.success(
		{"old_name": old_name, "new_name": str(node.name), "node_path": node_path},
		"Node renamed."
	)


func duplicate_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_duplicate_node")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	if node_path.is_empty() or node_path == ".":
		return ResponseFactory.error("INVALID_PARAMS", "Cannot duplicate root node.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error(
			"NODE_NOT_FOUND", "Node not found.", {"node_path": node_path},
			["Use godot_get_scene_tree to check available node paths."]
		)

	var dup: Node = node.duplicate()
	var parent := node.get_parent()

	_undo_service.create_action("Duplicate node %s" % node.name)
	_undo_service.add_do_method(self, "_add_child_owned", [parent, dup, scene_root])
	_undo_service.add_undo_method(self, "_remove_child_if_parent", [parent, dup])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{
			"original_path": node_path,
			"duplicate_name": str(dup.name),
			"duplicate_path": str(scene_root.get_path_to(dup))
		},
		"Node duplicated."
	)


func reparent_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_reparent_node")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var new_parent_path: String = str(params.get("new_parent_path", ""))

	if node_path.is_empty() or node_path == ".":
		return ResponseFactory.error("INVALID_PARAMS", "Cannot reparent root node.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var new_parent := _resolve_node(scene_root, new_parent_path)
	if new_parent == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "New parent not found.", {"node_path": new_parent_path}, [])

	var old_parent := node.get_parent()
	var old_index := node.get_index()

	_undo_service.create_action("Reparent node %s" % node.name)
	_undo_service.add_do_method(self, "_reparent_node_at", [node, new_parent, -1])
	_undo_service.add_undo_method(self, "_reparent_node_at", [node, old_parent, old_index])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{
			"node_path": node_path,
			"new_parent_path": new_parent_path,
			"new_path": str(scene_root.get_path_to(node))
		},
		"Node reparented."
	)


# ── Node properties ───────────────────────────────────────────────────────────

func get_node_properties(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_set_node_property")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var properties: Array[Dictionary] = []
	for prop in node.get_property_list():
		var usage: int = int(prop.get("usage", 0))
		if usage & PROPERTY_USAGE_EDITOR == 0:
			continue
		var prop_name := str(prop.get("name", ""))
		var value = node.get(prop_name)
		properties.append({
			"name": prop_name,
			"type": int(prop.get("type", 0)),
			"value": _variant_to_json(value)
		})

	return ResponseFactory.success(
		{"node_path": node_path, "node_type": node.get_class(), "properties": properties},
		"Node properties loaded."
	)


func set_node_property(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var node_path: String = str(params.get("node_path", ""))
	var property: String = str(params.get("property", ""))
	var value = params.get("value", null)

	if property.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "property is required.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var old_value = node.get(property)
	if old_value == null and not property in node:
		return ResponseFactory.error(
			"PROPERTY_NOT_FOUND",
			"Property not found on node.",
			{"property": property, "node_type": node.get_class()},
			["Use godot_get_node_properties to list available properties."]
		)

	var coerced := _coerce_property_value(old_value, value)
	if not coerced.get("ok", false):
		return ResponseFactory.error(
			"INVALID_PROPERTY_VALUE",
			"Property value could not be converted safely.",
			{"property": property, "node_type": node.get_class(), "value": _variant_to_json(value)},
			["Use a JSON value compatible with the current Godot property type."]
		)

	_undo_service.create_action("Set %s.%s" % [node.name, property])
	_undo_service.add_do_property(node, property, coerced["value"])
	_undo_service.add_undo_property(node, property, old_value)
	_undo_service.commit_action()

	return ResponseFactory.success(
		{"node_path": node_path, "property": property, "old_value": _variant_to_json(old_value), "new_value": _variant_to_json(coerced["value"])},
		"Property set."
	)


# ── Node groups ───────────────────────────────────────────────────────────────

func get_node_groups(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_add_node_to_group")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var groups: Array[String] = []
	for g in node.get_groups():
		groups.append(str(g))

	return ResponseFactory.success(
		{"node_path": node_path, "groups": groups, "count": groups.size()},
		"Node groups loaded."
	)


func add_node_to_group(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var node_path: String = str(params.get("node_path", ""))
	var group: String = str(params.get("group", ""))

	if group.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "group is required.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	if node.is_in_group(group):
		return ResponseFactory.error(
			"ALREADY_IN_GROUP",
			"Node is already in group.",
			{"node_path": node_path, "group": group},
			["Use godot_get_node_groups to check current groups."]
		)

	_undo_service.create_action("Add %s to group %s" % [node.name, group])
	_undo_service.add_do_method(node, "add_to_group", [group, true])
	_undo_service.add_undo_method(node, "remove_from_group", [group])
	_undo_service.commit_action()

	return ResponseFactory.success({"node_path": node_path, "group": group}, "Node added to group.")


func remove_node_from_group(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_remove_node_from_group")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var group: String = str(params.get("group", ""))

	if group.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "group is required.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	if not node.is_in_group(group):
		return ResponseFactory.error(
			"NOT_IN_GROUP",
			"Node is not in group.",
			{"node_path": node_path, "group": group},
			["Use godot_get_node_groups to check current groups."]
		)

	_undo_service.create_action("Remove %s from group %s" % [node.name, group])
	_undo_service.add_do_method(node, "remove_from_group", [group])
	_undo_service.add_undo_method(node, "add_to_group", [group, true])
	_undo_service.commit_action()

	return ResponseFactory.success({"node_path": node_path, "group": group}, "Node removed from group.")


# ── Helpers ───────────────────────────────────────────────────────────────────

func _variant_to_json(value) -> Variant:
	match typeof(value):
		TYPE_NIL:
			return null
		TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_VECTOR2:
			return {"x": value.x, "y": value.y}
		TYPE_VECTOR3:
			return {"x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR:
			return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_RECT2:
			return {"x": value.position.x, "y": value.position.y, "w": value.size.x, "h": value.size.y}
		TYPE_NODE_PATH:
			return str(value)
		TYPE_STRING_NAME:
			return str(value)
		_:
			return str(value)


func _coerce_property_value(old_value, new_value) -> Dictionary:
	match typeof(old_value):
		TYPE_BOOL:
			return {"ok": true, "value": bool(new_value)}
		TYPE_INT:
			return {"ok": true, "value": int(new_value)}
		TYPE_FLOAT:
			return {"ok": true, "value": float(new_value)}
		TYPE_STRING:
			return {"ok": true, "value": str(new_value)}
		TYPE_VECTOR2:
			if typeof(new_value) == TYPE_DICTIONARY:
				return {"ok": true, "value": Vector2(float(new_value.get("x", 0.0)), float(new_value.get("y", 0.0)))}
			return {"ok": false}
		TYPE_VECTOR3:
			if typeof(new_value) == TYPE_DICTIONARY:
				return {"ok": true, "value": Vector3(float(new_value.get("x", 0.0)), float(new_value.get("y", 0.0)), float(new_value.get("z", 0.0)))}
			return {"ok": false}
		TYPE_COLOR:
			if typeof(new_value) == TYPE_DICTIONARY:
				return {"ok": true, "value": Color(float(new_value.get("r", 1.0)), float(new_value.get("g", 1.0)), float(new_value.get("b", 1.0)), float(new_value.get("a", 1.0)))}
			return {"ok": false}
		TYPE_NODE_PATH:
			return {"ok": true, "value": NodePath(str(new_value))}
		TYPE_STRING_NAME:
			return {"ok": true, "value": StringName(str(new_value))}
	return {"ok": true, "value": new_value}


func _add_child_owned(parent: Node, child: Node, owner: Node) -> void:
	if child.get_parent() != null:
		child.get_parent().remove_child(child)
	parent.add_child(child, true)
	child.owner = owner


func _add_child_owned_at(parent: Node, child: Node, owner: Node, index: int) -> void:
	_add_child_owned(parent, child, owner)
	if index >= 0 and index < parent.get_child_count():
		parent.move_child(child, index)


func _remove_child_if_parent(parent: Node, child: Node) -> void:
	if child.get_parent() == parent:
		parent.remove_child(child)


func _reparent_node_at(node: Node, new_parent: Node, index: int) -> void:
	if node.get_parent() != null:
		node.reparent(new_parent, true)
	else:
		new_parent.add_child(node, true)
	if index >= 0 and index < new_parent.get_child_count():
		new_parent.move_child(node, index)
