import { open, readFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse } from "../godot/protocol.js";
import { buildDependencyGraph, indexProject, type ProjectFile } from "../indexer/projectIndexer.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

const MAX_PATHS = 24;
const MAX_MISSING = 20;

function samplePaths(files: ProjectFile[], kind: ProjectFile["kind"]): { paths: string[]; omitted: number } {
  const paths = files.filter((file) => file.kind === kind).map((file) => file.res_path).sort();
  return { paths: paths.slice(0, MAX_PATHS), omitted: Math.max(0, paths.length - MAX_PATHS) };
}

function projectName(settings: string): string | null {
  const match = settings.match(/^config\/name\s*=\s*"([^"\r\n]*)"/m);
  return match?.[1] ?? null;
}

async function resolveSceneUid(uid: string, files: ProjectFile[]): Promise<string | null> {
  const scenes = files.filter((file) => file.res_path.endsWith(".tscn"));
  const matches: string[] = [];
  for (let i = 0; i < scenes.length; i += 24) {
    const batch = scenes.slice(i, i + 24);
    const headers = await Promise.all(batch.map(async (file) => {
      const handle = await open(file.absolute_path, "r").catch(() => null);
      if (!handle) return null;
      try {
        const buffer = Buffer.alloc(512);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.toString("utf8", 0, bytesRead).match(/^\[gd_scene\b[^\]\r\n]*\buid="(uid:\/\/[^"\r\n]+)"/m)?.[1] === uid ? file.res_path : null;
      } finally {
        await handle.close();
      }
    }));
    matches.push(...headers.filter((header): header is string => header !== null));
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0] : null;
}

export async function buildGameContext(root: string) {
  const [allFiles, settings] = await Promise.all([
    indexProject(root),
    readFile(path.join(root, "project.godot"), "utf8")
  ]);
  const gameFiles = allFiles.filter((file) => !file.res_path.startsWith("res://addons/"));
  const graph = await buildDependencyGraph(root, gameFiles);
  const knownPaths = new Set(allFiles.map((file) => file.res_path));
  const missing = [...new Set(graph.edges
    .filter((edge) => !edge.from.startsWith("res://addons/") && !knownPaths.has(edge.to))
    .map((edge) => `${edge.from} -> ${edge.to}`))].sort();
  const addonNames = [...new Set(allFiles
    .filter((file) => /^res:\/\/addons\/[^/]+\/plugin\.cfg$/.test(file.res_path))
    .map((file) => file.res_path.split("/")[3]))].sort();
  const counts = {
    scenes: gameFiles.filter((file) => file.kind === "scene").length,
    scripts: gameFiles.filter((file) => file.kind === "script").length,
    resources: gameFiles.filter((file) => file.kind === "resource").length,
    assets: gameFiles.filter((file) => file.kind === "asset").length,
    csharp: gameFiles.filter((file) => file.res_path.endsWith(".cs")).length
  };
  const mainScene = settings.match(/^run\/main_scene\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const mainSceneResolvedPath = mainScene?.startsWith("uid://") ? await resolveSceneUid(mainScene, gameFiles) : mainScene?.startsWith("res://") ? mainScene : null;
  return {
    project_name: projectName(settings),
    main_scene: mainScene,
    main_scene_resolved_path: mainSceneResolvedPath,
    main_scene_exists: mainSceneResolvedPath ? knownPaths.has(mainSceneResolvedPath) : null,
    counts,
    scenes: samplePaths(gameFiles, "scene"),
    scripts: samplePaths(gameFiles, "script"),
    assets: samplePaths(gameFiles, "asset"),
    addons: addonNames,
    missing_dependencies: missing.slice(0, MAX_MISSING),
    missing_dependencies_omitted: Math.max(0, missing.length - MAX_MISSING),
    guidance: "Inspect relevant scenes and scripts before editing. Validate the changed scene and run a short playtest after edits."
  };
}

function prompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerGameContextTools(server: McpServer, config: ServerConfig): void {
  server.registerResource(
    "game-context",
    "godot://project/context",
    { title: "Godot game context", description: "Bounded project index excluding third-party addons", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await buildGameContext(config.projectRoot), null, 2) }] })
  );

  server.registerTool("devpilot_game_context", {
    description: "Get a bounded game-focused context: main scene, scene/script/asset paths, addons and missing references. Excludes addon files from game counts.",
    inputSchema: {},
    annotations: { readOnlyHint: true }
  }, async (): Promise<CallToolResult> => {
    const response = await executeToolSafely(
      { toolName: "devpilot_game_context", readOnly: config.security.readOnly, projectRoot: config.projectRoot },
      async () => createSuccessResponse(await buildGameContext(config.projectRoot), "Game context generated.")
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], isError: !response.ok };
  });

  server.registerPrompt("devpilot_feature_loop", {
    title: "Build and verify a game feature",
    description: "A small, testable Godot feature loop grounded in the current project",
    argsSchema: { goal: z.string().min(1), acceptance: z.string().optional() }
  }, async ({ goal, acceptance }) => prompt(
    `Implement this feature in my Godot game: ${goal}\nAcceptance criteria: ${acceptance || "Define observable player-facing criteria before editing."}\n` +
    "First read godot://project/context or call devpilot_game_context. Inspect the relevant scene, script and assets. " +
    "Find a small set of relevant tools with devpilot_find_tools. Plan the smallest playable change, then implement it. " +
    "Follow the project's naming and scene conventions; keep reusable scenes self-contained and use clear types where helpful. " +
    "Review changed GDScript with devpilot_review_gdscript, validate scripts and scenes in Godot, run the game or a test scenario, inspect logs and report observed behavior, files changed and remaining gaps."
  ));

  server.registerPrompt("devpilot_playtest_loop", {
    title: "Playtest and diagnose",
    description: "Run an evidence-based playtest loop for one gameplay behavior",
    argsSchema: { behavior: z.string().min(1) }
  }, async ({ behavior }) => prompt(
    `Playtest this behavior in my Godot game: ${behavior}\n` +
    "Read the game context and run devpilot_game_quality_audit. Identify the relevant scene and controls. Define observable pass/fail criteria, including progression/resource budget and the player's ability to reverse, cancel or return where the design expects it. " +
    "Run the scene or project, exercise the input sequence or test scenario through start, action, result and persistence, inspect output logs and capture menu/gameplay/result visual evidence when available. " +
    "Distinguish confirmed results from assumptions. If it fails, identify the smallest fix and repeat the same check."
  ));

  server.registerPrompt("devpilot_tile_workflow", {
    title: "Build a tile-based level",
    description: "Import a spritesheet, create a TileSet and paint a testable level",
    argsSchema: { texture_path: z.string().min(1), level_goal: z.string().min(1) }
  }, async ({ texture_path, level_goal }) => prompt(
    `Create a tile-based level for this goal: ${level_goal}. Spritesheet: ${texture_path}.\n` +
    "Inspect the texture and the game context first. Use godot_create_tile_atlas for an imported texture. " +
    "Create or update a TileMapLayer scene and assign the TileSet. If Better Tile Editor is installed, use its terrain tools for tile association and painting; " +
    "otherwise use native tilemap tools. Check collisions and navigation separately, then open and playtest the scene."
  ));

  server.registerPrompt("devpilot_3d_vertical_slice", {
    title: "Build and verify a 3D game slice",
    description: "Create a playable 3D scene and verify controls, collision, camera, lighting and performance",
    argsSchema: { goal: z.string().min(1), target_platform: z.string().optional() }
  }, async ({ goal, target_platform }) => prompt(
    `Build a small playable 3D slice for this goal: ${goal}. Target platform: ${target_platform || "ask the creator or use the project's existing target"}.\n` +
    "Read the game context and existing 3D scenes first. Define the intended player experience and observable acceptance criteria. " +
    "Use existing blueprints or scene tools where appropriate. Configure InputMap, visible meshes, collision resources, camera and lighting; navigation needs a baked mesh when used. " +
    "Run devpilot_audit_3d_scene on changed scenes, validate scripts, playtest controls and collision, and measure performance on the target hardware. " +
    "Report confirmed results separately from work requiring human playtesting."
  ));

  server.registerPrompt("devpilot_game_production_loop", {
    title: "Plan and build any game concept",
    description: "Genre-independent production loop with playable milestones and evidence",
    argsSchema: { concept: z.string().min(1), target_platform: z.string().optional() }
  }, async ({ concept, target_platform }) => prompt(
    `Help build this Godot game: ${concept}\nTarget platform: ${target_platform || "use the project's target or ask before platform-specific choices"}.\n` +
    "Read devpilot_game_context and devpilot_game_quality_audit; inspect existing scenes, scripts, assets and project settings. Preserve the creator's genre and intended 2D/3D perspective; do not substitute a built-in template for an unsupported genre. " +
    "Describe the player experience, core loop, controls, camera, progression, content needs and measurable acceptance criteria. Split work into small playable vertical slices with dependencies and risks. " +
    "Set a progression budget with milestones, fastest legitimate route, resource costs and intended number of attempts; pass the numeric model to devpilot_game_quality_audit when applicable. Record each input action's expected player-facing effect and test reverse/cancel/early return where applicable. " +
    "For each slice, use devpilot_find_tools to select a few relevant engine tools, inspect the actual Godot classes and resources, implement, then validate scripts/scenes and run a focused gameplay check. " +
    "Review visual and audio identity across menu, gameplay and result states. Author stable HUD layout with editable scenes, Containers/anchors and a Theme when useful; test target, narrow and wide resolutions. Version persistent data, validate writes, retain a recovery path and test save/load/migration. Keep the project under version control when appropriate. " +
    "Cover accessibility, performance, export and multiplayer where the concept needs them. Treat placeholders and untested behavior as incomplete. " +
    "Record observed results and remaining work after each slice; do not claim the full game is finished from a parser check or generated files alone."
  ));
}
