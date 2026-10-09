import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { normalizeMode, type ToolMode } from "./modes.js";

export type ProjectRootValidation =
  | { valid: true; resolvedPath: string }
  | { valid: false; resolvedPath: string; reason: string };

export function validateProjectRoot(projectRoot: string): ProjectRootValidation {
  const resolvedPath = path.resolve(projectRoot);
  if (!existsSync(resolvedPath)) {
    return { valid: false, resolvedPath, reason: "project root does not exist" };
  }
  let st;
  try {
    st = statSync(resolvedPath);
  } catch (error) {
    return { valid: false, resolvedPath, reason: `stat failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!st.isDirectory()) {
    return { valid: false, resolvedPath, reason: "project root is not a directory" };
  }
  if (!existsSync(path.join(resolvedPath, "project.godot"))) {
    return { valid: false, resolvedPath, reason: "project.godot not found at project root" };
  }
  return { valid: true, resolvedPath };
}

export type GodotConnectionConfig = {
  host: string;
  port: number;
  timeoutMs: number;
  reconnect: {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
  };
};

export type ServerConfig = {
  server: {
    name: string;
    version: string;
    protocolVersion: string;
  };
  godot: GodotConnectionConfig;
  mode: ToolMode;
  projectRoot: string;
  security: {
    readOnly: boolean;
  };
};

type Env = Record<string, string | undefined>;

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return fallback;
}

export function loadConfig(env: Env = process.env): ServerConfig {
  return {
    server: {
      name: "godot-devpilot-mcp",
      version: "2.6.0",
      protocolVersion: "1.0.0"
    },
    godot: {
      host: env.GODOT_MCP_HOST || "127.0.0.1",
      port: parseInteger(env.GODOT_MCP_PORT, 6505),
      timeoutMs: parseInteger(env.GODOT_MCP_TIMEOUT_MS, 5000),
      reconnect: {
        enabled: parseBoolean(env.GODOT_MCP_RECONNECT, true),
        initialDelayMs: parseInteger(env.GODOT_MCP_RECONNECT_INITIAL_MS, 500),
        maxDelayMs: parseInteger(env.GODOT_MCP_RECONNECT_MAX_MS, 5000)
      }
    },
    mode: normalizeMode(env.GODOT_MCP_MODE),
    projectRoot: path.resolve(env.GODOT_MCP_PROJECT_ROOT || process.cwd()),
    security: {
      readOnly: parseBoolean(env.GODOT_MCP_READ_ONLY, true)
    }
  };
}
