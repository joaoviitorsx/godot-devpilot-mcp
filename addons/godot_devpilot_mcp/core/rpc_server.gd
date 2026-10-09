@tool
extends RefCounted

const Dispatcher = preload("res://addons/godot_devpilot_mcp/core/dispatcher.gd")
const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")
const Protocol = preload("res://addons/godot_devpilot_mcp/core/protocol.gd")

var dispatcher
var tcp_server := TCPServer.new()
var peers: Array[WebSocketPeer] = []
var running := false
var host := "127.0.0.1"
var port := 6505


func setup(editor_interface, undo_redo = null) -> void:
	dispatcher = Dispatcher.new()
	dispatcher.setup(editor_interface, undo_redo)


func get_debug_tools():
	if dispatcher and "_debug_tools" in dispatcher:
		return dispatcher._debug_tools
	return null


func start(p_port: int = 6505, p_host: String = "127.0.0.1") -> Dictionary:
	if running:
		return ResponseFactory.success({ "host": host, "port": port }, "RPC server is already running.")

	host = p_host
	port = p_port

	var error_code := tcp_server.listen(port, host)
	if error_code != OK:
		return ResponseFactory.error(
			"CONNECTION_FAILED",
			"Could not start the Godot DevPilot MCP WebSocket server.",
			{ "host": host, "port": port, "error": error_code },
			["Check if the port is already in use."]
		)

	running = true
	print("[Godot DevPilot MCP] WebSocket listening on %s:%d" % [host, port])
	return ResponseFactory.success({ "host": host, "port": port }, "RPC server started.")


func stop() -> void:
	for peer in peers:
		if peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
			peer.close()

	peers.clear()

	if tcp_server.is_listening():
		tcp_server.stop()

	running = false


func poll() -> void:
	if not running:
		return

	while tcp_server.is_connection_available():
		var stream := tcp_server.take_connection()
		var peer := WebSocketPeer.new()
		var error_code := peer.accept_stream(stream)

		if error_code == OK:
			peers.append(peer)
		else:
			stream.disconnect_from_host()

	for index in range(peers.size() - 1, -1, -1):
		var peer := peers[index]
		peer.poll()

		match peer.get_ready_state():
			WebSocketPeer.STATE_OPEN:
				_process_peer_packets(peer)
			WebSocketPeer.STATE_CLOSING, WebSocketPeer.STATE_CLOSED:
				peers.remove_at(index)


func _process_peer_packets(peer: WebSocketPeer) -> void:
	while peer.get_available_packet_count() > 0:
		var raw_message := peer.get_packet().get_string_from_utf8()
		var response: Dictionary = await _handle_message(raw_message)
		peer.send_text(JSON.stringify(response))


func _handle_message(raw_message: String) -> Dictionary:
	var parsed = JSON.parse_string(raw_message)

	if parsed == null:
		return Protocol.error_envelope(
			null,
			ResponseFactory.error(
				"INVALID_PARAMS",
				"Invalid JSON payload.",
				{},
				["Send a valid JSON-RPC 2.0 request."]
			)["error"]
		)

	if dispatcher == null:
		return Protocol.error_envelope(
			parsed.get("id") if typeof(parsed) == TYPE_DICTIONARY else null,
			ResponseFactory.error(
				"UNKNOWN_ERROR",
				"Dispatcher is not initialized.",
				{},
				["Restart the Godot plugin."]
			)["error"]
		)

	return await dispatcher.dispatch(parsed)
