import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, validateProjectRoot } from "../src/config/config";

describe("loadConfig", () => {
  it("uses stable phase 1 defaults", () => {
    const config = loadConfig({});

    expect(config.godot.host).toBe("127.0.0.1");
    expect(config.godot.port).toBe(6505);
    expect(config.godot.timeoutMs).toBe(5000);
    expect(config.mode).toBe("core");
    expect(config.security.readOnly).toBe(true);
    expect(config.server.name).toBe("godot-devpilot-mcp");
    expect(config.server.protocolVersion).toBe("1.0.0");
  });

  it("parses environment overrides without trusting invalid values", () => {
    const config = loadConfig({
      GODOT_MCP_HOST: "localhost",
      GODOT_MCP_PORT: "not-a-number",
      GODOT_MCP_TIMEOUT_MS: "9000",
      GODOT_MCP_READ_ONLY: "false",
      GODOT_MCP_MODE: "invalid"
    });

    expect(config.godot.host).toBe("localhost");
    expect(config.godot.port).toBe(6505);
    expect(config.godot.timeoutMs).toBe(9000);
    expect(config.security.readOnly).toBe(false);
    expect(config.mode).toBe("core");
  });

  it("keeps read-only enabled for invalid boolean overrides", () => {
    const config = loadConfig({ GODOT_MCP_READ_ONLY: "definitely" });

    expect(config.security.readOnly).toBe(true);
  });

  it("resolves projectRoot to absolute path", () => {
    const config = loadConfig({ GODOT_MCP_PROJECT_ROOT: "." });
    expect(path.isAbsolute(config.projectRoot)).toBe(true);
  });
});

describe("validateProjectRoot", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  async function makeDir(): Promise<string> {
    const r = await mkdtemp(path.join(os.tmpdir(), "godot-devpilot-config-"));
    roots.push(r);
    return r;
  }

  it("rejects non-existent path", () => {
    const result = validateProjectRoot("/nope/this/does/not/exist/abcdef");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("does not exist");
  });

  it("rejects directory without project.godot", async () => {
    const root = await makeDir();
    const result = validateProjectRoot(root);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("project.godot");
  });

  it("accepts directory with project.godot", async () => {
    const root = await makeDir();
    await writeFile(path.join(root, "project.godot"), "[application]\n", "utf8");
    const result = validateProjectRoot(root);
    expect(result.valid).toBe(true);
    if (result.valid) expect(path.isAbsolute(result.resolvedPath)).toBe(true);
  });

  it("rejects file (not directory)", async () => {
    const root = await makeDir();
    const filePath = path.join(root, "file.txt");
    await writeFile(filePath, "x", "utf8");
    const result = validateProjectRoot(filePath);
    expect(result.valid).toBe(false);
  });

  it("resolves relative paths to absolute", async () => {
    const root = await makeDir();
    await writeFile(path.join(root, "project.godot"), "x", "utf8");
    const result = validateProjectRoot(root);
    expect(result.resolvedPath).toBe(path.resolve(root));
  });
});
