import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { cleanupTmpProjects, makeConfig, makeFakeGodot, makeServer, makeTmpProject, mkdir, parse, writeFile } from "./_helpers.js";
import { registerBehaviorReplayTools } from "../src/tools/behaviorReplayTools.js";

afterEach(async () => cleanupTmpProjects());

async function setup(assertions: unknown[], recording?: { events: unknown[] }) {
  const root = await makeTmpProject();
  await mkdir(path.join(root, ".godot_mcp", "tests"), { recursive: true });
  await writeFile(path.join(root, ".godot_mcp", "tests", "case.json"), JSON.stringify({
    assertions,
    ...(recording ? { input_recording: "inputs" } : {})
  }));
  if (recording) {
    await mkdir(path.join(root, ".godot_mcp", "recordings"), { recursive: true });
    await writeFile(path.join(root, ".godot_mcp", "recordings", "inputs.json"), JSON.stringify(recording));
  }
  const godot = makeFakeGodot();
  const server = makeServer();
  registerBehaviorReplayTools(server as never, godot, makeConfig(root));
  const run = async () => parse(await server.run("godot_replay_behavior_test", { test_name: "case", hold_ms: 0, speed_factor: 1, capture_after_ms: 0 }));
  return { godot, run };
}

describe("behavior replay result", () => {
  it("rejects an empty scenario before starting the game", async () => {
    const { godot, run } = await setup([]);
    expect((await run()).error.code).toBe("INVALID_SCENARIO");
    expect(godot.call).not.toHaveBeenCalled();
  });

  it("fails when an input RPC fails and still stops the game", async () => {
    const { godot, run } = await setup([{ kind: "node_exists", node_path: "Player" }], { events: [{ type: "press_action", delay_ms: 0, params: { action: "jump" } }] });
    (godot.call as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => method === "input.press_action"
      ? { ok: false, error: { code: "INPUT_FAILED", message: "failed", details: {}, suggestions: [] } }
      : { ok: true, data: {}, message: "ok", warnings: [], suggestions: [] });
    const result = await run();
    expect(result.error.code).toBe("BEHAVIOR_TEST_FAILED");
    expect(result.error.details.phases).toContainEqual(expect.objectContaining({ phase: "replay_input", ok: false }));
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe("debug.stop_project");
  });

  it("fails unknown assertions rather than silently passing", async () => {
    const { godot, run } = await setup([{ kind: "typo_assertion" }]);
    const result = await run();
    expect(result.error.code).toBe("BEHAVIOR_TEST_FAILED");
    expect(result.error.details.assertions_failed).toBe(1);
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe("debug.stop_project");
  });

  it("fails when stopping the game fails", async () => {
    const { godot, run } = await setup([{ kind: "node_exists", node_path: "Player" }]);
    (godot.call as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => method === "debug.stop_project"
      ? { ok: false, error: { code: "STOP_FAILED", message: "failed", details: {}, suggestions: [] } }
      : { ok: true, data: {}, message: "ok", warnings: [], suggestions: [] });
    const result = await run();
    expect(result.error.code).toBe("BEHAVIOR_TEST_FAILED");
    expect(result.error.details.phases).toContainEqual(expect.objectContaining({ phase: "stop_project", ok: false }));
  });

  it("passes only when all phases and assertions pass", async () => {
    const { run } = await setup([{ kind: "node_exists", node_path: "Player" }]);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.data.passed).toBe(true);
    expect(result.data.assertions_total).toBe(1);
  });

  it("requests the exact runtime property being asserted", async () => {
    const { godot, run } = await setup([{ kind: "property_equals", node_path: "Player", property: "health", expected: 10 }]);
    (godot.call as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => ({
      ok: true, data: method === "runtime.get_node_properties" ? { properties: { health: 10 } } : {}, message: "ok", warnings: [], suggestions: []
    }));
    expect((await run()).ok).toBe(true);
    expect((godot.call as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
      "runtime.get_node_properties", { node_path: "Player", properties: ["health"] }
    ]);
  });

  it("runs the steps format written by godot_create_test_scenario", async () => {
    const root = await makeTmpProject();
    await mkdir(path.join(root, ".godot_mcp", "tests"), { recursive: true });
    await writeFile(path.join(root, ".godot_mcp", "tests", "saved.json"), JSON.stringify({
      name: "saved", steps: [{ name: "player exists", type: "assert_node_exists", params: { node_path: "Player" } }]
    }));
    const godot = makeFakeGodot();
    const server = makeServer();
    registerBehaviorReplayTools(server as never, godot, makeConfig(root));
    const result = parse(await server.run("godot_replay_behavior_test", { test_name: "saved", hold_ms: 0, speed_factor: 1, capture_after_ms: 0 }));
    expect(result.ok).toBe(true);
    expect(result.data.assertions_total).toBe(1);
  });
});
