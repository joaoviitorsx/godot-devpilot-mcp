import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GodotClient } from "../src/godot/client.js";
import { registerResourceTools } from "../src/tools/resourceTools.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "godopilot-resources-"));
  roots.push(root);
  await writeFile(path.join(root, "model.gltf"), "{}");
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>> = {};
  const godot = {
    getStatus: () => ({ connected: true }),
    call: vi.fn().mockResolvedValue({ ok: true, data: {}, message: "Operation completed successfully.", warnings: [], suggestions: [] })
  } as unknown as GodotClient;
  registerResourceTools({ tool: (name: string, _description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>) => { handlers[name] = handler; } } as never, godot, { projectRoot: root, security: { readOnly: false } } as never);
  return { handlers, godot };
}

describe("typed resource tools", () => {
  it("does not report an empty plugin response as a successful reimport", async () => {
    const { handlers } = await setup();
    const result = JSON.parse((await handlers.godot_reimport_asset({ asset_path: "res://model.gltf" })).content[0].text);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("EMPTY_PLUGIN_RESULT");
  });

  it("supports a short dry run without calling the editor", async () => {
    const { handlers, godot } = await setup();
    const result = JSON.parse((await handlers.godot_assign_resource({ node_path: "Mesh", property: "material_override", resource_type: "StandardMaterial3D", dry_run: true })).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);
    expect(godot.call).not.toHaveBeenCalled();
  });
});
