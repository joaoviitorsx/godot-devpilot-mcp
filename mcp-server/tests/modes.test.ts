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

  it("returns all tools including phase 3 and phase 4", () => {
    const capabilities = getModeCapabilities("core");

    expect(capabilities.mode).toBe("core");
    expect(capabilities.tools).toEqual(ALL_TOOLS);
    expect([...PHASE1_TOOLS, ...PHASE3_TOOLS, ...PHASE4_TOOLS, ...PHASE5_TOOLS]).toEqual([...ALL_TOOLS]);
    expect(capabilities.features).toMatchObject({
      json_rpc: true,
      health_check: true,
      heartbeat: true,
      reconnect: true,
      project_tools: true,
      undo_redo: true,
      debug_loop: true,
      screenshots: true,
      input_simulation: true,
      runtime_tree: true,
      project_intelligence: true,
      project_memory: true
    });
    expect(PHASE4_TOOLS).toContain("godot_audit_scene");
    expect(PHASE5_TOOLS).toContain("godot_validate_script");
  });
});
