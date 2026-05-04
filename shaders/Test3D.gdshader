shader_type spatial;

uniform vec4 albedo : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform sampler2D albedo_tex : source_color, hint_default_white;

void fragment() {
	vec4 c = texture(albedo_tex, UV) * albedo;
	ALBEDO = c.rgb;
	ALPHA = c.a;
}
