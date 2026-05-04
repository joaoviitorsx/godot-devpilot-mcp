import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { moveToSafeTrash } from "../src/safety/safeTrash";

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-trash-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("moveToSafeTrash", () => {
  it("moves a project file into .godot_mcp/trash instead of deleting it", async () => {
    const root = await makeProjectRoot();
    const sourcePath = path.join(root, "scripts", "Obsolete.gd");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "extends Node\n", "utf8");

    const result = await moveToSafeTrash({
      projectRoot: root,
      resPath: "res://scripts/Obsolete.gd",
      toolName: "godot_delete_file",
      now: new Date("2026-05-03T10:00:00.000Z")
    });

    await expect(access(sourcePath)).rejects.toThrow();
    expect(result.trashResPath).toBe("res://.godot_mcp/trash/2026-05-03/scripts/Obsolete.gd.100000.deleted");
    expect(await readFile(result.trashAbsolutePath, "utf8")).toBe("extends Node\n");

    const metadata = await readFile(path.join(root, ".godot_mcp", "trash", "2026-05-03", "metadata.jsonl"), "utf8");
    expect(JSON.parse(metadata.trim())).toMatchObject({
      timestamp: "2026-05-03T10:00:00.000Z",
      tool: "godot_delete_file",
      source: "res://scripts/Obsolete.gd",
      trash: "res://.godot_mcp/trash/2026-05-03/scripts/Obsolete.gd.100000.deleted"
    });
  });

  it("does not overwrite an existing safe trash entry for the same path and timestamp", async () => {
    const root = await makeProjectRoot();
    const sourcePath = path.join(root, "scripts", "Obsolete.gd");
    const existingTrash = path.join(
      root,
      ".godot_mcp",
      "trash",
      "2026-05-03",
      "scripts",
      "Obsolete.gd.100000.deleted"
    );

    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(path.dirname(existingTrash), { recursive: true });
    await writeFile(sourcePath, "new trash\n", "utf8");
    await writeFile(existingTrash, "old trash\n", "utf8");

    const result = await moveToSafeTrash({
      projectRoot: root,
      resPath: "res://scripts/Obsolete.gd",
      toolName: "godot_delete_file",
      now: new Date("2026-05-03T10:00:00.000Z")
    });

    expect(result.trashResPath).toBe("res://.godot_mcp/trash/2026-05-03/scripts/Obsolete.gd.100000.1.deleted");
    expect(await readFile(existingTrash, "utf8")).toBe("old trash\n");
    expect(await readFile(result.trashAbsolutePath, "utf8")).toBe("new trash\n");
  });
});
