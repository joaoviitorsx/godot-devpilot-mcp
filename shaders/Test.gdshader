shader_type canvas_item;

uniform vec4 tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float intensity : hint_range(0.0, 2.0) = 1.0;

void fragment() {
	vec4 base = texture(TEXTURE, UV);
	COLOR = vec4(base.rgb * tint.rgb * intensity, base.a * tint.a);
}
