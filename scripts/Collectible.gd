extends Area2D

signal collected(by: Node)

@export var value: int = 1

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node) -> void:
	collected.emit(body)
	queue_free()
