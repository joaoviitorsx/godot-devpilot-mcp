import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createErrorResponse, createSuccessResponse } from "../src/godot/protocol.js";
import { parsePromptToPlan, registerPrototypeTools } from "../src/tools/prototypeTools.js";
import { registerGenreBlueprintTools } from "../src/tools/genreBlueprintTools.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "godopilot-prototype-"));
  roots.push(root);
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>> = {};
  const server = { tool: (name: string, _description: string, _schema: unknown, handler: typeof handlers[string]) => { handlers[name] = handler; } };
  const godot = { getStatus: () => ({ connected: true }), call: vi.fn().mockResolvedValue(createSuccessResponse({})) };
  const config = { projectRoot: root, security: { readOnly: false } };
  registerPrototypeTools(server as never, godot as never, config as never);
  registerGenreBlueprintTools(server as never, godot as never, config as never);
  const run = async (name: string, params: Record<string, unknown>) => JSON.parse((await handlers[name](params)).content[0].text);
  return { run, godot };
}

describe("genre-independent planning and reliable prototype status", () => {
  it("keeps an unknown 3D genre explicit instead of converting it to a 2D top-down game", async () => {
    const plan = parsePromptToPlan("Crie um jogo de corrida 3D com carros e pistas");
    expect(plan.genre).toBe("custom");
    expect(plan.dimension).toBe("3d");
    expect(plan.scenes[0].root_type).toBe("Node3D");
    expect(plan.entities).toEqual([]);
    const { run, godot } = await fixture();
    const result = await run("devpilot_create_playable_prototype", { plan, validate: false });
    expect(result.error.code).toBe("PLAN_REQUIRES_COMPOSITION");
    expect(godot.call).not.toHaveBeenCalled();
  });

  it("reports a failed editor step instead of a playable prototype", async () => {
    const { run, godot } = await fixture();
    godot.call.mockResolvedValueOnce(createErrorResponse("SCENE_CREATE_FAILED", "Cannot create scene."));
    const plan = { genre: "puzzle", title: "Test", entities: [], systems: [], menus: [], scenes: [] };
    const result = await run("devpilot_create_playable_prototype", { plan, validate: false });
    expect(result.error.code).toBe("PROTOTYPE_INCOMPLETE");
    expect(result.error.details.steps[0].ok).toBe(false);
  });

  it("stops a genre blueprint on the first failed editor step", async () => {
    const { run, godot } = await fixture();
    godot.call.mockResolvedValueOnce(createErrorResponse("SCENE_CREATE_FAILED", "Cannot create scene."));
    const result = await run("devpilot_create_platformer_blueprint", { scene_path: "res://scenes/test.tscn", level_length: 10, enemy_count: 0, collectible_count: 0, dry_run: false });
    expect(result.error.code).toBe("BLUEPRINT_STEP_FAILED");
    expect(result.error.details.failed_step).toBe("create_scene");
    expect(godot.call).toHaveBeenCalledTimes(1);
  });

  it("parses six enemies correctly in Portuguese", () => {
    expect(parsePromptToPlan("Jogo de plataforma com seis inimigos").entities.find((entity) => entity.type === "enemy")?.count).toBe(6);
  });
});
