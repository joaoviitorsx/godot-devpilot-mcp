@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")
const Permissions = preload("res://addons/godot_devpilot_mcp/core/permissions.gd")

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


func _require_undo_redo(tool_name: String) -> Dictionary:
	if _undo_service == null or not _undo_service.has_undo_redo():
		return ResponseFactory.error(
			"UNDO_FAILED",
			"Could not register the action in UndoRedo. Mutation was cancelled.",
			{"tool": tool_name},
			["Run this operation inside the Godot editor with UndoRedo available."]
		)
	return {}


func _require_scene_root():
	if _editor_interface == null:
		return null
	return _editor_interface.get_edited_scene_root()


func _validate_script_path(path: String) -> Dictionary:
	if not Permissions.is_res_path_allowed(path):
		return ResponseFactory.error(
			"PATH_OUTSIDE_PROJECT",
			"Script path is outside the Godot project sandbox.",
			{"path": path},
			["Use a res:// path that stays inside the active Godot project."]
		)

	if not path.ends_with(".gd"):
		return ResponseFactory.error(
			"SENSITIVE_FILE_BLOCKED",
			"Only .gd script files are allowed.",
			{"path": path},
			["Use a res:// path ending in .gd."]
		)

	return {}


func attach_script(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var undo_check := _require_undo_redo("godot_attach_script")
	if not undo_check.is_empty():
		return undo_check

	var node_path := str(params.get("node_path", ""))
	var script_path := str(params.get("script_path", ""))
	var path_check := _validate_script_path(script_path)
	if not path_check.is_empty():
		return path_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var node: Node = scene_root if node_path == "." or node_path.is_empty() else scene_root.get_node_or_null(node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, ["Use godot_get_scene_tree to check node paths."])

	if not ResourceLoader.exists(script_path):
		return ResponseFactory.error("SCRIPT_NOT_FOUND", "Script file not found.", {"script_path": script_path}, ["Create the script first."])

	var script = ResourceLoader.load(script_path)
	if script == null:
		return ResponseFactory.error("SCRIPT_LOAD_FAILED", "Could not load script.", {"script_path": script_path}, [])

	var old_script = node.get_script()
	_undo_service.create_action("Attach script %s" % script_path)
	_undo_service.add_do_property(node, "script", script)
	_undo_service.add_undo_property(node, "script", old_script)
	_undo_service.commit_action()

	return ResponseFactory.success({"node_path": node_path, "script_path": script_path}, "Script attached.")


func validate_script(params: Dictionary) -> Dictionary:
	var script_path := str(params.get("path", params.get("script_path", "")))
	var target := str(params.get("godot_version_target", "4.x"))
	var path_check := _validate_script_path(script_path)
	if not path_check.is_empty():
		return path_check

	if not FileAccess.file_exists(script_path):
		return ResponseFactory.error("SCRIPT_NOT_FOUND", "Script file not found.", {"path": script_path}, ["Create the script first."])

	var content := FileAccess.get_file_as_string(script_path)
	var errors: Array[Dictionary] = []
	var warnings: Array[Dictionary] = []
	var paren_balance := 0
	var bracket_balance := 0
	var brace_balance := 0
	var lines := content.split("\n")

	for i in range(lines.size()):
		var line_no := i + 1
		var line := str(lines[i])
		var trimmed := line.strip_edges()

		paren_balance += line.count("(") - line.count(")")
		bracket_balance += line.count("[") - line.count("]")
		brace_balance += line.count("{") - line.count("}")

		if trimmed.begins_with("func ") and not trimmed.ends_with(":"):
			errors.append(_script_issue(script_path, line_no, max(1, line.find("func") + 1), "Function declaration must end with ':'."))

		if trimmed.begins_with("if ") and not trimmed.ends_with(":"):
			errors.append(_script_issue(script_path, line_no, max(1, line.find("if") + 1), "If statement must end with ':'."))

		if target.begins_with("4"):
			_add_godot4_warning(script_path, warnings, line, line_no, "export(", "Godot 3 export(...) syntax detected. Use @export.")
			_add_godot4_warning(script_path, warnings, line, line_no, "onready var", "Godot 3 onready var syntax detected. Use @onready var.")
			_add_godot4_warning(script_path, warnings, line, line_no, "yield(", "Godot 3 yield(...) syntax detected. Use await.")
			_add_godot4_warning(script_path, warnings, line, line_no, "KinematicBody2D", "KinematicBody2D was replaced by CharacterBody2D in Godot 4.x.")

	if paren_balance != 0:
		errors.append(_script_issue(script_path, lines.size(), 1, "Unbalanced parentheses."))
	if bracket_balance != 0:
		errors.append(_script_issue(script_path, lines.size(), 1, "Unbalanced brackets."))
	if brace_balance != 0:
		errors.append(_script_issue(script_path, lines.size(), 1, "Unbalanced braces."))

	return ResponseFactory.success(
		{
			"path": script_path,
			"valid": errors.is_empty(),
			"errors": errors,
			"warnings": warnings
		},
		"Script validation completed."
	)


func get_classdb_info(params: Dictionary) -> Dictionary:
	var class_name_value := str(params.get("class_name", ""))
	if class_name_value.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "class_name is required.", {}, [])

	if not ClassDB.class_exists(class_name_value):
		return ResponseFactory.error("CLASS_NOT_FOUND", "ClassDB class not found.", {"class_name": class_name_value}, ["Check the class name for Godot 4.x."])

	var methods: Array[String] = []
	for method in ClassDB.class_get_method_list(class_name_value, true):
		methods.append(str(method.get("name", "")))
		if methods.size() >= 50:
			break

	var properties: Array[String] = []
	for property in ClassDB.class_get_property_list(class_name_value, true):
		properties.append(str(property.get("name", "")))
		if properties.size() >= 50:
			break

	return ResponseFactory.success(
		{
			"class_name": class_name_value,
			"exists": true,
			"parent_class": ClassDB.get_parent_class(class_name_value),
			"can_instantiate": ClassDB.can_instantiate(class_name_value),
			"methods": methods,
			"properties": properties
		},
		"ClassDB info loaded."
	)


func _script_issue(path: String, line: int, column: int, message: String) -> Dictionary:
	return {
		"file": path,
		"line": line,
		"column": column,
		"message": message
	}


func _add_godot4_warning(path: String, warnings: Array[Dictionary], line: String, line_no: int, needle: String, message: String) -> void:
	var column := line.find(needle)
	if column >= 0:
		warnings.append(_script_issue(path, line_no, column + 1, message))
