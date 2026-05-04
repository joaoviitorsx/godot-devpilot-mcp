extends SceneTree

const Permissions = preload("res://addons/godot_devpilot_mcp/core/permissions.gd")

var failures := 0


func _initialize() -> void:
	_assert_equal(Permissions.is_res_path_allowed("res://scripts/Player.gd"), true, "allows safe res path")
	_assert_equal(Permissions.is_res_path_allowed("../outside.gd"), false, "blocks relative traversal")
	_assert_equal(Permissions.is_res_path_allowed("res://../outside.gd"), false, "blocks res traversal")
	_assert_equal(Permissions.is_res_path_allowed("/tmp/outside.gd"), false, "blocks absolute path")
	_assert_equal(Permissions.is_res_path_allowed("file:///etc/passwd"), false, "blocks file URI")
	_assert_equal(Permissions.is_tool_allowed_in_read_only("godot_health_check"), true, "allows read-only tool")
	_assert_equal(Permissions.is_tool_allowed_in_read_only("godot_audit_scene"), true, "allows phase 4 read-only tool")
	_assert_equal(Permissions.is_tool_allowed_in_read_only("godot_write_file"), false, "blocks mutable tool")

	var error: Dictionary = Permissions.path_error("res://../outside.gd")
	_assert_equal(error.get("code"), "PATH_OUTSIDE_PROJECT", "returns path error code")

	quit(1 if failures > 0 else 0)


func _assert_equal(actual: Variant, expected: Variant, label: String) -> void:
	if actual != expected:
		failures += 1
		push_error("%s: expected %s, got %s" % [label, str(expected), str(actual)])
