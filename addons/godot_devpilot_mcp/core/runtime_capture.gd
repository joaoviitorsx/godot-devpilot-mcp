@tool
extends EditorDebuggerPlugin

# Captures runtime messages from the running scene and forwards them to the
# active run report jsonl via the assigned `event_sink` callable.
# Usage:
#   var dbg := preload("res://addons/godot_devpilot_mcp/core/runtime_capture.gd").new()
#   dbg.event_sink = Callable(my_debug_tools, "append_runtime_event")
#   add_debugger_plugin(dbg)

var event_sink: Callable
var _next_request_id := 1
var _responses := {}
var _pending_requests := {}

func _has_capture(prefix: String) -> bool:
	# Capture all known prefixes from Godot's debugger protocol so we can record
	# errors, output and runtime stats in the run log.
	return prefix == "error" or prefix == "output" or prefix == "performance" or prefix == "scene" or prefix == "devpilot_runtime"


func _capture(message: String, data: Array, session_id: int) -> bool:
	if message == "devpilot_runtime:response" and data.size() == 2:
		var id := int(data[0])
		if _pending_requests.has(id):
			_responses[id] = data[1]
		return true
	if event_sink.is_valid():
		event_sink.call(message, data, session_id)
	# Returning true means "we handled it"; returning false lets other plugins also handle.
	return false


func request(method: String, params: Dictionary) -> Dictionary:
	var active_session = null
	for session in get_sessions():
		if session.is_active():
			active_session = session
			break
	if active_session == null:
		return {"ok": false, "error": {"code": "RUNTIME_BRIDGE_UNAVAILABLE", "message": "No active Godot game debugger session.", "details": {}, "suggestions": ["Start the project from the Godot editor with the GodoPilot runtime autoload installed."]}}
	var id := _next_request_id
	_next_request_id += 1
	_pending_requests[id] = true
	active_session.send_message("devpilot_runtime:request", [id, method, params])
	var duration_ms := int(params.get("duration_ms", 0))
	if method == "input.run_sequence":
		for step in params.get("sequence", []):
			if typeof(step) == TYPE_DICTIONARY:
				duration_ms += int(step.get("duration_ms", 0))
	var deadline := Time.get_ticks_msec() + maxi(3000, duration_ms + 3000)
	while Time.get_ticks_msec() < deadline:
		if _responses.has(id):
			var result: Dictionary = _responses[id]
			_responses.erase(id)
			_pending_requests.erase(id)
			return result
		if not active_session.is_active():
			break
		await Engine.get_main_loop().process_frame
	_pending_requests.erase(id)
	return {"ok": false, "error": {"code": "RUNTIME_BRIDGE_TIMEOUT", "message": "The running game did not respond to the GodoPilot request.", "details": {"method": method}, "suggestions": ["Reinstall GodoPilot so its runtime autoload is active, then restart the Godot editor."]}}


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
