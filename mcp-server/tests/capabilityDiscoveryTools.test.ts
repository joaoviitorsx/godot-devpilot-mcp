import { describe, expect, it } from "vitest";

import { findRelevantTools } from "../src/tools/capabilityDiscoveryTools.js";

const registered = [
  { name: "godot_setup_lighting", description: "Add a WorldEnvironment and light to the scene.", enabled: true, parameters: [] },
  { name: "godot_create_3d_starter", description: "Create a playable FPS or TPS arena.", enabled: true, parameters: [] },
  { name: "godot_better_tile_editor_paint_terrain", description: "Paint terrain with the optional addon.", enabled: true, parameters: [] },
  { name: "godot_execute_editor_script", description: "Run arbitrary editor code.", enabled: true, parameters: [] },
  { name: "godot_disabled_light", description: "A disabled light tool.", enabled: false, parameters: [] }
];

describe("task-oriented capability discovery", () => {
  it("finds an active tool from a simple Portuguese request", () => {
    const matches = findRelevantTools(registered, "adicione uma luz", { readOnly: false });
    expect(matches[0]?.name).toBe("godot_setup_lighting");
    expect(matches.some((match) => match.name === "godot_disabled_light")).toBe(false);
  });

  it("finds the starter for a complex FPS task", () => {
    expect(findRelevantTools(registered, "criar prototipo FPS", { readOnly: false })[0]?.name).toBe("godot_create_3d_starter");
  });

  it("filters unavailable versions and read-only writes", () => {
    expect(findRelevantTools(registered, "pintar terreno", { readOnly: false, godotVersion: "4.3" })).toEqual([]);
    expect(findRelevantTools(registered, "luz", { readOnly: true })).toEqual([]);
    expect(findRelevantTools(registered, "pintar terreno", { readOnly: false, godotVersion: "4.6", betterTileEditorAvailable: false })).toEqual([]);
  });
});
