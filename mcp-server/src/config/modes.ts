export const TOOL_MODES = ["minimal", "core", "full", "agentic"] as const;

export type ToolMode = (typeof TOOL_MODES)[number];

export const PHASE1_TOOLS = [
  "godot_health_check",
  "godot_ping",
  "godot_get_capabilities",
  "godot_get_connection_status",
  "godot_get_protocol_version"
] as const;

export const PHASE3_TOOLS = [
  "godot_get_project_info",
  "godot_get_project_settings",
  "godot_get_editor_context",
  "godot_get_open_scenes",
  "godot_get_selected_nodes",
  "godot_get_input_map",
  "godot_add_input_action",
  "godot_remove_input_action",
  "godot_get_autoloads",
  "godot_add_autoload",
  "godot_remove_autoload",
  "godot_list_files",
  "godot_search_files",
  "godot_read_file",
  "godot_write_file",
  "godot_patch_file"
] as const;

export const PHASE4_TOOLS = [
  "godot_get_scene_tree",
  "godot_get_scene_summary",
  "godot_validate_scene",
  "godot_audit_scene",
  "godot_create_scene",
  "godot_open_scene",
  "godot_save_scene",
  "godot_duplicate_scene",
  "godot_add_node",
  "godot_remove_node",
  "godot_rename_node",
  "godot_duplicate_node",
  "godot_reparent_node",
  "godot_get_node_properties",
  "godot_set_node_property",
  "godot_get_node_groups",
  "godot_add_node_to_group",
  "godot_remove_node_from_group"
] as const;

export const PHASE5_TOOLS = [
  "godot_create_script",
  "godot_read_script",
  "godot_patch_script",
  "godot_attach_script",
  "godot_validate_script",
  "godot_get_classdb_info",
  "godot_get_script_symbols",
  "godot_get_script_dependencies",
  "godot_find_references",
  "godot_format_script"
] as const;

export const ALL_TOOLS = [...PHASE1_TOOLS, ...PHASE3_TOOLS, ...PHASE4_TOOLS, ...PHASE5_TOOLS] as const;

export type Phase1ToolName = (typeof PHASE1_TOOLS)[number];
export type Phase3ToolName = (typeof PHASE3_TOOLS)[number];
export type Phase4ToolName = (typeof PHASE4_TOOLS)[number];
export type Phase5ToolName = (typeof PHASE5_TOOLS)[number];
export type AllToolName = (typeof ALL_TOOLS)[number];

export type ModeCapabilities = {
  mode: ToolMode;
  tools: readonly AllToolName[];
  toolsCount: number;
  availableCategories: string[];
  features: {
    json_rpc: boolean;
    health_check: boolean;
    heartbeat: boolean;
    reconnect: boolean;
    project_tools: boolean;
    undo_redo: boolean;
    debug_loop: boolean;
    screenshots: boolean;
    input_simulation: boolean;
    runtime_tree: boolean;
    project_intelligence: boolean;
    project_memory: boolean;
  };
};

export function normalizeMode(value: string | undefined): ToolMode {
  if (value && (TOOL_MODES as readonly string[]).includes(value)) {
    return value as ToolMode;
  }

  return "core";
}

export function getModeCapabilities(mode: ToolMode): ModeCapabilities {
  return {
    mode,
    tools: ALL_TOOLS,
    toolsCount: ALL_TOOLS.length,
    availableCategories: ["core", "connection", "protocol", "project", "files", "scene", "node", "script"],
    features: {
      json_rpc: true,
      health_check: true,
      heartbeat: true,
      reconnect: true,
      project_tools: true,
      undo_redo: true,
      debug_loop: true,
      screenshots: true,
      input_simulation: true,
      runtime_tree: true,
      project_intelligence: true,
      project_memory: true
    }
  };
}
