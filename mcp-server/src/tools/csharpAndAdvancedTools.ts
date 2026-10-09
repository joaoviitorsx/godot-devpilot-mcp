import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { resolveProjectPath } from "../safety/pathGuard.js";
import { executeToolSafely } from "../safety/toolWrapper.js";
import { recordBlueprintApplied } from "./manifestTools.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// ── C# blueprints (skeleton) ─────────────────────────────────────────────────

const CSHARP_PLAYER = (className: string) => `using Godot;

public partial class ${className} : CharacterBody2D
{
    [Export] public float Speed = 200f;
    [Export] public int MaxHp = 6;

    [Signal] public delegate void PlayerDamagedEventHandler(int currentHp, int maxHp);
    [Signal] public delegate void PlayerDiedEventHandler();

    private int _hp;

    public override void _Ready()
    {
        _hp = MaxHp;
        AddToGroup("player");
        EmitSignal(SignalName.PlayerDamaged, _hp, MaxHp);
    }

    public override void _PhysicsProcess(double delta)
    {
        var dir = new Vector2(
            Input.GetAxis("move_left", "move_right"),
            Input.GetAxis("move_up", "move_down")
        );
        if (dir.Length() > 1f) dir = dir.Normalized();
        Velocity = dir * Speed;
        MoveAndSlide();
    }

    public void TakeDamage(int amount)
    {
        _hp = Mathf.Max(0, _hp - amount);
        EmitSignal(SignalName.PlayerDamaged, _hp, MaxHp);
        if (_hp <= 0) EmitSignal(SignalName.PlayerDied);
    }
}
`;

const CSHARP_PROJECT_FILE = (projectName: string) => `<Project Sdk="Godot.NET.Sdk/4.3.0">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <EnableDynamicLoading>true</EnableDynamicLoading>
    <RootNamespace>${projectName.replace(/[^A-Za-z0-9_]/g, "")}</RootNamespace>
  </PropertyGroup>
</Project>
`;

// ── GDExtension scaffold ────────────────────────────────────────────────────

const GDEXTENSION_CFG = (libName: string) => `[configuration]
entry_symbol = "${libName}_init"
compatibility_minimum = "4.3"

[libraries]
linux.x86_64 = "res://bin/lib${libName}.linux.template_release.x86_64.so"
windows.x86_64 = "res://bin/lib${libName}.windows.template_release.x86_64.dll"
macos = "res://bin/lib${libName}.macos.template_release.framework"
`;

const GDEXTENSION_README = (libName: string) => `# ${libName} GDExtension scaffold

This is a starting point only — DevPilot does not compile native extensions.

## Files generated

- \`${libName}.gdextension\` — Godot will load this.
- \`src/${libName}.cpp\`, \`src/${libName}.h\` — example node class.
- \`src/register_types.cpp\` — entry symbol.
- \`SConstruct\` — godot-cpp build (you must clone godot-cpp + symlink).

## Build (Linux)

\`\`\`bash
git clone https://github.com/godotengine/godot-cpp -b 4.3
cd godot-cpp && scons platform=linux target=template_release && cd ..
scons platform=linux target=template_release
\`\`\`

Then drop the resulting \`.so\` into \`bin/\` and reload in Godot.
`;

const GDEXTENSION_HEADER = (libName: string) => `#pragma once
#include <godot_cpp/classes/node.hpp>

namespace godot {
class ${libName}_Node : public Node {
    GDCLASS(${libName}_Node, Node);
protected:
    static void _bind_methods();
public:
    ${libName}_Node();
    ~${libName}_Node();
    void hello();
};
}
`;

const GDEXTENSION_SRC = (libName: string) => `#include "${libName}.h"
#include <godot_cpp/core/class_db.hpp>

using namespace godot;

void ${libName}_Node::_bind_methods() {
    ClassDB::bind_method(D_METHOD("hello"), &${libName}_Node::hello);
}

${libName}_Node::${libName}_Node() {}
${libName}_Node::~${libName}_Node() {}

void ${libName}_Node::hello() {
    UtilityFunctions::print("hello from ${libName}");
}
`;

const GDEXTENSION_REGISTER = (libName: string) => `#include <godot_cpp/godot.hpp>
#include <godot_cpp/classes/engine.hpp>
#include "${libName}.h"

using namespace godot;

void initialize_${libName}_module(ModuleInitializationLevel p_level) {
    if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) return;
    ClassDB::register_class<${libName}_Node>();
}

void uninitialize_${libName}_module(ModuleInitializationLevel) {}

extern "C" {
GDExtensionBool GDE_EXPORT ${libName}_init(GDExtensionInterfaceGetProcAddress p_get_proc_address, GDExtensionClassLibraryPtr p_library, GDExtensionInitialization *r_initialization) {
    GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);
    init_obj.register_initializer(initialize_${libName}_module);
    init_obj.register_terminator(uninitialize_${libName}_module);
    init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
    return init_obj.init();
}
}
`;

const GDEXTENSION_SCONSTRUCT = (libName: string) => `#!/usr/bin/env python
env = SConscript("godot-cpp/SConstruct")
env.Append(CPPPATH=["src/"])
sources = Glob("src/*.cpp")
library = env.SharedLibrary(
    "bin/lib${libName}{}{}".format(env["suffix"], env["SHLIBSUFFIX"]),
    source=sources,
)
Default(library)
`;

// ── Multi-project workspace ─────────────────────────────────────────────────

const WORKSPACES_FILE = path.join(os.homedir(), ".devpilot", "workspaces.json");

async function readWorkspaces(): Promise<{ workspaces: Array<{ name: string; path: string; added_at: string }> }> {
  if (!(await fileExists(WORKSPACES_FILE))) return { workspaces: [] };
  try {
    return JSON.parse(await readFile(WORKSPACES_FILE, "utf8"));
  } catch {
    return { workspaces: [] };
  }
}

async function writeWorkspaces(data: { workspaces: Array<{ name: string; path: string; added_at: string }> }): Promise<void> {
  await mkdir(path.dirname(WORKSPACES_FILE), { recursive: true });
  await writeFile(WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ── Telemetry opt-in ────────────────────────────────────────────────────────

const TELEMETRY_FILE_REL = ".devpilot/telemetry.json";

// ── Tool registration ────────────────────────────────────────────────────────

export function registerCsharpAndAdvancedTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_blueprint_csharp_player",
    "[C#] Skeleton C# player CharacterBody2D class. Use as template for C# projects. Drop into existing Godot.NET project — DevPilot does not compile C#.",
    {
      script_dir: z.string().optional().default("res://scripts/cs"),
      class_name_param: z.string().optional().default("Player"),
      overwrite: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_csharp_player", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const sp = `${params.script_dir}/${params.class_name_param}.cs`;
          const r = resolveProjectPath(sp, config.projectRoot);
          if (await fileExists(r.absolutePath) && !params.overwrite) {
            return createErrorResponse("EXISTS", `${sp} already exists.`, {}, []);
          }
          await mkdir(path.dirname(r.absolutePath), { recursive: true });
          await writeFile(r.absolutePath, CSHARP_PLAYER(params.class_name_param), "utf8");
          await recordBlueprintApplied(config.projectRoot, "csharp_player", { template_version: "0.5.0" });
          return createSuccessResponse({ file: sp, next_steps: ["Set project to use Mono/.NET in Godot.", "Add a .csproj if missing."] }, "C# player skeleton generated.");
        })
      )
  );

  server.tool(
    "devpilot_setup_csharp_project",
    "Generate a basic .csproj at project root (Godot.NET.Sdk 4.3). Does not migrate existing GDScript — coexists.",
    {
      project_name: z.string().optional().default("Game"),
      overwrite: z.boolean().optional().default(false),
    },
    async ({ project_name, overwrite }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_setup_csharp_project", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const file = path.join(config.projectRoot, `${project_name}.csproj`);
          if (await fileExists(file) && !overwrite) return createErrorResponse("EXISTS", "csproj exists.", {}, []);
          await writeFile(file, CSHARP_PROJECT_FILE(project_name), "utf8");
          await recordBlueprintApplied(config.projectRoot, "csharp_project", { project_name, template_version: "0.5.0" });
          return createSuccessResponse({ file, project_name }, "C# project file written.");
        })
      )
  );

  server.tool(
    "devpilot_blueprint_gdextension_scaffold",
    "Generate a GDExtension C++ scaffold: .gdextension config + src/*.cpp/.h + SConstruct + README. DevPilot does not compile — user runs scons after cloning godot-cpp.",
    {
      lib_name: z.string().describe("Library name (lowercase, alphanumeric)."),
      overwrite: z.boolean().optional().default(false),
    },
    async ({ lib_name, overwrite }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_blueprint_gdextension_scaffold", config), async () => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          if (!/^[a-z][a-z0-9_]*$/.test(lib_name)) return createErrorResponse("INVALID_PARAMS", "lib_name must be lowercase alphanumeric.", {}, []);
          const root = config.projectRoot;
          const writes: Array<[string, string]> = [
            [`${lib_name}.gdextension`, GDEXTENSION_CFG(lib_name)],
            [`README_GDEXT_${lib_name}.md`, GDEXTENSION_README(lib_name)],
            [`src/${lib_name}.h`, GDEXTENSION_HEADER(lib_name)],
            [`src/${lib_name}.cpp`, GDEXTENSION_SRC(lib_name)],
            [`src/register_types.cpp`, GDEXTENSION_REGISTER(lib_name)],
            [`SConstruct`, GDEXTENSION_SCONSTRUCT(lib_name)],
          ];
          const written: string[] = [];
          for (const [rel, content] of writes) {
            const abs = path.join(root, rel);
            if (await fileExists(abs) && !overwrite) continue;
            await mkdir(path.dirname(abs), { recursive: true });
            await writeFile(abs, content, "utf8");
            written.push(rel);
          }
          await recordBlueprintApplied(config.projectRoot, "gdextension_scaffold", { lib_name, template_version: "0.5.0" });
          return createSuccessResponse({ files: written, next_steps: ["git clone https://github.com/godotengine/godot-cpp -b 4.3", "scons platform=linux target=template_release"] }, `GDExtension scaffold '${lib_name}' generated.`);
        })
      )
  );

  // ── Multi-project ──────────────────────────────────────────────────────
  server.tool(
    "devpilot_workspace_register",
    "Register the current project (or a custom path) as a workspace at ~/.devpilot/workspaces.json. Lets future MCP sessions list projects.",
    {
      name: z.string(),
      path_override: z.string().optional(),
    },
    async ({ name, path_override }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_workspace_register", config), async (): Promise<ToolResponse> => {
          const target = path_override ?? config.projectRoot;
          const data = await readWorkspaces();
          const existing = data.workspaces.find((w) => w.name === name);
          if (existing) {
            existing.path = target;
            existing.added_at = new Date().toISOString();
          } else {
            data.workspaces.push({ name, path: target, added_at: new Date().toISOString() });
          }
          await writeWorkspaces(data);
          return createSuccessResponse({ name, path: target, total: data.workspaces.length }, `Workspace '${name}' registered.`);
        })
      )
  );

  server.tool(
    "devpilot_workspace_list",
    "List registered workspaces from ~/.devpilot/workspaces.json.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_workspace_list", config), async (): Promise<ToolResponse> => {
          const data = await readWorkspaces();
          return createSuccessResponse({ workspaces: data.workspaces, count: data.workspaces.length }, `${data.workspaces.length} workspace(s).`);
        })
      )
  );

  // ── Telemetry opt-in ───────────────────────────────────────────────────
  server.tool(
    "devpilot_telemetry",
    "Opt-in usage telemetry. Local-only by default — writes counts to .devpilot/telemetry.json. Useful to see which tools you actually use. Pass enable:true/false to toggle, action:'view' to read counts.",
    {
      action: z.enum(["enable", "disable", "view", "log_event"]),
      event: z.string().optional().describe("For log_event: tool/feature name."),
    },
    async ({ action, event }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_telemetry", config), async (): Promise<ToolResponse> => {
          const file = path.join(config.projectRoot, TELEMETRY_FILE_REL);
          let data: { enabled: boolean; counts: Record<string, number> } = { enabled: false, counts: {} };
          if (await fileExists(file)) {
            try { data = JSON.parse(await readFile(file, "utf8")); } catch { /* keep default */ }
          }
          if (action === "enable") data.enabled = true;
          else if (action === "disable") data.enabled = false;
          else if (action === "log_event" && event) {
            if (data.enabled) data.counts[event] = (data.counts[event] ?? 0) + 1;
          }
          if (!config.security.readOnly && action !== "view") {
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, JSON.stringify(data, null, 2), "utf8");
          }
          return createSuccessResponse({ enabled: data.enabled, counts: data.counts }, `Telemetry ${data.enabled ? "ON" : "OFF"}.`);
        })
      )
  );
}
