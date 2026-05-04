@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")


static func validate_request(request: Variant) -> Dictionary:
	if typeof(request) != TYPE_DICTIONARY:
		return ResponseFactory.error(
			"INVALID_PARAMS",
			"JSON-RPC request must be an object.",
			{},
			["Send a JSON-RPC 2.0 object with id, method and params."]
		)

	if request.get("jsonrpc") != "2.0":
		return ResponseFactory.error(
			"INVALID_PARAMS",
			"Invalid JSON-RPC version.",
			{ "jsonrpc": request.get("jsonrpc") },
			["Use jsonrpc: \"2.0\"."]
		)

	if not request.has("id"):
		return ResponseFactory.error(
			"INVALID_PARAMS",
			"JSON-RPC request is missing id.",
			{},
			["Include a stable request id."]
		)

	if typeof(request.get("method")) != TYPE_STRING or request.get("method").strip_edges().is_empty():
		return ResponseFactory.error(
			"INVALID_PARAMS",
			"JSON-RPC request is missing method.",
			{},
			["Use a supported method such as system.health_check."]
		)

	if request.has("params") and typeof(request.get("params")) != TYPE_DICTIONARY:
		return ResponseFactory.error(
			"INVALID_PARAMS",
			"JSON-RPC params must be an object.",
			{ "method": request.get("method") },
			["Send params as an object, or omit it."]
		)

	return ResponseFactory.success({}, "Request is valid.")


static func success_envelope(id: Variant, result: Dictionary) -> Dictionary:
	return {
		"jsonrpc": "2.0",
		"id": id,
		"result": result
	}


static func error_envelope(id: Variant, error: Dictionary) -> Dictionary:
	return {
		"jsonrpc": "2.0",
		"id": id,
		"error": error
	}
