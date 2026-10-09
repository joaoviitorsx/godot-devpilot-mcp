import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
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

const ASSET_PACK_README = `# Free asset packs (placeholders + ready-to-use art)

DevPilot does not redistribute third-party assets — pick what you need:

## Recommended free CC0 packs (manual download)

- **Kenney** — https://www.kenney.nl/assets — top-down, platformer, 3D, UI, audio
  - For shooter_2d: \`top-down-shooter\`, \`tiny-dungeon\`
  - For platformer: \`platformer-pack-redux\`, \`pixel-platformer\`
  - For 3D FPS: \`prototype-textures\`, \`weapon-pack\`, \`survival-kit\`
- **OpenGameArt** — https://opengameart.org — varied (search for "CC0")
- **Itch.io free** — https://itch.io/game-assets/free
- **Freesound** — https://freesound.org — SFX (CC0/CC-BY)

## Folder convention

Drop packs in:

\`\`\`
assets/
  kenney/        — Kenney downloads
  opengameart/   — OGA downloads
  custom/        — your own art
  generated/     — DevPilot-generated placeholders
  sfx/           — sound effects
  music/         — music tracks
\`\`\`

Then update placeholder Sprite2D references to point at the new textures.
`;

const EXPORT_PRESET_TEMPLATES: Record<string, string> = {
  windows: `[preset]

name="Windows Desktop"
platform="Windows Desktop"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.options]

application/icon=""
codesign/enable=false
binary_format/architecture="x86_64"
`,
  linux: `[preset]

name="Linux/X11"
platform="Linux/X11"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.options]

binary_format/architecture="x86_64"
`,
  mac: `[preset]

name="macOS"
platform="macOS"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.options]

binary_format/architecture="universal"
`,
  web: `[preset]

name="Web"
platform="Web"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.options]

variant/extensions_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=false
html/export_icon=true
html/canvas_resize_policy=2
`,
  android: `[preset]

name="Android"
platform="Android"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.options]

architectures/arm64-v8a=true
package/unique_name="org.example.game"
package/name=""
screen/immersive_mode=true
permissions/internet=false
`,
  ios: `[preset]

name="iOS"
platform="iOS"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.options]

application/bundle_identifier="org.example.game"
application/short_version="1.0"
`,
};

export function registerAssetAndExportTools(server: McpServer, config: ServerConfig): void {
  server.tool(
    "devpilot_setup_asset_pack",
    "Create assets/ folder convention (kenney/opengameart/custom/generated/sfx/music) and write a README pointing to free CC0 sources. No bundling — user downloads packs manually.",
    {
      overwrite: z.boolean().optional().default(false),
    },
    async ({ overwrite }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_setup_asset_pack", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const dirs = ["assets/kenney", "assets/opengameart", "assets/custom", "assets/generated", "assets/sfx", "assets/music"];
          for (const d of dirs) await mkdir(path.join(config.projectRoot, d), { recursive: true });
          const readmePath = path.join(config.projectRoot, "assets/README.md");
          if (!(await fileExists(readmePath)) || overwrite) {
            await writeFile(readmePath, ASSET_PACK_README, "utf8");
          }
          await recordBlueprintApplied(config.projectRoot, "asset_pack_setup", { template_version: "0.4.0" });
          return createSuccessResponse({ dirs, readme: "res://assets/README.md" }, "Asset pack folders + README created.");
        })
      )
  );

  server.tool(
    "devpilot_setup_export_preset",
    "Append an export preset entry to export_presets.cfg for the chosen target. Existing presets are kept. Targets: windows, linux, mac, web, android, ios. After running, open Project → Export in Godot to finalize templates/icons.",
    {
      target: z.enum(["windows", "linux", "mac", "web", "android", "ios"]),
    },
    async ({ target }) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_setup_export_preset", config), async (): Promise<ToolResponse> => {
          if (config.security.readOnly) return createErrorResponse("READ_ONLY", "", {}, []);
          const file = path.join(config.projectRoot, "export_presets.cfg");
          let content = "";
          if (await fileExists(file)) content = await readFile(file, "utf8");
          // Index next preset.
          const presetMatches = content.match(/^\[preset\.(\d+)\]/gm) ?? [];
          const next = presetMatches.length;
          const tmpl = EXPORT_PRESET_TEMPLATES[target].replace(/^\[preset\]/, `[preset.${next}]`).replace(/^\[preset\.options\]/m, `[preset.${next}.options]`);
          if (content && !content.endsWith("\n")) content += "\n";
          content += tmpl + "\n";
          await writeFile(file, content, "utf8");
          await recordBlueprintApplied(config.projectRoot, `export_preset_${target}`, { template_version: "0.4.0" });
          return createSuccessResponse({ target, file: "export_presets.cfg", index: next }, `Export preset for '${target}' appended (index ${next}).`);
        })
      )
  );
}

void resolveProjectPath;
