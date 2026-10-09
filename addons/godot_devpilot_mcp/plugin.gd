@tool
extends EditorPlugin

const RpcServer = preload("res://addons/godot_devpilot_mcp/core/rpc_server.gd")
const RuntimeCapture = preload("res://addons/godot_devpilot_mcp/core/runtime_capture.gd")

var rpc_server
var _runtime_capture


func _enter_tree() -> void:
	rpc_server = RpcServer.new()
	rpc_server.setup(get_editor_interface(), get_undo_redo())

	var port := int(ProjectSettings.get_setting("godot_devpilot_mcp/server/port", 6505))
	var host := str(ProjectSettings.get_setting("godot_devpilot_mcp/server/host", "127.0.0.1"))
	rpc_server.start(port, host)
	set_process(true)

	# Hook runtime debugger to capture errors/output from the running scene.
	if rpc_server and rpc_server.has_method("get_debug_tools"):
		var debug_tools = rpc_server.get_debug_tools()
		if debug_tools:
			_runtime_capture = RuntimeCapture.new()
			_runtime_capture.event_sink = Callable(debug_tools, "append_runtime_event")
			add_debugger_plugin(_runtime_capture)


func _exit_tree() -> void:
	set_process(false)
	if _runtime_capture:
		remove_debugger_plugin(_runtime_capture)
		_runtime_capture = null
	if rpc_server:
		rpc_server.stop()
		rpc_server = null


func _process(_delta: float) -> void:
	if rpc_server:
		rpc_server.poll()
