#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "mcp-server", "package.json"), "utf8"));
const name = `godot-devpilot-mcp-v${pkg.version}.tar.gz`;
const output = path.join(root, "release", name);
const included = [
  "addons/godot_devpilot_mcp", "scripts/install.mjs", "scripts/doctor.mjs", "bin/godopilot.mjs", "install.sh", "install.ps1", "package.json", "mcp-server/src", "mcp-server/dist",
  "mcp-server/scripts", "mcp-server/package.json", "mcp-server/package-lock.json", "mcp-server/tsconfig.json",
  "evals/runner.js", "evals/cases", "evals/README.md",
  "README.md", "docs/installation.md", "docs/ai_game_development_roadmap.md", "docs/api_reference.md",
  "docs/better_tile_editor.md", "docs/branding.md", "docs/engine_coverage_plan.md", "docs/godot_api_gap_audit.md", "docs/gdscript_scene_practices.md", "docs/capability_manifest.json", "LICENSE", "CHANGELOG.md"
];
for (const item of included) if (!existsSync(path.join(root, item))) throw new Error(`Missing release input: ${item}`);
mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync("tar", ["-czf", output, ...included], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`tar exited with ${result.status}`);
const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
writeFileSync(`${output}.sha256`, `${digest}  ${name}\n`);
console.log(`Release archive: ${output}\nSHA-256: ${digest}`);
