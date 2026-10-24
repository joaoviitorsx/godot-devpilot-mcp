import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse } from "../godot/protocol.js";
import { isToolAllowedInReadOnly } from "../safety/permissions.js";

type Registered = { name: string; description: string; parameters: Array<{ name: string; required: boolean; description: string }>; enabled: boolean };

const WORDS: Record<string, string[]> = {
  luz: ["light", "lighting", "environment"], iluminacao: ["light", "lighting", "environment"],
  cena: ["scene"], cenario: ["scene", "level"], no: ["node"], recurso: ["resource"],
  inimigo: ["enemy"], jogador: ["player", "character"], personagem: ["character", "player"],
  navegacao: ["navigation", "nav"], caminho: ["path", "navigation"], colisao: ["collision", "physics"],
  animacao: ["animation", "anim"], som: ["audio", "sound"], musica: ["music", "audio"],
  exportar: ["export", "build"], modelo: ["model", "gltf", "import"], textura: ["texture", "asset"],
  material: ["material", "shader"], terreno: ["terrain", "tile", "gridmap"],
  teste: ["test", "playtest", "replay"], interface: ["ui", "menu", "hud"],
  corrida: ["physics", "input", "camera", "vehicle"], racing: ["physics", "input", "camera", "vehicle"],
  carro: ["physics", "input", "camera", "vehicle"], carros: ["physics", "input", "camera", "vehicle"],
  veiculo: ["physics", "input", "camera", "vehicle"], veiculos: ["physics", "input", "camera", "vehicle"],
  ritmo: ["audio", "input", "animation"], rhythm: ["audio", "input", "animation"],
  musical: ["audio", "input"], batida: ["audio", "input"],
  estrategia: ["unit", "navigation", "state_machine"], strategy: ["unit", "navigation", "state_machine"],
  turnos: ["state_machine", "signal", "ui"], turn: ["state_machine", "signal", "ui"],
  simulacao: ["resource", "save", "ui"], simulation: ["resource", "save", "ui"],
  fazenda: ["tile", "inventory", "save", "resource"], farming: ["tile", "inventory", "save", "resource"],
  multiplayer: ["network", "peer"], online: ["network", "peer"],
  simples: [], complexo: ["workflow", "plan", "feature"]
};

const STOP_WORDS = new Set(["godot", "quero", "para", "uma", "com", "the", "and", "jogo", "jogos", "game", "games", "criar", "crie", "fazer", "faca", "usar", "utilizar", "de", "do", "da", "dos", "das", "em", "um", "no", "na", "por", "que", "como", "with", "for", "create", "make", "add"]);

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function category(name: string): string {
  if (/tile|terrain|gridmap|dungeon/.test(name)) return "tiles_and_levels";
  if (/gltf|asset|import|resource|material|texture/.test(name)) return "assets_and_resources";
  if (/nav|pathfind/.test(name)) return "navigation";
  if (/physics|collision|rigid|character_body/.test(name)) return "physics";
  if (/audio|sound|music|bus/.test(name)) return "audio";
  if (/anim|blend/.test(name)) return "animation";
  if (/shader|particle|vfx/.test(name)) return "visual_effects";
  if (/export|build|release/.test(name)) return "export";
  if (/runtime|run_project|playtest|replay|fps|screenshot|input|debug/.test(name)) return "runtime_and_testing";
  if (/scene|node|camera|lighting|mesh/.test(name)) return "scenes_and_nodes";
  if (/script|classdb|signal/.test(name)) return "scripting";
  if (/project|autoload|file|memory|context/.test(name)) return "project";
  if (/ui|menu|hud|accessibility/.test(name)) return "interface";
  return "workflow";
}

function versionAtLeast(current: string | null, required: string): boolean {
  if (!current) return true;
  const version = current.match(/\d+\.\d+/)?.[0];
  if (!version) return true;
  const [major, minor] = version.split(".").map(Number);
  const [minMajor, minMinor] = required.split(".").map(Number);
  return major > minMajor || major === minMajor && minor >= minMinor;
}

export function findRelevantTools(registered: Registered[], query: string, options: { category?: string; limit?: number; readOnly?: boolean; godotVersion?: string | null; betterTileEditorAvailable?: boolean | null } = {}) {
  const rawTerms = normalize(query).split(/[^a-z0-9]+/).filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  const terms = [...new Set(rawTerms.flatMap((term) => [term, ...(WORDS[term] ?? [])]))];
  const limit = Math.min(15, Math.max(1, options.limit ?? 8));
  return registered.filter((tool) => tool.enabled && tool.name !== "devpilot_find_tools")
    .filter((tool) => !options.readOnly || isToolAllowedInReadOnly(tool.name))
    .filter((tool) => !options.category || category(tool.name) === options.category)
    .filter((tool) => versionAtLeast(options.godotVersion ?? null, tool.name.includes("better_tile_editor") ? "4.6" : "4.3"))
    .filter((tool) => options.betterTileEditorAvailable !== false || !tool.name.includes("better_tile_editor") || tool.name === "godot_better_tile_editor_status")
    .map((tool) => {
      const name = normalize(tool.name).replace(/_/g, " ");
      const description = normalize(tool.description);
      const score = terms.reduce((sum, term) => sum + (name.includes(term) ? 5 : 0) + (description.includes(term) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map(({ tool }) => ({ name: tool.name, category: category(tool.name), description: tool.description.slice(0, 220), parameters: tool.parameters.slice(0, 12), requires_addon: tool.name.includes("better_tile_editor") ? "Better Tile Editor" : null, minimum_godot: tool.name.includes("better_tile_editor") ? "4.6" : "4.3" }));
}

export function registerCapabilityDiscoveryTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  server.tool("devpilot_find_tools", "Find the active GodoPilot tools for a task. Search in Portuguese or English; returns concise parameters and version/addon requirements.", {
    query: z.string().min(2).max(300).describe("Task or capability to find, e.g. 'add light', 'criar animação', 'importar modelo 3D'."),
    category: z.enum(["tiles_and_levels", "assets_and_resources", "navigation", "physics", "audio", "animation", "visual_effects", "export", "runtime_and_testing", "scenes_and_nodes", "scripting", "project", "interface", "workflow"]).optional(),
    limit: z.number().int().min(1).max(15).optional()
  }, async ({ query, category: requestedCategory, limit }) => {
    let godotVersion: string | null = null;
    if (godot.getStatus().connected) {
      const health = await godot.call("system.health_check");
      if (health.ok && typeof health.data === "object" && health.data !== null && "godot_version" in health.data) godotVersion = String(health.data.godot_version);
    }
    const registry = (server as unknown as { _registeredTools: Record<string, { description?: string; inputSchema?: { shape?: Record<string, z.ZodType> }; enabled?: boolean }> })._registeredTools;
    const tools: Registered[] = Object.entries(registry).map(([name, entry]) => ({
      name, description: entry.description ?? "", enabled: entry.enabled !== false,
      parameters: Object.entries(entry.inputSchema?.shape ?? {}).map(([key, schema]) => ({ name: key, required: !schema.isOptional(), description: (schema.description ?? "").slice(0, 160) }))
    }));
    let matches = findRelevantTools(tools, query, { category: requestedCategory, limit, readOnly: config.security.readOnly, godotVersion });
    let betterTileEditorAvailable: boolean | null = null;
    if (godot.getStatus().connected && matches.some((tool) => tool.requires_addon)) {
      const status = await godot.call("better_tile_editor.status");
      if (status.ok && typeof status.data === "object" && status.data !== null) {
        const data = status.data as Record<string, unknown>;
        betterTileEditorAvailable = data.installed === true && data.enabled === true;
        if (!betterTileEditorAvailable) matches = findRelevantTools(tools, query, { category: requestedCategory, limit, readOnly: config.security.readOnly, godotVersion, betterTileEditorAvailable });
      }
    }
    const domain = normalize(query);
    const dedicatedDomain = /\b(multiplayer|online|network|rede)\b/.test(domain) ? /multiplayer|network|peer/ :
      /\b(corrida|racing|veiculo|veiculos|carro|carros)\b/.test(domain) ? /vehicle|racing/ :
      /\b(ritmo|rhythm)\b/.test(domain) ? /rhythm|beat/ :
      /\b(turnos|turn.based)\b/.test(domain) ? /turn.based|turno/ : null;
    const lacksDedicatedTool = dedicatedDomain !== null && !tools.some((tool) => tool.enabled && dedicatedDomain.test(tool.name));
    let coverageGap: { coverage_gap: string; fallback_tools: string[] } | undefined;
    if (matches.length === 0 || lacksDedicatedTool) {
      const fallbackNames = ["godot_get_classdb_info", "godot_create_script", "godot_create_scene", "godot_add_node", "devpilot_game_context"];
      const fallbackTools = fallbackNames.filter((name) => tools.some((tool) => tool.name === name && tool.enabled && (!config.security.readOnly || isToolAllowedInReadOnly(name))));
      coverageGap = { coverage_gap: "No dedicated active tool covers this mechanic. The matches, if any, are building blocks; compose the mechanic with Godot classes, scripts and scenes, then confirm it in a playable test.", fallback_tools: fallbackTools };
    }
    const response = createSuccessResponse({ query, mode: config.mode, godot_version: godotVersion, better_tile_editor_available: betterTileEditorAvailable, matches, note: godotVersion ? undefined : "Editor version unavailable; version and addon requirements are listed but not filtered.", ...coverageGap }, "Relevant active tools found.");
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  });
}
