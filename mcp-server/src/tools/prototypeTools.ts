import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";

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
type SystemType = "health" | "damage" | "interaction" | "inventory" | "save" | "hud" | "score" | "dialogue";
type MenuType = "main" | "pause" | "settings" | "audio" | "video" | "keybinding" | "game_over" | "level_select";

export type GameDesignPlan = {
  genre: Genre;
  title: string;
  entities: Array<{ type: EntityType; count?: number; controller_style?: string }>;
  systems: SystemType[];
  menus: MenuType[];
  scenes: Array<{ name: string; root_type?: string; instances?: string[] }>;
  placeholders?: boolean;
};

const GameDesignPlanSchema: z.ZodType<GameDesignPlan> = z.object({
  genre: z.enum(["platformer", "topdown", "rpg", "survivor", "puzzle", "visual_novel", "tower_defense"]),
  title: z.string(),
  entities: z.array(z.object({ type: z.enum(["player", "enemy", "boss", "npc", "collectible"]), count: z.number().int().nonnegative().optional(), controller_style: z.string().optional() })),
  systems: z.array(z.enum(["health", "damage", "interaction", "inventory", "save", "hud", "score", "dialogue"])),
  menus: z.array(z.enum(["main", "pause", "settings", "audio", "video", "keybinding", "game_over", "level_select"])),
  scenes: z.array(z.object({ name: z.string(), root_type: z.string().optional(), instances: z.array(z.string()).optional() })),
  placeholders: z.boolean().optional(),
});

// ── Keyword parser ───────────────────────────────────────────────────────────

const GENRE_KEYWORDS: Record<Genre, string[]> = {
  platformer: ["platformer", "platform game", "side-scroll", "sidescroll", "side scroller", "jumping game", "plataforma", "plataformer", "jogo de plataforma"],
  topdown: ["topdown", "top-down", "top down", "dungeon crawler", "dungeon", "visão de cima", "visao de cima", "vista de cima"],
  rpg: ["rpg", "role-playing", "role playing", "jrpg", "action rpg", "aventura rpg"],
  survivor: ["survivor-like", "vampire survivors", "auto-shoot", "auto shooter", "horde survival", "wave survival", "sobrevivência", "sobrevivencia", "horda", "ondas de inimigos"],
  puzzle: ["puzzle game", "match-3", "match three", "tetris", "bejeweled", "quebra-cabeça", "quebra-cabeca"],
  visual_novel: ["visual novel", "branching dialogue", "story game", "novel visual"],
  tower_defense: ["tower defense", "tower-defense", "wave defense", "torre de defesa", "defesa de torre"],
};

// Genre aliases — popular game references map to genre even without explicit keyword.
const GENRE_ALIASES: Record<string, Genre> = {
  "zelda": "topdown",
  "zelda-like": "topdown",
  "zeldalike": "topdown",
  "diablo": "topdown",
  "hades": "topdown",
  "stardew": "topdown",
  "pokemon": "topdown",
  "pokémon": "topdown",
  "earthbound": "topdown",
  "undertale": "topdown",
  "mario": "platformer",
  "celeste": "platformer",
  "hollow knight": "platformer",
  "ori": "platformer",
  "metroid": "platformer",
  "sonic": "platformer",
  "kirby": "platformer",
  "vampire survivors": "survivor",
  "brotato": "survivor",
  "20 minutes till dawn": "survivor",
  "candy crush": "puzzle",
  "tetris": "puzzle",
  "doki doki": "visual_novel",
  "bloons": "tower_defense",
  "kingdom rush": "tower_defense",
  "plants vs zombies": "tower_defense",
  "final fantasy": "rpg",
  "chrono trigger": "rpg",
  "souls-like": "rpg",
  "dark souls": "rpg",
};

const ENTITY_KEYWORDS: Record<EntityType, string[]> = {
  player: ["player", "hero", "protagonist", "jogador", "personagem principal", "herói", "heroi"],
  enemy: ["enemy", "enemies", "monster", "monsters", "mob", "mobs", "creature", "creatures", "foe", "foes", "inimigo", "inimigos", "monstro", "monstros", "criatura", "criaturas"],
  boss: ["boss", "final boss", "chefe", "chefão", "chefao", "chefe final"],
  npc: ["npc", "npcs", "villager", "villagers", "merchant", "shopkeeper", "aldeão", "aldeao", "vendedor", "mercador"],
  collectible: ["coin", "coins", "collectible", "collectibles", "pickup", "pickups", "gem", "gems", "powerup", "power-up", "moeda", "moedas", "gema", "gemas", "coletável", "coletavel", "coletáveis", "coletaveis", "xp", "experience point", "experiência", "experiencia"],
};

const SYSTEM_KEYWORDS: Record<SystemType, string[]> = {
  health: ["health", "hp", "lives", "vida", "vidas", "pontos de vida", "barra de vida"],
  damage: ["damage", "attack", "hurt", "combat", "dano", "ataque", "combate"],
  interaction: ["interact", "interaction", "talk", "use button", "interagir", "interação", "interacao", "dialogar com npc"],
  inventory: ["inventory", "items system", "backpack", "loot", "inventário", "inventario", "mochila", "itens"],
  save: ["save system", "save game", "saves", "checkpoint", "savegame", "salvar progresso", "salvamento"],
  hud: ["hud", "ui overlay", "interface", "healthbar", "health bar", "score display", "barra de saúde", "barra de saude"],
  score: ["score", "scoreboard", "high score", "leaderboard", "pontuação", "pontuacao", "ranking"],
  dialogue: ["dialogue", "dialog", "conversation", "branching dialogue", "dialogue tree", "diálogo", "dialogo", "conversa"],
};

const MENU_KEYWORDS: Record<MenuType, string[]> = {
  main: ["main menu", "title screen", "menu principal", "tela inicial", "tela de título"],
  pause: ["pause menu", "pausa", "menu de pausa"],
  settings: ["settings menu", "options menu", "configurações", "configuracoes", "opções", "opcoes"],
  audio: ["audio settings", "sound settings", "volume", "configurações de audio", "som"],
  video: ["video settings", "graphics settings", "gráficos", "graficos", "resolução", "resolucao"],
  keybinding: ["keybinding", "keybindings", "controls", "remap", "teclas", "controles", "mapeamento"],
  game_over: ["game over", "death screen", "retry", "fim de jogo", "derrota", "morreu"],
  level_select: ["level select", "stage select", "seleção de fase", "selecao de fase", "escolher fase"],
};

const NEGATION_PREFIXES = ["no ", "without ", "remove ", "remover ", "sem ", "tirar ", "tire "];

function hasNegated(text: string, kw: string): boolean {
  const idx = text.indexOf(kw);
  if (idx === -1) return false;
  const before = text.slice(Math.max(0, idx - 20), idx);
  return NEGATION_PREFIXES.some((p) => before.endsWith(p));
}

function matchesAny(text: string, words: string[]): { matched: boolean; matchedKw?: string } {
  for (const w of words) {
    if (text.includes(w)) return { matched: true, matchedKw: w };
  }
  return { matched: false };
}

function detectGenre(lower: string): Genre {
  for (const [alias, genre] of Object.entries(GENRE_ALIASES)) {
    if (lower.includes(alias)) return genre;
  }
  for (const [g, kws] of Object.entries(GENRE_KEYWORDS) as Array<[Genre, string[]]>) {
    if (matchesAny(lower, kws).matched) return g;
  }
  if (/(jump|pulo|pular)/.test(lower)) return "platformer";
  if (/(top.?down|topo|cima)/.test(lower)) return "topdown";
  return "topdown";
}

function detectQuantity(lower: string, kws: string[]): number | undefined {
  const escaped = kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(\\d+)\\s*(?:${escaped})`, "i");
  const m = lower.match(re);
  if (m) return parseInt(m[1], 10);
  // PT-BR ordinal forms ("um inimigo", "dois monstros", ...)
  const words: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, three: 3, três: 3, tres: 3, four: 4, quatro: 4, five: 5, cinco: 5, six: 6, seis: 7, seven: 7, sete: 7, eight: 8, oito: 8, nine: 9, nove: 9, ten: 10, dez: 10 };
  for (const [w, n] of Object.entries(words)) {
    const wre = new RegExp(`\\b${w}\\s+(?:${escaped})`, "i");
    if (wre.test(lower)) return n;
  }
  return undefined;
}

function extractTitle(prompt: string, genre: Genre): string {
  const titleMatch = prompt.match(/(?:called|titled|named|chamado|chamada|intitulado|intitulada)\s+["']?([^"',.!?]+)["']?/i);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  const quoted = prompt.match(/["“]([^"”]{2,40})["”]/);
  if (quoted?.[1]) return quoted[1].trim();
  return `My ${genre.charAt(0).toUpperCase()}${genre.slice(1)} Game`;
}

export function parsePromptToPlan(prompt: string): GameDesignPlan {
  const lower = prompt.toLowerCase();
  const genre: Genre = detectGenre(lower);

  const playerStyle = genre === "platformer" ? "platformer" : "topdown";
  const entities: GameDesignPlan["entities"] = [{ type: "player", controller_style: playerStyle }];
  for (const [t, kws] of Object.entries(ENTITY_KEYWORDS) as Array<[EntityType, string[]]>) {
    if (t === "player") continue;
    const m = matchesAny(lower, kws);
    if (!m.matched || !m.matchedKw) continue;
    if (hasNegated(lower, m.matchedKw)) continue;
    const count = detectQuantity(lower, kws) ?? (t === "enemy" ? 3 : t === "collectible" ? 5 : 1);
    entities.push({ type: t, count });
  }

  const systems: SystemType[] = [];
  for (const [s, kws] of Object.entries(SYSTEM_KEYWORDS) as Array<[SystemType, string[]]>) {
    const m = matchesAny(lower, kws);
    if (!m.matched || !m.matchedKw) continue;
    if (hasNegated(lower, m.matchedKw)) continue;
    systems.push(s);
  }
  const hasEnemy = entities.find((e) => e.type === "enemy");
  if (hasEnemy && !systems.includes("health")) systems.push("health");
  if (hasEnemy && !systems.includes("damage")) systems.push("damage");
  if ((hasEnemy || systems.includes("health") || systems.includes("score")) && !systems.includes("hud")) systems.push("hud");

  const menus: MenuType[] = ["main", "pause"];
  for (const [m, kws] of Object.entries(MENU_KEYWORDS) as Array<[MenuType, string[]]>) {
    if (m === "main" || m === "pause") continue;
    if (matchesAny(lower, kws).matched && !menus.includes(m)) menus.push(m);
  }
  if (entities.find((e) => e.type === "enemy" || e.type === "boss") && !menus.includes("game_over")) menus.push("game_over");

  const wantsPlaceholders = !/\b(no\s+placeholder|sem\s+placeholder|no\s+sprite)\b/.test(lower);

  const title = extractTitle(prompt, genre);
  const scenes: GameDesignPlan["scenes"] = [
    { name: "Main", root_type: "Node2D", instances: [] },
    { name: "MainMenu", root_type: "Control" },
  ];

  return { genre, title, entities, systems, menus, scenes, placeholders: wantsPlaceholders };
}

// Apply a delta prompt to an existing plan. Adds detected entities/systems/menus from
// the delta, updates entity counts, and removes anything explicitly negated.
export function applyDeltaToPlan(plan: GameDesignPlan, delta: string): GameDesignPlan {
  const lower = delta.toLowerCase();
  const next: GameDesignPlan = {
    ...plan,
    entities: plan.entities.map((e) => ({ ...e })),
    systems: [...plan.systems],
    menus: [...plan.menus],
    scenes: plan.scenes.map((s) => ({ ...s })),
  };

  // Genre override (only if explicit alias/keyword present).
  const explicitGenre = (Object.entries(GENRE_ALIASES).find(([alias]) => lower.includes(alias)) ?? null);
  if (explicitGenre) next.genre = explicitGenre[1];
  else for (const [g, kws] of Object.entries(GENRE_KEYWORDS) as Array<[Genre, string[]]>) {
    if (matchesAny(lower, kws).matched) { next.genre = g; break; }
  }

  // Entities: add new, update count, or remove if negated.
  for (const [t, kws] of Object.entries(ENTITY_KEYWORDS) as Array<[EntityType, string[]]>) {
    const m = matchesAny(lower, kws);
    if (!m.matched || !m.matchedKw) continue;
    if (hasNegated(lower, m.matchedKw)) {
      const idx = next.entities.findIndex((e) => e.type === t);
      if (idx >= 0 && t !== "player") next.entities.splice(idx, 1);
      continue;
    }
    const count = detectQuantity(lower, kws);
    const existing = next.entities.find((e) => e.type === t);
    if (existing) {
      if (count !== undefined) existing.count = count;
    } else if (t !== "player") {
      next.entities.push({ type: t, count: count ?? (t === "enemy" ? 3 : t === "collectible" ? 5 : 1) });
    }
  }

  // Systems: add or remove.
  for (const [s, kws] of Object.entries(SYSTEM_KEYWORDS) as Array<[SystemType, string[]]>) {
    const m = matchesAny(lower, kws);
    if (!m.matched || !m.matchedKw) continue;
    if (hasNegated(lower, m.matchedKw)) {
      next.systems = next.systems.filter((x) => x !== s);
    } else if (!next.systems.includes(s)) {
      next.systems.push(s);
    }
  }

  // Menus.
  for (const [m, kws] of Object.entries(MENU_KEYWORDS) as Array<[MenuType, string[]]>) {
    const match = matchesAny(lower, kws);
    if (!match.matched || !match.matchedKw) continue;
    if (hasNegated(lower, match.matchedKw)) {
      next.menus = next.menus.filter((x) => x !== m);
    } else if (!next.menus.includes(m)) {
      next.menus.push(m);
    }
  }

  // Title rename (e.g., "rename to 'Foo'", "chamado 'Bar'").
  const renameMatch = delta.match(/(?:rename(?:d)?\s+to|renomear\s+para|chamado|titled)\s+["']?([^"',.!?]+)["']?/i);
  if (renameMatch?.[1]) next.title = renameMatch[1].trim();

  return next;
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

const PLACEHOLDER_COLOR: Record<EntityType, [number, number, number]> = {
  player: [0.30, 0.65, 1.00],
  enemy: [0.95, 0.30, 0.30],
  boss: [0.65, 0.10, 0.55],
  npc: [0.95, 0.85, 0.40],
  collectible: [1.00, 0.85, 0.20],
};

function placeholderPolygon(half: number = 16): Array<{ x: number; y: number }> {
  return [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
}

async function addPlaceholderPolygon(
  godot: GodotClient,
  parentPath: string,
  entity: EntityType,
  half: number,
): Promise<ToolResponse[]> {
  const ops: ToolResponse[] = [];
  const polyPath = `${parentPath}/Placeholder`;
  ops.push(await callRpc(godot, "node.add", { parent_path: parentPath, node_type: "Polygon2D", node_name: "Placeholder" }));
  ops.push(await callRpc(godot, "node.set_property", { node_path: polyPath, property: "polygon", value: placeholderPolygon(half) }));
  const [r, g, b] = PLACEHOLDER_COLOR[entity];
  ops.push(await callRpc(godot, "node.set_property", { node_path: polyPath, property: "color", value: { r, g, b, a: 1.0 } }));
  return ops;
}

export async function applyPlan(godot: GodotClient, config: ServerConfig, plan: GameDesignPlan, opts: { skipExisting: boolean; runValidation: boolean }): Promise<{ steps: StepResult[]; files_created: string[]; scenes: string[]; failed: number }> {
  const steps: StepResult[] = [];
  const files_created: string[] = [];
  const scenes: string[] = [];

  const run = async (label: string, fn: () => Promise<ToolResponse>): Promise<ToolResponse> => {
    const r = await fn();
    steps.push({ step: label, ok: r.ok, data: r.ok ? r.data : undefined, error: r.ok ? undefined : r.error });
    return r;
  };

  const usePlaceholders = plan.placeholders !== false;

  // 1. Create main scene
  const mainScenePath = `res://scenes/main.tscn`;
  await run("create_main_scene", () => callRpc(godot, "scene.create", { path: mainScenePath, root_type: "Node2D", overwrite: false }));
  await run("open_main_scene", () => callRpc(godot, "scene.open", { path: mainScenePath }));
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
    if (usePlaceholders) {
      const ops = await addPlaceholderPolygon(godot, "Player", "player", 16);
      ops.forEach((o, i) => steps.push({ step: `placeholder_player_${i}`, ok: o.ok, error: o.ok ? undefined : o.error }));
    }
    await run("set_player_pos", () => callRpc(godot, "node.set_property", { node_path: "Player", property: "position", value: { x: 320, y: 200 } }));

    const shapeInit = `\nfunc _ready() -> void:\n\tvar shape := RectangleShape2D.new()\n\tshape.size = Vector2(28, 28)\n\tif has_node("CollisionShape2D"):\n\t\t$CollisionShape2D.shape = shape\n`;
    const playerCode = style === "platformer"
      ? `extends CharacterBody2D\n\n@export var speed: float = 250.0\n@export var jump_velocity: float = -400.0\n@export var gravity: float = 980.0\n${shapeInit}\nfunc _physics_process(delta: float) -> void:\n\tif not is_on_floor():\n\t\tvelocity.y += gravity * delta\n\tif Input.is_action_just_pressed("jump") and is_on_floor():\n\t\tvelocity.y = jump_velocity\n\tvar direction := Input.get_axis("move_left", "move_right")\n\tif direction != 0.0:\n\t\tvelocity.x = direction * speed\n\telse:\n\t\tvelocity.x = move_toward(velocity.x, 0.0, speed)\n\tmove_and_slide()\n`
      : `extends CharacterBody2D\n\n@export var speed: float = 200.0\n${shapeInit}\nfunc _physics_process(_delta: float) -> void:\n\tvar direction := Vector2.ZERO\n\tdirection.x = Input.get_axis("ui_left", "ui_right")\n\tdirection.y = Input.get_axis("ui_up", "ui_down")\n\tif direction.length() > 1.0:\n\t\tdirection = direction.normalized()\n\tvelocity = direction * speed\n\tmove_and_slide()\n`;
    await run("create_player_script", () => callRpc(godot, "script.create", { path: playerScript, content: autoFixGDScript(playerCode) }));
    await run("attach_player_script", () => callRpc(godot, "script.attach", { node_path: "Player", script_path: playerScript }));
  }

  // 3. Create enemies
  const enemyEntity = plan.entities.find((e) => e.type === "enemy");
  if (enemyEntity) {
    const enemyScript = `res://scripts/Enemy.gd`;
    files_created.push(enemyScript);
    const enemyCode = `extends CharacterBody2D\n\n@export var speed: float = 80.0\n\nfunc _ready() -> void:\n\tvar shape := RectangleShape2D.new()\n\tshape.size = Vector2(24, 24)\n\tif has_node("CollisionShape2D"):\n\t\t$CollisionShape2D.shape = shape\n\nfunc _physics_process(_delta: float) -> void:\n\tmove_and_slide()\n`;
    await run("create_enemy_script", () => callRpc(godot, "script.create", { path: enemyScript, content: autoFixGDScript(enemyCode) }));
    const count = enemyEntity.count ?? 3;
    for (let i = 1; i <= count; i++) {
      const enemyName = `Enemy${i}`;
      await run(`create_enemy_${i}`, () => callRpc(godot, "node.add", { parent_path: ".", node_type: "CharacterBody2D", node_name: enemyName }));
      await run(`create_enemy_sprite_${i}`, () => callRpc(godot, "node.add", { parent_path: enemyName, node_type: "Sprite2D", node_name: "Sprite2D" }));
      await run(`create_enemy_coll_${i}`, () => callRpc(godot, "node.add", { parent_path: enemyName, node_type: "CollisionShape2D", node_name: "CollisionShape2D" }));
      await run(`attach_enemy_script_${i}`, () => callRpc(godot, "script.attach", { node_path: enemyName, script_path: enemyScript }));
      if (usePlaceholders) {
        const ops = await addPlaceholderPolygon(godot, enemyName, "enemy", 14);
        ops.forEach((o, j) => steps.push({ step: `placeholder_enemy_${i}_${j}`, ok: o.ok, error: o.ok ? undefined : o.error }));
      }
      await run(`set_enemy_pos_${i}`, () => callRpc(godot, "node.set_property", { node_path: enemyName, property: "position", value: { x: 100 + i * 120, y: 80 } }));
    }
  }

  // 4. Create collectibles
  const collEntity = plan.entities.find((e) => e.type === "collectible");
  if (collEntity) {
    const collScript = `res://scripts/Collectible.gd`;
    files_created.push(collScript);
    const collCode = `extends Area2D\n\nsignal collected(by: Node)\n\n@export var value: int = 1\n\nfunc _ready() -> void:\n\tvar shape := CircleShape2D.new()\n\tshape.radius = 12.0\n\tif has_node("CollisionShape2D"):\n\t\t$CollisionShape2D.shape = shape\n\tbody_entered.connect(_on_body_entered)\n\nfunc _on_body_entered(body: Node) -> void:\n\tcollected.emit(body)\n\tqueue_free()\n`;
    await run("create_collectible_script", () => callRpc(godot, "script.create", { path: collScript, content: autoFixGDScript(collCode) }));
    const count = collEntity.count ?? 5;
    for (let i = 1; i <= count; i++) {
      const cname = `Collectible${i}`;
      await run(`create_coll_${i}`, () => callRpc(godot, "node.add", { parent_path: ".", node_type: "Area2D", node_name: cname }));
      await run(`create_coll_coll_${i}`, () => callRpc(godot, "node.add", { parent_path: cname, node_type: "CollisionShape2D", node_name: "CollisionShape2D" }));
      await run(`attach_coll_script_${i}`, () => callRpc(godot, "script.attach", { node_path: cname, script_path: collScript }));
      if (usePlaceholders) {
        const ops = await addPlaceholderPolygon(godot, cname, "collectible", 8);
        ops.forEach((o, j) => steps.push({ step: `placeholder_coll_${i}_${j}`, ok: o.ok, error: o.ok ? undefined : o.error }));
      }
      await run(`set_coll_pos_${i}`, () => callRpc(godot, "node.set_property", { node_path: cname, property: "position", value: { x: 80 + i * 90, y: 320 } }));
    }
  }

  // 5. System mixins (HUD, score, save, inventory, dialogue) — composable on top of any genre.
  const { applySystemMixins } = await import("../workflows/prompt/systemMixins.js");
  const mixinResult = await applySystemMixins(godot, config, plan);
  steps.push(...mixinResult.steps);
  files_created.push(...mixinResult.files_created);

  // 6. Save scene
  await run("save_main_scene", () => callRpc(godot, "scene.save", { path: mainScenePath }));

  // 7. Validation
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

export async function persistDesignPlan(projectRoot: string, plan: GameDesignPlan): Promise<string> {
  const memDir = path.join(projectRoot, ".godot_mcp", "memory");
  await mkdir(memDir, { recursive: true });
  const filePath = path.join(memDir, "game_design.md");
  await writeFile(filePath, planToMarkdown(plan), "utf8");
  await writeFile(path.join(memDir, "game_design.json"), JSON.stringify(plan, null, 2), "utf8");
  return filePath;
}

export async function loadPersistedPlan(projectRoot: string): Promise<GameDesignPlan | null> {
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

  // ── devpilot_refine_plan ──────────────────────────────────────────────────
  server.tool(
    "devpilot_refine_plan",
    "Refine an existing GameDesignPlan with a delta prompt (e.g., 'add inventory and save', '5 enemies instead of 3', 'rename to Foo', 'remove npc'). If no plan passed, loads from .godot_mcp/memory/game_design.json. Persists the new plan unless persist=false.",
    {
      delta_prompt: z.string().min(1).describe("Natural-language delta describing the change."),
      plan: GameDesignPlanSchema.optional().describe("Plan to refine. If omitted, loads persisted plan."),
      persist: z.boolean().optional().default(true),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_refine_plan", config), async (): Promise<ToolResponse> => {
          let basePlan = params.plan;
          if (!basePlan) {
            const loaded = await loadPersistedPlan(config.projectRoot);
            if (!loaded) {
              return createErrorResponse(
                "NO_PLAN",
                "No plan provided and no persisted plan found.",
                {},
                ["Run devpilot_design_game_from_prompt first, or pass plan param."]
              ) as ToolResponse;
            }
            basePlan = loaded;
          }

          const refined = applyDeltaToPlan(basePlan, params.delta_prompt);

          let persistedPath: string | null = null;
          if (params.persist && !config.security.readOnly) {
            persistedPath = await persistDesignPlan(config.projectRoot, refined);
          }

          const diff = {
            genre_changed: basePlan.genre !== refined.genre ? { from: basePlan.genre, to: refined.genre } : null,
            title_changed: basePlan.title !== refined.title ? { from: basePlan.title, to: refined.title } : null,
            entities_added: refined.entities.filter((r) => !basePlan!.entities.find((b) => b.type === r.type)).map((e) => e.type),
            entities_removed: basePlan.entities.filter((b) => !refined.entities.find((r) => r.type === b.type)).map((e) => e.type),
            systems_added: refined.systems.filter((s) => !basePlan!.systems.includes(s)),
            systems_removed: basePlan.systems.filter((s) => !refined.systems.includes(s)),
            menus_added: refined.menus.filter((m) => !basePlan!.menus.includes(m)),
            menus_removed: basePlan.menus.filter((m) => !refined.menus.includes(m)),
          };

          return createSuccessResponse(
            { plan: refined, base_plan: basePlan, diff, persisted_path: persistedPath },
            `Plan refined: ${diff.entities_added.length}+ entities / ${diff.systems_added.length}+ systems / ${diff.systems_removed.length}- systems.`
          );
        })
      )
  );
}
