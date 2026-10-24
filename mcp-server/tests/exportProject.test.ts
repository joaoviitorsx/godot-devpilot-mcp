import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { registerPhase19Tools } from "../src/tools/phase19Tools.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "godopilot-export-"));
  roots.push(root);
  await mkdir(path.join(root, "builds"));
  await writeFile(path.join(root, "export_presets.cfg"), '[preset.0]\nname="Linux/X11"\nplatform="Linux"\n');
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>> = {};
  registerPhase19Tools({ tool: (name: string, _description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>) => { handlers[name] = handler; } } as never, {} as never, { projectRoot: root, security: { readOnly: false } } as never);
  return handlers.godot_export_project;
}

describe("project export", () => {
  it("finds the configured preset and previews the output", async () => {
    const run = await setup();
    const result = JSON.parse((await run({ preset_name: "Linux/X11", export_path: "res://builds/game.x86_64", dry_run: true })).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);
  });

  it("rejects an unknown preset and a path outside builds", async () => {
    const run = await setup();
    const missing = JSON.parse((await run({ preset_name: "Windows Desktop", export_path: "res://builds/game.exe" })).content[0].text);
    expect(missing.error.code).toBe("EXPORT_PRESET_NOT_FOUND");
    const invalid = JSON.parse((await run({ preset_name: "Linux/X11", export_path: "res://game.x86_64" })).content[0].text);
    expect(invalid.error.code).toBe("INVALID_EXPORT_PATH");
  });

  it("reports a failed editor process instead of claiming a build", async () => {
    const run = await setup();
    const result = JSON.parse((await run({ preset_name: "Linux/X11", export_path: "res://builds/game.x86_64", godot_bin: "missing-godot-executable-for-test" })).content[0].text);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("EXPORT_FAILED");
  });
});
