@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")

var _editor_interface


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


func _require_running() -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check
	if not _editor_interface.is_playing_scene():
		return ResponseFactory.error(
			"RUNTIME_NOT_RUNNING",
			"Input simulation requires the project to be running.",
			{},
			["Start the project with godot_run_project or godot_run_scene first."]
		)
	return {}


func _resolve_keycode(name: String) -> int:
	# Try OS_KEY_* first, then plain name. Returns Key code or KEY_NONE.
	var upper := name.to_upper()
	if upper.length() == 1 and upper >= "A" and upper <= "Z":
		return OS.find_keycode_from_string(upper)
	var k: int = OS.find_keycode_from_string(name)
	if k != Key.KEY_NONE:
		return k
	return OS.find_keycode_from_string(upper)


func _mouse_button_index(name: String) -> int:
	match name.to_lower():
		"right":
			return MOUSE_BUTTON_RIGHT
		"middle":
			return MOUSE_BUTTON_MIDDLE
		_:
			return MOUSE_BUTTON_LEFT


func _emit_action(action_name: String, pressed: bool) -> Dictionary:
	if not InputMap.has_action(action_name):
		return ResponseFactory.error(
			"INPUT_ACTION_NOT_FOUND",
			"Input action does not exist.",
			{"action": action_name},
			["Use godot_get_input_map to list available actions, or godot_add_input_action to create one."]
		)
	var event := InputEventAction.new()
	event.action = action_name
	event.pressed = pressed
	Input.parse_input_event(event)
	return {}


func _emit_key(keycode_name: String, pressed: bool) -> Dictionary:
	var k: int = _resolve_keycode(keycode_name)
	if k == Key.KEY_NONE:
		return ResponseFactory.error(
			"INVALID_KEYCODE",
			"Unknown keycode name.",
			{"keycode": keycode_name},
			["Use a Godot Key name like 'A', 'Space', 'Enter', 'Escape', or 'F1'."]
		)
	var event := InputEventKey.new()
	event.keycode = k
	event.pressed = pressed
	Input.parse_input_event(event)
	return {}


func _emit_mouse_motion(x: float, y: float) -> void:
	var event := InputEventMouseMotion.new()
	event.position = Vector2(x, y)
	event.global_position = Vector2(x, y)
	Input.parse_input_event(event)


func _emit_mouse_button(x: float, y: float, button: int, pressed: bool) -> void:
	var event := InputEventMouseButton.new()
	event.position = Vector2(x, y)
	event.global_position = Vector2(x, y)
	event.button_index = button
	event.pressed = pressed
	Input.parse_input_event(event)


func press_action(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var action := str(params.get("action", ""))
	var duration_ms := int(params.get("duration_ms", 0))
	if action.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "action is required.", {}, [])

	var press_err := _emit_action(action, true)
	if not press_err.is_empty():
		return press_err

	if duration_ms > 0:
		await Engine.get_main_loop().create_timer(duration_ms / 1000.0).timeout
		_emit_action(action, false)

	return ResponseFactory.success(
		{"action": action, "duration_ms": duration_ms},
		"Action input dispatched."
	)


func release_action(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var action := str(params.get("action", ""))
	if action.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "action is required.", {}, [])
	var err := _emit_action(action, false)
	if not err.is_empty():
		return err
	return ResponseFactory.success({"action": action}, "Action released.")


func press_key(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var keycode := str(params.get("keycode", ""))
	var duration_ms := int(params.get("duration_ms", 0))
	if keycode.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "keycode is required.", {}, [])

	var press_err := _emit_key(keycode, true)
	if not press_err.is_empty():
		return press_err

	if duration_ms > 0:
		await Engine.get_main_loop().create_timer(duration_ms / 1000.0).timeout
		_emit_key(keycode, false)

	return ResponseFactory.success(
		{"keycode": keycode, "duration_ms": duration_ms},
		"Key dispatched."
	)


func release_key(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var keycode := str(params.get("keycode", ""))
	if keycode.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "keycode is required.", {}, [])
	var err := _emit_key(keycode, false)
	if not err.is_empty():
		return err
	return ResponseFactory.success({"keycode": keycode}, "Key released.")


func tap_key(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var keycode := str(params.get("keycode", ""))
	if keycode.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "keycode is required.", {}, [])
	var press_err := _emit_key(keycode, true)
	if not press_err.is_empty():
		return press_err
	_emit_key(keycode, false)
	return ResponseFactory.success({"keycode": keycode}, "Key tapped.")


func mouse_move(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var x := float(params.get("x", 0.0))
	var y := float(params.get("y", 0.0))
	_emit_mouse_motion(x, y)
	return ResponseFactory.success({"x": x, "y": y}, "Mouse moved.")


func mouse_click(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var x := float(params.get("x", 0.0))
	var y := float(params.get("y", 0.0))
	var button_name := str(params.get("button", "left"))
	var button := _mouse_button_index(button_name)
	_emit_mouse_button(x, y, button, true)
	_emit_mouse_button(x, y, button, false)
	return ResponseFactory.success({"x": x, "y": y, "button": button_name}, "Mouse clicked.")


func mouse_drag(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var fx := float(params.get("from_x", 0.0))
	var fy := float(params.get("from_y", 0.0))
	var tx := float(params.get("to_x", 0.0))
	var ty := float(params.get("to_y", 0.0))
	var button_name := str(params.get("button", "left"))
	var button := _mouse_button_index(button_name)

	_emit_mouse_motion(fx, fy)
	_emit_mouse_button(fx, fy, button, true)
	_emit_mouse_motion(tx, ty)
	_emit_mouse_button(tx, ty, button, false)

	return ResponseFactory.success(
		{"from": {"x": fx, "y": fy}, "to": {"x": tx, "y": ty}, "button": button_name},
		"Mouse dragged."
	)


func run_input_sequence(params: Dictionary) -> Dictionary:
	var check := _require_running()
	if not check.is_empty():
		return check
	var sequence: Array = params.get("sequence", [])
	if sequence.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "sequence must contain at least one step.", {}, [])

	var executed: int = 0
	for step in sequence:
		if typeof(step) != TYPE_DICTIONARY:
			continue
		var step_type := str(step.get("type", ""))
		match step_type:
			"action_press":
				var ap_err := _emit_action(str(step.get("action", "")), true)
				if not ap_err.is_empty():
					return ap_err
				var ap_dur := int(step.get("duration_ms", 0))
				if ap_dur > 0:
					await Engine.get_main_loop().create_timer(ap_dur / 1000.0).timeout
					_emit_action(str(step.get("action", "")), false)
			"action_release":
				_emit_action(str(step.get("action", "")), false)
			"key_press":
				var kp_err := _emit_key(str(step.get("keycode", "")), true)
				if not kp_err.is_empty():
					return kp_err
				var kp_dur := int(step.get("duration_ms", 0))
				if kp_dur > 0:
					await Engine.get_main_loop().create_timer(kp_dur / 1000.0).timeout
					_emit_key(str(step.get("keycode", "")), false)
			"key_release":
				_emit_key(str(step.get("keycode", "")), false)
			"key_tap":
				var kt_err := _emit_key(str(step.get("keycode", "")), true)
				if not kt_err.is_empty():
					return kt_err
				_emit_key(str(step.get("keycode", "")), false)
			"mouse_move":
				_emit_mouse_motion(float(step.get("x", 0.0)), float(step.get("y", 0.0)))
			"mouse_click":
				var mc_btn := _mouse_button_index(str(step.get("button", "left")))
				var mx := float(step.get("x", 0.0))
				var my := float(step.get("y", 0.0))
				_emit_mouse_button(mx, my, mc_btn, true)
				_emit_mouse_button(mx, my, mc_btn, false)
			"wait":
				var w_dur := int(step.get("duration_ms", 0))
				if w_dur > 0:
					await Engine.get_main_loop().create_timer(w_dur / 1000.0).timeout
			_:
				return ResponseFactory.error(
					"INVALID_SEQUENCE_STEP",
					"Unknown sequence step type.",
					{"type": step_type},
					["Valid types: action_press, action_release, key_press, key_release, key_tap, mouse_move, mouse_click, wait."]
				)
		executed += 1

	return ResponseFactory.success(
		{"events_executed": executed},
		"Input sequence executed."
	)
