@tool
extends EditorDebuggerPlugin

# Captures runtime messages from the running scene and forwards them to the
# active run report jsonl via the assigned `event_sink` callable.
# Usage:
#   var dbg := preload("res://addons/godot_devpilot_mcp/core/runtime_capture.gd").new()
#   dbg.event_sink = Callable(my_debug_tools, "append_runtime_event")
#   add_debugger_plugin(dbg)

var event_sink: Callable

func _has_capture(prefix: String) -> bool:
	# Capture all known prefixes from Godot's debugger protocol so we can record
	# errors, output and runtime stats in the run log.
	return prefix == "error" or prefix == "output" or prefix == "performance" or prefix == "scene"


func _capture(message: String, data: Array, session_id: int) -> bool:
	if event_sink.is_valid():
		event_sink.call(message, data, session_id)
	# Returning true means "we handled it"; returning false lets other plugins also handle.
	return false


func _setup_session(session_id: int) -> void:
	var session := get_session(session_id)
	if session == null:
		return
	if session.started.is_connected(_on_started):
		return
	session.started.connect(_on_started.bind(session_id))
	session.stopped.connect(_on_stopped.bind(session_id))
	session.breaked.connect(_on_breaked.bind(session_id))


func _on_started(session_id: int) -> void:
	if event_sink.is_valid():
		event_sink.call("session.started", [], session_id)


func _on_stopped(session_id: int) -> void:
	if event_sink.is_valid():
		event_sink.call("session.stopped", [], session_id)


func _on_breaked(can_debug: bool, session_id: int) -> void:
	if event_sink.is_valid():
		event_sink.call("session.breaked", [can_debug], session_id)
