@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")
const Permissions = preload("res://addons/godot_devpilot_mcp/core/permissions.gd")

var _editor_interface  # EditorInterface or null
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


func _validate_scene_path(path: String) -> Dictionary:
	if not Permissions.is_res_path_allowed(path):
		return ResponseFactory.error(
			"PATH_OUTSIDE_PROJECT",
			"Scene path is outside the Godot project sandbox.",
			{"path": path},
			["Use a res:// path that stays inside the active Godot project."]
		)

	if not path.ends_with(".tscn"):
		return ResponseFactory.error(
			"INVALID_PARAMS",
			"Scene path must end in .tscn.",
			{"path": path},
			["Example: res://scenes/Main.tscn"]
		)

	return {}


# ── Scene tree ────────────────────────────────────────────────────────────────

func get_tree(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error(
			"NO_SCENE_OPEN",
			"No scene is currently open in the editor.",
			{},
			["Open a scene before calling godot_get_scene_tree."]
		)

	var include_properties: bool = bool(params.get("include_properties", false))
	var max_depth: int = int(params.get("max_depth", 10))
	if max_depth < 1:
		return ResponseFactory.error("INVALID_PARAMS", "max_depth must be greater than zero.", {"max_depth": max_depth}, [])
	var total_nodes := [0]
	var tree := _node_to_dict(scene_root, scene_root, include_properties, total_nodes, 0, max_depth)

	return ResponseFactory.success(
		{
			"root": tree,
			"total_nodes": total_nodes[0],
			"scene_file": str(scene_root.scene_file_path)
		},
		"Scene tree loaded."
	)


func get_scene_summary(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var type_counts := {}
	var total_nodes := [0]
	_count_node_types(scene_root, type_counts, total_nodes)

	return ResponseFactory.success(
		{
			"scene_file": str(scene_root.scene_file_path),
			"root_name": str(scene_root.name),
			"root_type": scene_root.get_class(),
			"total_nodes": total_nodes[0],
			"node_type_counts": type_counts
		},
		"Scene summary loaded."
	)


func validate_scene(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var path: String = str(params.get("path", ""))
	if path.is_empty():
		var scene_root: Node = _require_scene_root()
		if scene_root == null:
			return ResponseFactory.error(
				"NO_SCENE_OPEN",
				"No scene open and no path provided.",
				{},
				["Open a scene or provide a scene path."]
			)
		path = str(scene_root.scene_file_path)

	var path_check := _validate_scene_path(path)
	if not path_check.is_empty():
		return path_check

	if not ResourceLoader.exists(path):
		return ResponseFactory.error(
			"FILE_NOT_FOUND",
			"Scene file not found.",
			{"path": path},
			["Check the path is correct and the file exists."]
		)

	var scene = ResourceLoader.load(path, "PackedScene")
	if scene == null:
		return ResponseFactory.error(
			"SCENE_LOAD_FAILED",
			"Could not load scene file.",
			{"path": path},
			["The file may be corrupt or not a valid Godot scene."]
		)

	return ResponseFactory.success({"path": path, "valid": true}, "Scene is valid.")


func audit_scene(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var path: String = str(params.get("path", ""))
	var scene_root: Node = null
	var instantiated := false

	if path.is_empty():
		scene_root = _require_scene_root()
		if scene_root == null:
			return ResponseFactory.error("NO_SCENE_OPEN", "No scene open and no path provided.", {}, ["Open a scene or provide a scene path."])
		path = str(scene_root.scene_file_path)
	else:
		var path_check := _validate_scene_path(path)
		if not path_check.is_empty():
			return path_check
		if not ResourceLoader.exists(path):
			return ResponseFactory.error("FILE_NOT_FOUND", "Scene file not found.", {"path": path}, ["Check the path is correct."])
		var packed = ResourceLoader.load(path, "PackedScene")
		if packed == null:
			return ResponseFactory.error("SCENE_LOAD_FAILED", "Could not load scene file.", {"path": path}, [])
		scene_root = packed.instantiate()
		instantiated = true

	var issues: Array[Dictionary] = []
	if scene_root == null:
		return ResponseFactory.error("SCENE_LOAD_FAILED", "Could not inspect scene.", {"path": path}, [])

	if str(scene_root.name).strip_edges().is_empty():
		issues.append({"severity": "error", "code": "EMPTY_ROOT_NAME", "message": "Root node has an empty name.", "node_path": "."})

	_audit_node(scene_root, scene_root, issues)

	if instantiated:
		scene_root.free()

	var errors := 0
	var warnings := 0
	for issue in issues:
		if str(issue.get("severity", "")) == "error":
			errors += 1
		else:
			warnings += 1

	return ResponseFactory.success(
		{
			"path": path,
			"valid": errors == 0,
			"errors": errors,
			"warnings": warnings,
			"issues": issues
		},
		"Scene audit completed."
	)


# ── Scene mutations ───────────────────────────────────────────────────────────

func create_scene(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var path: String = str(params.get("path", ""))
	var path_check := _validate_scene_path(path)
	if not path_check.is_empty():
		return path_check

	var overwrite := bool(params.get("overwrite", false))
	if ResourceLoader.exists(path) and not overwrite:
		return ResponseFactory.error("FILE_ALREADY_EXISTS", "Scene already exists.", {"path": path}, ["Pass overwrite=true only after backup."])

	var root_type: String = str(params.get("root_type", "Node2D"))
	var root_name: String = str(params.get("root_name", path.get_file().get_basename()))

	if not ClassDB.can_instantiate(root_type):
		return ResponseFactory.error(
			"INVALID_NODE_TYPE",
			"Node type '%s' cannot be instantiated." % root_type,
			{"node_type": root_type},
			["Check ClassDB for valid instantiable node types."]
		)

	var root: Node = ClassDB.instantiate(root_type)
	root.name = root_name

	var scene := PackedScene.new()
	if scene.pack(root) != OK:
		root.free()
		return ResponseFactory.error("SCENE_PACK_FAILED", "Could not pack scene.", {}, [])

	var dest_dir := path.get_base_dir()
	var abs_dest_dir := ProjectSettings.globalize_path(dest_dir)
	if not DirAccess.dir_exists_absolute(abs_dest_dir):
		DirAccess.make_dir_recursive_absolute(abs_dest_dir)

	var save_result := ResourceSaver.save(scene, path)
	if save_result != OK:
		root.free()
		return ResponseFactory.error(
			"FILE_WRITE_FAILED",
			"Could not save scene to disk.",
			{"path": path, "error_code": save_result},
			["Check that the directory exists and is writable."]
		)

	_editor_interface.get_resource_filesystem().scan()

	return ResponseFactory.success(
		{"path": path, "root_type": root_type, "root_name": root_name},
		"Scene created successfully."
	)


func open_scene(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var path: String = str(params.get("path", ""))
	if path.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "path is required.", {}, [])

	var path_check := _validate_scene_path(path)
	if not path_check.is_empty():
		return path_check

	if not ResourceLoader.exists(path):
		return ResponseFactory.error("FILE_NOT_FOUND", "Scene file not found.", {"path": path}, ["Check the path is correct."])

	_editor_interface.open_scene_from_path(path)

	return ResponseFactory.success({"path": path}, "Scene opened.")


func save_scene(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var path: String = str(params.get("path", ""))
	if not path.is_empty():
		var path_check := _validate_scene_path(path)
		if not path_check.is_empty():
			return path_check
		_editor_interface.save_scene_as(path)
	else:
		path = str(scene_root.scene_file_path)
		_editor_interface.save_scene()

	return ResponseFactory.success(
		{"path": path},
		"Scene saved."
	)


func duplicate_scene(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var source: String = str(params.get("source", ""))
	var destination: String = str(params.get("destination", ""))

	if source.is_empty() or destination.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "source and destination are required.", {}, [])

	var source_check := _validate_scene_path(source)
	if not source_check.is_empty():
		return source_check

	var destination_check := _validate_scene_path(destination)
	if not destination_check.is_empty():
		return destination_check

	if not ResourceLoader.exists(source):
		return ResponseFactory.error(
			"FILE_NOT_FOUND",
			"Source scene not found.",
			{"path": source},
			["Check the source path is correct."]
		)

	var dest_dir := destination.get_base_dir()
	var abs_dest_dir := ProjectSettings.globalize_path(dest_dir)
	if not DirAccess.dir_exists_absolute(abs_dest_dir):
		DirAccess.make_dir_recursive_absolute(abs_dest_dir)

	var dir := DirAccess.open("res://")
	if dir == null:
		return ResponseFactory.error("FILE_SYSTEM_ERROR", "Cannot access project file system.", {}, [])

	if ResourceLoader.exists(destination) and not bool(params.get("overwrite", false)):
		return ResponseFactory.error("FILE_ALREADY_EXISTS", "Destination scene already exists.", {"path": destination}, ["Pass overwrite=true only after backup."])

	if dir.copy(source, destination) != OK:
		return ResponseFactory.error(
			"FILE_WRITE_FAILED",
			"Could not copy scene.",
			{"source": source, "destination": destination},
			["Check that the destination directory is writable."]
		)

	_editor_interface.get_resource_filesystem().scan()

	return ResponseFactory.success(
		{"source": source, "destination": destination},
		"Scene duplicated."
	)


# ── Helpers ───────────────────────────────────────────────────────────────────

func _node_to_dict(
	node: Node,
	scene_root: Node,
	include_properties: bool,
	total: Array,
	depth: int,
	max_depth: int
) -> Dictionary:
	total[0] += 1
	var dict := {
		"name": str(node.name),
		"type": node.get_class(),
		"path": "." if node == scene_root else str(scene_root.get_path_to(node)),
		"children": []
	}
	if include_properties:
		var script = node.get_script()
		dict["script"] = str(script.resource_path) if script != null else ""
	if depth + 1 < max_depth:
		for child in node.get_children():
			dict["children"].append(_node_to_dict(child, scene_root, include_properties, total, depth + 1, max_depth))
	return dict


func _count_node_types(node: Node, counts: Dictionary, total: Array) -> void:
	total[0] += 1
	var t := node.get_class()
	counts[t] = counts.get(t, 0) + 1
	for child in node.get_children():
		_count_node_types(child, counts, total)


func _audit_node(node: Node, scene_root: Node, issues: Array[Dictionary]) -> void:
	var node_path := "." if node == scene_root else str(scene_root.get_path_to(node))

	if str(node.name).strip_edges().is_empty():
		issues.append({"severity": "error", "code": "EMPTY_NODE_NAME", "message": "Node has an empty name.", "node_path": node_path})

	if node != scene_root and node.owner == null:
		issues.append({"severity": "warning", "code": "MISSING_OWNER", "message": "Node has no owner and may not be saved in the scene.", "node_path": node_path})

	var script = node.get_script()
	if script != null and script.resource_path != "" and not ResourceLoader.exists(str(script.resource_path)):
		issues.append({"severity": "error", "code": "SCRIPT_NOT_FOUND", "message": "Attached script file does not exist.", "node_path": node_path, "script_path": str(script.resource_path)})

	for child in node.get_children():
		_audit_node(child, scene_root, issues)
