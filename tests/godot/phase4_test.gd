@tool
extends SceneTree

const Dispatcher = preload("res://addons/godot_devpilot_mcp/core/dispatcher.gd")

var _passed := 0
var _failed := 0


func _initialize() -> void:
	var d := Dispatcher.new()
	d.setup(null, null)  # headless: no editor_interface, no undo_redo

	await _test_scene_get_tree_no_editor(d)
	await _test_scene_get_summary_no_editor(d)
	await _test_scene_validate_no_editor(d)
	await _test_scene_audit_no_editor(d)
	await _test_scene_create_no_editor(d)
	await _test_scene_open_no_editor(d)
	await _test_scene_save_no_editor(d)
	await _test_scene_duplicate_no_editor(d)
	await _test_node_add_no_editor(d)
	await _test_node_remove_no_editor(d)
	await _test_node_rename_no_editor(d)
	await _test_node_duplicate_no_editor(d)
	await _test_node_reparent_no_editor(d)
	await _test_node_get_properties_no_editor(d)
	await _test_node_set_property_no_editor(d)
	await _test_node_get_groups_no_editor(d)
	await _test_node_add_to_group_no_editor(d)
	await _test_node_remove_from_group_no_editor(d)

	print("\n[Phase 4 Tests] %d passed, %d failed." % [_passed, _failed])
	quit(1 if _failed > 0 else 0)


func _assert_error_code(label: String, result: Dictionary, expected_code: String) -> void:
	var ok: bool = result.get("ok", true) == false
	var code: String = ""
	if result.has("error"):
		code = str(result["error"].get("code", ""))
	if ok and code == expected_code:
		_passed += 1
		print("[PASS] %s" % label)
	else:
		_failed += 1
		print("[FAIL] %s — expected error %s, got: %s" % [label, expected_code, result])


func _assert_success(label: String, result: Dictionary) -> void:
	if result.get("ok", false):
		_passed += 1
		print("[PASS] %s" % label)
	else:
		_failed += 1
		print("[FAIL] %s — expected ok=true, got: %s" % [label, result])


func _dispatch(d: Dispatcher, method: String, params: Dictionary = {}) -> Dictionary:
	var request := {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
	var envelope := await d.dispatch(request)
	if envelope.has("result"):
		return envelope["result"]
	if envelope.has("error"):
		return {"ok": false, "error": envelope["error"]}
	return {}


# ── Scene tools (all require editor → EDITOR_NOT_AVAILABLE headless) ──────────

func _test_scene_get_tree_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "scene.get_tree")
	_assert_error_code("scene.get_tree → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_scene_get_summary_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "scene.get_summary")
	_assert_error_code("scene.get_summary → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_scene_validate_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "scene.validate")
	_assert_error_code("scene.validate no path → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_scene_audit_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "scene.audit")
	_assert_error_code("scene.audit → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_scene_create_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "scene.create", {"path": "res://test.tscn"})
	_assert_error_code("scene.create → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_scene_open_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "scene.open", {"path": "res://test.tscn"})
	_assert_error_code("scene.open → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_scene_save_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "scene.save")
	_assert_error_code("scene.save → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_scene_duplicate_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "scene.duplicate", {"source": "res://a.tscn", "destination": "res://b.tscn"})
	_assert_error_code("scene.duplicate → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


# ── Node tools (all require editor → EDITOR_NOT_AVAILABLE headless) ───────────

func _test_node_add_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.add", {"node_type": "Node2D"})
	_assert_error_code("node.add → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_remove_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.remove", {"node_path": "Player"})
	_assert_error_code("node.remove → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_rename_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.rename", {"node_path": "Player", "new_name": "Hero"})
	_assert_error_code("node.rename → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_duplicate_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.duplicate", {"node_path": "Player"})
	_assert_error_code("node.duplicate → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_reparent_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.reparent", {"node_path": "Player", "new_parent_path": "."})
	_assert_error_code("node.reparent → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_get_properties_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.get_properties", {"node_path": "."})
	_assert_error_code("node.get_properties → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_set_property_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.set_property", {"node_path": ".", "property": "visible", "value": true})
	_assert_error_code("node.set_property → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_get_groups_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.get_groups", {"node_path": "."})
	_assert_error_code("node.get_groups → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_add_to_group_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.add_to_group", {"node_path": ".", "group": "test"})
	_assert_error_code("node.add_to_group → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")


func _test_node_remove_from_group_no_editor(d: Dispatcher) -> void:
	var r := await _dispatch(d, "node.remove_from_group", {"node_path": ".", "group": "test"})
	_assert_error_code("node.remove_from_group → EDITOR_NOT_AVAILABLE", r, "EDITOR_NOT_AVAILABLE")
