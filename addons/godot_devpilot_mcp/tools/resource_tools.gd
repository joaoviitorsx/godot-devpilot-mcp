@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")

var _editor_interface
var _undo_service


func setup(editor_interface, undo_service) -> void:
	_editor_interface = editor_interface
	_undo_service = undo_service


func _valid_resource_path(value: String) -> bool:
	if not value.begins_with("res://") or value.contains("\\") or not (value.ends_with(".tres") or value.ends_with(".res")):
		return false
	for segment in value.trim_prefix("res://").split("/"):
		if segment == "" or segment == "." or segment == "..":
			return false
	return true


func _valid_asset_path(value: String) -> bool:
	if not value.begins_with("res://") or value.contains("\\"):
		return false
	for segment in value.trim_prefix("res://").split("/"):
		if segment == "" or segment == "." or segment == "..":
			return false
	return value.get_extension().to_lower() in ["gltf", "glb", "png", "jpg", "jpeg", "webp", "wav", "ogg", "mp3"]


func _target(params: Dictionary) -> Dictionary:
	if _editor_interface == null:
		return {"error": ResponseFactory.error("EDITOR_NOT_AVAILABLE", "Editor interface is not available.", {}, [])}
	var resource_path := str(params.get("resource_path", ""))
	if not resource_path.is_empty():
		if not _valid_resource_path(resource_path) or not ResourceLoader.exists(resource_path):
			return {"error": ResponseFactory.error("INVALID_RESOURCE_PATH", "Resource path must be an existing project .tres or .res file.", {"resource_path": resource_path}, [])}
		var loaded := ResourceLoader.load(resource_path)
		if loaded == null:
			return {"error": ResponseFactory.error("RESOURCE_LOAD_FAILED", "Could not load resource.", {"resource_path": resource_path}, [])}
		return {"object": loaded, "source": resource_path, "external": true}
	var scene_root: Node = _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return {"error": ResponseFactory.error("NO_SCENE_OPEN", "Open a scene first.", {}, [])}
	var node_path := str(params.get("node_path", "."))
	var node: Node = scene_root if node_path == "." or node_path.is_empty() else scene_root.get_node_or_null(node_path)
	if node == null:
		return {"error": ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])}
	var resource_property := str(params.get("resource_property", ""))
	if resource_property.is_empty():
		return {"object": node, "source": node_path, "external": false}
	var property_info := _property_info(node, resource_property)
	if property_info.is_empty() or int(property_info.get("type", TYPE_NIL)) != TYPE_OBJECT:
		return {"error": ResponseFactory.error("PROPERTY_NOT_FOUND", "Node resource property not found.", {"property": resource_property}, [])}
	var resource = node.get(resource_property)
	if not resource is Resource:
		return {"error": ResponseFactory.error("RESOURCE_NOT_ASSIGNED", "Node property has no resource. Assign one first.", {"property": resource_property}, [])}
	return {"object": resource, "source": "%s.%s" % [node_path, resource_property], "external": false}


func _property_info(object: Object, property_name: String) -> Dictionary:
	for info in object.get_property_list():
		if str(info.get("name", "")) == property_name:
			return info
	return {}


func _value_preview(value: Variant) -> Variant:
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value if typeof(value) != TYPE_STRING or value.length() <= 160 else value.substr(0, 160)
		TYPE_STRING_NAME, TYPE_NODE_PATH:
			return str(value)
		TYPE_VECTOR2:
			return {"x": value.x, "y": value.y}
		TYPE_VECTOR3:
			return {"x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR:
			return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_OBJECT:
			if value is Resource:
				return {"resource_type": value.get_class(), "resource_path": value.resource_path}
			return {"object_type": value.get_class()} if value != null else null
		TYPE_ARRAY, TYPE_DICTIONARY, TYPE_PACKED_BYTE_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_STRING_ARRAY:
			return {"size": value.size()}
		_:
			return {"variant_type": typeof(value)}


func inspect_object(params: Dictionary) -> Dictionary:
	var target := _target(params)
	if target.has("error"):
		return target["error"]
	var object: Object = target["object"]
	var offset := clampi(int(params.get("offset", 0)), 0, 5000)
	var limit := clampi(int(params.get("limit", 25)), 1, 100)
	var properties: Array[Dictionary] = []
	for info in object.get_property_list():
		if int(info.get("usage", 0)) & (PROPERTY_USAGE_EDITOR | PROPERTY_USAGE_STORAGE) != 0:
			properties.append(info)
	var page: Array[Dictionary] = []
	for info in properties.slice(offset, offset + limit):
		var name := str(info.get("name", ""))
		page.append({"name": name, "type": int(info.get("type", TYPE_NIL)), "class_name": str(info.get("class_name", "")), "hint": int(info.get("hint", 0)), "hint_string": str(info.get("hint_string", "")), "usage": int(info.get("usage", 0)), "value": _value_preview(object.get(name))})
	var data := {"source": target["source"], "class_name": object.get_class(), "script_path": str(object.get_script().resource_path) if object.get_script() is Script else "", "offset": offset, "limit": limit, "total_properties": properties.size(), "properties": page}
	if bool(params.get("include_methods", false)):
		var methods: Array[Dictionary] = []
		var method_list := object.get_method_list()
		for method in method_list.slice(offset, offset + limit):
			methods.append({"name": str(method.get("name", "")), "argument_count": method.get("args", []).size()})
		data["methods"] = methods
		data["total_methods"] = method_list.size()
	if bool(params.get("include_signals", false)):
		var signals: Array[Dictionary] = []
		var signal_list := object.get_signal_list()
		for signal_info in signal_list.slice(offset, offset + limit):
			signals.append({"name": str(signal_info.get("name", "")), "argument_count": signal_info.get("args", []).size()})
		data["signals"] = signals
		data["total_signals"] = signal_list.size()
	return ResponseFactory.success(data, "Object inspected.")


func _coerce(info: Dictionary, value: Variant) -> Dictionary:
	match int(info.get("type", TYPE_NIL)):
		TYPE_BOOL:
			if typeof(value) == TYPE_BOOL: return {"ok": true, "value": value}
		TYPE_INT:
			if typeof(value) == TYPE_INT: return {"ok": true, "value": value}
		TYPE_FLOAT:
			if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT: return {"ok": true, "value": float(value)}
		TYPE_STRING:
			if typeof(value) == TYPE_STRING: return {"ok": true, "value": value}
		TYPE_VECTOR2:
			if typeof(value) == TYPE_DICTIONARY and value.has("x") and value.has("y") and typeof(value.x) in [TYPE_INT, TYPE_FLOAT] and typeof(value.y) in [TYPE_INT, TYPE_FLOAT]: return {"ok": true, "value": Vector2(float(value.x), float(value.y))}
		TYPE_VECTOR3:
			if typeof(value) == TYPE_DICTIONARY and value.has("x") and value.has("y") and value.has("z") and typeof(value.x) in [TYPE_INT, TYPE_FLOAT] and typeof(value.y) in [TYPE_INT, TYPE_FLOAT] and typeof(value.z) in [TYPE_INT, TYPE_FLOAT]: return {"ok": true, "value": Vector3(float(value.x), float(value.y), float(value.z))}
		TYPE_COLOR:
			if typeof(value) == TYPE_STRING and value.begins_with("#") and Color.html_is_valid(value): return {"ok": true, "value": Color.html(value)}
		TYPE_OBJECT:
			if value == null: return {"ok": true, "value": null}
	return {"ok": false}


func set_resource_property(params: Dictionary) -> Dictionary:
	var target := _target(params)
	if target.has("error"):
		return target["error"]
	var resource: Resource = target["object"] as Resource
	if resource == null:
		return ResponseFactory.error("RESOURCE_REQUIRED", "Target must be a resource or node subresource.", {}, [])
	if bool(target["external"]):
		return ResponseFactory.error("EXTERNAL_RESOURCE_WRITE_UNSUPPORTED", "External resource editing requires a saved backup workflow.", {"resource_path": target["source"]}, [])
	if _undo_service == null or not _undo_service.has_undo_redo():
		return ResponseFactory.error("UNDO_FAILED", "UndoRedo is unavailable.", {}, [])
	var property_name := str(params.get("property", ""))
	var info := _property_info(resource, property_name)
	if info.is_empty() or int(info.get("usage", 0)) & PROPERTY_USAGE_STORAGE == 0:
		return ResponseFactory.error("PROPERTY_NOT_FOUND", "Stored resource property not found.", {"property": property_name}, [])
	var converted := _coerce(info, params.get("value"))
	if not converted.get("ok", false):
		return ResponseFactory.error("INVALID_PROPERTY_VALUE", "Value does not match the resource property type.", {"property": property_name, "type": int(info.get("type", TYPE_NIL))}, [])
	var old_value = resource.get(property_name)
	_undo_service.create_action("Set resource %s.%s" % [resource.get_class(), property_name])
	_undo_service.add_do_property(resource, property_name, converted["value"])
	_undo_service.add_undo_property(resource, property_name, old_value)
	_undo_service.commit_action()
	return ResponseFactory.success({"source": target["source"], "property": property_name, "old_value": _value_preview(old_value), "new_value": _value_preview(converted["value"])}, "Resource property set with UndoRedo.")


func edit_external_resource(params: Dictionary) -> Dictionary:
	var resource_path := str(params.get("path", ""))
	var target := _target({"resource_path": resource_path})
	if target.has("error"):
		return target["error"]
	var resource: Resource = target["object"]
	var property_name := str(params.get("property", ""))
	var info := _property_info(resource, property_name)
	if info.is_empty() or int(info.get("usage", 0)) & PROPERTY_USAGE_STORAGE == 0:
		return ResponseFactory.error("PROPERTY_NOT_FOUND", "Stored resource property not found.", {"property": property_name}, [])
	var converted := _coerce(info, params.get("value"))
	if not converted.get("ok", false):
		return ResponseFactory.error("INVALID_PROPERTY_VALUE", "Value does not match the resource property type.", {"property": property_name, "type": int(info.get("type", TYPE_NIL))}, [])
	var old_value = resource.get(property_name)
	resource.set(property_name, converted["value"])
	var save_error := ResourceSaver.save(resource, resource_path)
	if save_error != OK:
		resource.set(property_name, old_value)
		return ResponseFactory.error("RESOURCE_SAVE_FAILED", "Could not save the changed resource.", {"error_code": save_error, "resource_path": resource_path}, [])
	return ResponseFactory.success({"resource_path": resource_path, "property": property_name, "old_value": _value_preview(old_value), "new_value": _value_preview(converted["value"])}, "External resource saved; restore from the backup to revert.")


func create_external_resource(params: Dictionary) -> Dictionary:
	var resource_path := str(params.get("path", ""))
	var resource_type := str(params.get("resource_type", ""))
	if not _valid_resource_path(resource_path) or not resource_path.ends_with(".tres"):
		return ResponseFactory.error("INVALID_RESOURCE_PATH", "A project .tres output path is required.", {"path": resource_path}, [])
	if not ClassDB.class_exists(resource_type) or not ClassDB.can_instantiate(resource_type) or not ClassDB.is_parent_class(resource_type, "Resource"):
		return ResponseFactory.error("INVALID_RESOURCE_TYPE", "Resource type must be an instantiable built-in Resource class.", {"resource_type": resource_type}, [])
	if FileAccess.file_exists(resource_path) and not bool(params.get("overwrite", false)):
		return ResponseFactory.error("FILE_ALREADY_EXISTS", "Resource already exists.", {"path": resource_path}, [])
	var resource: Resource = ClassDB.instantiate(resource_type) as Resource
	var properties: Dictionary = params.get("properties", {})
	if properties.size() > 64:
		return ResponseFactory.error("TOO_MANY_PROPERTIES", "At most 64 initial properties are supported.", {}, [])
	for property_name in properties.keys():
		var info := _property_info(resource, str(property_name))
		if info.is_empty() or int(info.get("usage", 0)) & PROPERTY_USAGE_STORAGE == 0:
			return ResponseFactory.error("PROPERTY_NOT_FOUND", "Stored resource property not found.", {"property": property_name}, [])
		var converted := _coerce(info, properties[property_name])
		if not converted.get("ok", false):
			return ResponseFactory.error("INVALID_PROPERTY_VALUE", "Initial value does not match the resource property type.", {"property": property_name}, [])
		resource.set(str(property_name), converted["value"])
	var absolute_path := ProjectSettings.globalize_path(resource_path)
	var directory_error := DirAccess.make_dir_recursive_absolute(absolute_path.get_base_dir())
	if directory_error != OK:
		return ResponseFactory.error("CREATE_DIRECTORY_FAILED", "Could not create resource folder.", {"error_code": directory_error}, [])
	var save_error := ResourceSaver.save(resource, resource_path)
	if save_error != OK:
		return ResponseFactory.error("RESOURCE_SAVE_FAILED", "Could not save the resource.", {"error_code": save_error}, [])
	return ResponseFactory.success({"path": resource_path, "resource_type": resource.get_class(), "properties": properties.keys()}, "Resource created.")


func add_property_animation(params: Dictionary) -> Dictionary:
	if _editor_interface == null:
		return ResponseFactory.error("EDITOR_NOT_AVAILABLE", "Editor interface is not available.", {}, [])
	if _undo_service == null or not _undo_service.has_undo_redo():
		return ResponseFactory.error("UNDO_FAILED", "UndoRedo is unavailable.", {}, [])
	var scene_root: Node = _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "Open a scene first.", {}, [])
	var player_path := str(params.get("player_path", ""))
	var player: AnimationPlayer = scene_root.get_node_or_null(player_path) as AnimationPlayer
	if player == null:
		return ResponseFactory.error("ANIMATION_PLAYER_NOT_FOUND", "AnimationPlayer not found.", {"player_path": player_path}, [])
	var animation_name := str(params.get("animation_name", ""))
	if animation_name.is_empty() or animation_name.contains("/"):
		return ResponseFactory.error("INVALID_ANIMATION_NAME", "Use a nonempty animation name without '/'.", {}, [])
	var target_path := str(params.get("target_path", ""))
	var property_name := str(params.get("property", ""))
	var animation_root: Node = player.get_node_or_null(player.root_node)
	var target: Node = null
	if animation_root != null:
		target = animation_root if target_path == "." else animation_root.get_node_or_null(target_path)
	if target == null:
		return ResponseFactory.error("TARGET_NOT_FOUND", "Animation target not found relative to AnimationPlayer root.", {"target_path": target_path}, [])
	var info := _property_info(target, property_name)
	if info.is_empty() or int(info.get("usage", 0)) & (PROPERTY_USAGE_STORAGE | PROPERTY_USAGE_EDITOR) == 0:
		return ResponseFactory.error("PROPERTY_NOT_FOUND", "Animation target property is not editable.", {"property": property_name}, [])
	if typeof(params.get("length", 1.0)) not in [TYPE_INT, TYPE_FLOAT]:
		return ResponseFactory.error("INVALID_ANIMATION", "Length must be numeric.", {}, [])
	var length := float(params.get("length", 1.0))
	var keys: Array = params.get("keys", [])
	if is_nan(length) or is_inf(length) or length <= 0.0 or length > 600.0 or keys.size() < 2 or keys.size() > 128:
		return ResponseFactory.error("INVALID_ANIMATION", "Length must be 0-600 seconds and keys must contain 2-128 entries.", {}, [])
	var animation := Animation.new()
	animation.length = length
	var track := animation.add_track(Animation.TYPE_VALUE)
	animation.track_set_path(track, NodePath("%s:%s" % [target_path, property_name]))
	var previous_time := -1.0
	for key in keys:
		if typeof(key) != TYPE_DICTIONARY or not key.has("time") or not key.has("value"):
			return ResponseFactory.error("INVALID_KEY", "Each key needs time and value.", {}, [])
		if typeof(key["time"]) not in [TYPE_INT, TYPE_FLOAT]:
			return ResponseFactory.error("INVALID_KEY_TIME", "Key time must be numeric.", {}, [])
		var key_time := float(key["time"])
		if is_nan(key_time) or is_inf(key_time) or key_time <= previous_time or key_time < 0.0 or key_time > length:
			return ResponseFactory.error("INVALID_KEY_TIME", "Key times must increase within animation length.", {"time": key_time}, [])
		var converted := _coerce(info, key["value"])
		if not converted.get("ok", false):
			return ResponseFactory.error("INVALID_KEY_VALUE", "Key value does not match target property type.", {"time": key_time, "property": property_name}, [])
		animation.track_insert_key(track, key_time, converted["value"])
		previous_time = key_time
	var library: AnimationLibrary = player.get_animation_library("") if player.has_animation_library("") else null
	if library != null and library.has_animation(animation_name):
		return ResponseFactory.error("ANIMATION_ALREADY_EXISTS", "Animation already exists.", {"animation_name": animation_name}, [])
	_undo_service.create_action("Add animation %s" % animation_name)
	if library == null:
		library = AnimationLibrary.new()
		library.add_animation(animation_name, animation)
		_undo_service.add_do_method(player, "add_animation_library", ["", library])
		_undo_service.add_undo_method(player, "remove_animation_library", [""])
	else:
		_undo_service.add_do_method(library, "add_animation", [animation_name, animation])
		_undo_service.add_undo_method(library, "remove_animation", [animation_name])
	_undo_service.commit_action()
	return ResponseFactory.success({"player_path": player_path, "animation_name": animation_name, "target_path": target_path, "property": property_name, "length": length, "track_count": animation.get_track_count(), "key_count": keys.size()}, "Property animation created with UndoRedo.")


func reimport_asset(params: Dictionary) -> Dictionary:
	if _editor_interface == null:
		return ResponseFactory.error("EDITOR_NOT_AVAILABLE", "Editor interface is not available.", {}, [])
	var asset_path := str(params.get("asset_path", ""))
	if not _valid_asset_path(asset_path) or not FileAccess.file_exists(asset_path):
		return ResponseFactory.error("INVALID_ASSET_PATH", "Use an existing project image, audio, glTF or GLB file.", {"asset_path": asset_path}, [])
	var import_path := asset_path + ".import"
	if not FileAccess.file_exists(import_path):
		return ResponseFactory.error("IMPORT_CONFIG_MISSING", "Asset has not been imported by the editor yet.", {"import_path": import_path}, ["Open the project in Godot and let the first import finish."])
	var filesystem: EditorFileSystem = _editor_interface.get_resource_filesystem()
	if filesystem == null or filesystem.is_scanning() or (filesystem.has_method("is_importing") and filesystem.call("is_importing")):
		return ResponseFactory.error("IMPORT_BUSY", "Editor filesystem is busy importing or scanning.", {}, [])
	var config := ConfigFile.new()
	var load_error := config.load(import_path)
	if load_error != OK:
		return ResponseFactory.error("IMPORT_CONFIG_INVALID", "Could not read import settings.", {"error_code": load_error}, [])
	var options: Dictionary = params.get("options", {})
	if options.size() > 32:
		return ResponseFactory.error("TOO_MANY_OPTIONS", "At most 32 import options can be changed at once.", {}, [])
	var changed: Array[String] = []
	for option_name in options.keys():
		var key := str(option_name)
		if not config.has_section_key("params", key):
			return ResponseFactory.error("IMPORT_OPTION_NOT_FOUND", "Only existing import parameters may be changed.", {"option": key}, [])
		var old_value = config.get_value("params", key)
		var new_value = options[option_name]
		if typeof(old_value) not in [TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING] or typeof(new_value) != typeof(old_value):
			return ResponseFactory.error("INVALID_IMPORT_OPTION", "Import option type does not match its existing value.", {"option": key}, [])
		config.set_value("params", key, new_value)
		changed.append(key)
	if not changed.is_empty():
		var save_error := config.save(import_path)
		if save_error != OK:
			return ResponseFactory.error("IMPORT_CONFIG_SAVE_FAILED", "Could not save import settings.", {"error_code": save_error}, [])
	filesystem.reimport_files(PackedStringArray([asset_path]))
	var imported = ResourceLoader.load(asset_path)
	if imported == null:
		return ResponseFactory.error("REIMPORT_FAILED", "Reimport completed without a loadable resource.", {"asset_path": asset_path, "changed_options": changed}, [])
	return ResponseFactory.success({"asset_path": asset_path, "imported_type": imported.get_class(), "changed_options": changed}, "Asset reimported and loaded successfully.")


func assign_resource(params: Dictionary) -> Dictionary:
	if _editor_interface == null:
		return ResponseFactory.error("EDITOR_NOT_AVAILABLE", "Editor interface is not available.", {}, [])
	if _undo_service == null or not _undo_service.has_undo_redo():
		return ResponseFactory.error("UNDO_FAILED", "UndoRedo is unavailable.", {}, [])
	var scene_root: Node = _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "Open a scene first.", {}, [])
	var node_path := str(params.get("node_path", "."))
	var node: Node = scene_root if node_path == "." else scene_root.get_node_or_null(node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])
	var property_name := str(params.get("property", ""))
	var info := _property_info(node, property_name)
	var required_class := str(info.get("hint_string", ""))
	var allowed_classes: Array[String] = []
	for hinted_class in required_class.split(","):
		var class_name_value := hinted_class.strip_edges()
		if ClassDB.class_exists(class_name_value) and ClassDB.is_parent_class(class_name_value, "Resource"):
			allowed_classes.append(class_name_value)
	if info.is_empty() or int(info.get("type", TYPE_NIL)) != TYPE_OBJECT or allowed_classes.is_empty():
		return ResponseFactory.error("INVALID_RESOURCE_PROPERTY", "Node property has no supported Resource type hint.", {"property": property_name, "type": int(info.get("type", TYPE_NIL)), "hint_string": required_class}, [])
	var resource: Resource
	var resource_path := str(params.get("resource_path", ""))
	if not resource_path.is_empty():
		if not _valid_resource_path(resource_path) or not ResourceLoader.exists(resource_path):
			return ResponseFactory.error("INVALID_RESOURCE_PATH", "Use an existing project .tres or .res resource.", {"resource_path": resource_path}, [])
		resource = ResourceLoader.load(resource_path)
	else:
		var resource_type := str(params.get("resource_type", ""))
		if not ClassDB.class_exists(resource_type) or not ClassDB.can_instantiate(resource_type) or not ClassDB.is_parent_class(resource_type, "Resource"):
			return ResponseFactory.error("INVALID_RESOURCE_TYPE", "Resource type is not instantiable.", {"resource_type": resource_type}, [])
		resource = ClassDB.instantiate(resource_type) as Resource
	var compatible := false
	if resource != null:
		for allowed_class in allowed_classes:
			if resource.is_class(allowed_class):
				compatible = true
				break
	if not compatible:
		return ResponseFactory.error("RESOURCE_TYPE_MISMATCH", "Resource does not match the node property type.", {"expected": required_class, "actual": resource.get_class() if resource != null else "null"}, [])
	var old_value = node.get(property_name)
	_undo_service.create_action("Assign %s to %s.%s" % [resource.get_class(), node.name, property_name])
	_undo_service.add_do_property(node, property_name, resource)
	_undo_service.add_undo_property(node, property_name, old_value)
	_undo_service.commit_action()
	return ResponseFactory.success({"node_path": node_path, "property": property_name, "resource_type": resource.get_class(), "resource_path": resource.resource_path}, "Resource assigned with UndoRedo.")
