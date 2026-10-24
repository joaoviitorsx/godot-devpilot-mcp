import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createErrorResponse, createSuccessResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

type Finding = { line: number; rule: string; level: "style" | "review"; message: string };
const snake = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const upperSnake = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const pascal = /^[A-Z][A-Za-z0-9]*$/;

export function reviewGDScriptSource(source: string, filePath: string) {
  const findings: Finding[] = [];
  const fileName = path.posix.basename(filePath).replace(/\.gd$/, "");
  if (!snake.test(fileName)) findings.push({ line: 1, rule: "file_snake_case", level: "style", message: "Godot recommends snake_case for script files." });
  let functions = 0;
  let typedFunctions = 0;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const add = (rule: string, level: Finding["level"], message: string) => findings.push({ line: i + 1, rule, level, message });
    if (original.length > 100) add("line_length", "style", "This line exceeds the 100-character guideline; consider splitting it for readability.");
    const className = line.match(/^class_name\s+(\w+)/)?.[1];
    if (className && !pascal.test(className)) add("class_pascal_case", "style", "Use PascalCase for class_name.");
    const expectedFileName = className?.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    if (className && pascal.test(className) && expectedFileName !== fileName) add("class_file_name", "review", "The class name and script filename differ from the Godot naming convention.");
    const fn = line.match(/^(?:static\s+)?func\s+(\w+)\s*\(/)?.[1];
    if (fn) {
      functions++;
      if (/\)\s*->\s*[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?\s*:/.test(line)) typedFunctions++;
      if (!snake.test(fn.replace(/^_/, ""))) add("function_snake_case", "style", "Use snake_case for function names.");
    }
    const signal = line.match(/^signal\s+(\w+)/)?.[1];
    if (signal && !snake.test(signal)) add("signal_snake_case", "style", "Use snake_case for signals.");
    const constant = line.match(/^const\s+(\w+)/)?.[1];
    if (constant && !upperSnake.test(constant) && !(pascal.test(constant) && /\bpreload\s*\(/.test(line))) add("constant_case", "style", "Use CONSTANT_CASE for constants, except PascalCase preloaded classes.");
    if (/\&\&|\|\|/.test(line) && !line.startsWith("var ") && !line.startsWith("const ")) add("boolean_operators", "style", "Godot's style guide prefers and/or over &&/||.");
    if (/(?:\$|get_node(?:_or_null)?\s*\()[^#\n]*\.\.\/\.\.\//.test(line)) add("external_node_path", "review", "A path crossing two parent levels may couple this scene to its caller. Review whether an exported dependency or signal fits better.");
  }
  return { file: filePath, lines: lines.length, functions, typed_functions: typedFunctions, findings: findings.slice(0, 100), total_findings: findings.length, truncated: findings.length > 100, note: "Style findings are advisory. Static typing is optional; this review does not parse GDScript or replace Godot's parser and warnings." };
}

export function registerBestPracticeTools(server: McpServer, config: ServerConfig): void {
  server.tool("devpilot_review_gdscript", "Review one project GDScript for Godot naming, readability, optional typing and scene coupling. Read only and advisory; use Godot validation for syntax.", {
    path: z.string().describe("Existing project script path, e.g. res://player/player.gd.")
  }, async ({ path: scriptPath }) => {
    const response = await executeToolSafely({ toolName: "devpilot_review_gdscript", readOnly: config.security.readOnly, projectRoot: config.projectRoot }, async () => {
      const target = resolveProjectPath(scriptPath, config.projectRoot);
      if (!target.resPath.endsWith(".gd")) return createErrorResponse("INVALID_SCRIPT_PATH", "Choose an existing .gd file.", {}, []);
      const info = await stat(target.absolutePath);
      if (!info.isFile() || info.size > 512_000) return createErrorResponse("SCRIPT_TOO_LARGE", "Choose a GDScript file under 512 KB.", {}, []);
      const source = await readFile(target.absolutePath, "utf8");
      return createSuccessResponse(reviewGDScriptSource(source, target.resPath), "GDScript style review complete.");
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }], isError: !response.ok };
  });
}
