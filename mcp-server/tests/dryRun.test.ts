import { describe, expect, it } from "vitest";

import { createDryRunResponse } from "../src/safety/dryRun";

describe("createDryRunResponse", () => {
  it("returns planned changes without applying mutations", () => {
    const response = createDryRunResponse({
      toolName: "godot_write_file",
      plannedChanges: ["write res://scripts/Player.gd"],
      affectedFiles: ["res://scripts/Player.gd"]
    });

    expect(response).toEqual({
      ok: true,
      data: {
        dry_run: true,
        applied: false,
        would_change: true,
        tool: "godot_write_file",
        planned_changes: ["write res://scripts/Player.gd"],
        affected_files: ["res://scripts/Player.gd"],
        affected_nodes: []
      },
      message: "Dry run completed. No changes were applied.",
      warnings: [],
      suggestions: ["Run the tool again with dry_run=false to apply the reviewed changes."]
    });
  });
});
