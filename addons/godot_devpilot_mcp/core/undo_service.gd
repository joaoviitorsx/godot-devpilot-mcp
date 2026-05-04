@tool
extends RefCounted

var _undo_redo  # EditorUndoRedoManager or null


func setup(p_undo_redo) -> void:
	_undo_redo = p_undo_redo


func has_undo_redo() -> bool:
	return _undo_redo != null


func create_action(name: String) -> void:
	if _undo_redo != null:
		_undo_redo.create_action(name)


func add_do_method(object: Object, method: StringName, args: Array = []) -> void:
	if _undo_redo != null:
		_add_method(true, object, method, args)


func add_undo_method(object: Object, method: StringName, args: Array = []) -> void:
	if _undo_redo != null:
		_add_method(false, object, method, args)


func add_do_property(obj: Object, property: StringName, value: Variant) -> void:
	if _undo_redo != null:
		_undo_redo.add_do_property(obj, property, value)


func add_undo_property(obj: Object, property: StringName, value: Variant) -> void:
	if _undo_redo != null:
		_undo_redo.add_undo_property(obj, property, value)


func commit_action() -> void:
	if _undo_redo != null:
		_undo_redo.commit_action()


func _add_method(do_method: bool, object: Object, method: StringName, args: Array) -> void:
	match args.size():
		0:
			if do_method:
				_undo_redo.add_do_method(object, method)
			else:
				_undo_redo.add_undo_method(object, method)
		1:
			if do_method:
				_undo_redo.add_do_method(object, method, args[0])
			else:
				_undo_redo.add_undo_method(object, method, args[0])
		2:
			if do_method:
				_undo_redo.add_do_method(object, method, args[0], args[1])
			else:
				_undo_redo.add_undo_method(object, method, args[0], args[1])
		3:
			if do_method:
				_undo_redo.add_do_method(object, method, args[0], args[1], args[2])
			else:
				_undo_redo.add_undo_method(object, method, args[0], args[1], args[2])
		4:
			if do_method:
				_undo_redo.add_do_method(object, method, args[0], args[1], args[2], args[3])
			else:
				_undo_redo.add_undo_method(object, method, args[0], args[1], args[2], args[3])
