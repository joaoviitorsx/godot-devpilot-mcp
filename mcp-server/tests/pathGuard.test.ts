import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveProjectPath, resolveProjectRelativePath, safePathComponent } from "../src/safety/pathGuard";

const roots: string[] = [];

async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-path-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project-relative artifact paths", () => {
  it("accepts a relative report and rejects absolute or traversal paths", async () => {
    const root = await makeProjectRoot();
    expect(resolveProjectRelativePath("evals/results/REPORT.md", root).absolutePath).toBe(path.join(root, "evals", "results", "REPORT.md"));
    for (const value of ["../outside", "C:\\outside\\report.md", "/tmp/report.md", "file:///tmp/report.md"]) {
      expect(() => resolveProjectRelativePath(value, root)).toThrow();
    }
  });

  it("accepts one filename component only", () => {
    expect(safePathComponent("baseline-1")).toBe("baseline-1");
    for (const value of ["../x", "x/y", "..", ".", "bad\\name", "bad:"]) expect(() => safePathComponent(value)).toThrow();
  });
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

  it("rejects an existing symlink that escapes the project, including a new child file", async () => {
    const root = await makeProjectRoot();
    const outside = await makeProjectRoot();
    await mkdir(path.join(outside, "scripts"));
    await symlink(path.join(outside, "scripts"), path.join(root, "linked"), "junction");

    expect(() => resolveProjectPath("res://linked/new.gd", root)).toThrowError(
      expect.objectContaining({ code: "PATH_OUTSIDE_PROJECT" })
    );
  });
});
