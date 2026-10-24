import { describe, expect, it } from "vitest";

import { ALL_TOOLS, PHASE1_TOOLS, PHASE3_TOOLS, PHASE4_TOOLS, PHASE5_TOOLS, getModeCapabilities, normalizeMode } from "../src/config/modes";

describe("phase 1 mode capabilities", () => {
  it("exposes only the core protocol tools implemented in phase 1", () => {
    expect(PHASE1_TOOLS).toEqual([
      "godot_health_check",
      "godot_ping",
      "godot_get_capabilities",
      "godot_get_connection_status",
      "godot_get_protocol_version"
    ]);
  });

  it("normalizes unsupported modes to core", () => {
    expect(normalizeMode("minimal")).toBe("minimal");
    expect(normalizeMode("agentic")).toBe("agentic");
    expect(normalizeMode("nonsense")).toBe("core");
    expect(normalizeMode(undefined)).toBe("core");
  });

  it("reports the tools actually registered for a mode", () => {
    const capabilities = getModeCapabilities("core", ["godot_health_check", "godot_get_project_info", "godot_take_game_screenshot"]);

    expect(capabilities.mode).toBe("core");
    expect(capabilities.tools).toEqual(["godot_health_check", "godot_get_project_info", "godot_take_game_screenshot"]);
    expect(capabilities.toolsCount).toBe(3);
    expect([...PHASE1_TOOLS, ...PHASE3_TOOLS, ...PHASE4_TOOLS, ...PHASE5_TOOLS]).toEqual([...ALL_TOOLS]);
    expect(capabilities.features).toMatchObject({
      json_rpc: true,
      health_check: true,
      heartbeat: true,
      reconnect: true,
      project_tools: true,
      undo_redo: false,
      debug_loop: false,
      screenshots: true,
      input_simulation: false,
      runtime_tree: false,
      project_intelligence: false,
      project_memory: false
    });
    expect(PHASE4_TOOLS).toContain("godot_audit_scene");
    expect(PHASE5_TOOLS).toContain("godot_validate_script");
  });
});
