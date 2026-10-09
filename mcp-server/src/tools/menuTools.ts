import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createErrorResponse, createSuccessResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { createSafetyError } from "../safety/errors.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
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

async function fileExists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }

async function writeScript(projectRoot: string, resPath: string, content: string, allowOverwrite: boolean) {
  const resolved = resolveProjectPath(resPath, projectRoot);
  if (!resolved.resPath.endsWith(".gd")) throw createSafetyError("INVALID_PARAMS", "must end .gd", {}, []);
  if (await fileExists(resolved.absolutePath) && !allowOverwrite) return { written: false as const, reason: "exists" };
  await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, autoFixGDScript(content), "utf8");
  return { written: true as const };
}

const addNode = (g: GodotClient, parent: string, type: string, name: string) =>
  callRpc(g, "node.add", { parent_path: parent, node_type: type, node_name: name });
const setP = (g: GodotClient, nodePath: string, property: string, value: unknown) =>
  callRpc(g, "node.set_property", { node_path: nodePath, property, value });
const attach = (g: GodotClient, nodePath: string, scriptPath: string) =>
  callRpc(g, "script.attach", { node_path: nodePath, script_path: scriptPath });
const childPath = (parent: string, name: string) => parent === "." ? name : `${parent}/${name}`;
const dryRun = (toolName: string, plan: string[], files?: string[], nodes?: string[]) =>
  createDryRunResponse({ toolName, plannedChanges: plan, affectedFiles: files, affectedNodes: nodes });

// ── Templates ────────────────────────────────────────────────────────────────

const MAIN_MENU = `extends CanvasLayer

@export var play_scene_path: String = "res://scenes/main.tscn"
@export var settings_scene_path: String = "res://scenes/settings.tscn"

@onready var play_btn: Button = $Root/VBox/Play
@onready var settings_btn: Button = $Root/VBox/Settings
@onready var quit_btn: Button = $Root/VBox/Quit

func _ready() -> void:
	if play_btn:
		play_btn.pressed.connect(_on_play)
		play_btn.grab_focus()
	if settings_btn:
		settings_btn.pressed.connect(_on_settings)
	if quit_btn:
		quit_btn.pressed.connect(_on_quit)

func _on_play() -> void:
	if play_scene_path != "":
		get_tree().change_scene_to_file(play_scene_path)

func _on_settings() -> void:
	if settings_scene_path != "":
		get_tree().change_scene_to_file(settings_scene_path)

func _on_quit() -> void:
	get_tree().quit()
`;

const SETTINGS_MENU = `extends CanvasLayer

@onready var back_btn: Button = $Root/VBox/Back

func _ready() -> void:
	if back_btn:
		back_btn.pressed.connect(_on_back)
		back_btn.grab_focus()

func _on_back() -> void:
	get_tree().change_scene_to_file("res://scenes/main_menu.tscn")
`;

const KEYBINDING_MENU = `extends CanvasLayer

signal binding_changed(action: StringName, key: int)

@onready var list: VBoxContainer = $Root/Scroll/VBox

var _waiting_action: StringName = &""
var _waiting_button: Button = null

func _ready() -> void:
	for action in InputMap.get_actions():
		if str(action).begins_with("ui_"):
			continue
		_add_row(action)

func _add_row(action: StringName) -> void:
	var hbox := HBoxContainer.new()
	var label := Label.new()
	label.text = str(action)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var button := Button.new()
	button.text = _format_event(action)
	button.pressed.connect(func(): _on_rebind(action, button))
	hbox.add_child(label)
	hbox.add_child(button)
	list.add_child(hbox)

func _format_event(action: StringName) -> String:
	var events := InputMap.action_get_events(action)
	if events.is_empty():
		return "<unbound>"
	var ev = events[0]
	if ev is InputEventKey:
		return OS.get_keycode_string(ev.keycode)
	return ev.as_text()

func _on_rebind(action: StringName, button: Button) -> void:
	_waiting_action = action
	_waiting_button = button
	button.text = "Press a key..."

func _input(event: InputEvent) -> void:
	if _waiting_action == &"":
		return
	if event is InputEventKey and event.pressed:
		InputMap.action_erase_events(_waiting_action)
		InputMap.action_add_event(_waiting_action, event)
		if _waiting_button:
			_waiting_button.text = OS.get_keycode_string(event.keycode)
		binding_changed.emit(_waiting_action, event.keycode)
		_waiting_action = &""
		_waiting_button = null
		get_viewport().set_input_as_handled()
`;

const AUDIO_SETTINGS = `extends CanvasLayer

@onready var master_slider: HSlider = $Root/VBox/Master/Slider
@onready var music_slider: HSlider = $Root/VBox/Music/Slider
@onready var sfx_slider: HSlider = $Root/VBox/SFX/Slider
@onready var back_btn: Button = $Root/VBox/Back

func _ready() -> void:
	_setup_slider(master_slider, "Master")
	_setup_slider(music_slider, "Music")
	_setup_slider(sfx_slider, "SFX")
	if back_btn:
		back_btn.pressed.connect(func(): get_tree().change_scene_to_file("res://scenes/settings.tscn"))

func _setup_slider(slider: HSlider, bus_name: String) -> void:
	if slider == null:
		return
	slider.min_value = 0.0
	slider.max_value = 1.0
	slider.step = 0.01
	var idx := AudioServer.get_bus_index(bus_name)
	if idx >= 0:
		slider.value = db_to_linear(AudioServer.get_bus_volume_db(idx))
		slider.value_changed.connect(func(v): AudioServer.set_bus_volume_db(idx, linear_to_db(v)))
`;

const VIDEO_SETTINGS = `extends CanvasLayer

@onready var resolution: OptionButton = $Root/VBox/Resolution
@onready var fullscreen: CheckBox = $Root/VBox/Fullscreen
@onready var vsync: CheckBox = $Root/VBox/VSync
@onready var back_btn: Button = $Root/VBox/Back

const RESOLUTIONS := [Vector2i(1280, 720), Vector2i(1920, 1080), Vector2i(2560, 1440)]

func _ready() -> void:
	if resolution:
		for r in RESOLUTIONS:
			resolution.add_item("%dx%d" % [r.x, r.y])
		resolution.item_selected.connect(_on_resolution)
	if fullscreen:
		fullscreen.toggled.connect(_on_fullscreen)
	if vsync:
		vsync.toggled.connect(_on_vsync)
	if back_btn:
		back_btn.pressed.connect(func(): get_tree().change_scene_to_file("res://scenes/settings.tscn"))

func _on_resolution(idx: int) -> void:
	DisplayServer.window_set_size(RESOLUTIONS[idx])

func _on_fullscreen(enabled: bool) -> void:
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if enabled else DisplayServer.WINDOW_MODE_WINDOWED)

func _on_vsync(enabled: bool) -> void:
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if enabled else DisplayServer.VSYNC_DISABLED)
`;

const GAME_OVER = `extends CanvasLayer

@export var main_scene_path: String = "res://scenes/main.tscn"
@export var menu_scene_path: String = "res://scenes/main_menu.tscn"

@onready var retry_btn: Button = $Root/VBox/Retry
@onready var menu_btn: Button = $Root/VBox/MainMenu

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if retry_btn:
		retry_btn.pressed.connect(_on_retry)
		retry_btn.grab_focus()
	if menu_btn:
		menu_btn.pressed.connect(_on_menu)

func _on_retry() -> void:
	get_tree().paused = false
	if main_scene_path != "":
		get_tree().change_scene_to_file(main_scene_path)

func _on_menu() -> void:
	get_tree().paused = false
	if menu_scene_path != "":
		get_tree().change_scene_to_file(menu_scene_path)
`;

const LEVEL_SELECT = `extends CanvasLayer

@export var levels_dir: String = "res://scenes/levels"

@onready var grid: GridContainer = $Root/Scroll/Grid
@onready var back_btn: Button = $Root/Back

func _ready() -> void:
	if grid:
		grid.columns = 4
		_populate()
	if back_btn:
		back_btn.pressed.connect(func(): get_tree().change_scene_to_file("res://scenes/main_menu.tscn"))

func _populate() -> void:
	var dir := DirAccess.open(levels_dir)
	if dir == null:
		return
	dir.list_dir_begin()
	var fname := dir.get_next()
	var first_btn: Button = null
	while fname != "":
		if fname.ends_with(".tscn"):
			var btn := Button.new()
			btn.text = fname.get_basename()
			var full_path := levels_dir + "/" + fname
			btn.pressed.connect(func(): get_tree().change_scene_to_file(full_path))
			grid.add_child(btn)
			if first_btn == null:
				first_btn = btn
		fname = dir.get_next()
	if first_btn:
		first_btn.grab_focus()
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function buildCanvasMenu(godot: GodotClient, parent: string, name: string, builder: (paths: { menu: string; root: string }) => Promise<ToolResponse[]>): Promise<ToolResponse[]> {
  const menuPath = childPath(parent, name);
  const rootPath = `${menuPath}/Root`;
  const ops: ToolResponse[] = [];
  ops.push(await addNode(godot, parent, "CanvasLayer", name));
  ops.push(await addNode(godot, menuPath, "Control", "Root"));
  ops.push(await setP(godot, rootPath, "anchors_preset", 15));
  const more = await builder({ menu: menuPath, root: rootPath });
  ops.push(...more);
  return ops;
}

async function addButton(godot: GodotClient, parentPath: string, name: string, text: string): Promise<ToolResponse[]> {
  const btnPath = `${parentPath}/${name}`;
  return [
    await addNode(godot, parentPath, "Button", name),
    await setP(godot, btnPath, "text", text),
  ];
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerMenuTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_create_main_menu ─────────────────────────────────────────────
  server.tool(
    "devpilot_create_main_menu",
    "Create a Main Menu CanvasLayer with Play/Settings/Quit buttons. First button auto-grabs focus.",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("MainMenu"),
      play_scene_path: z.string().optional().default("res://scenes/main.tscn"),
      settings_scene_path: z.string().optional().default("res://scenes/settings.tscn"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) => toMcpResult(await executeToolSafely(ctx("devpilot_create_main_menu", config), async () => {
      const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
      const menuPath = childPath(params.parent_path, params.name);
      const vboxPath = `${menuPath}/Root/VBox`;
      if (params.dry_run) return dryRun("devpilot_create_main_menu", [`add CanvasLayer/Control/VBox + Play/Settings/Quit`, `write ${scriptPath}`], [scriptPath], [menuPath]);
      const w = await writeScript(config.projectRoot, scriptPath, MAIN_MENU, params.overwrite_script);
      if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", "Script exists.", { path: scriptPath }, ["overwrite_script=true"]) as ToolResponse;
      const ops = await buildCanvasMenu(godot, params.parent_path, params.name, async ({ root }) => {
        const inner: ToolResponse[] = [
          await addNode(godot, root, "VBoxContainer", "VBox"),
          await setP(godot, `${root}/VBox`, "anchors_preset", 8),
        ];
        inner.push(...await addButton(godot, vboxPath, "Play", "Play"));
        inner.push(...await addButton(godot, vboxPath, "Settings", "Settings"));
        inner.push(...await addButton(godot, vboxPath, "Quit", "Quit"));
        return inner;
      });
      ops.push(await attach(godot, menuPath, scriptPath));
      ops.push(await setP(godot, menuPath, "play_scene_path", params.play_scene_path));
      ops.push(await setP(godot, menuPath, "settings_scene_path", params.settings_scene_path));
      const fail = ops.find((o) => !o.ok);
      if (fail) return fail;
      return createSuccessResponse({ menu_path: menuPath, script_path: scriptPath }, "Main menu created.");
    }))
  );

  // ── devpilot_create_pause_menu (alias to v1.8.0 — kept for menuTools discoverability) ──
  // Use devpilot_create_pause_menu from gameSystemTools.ts; not redefined here.

  // ── devpilot_create_settings_menu ─────────────────────────────────────────
  server.tool(
    "devpilot_create_settings_menu",
    "Create a Settings hub menu with Back button. Tabs (audio/video/keybinding) created via separate tools.",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("SettingsMenu"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) => toMcpResult(await executeToolSafely(ctx("devpilot_create_settings_menu", config), async () => {
      const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
      const menuPath = childPath(params.parent_path, params.name);
      const vboxPath = `${menuPath}/Root/VBox`;
      if (params.dry_run) return dryRun("devpilot_create_settings_menu", [`add CanvasLayer + VBox + Back`, `write ${scriptPath}`], [scriptPath], [menuPath]);
      const w = await writeScript(config.projectRoot, scriptPath, SETTINGS_MENU, params.overwrite_script);
      if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", "Script exists.", { path: scriptPath }, []) as ToolResponse;
      const ops = await buildCanvasMenu(godot, params.parent_path, params.name, async ({ root }) => [
        await addNode(godot, root, "VBoxContainer", "VBox"),
        await setP(godot, vboxPath, "anchors_preset", 8),
        ...await addButton(godot, vboxPath, "Audio", "Audio"),
        ...await addButton(godot, vboxPath, "Video", "Video"),
        ...await addButton(godot, vboxPath, "Keybindings", "Keybindings"),
        ...await addButton(godot, vboxPath, "Back", "Back"),
      ]);
      ops.push(await attach(godot, menuPath, scriptPath));
      const fail = ops.find((o) => !o.ok);
      if (fail) return fail;
      return createSuccessResponse({ menu_path: menuPath, script_path: scriptPath }, "Settings menu created.");
    }))
  );

  // ── devpilot_create_keybinding_menu ───────────────────────────────────────
  server.tool(
    "devpilot_create_keybinding_menu",
    "Create a Keybinding rebind menu. Auto-iterates non-ui_* InputMap actions and provides press-to-rebind buttons.",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("KeybindingMenu"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) => toMcpResult(await executeToolSafely(ctx("devpilot_create_keybinding_menu", config), async () => {
      const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
      const menuPath = childPath(params.parent_path, params.name);
      const scrollPath = `${menuPath}/Root/Scroll`;
      const vboxPath = `${scrollPath}/VBox`;
      if (params.dry_run) return dryRun("devpilot_create_keybinding_menu", [`add CanvasLayer + ScrollContainer/VBox`, `write ${scriptPath}`], [scriptPath], [menuPath]);
      const w = await writeScript(config.projectRoot, scriptPath, KEYBINDING_MENU, params.overwrite_script);
      if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", "Script exists.", {}, []) as ToolResponse;
      const ops = await buildCanvasMenu(godot, params.parent_path, params.name, async ({ root }) => [
        await addNode(godot, root, "ScrollContainer", "Scroll"),
        await setP(godot, scrollPath, "anchors_preset", 15),
        await addNode(godot, scrollPath, "VBoxContainer", "VBox"),
      ]);
      ops.push(await attach(godot, menuPath, scriptPath));
      const fail = ops.find((o) => !o.ok);
      if (fail) return fail;
      return createSuccessResponse({ menu_path: menuPath, script_path: scriptPath }, "Keybinding menu created.");
    }))
  );

  // ── devpilot_create_audio_settings ────────────────────────────────────────
  server.tool(
    "devpilot_create_audio_settings",
    "Create Audio settings menu with Master/Music/SFX volume sliders bound to AudioServer buses.",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("AudioSettings"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) => toMcpResult(await executeToolSafely(ctx("devpilot_create_audio_settings", config), async () => {
      const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
      const menuPath = childPath(params.parent_path, params.name);
      const vboxPath = `${menuPath}/Root/VBox`;
      if (params.dry_run) return dryRun("devpilot_create_audio_settings", [`add HBoxes + Sliders for Master/Music/SFX`, `write ${scriptPath}`], [scriptPath], [menuPath]);
      const w = await writeScript(config.projectRoot, scriptPath, AUDIO_SETTINGS, params.overwrite_script);
      if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", "Script exists.", {}, []) as ToolResponse;
      const buildBus = async (busName: string): Promise<ToolResponse[]> => {
        const hboxPath = `${vboxPath}/${busName}`;
        return [
          await addNode(godot, vboxPath, "HBoxContainer", busName),
          await addNode(godot, hboxPath, "Label", "Label"),
          await setP(godot, `${hboxPath}/Label`, "text", busName),
          await addNode(godot, hboxPath, "HSlider", "Slider"),
        ];
      };
      const ops = await buildCanvasMenu(godot, params.parent_path, params.name, async ({ root }) => {
        const inner: ToolResponse[] = [
          await addNode(godot, root, "VBoxContainer", "VBox"),
          await setP(godot, vboxPath, "anchors_preset", 8),
        ];
        inner.push(...await buildBus("Master"));
        inner.push(...await buildBus("Music"));
        inner.push(...await buildBus("SFX"));
        inner.push(...await addButton(godot, vboxPath, "Back", "Back"));
        return inner;
      });
      ops.push(await attach(godot, menuPath, scriptPath));
      const fail = ops.find((o) => !o.ok);
      if (fail) return fail;
      return createSuccessResponse({ menu_path: menuPath, script_path: scriptPath, buses: ["Master", "Music", "SFX"] }, "Audio settings created.");
    }))
  );

  // ── devpilot_create_video_settings ────────────────────────────────────────
  server.tool(
    "devpilot_create_video_settings",
    "Create Video settings menu (resolution OptionButton, fullscreen + vsync CheckBoxes).",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("VideoSettings"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) => toMcpResult(await executeToolSafely(ctx("devpilot_create_video_settings", config), async () => {
      const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
      const menuPath = childPath(params.parent_path, params.name);
      const vboxPath = `${menuPath}/Root/VBox`;
      if (params.dry_run) return dryRun("devpilot_create_video_settings", [`add OptionButton + CheckBoxes`, `write ${scriptPath}`], [scriptPath], [menuPath]);
      const w = await writeScript(config.projectRoot, scriptPath, VIDEO_SETTINGS, params.overwrite_script);
      if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", "Script exists.", {}, []) as ToolResponse;
      const ops = await buildCanvasMenu(godot, params.parent_path, params.name, async ({ root }) => [
        await addNode(godot, root, "VBoxContainer", "VBox"),
        await setP(godot, vboxPath, "anchors_preset", 8),
        await addNode(godot, vboxPath, "OptionButton", "Resolution"),
        await addNode(godot, vboxPath, "CheckBox", "Fullscreen"),
        await setP(godot, `${vboxPath}/Fullscreen`, "text", "Fullscreen"),
        await addNode(godot, vboxPath, "CheckBox", "VSync"),
        await setP(godot, `${vboxPath}/VSync`, "text", "VSync"),
        ...await addButton(godot, vboxPath, "Back", "Back"),
      ]);
      ops.push(await attach(godot, menuPath, scriptPath));
      const fail = ops.find((o) => !o.ok);
      if (fail) return fail;
      return createSuccessResponse({ menu_path: menuPath, script_path: scriptPath }, "Video settings created.");
    }))
  );

  // ── devpilot_create_game_over_screen ──────────────────────────────────────
  server.tool(
    "devpilot_create_game_over_screen",
    "Create a Game Over CanvasLayer with Retry / Main Menu buttons. Process mode = ALWAYS so it works while paused.",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("GameOver"),
      main_scene_path: z.string().optional().default("res://scenes/main.tscn"),
      menu_scene_path: z.string().optional().default("res://scenes/main_menu.tscn"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) => toMcpResult(await executeToolSafely(ctx("devpilot_create_game_over_screen", config), async () => {
      const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
      const menuPath = childPath(params.parent_path, params.name);
      const vboxPath = `${menuPath}/Root/VBox`;
      if (params.dry_run) return dryRun("devpilot_create_game_over_screen", [`add CanvasLayer + Label + Retry/MainMenu`, `write ${scriptPath}`], [scriptPath], [menuPath]);
      const w = await writeScript(config.projectRoot, scriptPath, GAME_OVER, params.overwrite_script);
      if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", "Script exists.", {}, []) as ToolResponse;
      const ops = await buildCanvasMenu(godot, params.parent_path, params.name, async ({ root }) => [
        await addNode(godot, root, "VBoxContainer", "VBox"),
        await setP(godot, vboxPath, "anchors_preset", 8),
        await addNode(godot, vboxPath, "Label", "Title"),
        await setP(godot, `${vboxPath}/Title`, "text", "Game Over"),
        ...await addButton(godot, vboxPath, "Retry", "Retry"),
        ...await addButton(godot, vboxPath, "MainMenu", "Main Menu"),
      ]);
      ops.push(await attach(godot, menuPath, scriptPath));
      ops.push(await setP(godot, menuPath, "main_scene_path", params.main_scene_path));
      ops.push(await setP(godot, menuPath, "menu_scene_path", params.menu_scene_path));
      const fail = ops.find((o) => !o.ok);
      if (fail) return fail;
      return createSuccessResponse({ menu_path: menuPath, script_path: scriptPath }, "Game over screen created.");
    }))
  );

  // ── devpilot_create_level_select_screen ───────────────────────────────────
  server.tool(
    "devpilot_create_level_select_screen",
    "Create a Level Select grid that auto-discovers .tscn files from a folder (default res://scenes/levels/).",
    {
      parent_path: z.string().optional().default("."),
      name: z.string().optional().default("LevelSelect"),
      levels_dir: z.string().optional().default("res://scenes/levels"),
      script_path: z.string().optional(),
      overwrite_script: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) => toMcpResult(await executeToolSafely(ctx("devpilot_create_level_select_screen", config), async () => {
      const scriptPath = params.script_path ?? `res://scripts/${params.name}.gd`;
      const menuPath = childPath(params.parent_path, params.name);
      const scrollPath = `${menuPath}/Root/Scroll`;
      if (params.dry_run) return dryRun("devpilot_create_level_select_screen", [`add CanvasLayer + Scroll/Grid + Back`, `write ${scriptPath}`], [scriptPath], [menuPath]);
      const w = await writeScript(config.projectRoot, scriptPath, LEVEL_SELECT, params.overwrite_script);
      if (!w.written) return createErrorResponse("FILE_ALREADY_EXISTS", "Script exists.", {}, []) as ToolResponse;
      const ops = await buildCanvasMenu(godot, params.parent_path, params.name, async ({ root }) => [
        await addNode(godot, root, "ScrollContainer", "Scroll"),
        await setP(godot, scrollPath, "anchors_preset", 15),
        await addNode(godot, scrollPath, "GridContainer", "Grid"),
        ...await addButton(godot, root, "Back", "Back"),
      ]);
      ops.push(await attach(godot, menuPath, scriptPath));
      ops.push(await setP(godot, menuPath, "levels_dir", params.levels_dir));
      const fail = ops.find((o) => !o.ok);
      if (fail) return fail;
      return createSuccessResponse({ menu_path: menuPath, script_path: scriptPath, levels_dir: params.levels_dir }, "Level select created.");
    }))
  );
}
