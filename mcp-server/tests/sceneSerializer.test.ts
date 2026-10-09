import { describe, expect, it } from "vitest";
import { serializeSceneToTscn, validateSceneSpec, SubRef, PolygonRect, type SceneSpec } from "../src/utils/sceneSerializer.js";

describe("serializeSceneToTscn", () => {
  it("emits gd_scene header with load_steps", () => {
    const spec: SceneSpec = {
      path: "res://scenes/T.tscn",
      ext_resources: [{ id: "s1", type: "Script", path: "res://A.gd" }],
      sub_resources: [{ id: "S", type: "RectangleShape2D", props: { size: { x: 10, y: 10 } } }],
      root: { name: "Root", type: "Node2D" },
    };
    const out = serializeSceneToTscn(spec);
    expect(out).toContain("[gd_scene load_steps=3 format=3]");
    expect(out).toContain("[ext_resource");
    expect(out).toContain("[sub_resource");
    expect(out).toContain("[node name=\"Root\" type=\"Node2D\"]");
  });

  it("formats Vector2 + Color + SubResource refs", () => {
    const spec: SceneSpec = {
      path: "res://scenes/T.tscn",
      sub_resources: [{ id: "X", type: "RectangleShape2D" }],
      root: {
        name: "N", type: "Sprite2D",
        props: { position: { x: 1.5, y: 2 }, color: { r: 1, g: 0, b: 0, a: 1 }, shape: SubRef("X") },
      },
    };
    const out = serializeSceneToTscn(spec);
    expect(out).toContain("position = Vector2(1.5, 2)");
    expect(out).toContain("color = Color(1, 0, 0, 1)");
    expect(out).toContain("shape = SubResource(\"X\")");
  });

  it("formats PackedVector2Array via PolygonRect helper", () => {
    const spec: SceneSpec = {
      path: "res://x.tscn",
      root: { name: "P", type: "Polygon2D", props: { polygon: PolygonRect(8, 8) } },
    };
    const out = serializeSceneToTscn(spec);
    expect(out).toContain("polygon = PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)");
  });

  it("emits child node with parent path", () => {
    const spec: SceneSpec = {
      path: "res://x.tscn",
      root: { name: "Root", type: "Node2D", children: [{ name: "Child", type: "Sprite2D" }] },
    };
    const out = serializeSceneToTscn(spec);
    expect(out).toContain("[node name=\"Child\" type=\"Sprite2D\" parent=\".\"]");
  });
});

describe("validateSceneSpec", () => {
  it("flags missing sub_resource ref", () => {
    const spec: SceneSpec = {
      path: "res://x.tscn",
      root: { name: "R", type: "Sprite2D", props: { shape: SubRef("MISSING") } },
    };
    const issues = validateSceneSpec(spec);
    const err = issues.find((i) => i.message.includes("MISSING"));
    expect(err).toBeDefined();
    expect(err!.severity).toBe("error");
  });

  it("flags duplicate ext_resource id", () => {
    const spec: SceneSpec = {
      path: "res://x.tscn",
      ext_resources: [
        { id: "s", type: "Script", path: "res://a.gd" },
        { id: "s", type: "Script", path: "res://b.gd" },
      ],
      root: { name: "R", type: "Node2D" },
    };
    const issues = validateSceneSpec(spec);
    expect(issues.some((i) => i.message.includes("duplicate"))).toBe(true);
  });

  it("flags node missing both type and instance", () => {
    const spec: SceneSpec = {
      path: "res://x.tscn",
      root: { name: "R" } as never,
    };
    const issues = validateSceneSpec(spec);
    expect(issues.some((i) => i.message.includes("missing both"))).toBe(true);
  });

  it("warns on unused ext_resource", () => {
    const spec: SceneSpec = {
      path: "res://x.tscn",
      ext_resources: [{ id: "unused", type: "Script", path: "res://nope.gd" }],
      root: { name: "R", type: "Node2D" },
    };
    const issues = validateSceneSpec(spec);
    expect(issues.some((i) => i.severity === "warn" && i.message.includes("never referenced"))).toBe(true);
  });

  it("rejects path not ending in .tscn", () => {
    const spec: SceneSpec = { path: "res://wrong", root: { name: "R", type: "Node2D" } };
    const issues = validateSceneSpec(spec);
    expect(issues.some((i) => i.message.includes(".tscn"))).toBe(true);
  });

  it("accepts valid spec without errors", () => {
    const spec: SceneSpec = {
      path: "res://x.tscn",
      ext_resources: [{ id: "s", type: "Script", path: "res://a.gd" }],
      sub_resources: [{ id: "X", type: "RectangleShape2D" }],
      root: { name: "R", type: "Node2D", script: "s", props: { shape: SubRef("X") } },
    };
    const errors = validateSceneSpec(spec).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });
});
