import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { cleanupTmpProjects, makeConfig, makeFakeGodot, makeServer, makeTmpProject, parse } from "./_helpers.js";
import { registerEvalReportTools } from "../src/tools/evalReportTools.js";
import { registerRecordingTools } from "../src/tools/recordingTools.js";
import { registerBehaviorReplayTools } from "../src/tools/behaviorReplayTools.js";
import { registerTierAndCustomTools } from "../src/tools/tierAndCustomTools.js";

afterEach(async () => cleanupTmpProjects());

describe("artifact filename safety", () => {
  it("rejects absolute cases and case IDs that contain traversal", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    registerEvalReportTools(server as never, makeFakeGodot(), makeConfig(root));
    expect(parse(await server.run("godot_run_eval_case", { case_path: path.join(root, "case.json") })).error.code).toBe("PATH_OUTSIDE_PROJECT");
    await writeFile(path.join(root, "case.json"), JSON.stringify({ id: "../../outside", expected_tool: "godot_ping" }));
    expect(parse(await server.run("godot_run_eval_case", { case_path: "case.json" })).error.code).toBe("PATH_OUTSIDE_PROJECT");
  });

  it("rejects recording, scenario, and blueprint names with separators", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    const godot = makeFakeGodot();
    const config = makeConfig(root);
    registerRecordingTools(server as never, godot, config);
    registerBehaviorReplayTools(server as never, godot, config);
    registerTierAndCustomTools(server as never, config);
    expect(parse(await server.run("godot_save_input_recording", { name: "../outside", events: [] })).error.code).toBe("PATH_OUTSIDE_PROJECT");
    expect(parse(await server.run("godot_replay_behavior_test", { test_name: "../../outside", hold_ms: 0, speed_factor: 1, capture_after_ms: 0 })).error.code).toBe("PATH_OUTSIDE_PROJECT");
    expect(parse(await server.run("devpilot_register_custom_blueprint", { blueprint: { name: "../outside" } })).error.code).toBe("PATH_OUTSIDE_PROJECT");
  });
});
