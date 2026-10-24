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
var _auth_token := ""
const MAX_CLIENTS := 8
const MAX_REQUEST_BYTES := 4194304


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
	if host != "127.0.0.1" and host != "::1" and host != "localhost":
		return ResponseFactory.error("INVALID_PARAMS", "The editor bridge must bind to loopback.", { "host": host }, [])
	var error_code := tcp_server.listen(port, host)
	if error_code != OK:
		return ResponseFactory.error(
			"CONNECTION_FAILED",
			"Could not start the Godot DevPilot MCP WebSocket server.",
			{ "host": host, "port": port, "error": error_code },
			["Check if the port is already in use."]
		)
	var token_result := _prepare_auth_token()
	if not token_result.get("ok", false):
		tcp_server.stop()
		return token_result

	running = true
	print("[Godot DevPilot MCP] WebSocket listening on %s:%d" % [host, port])
	return ResponseFactory.success({ "host": host, "port": port }, "RPC server started.")


func _prepare_auth_token() -> Dictionary:
	var token_dir := ProjectSettings.globalize_path("res://.godot_mcp")
	var project_dir := DirAccess.open(ProjectSettings.globalize_path("res://"))
	if project_dir == null or project_dir.is_link(".godot_mcp"):
		return ResponseFactory.error("CONNECTION_FAILED", "Bridge token directory is not safe.", {}, [])
	if DirAccess.make_dir_recursive_absolute(token_dir) != OK:
		return ResponseFactory.error("CONNECTION_FAILED", "Could not create token directory.", {}, [])
	var token_dir_access := DirAccess.open(token_dir)
	if token_dir_access == null or token_dir_access.is_link("bridge-token"):
		return ResponseFactory.error("CONNECTION_FAILED", "Bridge token path is not safe.", {}, [])
	_auth_token = Crypto.new().generate_random_bytes(32).hex_encode()
	var token_path := token_dir.path_join("bridge-token")
	var token_file := FileAccess.open(token_path, FileAccess.WRITE)
	if token_file == null:
		return ResponseFactory.error("CONNECTION_FAILED", "Could not write bridge token.", {}, [])
	token_file.store_string(_auth_token)
	token_file.close()
	if OS.get_name() != "Windows":
		var permission_error := FileAccess.set_unix_permissions(token_path, FileAccess.UNIX_READ_OWNER | FileAccess.UNIX_WRITE_OWNER)
		if permission_error != OK:
			return ResponseFactory.error("CONNECTION_FAILED", "Could not restrict bridge token permissions.", {}, [])
	return ResponseFactory.success({}, "Bridge token prepared.")


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
		if peers.size() >= MAX_CLIENTS:
			stream.disconnect_from_host()
			continue
		var peer := WebSocketPeer.new()
		peer.inbound_buffer_size = MAX_REQUEST_BYTES
		peer.max_queued_packets = 32
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
		var packet := peer.get_packet()
		if packet.size() > MAX_REQUEST_BYTES:
			peer.close(1009, "Request too large")
			return
		var raw_message := packet.get_string_from_utf8()
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
	if typeof(parsed) != TYPE_DICTIONARY or typeof(parsed.get("auth")) != TYPE_STRING or not Crypto.new().constant_time_compare(str(parsed["auth"]).to_utf8_buffer(), _auth_token.to_utf8_buffer()):
		return Protocol.error_envelope(
			parsed.get("id") if typeof(parsed) == TYPE_DICTIONARY else null,
			ResponseFactory.error("UNAUTHORIZED", "Invalid editor bridge token.", {}, ["Reconnect the MCP server to this project."])["error"]
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
