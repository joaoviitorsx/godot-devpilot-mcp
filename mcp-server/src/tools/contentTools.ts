import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";
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

async function writeFileSafe(projectRoot: string, resPath: string, content: string): Promise<void> {
  const resolved = resolveProjectPath(resPath, projectRoot);
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  const final = resolved.resPath.endsWith(".gd") ? autoFixGDScript(content) : content;
  await writeFile(resolved.absolutePath, final, "utf8");
}

const dryRun = (toolName: string, plan: string[], files: string[]) =>
  createDryRunResponse({ toolName, plannedChanges: plan, affectedFiles: files });

// ── Resource class templates ─────────────────────────────────────────────────

const ITEM_RESOURCE = `class_name Item
extends Resource

@export var id: StringName = &""
@export var display_name: String = ""
@export var description: String = ""
@export var icon: Texture2D
@export var stack_size: int = 1
@export var item_type: StringName = &"misc"
@export var stats: Dictionary = {}
`;

const ENEMY_RESOURCE = `class_name EnemyData
extends Resource

@export var id: StringName = &""
@export var display_name: String = ""
@export var max_hp: int = 10
@export var damage: int = 1
@export var speed: float = 80.0
@export var scene: PackedScene
@export var loot_table: Resource
`;

const DIALOGUE_RESOURCE = `class_name Dialogue
extends Resource

@export var id: StringName = &""
@export var lines: Array = []

# line: { "speaker": String, "text": String, "choices": Array of { "label": String, "next": StringName } }

static func from_json(json_path: String) -> Dialogue:
	var file := FileAccess.open(json_path, FileAccess.READ)
	if file == null:
		return null
	var raw := file.get_as_text()
	file.close()
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		return null
	var d := Dialogue.new()
	d.id = StringName(str(parsed.get("id", "")))
	d.lines = parsed.get("lines", [])
	return d
`;

const QUEST_RESOURCE = `class_name Quest
extends Resource

@export var id: StringName = &""
@export var title: String = ""
@export var description: String = ""
@export var objectives: Array = []
@export var rewards: Array = []

# objective: { "kind": "kill" | "collect" | "reach", "target": StringName, "amount": int, "current": int }
# reward: { "kind": "item" | "xp" | "currency", "value": Variant }

func is_complete() -> bool:
	for o in objectives:
		if int(o.get("current", 0)) < int(o.get("amount", 0)):
			return false
	return true
`;

const LOOT_TABLE_RESOURCE = `class_name LootTable
extends Resource

@export var entries: Array = []

# entry: { "item": Item, "weight": int, "min": int, "max": int }

func roll() -> Array:
	if entries.is_empty():
		return []
	var total: int = 0
	for e in entries:
		total += int(e.get("weight", 0))
	if total <= 0:
		return []
	var pick: int = randi() % total
	var acc: int = 0
	for e in entries:
		acc += int(e.get("weight", 0))
		if pick < acc:
			var min_count := int(e.get("min", 1))
			var max_count := int(e.get("max", min_count))
			var count := min_count + randi() % max(1, (max_count - min_count + 1))
			return [{ "item": e.get("item"), "count": count }]
	return []
`;

const SPAWN_TABLE_RESOURCE = `class_name SpawnTable
extends Resource

@export var entries: Array = []

# entry: { "enemy": EnemyData, "weight": int, "max_simultaneous": int }

func pick(active_counts: Dictionary = {}) -> EnemyData:
	if entries.is_empty():
		return null
	var available: Array = []
	for e in entries:
		var enemy = e.get("enemy")
		if enemy == null:
			continue
		var max_sim := int(e.get("max_simultaneous", 99))
		var current := int(active_counts.get(enemy.id, 0))
		if current >= max_sim:
			continue
		available.append(e)
	if available.is_empty():
		return null
	var total: int = 0
	for e in available:
		total += int(e.get("weight", 0))
	if total <= 0:
		return null
	var pick: int = randi() % total
	var acc: int = 0
	for e in available:
		acc += int(e.get("weight", 0))
		if pick < acc:
			return e.get("enemy")
	return null
`;

const DB_HELPER = (className: string, resourceClass: string, dataDir: string) => `extends Node

# Singleton lookup helper for ${resourceClass} resources in ${dataDir}

var _by_id: Dictionary = {}

func _ready() -> void:
	_load_all()

func _load_all() -> void:
	var dir := DirAccess.open("${dataDir}")
	if dir == null:
		return
	dir.list_dir_begin()
	var fname := dir.get_next()
	while fname != "":
		if fname.ends_with(".tres"):
			var res = load("${dataDir}/" + fname)
			if res is ${resourceClass}:
				_by_id[res.id] = res
		fname = dir.get_next()

func get_by_id(id: StringName) -> ${resourceClass}:
	return _by_id.get(id, null)

func all() -> Array:
	return _by_id.values()
`;

// ── Sample .tres data ────────────────────────────────────────────────────────

function itemTres(id: string, displayName: string, stackSize: number, type: string): string {
  return `[gd_resource type="Resource" script_class="Item" load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://scripts/data/Item.gd" id="1"]\n\n[resource]\nscript = ExtResource("1")\nid = &"${id}"\ndisplay_name = "${displayName}"\nstack_size = ${stackSize}\nitem_type = &"${type}"\n`;
}
function enemyTres(id: string, displayName: string, hp: number, damage: number, speed: number): string {
  return `[gd_resource type="Resource" script_class="EnemyData" load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://scripts/data/EnemyData.gd" id="1"]\n\n[resource]\nscript = ExtResource("1")\nid = &"${id}"\ndisplay_name = "${displayName}"\nmax_hp = ${hp}\ndamage = ${damage}\nspeed = ${speed}\n`;
}
function dialogueJson(id: string): string {
  return JSON.stringify({ id, lines: [{ speaker: "Narrator", text: `Sample dialogue for ${id}.`, choices: [{ label: "Continue", next: "" }] }] }, null, 2);
}
function questTres(id: string, title: string, description: string): string {
  return `[gd_resource type="Resource" script_class="Quest" load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://scripts/data/Quest.gd" id="1"]\n\n[resource]\nscript = ExtResource("1")\nid = &"${id}"\ntitle = "${title}"\ndescription = "${description}"\n`;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerContentTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_create_item_database ──────────────────────────────────────────
  server.tool(
    "devpilot_create_item_database",
    "Create Item Resource subclass + sample .tres entries + ItemDB autoload helper for id-based lookup. Default 5 sample items.",
    {
      script_path: z.string().optional().default("res://scripts/data/Item.gd"),
      data_dir: z.string().optional().default("res://data/items"),
      autoload_name: z.string().optional().default("ItemDB"),
      sample_count: z.number().int().min(0).max(50).optional().default(5),
      register_autoload: z.boolean().optional().default(true),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_item_database", config), async (): Promise<ToolResponse> => {
          const helperPath = path.posix.join(params.data_dir.replace(/\/items$/, ""), "ItemDB.gd").replace(/^res:/, "res:");
          const helperResPath = `res://scripts/data/${params.autoload_name}.gd`;
          const samples = ["sword", "potion", "shield", "key", "gold_coin"].slice(0, params.sample_count);
          const sampleFiles = samples.map((s) => `${params.data_dir}/${s}.tres`);

          if (params.dry_run) return dryRun("devpilot_create_item_database",
            [`write ${params.script_path}`, `write ${params.sample_count} sample .tres`, params.register_autoload ? `register autoload '${params.autoload_name}'` : "skip autoload"],
            [params.script_path, helperResPath, ...sampleFiles]);

          await writeFileSafe(config.projectRoot, params.script_path, ITEM_RESOURCE);
          await writeFileSafe(config.projectRoot, helperResPath, DB_HELPER(params.autoload_name, "Item", params.data_dir));
          for (const s of samples) {
            await writeFileSafe(config.projectRoot, `${params.data_dir}/${s}.tres`, itemTres(s, s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " "), s === "potion" ? 99 : s === "gold_coin" ? 999 : 1, s.includes("sword") || s.includes("shield") ? "equipment" : "misc"));
          }
          let autoloadAdded = false;
          if (params.register_autoload) {
            const r = await callRpc(godot, "project.add_autoload", { name: params.autoload_name, path: `*${helperResPath}` });
            autoloadAdded = r.ok;
          }
          return createSuccessResponse({
            script_path: params.script_path,
            data_dir: params.data_dir,
            samples_created: samples,
            autoload_name: params.autoload_name,
            autoload_added: autoloadAdded,
          }, `Item database created (${samples.length} samples).`);
        })
      )
  );

  // ── devpilot_create_enemy_database ─────────────────────────────────────────
  server.tool(
    "devpilot_create_enemy_database",
    "Create EnemyData Resource subclass + sample enemies + EnemyDB autoload helper.",
    {
      script_path: z.string().optional().default("res://scripts/data/EnemyData.gd"),
      data_dir: z.string().optional().default("res://data/enemies"),
      autoload_name: z.string().optional().default("EnemyDB"),
      sample_count: z.number().int().min(0).max(20).optional().default(3),
      register_autoload: z.boolean().optional().default(true),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_enemy_database", config), async (): Promise<ToolResponse> => {
          const helperResPath = `res://scripts/data/${params.autoload_name}.gd`;
          const enemies = [
            { id: "slime", hp: 10, dmg: 2, speed: 60 },
            { id: "goblin", hp: 25, dmg: 5, speed: 90 },
            { id: "skeleton", hp: 40, dmg: 8, speed: 70 },
            { id: "wolf", hp: 30, dmg: 7, speed: 130 },
            { id: "boss", hp: 200, dmg: 20, speed: 50 },
          ].slice(0, params.sample_count);
          const sampleFiles = enemies.map((e) => `${params.data_dir}/${e.id}.tres`);

          if (params.dry_run) return dryRun("devpilot_create_enemy_database",
            [`write ${params.script_path}`, `${params.sample_count} samples`, params.register_autoload ? `autoload '${params.autoload_name}'` : "skip autoload"],
            [params.script_path, helperResPath, ...sampleFiles]);

          await writeFileSafe(config.projectRoot, params.script_path, ENEMY_RESOURCE);
          await writeFileSafe(config.projectRoot, helperResPath, DB_HELPER(params.autoload_name, "EnemyData", params.data_dir));
          for (const e of enemies) {
            await writeFileSafe(config.projectRoot, `${params.data_dir}/${e.id}.tres`, enemyTres(e.id, e.id.charAt(0).toUpperCase() + e.id.slice(1), e.hp, e.dmg, e.speed));
          }
          let autoloadAdded = false;
          if (params.register_autoload) {
            const r = await callRpc(godot, "project.add_autoload", { name: params.autoload_name, path: `*${helperResPath}` });
            autoloadAdded = r.ok;
          }
          return createSuccessResponse({
            script_path: params.script_path, data_dir: params.data_dir, samples_created: enemies.map((e) => e.id), autoload_added: autoloadAdded,
          }, `Enemy database created (${enemies.length} samples).`);
        })
      )
  );

  // ── devpilot_create_dialogue_database ──────────────────────────────────────
  server.tool(
    "devpilot_create_dialogue_database",
    "Create Dialogue Resource (with from_json static helper) + sample .json dialogue files.",
    {
      script_path: z.string().optional().default("res://scripts/data/Dialogue.gd"),
      data_dir: z.string().optional().default("res://data/dialogues"),
      sample_count: z.number().int().min(0).max(20).optional().default(3),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_dialogue_database", config), async (): Promise<ToolResponse> => {
          const samples = ["intro", "merchant", "quest_giver"].slice(0, params.sample_count);
          if (params.dry_run) return dryRun("devpilot_create_dialogue_database", [`write ${params.script_path}`, `${params.sample_count} JSON dialogues`], [params.script_path, ...samples.map((s) => `${params.data_dir}/${s}.json`)]);
          await writeFileSafe(config.projectRoot, params.script_path, DIALOGUE_RESOURCE);
          for (const s of samples) {
            await writeFileSafe(config.projectRoot, `${params.data_dir}/${s}.json`, dialogueJson(s));
          }
          return createSuccessResponse({ script_path: params.script_path, data_dir: params.data_dir, samples_created: samples }, "Dialogue database created.");
        })
      )
  );

  // ── devpilot_create_quest_database ─────────────────────────────────────────
  server.tool(
    "devpilot_create_quest_database",
    "Create Quest Resource subclass + sample .tres quests + QuestDB autoload.",
    {
      script_path: z.string().optional().default("res://scripts/data/Quest.gd"),
      data_dir: z.string().optional().default("res://data/quests"),
      autoload_name: z.string().optional().default("QuestDB"),
      sample_count: z.number().int().min(0).max(10).optional().default(2),
      register_autoload: z.boolean().optional().default(true),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_quest_database", config), async (): Promise<ToolResponse> => {
          const helperResPath = `res://scripts/data/${params.autoload_name}.gd`;
          const quests = [
            { id: "first_steps", title: "First Steps", desc: "Defeat 3 slimes." },
            { id: "find_key", title: "Find the Key", desc: "Locate the missing key in the dungeon." },
          ].slice(0, params.sample_count);

          if (params.dry_run) return dryRun("devpilot_create_quest_database",
            [`write ${params.script_path}`, `${params.sample_count} samples`, params.register_autoload ? `autoload '${params.autoload_name}'` : "skip"],
            [params.script_path, helperResPath, ...quests.map((q) => `${params.data_dir}/${q.id}.tres`)]);

          await writeFileSafe(config.projectRoot, params.script_path, QUEST_RESOURCE);
          await writeFileSafe(config.projectRoot, helperResPath, DB_HELPER(params.autoload_name, "Quest", params.data_dir));
          for (const q of quests) await writeFileSafe(config.projectRoot, `${params.data_dir}/${q.id}.tres`, questTres(q.id, q.title, q.desc));
          let autoloadAdded = false;
          if (params.register_autoload) {
            const r = await callRpc(godot, "project.add_autoload", { name: params.autoload_name, path: `*${helperResPath}` });
            autoloadAdded = r.ok;
          }
          return createSuccessResponse({ script_path: params.script_path, samples_created: quests.map((q) => q.id), autoload_added: autoloadAdded }, "Quest database created.");
        })
      )
  );

  // ── devpilot_create_loot_table ─────────────────────────────────────────────
  server.tool(
    "devpilot_create_loot_table",
    "Create LootTable Resource subclass with weighted roll() method. Stored as a single resource at script_path.",
    {
      script_path: z.string().optional().default("res://scripts/data/LootTable.gd"),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_loot_table", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_create_loot_table", [`write ${params.script_path}`], [params.script_path]);
          await writeFileSafe(config.projectRoot, params.script_path, LOOT_TABLE_RESOURCE);
          return createSuccessResponse({ script_path: params.script_path }, "LootTable Resource class created.");
        })
      )
  );

  // ── devpilot_create_spawn_table ────────────────────────────────────────────
  server.tool(
    "devpilot_create_spawn_table",
    "Create SpawnTable Resource subclass with pick(active_counts) method enforcing per-enemy max_simultaneous.",
    {
      script_path: z.string().optional().default("res://scripts/data/SpawnTable.gd"),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_create_spawn_table", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_create_spawn_table", [`write ${params.script_path}`], [params.script_path]);
          await writeFileSafe(config.projectRoot, params.script_path, SPAWN_TABLE_RESOURCE);
          return createSuccessResponse({ script_path: params.script_path }, "SpawnTable Resource class created.");
        })
      )
  );
}
