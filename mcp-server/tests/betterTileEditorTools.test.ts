import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { cleanupTmpProjects, exists, makeConfig, makeFakeGodot, makeServer, makeTmpProject, mkdir, parse, readFile, writeFile } from "./_helpers.js";
import { registerBetterTileEditorTools } from "../src/tools/betterTileEditorTools.js";

afterEach(async () => cleanupTmpProjects());

describe("optional Better Tile Editor bridge", () => {
  it("allows status and terrain discovery in read-only mode", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    const godot = makeFakeGodot();
    registerBetterTileEditorTools(server as never, godot, makeConfig(root, true));
    expect(parse(await server.run("godot_better_tile_editor_status", {})).ok).toBe(true);
    expect(parse(await server.run("godot_better_tile_editor_list_terrains", { node_path: "Floor" })).ok).toBe(true);
    expect(parse(await server.run("godot_better_tile_editor_paint_terrain", { node_path: "Floor", terrain_id: 0, cells: [{ x: 0, y: 0 }] })).error.code).toBe("READ_ONLY_MODE");
  });

  it("rejects atlas output paths outside the project before RPC", async () => {
    const root = await makeTmpProject();
    const server = makeServer();
    const godot = makeFakeGodot();
    registerBetterTileEditorTools(server as never, godot, makeConfig(root));
    const result = parse(await server.run("godot_create_tile_atlas", { texture_path: "res://tiles.png", tileset_path: "res://../outside.tres", tile_width: 16, tile_height: 16 }));
    expect(result.ok).toBe(false);
    expect(godot.__callLog).toHaveLength(0);
  });

  it("backs up the TileSet before terrain edits and the scene before painting", async () => {
    const root = await makeTmpProject();
    await mkdir(path.join(root, "assets"));
    await mkdir(path.join(root, "scenes"));
    await writeFile(path.join(root, "assets", "tileset.tres"), "old tileset");
    await writeFile(path.join(root, "scenes", "floor.tscn"), "old scene");
    const server = makeServer();
    const godot = makeFakeGodot({ callResult: { ok: true, data: { tile_set_path: "res://assets/tileset.tres", scene_path: "res://scenes/floor.tscn" }, message: "ok" } });
    registerBetterTileEditorTools(server as never, godot, makeConfig(root));
    expect(parse(await server.run("godot_better_tile_editor_create_terrain", { node_path: ".", name: "Grass", color: "#7cc86b", terrain_type: "match_tiles" })).ok).toBe(true);
    expect(parse(await server.run("godot_better_tile_editor_paint_terrain", { node_path: ".", terrain_id: 0, cells: [{ x: 0, y: 0 }] })).ok).toBe(true);
    expect(godot.__callLog.map(({ method }) => method)).toEqual([
      "better_tile_editor.list_terrains", "better_tile_editor.create_terrain",
      "better_tile_editor.list_terrains", "better_tile_editor.paint_terrain"
    ]);
    const day = new Date().toISOString().slice(0, 10);
    const backupDir = path.join(root, ".godot_mcp", "backups", day);
    expect(await exists(backupDir)).toBe(true);
    const { readdir } = await import("node:fs/promises");
    const assetBackups = await readdir(path.join(backupDir, "assets"));
    const sceneBackups = await readdir(path.join(backupDir, "scenes"));
    expect(await readFile(path.join(backupDir, "assets", assetBackups[0]), "utf8")).toBe("old tileset");
    expect(await readFile(path.join(backupDir, "scenes", sceneBackups[0]), "utf8")).toBe("old scene");
  });
});
