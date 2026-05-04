extends CharacterBody2D

@export var speed: float = 80.0
@export var patrol_distance: float = 200.0

var _start_x: float
var _direction: int = 1

func _ready() -> void:
	_start_x = global_position.x

func _physics_process(_delta: float) -> void:
	velocity.x = speed * _direction
	move_and_slide()
	if abs(global_position.x - _start_x) > patrol_distance:
		_direction *= -1
