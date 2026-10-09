import { describe, expect, it } from "vitest";
import { lintGDScript, autoFixGDScript } from "../src/utils/gdscriptLint.js";

describe("gdscriptLint", () => {
  it("hoists @onready ternary into _ready setup", () => {
    const src = `extends Node\n\n@onready var foo: Polygon2D = $Foo if has_node("Foo") else null\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toContain("var foo: Polygon2D = null");
    expect(r.fixed).toContain('if has_node("Foo"): foo = get_node("Foo")');
    expect(r.issues.find((i) => i.rule === "onready_ternary")).toBeDefined();
  });

  it("drops := for Dictionary access", () => {
    const src = `func t():\n\tvar x := dict[key]\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toContain("var x = dict[key]");
    expect(r.fixed).not.toMatch(/var x :=/);
  });

  it("drops := for load(p).instantiate()", () => {
    const src = `func t():\n\tvar y := load(p).instantiate()\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toContain("var y = load(p).instantiate()");
  });

  it("rewrites typed return ternary to as-cast", () => {
    const src = `func _get() -> Node2D:\n\tvar arr := get_tree().get_nodes_in_group("x")\n\treturn arr[0] if arr[0] is Node2D else null\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toContain("return arr[0] as Node2D");
  });

  it("preserves clean script unchanged", () => {
    const src = `extends Node\n\nfunc _ready() -> void:\n\tprint(\"hi\")\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toBe(src);
    expect(r.issues).toHaveLength(0);
  });

  it("autoFixGDScript returns only fixed string", () => {
    const out = autoFixGDScript(`var x := dict[k]\n`);
    expect(out).toContain("var x = dict[k]");
  });

  it("rewrites min/max/clamp to typed int variants", () => {
    const src = `func t():\n\tvar x: int = min(a, b)\n\tvar y: int = max(0, n - 1)\n\tvar z: int = clamp(v, 0, 10)\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toContain("mini(a, b)");
    expect(r.fixed).toContain("maxi(0, n - 1)");
    expect(r.fixed).toContain("clampi(v, 0, 10)");
  });

  it("rewrites min/max/clamp to typed float variants when args contain decimals", () => {
    const src = `func t(delta: float):\n\tvar a: float = min(0.0, x - delta)\n\tvar b: float = max(0.0, h - rate * delta)\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toContain("minf(0.0, x - delta)");
    expect(r.fixed).toContain("maxf(0.0, h - rate * delta)");
  });

  it("does not double-rewrite already-typed variants", () => {
    const src = `var x: int = mini(a, b)\nvar y: float = maxf(0.0, z)\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toBe(src);
  });

  it("rewrites := min(...) into typed variant (:= preserved since result is typed)", () => {
    const src = `func t():\n\tvar room := min(cap, n)\n`;
    const r = lintGDScript(src);
    // After rewrite: var room := mini(cap, n) — mini returns int so := infers correctly.
    expect(r.fixed).toContain("mini(cap, n)");
  });

  it("drops := for var x := get_node_or_null(...)", () => {
    const src = `func t():\n\tvar gm := get_node_or_null("/root/GameManager")\n`;
    const r = lintGDScript(src);
    expect(r.fixed).toContain('var gm = get_node_or_null("/root/GameManager")');
    expect(r.fixed).not.toMatch(/var gm :=/);
  });
});
