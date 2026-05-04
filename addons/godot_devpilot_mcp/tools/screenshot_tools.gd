@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")
const Permissions = preload("res://addons/godot_devpilot_mcp/core/permissions.gd")

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


func _validate_output_path(p: String) -> Dictionary:
	if not Permissions.is_res_path_allowed(p):
		return ResponseFactory.error(
			"PATH_OUTSIDE_PROJECT",
			"Screenshot path is outside the project sandbox.",
			{"path": p},
			["Use a res:// path inside the active Godot project."]
		)
	if not p.ends_with(".png"):
		return ResponseFactory.error(
			"INVALID_PARAMS",
			"Screenshot path must end in .png.",
			{"path": p},
			["Provide an output_path ending in .png."]
		)
	return {}


func _save_image_png(image: Image, res_path: String) -> Dictionary:
	if image == null:
		return ResponseFactory.error(
			"SCREENSHOT_FAILED",
			"Could not capture viewport image.",
			{},
			["Ensure the editor or game viewport is available."]
		)

	var dir_res := res_path.get_base_dir()
	var dir_abs := ProjectSettings.globalize_path(dir_res)
	DirAccess.make_dir_recursive_absolute(dir_abs)

	var err := image.save_png(res_path)
	if err != OK:
		return ResponseFactory.error(
			"SCREENSHOT_FAILED",
			"Could not save screenshot to disk.",
			{"path": res_path, "error_code": err},
			["Verify the directory exists and is writable."]
		)

	return ResponseFactory.success(
		{
			"path": res_path,
			"width": image.get_width(),
			"height": image.get_height()
		},
		"Screenshot saved."
	)


func take_game_screenshot(params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check

	var output_path := str(params.get("output_path", ""))
	var path_check := _validate_output_path(output_path)
	if not path_check.is_empty():
		return path_check

	if not _editor_interface.is_playing_scene():
		return ResponseFactory.error(
			"RUNTIME_NOT_RUNNING",
			"Cannot capture game screenshot: no scene is running.",
			{},
			["Use godot_run_project or godot_run_scene first."]
		)

	# Capture entire screen (best-effort baseline). The running game window is on screen.
	# screen_get_image returns null on Wayland — fall through to viewport fallback.
	var image: Image = null
	if DisplayServer.has_method("screen_get_image"):
		image = DisplayServer.screen_get_image(0)
	if image == null:
		var viewport: Viewport = _editor_interface.get_base_control().get_viewport()
		if viewport != null:
			image = viewport.get_texture().get_image()

	return _save_image_png(image, output_path)


func take_editor_screenshot(params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check

	var output_path := str(params.get("output_path", ""))
	var path_check := _validate_output_path(output_path)
	if not path_check.is_empty():
		return path_check

	var viewport: Viewport = _editor_interface.get_base_control().get_viewport()
	if viewport == null:
		return ResponseFactory.error(
			"SCREENSHOT_FAILED",
			"Editor base control viewport unavailable.",
			{},
			["Ensure the editor window is visible."]
		)

	var image: Image = viewport.get_texture().get_image()
	return _save_image_png(image, output_path)


func get_viewport_image(params: Dictionary) -> Dictionary:
	var check := _require_editor()
	if not check.is_empty():
		return check

	var output_path := str(params.get("output_path", ""))
	var path_check := _validate_output_path(output_path)
	if not path_check.is_empty():
		return path_check

	var edited_root: Node = _editor_interface.get_edited_scene_root()
	var viewport: Viewport = null
	if edited_root != null:
		viewport = edited_root.get_viewport()
	if viewport == null:
		viewport = _editor_interface.get_base_control().get_viewport()
	if viewport == null:
		return ResponseFactory.error(
			"SCREENSHOT_FAILED",
			"No viewport available for the currently edited scene.",
			{},
			["Open a scene first."]
		)

	var image: Image = viewport.get_texture().get_image()
	return _save_image_png(image, output_path)
