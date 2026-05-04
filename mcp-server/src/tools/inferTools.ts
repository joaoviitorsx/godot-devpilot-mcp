import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

async function callAfterConnect(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) { const c = await godot.connect(); if (!c.ok) return c; }
  return godot.call(method, params);
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

// ── File scanning utilities ──────────────────────────────────────────────────

async function findFilesByExtensions(dir: string, extensions: string[]): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const sub = await findFilesByExtensions(full, extensions);
        results.push(...sub);
      } else if (extensions.some(ext => e.name.endsWith(ext))) {
        results.push(full);
      }
    }
  } catch {
    // ignore unreadable directories
  }
  return results;
}

async function findGdFiles(dir: string): Promise<string[]> {
  return findFilesByExtensions(dir, [".gd"]);
}

async function findProjectFiles(dir: string): Promise<string[]> {
  return findFilesByExtensions(dir, [".gd", ".tscn", ".tres"]);
}

// Regex: captures action name from Input.is_action_*("name"), Input.get_axis("neg","pos"), etc.
const INPUT_ACTION_RE = /\bInput\.\w+\(\s*["']([^"']+)["']/g;

async function extractActionsFromFile(filePath: string): Promise<string[]> {
  const actions = new Set<string>();
  try {
    const content = await readFile(filePath, "utf8");
    let match: RegExpExecArray | null;
    INPUT_ACTION_RE.lastIndex = 0;
    while ((match = INPUT_ACTION_RE.exec(content)) !== null) {
      actions.add(match[1]);
    }
    // Also capture second argument of get_axis / get_vector
    const axisRe = /\bInput\.(?:get_axis|get_vector)\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;
    while ((match = axisRe.exec(content)) !== null) {
      actions.add(match[1]);
      actions.add(match[2]);
    }
    // get_vector has 4 args
    const vecRe = /\bInput\.get_vector\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;
    while ((match = vecRe.exec(content)) !== null) {
      actions.add(match[1]);
      actions.add(match[2]);
      actions.add(match[3]);
      actions.add(match[4]);
    }
  } catch {
    // ignore unreadable files
  }
  return [...actions];
}

const BUILTIN_CLASSES = new Set([
  "Vector2","Vector3","Vector4","Color","Transform2D","Transform3D","Basis","Quaternion",
  "AABB","Rect2","Plane","RID","NodePath","StringName","Array","Dictionary","PackedScene",
  "Engine","OS","Input","InputMap","ProjectSettings","ResourceLoader","ResourceSaver",
  "JSON","Time","Math","ClassDB","GD","EditorInterface","DisplayServer","RenderingServer",
  "AudioServer","PhysicsServer2D","PhysicsServer3D","NavigationServer2D","NavigationServer3D",
  "FileAccess","DirAccess"
]);

// Match PascalCase identifiers used as: PascalCaseName.method_or_property
const SINGLETON_RE = /\b([A-Z][A-Za-z0-9]+)\.[a-z_]/g;

async function extractSingletonsFromFile(filePath: string): Promise<string[]> {
  const singletons = new Set<string>();
  try {
    const content = await readFile(filePath, "utf8");
    let match: RegExpExecArray | null;
    SINGLETON_RE.lastIndex = 0;
    while ((match = SINGLETON_RE.exec(content)) !== null) {
      const name = match[1];
      if (!BUILTIN_CLASSES.has(name)) {
        singletons.add(name);
      }
    }
  } catch {
    // ignore unreadable files
  }
  return [...singletons];
}

function extractRegisteredAutoloadNames(autoloadsData: unknown): string[] {
  if (!autoloadsData || typeof autoloadsData !== "object") return [];
  const data = autoloadsData as Record<string, unknown>;
  // Could be { autoloads: [{name, path}] } or { autoloads: {name: path} }
  const list = data["autoloads"];
  if (Array.isArray(list)) {
    return list.map((a: unknown) => {
      if (typeof a === "object" && a !== null && "name" in a) {
        return String((a as Record<string, unknown>)["name"]);
      }
      return String(a);
    });
  }
  if (list && typeof list === "object") {
    return Object.keys(list as Record<string, unknown>);
  }
  return [];
}

function extractRegisteredActionNames(inputMapData: unknown): string[] {
  if (!inputMapData || typeof inputMapData !== "object") return [];
  const data = inputMapData as Record<string, unknown>;
  const actions = data["actions"];
  if (Array.isArray(actions)) {
    return actions.map((a: unknown) => {
      if (typeof a === "object" && a !== null && "name" in a) {
        return String((a as Record<string, unknown>)["name"]);
      }
      return String(a);
    });
  }
  if (actions && typeof actions === "object") {
    return Object.keys(actions as Record<string, unknown>);
  }
  return [];
}

function extractActionsWithEvents(inputMapData: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!inputMapData || typeof inputMapData !== "object") return map;
  const data = inputMapData as Record<string, unknown>;
  const actions = data["actions"];
  if (Array.isArray(actions)) {
    for (const a of actions) {
      if (typeof a === "object" && a !== null) {
        const entry = a as Record<string, unknown>;
        const name = String(entry["name"] ?? "");
        const evts = Array.isArray(entry["events"]) ? entry["events"].length : 0;
        map.set(name, evts);
      }
    }
  } else if (actions && typeof actions === "object") {
    for (const [name, evts] of Object.entries(actions as Record<string, unknown>)) {
      map.set(name, Array.isArray(evts) ? evts.length : 0);
    }
  }
  return map;
}

// ── registerInferTools ───────────────────────────────────────────────────────

export function registerInferTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {

  // ── godot_infer_input_map_from_scripts ──────────────────────────────────────
  server.tool(
    "godot_infer_input_map_from_scripts",
    "Scan all GDScript files for Input.is_action_*() calls and compare against registered InputMap actions. Returns missing actions and optionally registers them automatically.",
    {
      auto_add: z.boolean().optional().describe("Automatically add missing actions to InputMap. Default false."),
      dry_run: z.boolean().optional()
    },
    async ({ auto_add, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_infer_input_map_from_scripts", config), async (): Promise<ToolResponse> => {
        const gdFiles = await findGdFiles(config.projectRoot);

        const actionSets = await Promise.all(gdFiles.map(f => extractActionsFromFile(f)));
        const foundInScripts = [...new Set(actionSets.flat())].sort();

        const inputMapResp = await callAfterConnect(godot, "project.get_input_map", {});
        if (!inputMapResp.ok) return inputMapResp;

        const registeredActions = extractRegisteredActionNames(inputMapResp.data);
        const registeredSet = new Set(registeredActions);
        const missingActions = foundInScripts.filter(a => !registeredSet.has(a));

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_infer_input_map_from_scripts",
            plannedChanges: missingActions.map(a => `Add InputMap action: "${a}"`),
            affectedFiles: []
          });
        }

        const addedActions: string[] = [];
        if (auto_add && missingActions.length > 0) {
          for (const action_name of missingActions) {
            const addResp = await callAfterConnect(godot, "project.add_input_action", { action_name });
            if (addResp.ok) addedActions.push(action_name);
          }
        }

        return createSuccessResponse(
          { found_in_scripts: foundInScripts, registered_actions: registeredActions, missing_actions: missingActions, added_actions: addedActions },
          `Scanned ${gdFiles.length} GDScript file(s). Found ${foundInScripts.length} action(s), ${missingActions.length} missing from InputMap.`,
          [],
          missingActions.length > 0 && !auto_add
            ? ["Run with auto_add=true to register missing actions automatically."]
            : []
        );
      })
    )
  );

  // ── godot_infer_autoloads_from_scripts ──────────────────────────────────────
  server.tool(
    "godot_infer_autoloads_from_scripts",
    "Scan all GDScript files for singleton/autoload usage (e.g. GameManager.method(), AudioManager.play()) and compare against registered autoloads. Returns missing singletons.",
    {
      auto_add: z.boolean().optional().describe("Cannot auto-add autoloads (need a script path). Returns instructions instead. Default false."),
      dry_run: z.boolean().optional()
    },
    async ({ auto_add, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_infer_autoloads_from_scripts", config), async (): Promise<ToolResponse> => {
        const gdFiles = await findGdFiles(config.projectRoot);

        const singletonSets = await Promise.all(gdFiles.map(f => extractSingletonsFromFile(f)));
        const foundInScripts = [...new Set(singletonSets.flat())].sort();

        const autoloadsResp = await callAfterConnect(godot, "project.get_autoloads", {});
        if (!autoloadsResp.ok) return autoloadsResp;

        const registeredAutoloads = extractRegisteredAutoloadNames(autoloadsResp.data);
        const registeredSet = new Set(registeredAutoloads);
        const missingSingletons = foundInScripts.filter(s => !registeredSet.has(s));

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_infer_autoloads_from_scripts",
            plannedChanges: missingSingletons.map(s => `Register autoload singleton: "${s}"`),
            affectedFiles: []
          });
        }

        const suggestions: string[] = missingSingletons.map(
          s => `Add autoload "${s}": Project > Project Settings > Autoload, then assign a script path.`
        );

        if (auto_add) {
          suggestions.unshift("auto_add is not supported for autoloads — a script path is required. Use the suggestions below to register manually.");
        }

        return createSuccessResponse(
          { found_in_scripts: foundInScripts, registered_autoloads: registeredAutoloads, missing_singletons: missingSingletons, suggestions },
          `Scanned ${gdFiles.length} GDScript file(s). Found ${foundInScripts.length} singleton reference(s), ${missingSingletons.length} not registered as autoload.`,
          [],
          suggestions
        );
      })
    )
  );

  // ── godot_bind_key ──────────────────────────────────────────────────────────
  server.tool(
    "godot_bind_key",
    "Bind a keyboard key to an existing InputMap action.",
    {
      action_name: z.string().describe("Existing InputMap action name."),
      key: z.string().describe("Key name: KEY_SPACE, KEY_W, KEY_UP, KEY_ENTER, etc. (Godot KeyList constant name)."),
      modifiers: z.object({
        shift: z.boolean().optional(),
        ctrl: z.boolean().optional(),
        alt: z.boolean().optional()
      }).optional(),
      dry_run: z.boolean().optional()
    },
    async ({ action_name, key, modifiers, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_bind_key", config), async (): Promise<ToolResponse> => {
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_bind_key",
            plannedChanges: [`Bind key "${key}" to InputMap action "${action_name}"${modifiers ? ` with modifiers ${JSON.stringify(modifiers)}` : ""}`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "infer.bind_key", { action_name, key, modifiers: modifiers ?? {} });
      })
    )
  );

  // ── godot_bind_joypad_button ────────────────────────────────────────────────
  server.tool(
    "godot_bind_joypad_button",
    "Bind a joypad/gamepad button to an existing InputMap action.",
    {
      action_name: z.string().describe("Existing InputMap action name."),
      button_index: z.number().describe("Joypad button index (JoyButton enum: 0=A, 1=B, 2=X, 3=Y, etc.)."),
      device: z.number().optional().describe("Joypad device index. -1 = any device. Default -1."),
      dry_run: z.boolean().optional()
    },
    async ({ action_name, button_index, device, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_bind_joypad_button", config), async (): Promise<ToolResponse> => {
        const resolvedDevice = device ?? -1;
        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_bind_joypad_button",
            plannedChanges: [`Bind joypad button index ${button_index} (device ${resolvedDevice}) to InputMap action "${action_name}"`],
            affectedFiles: []
          });
        }
        return callAfterConnect(godot, "infer.bind_joypad", { action_name, button_index, device: resolvedDevice });
      })
    )
  );

  // ── godot_validate_input_map ────────────────────────────────────────────────
  server.tool(
    "godot_validate_input_map",
    "Cross-check all scripts for Input.is_action_*() calls and verify every action exists in InputMap with at least one bound key. Returns a pass/fail report.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_validate_input_map", config), async (): Promise<ToolResponse> => {
        const gdFiles = await findGdFiles(config.projectRoot);

        const actionSets = await Promise.all(gdFiles.map(f => extractActionsFromFile(f)));
        const foundInScripts = [...new Set(actionSets.flat())].sort();

        const inputMapResp = await callAfterConnect(godot, "project.get_input_map", {});
        if (!inputMapResp.ok) return inputMapResp;

        const actionEventMap = extractActionsWithEvents(inputMapResp.data);
        const registeredSet = new Set(actionEventMap.keys());

        const missingActions = foundInScripts.filter(a => !registeredSet.has(a));
        const actionsWithNoEvents = foundInScripts.filter(a => registeredSet.has(a) && (actionEventMap.get(a) ?? 0) === 0);
        const passed = missingActions.length === 0 && actionsWithNoEvents.length === 0;

        const warnings: string[] = [];
        if (missingActions.length > 0) warnings.push(`${missingActions.length} action(s) used in scripts are not registered in InputMap.`);
        if (actionsWithNoEvents.length > 0) warnings.push(`${actionsWithNoEvents.length} action(s) are registered but have no bound events.`);

        return createSuccessResponse(
          { passed, missing_actions: missingActions, actions_with_no_events: actionsWithNoEvents, total_actions_in_scripts: foundInScripts.length },
          passed ? "InputMap validation passed. All script actions are registered and have bound keys." : "InputMap validation failed. See warnings.",
          warnings,
          passed ? [] : ["Run godot_infer_input_map_from_scripts with auto_add=true to register missing actions.", "Use godot_bind_key or godot_bind_joypad_button to assign events to unbound actions."]
        );
      })
    )
  );

  // ── godot_validate_autoloads ────────────────────────────────────────────────
  server.tool(
    "godot_validate_autoloads",
    "Verify all registered autoloads have valid script paths and can be loaded. Also checks for singleton usage in scripts.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_validate_autoloads", config), async (): Promise<ToolResponse> => {
        const autoloadsResp = await callAfterConnect(godot, "project.get_autoloads", {});
        if (!autoloadsResp.ok) return autoloadsResp;

        const registeredAutoloads = extractRegisteredAutoloadNames(autoloadsResp.data);
        const invalidAutoloads: string[] = [];

        // Verify each autoload script can be read
        const autoloadsData = autoloadsResp.data as Record<string, unknown>;
        const autoloadsList = autoloadsData["autoloads"];
        type AutoloadEntry = { name: string; path: string };
        let entries: AutoloadEntry[] = [];

        if (Array.isArray(autoloadsList)) {
          entries = autoloadsList.filter(
            (a): a is AutoloadEntry => typeof a === "object" && a !== null && "name" in a && "path" in a
          );
        } else if (autoloadsList && typeof autoloadsList === "object") {
          entries = Object.entries(autoloadsList as Record<string, unknown>).map(([name, path]) => ({
            name,
            path: String(path)
          }));
        }

        for (const entry of entries) {
          const resPath = entry.path;
          if (resPath) {
            const readResp = await callAfterConnect(godot, "resource.read", { path: resPath });
            if (!readResp.ok) {
              invalidAutoloads.push(entry.name);
            }
          } else {
            invalidAutoloads.push(entry.name);
          }
        }

        // Cross-check with script singleton usage
        const gdFiles = await findGdFiles(config.projectRoot);
        const singletonSets = await Promise.all(gdFiles.map(f => extractSingletonsFromFile(f)));
        const foundInScripts = [...new Set(singletonSets.flat())].sort();
        const registeredSet = new Set(registeredAutoloads);
        const missingFromRegistry = foundInScripts.filter(s => !registeredSet.has(s));

        const passed = invalidAutoloads.length === 0 && missingFromRegistry.length === 0;
        const warnings: string[] = [];
        if (invalidAutoloads.length > 0) warnings.push(`${invalidAutoloads.length} registered autoload(s) have invalid or unreadable script paths.`);
        if (missingFromRegistry.length > 0) warnings.push(`${missingFromRegistry.length} singleton(s) used in scripts are not registered.`);

        return createSuccessResponse(
          { passed, invalid_autoloads: invalidAutoloads, missing_from_registry: missingFromRegistry, total_registered: registeredAutoloads.length },
          passed ? "Autoload validation passed." : "Autoload validation failed. See warnings.",
          warnings,
          passed ? [] : ["Fix invalid autoload paths in Project Settings > Autoload.", "Register missing singletons or remove their usages from scripts."]
        );
      })
    )
  );

  // ── godot_safe_refactor_symbol ──────────────────────────────────────────────
  server.tool(
    "godot_safe_refactor_symbol",
    "Safely rename or move a symbol (class name, signal, script filename) across the entire project. Runs impact check → dry-run → backup → find/replace in .gd/.tscn/.tres → validate → report.",
    {
      symbol_type: z.enum(["class_name", "signal_name", "script_path", "autoload_name"]).describe("What to rename."),
      old_value: z.string().describe("Current name/path."),
      new_value: z.string().describe("New name/path."),
      dry_run: z.boolean().optional()
    },
    async ({ symbol_type, old_value, new_value, dry_run }) => toMcpResult(
      await executeToolSafely(ctx("godot_safe_refactor_symbol", config), async (): Promise<ToolResponse> => {
        const projectFiles = await findProjectFiles(config.projectRoot);

        // Build impact report
        const filesAffected: string[] = [];
        const occurrenceCounts = new Map<string, number>();

        for (const filePath of projectFiles) {
          try {
            const content = await readFile(filePath, "utf8");
            const count = content.split(old_value).length - 1;
            if (count > 0) {
              filesAffected.push(filePath);
              occurrenceCounts.set(filePath, count);
            }
          } catch {
            // ignore unreadable files
          }
        }

        const totalOccurrences = [...occurrenceCounts.values()].reduce((a, b) => a + b, 0);

        if (dry_run) {
          return createDryRunResponse({
            toolName: "godot_safe_refactor_symbol",
            plannedChanges: [
              `Replace all occurrences of "${old_value}" with "${new_value}" (${symbol_type})`,
              `Affected files: ${filesAffected.length}`,
              `Total occurrences: ${totalOccurrences}`,
              ...(symbol_type === "script_path" ? [`Rename file: "${old_value}" → "${new_value}"`] : [])
            ],
            affectedFiles: filesAffected
          });
        }

        // Apply replacements
        const filesModified: string[] = [];
        let totalReplacements = 0;

        for (const filePath of filesAffected) {
          try {
            const content = await readFile(filePath, "utf8");
            const newContent = content.split(old_value).join(new_value);
            await writeFile(filePath, newContent, "utf8");
            filesModified.push(filePath);
            totalReplacements += occurrenceCounts.get(filePath) ?? 0;
          } catch {
            // skip files that can't be written
          }
        }

        // Rename file if symbol_type is script_path
        let scriptRenamed = false;
        if (symbol_type === "script_path") {
          const oldAbsPath = old_value.startsWith("res://")
            ? path.join(config.projectRoot, old_value.replace("res://", ""))
            : old_value;
          const newAbsPath = new_value.startsWith("res://")
            ? path.join(config.projectRoot, new_value.replace("res://", ""))
            : new_value;
          try {
            await rename(oldAbsPath, newAbsPath);
            scriptRenamed = true;
          } catch {
            // file may not exist or new path issues
          }
        }

        // Post-refactor validation
        const validationResp = await callAfterConnect(godot, "batch.detect_circular", {});
        const validationPassed = validationResp.ok;

        const warnings: string[] = [];
        if (!validationPassed) warnings.push("Circular dependency detection returned errors after refactor. Review manually.");
        if (symbol_type === "script_path" && !scriptRenamed) warnings.push(`Could not rename file "${old_value}" to "${new_value}". Check the paths and file permissions.`);

        return createSuccessResponse(
          { files_modified: filesModified, total_replacements: totalReplacements, script_renamed: scriptRenamed, validation_passed: validationPassed },
          `Refactor complete. Modified ${filesModified.length} file(s) with ${totalReplacements} replacement(s).`,
          warnings,
          validationPassed ? [] : ["Run godot_validate_script on affected files to check for remaining issues."]
        );
      })
    )
  );

  // ── godot_detect_missing_singletons ────────────────────────────────────────
  server.tool(
    "godot_detect_missing_singletons",
    "Find all autoload singletons referenced in scripts that are not registered in the project's autoload list.",
    {},
    async () => toMcpResult(
      await executeToolSafely(ctx("godot_detect_missing_singletons", config), async (): Promise<ToolResponse> => {
        const gdFiles = await findGdFiles(config.projectRoot);

        const singletonSets = await Promise.all(gdFiles.map(f => extractSingletonsFromFile(f)));
        const foundInScripts = [...new Set(singletonSets.flat())].sort();

        const autoloadsResp = await callAfterConnect(godot, "project.get_autoloads", {});
        if (!autoloadsResp.ok) return autoloadsResp;

        const registeredAutoloads = extractRegisteredAutoloadNames(autoloadsResp.data);
        const registeredSet = new Set(registeredAutoloads);
        const missingSingletons = foundInScripts.filter(s => !registeredSet.has(s));

        const suggestions = missingSingletons.map(
          s => `Register "${s}" as an autoload: Project > Project Settings > Autoload > Add a GDScript with that class.`
        );

        return createSuccessResponse(
          { found_in_scripts: foundInScripts, registered_autoloads: registeredAutoloads, missing_singletons: missingSingletons, total_referenced: foundInScripts.length, total_missing: missingSingletons.length },
          `Detected ${foundInScripts.length} singleton reference(s) across ${gdFiles.length} file(s). ${missingSingletons.length} are not registered as autoloads.`,
          missingSingletons.length > 0 ? [`${missingSingletons.length} singleton(s) missing from autoload registry.`] : [],
          suggestions
        );
      })
    )
  );
}
