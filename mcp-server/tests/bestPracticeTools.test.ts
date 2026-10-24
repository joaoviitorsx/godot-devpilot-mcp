import { describe, expect, it } from "vitest";
import { reviewGDScriptSource } from "../src/tools/bestPracticeTools.js";

describe("Godot coding practice review", () => {
  it("reports actionable style and cross-scene coupling with line numbers", () => {
    const review = reviewGDScriptSource('class_name PlayerController\nextends CharacterBody3D\nconst MAX_SPEED = 8\nfunc DoMove(delta):\n\tvar target = get_node("../../World/Target")\n\tif true && false:\n\t\tpass\n', "res://player_controller.gd");
    expect(review.findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["function_snake_case", "external_node_path", "boolean_operators"]));
    expect(review.findings.find((finding) => finding.rule === "external_node_path")?.line).toBe(5);
    expect(review.functions).toBe(1);
    expect(review.typed_functions).toBe(0);
  });

  it("accepts a typed Godot style script and PascalCase preloaded class", () => {
    const review = reviewGDScriptSource('class_name PlayerController\nextends CharacterBody3D\nconst Weapon = preload("res://weapon.gd")\nfunc move_player(delta: float) -> void:\n\tpass\n', "res://player_controller.gd");
    expect(review.findings).toEqual([]);
    expect(review.typed_functions).toBe(1);
  });
});
