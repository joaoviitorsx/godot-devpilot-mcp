@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")
const API_PATH := "res://addons/better-tile-editor/BetterTileEditor.gd"
const PLUGIN_CONFIG := "res://addons/better-tile-editor/plugin.cfg"

var _editor_interface


func setup(editor_interface) -> void:
	_editor_interface = editor_interface


func _valid_file_path(value: String) -> bool:
	if not value.begins_with("res://") or value.contains("\\") or value.substr(6).contains(":"):
		return false
	for component in value.substr(6).split("/"):
		if component.is_empty() or component == "." or component == "..":
			return false
	return true


func _api():
	if not FileAccess.file_exists(API_PATH):
		return null
	return load(API_PATH)


func status(_params: Dictionary) -> Dictionary:
	var installed := FileAccess.file_exists(API_PATH)
	var cfg := ConfigFile.new()
	var version := ""
	if cfg.load(PLUGIN_CONFIG) == OK:
		version = str(cfg.get_value("plugin", "version", ""))
	var enabled_plugins: PackedStringArray = ProjectSettings.get_setting("editor_plugins/enabled", PackedStringArray())
	return ResponseFactory.success({
		"installed": installed,
		"enabled": enabled_plugins.has(PLUGIN_CONFIG),
		"version": version,
		"godot_version": Engine.get_version_info().get("string", ""),
		"api_path": API_PATH
	}, "Better Tile Editor status loaded.")


func _layer(params: Dictionary):
	if _editor_interface == null:
		return ResponseFactory.error("EDITOR_NOT_AVAILABLE", "Open the project in the Godot editor.")
	var root: Node = _editor_interface.get_edited_scene_root()
	if root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "Open a scene containing a TileMapLayer.")
	var node_path := str(params.get("node_path", "."))
	var node: Node = root if node_path == "." else root.get_node_or_null(node_path)
	if not node is TileMapLayer:
		return ResponseFactory.error("INVALID_NODE_TYPE", "node_path must select a TileMapLayer.", {"node_path": node_path})
	if node.tile_set == null:
		return ResponseFactory.error("TILESET_MISSING", "Assign a TileSet to the TileMapLayer first.")
	return node


func _required_api():
	var api = _api()
	if api == null:
		return ResponseFactory.error("BETTER_TILE_EDITOR_MISSING", "Install Better Tile Editor under addons/better-tile-editor/ and enable it in Project Settings.")
	return api


func list_terrains(params: Dictionary) -> Dictionary:
	var api = _required_api()
	if api is Dictionary:
		return api
	var layer = _layer(params)
	if layer is Dictionary:
		return layer
	var count: int = int(api.call("terrain_count", layer.tile_set))
	var terrains: Array = []
	for index in count:
		var terrain: Dictionary = api.call("get_terrain", layer.tile_set, index)
		terrains.append({
			"id": index,
			"name": str(terrain.get("name", "")),
			"type": int(terrain.get("type", -1)),
			"group": str(terrain.get("group", "")),
			"color": str(terrain.get("color", Color.WHITE)),
			"valid": bool(terrain.get("valid", false))
		})
	var scene_root: Node = _editor_interface.get_edited_scene_root()
	return ResponseFactory.success({
		"terrains": terrains,
		"count": count,
		"tile_set_path": layer.tile_set.resource_path,
		"scene_path": scene_root.scene_file_path
	}, "Terrains listed.")


func _save_tileset(layer: TileMapLayer) -> Dictionary:
	var tile_set_path: String = layer.tile_set.resource_path
	if tile_set_path.begins_with("res://") and tile_set_path.ends_with(".tres"):
		var err := ResourceSaver.save(layer.tile_set, tile_set_path)
		if err != OK:
			return ResponseFactory.error("SAVE_FAILED", "Could not save the TileSet resource.", {"error": err})
	else:
		_editor_interface.save_scene()
	return {}


func create_terrain(params: Dictionary) -> Dictionary:
	var api = _required_api()
	if api is Dictionary:
		return api
	var layer = _layer(params)
	if layer is Dictionary:
		return layer
	var name := str(params.get("name", ""))
	var terrain_type: int = int(params.get("terrain_type", 0))
	if name.is_empty() or not [0, 1, 2, 7].has(terrain_type):
		return ResponseFactory.error("INVALID_PARAMS", "Provide a terrain name and type 0 (tiles), 1 (vertices), 2 (category), or 7 (single).")
	var color := Color.html(str(params.get("color", "#7cc86b")))
	var index: int = int(api.call("terrain_count", layer.tile_set))
	if not bool(api.call("add_terrain", layer.tile_set, name, color, terrain_type)):
		return ResponseFactory.error("TERRAIN_CREATE_FAILED", "Better Tile Editor rejected the terrain definition.")
	var saved := _save_tileset(layer)
	if not saved.is_empty():
		return saved
	return ResponseFactory.success({"terrain_id": index, "name": name, "type": terrain_type}, "Terrain created. Assign atlas tiles before painting.")


func assign_tile(params: Dictionary) -> Dictionary:
	var api = _required_api()
	if api is Dictionary:
		return api
	var layer = _layer(params)
	if layer is Dictionary:
		return layer
	var terrain_id: int = int(params.get("terrain_id", -1))
	if terrain_id < 0 or terrain_id >= int(api.call("terrain_count", layer.tile_set)):
		return ResponseFactory.error("INVALID_TERRAIN", "terrain_id does not exist in this TileSet.")
	var source_id: int = int(params.get("source_id", 0))
	if not layer.tile_set.has_source(source_id):
		return ResponseFactory.error("INVALID_SOURCE", "source_id does not exist in this TileSet.")
	var source = layer.tile_set.get_source(source_id)
	if not source is TileSetAtlasSource:
		return ResponseFactory.error("INVALID_SOURCE", "source_id must reference a TileSetAtlasSource.")
	var coords := Vector2i(int(params.get("atlas_x", 0)), int(params.get("atlas_y", 0)))
	if not source.has_tile(coords):
		return ResponseFactory.error("TILE_NOT_FOUND", "No atlas tile exists at the requested coordinates.")
	var alternative: int = int(params.get("alternative", 0))
	if not source.has_alternative_tile(coords, alternative):
		return ResponseFactory.error("TILE_NOT_FOUND", "No alternative tile exists at the requested coordinates.")
	var data: TileData = source.get_tile_data(coords, alternative)
	if not bool(api.call("set_tile_terrain_type", layer.tile_set, data, terrain_id)):
		return ResponseFactory.error("ASSIGN_FAILED", "Could not assign the tile to the terrain.")
	var saved := _save_tileset(layer)
	if not saved.is_empty():
		return saved
	return ResponseFactory.success({"terrain_id": terrain_id, "source_id": source_id, "atlas": [coords.x, coords.y]}, "Atlas tile assigned to terrain.")


func paint_terrain(params: Dictionary) -> Dictionary:
	var api = _required_api()
	if api is Dictionary:
		return api
	var layer = _layer(params)
	if layer is Dictionary:
		return layer
	var terrain_id: int = int(params.get("terrain_id", -1))
	if terrain_id < 0 or terrain_id >= int(api.call("terrain_count", layer.tile_set)):
		return ResponseFactory.error("INVALID_TERRAIN", "terrain_id does not exist in this TileSet.")
	var raw_cells: Array = params.get("cells", [])
	if raw_cells.is_empty() or raw_cells.size() > 10000:
		return ResponseFactory.error("INVALID_PARAMS", "cells must contain 1 to 10000 coordinates.")
	var cells: Array[Vector2i] = []
	for entry in raw_cells:
		if not entry is Dictionary:
			return ResponseFactory.error("INVALID_PARAMS", "Each cell must have integer x and y fields.")
		cells.append(Vector2i(int(entry.get("x", 0)), int(entry.get("y", 0))))
	if not bool(api.call("set_cells", layer, cells, terrain_id)):
		return ResponseFactory.error("PAINT_FAILED", "Better Tile Editor could not place these terrain cells. Assign atlas tiles to the terrain first.")
	if bool(params.get("update_neighbors", true)):
		api.call("update_terrain_cells", layer, cells, true)
	_editor_interface.save_scene()
	return ResponseFactory.success({"terrain_id": terrain_id, "painted": cells.size()}, "Terrain cells painted and scene saved.")


func create_atlas(params: Dictionary) -> Dictionary:
	var texture_path := str(params.get("texture_path", ""))
	var tileset_path := str(params.get("tileset_path", ""))
	if not _valid_file_path(texture_path) or not _valid_file_path(tileset_path) or not tileset_path.ends_with(".tres"):
		return ResponseFactory.error("INVALID_PARAMS", "Use project-local res:// texture and .tres paths.")
	if FileAccess.file_exists(tileset_path) and not bool(params.get("overwrite", false)):
		return ResponseFactory.error("FILE_ALREADY_EXISTS", "TileSet already exists. Set overwrite=true to replace it.")
	var texture: Texture2D = load(texture_path) as Texture2D
	if texture == null:
		return ResponseFactory.error("TEXTURE_NOT_FOUND", "texture_path must reference an imported Texture2D.")
	var width: int = int(params.get("tile_width", 16))
	var height: int = int(params.get("tile_height", 16))
	if width < 1 or height < 1:
		return ResponseFactory.error("INVALID_PARAMS", "Tile dimensions must be positive.")
	var columns: int = int(texture.get_width() / width)
	var rows: int = int(texture.get_height() / height)
	if columns < 1 or rows < 1 or columns * rows > 4096:
		return ResponseFactory.error("INVALID_PARAMS", "Texture must contain 1 to 4096 tiles of the requested size.")
	var tile_set := TileSet.new()
	tile_set.tile_size = Vector2i(width, height)
	var atlas := TileSetAtlasSource.new()
	atlas.texture = texture
	atlas.texture_region_size = Vector2i(width, height)
	for y in rows:
		for x in columns:
			atlas.create_tile(Vector2i(x, y))
	tile_set.add_source(atlas, 0)
	var absolute := ProjectSettings.globalize_path(tileset_path)
	var dir_error := DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	if dir_error != OK:
		return ResponseFactory.error("WRITE_ERROR", "Could not create the TileSet directory.", {"error": dir_error})
	var save_error := ResourceSaver.save(tile_set, tileset_path)
	if save_error != OK:
		return ResponseFactory.error("SAVE_FAILED", "Could not save the TileSet.", {"error": save_error})
	return ResponseFactory.success({"tileset_path": tileset_path, "source_id": 0, "columns": columns, "rows": rows, "tile_count": columns * rows}, "TileSet atlas created from texture.")
