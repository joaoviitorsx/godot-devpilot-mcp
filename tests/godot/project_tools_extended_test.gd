@tool
extends SceneTree

const Dispatcher = preload("res://addons/godot_devpilot_mcp/core/dispatcher.gd")

var _pass := 0
var _fail := 0


func _initialize() -> void:
	var d := Dispatcher.new()

	await _test_project_settings(d)
	await _test_get_input_map(d)
	await _test_add_remove_input_action(d)
	await _test_get_autoloads(d)
	await _test_add_remove_autoload(d)
	await _test_open_scenes_headless(d)
	await _test_selected_nodes_headless(d)

	print("project_tools_extended_test: %d passed, %d failed" % [_pass, _fail])
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


func _dispatch(d: Dispatcher, method: String, params: Dictionary = {}) -> Dictionary:
	return await d.dispatch({"jsonrpc": "2.0", "id": method, "method": method, "params": params})


func _result(res: Dictionary) -> Dictionary:
	if res.has("result") and typeof(res["result"]) == TYPE_DICTIONARY:
		return res["result"]
	return {}


func _test_project_settings(d: Dispatcher) -> void:
	print("project.get_project_settings")
	var res := _result(await _dispatch(d, "project.get_project_settings"))
	_assert("ok=true", res.get("ok") == true)
	var data: Dictionary = res.get("data", {})
	_assert("has application section", data.has("application"))
	_assert("has display section", data.has("display"))
	_assert("has physics section", data.has("physics"))


func _test_get_input_map(d: Dispatcher) -> void:
	print("project.get_input_map")
	var res := _result(await _dispatch(d, "project.get_input_map"))
	_assert("ok=true", res.get("ok") == true)
	var data: Dictionary = res.get("data", {})
	_assert("has actions array", data.has("actions"))
	_assert("has count", data.has("count"))


func _test_add_remove_input_action(d: Dispatcher) -> void:
	print("project.add_input_action / project.remove_input_action")
	var action := "test_mcp_action_" + str(randi())

	var add_res := _result(await _dispatch(d, "project.add_input_action", {"action_name": action, "deadzone": 0.3}))
	_assert("add ok=true", add_res.get("ok") == true)
	_assert("add has action_name", add_res.get("data", {}).get("action_name") == action)
	_assert("action registered in InputMap", InputMap.has_action(action))

	var dup_res := _result(await _dispatch(d, "project.add_input_action", {"action_name": action}))
	_assert("duplicate returns ACTION_ALREADY_EXISTS", dup_res.get("error", {}).get("code") == "ACTION_ALREADY_EXISTS")

	var remove_res := _result(await _dispatch(d, "project.remove_input_action", {"action_name": action}))
	_assert("remove ok=true", remove_res.get("ok") == true)
	_assert("action removed from InputMap", not InputMap.has_action(action))

	var missing_res := _result(await _dispatch(d, "project.remove_input_action", {"action_name": action}))
	_assert("remove missing returns ACTION_NOT_FOUND", missing_res.get("error", {}).get("code") == "ACTION_NOT_FOUND")


func _test_get_autoloads(d: Dispatcher) -> void:
	print("project.get_autoloads")
	var res := _result(await _dispatch(d, "project.get_autoloads"))
	_assert("ok=true", res.get("ok") == true)
	var data: Dictionary = res.get("data", {})
	_assert("has autoloads array", data.has("autoloads"))
	_assert("has count", data.has("count"))


func _test_add_remove_autoload(d: Dispatcher) -> void:
	print("project.add_autoload / project.remove_autoload")
	var name := "TestSingleton" + str(randi())
	var singleton_path := "res://addons/godot_devpilot_mcp/plugin.gd"

	var add_res := _result(await _dispatch(d, "project.add_autoload", {"name": name, "path": singleton_path}))
	_assert("add ok=true", add_res.get("ok") == true)
	_assert("setting persisted", ProjectSettings.has_setting("autoload/" + name))

	var dup_res := _result(await _dispatch(d, "project.add_autoload", {"name": name, "path": singleton_path}))
	_assert("duplicate returns AUTOLOAD_ALREADY_EXISTS", dup_res.get("error", {}).get("code") == "AUTOLOAD_ALREADY_EXISTS")

	var remove_res := _result(await _dispatch(d, "project.remove_autoload", {"name": name}))
	_assert("remove ok=true", remove_res.get("ok") == true)

	var missing_res := _result(await _dispatch(d, "project.remove_autoload", {"name": name}))
	_assert("remove missing returns AUTOLOAD_NOT_FOUND", missing_res.get("error", {}).get("code") == "AUTOLOAD_NOT_FOUND")


func _test_open_scenes_headless(d: Dispatcher) -> void:
	print("project.get_open_scenes (headless — EDITOR_NOT_AVAILABLE)")
	var res := _result(await _dispatch(d, "project.get_open_scenes"))
	_assert("returns ok=false in headless", res.get("ok") == false)
	_assert("error code EDITOR_NOT_AVAILABLE", res.get("error", {}).get("code") == "EDITOR_NOT_AVAILABLE")


func _test_selected_nodes_headless(d: Dispatcher) -> void:
	print("project.get_selected_nodes (headless — EDITOR_NOT_AVAILABLE)")
	var res := _result(await _dispatch(d, "project.get_selected_nodes"))
	_assert("returns ok=false in headless", res.get("ok") == false)
	_assert("error code EDITOR_NOT_AVAILABLE", res.get("error", {}).get("code") == "EDITOR_NOT_AVAILABLE")
