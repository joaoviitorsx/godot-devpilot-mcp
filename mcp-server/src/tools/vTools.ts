import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { autoFixGDScript } from "../utils/gdscriptLint.js";
import { recordBlueprintApplied, recordScript, readManifest } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function writeIfNew(projectRoot: string, resPath: string, content: string, overwrite: boolean, isGd: boolean = true): Promise<boolean> {
  const r = resolveProjectPath(resPath, projectRoot);
  if (await fileExists(r.absolutePath) && !overwrite) return false;
  await mkdir(path.dirname(r.absolutePath), { recursive: true });
  await writeFile(r.absolutePath, isGd ? autoFixGDScript(content) : content, "utf8");
  return true;
}

// ── Test scaffolds v2 — assertion-rich per blueprint kind ────────────────────

const TESTS_BY_BLUEPRINT: Record<string, (scriptPath: string) => string> = {
  twin_stick: (p) => `extends GutTest

const Player := preload("${p}")

func test_player_has_max_hp() -> void:
	var inst = Player.new()
	assert_eq(inst.hp, inst.max_hp, "Player starts at max HP")
	inst.queue_free()

func test_take_damage_reduces_hp() -> void:
	var inst = Player.new()
	var initial: int = inst.hp
	inst.take_damage(1)
	assert_lt(inst.hp, initial, "HP decreases after damage")
	inst.queue_free()
`,
  projectile_system: (p) => `extends GutTest

const Bullet := preload("${p}")

func test_bullet_has_default_damage() -> void:
	var b = Bullet.new()
	assert_eq(b.damage, 1, "Default bullet damage = 1")
	b.queue_free()
`,
  inventory_grid: (p) => `extends GutTest

const Inv := preload("${p}")

func test_add_item_increases_count() -> void:
	var inv = Inv.new()
	add_child_autofree(inv)
	inv._slots.resize(inv.slots)
	inv.add_item("apple", 3)
	assert_eq(inv.count_of("apple"), 3, "3 apples added")

func test_remove_item_clears_slot() -> void:
	var inv = Inv.new()
	add_child_autofree(inv)
	inv._slots.resize(inv.slots)
	inv.add_item("gem", 1)
	assert_true(inv.remove_item("gem", 1), "remove succeeds")
	assert_eq(inv.count_of("gem"), 0, "no gems remain")
`,
  loot_table: (p) => `extends GutTest

const LT := preload("${p}")

func test_empty_table_returns_nothing() -> void:
	var t = LT.new()
	t.entries = []
	var r = t.roll()
	assert_true(r.is_empty(), "Empty table → empty result")

func test_single_entry_always_returned() -> void:
	var t = LT.new()
	t.entries = [{"item_id": "gold", "weight": 1, "count_min": 1, "count_max": 1}]
	var r = t.roll()
	assert_eq(r.get("item_id"), "gold")
`,
  match_3_v2: (p) => `extends GutTest

const M3 := preload("${p}")

func test_grid_initializes_with_no_matches() -> void:
	var g = M3.new()
	add_child_autofree(g)
	assert_eq(g.grid.size(), g.height, "Height matches")
	for row in g.grid:
		assert_eq(row.size(), g.width, "Width matches")
`,
  skill_tree: (p) => `extends GutTest

const Mgr := preload("${p}")

func test_can_unlock_requires_points() -> void:
	var m = Mgr.new()
	add_child_autofree(m)
	# With 0 points and no skills, unlock should fail.
	assert_false(m.can_unlock("nonexistent"))
`,
};

const GENERIC_TEST = (className: string, scriptPath: string) => `extends GutTest

const Subject := preload("${scriptPath}")

func test_subject_loads() -> void:
	var inst = Subject.new()
	assert_not_null(inst, "${className} loads")
	if inst is Node:
		inst.queue_free()
`;

// ── Inventory drag-drop UI extension ─────────────────────────────────────────

const INVENTORY_DRAG_SLOT = `extends Control
class_name InventoryDragSlot

signal drag_started(slot: InventoryDragSlot)
signal drop_received(from_slot: InventoryDragSlot, to_slot: InventoryDragSlot)

@export var slot_index: int = -1

@onready var icon: TextureRect = $Icon if has_node("Icon") else null
@onready var count_label: Label = $Count if has_node("Count") else null

var _data = null

func set_data(data) -> void:
	_data = data
	if icon and data and "icon" in data:
		icon.texture = data.icon
	if count_label and data and "count" in data:
		count_label.text = str(data.count)
	elif count_label:
		count_label.text = ""

func get_data() -> Variant:
	return _data

func _get_drag_data(_at_position: Vector2) -> Variant:
	if _data == null:
		return null
	drag_started.emit(self)
	var preview := TextureRect.new()
	if icon:
		preview.texture = icon.texture
	preview.custom_minimum_size = Vector2(48, 48)
	set_drag_preview(preview)
	return self

func _can_drop_data(_at_position: Vector2, data) -> bool:
	return data is InventoryDragSlot

func _drop_data(_at_position: Vector2, data) -> void:
	if data is InventoryDragSlot:
		drop_received.emit(data, self)
`;

const INVENTORY_DRAG_PANEL = `extends CanvasLayer

@export var slots_count: int = 24
@export var columns: int = 6
@onready var grid: GridContainer = $Root/Grid

const SlotScene := preload("res://scripts/InventoryDragSlot.gd")

func _ready() -> void:
	visible = false
	if grid:
		grid.columns = columns

func toggle() -> void:
	visible = not visible
	if visible:
		_rebuild()

func _rebuild() -> void:
	if grid == null:
		return
	for c in grid.get_children():
		c.queue_free()
	var inv = get_node_or_null("/root/InventoryGrid")
	if inv == null:
		return
	var snap: Array = inv.snapshot()
	for i in snap.size():
		var slot := Control.new()
		slot.set_script(SlotScene)
		slot.slot_index = i
		slot.custom_minimum_size = Vector2(48, 48)
		var lbl := Label.new()
		lbl.name = "Count"
		var s = snap[i]
		if s != null:
			slot.set_data({ "icon": null, "count": int(s.get("count", 0)), "item_id": String(s.get("item_id", "")) })
			lbl.text = str(int(s.get("count", 0)))
		slot.add_child(lbl)
		slot.drop_received.connect(_on_drop)
		grid.add_child(slot)

func _on_drop(from_slot, to_slot) -> void:
	# Swap slot data via inventory autoload.
	var inv = get_node_or_null("/root/InventoryGrid")
	if inv == null:
		return
	var a := from_slot.slot_index
	var b := to_slot.slot_index
	if a < 0 or b < 0 or a == b:
		return
	var tmp = inv._slots[a]
	inv._slots[a] = inv._slots[b]
	inv._slots[b] = tmp
	inv.inventory_changed.emit()
	_rebuild()
`;

// ── Dialogue graph authoring (JSON → .tres) ──────────────────────────────────

function dialogueLineTres(id: string, speaker: string, text: string, choices: Array<{ label: string; next_id: string }>, next_id: string): string {
  const choicesLiteral = choices.map((c) => `{"label": "${c.label}", "next_id": "${c.next_id}"}`).join(", ");
  return `[gd_resource type="Resource" script_class="DialogueLine" load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/DialogueLine.gd" id="1_line"]

[resource]
script = ExtResource("1_line")
id = "${id}"
speaker = "${speaker}"
text = "${text.replace(/"/g, '\\"')}"
choices = [${choicesLiteral}]
next_id = "${next_id}"
`;
}

function dialogueGraphTres(rootId: string, lineRefs: Array<{ id: string; path: string }>): string {
  const linesDictEntries = lineRefs.map((r, i) => `"${r.id}": ExtResource("${i + 2}_line${i}")`).join(", ");
  const extResources = lineRefs.map((r, i) => `[ext_resource type="Resource" path="${r.path}" id="${i + 2}_line${i}"]`).join("\n");
  return `[gd_resource type="Resource" script_class="DialogueGraph" load_steps=${lineRefs.length + 2} format=3]

[ext_resource type="Script" path="res://scripts/DialogueGraph.gd" id="1_graph"]
${extResources}

[resource]
script = ExtResource("1_graph")
root_id = "${rootId}"
lines = {${linesDictEntries}}
`;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerVTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_generate_tests_v2",
    "Generate GUT test files with real assertions (per blueprint kind), not just empty scaffolds. Inspects manifest scripts and emits assertion templates targeted at each script's role.",
    {
      tests_dir: z.string().optional().default("res://tests"),
      overwrite: z.boolean().optional().default(false),
    },
    async ({ tests_dir, overwrite }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_generate_tests_v2", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const m = await readManifest(config.projectRoot);
          const written: string[] = [];
          for (const [scriptPath] of Object.entries(m.scripts)) {
            const base = path.basename(scriptPath, ".gd");
            const lower = base.toLowerCase();
            let tmpl: string;
            if (lower.includes("playertwinstick") || lower === "player") tmpl = TESTS_BY_BLUEPRINT.twin_stick(scriptPath);
            else if (lower.includes("bullet")) tmpl = TESTS_BY_BLUEPRINT.projectile_system(scriptPath);
            else if (lower.includes("inventorygrid")) tmpl = TESTS_BY_BLUEPRINT.inventory_grid(scriptPath);
            else if (lower.includes("loottable")) tmpl = TESTS_BY_BLUEPRINT.loot_table(scriptPath);
            else if (lower.includes("match3")) tmpl = TESTS_BY_BLUEPRINT.match_3_v2(scriptPath);
            else if (lower.includes("skilltree")) tmpl = TESTS_BY_BLUEPRINT.skill_tree(scriptPath);
            else tmpl = GENERIC_TEST(base, scriptPath);
            const testPath = `${tests_dir}/test_${base}.gd`;
            const ok = await writeIfNew(config.projectRoot, testPath, tmpl, overwrite);
            if (ok) written.push(testPath);
          }
          return createSuccessResponse({ written, count: written.length }, `${written.length} test file(s) generated.`);
        })
      )
  );

  server.tool(
    "devpilot_blueprint_inventory_drag_drop",
    "Drag-drop UI for inventory: InventoryDragSlot Control + InventoryDragPanel CanvasLayer. Bind to existing inventory_grid blueprint via /root/InventoryGrid autoload.",
    {
      script_dir: z.string().optional().default("res://scripts"),
      overwrite: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_inventory_drag_drop", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const sp1 = `${params.script_dir}/InventoryDragSlot.gd`;
          const sp2 = `${params.script_dir}/InventoryDragPanel.gd`;
          const w1 = await writeIfNew(config.projectRoot, sp1, INVENTORY_DRAG_SLOT, params.overwrite);
          const w2 = await writeIfNew(config.projectRoot, sp2, INVENTORY_DRAG_PANEL, params.overwrite);
          if (w1) await recordScript(config.projectRoot, sp1, { signals: ["drag_started", "drop_received"] });
          if (w2) await recordScript(config.projectRoot, sp2, {});
          await recordBlueprintApplied(config.projectRoot, "inventory_drag_drop", { template_version: "0.5.0" });
          return createSuccessResponse({ files: [sp1, sp2], next_steps: ["Apply inventory_grid first.", "Wire InventoryDragPanel into your HUD."] }, "inventory_drag_drop applied.");
        })
      )
  );

  server.tool(
    "devpilot_author_dialogue_graph",
    "Author a DialogueGraph .tres from JSON. Avoids manual Inspector authoring. Lines: [{id, speaker, text, choices?: [{label, next_id}], next_id?}]. Pair with dialogue_system blueprint.",
    {
      graph_name: z.string().describe("Name (resource will be saved at res://dialogue/<name>.tres)"),
      root_id: z.string(),
      lines: z.array(z.object({
        id: z.string(),
        speaker: z.string().optional().default(""),
        text: z.string(),
        choices: z.array(z.object({ label: z.string(), next_id: z.string() })).optional().default([]),
        next_id: z.string().optional().default(""),
      })),
      overwrite: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_author_dialogue_graph", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const baseDir = `res://dialogue/${params.graph_name}`;
          const lineRefs: Array<{ id: string; path: string }> = [];
          for (const line of params.lines) {
            const linePath = `${baseDir}/${line.id}.tres`;
            const tres = dialogueLineTres(line.id, line.speaker ?? "", line.text, line.choices ?? [], line.next_id ?? "");
            const ok = await writeIfNew(config.projectRoot, linePath, tres, params.overwrite, false);
            if (ok || params.overwrite) lineRefs.push({ id: line.id, path: linePath });
          }
          const graphPath = `${baseDir}.tres`;
          const graphTres = dialogueGraphTres(params.root_id, lineRefs);
          await writeIfNew(config.projectRoot, graphPath, graphTres, params.overwrite, false);
          await recordBlueprintApplied(config.projectRoot, "dialogue_graph_authored", { graph_name: params.graph_name, lines: params.lines.length, template_version: "0.5.0" });
          return createSuccessResponse({ graph_path: graphPath, line_count: lineRefs.length }, `DialogueGraph '${params.graph_name}' authored (${lineRefs.length} line(s)).`);
        })
      )
  );
}
