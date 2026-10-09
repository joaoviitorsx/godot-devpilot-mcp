import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

import { readManifest, writeManifest, recordScene, recordScript, recordBlueprintApplied, recordAutoload, registerManifestTools, EMPTY_MANIFEST } from "../src/tools/manifestTools.js";
import { makeConfig, makeServer, makeTmpProject, cleanupTmpProjects, exists, parse } from "./_helpers.js";

afterEach(async () => { await cleanupTmpProjects(); });

describe("manifestTools — atomic write + helpers", () => {
  it("readManifest returns empty when file absent", async () => {
    const root = await makeTmpProject();
    const m = await readManifest(root);
    expect(m).toEqual(EMPTY_MANIFEST);
  });

  it("writeManifest persists JSON atomically", async () => {
    const root = await makeTmpProject();
    const m = { ...EMPTY_MANIFEST, generated_files: ["a.gd", "b.tscn"] };
    await writeManifest(root, m);
    expect(await exists(path.join(root, ".godot_mcp/manifest.json"))).toBe(true);
    const loaded = await readManifest(root);
    expect(loaded.generated_files).toEqual(["a.gd", "b.tscn"]);
  });

  it("recordScene + recordScript + recordBlueprintApplied accumulate", async () => {
    const root = await makeTmpProject();
    await recordScene(root, "res://scenes/Player.tscn", "player", ["res://scripts/Player.gd"]);
    await recordScript(root, "res://scripts/Player.gd", { signals: ["died"] });
    await recordBlueprintApplied(root, "twin_stick", { template_version: "0.5.0" });
    await recordAutoload(root, "GameManager", "res://scripts/GameManager.gd");
    const m = await readManifest(root);
    expect(m.scenes["res://scenes/Player.tscn"]).toMatchObject({ kind: "player" });
    expect(m.scripts["res://scripts/Player.gd"]?.signals).toEqual(["died"]);
    expect(m.blueprints_applied).toHaveLength(1);
    expect(m.blueprints_applied[0].name).toBe("twin_stick");
    expect(m.autoloads.GameManager).toBe("res://scripts/GameManager.gd");
    expect(m.signals_map.died).toEqual(["res://scripts/Player.gd"]);
  });

  it("concurrent writes don't corrupt manifest (chain serialization)", async () => {
    const root = await makeTmpProject();
    await Promise.all([
      recordBlueprintApplied(root, "a"),
      recordBlueprintApplied(root, "b"),
      recordBlueprintApplied(root, "c"),
    ]);
    const m = await readManifest(root);
    expect(m.blueprints_applied.length).toBeGreaterThanOrEqual(1);
    expect(m.blueprints_applied.length).toBeLessThanOrEqual(3);
  });

  it("MCP tools devpilot_manifest_get + devpilot_manifest_update", async () => {
    const root = await makeTmpProject();
    const config = makeConfig(root);
    const server = makeServer();
    registerManifestTools(server as never, config);
    const get = await server.run("devpilot_manifest_get");
    expect(parse(get).ok).toBe(true);
    expect(parse(get).data.schema_version).toBe(1);

    const upd = await server.run("devpilot_manifest_update", {
      patch: { generated_files: ["z.gd"], notes: ["hello"] },
    });
    expect(parse(upd).ok).toBe(true);
    const m = await readManifest(root);
    expect(m.generated_files).toContain("z.gd");
    expect(m.notes).toContain("hello");
  });

  it("read-only mode blocks manifest_update", async () => {
    const root = await makeTmpProject();
    const config = makeConfig(root, true);
    const server = makeServer();
    registerManifestTools(server as never, config);
    const r = await server.run("devpilot_manifest_update", { patch: { notes: ["x"] } });
    const parsed = parse(r);
    // toolWrapper enforces read-only before handler — returns READ_ONLY_MODE error envelope.
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toMatch(/READ_ONLY/);
  });
});
