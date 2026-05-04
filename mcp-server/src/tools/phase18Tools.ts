import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely, type ToolExecutionContext } from "../safety/toolWrapper.js";

function toMcpResult(response: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    isError: !response.ok
  };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const connection = await godot.connect();
    if (!connection.ok) return connection;
  }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig): ToolExecutionContext {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

export function registerPhase18Tools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool(
    "godot_get_animation_tree_structure",
    "Inspect the full structure of an AnimationTree node (states, transitions, parameters).",
    {
      node_path: z.string().describe("NodePath to AnimationTree.")
    },
    async ({ node_path }) => {
      const result = await executeToolSafely(ctx("godot_get_animation_tree_structure", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "anim.get_tree_structure", { node_path });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_add_state_machine_state",
    "Add a state to an AnimationStateMachine inside an AnimationTree.",
    {
      node_path: z.string().describe("NodePath to AnimationTree."),
      state_name: z.string().describe("New state name."),
      animation_name: z.string().optional().describe("AnimationPlayer track name to link."),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, state_name, animation_name, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_add_state_machine_state", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_add_state_machine_state",
            plannedChanges: [`Add state '${state_name}'${animation_name ? ` linked to animation '${animation_name}'` : ""} to AnimationTree '${node_path}'`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "anim.add_state", { node_path, state_name, animation_name });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_remove_state_machine_state",
    "Remove a state from an AnimationStateMachine.",
    {
      node_path: z.string(),
      state_name: z.string(),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, state_name, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_remove_state_machine_state", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_remove_state_machine_state",
            plannedChanges: [`Remove state '${state_name}' from AnimationTree '${node_path}'`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "anim.remove_state", { node_path, state_name });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_add_state_machine_transition",
    "Add a transition between two states in an AnimationStateMachine.",
    {
      node_path: z.string(),
      from_state: z.string(),
      to_state: z.string(),
      switch_mode: z.enum(["immediate", "sync", "at_end"]).optional(),
      auto_advance: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, from_state, to_state, switch_mode, auto_advance, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_add_state_machine_transition", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_add_state_machine_transition",
            plannedChanges: [`Add transition '${from_state}' → '${to_state}' in AnimationTree '${node_path}'`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "anim.add_transition", { node_path, from_state, to_state, switch_mode, auto_advance });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_remove_state_machine_transition",
    "Remove a transition from an AnimationStateMachine.",
    {
      node_path: z.string(),
      from_state: z.string(),
      to_state: z.string(),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, from_state, to_state, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_remove_state_machine_transition", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_remove_state_machine_transition",
            plannedChanges: [`Remove transition '${from_state}' → '${to_state}' from AnimationTree '${node_path}'`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "anim.remove_transition", { node_path, from_state, to_state });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_blend_tree_node",
    "Add or configure a node in an AnimationNodeBlendTree.",
    {
      node_path: z.string().describe("NodePath to AnimationTree."),
      blend_node_name: z.string().describe("Name for the blend node."),
      blend_node_type: z.enum(["Add2", "Blend2", "Blend3", "TimeScale", "TimeSeek", "OneShot", "Animation"]).describe("AnimationNode type."),
      position_x: z.number().optional(),
      position_y: z.number().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, blend_node_name, blend_node_type, position_x, position_y, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_blend_tree_node", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_blend_tree_node",
            plannedChanges: [`Set blend tree node '${blend_node_name}' (${blend_node_type}) in AnimationTree '${node_path}'`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "anim.set_blend_node", { node_path, blend_node_name, blend_node_type, position_x, position_y });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_tree_parameter",
    "Set a parameter (condition/blend amount) on an AnimationTree.",
    {
      node_path: z.string(),
      parameter: z.string().describe("Parameter path e.g. 'parameters/conditions/is_running'."),
      value: z.unknown().describe("Parameter value."),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, parameter, value, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_tree_parameter", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_tree_parameter",
            plannedChanges: [`Set AnimationTree '${node_path}' parameter '${parameter}' = ${JSON.stringify(value)}`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "anim.set_tree_param", { node_path, parameter, value });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_get_audio_bus_layout",
    "Get the full audio bus layout (all buses with volumes, effects, routing).",
    {},
    async () => {
      const result = await executeToolSafely(ctx("godot_get_audio_bus_layout", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "audio.get_bus_layout", {});
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_add_audio_bus",
    "Add a new audio bus to the AudioServer.",
    {
      name: z.string().describe("Bus name."),
      send_to: z.string().optional().describe("Target bus name. Defaults to 'Master'."),
      volume_db: z.number().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ name, send_to, volume_db, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_add_audio_bus", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_add_audio_bus",
            plannedChanges: [`Add audio bus '${name}' sending to '${send_to ?? "Master"}'`],
            affectedFiles: [],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "audio.add_bus", { name, send_to, volume_db });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_audio_bus",
    "Configure an existing audio bus (volume, mute, solo, send).",
    {
      bus_name: z.string(),
      volume_db: z.number().optional(),
      mute: z.boolean().optional(),
      solo: z.boolean().optional(),
      send_to: z.string().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ bus_name, volume_db, mute, solo, send_to, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_audio_bus", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_audio_bus",
            plannedChanges: [`Configure audio bus '${bus_name}'`],
            affectedFiles: [],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "audio.set_bus", { bus_name, volume_db, mute, solo, send_to });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_add_audio_bus_effect",
    "Add an effect to an audio bus (reverb, delay, compressor, equalizer, limiter).",
    {
      bus_name: z.string(),
      effect_type: z.enum(["reverb", "delay", "compressor", "equalizer", "limiter", "chorus", "distortion", "phaser"]).describe("Effect type to add."),
      dry_run: z.boolean().optional()
    },
    async ({ bus_name, effect_type, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_add_audio_bus_effect", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_add_audio_bus_effect",
            plannedChanges: [`Add '${effect_type}' effect to audio bus '${bus_name}'`],
            affectedFiles: [],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "audio.add_bus_effect", { bus_name, effect_type });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_get_audio_info",
    "Audit all audio nodes in the current scene (AudioStreamPlayer2D/3D).",
    {
      node_path: z.string().optional().describe("Root path to scan. Defaults to scene root.")
    },
    async ({ node_path }) => {
      const result = await executeToolSafely(ctx("godot_get_audio_info", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "audio.get_info", { node_path });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_create_theme",
    "Create a new Theme resource .tres file.",
    {
      path: z.string().describe("res:// path ending in .tres."),
      overwrite: z.boolean().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ path, overwrite, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_create_theme", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_create_theme",
            plannedChanges: [`Create Theme resource at '${path}'${overwrite ? " (overwrite)" : ""}`],
            affectedFiles: [path],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "theme.create", { path, overwrite });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_theme_color",
    "Set a color override in a Theme resource.",
    {
      theme_path: z.string(),
      type: z.string().describe("Control class name e.g. 'Button'."),
      name: z.string().describe("Color name e.g. 'font_color'."),
      color: z.string().describe("Hex color e.g. '#ff0000' or 'rgba(1,0,0,1)'."),
      dry_run: z.boolean().optional()
    },
    async ({ theme_path, type, name, color, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_theme_color", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_theme_color",
            plannedChanges: [`Set Theme color '${type}/${name}' = '${color}' in '${theme_path}'`],
            affectedFiles: [theme_path],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "theme.set_color", { theme_path, type, name, color });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_theme_constant",
    "Set a constant override in a Theme resource.",
    {
      theme_path: z.string(),
      type: z.string(),
      name: z.string(),
      value: z.number(),
      dry_run: z.boolean().optional()
    },
    async ({ theme_path, type, name, value, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_theme_constant", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_theme_constant",
            plannedChanges: [`Set Theme constant '${type}/${name}' = ${value} in '${theme_path}'`],
            affectedFiles: [theme_path],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "theme.set_constant", { theme_path, type, name, value });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_theme_font_size",
    "Set a font size override in a Theme resource.",
    {
      theme_path: z.string(),
      type: z.string(),
      name: z.string(),
      size: z.number().describe("Font size in pixels."),
      dry_run: z.boolean().optional()
    },
    async ({ theme_path, type, name, size, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_theme_font_size", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_theme_font_size",
            plannedChanges: [`Set Theme font size '${type}/${name}' = ${size}px in '${theme_path}'`],
            affectedFiles: [theme_path],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "theme.set_font_size", { theme_path, type, name, size });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_theme_stylebox",
    "Set a StyleBoxFlat override in a Theme resource.",
    {
      theme_path: z.string(),
      type: z.string(),
      name: z.string().describe("StyleBox name e.g. 'normal','hover','pressed'."),
      bg_color: z.string().optional().describe("Background hex color."),
      border_color: z.string().optional(),
      border_width: z.number().optional(),
      corner_radius: z.number().optional(),
      dry_run: z.boolean().optional()
    },
    async ({ theme_path, type, name, bg_color, border_color, border_width, corner_radius, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_theme_stylebox", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_theme_stylebox",
            plannedChanges: [`Set Theme StyleBox '${type}/${name}' in '${theme_path}'`],
            affectedFiles: [theme_path],
            affectedNodes: []
          });
        }
        return callAfterConnect(godot, "theme.set_stylebox", { theme_path, type, name, bg_color, border_color, border_width, corner_radius });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_get_theme_info",
    "Inspect all overrides in a Theme resource.",
    {
      theme_path: z.string()
    },
    async ({ theme_path }) => {
      const result = await executeToolSafely(ctx("godot_get_theme_info", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "theme.get_info", { theme_path });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_set_shader_param",
    "Set a uniform parameter on a ShaderMaterial attached to a node.",
    {
      node_path: z.string(),
      param: z.string().describe("Shader uniform name."),
      value: z.unknown().describe("Value — number, bool, or {r,g,b,a} for Color."),
      dry_run: z.boolean().optional()
    },
    async ({ node_path, param, value, dry_run }) => {
      const result = await executeToolSafely(ctx("godot_set_shader_param", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_set_shader_param",
            plannedChanges: [`Set shader param '${param}' = ${JSON.stringify(value)} on node '${node_path}'`],
            affectedFiles: [],
            affectedNodes: [node_path]
          });
        }
        return callAfterConnect(godot, "shader.set_param", { node_path, param, value });
      });
      return toMcpResult(result);
    }
  );

  server.tool(
    "godot_get_shader_params",
    "Read all shader uniform parameters from a ShaderMaterial on a node.",
    {
      node_path: z.string()
    },
    async ({ node_path }) => {
      const result = await executeToolSafely(ctx("godot_get_shader_params", config), async (): Promise<ToolResponse> => {
        return callAfterConnect(godot, "shader.get_params", { node_path });
      });
      return toMcpResult(result);
    }
  );
}
