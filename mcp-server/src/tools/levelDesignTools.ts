import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { createDryRunResponse } from "../safety/dryRun.js";
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
  return { toolName, readOnly: false, projectRoot: config.projectRoot };
}

// ── Seeded RNG (Mulberry32) ──────────────────────────────────────────────────
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── BSP Dungeon ──────────────────────────────────────────────────────────────
type Rect = { x: number; y: number; w: number; h: number };

function bspPartition(rect: Rect, depth: number, minSize: number, rand: () => number): Rect[] {
  if (depth <= 0 || (rect.w < minSize * 2 && rect.h < minSize * 2)) {
    return [rect];
  }
  const horizontal = rect.w < rect.h ? true : (rect.h < rect.w ? false : rand() < 0.5);
  if (horizontal) {
    if (rect.h < minSize * 2) return [rect];
    const split = minSize + Math.floor(rand() * (rect.h - minSize * 2));
    return [
      ...bspPartition({ x: rect.x, y: rect.y, w: rect.w, h: split }, depth - 1, minSize, rand),
      ...bspPartition({ x: rect.x, y: rect.y + split, w: rect.w, h: rect.h - split }, depth - 1, minSize, rand),
    ];
  } else {
    if (rect.w < minSize * 2) return [rect];
    const split = minSize + Math.floor(rand() * (rect.w - minSize * 2));
    return [
      ...bspPartition({ x: rect.x, y: rect.y, w: split, h: rect.h }, depth - 1, minSize, rand),
      ...bspPartition({ x: rect.x + split, y: rect.y, w: rect.w - split, h: rect.h }, depth - 1, minSize, rand),
    ];
  }
}

function shrinkToRoom(part: Rect, minRoom: number, rand: () => number): Rect {
  const padX = Math.max(1, Math.floor((part.w - minRoom) * rand() * 0.4));
  const padY = Math.max(1, Math.floor((part.h - minRoom) * rand() * 0.4));
  return {
    x: part.x + padX,
    y: part.y + padY,
    w: Math.max(minRoom, part.w - padX * 2),
    h: Math.max(minRoom, part.h - padY * 2),
  };
}

// ── A* pathfinding ───────────────────────────────────────────────────────────
function astar(walkable: boolean[][], start: [number, number], end: [number, number]): { path: Array<[number, number]>; reachable: boolean } {
  const h = walkable.length;
  const w = walkable[0]?.length ?? 0;
  const key = (x: number, y: number) => y * w + x;
  const open = new Set<number>();
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();
  const heuristic = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

  const startKey = key(start[0], start[1]);
  open.add(startKey);
  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(start, end));

  while (open.size > 0) {
    let current = -1;
    let lowest = Infinity;
    for (const k of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < lowest) { lowest = f; current = k; }
    }
    if (current === -1) break;
    const cx = current % w;
    const cy = Math.floor(current / w);
    if (cx === end[0] && cy === end[1]) {
      const path: Array<[number, number]> = [[cx, cy]];
      let cur = current;
      while (cameFrom.has(cur)) {
        cur = cameFrom.get(cur)!;
        path.unshift([cur % w, Math.floor(cur / w)]);
      }
      return { path, reachable: true };
    }
    open.delete(current);
    const neighbors: Array<[number, number]> = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!walkable[ny][nx]) continue;
      const nk = key(nx, ny);
      const tentative = (gScore.get(current) ?? Infinity) + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, current);
        gScore.set(nk, tentative);
        fScore.set(nk, tentative + heuristic([nx, ny], end));
        open.add(nk);
      }
    }
  }
  return { path: [], reachable: false };
}

const dryRun = (toolName: string, plan: string[], nodes?: string[]) =>
  createDryRunResponse({ toolName, plannedChanges: plan, affectedNodes: nodes });

// ── Tool registration ────────────────────────────────────────────────────────

export function registerLevelDesignTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── devpilot_generate_tilemap_level ────────────────────────────────────────
  server.tool(
    "devpilot_generate_tilemap_level",
    "Fill a TileMap programmatically with a pattern (solid/noise/borders). Calls tilemap.set_cell or fill_rect repeatedly.",
    {
      node_path: z.string().describe("Existing TileMap node path"),
      width: z.number().int().positive().max(500),
      height: z.number().int().positive().max(500),
      pattern: z.enum(["solid", "noise", "borders"]).optional().default("borders"),
      density: z.number().min(0).max(1).optional().default(0.4).describe("Noise density (0-1)"),
      layer: z.number().int().nonnegative().optional().default(0),
      source_id: z.number().int().optional().default(0),
      seed: z.number().int().optional().default(42),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_generate_tilemap_level", config), async (): Promise<ToolResponse> => {
          if (params.width * params.height > 50000) {
            return createErrorResponse("LEVEL_TOO_LARGE", "Cell count exceeds 50000.", { cells: params.width * params.height }, ["Reduce width × height"]) as ToolResponse;
          }
          if (params.dry_run) return dryRun("devpilot_generate_tilemap_level", [`pattern=${params.pattern}, ${params.width}x${params.height}, layer=${params.layer}`]);

          let cellsPlaced = 0;
          if (params.pattern === "solid") {
            const r = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: 0, y: 0, width: params.width, height: params.height, layer: params.layer, source_id: params.source_id, atlas_x: 0, atlas_y: 0 });
            if (!r.ok) return r;
            cellsPlaced = params.width * params.height;
          } else if (params.pattern === "borders") {
            const r1 = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: 0, y: 0, width: params.width, height: 1, layer: params.layer, source_id: params.source_id, atlas_x: 0, atlas_y: 0 });
            if (!r1.ok) return r1;
            const r2 = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: 0, y: params.height - 1, width: params.width, height: 1, layer: params.layer, source_id: params.source_id, atlas_x: 0, atlas_y: 0 });
            if (!r2.ok) return r2;
            const r3 = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: 0, y: 0, width: 1, height: params.height, layer: params.layer, source_id: params.source_id, atlas_x: 0, atlas_y: 0 });
            if (!r3.ok) return r3;
            const r4 = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: params.width - 1, y: 0, width: 1, height: params.height, layer: params.layer, source_id: params.source_id, atlas_x: 0, atlas_y: 0 });
            if (!r4.ok) return r4;
            cellsPlaced = (params.width * 2) + ((params.height - 2) * 2);
          } else {
            const rand = rng(params.seed);
            for (let y = 0; y < params.height; y++) {
              for (let x = 0; x < params.width; x++) {
                if (rand() < params.density) {
                  const r = await callRpc(godot, "tilemap.set_cell", { node_path: params.node_path, x, y, layer: params.layer, source_id: params.source_id, atlas_x: 0, atlas_y: 0, alternative_tile: 0 });
                  if (r.ok) cellsPlaced++;
                }
              }
            }
          }
          return createSuccessResponse({ node_path: params.node_path, pattern: params.pattern, cells_placed: cellsPlaced, dimensions: { width: params.width, height: params.height } }, `Tilemap generated: ${cellsPlaced} cells.`);
        })
      )
  );

  // ── devpilot_generate_platformer_level ────────────────────────────────────
  server.tool(
    "devpilot_generate_platformer_level",
    "Procedural platformer level: alternating floor + gap + raised platform. Returns a list of cells written to the TileMap.",
    {
      node_path: z.string(),
      length: z.number().int().positive().max(500).optional().default(50),
      ground_y: z.number().int().nonnegative().optional().default(10),
      gap_ratio: z.number().min(0).max(0.6).optional().default(0.15),
      max_platform_height: z.number().int().positive().optional().default(4),
      layer: z.number().int().nonnegative().optional().default(0),
      source_id: z.number().int().optional().default(0),
      seed: z.number().int().optional().default(42),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_generate_platformer_level", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_generate_platformer_level", [`length=${params.length}, gap_ratio=${params.gap_ratio}, max_platform_height=${params.max_platform_height}`]);
          const rand = rng(params.seed);
          let cellsPlaced = 0;
          let gapCount = 0;
          let platformCount = 0;
          let x = 0;
          while (x < params.length) {
            const isGap = rand() < params.gap_ratio && x > 5 && x < params.length - 5;
            if (isGap) {
              gapCount++;
              x += 2 + Math.floor(rand() * 3);
              continue;
            }
            const segmentLen = 3 + Math.floor(rand() * 5);
            const end = Math.min(params.length, x + segmentLen);
            const r = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x, y: params.ground_y, width: end - x, height: 2, layer: params.layer, source_id: params.source_id, atlas_x: 0, atlas_y: 0 });
            if (r.ok) cellsPlaced += (end - x) * 2;
            // Optional raised platform
            if (rand() < 0.3 && end - x >= 3) {
              platformCount++;
              const height = 1 + Math.floor(rand() * params.max_platform_height);
              const platStart = x + 1;
              const platLen = Math.min(end - x - 1, 2 + Math.floor(rand() * 3));
              const r2 = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: platStart, y: params.ground_y - height, width: platLen, height: 1, layer: params.layer, source_id: params.source_id, atlas_x: 0, atlas_y: 0 });
              if (r2.ok) cellsPlaced += platLen;
            }
            x = end;
          }
          return createSuccessResponse({ node_path: params.node_path, length: params.length, cells_placed: cellsPlaced, gaps: gapCount, platforms: platformCount, ground_y: params.ground_y }, `Platformer level generated: ${gapCount} gaps, ${platformCount} platforms.`);
        })
      )
  );

  // ── devpilot_generate_dungeon_layout ──────────────────────────────────────
  server.tool(
    "devpilot_generate_dungeon_layout",
    "BSP-partitioned dungeon: rooms + corridors connecting them. Renders to TileMap. Returns rooms metadata.",
    {
      node_path: z.string(),
      width: z.number().int().min(20).max(200).optional().default(60),
      height: z.number().int().min(20).max(200).optional().default(40),
      depth: z.number().int().min(1).max(8).optional().default(4),
      min_room_size: z.number().int().min(3).max(20).optional().default(5),
      layer: z.number().int().nonnegative().optional().default(0),
      source_id: z.number().int().optional().default(0),
      seed: z.number().int().optional().default(42),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_generate_dungeon_layout", config), async (): Promise<ToolResponse> => {
          if (params.dry_run) return dryRun("devpilot_generate_dungeon_layout", [`${params.width}x${params.height} BSP depth=${params.depth}`]);
          const rand = rng(params.seed);
          const partitions = bspPartition({ x: 1, y: 1, w: params.width - 2, h: params.height - 2 }, params.depth, params.min_room_size + 2, rand);
          const rooms = partitions.map((p) => shrinkToRoom(p, params.min_room_size, rand));
          // Render rooms
          let cellsPlaced = 0;
          for (const room of rooms) {
            const r = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: room.x, y: room.y, width: room.w, height: room.h, layer: params.layer, source_id: params.source_id, atlas_x: 1, atlas_y: 0 });
            if (r.ok) cellsPlaced += room.w * room.h;
          }
          // Connect rooms with simple L-corridors
          for (let i = 0; i < rooms.length - 1; i++) {
            const a = rooms[i];
            const b = rooms[i + 1];
            const ax = a.x + Math.floor(a.w / 2);
            const ay = a.y + Math.floor(a.h / 2);
            const bx = b.x + Math.floor(b.w / 2);
            const by = b.y + Math.floor(b.h / 2);
            const r1 = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: Math.min(ax, bx), y: ay, width: Math.abs(bx - ax) + 1, height: 1, layer: params.layer, source_id: params.source_id, atlas_x: 1, atlas_y: 0 });
            if (r1.ok) cellsPlaced += Math.abs(bx - ax) + 1;
            const r2 = await callRpc(godot, "tilemap.fill_rect", { node_path: params.node_path, x: bx, y: Math.min(ay, by), width: 1, height: Math.abs(by - ay) + 1, layer: params.layer, source_id: params.source_id, atlas_x: 1, atlas_y: 0 });
            if (r2.ok) cellsPlaced += Math.abs(by - ay) + 1;
          }
          return createSuccessResponse({ node_path: params.node_path, dimensions: { width: params.width, height: params.height }, rooms: rooms.length, room_metadata: rooms, cells_placed: cellsPlaced, seed: params.seed }, `Dungeon: ${rooms.length} rooms, ${cellsPlaced} cells.`);
        })
      )
  );

  // ── devpilot_place_spawns_and_collectibles ────────────────────────────────
  server.tool(
    "devpilot_place_spawns_and_collectibles",
    "Read tilemap.get_used_cells, identify floor tiles (cells with empty cell directly above), randomly distribute scene instances at those positions.",
    {
      tilemap_path: z.string(),
      scene_paths: z.array(z.string()).describe("List of .tscn paths to instance"),
      density: z.number().min(0).max(1).optional().default(0.05),
      max_instances: z.number().int().positive().optional().default(30),
      tile_size: z.number().int().positive().optional().default(32),
      parent_path: z.string().optional().default("."),
      layer: z.number().int().nonnegative().optional().default(0),
      seed: z.number().int().optional().default(42),
      dry_run: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_place_spawns_and_collectibles", config), async (): Promise<ToolResponse> => {
          const cellsResp = await callRpc(godot, "tilemap.get_used_cells", { node_path: params.tilemap_path, layer: params.layer });
          if (!cellsResp.ok) return cellsResp;
          const cells = ((cellsResp.data as { cells?: Array<{ x: number; y: number }> }).cells ?? []);
          const cellSet = new Set(cells.map((c) => `${c.x},${c.y}`));
          // Floor tile = cell with no cell directly above (open space)
          const floorTiles = cells.filter((c) => !cellSet.has(`${c.x},${c.y - 1}`));
          if (params.dry_run) return dryRun("devpilot_place_spawns_and_collectibles", [`${floorTiles.length} candidate floor tiles, density=${params.density}, max=${params.max_instances}`]);
          const rand = rng(params.seed);
          const targetCount = Math.min(params.max_instances, Math.ceil(floorTiles.length * params.density));
          const placed: Array<{ scene: string; x: number; y: number }> = [];
          const shuffled = [...floorTiles].sort(() => rand() - 0.5);
          for (let i = 0; i < targetCount && i < shuffled.length; i++) {
            const tile = shuffled[i];
            const sceneIdx = Math.floor(rand() * params.scene_paths.length);
            const scenePath = params.scene_paths[sceneIdx];
            const worldX = tile.x * params.tile_size;
            const worldY = (tile.y - 1) * params.tile_size;
            const r = await callRpc(godot, "scene.add_instance", { scene_path: scenePath, parent_path: params.parent_path });
            if (r.ok) {
              placed.push({ scene: scenePath, x: worldX, y: worldY });
            }
          }
          return createSuccessResponse({ tilemap_path: params.tilemap_path, candidate_tiles: floorTiles.length, instances_placed: placed.length, by_scene: params.scene_paths.map((s) => ({ scene: s, count: placed.filter((p) => p.scene === s).length })) }, `Placed ${placed.length} instances on floor tiles.`);
        })
      )
  );

  // ── devpilot_validate_level_playability ───────────────────────────────────
  server.tool(
    "devpilot_validate_level_playability",
    "A* pathfinding check from start to end over walkable cells (cells NOT in tilemap.get_used_cells). Returns reachability + path length + dead-end count.",
    {
      tilemap_path: z.string(),
      start: z.object({ x: z.number().int(), y: z.number().int() }),
      end: z.object({ x: z.number().int(), y: z.number().int() }),
      bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }).describe("Search area"),
      layer: z.number().int().nonnegative().optional().default(0),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_validate_level_playability", config), async (): Promise<ToolResponse> => {
          if (params.bounds.width * params.bounds.height > 10000) {
            return createErrorResponse("BOUNDS_TOO_LARGE", "Bounds exceed 10000 cells.", {}, ["Reduce search area"]) as ToolResponse;
          }
          const cellsResp = await callRpc(godot, "tilemap.get_used_cells", { node_path: params.tilemap_path, layer: params.layer });
          if (!cellsResp.ok) return cellsResp;
          const cells = ((cellsResp.data as { cells?: Array<{ x: number; y: number }> }).cells ?? []);
          const wallSet = new Set(cells.map((c) => `${c.x},${c.y}`));

          const w = params.bounds.width;
          const h = params.bounds.height;
          const walkable: boolean[][] = Array.from({ length: h }, (_, y) =>
            Array.from({ length: w }, (_, x) => !wallSet.has(`${params.bounds.x + x},${params.bounds.y + y}`))
          );

          const startLocal: [number, number] = [params.start.x - params.bounds.x, params.start.y - params.bounds.y];
          const endLocal: [number, number] = [params.end.x - params.bounds.x, params.end.y - params.bounds.y];

          if (startLocal[0] < 0 || startLocal[1] < 0 || startLocal[0] >= w || startLocal[1] >= h) {
            return createErrorResponse("START_OUT_OF_BOUNDS", "Start position outside bounds.", {}, []) as ToolResponse;
          }
          if (!walkable[startLocal[1]][startLocal[0]] || !walkable[endLocal[1]][endLocal[0]]) {
            return createSuccessResponse({ reachable: false, reason: "Start or end is on a wall cell." }, "Path not reachable.");
          }

          const result = astar(walkable, startLocal, endLocal);

          // Count dead ends in walkable area
          let deadEnds = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (!walkable[y][x]) continue;
              let openNeighbors = 0;
              for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < w && ny < h && walkable[ny][nx]) openNeighbors++;
              }
              if (openNeighbors <= 1) deadEnds++;
            }
          }

          return createSuccessResponse({
            reachable: result.reachable,
            path_length: result.path.length,
            dead_ends: deadEnds,
            walkable_cells: walkable.flat().filter(Boolean).length,
            bounds: params.bounds,
          }, result.reachable ? `Path found (${result.path.length} steps, ${deadEnds} dead ends).` : "No path between start and end.");
        })
      )
  );

  // ── devpilot_balance_level_difficulty ─────────────────────────────────────
  server.tool(
    "devpilot_balance_level_difficulty",
    "Compute heuristic difficulty score for a level (enemies + gaps + length) and suggest adjustments.",
    {
      enemy_count: z.number().int().nonnegative(),
      gap_count: z.number().int().nonnegative().optional().default(0),
      level_length: z.number().int().positive(),
      target_difficulty: z.enum(["easy", "medium", "hard"]).optional().default("medium"),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("devpilot_balance_level_difficulty", config), async (): Promise<ToolResponse> => {
          const enemyWeight = 5;
          const gapWeight = 3;
          const score = (params.enemy_count * enemyWeight + params.gap_count * gapWeight) / Math.max(1, params.level_length / 10);
          const targets = { easy: { min: 0, max: 5 }, medium: { min: 5, max: 12 }, hard: { min: 12, max: 25 } };
          const target = targets[params.target_difficulty];
          const suggestions: string[] = [];
          if (score < target.min) {
            const need = Math.ceil((target.min - score) * params.level_length / 10 / enemyWeight);
            suggestions.push(`Add ~${need} enemies to reach ${params.target_difficulty} difficulty.`);
          } else if (score > target.max) {
            const remove = Math.ceil((score - target.max) * params.level_length / 10 / enemyWeight);
            suggestions.push(`Remove ~${remove} enemies to lower to ${params.target_difficulty} difficulty.`);
          }
          if (params.gap_count > params.level_length / 10) suggestions.push("Too many gaps — may frustrate players.");
          if (params.enemy_count === 0 && params.gap_count === 0) suggestions.push("Level has no challenge — consider adding enemies or hazards.");

          return createSuccessResponse({
            score: Math.round(score * 100) / 100,
            target_difficulty: params.target_difficulty,
            target_range: target,
            in_range: score >= target.min && score <= target.max,
            inputs: { enemies: params.enemy_count, gaps: params.gap_count, length: params.level_length },
            suggestions,
          }, `Difficulty score: ${score.toFixed(2)} (target: ${params.target_difficulty} = ${target.min}-${target.max}).`);
        })
      )
  );
}
