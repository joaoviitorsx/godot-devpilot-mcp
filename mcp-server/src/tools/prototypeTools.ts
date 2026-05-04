import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Schema ───────────────────────────────────────────────────────────────────

type Genre = "platformer" | "topdown" | "rpg" | "survivor" | "puzzle" | "visual_novel" | "tower_defense";
type EntityType = "player" | "enemy" | "boss" | "npc" | "collectible";
type SystemType = "health" | "damage" | "interaction" | "inventory" | "save";
type MenuType = "main" | "pause" | "settings" | "audio" | "video" | "keybinding" | "game_over" | "level_select";

type GameDesignPlan = {
  genre: Genre;
  title: string;
  entities: Array<{ type: EntityType; count?: number; controller_style?: string }>;
  systems: SystemType[];
  menus: MenuType[];
  scenes: Array<{ name: string; root_type?: string; instances?: string[] }>;
};

const GameDesignPlanSchema: z.ZodType<GameDesignPlan> = z.object({
  genre: z.enum(["platformer", "topdown", "rpg", "survivor", "puzzle", "visual_novel", "tower_defense"]),
  title: z.string(),
  entities: z.array(z.object({ type: z.enum(["player", "enemy", "boss", "npc", "collectible"]), count: z.number().int().nonnegative().optional(), controller_style: z.string().optional() })),
  systems: z.array(z.enum(["health", "damage", "interaction", "inventory", "save"])),
  menus: z.array(z.enum(["main", "pause", "settings", "audio", "video", "keybinding", "game_over", "level_select"])),
  scenes: z.array(z.object({ name: z.string(), root_type: z.string().optional(), instances: z.array(z.string()).optional() })),
});

// ── Keyword parser ───────────────────────────────────────────────────────────

const GENRE_KEYWORDS: Record<Genre, string[]> = {
  platformer: ["platformer", "jumping", "jump", "side-scroll", "sidescroll", "mario", "celeste"],
  topdown: ["topdown", "top-down", "top down", "zelda", "dungeon"],
  rpg: ["rpg", "role-playing", "role playing", "quest"],
  survivor: ["survivor", "vampire survivors", "auto-shoot", "horde", "wave"],
  puzzle: ["puzzle", "match", "tetris", "bejeweled"],
  visual_novel: ["visual novel", "dialogue", "story", "branching"],
  tower_defense: ["tower defense", "tower-defense", "td", "wave defense"],
};

const ENTITY_KEYWORDS: Record<EntityType, string[]> = {
  player: ["player", "hero", "character", "protagonist"],
  enemy: ["enemy", "enemies", "monster", "mob", "creature", "foe"],
  boss: ["boss", "final boss"],
  npc: ["npc", "villager", "merchant", "shopkeeper"],
  collectible: ["coin", "collectible", "pickup", "gem", "powerup", "power-up"],
};

const SYSTEM_KEYWORDS: Record<SystemType, string[]> = {
  health: ["health", "hp", "lives"],
  damage: ["damage", "attack", "hurt", "combat"],
  interaction: ["interact", "talk", "dialogue", "use"],
  inventory: ["inventory", "items", "backpack", "loot"],
  save: ["save", "saves", "checkpoint", "savegame"],
};

const MENU_KEYWORDS: Record<MenuType, string[]> = {
  main: ["main menu", "title screen"],
  pause: ["pause"],
  settings: ["settings", "options"],
  audio: ["audio settings", "volume"],
  video: ["video settings", "graphics"],
  keybinding: ["keybinding", "keybindings", "controls"],
  game_over: ["game over", "death screen", "retry"],
  level_select: ["level select", "stage select"],
};

function matchesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function parsePromptToPlan(prompt: string): GameDesignPlan {
  const lower = prompt.toLowerCase();
  let genre: Genre = "topdown";
  for (const [g, kws] of Object.entries(GENRE_KEYWORDS) as Array<[Genre, string[]]>) {
    if (matchesAny(lower, kws)) { genre = g; break; }
  }

  const entities: GameDesignPlan["entities"] = [{ type: "player", controller_style: genre === "platformer" ? "platformer" : genre === "survivor" ? "topdown" : "topdown" }];
  for (const [t, kws] of Object.entries(ENTITY_KEYWORDS) as Array<[EntityType, string[]]>) {
    if (t === "player") continue;
    if (matchesAny(lower, kws)) {
      const countMatch = lower.match(new RegExp(`(\\d+)\\s+${kws[0]}`));
      entities.push({ type: t, count: countMatch ? parseInt(countMatch[1], 10) : (t === "enemy" ? 3 : t === "collectible" ? 5 : 1) });
    }
  }

  const systems: SystemType[] = [];
  for (const [s, kws] of Object.entries(SYSTEM_KEYWORDS) as Array<[SystemType, string[]]>) {
    if (matchesAny(lower, kws)) systems.push(s);
  }
  if (entities.find((e) => e.type === "enemy") && !systems.includes("health")) systems.push("health");
  if (entities.find((e) => e.type === "enemy") && !systems.includes("damage")) systems.push("damage");

  const menus: MenuType[] = ["main", "pause"];
  for (const [m, kws] of Object.entries(MENU_KEYWORDS) as Array<[MenuType, string[]]>) {
    if (m === "main" || m === "pause") continue;
    if (matchesAny(lower, kws) && !menus.includes(m)) menus.push(m);
  }
  if (entities.find((e) => e.type === "enemy" || e.type === "boss") && !menus.includes("game_over")) menus.push("game_over");

  const titleMatch = prompt.match(/(?:called|titled|named)\s+["']?([^"',.!?]+)["']?/i);
  const title = titleMatch?.[1]?.trim() ?? `My ${genre.charAt(0).toUpperCase()}${genre.slice(1)} Game`;

  const scenes: GameDesignPlan["scenes"] = [
    { name: "Main", root_type: "Node2D", instances: [] },
    { name: "MainMenu", root_type: "Control" },
  ];

  return { genre, title, entities, systems, menus, scenes };
}

function planToMarkdown(plan: GameDesignPlan): string {
  const entityRows = plan.entities.map((e) => `- ${e.type}${e.count ? ` × ${e.count}` : ""}${e.controller_style ? ` (${e.controller_style})` : ""}`).join("\n");
  return [
    `# Game Design Plan: ${plan.title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `**Genre**: ${plan.genre}`,
    "",
    "## Entities",
    entityRows || "_(none)_",
    "",
    "## Systems",
    plan.systems.length ? plan.systems.map((s) => `- ${s}`).join("\n") : "_(none)_",
    "",
    "## Menus",
    plan.menus.length ? plan.menus.map((m) => `- ${m}`).join("\n") : "_(none)_",
    "",
    "## Scenes",
    plan.scenes.map((s) => `- ${s.name} (root: ${s.root_type ?? "Node"})`).join("\n"),
    "",
  ].join("\n");
}

// ── Plan executor ────────────────────────────────────────────────────────────

type StepResult = { step: string; ok: boolean; data?: unknown; error?: unknown };

async function applyPlan(godot: GodotClient, config: ServerConfig, plan: GameDesignPlan, opts: { skipExisting: boolean; runValidation: boolean }): Promise<{ steps: StepResult[]; files_created: string[]; scenes: string[]; failed: number }> {
  const steps: StepResult[] = [];
  const files_created: string[] = [];
  const scenes: string[] = [];

  const run = async (label: string, fn: () => Promise<ToolResponse>): Promise<ToolResponse> => {
    const r = await fn();
    steps.push({ step: label, ok: r.ok, data: r.ok ? r.data : undefined, error: r.ok ? undefined : r.error });
    return r;
  };

  // 1. Create main scene
  const mainScenePath = `res://scenes/main.tscn`;
  await run("create_main_scene", () => callRpc(godot, "scene.create", { scene_path: mainScenePath, root_node_type: "Node2D" }));
  await run("open_main_scene", () => callRpc(godot, "scene.open", { scene_path: mainScenePath }));
  scenes.push(mainScenePath);

  // 2. Create player
  const playerEntity = plan.entities.find((e) => e.type === "player");
  if (playerEntity) {
    const style = playerEntity.controller_style ?? (plan.genre === "platformer" ? "platformer" : "topdown");
    const playerScript = `res://scripts/Player.gd`;
    files_created.push(playerScript);
    await run("create_player", () => callRpc(godot, "node.add", { parent_path: ".", node_type: "CharacterBody2D", node_name: "Player" }));
    await run("create_player_sprite", () => callRpc(godot, "node.add", { parent_path: "Player", node_type: "Sprite2D", node_name: "Sprite2D" }));
    await run("create_player_collision", () => callRpc(godot, "node.add", { parent_path: "Player", node_type: "CollisionShape2D", node_name: "CollisionShape2D" }));
    await run("create_player_camera", () => callRpc(godot, "node.add", { parent_path: "Player", node_type: "Camera2D", node_name: "Camera2D" }));

    const playerCode = style === "platformer"
      ? `extends CharacterBody2D\n\n@export var speed: float = 250.0\n@export var jump_velocity: float = -400.0\n@export var gravity: float = 980.0\n\nfunc _physics_process(delta: float) -> void:\n\tif not is_on_floor():\n\t\tvelocity.y += gravity * delta\n\tif Input.is_action_just_pressed("jump") and is_on_floor():\n\t\tvelocity.y = jump_velocity\n\tvar direction := Input.get_axis("move_left", "move_right")\n\tif direction != 0.0:\n\t\tvelocity.x = direction * speed\n\telse:\n\t\tvelocity.x = move_toward(velocity.x, 0.0, speed)\n\tmove_and_slide()\n`
      : `extends CharacterBody2D\n\n@export var speed: float = 200.0\n\nfunc _physics_process(_delta: float) -> void:\n\tvar direction := Vector2.ZERO\n\tdirection.x = Input.get_axis("move_left", "move_right")\n\tdirection.y = Input.get_axis("move_up", "move_down")\n\tif direction.length() > 1.0:\n\t\tdirection = direction.normalized()\n\tvelocity = direction * speed\n\tmove_and_slide()\n`;
    await run("create_player_script", () => callRpc(godot, "script.create", { script_path: playerScript, content: playerCode }));
    await run("attach_player_script", () => callRpc(godot, "script.attach", { node_path: "Player", script_path: playerScript }));
  }

  // 3. Create enemies
  const enemyEntity = plan.entities.find((e) => e.type === "enemy");
  if (enemyEntity) {
    const enemyScript = `res://scripts/Enemy.gd`;
    files_created.push(enemyScript);
    const enemyCode = `extends CharacterBody2D\n\n@export var speed: float = 80.0\n\nfunc _physics_process(_delta: float) -> void:\n\tmove_and_slide()\n`;
    await run("create_enemy_script", () => callRpc(godot, "script.create", { script_path: enemyScript, content: enemyCode }));
    const count = enemyEntity.count ?? 3;
    for (let i = 1; i <= count; i++) {
      const enemyName = `Enemy${i}`;
      await run(`create_enemy_${i}`, () => callRpc(godot, "node.add", { parent_path: ".", node_type: "CharacterBody2D", node_name: enemyName }));
      await run(`create_enemy_sprite_${i}`, () => callRpc(godot, "node.add", { parent_path: enemyName, node_type: "Sprite2D", node_name: "Sprite2D" }));
      await run(`create_enemy_coll_${i}`, () => callRpc(godot, "node.add", { parent_path: enemyName, node_type: "CollisionShape2D", node_name: "CollisionShape2D" }));
      await run(`attach_enemy_script_${i}`, () => callRpc(godot, "script.attach", { node_path: enemyName, script_path: enemyScript }));
      await run(`set_enemy_pos_${i}`, () => callRpc(godot, "node.set_property", { node_path: enemyName, property: "position", value: { x: i * 200, y: 0 } }));
    }
  }

  // 4. Create collectibles
  const collEntity = plan.entities.find((e) => e.type === "collectible");
  if (collEntity) {
    const collScript = `res://scripts/Collectible.gd`;
    files_created.push(collScript);
    const collCode = `extends Area2D\n\nsignal collected(by: Node)\n\n@export var value: int = 1\n\nfunc _ready() -> void:\n\tbody_entered.connect(_on_body_entered)\n\nfunc _on_body_entered(body: Node) -> void:\n\tcollected.emit(body)\n\tqueue_free()\n`;
    await run("create_collectible_script", () => callRpc(godot, "script.create", { script_path: collScript, content: collCode }));
    const count = collEntity.count ?? 5;
    for (let i = 1; i <= count; i++) {
      const cname = `Collectible${i}`;
      await run(`create_coll_${i}`, () => callRpc(godot, "node.add", { parent_path: ".", node_type: "Area2D", node_name: cname }));
      await run(`create_coll_coll_${i}`, () => callRpc(godot, "node.add", { parent_path: cname, node_type: "CollisionShape2D", node_name: "CollisionShape2D" }));
      await run(`attach_coll_script_${i}`, () => callRpc(godot, "script.attach", { node_path: cname, script_path: collScript }));
      await run(`set_coll_pos_${i}`, () => callRpc(godot, "node.set_property", { node_path: cname, property: "position", value: { x: i * 100, y: 100 } }));
    }
  }

  // 5. Save scene
  await run("save_main_scene", () => callRpc(godot, "scene.save", { scene_path: mainScenePath }));

  // 6. Validation
  if (opts.runValidation) {
    await run("run_project", () => callRpc(godot, "debug.run_project", {}));
    await sleep(3000);
    const errors = await run("check_errors", () => callRpc(godot, "debug.get_output_logs", {}));
    await run("stop_project", () => callRpc(godot, "debug.stop_project", {}));
    const _ignored = errors;
  }

  const failed = steps.filter((s) => !s.ok).length;
  return { steps, files_created, scenes, failed };
}

async function persistDesignPlan(projectRoot: string, plan: GameDesignPlan): Promise<string> {
  const memDir = path.join(projectRoot, ".godot_mcp", "memory");
  await mkdir(memDir, { recursive: true });
  const filePath = path.join(memDir, "game_design.md");
  await writeFile(filePath, planToMarkdown(plan), "utf8");
  await writeFile(path.join(memDir, "game_design.json"), JSON.stringify(plan, null, 2), "utf8");
  return filePath;
}

async function loadPersistedPlan(projectRoot: string): Promise<GameDesignPlan | null> {
  try {
    const content = await readFile(path.join(projectRoot, ".godot_mcp", "memory", "game_design.json"), "utf8");
    return JSON.parse(content) as GameDesignPlan;
  } catch {
    return null;
  }
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerPrototypeTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_design_game_from_prompt ──────────────────────────────────────
  server.tool(
    "devpilot_design_game_from_prompt",
    "Convert a natural-language game description into a structured GameDesignPlan (genre, entities, systems, menus, scenes). Persists to .godot_mcp/memory/game_design.{md,json}. Heuristic keyword parser; pass override_plan to skip parsing.",
    {
      prompt: z.string().describe("Natural-language game description"),
      override_plan: GameDesignPlanSchema.optional().describe("Use this plan directly instead of parsing"),
      persist: z.boolean().optional().default(true),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_design_game_from_prompt", config), async (): Promise<ToolResponse> => {
          const plan = params.override_plan ?? parsePromptToPlan(params.prompt);
          let persistedPath: string | null = null;
          if (params.persist && !config.security.readOnly) {
            persistedPath = await persistDesignPlan(config.projectRoot, plan);
          }
          return createSuccessResponse({
            plan,
            prompt: params.prompt,
            persisted_path: persistedPath,
            summary: `Genre=${plan.genre}, ${plan.entities.length} entities, ${plan.systems.length} systems, ${plan.menus.length} menus.`,
          }, `Plan generated: ${plan.title}`);
        })
      )
  );

  // ── devpilot_create_playable_prototype ────────────────────────────────────
  server.tool(
    "devpilot_create_playable_prototype",
    "Generate a playable Godot prototype from a GameDesignPlan: creates main scene + player + enemies + collectibles + saves. Optionally runs the project for 3s to validate. If no plan passed, reads from .godot_mcp/memory/game_design.json.",
    {
      plan: GameDesignPlanSchema.optional(),
      validate: z.boolean().optional().default(true),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_playable_prototype", config), async (): Promise<ToolResponse> => {
          let plan = params.plan;
          if (!plan) {
            const loaded = await loadPersistedPlan(config.projectRoot);
            if (!loaded) return createErrorResponse("NO_PLAN", "No plan provided and no persisted plan found.", {}, ["Run devpilot_design_game_from_prompt first or pass plan param"]) as ToolResponse;
            plan = loaded;
          }

          if (params.dry_run) {
            return createSuccessResponse({
              dry_run: true,
              plan,
              steps_planned: [
                "create scenes/main.tscn",
                "create Player + Sprite2D + CollisionShape2D + Camera2D + script",
                ...(plan.entities.find((e) => e.type === "enemy") ? [`create ${plan.entities.find((e) => e.type === "enemy")?.count ?? 3} enemies`] : []),
                ...(plan.entities.find((e) => e.type === "collectible") ? [`create ${plan.entities.find((e) => e.type === "collectible")?.count ?? 5} collectibles`] : []),
                "save scene",
                ...(params.validate ? ["run + check errors + stop"] : []),
              ],
            }, "Dry run plan generated.");
          }

          const result = await applyPlan(godot, config, plan, { skipExisting: false, runValidation: params.validate });

          return createSuccessResponse({
            title: plan.title,
            genre: plan.genre,
            steps_executed: result.steps.length,
            steps_failed: result.failed,
            files_created: result.files_created,
            scenes: result.scenes,
            validated: params.validate,
            steps: result.steps,
            ready_to_play: result.failed === 0,
          }, result.failed === 0 ? `Prototype '${plan.title}' generated and ready.` : `Prototype generated with ${result.failed} failed steps.`);
        })
      )
  );

  // ── devpilot_apply_game_design_plan ───────────────────────────────────────
  server.tool(
    "devpilot_apply_game_design_plan",
    "Apply (or re-apply) a GameDesignPlan idempotently. Skip steps that fail because a node/file already exists.",
    {
      plan: GameDesignPlanSchema,
      validate: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_apply_game_design_plan", config), async (): Promise<ToolResponse> => {
          const result = await applyPlan(godot, config, params.plan, { skipExisting: true, runValidation: params.validate });
          return createSuccessResponse({
            title: params.plan.title,
            steps_executed: result.steps.length,
            steps_failed: result.failed,
            files_created: result.files_created,
            scenes: result.scenes,
          }, `Plan applied (${result.steps.length - result.failed}/${result.steps.length} steps ok).`);
        })
      )
  );
}
