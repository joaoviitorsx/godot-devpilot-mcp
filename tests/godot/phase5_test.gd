@tool
extends SceneTree

const Dispatcher = preload("res://addons/godot_devpilot_mcp/core/dispatcher.gd")

var _passed := 0
var _failed := 0
var _invalid_path := "res://phase5_tmp_invalid.gd"
var _warning_path := "res://phase5_tmp_warning.gd"


func _initialize() -> void:
	_write_file(_invalid_path, "extends Node\nfunc broken()\n\tpass\n")
	_write_file(_warning_path, "extends KinematicBody2D\nexport(int) var speed = 10\nonready var sprite = $Sprite2D\n")

	var d := Dispatcher.new()
	d.setup(null, null)

	await _test_validate_script_structured_error(d)
	await _test_validate_script_godot3_warnings(d)
	await _test_classdb_info(d)
	await _test_attach_no_editor(d)

	DirAccess.remove_absolute(ProjectSettings.globalize_path(_invalid_path))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(_warning_path))

	print("\n[Phase 5 Tests] %d passed, %d failed." % [_passed, _failed])
	quit(1 if _failed > 0 else 0)


func _dispatch(d: Dispatcher, method: String, params: Dictionary = {}) -> Dictionary:
	var request := {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
	var envelope := await d.dispatch(request)
	if envelope.has("result"):
		return envelope["result"]
	if envelope.has("error"):
		return {"ok": false, "error": envelope["error"]}
	return {}


func _test_validate_script_structured_error(d: Dispatcher) -> void:
	var r := await _dispatch(d, "script.validate", {"path": _invalid_path, "godot_version_target": "4.x"})
	_assert_equal(r.get("ok", false), true, "script.validate invalid ok envelope")
	_assert_equal(r["data"].get("valid"), false, "script.validate detects invalid syntax")
	_assert_equal(r["data"]["errors"][0].get("file"), _invalid_path, "script.validate error has file")
	_assert_equal(r["data"]["errors"][0].get("line"), 2, "script.validate error has line")
	_assert_equal(r["data"]["errors"][0].has("column"), true, "script.validate error has column")
	_assert_equal(r["data"]["errors"][0].has("message"), true, "script.validate error has message")


func _test_validate_script_godot3_warnings(d: Dispatcher) -> void:
	var r := await _dispatch(d, "script.validate", {"path": _warning_path, "godot_version_target": "4.x"})
	_assert_equal(r.get("ok", false), true, "script.validate warning ok envelope")
	_assert_equal(r["data"].get("valid"), true, "script.validate warnings do not invalidate")
	_assert_equal(r["data"]["warnings"].size() >= 3, true, "script.validate detects Godot 3 patterns")


func _test_classdb_info(d: Dispatcher) -> void:
	var r := await _dispatch(d, "script.get_classdb_info", {"class_name": "CharacterBody2D"})
	_assert_equal(r.get("ok", false), true, "script.get_classdb_info ok")
	_assert_equal(r["data"].get("exists"), true, "ClassDB class exists")
	_assert_equal(r["data"].get("can_instantiate"), true, "ClassDB can instantiate")


func _test_attach_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "script.attach", {"node_path": "Player", "script_path": _warning_path})
	_assert_equal(r.get("ok", true), false, "script.attach requires editor")
	_assert_equal(r["error"].get("code"), "EDITOR_NOT_AVAILABLE", "script.attach no editor code")


func _write_file(path: String, content: String) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(content)
	file.close()


func _assert_equal(actual: Variant, expected: Variant, label: String) -> void:
	if actual == expected:
		_passed += 1
		print("[PASS] %s" % label)
	else:
		_failed += 1
		print("[FAIL] %s — expected %s, got: %s" % [label, str(expected), str(actual)])
