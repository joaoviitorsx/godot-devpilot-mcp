@tool
extends RefCounted

const READ_ONLY_TOOL_ALLOWLIST := {
	"godot_health_check": true,
	"godot_ping": true,
	"godot_get_capabilities": true,
	"godot_get_connection_status": true,
	"godot_get_protocol_version": true,
	"godot_read_file": true,
	"godot_list_files": true,
	"godot_get_project_info": true,
	"godot_get_scene_tree": true,
	"godot_get_scene_summary": true,
	"godot_validate_scene": true,
	"godot_audit_scene": true,
	"godot_get_node_properties": true,
	"godot_get_node_groups": true,
	"godot_read_script": true,
	"godot_validate_script": true,
	"godot_get_classdb_info": true,
	"godot_get_script_symbols": true,
	"godot_get_script_dependencies": true,
	"godot_find_references": true
}


static func is_res_path_allowed(input_path: String) -> bool:
	var path := input_path.strip_edges()

	if path.is_empty():
		return false

	if _has_unsupported_uri_scheme(path):
		return false

	if path.begins_with("/") or _is_windows_absolute_path(path):
		return false

	if not path.begins_with("res://"):
		return false

	var relative_path := path.substr("res://".length()).replace("\\", "/")
	if relative_path.is_empty() or relative_path.begins_with("/"):
		return false

	for segment in relative_path.split("/", true):
		if segment == "..":
			return false

	var normalized_path := relative_path.simplify_path()
	if normalized_path == "." or normalized_path == "..":
		return false

	if normalized_path.begins_with("../") or normalized_path.contains("/../"):
		return false

	return true


static func is_tool_allowed_in_read_only(tool_name: String) -> bool:
	return READ_ONLY_TOOL_ALLOWLIST.has(tool_name)


static func path_error(input_path: String) -> Dictionary:
	return {
		"code": "PATH_OUTSIDE_PROJECT",
		"message": "Path is outside the Godot project sandbox.",
		"details": {
			"path": input_path
		},
		"suggestions": [
			"Use a res:// path that stays inside the active Godot project."
		]
	}


static func read_only_error(tool_name: String) -> Dictionary:
	return {
		"code": "READ_ONLY_MODE",
		"message": "Tool is blocked because read-only mode is enabled.",
		"details": {
			"tool": tool_name
		},
		"suggestions": [
			"Switch out of read-only mode only when write operations are intentional."
		]
	}


static func _has_unsupported_uri_scheme(input_path: String) -> bool:
	var scheme_index := input_path.find("://")
	return scheme_index > 0 and not input_path.begins_with("res://")


static func _is_windows_absolute_path(input_path: String) -> bool:
	if input_path.length() < 3:
		return false

	var drive := input_path.substr(0, 1)
	var prefix := input_path.substr(1, 2)
	var letters := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

	return letters.contains(drive) and (prefix == ":\\" or prefix == ":/")
