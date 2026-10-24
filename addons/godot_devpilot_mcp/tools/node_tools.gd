@tool
extends RefCounted

const ResponseFactory = preload("res://addons/godot_devpilot_mcp/core/response_factory.gd")

var _editor_interface
var _undo_service


func setup(p_editor_interface, p_undo_service) -> void:
	_editor_interface = p_editor_interface
	_undo_service = p_undo_service


func _require_editor() -> Dictionary:
	if _editor_interface == null:
		return ResponseFactory.error(
			"EDITOR_NOT_AVAILABLE",
			"Editor interface is not available.",
			{},
			["Ensure the plugin is loaded in the Godot editor (not headless)."]
		)
	return {}


func _require_scene_root():
	if _editor_interface == null:
		return null
	return _editor_interface.get_edited_scene_root()


func _resolve_node(scene_root: Node, path: String) -> Node:
	if path == "." or path.is_empty():
		return scene_root
	return scene_root.get_node_or_null(path)


func _require_undo_redo(tool_name: String) -> Dictionary:
	if _undo_service == null or not _undo_service.has_undo_redo():
		return ResponseFactory.error(
			"UNDO_FAILED",
			"Could not register the action in UndoRedo. Mutation was cancelled.",
			{"tool": tool_name},
			["Run this operation inside the Godot editor with UndoRedo available."]
		)
	return {}


# ── Node mutations ────────────────────────────────────────────────────────────

func add_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_add_node")
	if not undo_check.is_empty():
		return undo_check

	var node_type: String = str(params.get("node_type", "Node"))
	var node_name: String = str(params.get("node_name", node_type))
	var parent_path: String = str(params.get("parent_path", "."))
	var properties: Dictionary = params.get("properties", {})

	if not ClassDB.can_instantiate(node_type):
		return ResponseFactory.error(
			"INVALID_NODE_TYPE",
			"Node type '%s' cannot be instantiated." % node_type,
			{"node_type": node_type},
			["Check ClassDB for valid instantiable node types."]
		)

	var parent := _resolve_node(scene_root, parent_path)
	if parent == null:
		return ResponseFactory.error(
			"NODE_NOT_FOUND",
			"Parent node not found.",
			{"parent_path": parent_path},
			["Use godot_get_scene_tree to check available node paths."]
		)

	var new_node: Node = ClassDB.instantiate(node_type)
	new_node.name = node_name

	for prop_name in properties.keys():
		var prop := str(prop_name)
		var old_value = new_node.get(prop)
		if old_value == null and not prop in new_node:
			new_node.free()
			return ResponseFactory.error(
				"INVALID_PROPERTY",
				"Property not found on node.",
				{"property": prop, "node_type": node_type},
				["Use godot_get_node_properties to list available properties."]
			)
		var coerced := _coerce_property_value(old_value, properties[prop_name])
		if not coerced.get("ok", false):
			new_node.free()
			return ResponseFactory.error(
				"INVALID_PROPERTY_VALUE",
				"Property value could not be converted safely.",
				{"property": prop, "node_type": node_type, "value": _variant_to_json(properties[prop_name])},
				["Use a JSON value compatible with the current Godot property type."]
			)
		new_node.set(prop, coerced["value"])

	_undo_service.create_action("Add node %s" % node_name)
	_undo_service.add_do_method(self, "_add_child_owned", [parent, new_node, scene_root])
	_undo_service.add_undo_method(self, "_remove_child_if_parent", [parent, new_node])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{
			"node_name": str(new_node.name),
			"node_type": node_type,
			"parent_path": parent_path,
			"path": str(scene_root.get_path_to(new_node))
		},
		"Node added."
	)


func remove_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_remove_node")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	if node_path.is_empty() or node_path == ".":
		return ResponseFactory.error(
			"CANNOT_REMOVE_ROOT",
			"Cannot remove the scene root node.",
			{},
			["Use godot_delete_scene to remove the entire scene."]
		)

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error(
			"NODE_NOT_FOUND",
			"Node not found.",
			{"node_path": node_path},
			["Use godot_get_scene_tree to check available node paths."]
		)

	var parent := node.get_parent()
	var node_index := node.get_index()

	_undo_service.create_action("Remove node %s" % node.name)
	_undo_service.add_do_method(self, "_remove_child_if_parent", [parent, node])
	_undo_service.add_undo_method(self, "_add_child_owned_at", [parent, node, scene_root, node_index])
	_undo_service.commit_action()

	return ResponseFactory.success({"node_path": node_path}, "Node removed.")


func rename_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_rename_node")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var new_name: String = str(params.get("new_name", ""))

	if new_name.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "new_name is required.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error(
			"NODE_NOT_FOUND", "Node not found.", {"node_path": node_path},
			["Use godot_get_scene_tree to check available node paths."]
		)

	var old_name := str(node.name)

	_undo_service.create_action("Rename node %s → %s" % [old_name, new_name])
	_undo_service.add_do_property(node, "name", new_name)
	_undo_service.add_undo_property(node, "name", old_name)
	_undo_service.commit_action()

	return ResponseFactory.success(
		{"old_name": old_name, "new_name": str(node.name), "node_path": node_path},
		"Node renamed."
	)


func duplicate_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_duplicate_node")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	if node_path.is_empty() or node_path == ".":
		return ResponseFactory.error("INVALID_PARAMS", "Cannot duplicate root node.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error(
			"NODE_NOT_FOUND", "Node not found.", {"node_path": node_path},
			["Use godot_get_scene_tree to check available node paths."]
		)

	var dup: Node = node.duplicate()
	var parent := node.get_parent()

	_undo_service.create_action("Duplicate node %s" % node.name)
	_undo_service.add_do_method(self, "_add_child_owned", [parent, dup, scene_root])
	_undo_service.add_undo_method(self, "_remove_child_if_parent", [parent, dup])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{
			"original_path": node_path,
			"duplicate_name": str(dup.name),
			"duplicate_path": str(scene_root.get_path_to(dup))
		},
		"Node duplicated."
	)


func reparent_node(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_reparent_node")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var new_parent_path: String = str(params.get("new_parent_path", ""))

	if node_path.is_empty() or node_path == ".":
		return ResponseFactory.error("INVALID_PARAMS", "Cannot reparent root node.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var new_parent := _resolve_node(scene_root, new_parent_path)
	if new_parent == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "New parent not found.", {"node_path": new_parent_path}, [])

	var old_parent := node.get_parent()
	var old_index := node.get_index()

	_undo_service.create_action("Reparent node %s" % node.name)
	_undo_service.add_do_method(self, "_reparent_node_at", [node, new_parent, -1])
	_undo_service.add_undo_method(self, "_reparent_node_at", [node, old_parent, old_index])
	_undo_service.commit_action()

	return ResponseFactory.success(
		{
			"node_path": node_path,
			"new_parent_path": new_parent_path,
			"new_path": str(scene_root.get_path_to(node))
		},
		"Node reparented."
	)


# ── Node properties ───────────────────────────────────────────────────────────

func get_node_properties(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_set_node_property")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var properties: Array[Dictionary] = []
	for prop in node.get_property_list():
		var usage: int = int(prop.get("usage", 0))
		if usage & PROPERTY_USAGE_EDITOR == 0:
			continue
		var prop_name := str(prop.get("name", ""))
		var value = node.get(prop_name)
		properties.append({
			"name": prop_name,
			"type": int(prop.get("type", 0)),
			"value": _variant_to_json(value)
		})

	return ResponseFactory.success(
		{"node_path": node_path, "node_type": node.get_class(), "properties": properties},
		"Node properties loaded."
	)


func set_node_property(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var node_path: String = str(params.get("node_path", ""))
	var property: String = str(params.get("property", ""))
	var value = params.get("value", null)

	if property.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "property is required.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var old_value = node.get(property)
	if old_value == null and not property in node:
		return ResponseFactory.error(
			"PROPERTY_NOT_FOUND",
			"Property not found on node.",
			{"property": property, "node_type": node.get_class()},
			["Use godot_get_node_properties to list available properties."]
		)

	var coerced := _coerce_property_value(old_value, value)
	if not coerced.get("ok", false):
		return ResponseFactory.error(
			"INVALID_PROPERTY_VALUE",
			"Property value could not be converted safely.",
			{"property": property, "node_type": node.get_class(), "value": _variant_to_json(value)},
			["Use a JSON value compatible with the current Godot property type."]
		)

	_undo_service.create_action("Set %s.%s" % [node.name, property])
	_undo_service.add_do_property(node, property, coerced["value"])
	_undo_service.add_undo_property(node, property, old_value)
	_undo_service.commit_action()

	return ResponseFactory.success(
		{"node_path": node_path, "property": property, "old_value": _variant_to_json(old_value), "new_value": _variant_to_json(coerced["value"])},
		"Property set."
	)


func assign_3d_resource(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check
	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])
	var undo_check := _require_undo_redo("node.assign_3d_resource")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var property: String = str(params.get("property", ""))
	var resource_type: String = str(params.get("resource_type", ""))
	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var allowed := {
		"MeshInstance3D:mesh": ["BoxMesh", "SphereMesh", "CapsuleMesh", "CylinderMesh", "PlaneMesh", "PrismMesh", "TorusMesh"],
		"CollisionShape3D:shape": ["BoxShape3D", "SphereShape3D", "CapsuleShape3D", "CylinderShape3D"],
		"WorldEnvironment:environment": ["Environment"],
		"NavigationRegion3D:navigation_mesh": ["NavigationMesh"]
	}
	var key := "%s:%s" % [node.get_class(), property]
	if not allowed.has(key) or not (resource_type in allowed[key]):
		return ResponseFactory.error("INVALID_RESOURCE_TYPE", "Resource type is not allowed for this 3D node property.", {"node_type": node.get_class(), "property": property, "resource_type": resource_type}, [])

	var resource: Resource = ClassDB.instantiate(resource_type) as Resource
	if resource == null:
		return ResponseFactory.error("INVALID_RESOURCE_TYPE", "Could not create the requested resource.", {"resource_type": resource_type}, [])
	if resource is Environment:
		resource.background_mode = Environment.BG_COLOR
		resource.background_color = Color(0.12, 0.17, 0.24)
	if resource is NavigationMesh:
		var width := float(params.get("width", 10.0))
		var depth := float(params.get("depth", 10.0))
		if width < 0.5 or width > 1000.0 or depth < 0.5 or depth > 1000.0:
			return ResponseFactory.error("INVALID_NAVIGATION_SIZE", "Navigation width and depth must be between 0.5 and 1000.", {"width": width, "depth": depth}, [])
		var half_width := width / 2.0
		var half_depth := depth / 2.0
		resource.vertices = PackedVector3Array([
			Vector3(-half_width, 0.0, -half_depth),
			Vector3(half_width, 0.0, -half_depth),
			Vector3(half_width, 0.0, half_depth),
			Vector3(-half_width, 0.0, half_depth)
		])
		resource.add_polygon(PackedInt32Array([0, 3, 2, 1]))
	var old_value = node.get(property)
	_undo_service.create_action("Assign %s to %s.%s" % [resource_type, node.name, property])
	_undo_service.add_do_property(node, property, resource)
	_undo_service.add_undo_property(node, property, old_value)
	_undo_service.commit_action()
	return ResponseFactory.success({"node_path": node_path, "property": property, "resource_type": resource_type}, "3D resource assigned.")


func bake_navigation_mesh_3d(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check
	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])
	var undo_check := _require_undo_redo("node.bake_navigation_mesh_3d")
	if not undo_check.is_empty():
		return undo_check
	var region_path: String = str(params.get("region_path", ""))
	var source_path: String = str(params.get("source_root_path", "."))
	var region := _resolve_node(scene_root, region_path) as NavigationRegion3D
	if region == null:
		return ResponseFactory.error("INVALID_NAVIGATION_REGION", "region_path must point to a NavigationRegion3D in the open scene.", {"region_path": region_path}, [])
	var source_root := _resolve_node(scene_root, source_path)
	if source_root == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Navigation source root not found.", {"source_root_path": source_path}, [])
	var agent_radius: float = float(params.get("agent_radius", 0.5))
	var cell_size: float = float(params.get("cell_size", 0.25))
	if agent_radius < 0.05 or agent_radius > 10.0 or cell_size < 0.05 or cell_size > 2.0:
		return ResponseFactory.error("INVALID_NAVIGATION_SETTINGS", "agent_radius or cell_size is outside the supported range.", {"agent_radius": agent_radius, "cell_size": cell_size}, [])
	var old_mesh: NavigationMesh = region.navigation_mesh
	var baked_mesh: NavigationMesh = old_mesh.duplicate(true) as NavigationMesh if old_mesh != null else NavigationMesh.new()
	baked_mesh.agent_radius = agent_radius
	baked_mesh.cell_size = cell_size
	# Parse meshes and static colliders from the selected scene subtree.
	baked_mesh.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_BOTH
	baked_mesh.geometry_source_geometry_mode = NavigationMesh.SOURCE_GEOMETRY_ROOT_NODE_CHILDREN
	var source_data := NavigationMeshSourceGeometryData3D.new()
	NavigationServer3D.parse_source_geometry_data(baked_mesh, source_data, source_root)
	NavigationServer3D.bake_from_source_geometry_data(baked_mesh, source_data)
	if baked_mesh.get_polygon_count() == 0:
		return ResponseFactory.error("NAVIGATION_BAKE_EMPTY", "No walkable polygons were produced from the selected geometry.", {"source_root_path": source_path, "region_path": region_path}, ["Check floor meshes or static colliders and the agent radius."])
	_undo_service.create_action("Bake 3D navigation mesh")
	_undo_service.add_do_property(region, "navigation_mesh", baked_mesh)
	_undo_service.add_undo_property(region, "navigation_mesh", old_mesh)
	_undo_service.commit_action()
	return ResponseFactory.success({"region_path": region_path, "source_root_path": source_path, "polygon_count": baked_mesh.get_polygon_count(), "vertex_count": baked_mesh.get_vertices().size(), "agent_radius": agent_radius, "cell_size": cell_size}, "Navigation mesh baked from scene geometry.")


func audit_gltf_import(params: Dictionary) -> Dictionary:
	var source_path: String = str(params.get("gltf_path", ""))
	if not source_path.begins_with("res://") or source_path.contains("..") or not (source_path.ends_with(".glb") or source_path.ends_with(".gltf")):
		return ResponseFactory.error("INVALID_PARAMS", "gltf_path must be a project-local .glb or .gltf path.", {"gltf_path": source_path}, [])
	var imported := ResourceLoader.load(source_path)
	if not imported is PackedScene:
		return ResponseFactory.error("GLTF_NOT_IMPORTED", "Godot could not load the imported glTF as a PackedScene.", {"gltf_path": source_path}, ["Open the project in the editor and wait for import to finish."])
	var root: Node = imported.instantiate()
	if root == null:
		return ResponseFactory.error("GLTF_INSTANTIATION_FAILED", "Godot could not instantiate the imported glTF scene.", {"gltf_path": source_path}, [])
	var mesh_count := 0
	var surface_count := 0
	var material_count := 0
	var collision_count := 0
	var skeleton_count := 0
	var animation_names: Array[String] = []
	var scaled_nodes: Array[String] = []
	var nodes: Array[Node] = [root]
	while not nodes.is_empty():
		var node: Node = nodes.pop_back()
		for child in node.get_children():
			nodes.append(child)
		if node is Node3D:
			var scale3d: Vector3 = node.scale
			if not scale3d.is_equal_approx(Vector3.ONE):
				scaled_nodes.append(str(root.get_path_to(node)))
		if node is MeshInstance3D and node.mesh != null:
			mesh_count += 1
			for surface in range(node.mesh.get_surface_count()):
				surface_count += 1
				if node.get_active_material(surface) != null:
					material_count += 1
		if node is CollisionShape3D and node.shape != null:
			collision_count += 1
		if node is Skeleton3D:
			skeleton_count += 1
		if node is AnimationPlayer:
			for animation_name in node.get_animation_list():
				animation_names.append(str(animation_name))
	root.free()
	var warnings: Array[String] = []
	if mesh_count == 0:
		warnings.append("Imported scene contains no MeshInstance3D with a mesh.")
	if surface_count > 0 and material_count < surface_count:
		warnings.append("Some mesh surfaces have no material; inspect the imported appearance.")
	if collision_count == 0:
		warnings.append("No collision shape was imported; add one if this asset participates in gameplay physics.")
	if not scaled_nodes.is_empty():
		warnings.append("Non-unit node scales found; verify size against the game's unit convention.")
	return ResponseFactory.success({"gltf_path": source_path, "mesh_count": mesh_count, "surface_count": surface_count, "material_count": material_count, "collision_shape_count": collision_count, "skeleton_count": skeleton_count, "animation_names": animation_names, "scaled_nodes": scaled_nodes, "orientation_requires_review": true}, "Imported glTF inspected.", warnings, ["Review forward axis, materials and animation playback visually in the game."])


func create_gridmap_3d(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check
	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])
	var undo_check := _require_undo_redo("node.create_gridmap_3d")
	if not undo_check.is_empty():
		return undo_check
	var parent_path: String = str(params.get("parent_path", "."))
	var parent := _resolve_node(scene_root, parent_path)
	if parent == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "GridMap parent not found.", {"parent_path": parent_path}, [])
	var cell_size: float = float(params.get("cell_size", 2.0))
	if cell_size < 0.25 or cell_size > 100.0:
		return ResponseFactory.error("INVALID_PARAMS", "cell_size must be between 0.25 and 100.", {}, [])
	var library_path: String = str(params.get("mesh_library_path", ""))
	var library: MeshLibrary
	if library_path.is_empty():
		library = MeshLibrary.new()
		library.create_item(0)
		library.set_item_name(0, "Block")
		var block_mesh := BoxMesh.new()
		block_mesh.size = Vector3.ONE * cell_size
		library.set_item_mesh(0, block_mesh)
		var block_shape := BoxShape3D.new()
		block_shape.size = Vector3.ONE * cell_size
		library.set_item_shapes(0, [block_shape, Transform3D.IDENTITY])
	else:
		if not library_path.begins_with("res://") or library_path.contains("..") or not (library_path.ends_with(".tres") or library_path.ends_with(".res")):
			return ResponseFactory.error("INVALID_PARAMS", "mesh_library_path must be a project-local .tres or .res path.", {"mesh_library_path": library_path}, [])
		library = ResourceLoader.load(library_path) as MeshLibrary
		if library == null:
			return ResponseFactory.error("MESH_LIBRARY_NOT_FOUND", "Godot could not load a MeshLibrary at the given path.", {"mesh_library_path": library_path}, [])
	var grid := GridMap.new()
	grid.name = str(params.get("name", "GridMap3D"))
	grid.cell_size = Vector3.ONE * cell_size
	grid.mesh_library = library
	_undo_service.create_action("Create GridMap3D")
	_undo_service.add_do_method(self, "_add_child_owned", [parent, grid, scene_root])
	_undo_service.add_undo_method(self, "_remove_child_if_parent", [parent, grid])
	_undo_service.commit_action()
	return ResponseFactory.success({"gridmap_path": str(scene_root.get_path_to(grid)), "cell_size": cell_size, "mesh_library_path": library_path, "item_count": library.get_item_list().size()}, "GridMap3D created with a MeshLibrary.")


func get_gridmap_palette(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check
	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, [])
	var grid_path: String = str(params.get("gridmap_path", ""))
	var grid := _resolve_node(scene_root, grid_path) as GridMap
	if grid == null or grid.mesh_library == null:
		return ResponseFactory.error("INVALID_GRIDMAP", "gridmap_path must point to a GridMap with a MeshLibrary.", {"gridmap_path": grid_path}, [])
	var items: Array[Dictionary] = []
	for item_id in grid.mesh_library.get_item_list():
		items.append({"id": item_id, "name": grid.mesh_library.get_item_name(item_id), "has_mesh": grid.mesh_library.get_item_mesh(item_id) != null, "has_collision": not grid.mesh_library.get_item_shapes(item_id).is_empty(), "has_navigation": grid.mesh_library.get_item_navigation_mesh(item_id) != null})
	return ResponseFactory.success({"gridmap_path": grid_path, "cell_size": {"x": grid.cell_size.x, "y": grid.cell_size.y, "z": grid.cell_size.z}, "items": items}, "GridMap palette loaded.")


func paint_gridmap_cells(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check
	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, [])
	var undo_check := _require_undo_redo("node.paint_gridmap_cells")
	if not undo_check.is_empty():
		return undo_check
	var grid_path: String = str(params.get("gridmap_path", ""))
	var grid := _resolve_node(scene_root, grid_path) as GridMap
	if grid == null or grid.mesh_library == null:
		return ResponseFactory.error("INVALID_GRIDMAP", "gridmap_path must point to a GridMap with a MeshLibrary.", {"gridmap_path": grid_path}, [])
	var cells: Array = params.get("cells", [])
	if cells.is_empty() or cells.size() > 512:
		return ResponseFactory.error("INVALID_PARAMS", "Provide between 1 and 512 GridMap cells.", {"count": cells.size()}, [])
	var valid_items := grid.mesh_library.get_item_list()
	var seen := {}
	var updates: Array[Dictionary] = []
	for cell in cells:
		if not cell is Dictionary:
			return ResponseFactory.error("INVALID_PARAMS", "Each cell must be an object.", {}, [])
		var position := Vector3i(int(cell.get("x", 0)), int(cell.get("y", 0)), int(cell.get("z", 0)))
		if abs(position.x) > 10000 or abs(position.y) > 10000 or abs(position.z) > 10000:
			return ResponseFactory.error("INVALID_PARAMS", "GridMap cell coordinates must be within ±10000.", {}, [])
		var key := str(position)
		if seen.has(key):
			return ResponseFactory.error("INVALID_PARAMS", "The same GridMap cell was specified twice.", {"position": key}, [])
		seen[key] = true
		var item_id: int = int(cell.get("item", -1))
		var orientation: int = int(cell.get("orientation", 0))
		if item_id != GridMap.INVALID_CELL_ITEM and not (item_id in valid_items):
			return ResponseFactory.error("INVALID_GRIDMAP_ITEM", "Item ID is not present in the MeshLibrary.", {"item": item_id}, [])
		if orientation < 0 or orientation > 23:
			return ResponseFactory.error("INVALID_PARAMS", "orientation must be between 0 and 23.", {"orientation": orientation}, [])
		updates.append({"position": position, "item": item_id, "orientation": orientation, "old_item": grid.get_cell_item(position), "old_orientation": grid.get_cell_item_orientation(position)})
	_undo_service.create_action("Paint GridMap3D cells")
	for update in updates:
		_undo_service.add_do_method(grid, "set_cell_item", [update["position"], update["item"], update["orientation"]])
		_undo_service.add_undo_method(grid, "set_cell_item", [update["position"], update["old_item"], update["old_orientation"]])
	_undo_service.commit_action()
	return ResponseFactory.success({"gridmap_path": grid_path, "cells_changed": updates.size()}, "GridMap cells painted.")


# ── Node groups ───────────────────────────────────────────────────────────────

func get_node_groups(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_add_node_to_group")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	var groups: Array[String] = []
	for g in node.get_groups():
		groups.append(str(g))

	return ResponseFactory.success(
		{"node_path": node_path, "groups": groups, "count": groups.size()},
		"Node groups loaded."
	)


func add_node_to_group(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var node_path: String = str(params.get("node_path", ""))
	var group: String = str(params.get("group", ""))

	if group.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "group is required.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	if node.is_in_group(group):
		return ResponseFactory.error(
			"ALREADY_IN_GROUP",
			"Node is already in group.",
			{"node_path": node_path, "group": group},
			["Use godot_get_node_groups to check current groups."]
		)

	_undo_service.create_action("Add %s to group %s" % [node.name, group])
	_undo_service.add_do_method(node, "add_to_group", [group, true])
	_undo_service.add_undo_method(node, "remove_from_group", [group])
	_undo_service.commit_action()

	return ResponseFactory.success({"node_path": node_path, "group": group}, "Node added to group.")


func remove_node_from_group(params: Dictionary) -> Dictionary:
	var editor_check := _require_editor()
	if not editor_check.is_empty():
		return editor_check

	var scene_root: Node = _require_scene_root()
	if scene_root == null:
		return ResponseFactory.error("NO_SCENE_OPEN", "No scene is currently open.", {}, ["Open a scene first."])

	var undo_check := _require_undo_redo("godot_remove_node_from_group")
	if not undo_check.is_empty():
		return undo_check

	var node_path: String = str(params.get("node_path", ""))
	var group: String = str(params.get("group", ""))

	if group.is_empty():
		return ResponseFactory.error("INVALID_PARAMS", "group is required.", {}, [])

	var node := _resolve_node(scene_root, node_path)
	if node == null:
		return ResponseFactory.error("NODE_NOT_FOUND", "Node not found.", {"node_path": node_path}, [])

	if not node.is_in_group(group):
		return ResponseFactory.error(
			"NOT_IN_GROUP",
			"Node is not in group.",
			{"node_path": node_path, "group": group},
			["Use godot_get_node_groups to check current groups."]
		)

	_undo_service.create_action("Remove %s from group %s" % [node.name, group])
	_undo_service.add_do_method(node, "remove_from_group", [group])
	_undo_service.add_undo_method(node, "add_to_group", [group, true])
	_undo_service.commit_action()

	return ResponseFactory.success({"node_path": node_path, "group": group}, "Node removed from group.")


# ── Helpers ───────────────────────────────────────────────────────────────────

func _variant_to_json(value) -> Variant:
	match typeof(value):
		TYPE_NIL:
			return null
		TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_VECTOR2:
			return {"x": value.x, "y": value.y}
		TYPE_VECTOR3:
			return {"x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR:
			return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_RECT2:
			return {"x": value.position.x, "y": value.position.y, "w": value.size.x, "h": value.size.y}
		TYPE_NODE_PATH:
			return str(value)
		TYPE_STRING_NAME:
			return str(value)
		_:
			return str(value)


func _coerce_property_value(old_value, new_value) -> Dictionary:
	match typeof(old_value):
		TYPE_BOOL:
			return {"ok": true, "value": bool(new_value)}
		TYPE_INT:
			return {"ok": true, "value": int(new_value)}
		TYPE_FLOAT:
			return {"ok": true, "value": float(new_value)}
		TYPE_STRING:
			return {"ok": true, "value": str(new_value)}
		TYPE_VECTOR2:
			if typeof(new_value) == TYPE_DICTIONARY:
				return {"ok": true, "value": Vector2(float(new_value.get("x", 0.0)), float(new_value.get("y", 0.0)))}
			return {"ok": false}
		TYPE_VECTOR3:
			if typeof(new_value) == TYPE_DICTIONARY:
				return {"ok": true, "value": Vector3(float(new_value.get("x", 0.0)), float(new_value.get("y", 0.0)), float(new_value.get("z", 0.0)))}
			return {"ok": false}
		TYPE_COLOR:
			if typeof(new_value) == TYPE_DICTIONARY:
				return {"ok": true, "value": Color(float(new_value.get("r", 1.0)), float(new_value.get("g", 1.0)), float(new_value.get("b", 1.0)), float(new_value.get("a", 1.0)))}
			return {"ok": false}
		TYPE_NODE_PATH:
			return {"ok": true, "value": NodePath(str(new_value))}
		TYPE_STRING_NAME:
			return {"ok": true, "value": StringName(str(new_value))}
	return {"ok": true, "value": new_value}


func _add_child_owned(parent: Node, child: Node, owner: Node) -> void:
	if child.get_parent() != null:
		child.get_parent().remove_child(child)
	parent.add_child(child, true)
	child.owner = owner


func _add_child_owned_at(parent: Node, child: Node, owner: Node, index: int) -> void:
	_add_child_owned(parent, child, owner)
	if index >= 0 and index < parent.get_child_count():
		parent.move_child(child, index)


func _remove_child_if_parent(parent: Node, child: Node) -> void:
	if child.get_parent() == parent:
		parent.remove_child(child)


func _reparent_node_at(node: Node, new_parent: Node, index: int) -> void:
	if node.get_parent() != null:
		node.reparent(new_parent, true)
	else:
		new_parent.add_child(node, true)
	if index >= 0 and index < new_parent.get_child_count():
		new_parent.move_child(node, index)
