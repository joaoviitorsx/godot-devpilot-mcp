@tool
extends RefCounted


static func success(data: Variant = {}, message: String = "Operation completed successfully.", warnings: Array = [], suggestions: Array = []) -> Dictionary:
	return {
		"ok": true,
		"data": data,
		"message": message,
		"warnings": warnings,
		"suggestions": suggestions
	}


static func error(code: String, message: String, details: Dictionary = {}, suggestions: Array = []) -> Dictionary:
	return {
		"ok": false,
		"error": {
			"code": code,
			"message": message,
			"details": details,
			"suggestions": suggestions
		}
	}
