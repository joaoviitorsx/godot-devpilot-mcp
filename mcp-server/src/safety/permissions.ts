import { createSafetyError } from "./errors.js";

export type ReadOnlyCheck = {
  toolName: string;
  readOnly: boolean;
};

const READ_ONLY_TOOL_ALLOWLIST = new Set([
  "godot_health_check",
  "godot_ping",
  "godot_get_capabilities",
  "godot_get_connection_status",
  "godot_get_protocol_version",
  "godot_read_file",
  "godot_list_files",
  "godot_search_files",
  "godot_get_project_info",
  "godot_get_project_settings",
  "godot_get_scene_tree",
  "godot_get_editor_context",
  "godot_get_open_scenes",
  "godot_get_selected_nodes",
  "godot_get_input_map",
  "godot_get_autoloads",
  "godot_get_scene_tree",
  "godot_get_scene_summary",
  "godot_validate_scene",
  "godot_audit_scene",
  "godot_get_node_properties",
  "godot_get_node_groups",
  "godot_read_script",
  "godot_validate_script",
  "godot_get_classdb_info",
  "godot_get_script_symbols",
  "godot_get_script_dependencies",
  "godot_find_references",
  // Phase 6 — read-only debug tools
  "godot_is_game_running",
  "godot_get_output_logs",
  "godot_get_debugger_errors",
  "godot_get_script_parse_errors",
  "godot_get_last_run_report",
  "godot_assert_no_errors",
  // Phase 7 — read-only screenshot comparison
  "godot_compare_screenshots",
  // Phase 8 — read-only runtime inspection
  "godot_get_runtime_tree",
  "godot_get_runtime_node_properties",
  "godot_get_fps",
  "godot_get_process_stats",
  "godot_wait_for_condition",
  "godot_find_runtime_node",
  "godot_get_current_camera",
  "godot_find_ui_element",
  // Phase 9 — read-only project intelligence
  "godot_project_summary",
  "godot_get_dependency_graph",
  "godot_get_signal_map",
  "godot_impact_check",
  "godot_trace_flow",
  "godot_detect_gameplay_systems",
  "godot_analyze_architecture",
  "godot_validate_conventions",
  // Phase 10 — read-only memory access
  "godot_get_project_memory",
  "godot_get_architecture_notes",
  "godot_get_conventions",
  "godot_search_memory",
  "godot_get_current_task_context",
  // Phase 14 — read-only assertions
  "godot_assert_node_exists",
  "godot_assert_property_equals",
  "godot_assert_signal_emitted",
  "godot_assert_screenshot_matches",
  "godot_run_test_scenario",
  // Phase 13 — read-only (instructional) tools
  "godot_add_animation_track",
  "godot_assign_shader_material",
  // Phase 15 — agentic read-only tools (planning, explanation, checklist)
  "godot_explain_project_architecture",
  "godot_fix_errors_agentic"
]);

export function isToolAllowedInReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOL_ALLOWLIST.has(toolName);
}

export function enforceReadOnlyMode(check: ReadOnlyCheck): void {
  if (!check.readOnly || isToolAllowedInReadOnly(check.toolName)) {
    return;
  }

  throw createSafetyError(
    "READ_ONLY_MODE",
    "Tool is blocked because read-only mode is enabled.",
    { tool: check.toolName },
    ["Switch out of read-only mode only when write operations are intentional."]
  );
}
