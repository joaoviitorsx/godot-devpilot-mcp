@tool
extends EditorPlugin

const RpcServer = preload("res://addons/godot_devpilot_mcp/core/rpc_server.gd")

var rpc_server


func _enter_tree() -> void:
	rpc_server = RpcServer.new()
	rpc_server.setup(get_editor_interface(), get_undo_redo())

	var port := int(ProjectSettings.get_setting("godot_devpilot_mcp/server/port", 6505))
	var host := str(ProjectSettings.get_setting("godot_devpilot_mcp/server/host", "127.0.0.1"))
	rpc_server.start(port, host)
	set_process(true)


func _exit_tree() -> void:
	set_process(false)
	if rpc_server:
		rpc_server.stop()
		rpc_server = null


func _process(_delta: float) -> void:
	if rpc_server:
		rpc_server.poll()
