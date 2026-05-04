@tool
extends SceneTree

const Dispatcher = preload("res://addons/godot_devpilot_mcp/core/dispatcher.gd")

var _pass := 0
var _fail := 0


func _initialize() -> void:
	var d := Dispatcher.new()

	await _test_project_get_info(d)
	await _test_project_get_editor_context_headless(d)

	print("project_tools_test: %d passed, %d failed" % [_pass, _fail])
	if _fail > 0:
		quit(1)
	else:
		quit(0)


func _assert(label: String, condition: bool) -> void:
	if condition:
		print("  PASS: %s" % label)
		_pass += 1
	else:
		print("  FAIL: %s" % label)
		_fail += 1


func _test_project_get_info(d: Dispatcher) -> void:
	print("project.get_info")
	var req := { "jsonrpc": "2.0", "id": "t1", "method": "project.get_info", "params": {} }
	var res: Dictionary = await d.dispatch(req)

	_assert("returns JSON-RPC envelope", res.has("result") or res.has("error"))

	if res.has("result"):
		var result: Dictionary = res["result"]
		_assert("ok=true", result.get("ok") == true)
		var data: Dictionary = result.get("data", {})
		_assert("has project_name", data.has("project_name"))
		_assert("has project_path", data.has("project_path"))
		_assert("has godot_version", data.has("godot_version"))
		_assert("has plugin_version", data.has("plugin_version"))
	else:
		_assert("project.get_info should not error in headless", false)


func _test_project_get_editor_context_headless(d: Dispatcher) -> void:
	print("project.get_editor_context (headless — editor_interface=null)")
	var req := { "jsonrpc": "2.0", "id": "t2", "method": "project.get_editor_context", "params": {} }
	var res: Dictionary = await d.dispatch(req)

	_assert("returns JSON-RPC envelope", res.has("result") or res.has("error"))

	if res.has("result"):
		var result: Dictionary = res["result"]
		_assert("returns ok=false when no editor_interface", result.get("ok") == false)
		var error: Dictionary = result.get("error", {})
		_assert("error code is EDITOR_NOT_AVAILABLE", error.get("code") == "EDITOR_NOT_AVAILABLE")
