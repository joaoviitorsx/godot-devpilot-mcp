import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFileBackup } from "../src/safety/backup";

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-backup-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createFileBackup", () => {
  it("copies an existing project file into .godot_mcp/backups with metadata", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Player.gd"), "extends Node\n", "utf8");

    const result = await createFileBackup({
      projectRoot: root,
      resPath: "res://scripts/Player.gd",
      toolName: "godot_write_file",
      reason: "before write",
      now: new Date("2026-05-03T10:00:00.000Z")
    });

    expect(result.resPath).toBe("res://scripts/Player.gd");
    expect(result.backupResPath).toBe("res://.godot_mcp/backups/2026-05-03/scripts/Player.gd.100000.bak");
    expect(await readFile(result.backupAbsolutePath, "utf8")).toBe("extends Node\n");

    const metadata = await readFile(path.join(root, ".godot_mcp", "backups", "2026-05-03", "metadata.jsonl"), "utf8");
    expect(JSON.parse(metadata.trim())).toMatchObject({
      timestamp: "2026-05-03T10:00:00.000Z",
      tool: "godot_write_file",
      reason: "before write",
      source: "res://scripts/Player.gd",
      backup: "res://.godot_mcp/backups/2026-05-03/scripts/Player.gd.100000.bak"
    });
  });

  it("fails with BACKUP_FAILED before a write can continue", async () => {
    const root = await makeProjectRoot();

    await expect(
      createFileBackup({
        projectRoot: root,
        resPath: "res://scripts/Missing.gd",
        toolName: "godot_write_file",
        reason: "before write",
        now: new Date("2026-05-03T10:00:00.000Z")
      })
    ).rejects.toMatchObject({
      code: "BACKUP_FAILED",
      details: {
        path: "res://scripts/Missing.gd"
      }
    });
  });

  it("does not overwrite an existing backup for the same path and timestamp", async () => {
    const root = await makeProjectRoot();
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "Player.gd"), "new content\n", "utf8");

    const existingBackup = path.join(
      root,
      ".godot_mcp",
      "backups",
      "2026-05-03",
      "scripts",
      "Player.gd.100000.bak"
    );
    await mkdir(path.dirname(existingBackup), { recursive: true });
    await writeFile(existingBackup, "old backup\n", "utf8");

    const result = await createFileBackup({
      projectRoot: root,
      resPath: "res://scripts/Player.gd",
      toolName: "godot_write_file",
      reason: "before write",
      now: new Date("2026-05-03T10:00:00.000Z")
    });

    expect(result.backupResPath).toBe("res://.godot_mcp/backups/2026-05-03/scripts/Player.gd.100000.1.bak");
    expect(await readFile(existingBackup, "utf8")).toBe("old backup\n");
    expect(await readFile(result.backupAbsolutePath, "utf8")).toBe("new content\n");
  });
});
