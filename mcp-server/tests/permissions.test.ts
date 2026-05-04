import { describe, expect, it } from "vitest";

import { enforceReadOnlyMode, isToolAllowedInReadOnly } from "../src/safety/permissions";

describe("read-only permissions", () => {
  it("blocks mutable tools when read-only mode is enabled", () => {
    expect(() => enforceReadOnlyMode({ toolName: "godot_write_file", readOnly: true })).toThrowError(
      expect.objectContaining({ code: "READ_ONLY_MODE" })
    );
  });

  it("allows read-only tools when read-only mode is enabled", () => {
    expect(isToolAllowedInReadOnly("godot_health_check")).toBe(true);
    expect(isToolAllowedInReadOnly("godot_read_file")).toBe(true);
    expect(() => enforceReadOnlyMode({ toolName: "godot_health_check", readOnly: true })).not.toThrow();
  });
});
