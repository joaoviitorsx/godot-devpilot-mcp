import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveProjectPath } from "../src/safety/pathGuard";

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-path-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveProjectPath", () => {
  it("resolves res:// paths inside the project root", async () => {
    const root = await makeProjectRoot();

    const result = resolveProjectPath("res://scripts/Player.gd", root);

    expect(result).toEqual({
      inputPath: "res://scripts/Player.gd",
      resPath: "res://scripts/Player.gd",
      relativePath: "scripts/Player.gd",
      absolutePath: path.join(root, "scripts", "Player.gd")
    });
  });

  it.each([
    "../outside.gd",
    "res://../outside.gd",
    "res://scripts/../project.godot",
    "/tmp/outside.gd",
    "C:\\Users\\User\\outside.gd",
    "file:///etc/passwd"
  ])("rejects unsafe project path %s", async (unsafePath) => {
    const root = await makeProjectRoot();

    expect(() => resolveProjectPath(unsafePath, root)).toThrowError(
      expect.objectContaining({ code: "PATH_OUTSIDE_PROJECT" })
    );
  });
});
