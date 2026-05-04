import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ServerConfig } from "../config/config.js";
import type { GodotClient } from "../godot/client.js";
import { createSuccessResponse, createErrorResponse, type ToolResponse } from "../godot/protocol.js";
import { executeToolSafely } from "../safety/toolWrapper.js";

function toMcpResult(r: ToolResponse): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], isError: !r.ok };
}

function ctx(toolName: string, config: ServerConfig) {
  return { toolName, readOnly: config.security.readOnly, projectRoot: config.projectRoot };
}

async function callRpc(godot: GodotClient, method: string, params: unknown = {}): Promise<ToolResponse> {
  if (!godot.getStatus().connected) {
    const c = await godot.connect();
    if (!c.ok) return c;
  }
  return godot.call(method, params);
}

function recordingsDir(projectRoot: string): string {
  return path.join(projectRoot, ".godot_mcp", "recordings");
}

function recordingPath(projectRoot: string, name: string): string {
  return path.join(recordingsDir(projectRoot), `${name}.json`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const InputEventSchema = z.object({
  type: z.enum(["press_key", "release_key", "tap_key", "press_action", "release_action", "mouse_click", "mouse_move", "mouse_drag"]),
  delay_ms: z.number().int().min(0).optional().default(0),
  params: z.record(z.unknown()).default({}),
});

type InputEvent = z.infer<typeof InputEventSchema>;

export function registerRecordingTools(server: McpServer, godot: GodotClient, config: ServerConfig): void {
  // ── godot_save_input_recording ─────────────────────────────────────────────
  server.tool(
    "godot_save_input_recording",
    "Persist an input event sequence to .godot_mcp/recordings/<name>.json. Each event is {type, delay_ms, params}.",
    {
      name: z.string().describe("Recording name (no extension)"),
      events: z.array(InputEventSchema).describe("Ordered input events"),
      description: z.string().optional(),
      overwrite: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_save_input_recording", config), async () => {
          if (config.security.readOnly) {
            return createErrorResponse("READ_ONLY_MODE", "Read-only mode.", {}, []) as ToolResponse;
          }
          await mkdir(recordingsDir(config.projectRoot), { recursive: true });
          const filePath = recordingPath(config.projectRoot, params.name);
          try {
            await readFile(filePath, "utf8");
            if (!params.overwrite) {
              return createErrorResponse("FILE_ALREADY_EXISTS", "Recording exists. Set overwrite=true.", { path: filePath }, []) as ToolResponse;
            }
          } catch { /* OK if not exists */ }
          const recording = {
            name: params.name,
            description: params.description ?? "",
            created_at: new Date().toISOString(),
            event_count: params.events.length,
            events: params.events,
          };
          await writeFile(filePath, JSON.stringify(recording, null, 2), "utf8");
          return createSuccessResponse({ name: params.name, path: filePath, event_count: params.events.length }, "Recording saved.");
        })
      )
  );

  // ── godot_list_input_recordings ────────────────────────────────────────────
  server.tool(
    "godot_list_input_recordings",
    "List all input recordings in .godot_mcp/recordings/.",
    {},
    async () =>
      toMcpResult(
        await executeToolSafely(ctx("godot_list_input_recordings", config), async () => {
          let files: string[] = [];
          try {
            files = await readdir(recordingsDir(config.projectRoot));
          } catch {
            return createSuccessResponse({ recordings: [], count: 0 }, "No recordings yet.");
          }
          const recordings: Array<{ name: string; description: string; event_count: number; created_at: string }> = [];
          for (const f of files) {
            if (!f.endsWith(".json")) continue;
            try {
              const content = await readFile(path.join(recordingsDir(config.projectRoot), f), "utf8");
              const rec = JSON.parse(content);
              recordings.push({ name: rec.name, description: rec.description, event_count: rec.event_count, created_at: rec.created_at });
            } catch { /* skip */ }
          }
          return createSuccessResponse({ recordings, count: recordings.length }, `Found ${recordings.length} recordings.`);
        })
      )
  );

  // ── godot_replay_input_recording ───────────────────────────────────────────
  server.tool(
    "godot_replay_input_recording",
    "Read a saved recording and replay each event via the corresponding input RPC. speed_factor scales delay_ms (>1 faster, <1 slower).",
    {
      name: z.string(),
      speed_factor: z.number().positive().optional().default(1),
      stop_on_error: z.boolean().optional().default(false),
    },
    async (params) =>
      toMcpResult(
        await executeToolSafely(ctx("godot_replay_input_recording", config), async () => {
          let content: string;
          try {
            content = await readFile(recordingPath(config.projectRoot, params.name), "utf8");
          } catch {
            return createErrorResponse("RECORDING_NOT_FOUND", `Recording '${params.name}' not found.`, {}, []) as ToolResponse;
          }
          const recording = JSON.parse(content) as { events: InputEvent[] };
          const methodMap: Record<InputEvent["type"], string> = {
            press_key: "input.press_key",
            release_key: "input.release_key",
            tap_key: "input.tap_key",
            press_action: "input.press_action",
            release_action: "input.release_action",
            mouse_click: "input.mouse_click",
            mouse_move: "input.mouse_move",
            mouse_drag: "input.mouse_drag",
          };

          const results: Array<{ index: number; type: string; ok: boolean; error?: unknown }> = [];
          for (let i = 0; i < recording.events.length; i++) {
            const ev = recording.events[i];
            if (ev.delay_ms > 0) await sleep(Math.max(1, Math.round(ev.delay_ms / params.speed_factor)));
            const r = await callRpc(godot, methodMap[ev.type], ev.params);
            results.push({ index: i, type: ev.type, ok: r.ok, error: r.ok ? undefined : r.error });
            if (!r.ok && params.stop_on_error) {
              return createErrorResponse("REPLAY_HALTED", `Event ${i} (${ev.type}) failed.`, { results }, []) as ToolResponse;
            }
          }
          const failed = results.filter((r) => !r.ok).length;
          return createSuccessResponse({
            name: params.name,
            events_replayed: results.length,
            failed_count: failed,
            speed_factor: params.speed_factor,
            results,
          }, `Replayed ${results.length} events (${failed} failures).`);
        })
      )
  );
}
