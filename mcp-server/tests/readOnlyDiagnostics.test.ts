import { afterEach, describe, expect, it } from "vitest";
import { cleanupTmpProjects, makeConfig, makeFakeGodot, makeServer, makeTmpProject, parse } from "./_helpers.js";
import { registerDoctorTools } from "../src/tools/doctorTools.js";
import { registerInferTools } from "../src/tools/inferTools.js";
import { registerWorkflowTools } from "../src/tools/workflowTools.js";

afterEach(async () => cleanupTmpProjects());

describe("read-only diagnostics", () => {
  it("permits scans while blocking options that modify the project", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    const godot = makeFakeGodot();
    const config = makeConfig(root, true);
    registerDoctorTools(server as never, godot, config);
    registerInferTools(server as never, godot, config);
    registerWorkflowTools(server as never, godot, config);
    expect(parse(await server.run("godot_project_doctor", { auto_fix: true })).error.code).toBe("READ_ONLY_MODE");
    expect(parse(await server.run("godot_infer_input_map_from_scripts", { auto_add: true })).error.code).toBe("READ_ONLY_MODE");
    expect(parse(await server.run("devpilot_validate_project", { run_game: true })).error.code).toBe("READ_ONLY_MODE");
    expect(parse(await server.run("godot_infer_input_map_from_scripts", { auto_add: false })).ok).toBe(true);
    expect(parse(await server.run("devpilot_validate_project", { run_game: false })).ok).toBe(true);
  });
});
