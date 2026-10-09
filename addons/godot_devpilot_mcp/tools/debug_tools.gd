@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")

var _editor_interface
var _current_run_log_path: String = ""


func setup(p_editor_interface) -> void:
	_editor_interface = p_editor_interface


func _require_editor() -> Dictionary:
	if _editor_interface == null:
		return ResponseFactory.error(
			"EDITOR_NOT_AVAILABLE",
			"Editor interface is not available.",
			{},
			["Ensure the plugin is loaded in the Godot editor (not headless)."]
		)
	return {}


func _get_timestamp() -> String:
	return Time.get_datetime_string_from_system(true, true)


func _get_date_key() -> String:
	return Time.get_date_string_from_system()


func _get_time_key() -> String:
	return Time.get_time_string_from_system().replace(":", "")


func _append_run_event(log_path: String, event_type: String, data: Dictionary) -> void:
	var dir_path := log_path.get_base_dir()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir_path))

	var event := {
		"timestamp": _get_timestamp(),
		"type": event_type,
		"data": data
	}

	var access_mode := FileAccess.READ_WRITE if FileAccess.file_exists(log_path) else FileAccess.WRITE
	var file := FileAccess.open(log_path, access_mode)
	if file:
		file.seek_end()
		file.store_line(JSON.stringify(event))
		file.close()


# Public hook for the runtime debugger plugin to forward debugger messages.
func append_runtime_event(message: String, data: Array, session_id: int) -> void:
	if _current_run_log_path.is_empty():
		return
	var event_type := "runtime"
	if message.begins_with("error"):
		event_type = "error"
	elif message.begins_with("output"):
		event_type = "output"
	elif message.begins_with("session"):
		event_type = "session"
	_append_run_event(_current_run_log_path, event_type, {
		"message": message,
		"session_id": session_id,
		"payload": data,
	})


func _new_run_log_path() -> String:
	var date_key := _get_date_key()
	var time_key := _get_time_key()
	return "res://.godot_mcp/logs/run_reports/%s/run_%s.jsonl" % [date_key, time_key]


func run_project(_params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check

	if _editor_interface.is_playing_scene():
		return ResponseFactory.error(
			"GAME_ALREADY_RUNNING",
			"A scene is already running. Stop it before starting a new run.",
			{},
			["Use godot_stop_project first."]
		)

	_current_run_log_path = _new_run_log_path()
	_append_run_event(_current_run_log_path, "start", {
		"mode": "main_scene",
		"scene": str(ProjectSettings.get_setting("application/run/main_scene", ""))
	})

	_editor_interface.play_main_scene()

	return ResponseFactory.success(
		{
			"running": true,
			"mode": "main_scene",
			"log_path": _current_run_log_path
		},
		"Project started."
	)


func run_scene(params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check

	var scene_path := str(params.get("scene_path", ""))
	if scene_path.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "scene_path is required.", {}, [])

	if not scene_path.begins_with("res://"):
		return ResponseFactory.error(
			"PATH_OUTSIDE_PROJECT",
			"scene_path must start with res://.",
			{"scene_path": scene_path},
			["Use a res:// path to the .tscn scene."]
		)

	if not ResourceLoader.exists(scene_path):
		return ResponseFactory.error(
			"SCENE_NOT_FOUND",
			"Scene file not found.",
			{"scene_path": scene_path},
			["Verify the scene path with godot_get_scene_tree."]
		)

	if _editor_interface.is_playing_scene():
		return ResponseFactory.error(
			"GAME_ALREADY_RUNNING",
			"A scene is already running. Stop it before starting a new run.",
			{},
			["Use godot_stop_project first."]
		)

	_current_run_log_path = _new_run_log_path()
	_append_run_event(_current_run_log_path, "start", {
		"mode": "custom_scene",
		"scene": scene_path
	})

	_editor_interface.play_custom_scene(scene_path)

	return ResponseFactory.success(
		{
			"running": true,
			"mode": "custom_scene",
			"scene_path": scene_path,
			"log_path": _current_run_log_path
		},
		"Scene started."
	)


func stop_project(_params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check

	if not _editor_interface.is_playing_scene():
		return ResponseFactory.success(
			{"running": false},
			"No scene is running."
		)

	if not _current_run_log_path.is_empty():
		_append_run_event(_current_run_log_path, "stop", {"reason": "stopped_by_mcp"})

	_editor_interface.stop_playing_scene()

	return ResponseFactory.success(
		{"running": false, "log_path": _current_run_log_path},
		"Project stopped."
	)


func is_running(_params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check

	var running: bool = _editor_interface.is_playing_scene()
	return ResponseFactory.success(
		{
			"running": running,
			"log_path": _current_run_log_path if running else ""
		},
		"Running: %s." % str(running)
	)
