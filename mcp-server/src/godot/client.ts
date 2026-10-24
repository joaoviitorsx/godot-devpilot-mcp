import WebSocket from "ws";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  createErrorResponse,
  createJsonRpcRequest,
  createSuccessResponse,
  normalizePluginResponse,
  type JsonRpcId,
  type ToolResponse
} from "./protocol.js";
import type { GodotConnectionConfig } from "../config/config.js";

type ReconnectConfig = GodotConnectionConfig["reconnect"];

export type GodotConnectionStatus = {
  connected: boolean;
  host: string;
  port: number;
  url: string;
  pendingRequests: number;
  reconnectAttempts: number;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
};

type PendingRequest = {
  resolve: (response: ToolResponse) => void;
  timeout: NodeJS.Timeout;
};

export function calculateReconnectDelayMs(reconnect: ReconnectConfig, attempt: number): number {
  const multiplier = 2 ** Math.max(0, attempt);
  return Math.min(reconnect.initialDelayMs * multiplier, reconnect.maxDelayMs);
}

export class GodotClient {
  private socket: WebSocket | null = null;
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private manualDisconnect = false;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private ready = false;
  private authToken = "";
  private connecting: Promise<ToolResponse<GodotConnectionStatus>> | null = null;

  constructor(private readonly config: GodotConnectionConfig, private readonly expected?: { projectRoot: string; pluginVersion: string; protocolVersion: string }) {}

  getStatus(): GodotConnectionStatus {
    return {
      connected: this.isConnected(),
      host: this.config.host,
      port: this.config.port,
      url: this.url,
      pendingRequests: this.pendingRequests.size,
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt
    };
  }

  async connect(): Promise<ToolResponse<GodotConnectionStatus>> {
    if (this.isConnected()) {
      return createSuccessResponse(this.getStatus(), "Already connected to Godot.");
    }
    if (this.connecting) return this.connecting;
    const operation = this.connectSocket();
    this.connecting = operation;
    try { return await operation; }
    finally { if (this.connecting === operation) this.connecting = null; }
  }

  private async connectSocket(): Promise<ToolResponse<GodotConnectionStatus>> {
    this.manualDisconnect = false;
    this.clearReconnectTimer();
    if (this.expected) {
      try {
        this.authToken = readFileSync(path.join(this.expected.projectRoot, ".godot_mcp", "bridge-token"), "utf8").trim();
        if (!/^[0-9a-f]{64}$/.test(this.authToken)) throw new Error("Invalid token format");
      } catch {
        return createErrorResponse("BRIDGE_TOKEN_MISSING", "The Godot editor bridge token is unavailable.", {}, ["Open this project in Godot and enable the DevPilot plugin."]);
      }
    }

    return new Promise((resolve) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      const timeout = setTimeout(() => {
        socket.terminate();
        resolve(
          createErrorResponse(
            "TIMEOUT",
            "Timed out while connecting to the Godot plugin.",
            { host: this.config.host, port: this.config.port, timeout_ms: this.config.timeoutMs },
            ["Confirm the Godot plugin is enabled and listening on the configured port."]
          )
        );
      }, this.config.timeoutMs);

      socket.once("open", () => {
        clearTimeout(timeout);
        void (async () => {
          if (this.expected) {
            const health = await this.sendRequest("system.health_check", {});
            if (!health.ok) {
              this.manualDisconnect = true;
              socket.close();
              resolve(health);
              return;
            }
            const data = health.data as Record<string, unknown> | null;
            let sameProject = false;
            try {
              const actual = realpathSync(String(data?.project_path ?? ""));
              const expected = realpathSync(this.expected.projectRoot);
              sameProject = process.platform === "win32" ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
            } catch { /* invalid or missing project path */ }
            if (!sameProject || data?.plugin_version !== this.expected.pluginVersion || data?.protocol_version !== this.expected.protocolVersion) {
              this.manualDisconnect = true;
              socket.close();
              resolve(createErrorResponse("BRIDGE_MISMATCH", "The connected Godot editor does not match this project or server version.", {
                expected_project: this.expected.projectRoot, actual_project: data?.project_path,
                expected_plugin_version: this.expected.pluginVersion, actual_plugin_version: data?.plugin_version,
                expected_protocol_version: this.expected.protocolVersion, actual_protocol_version: data?.protocol_version
              }, ["Open the configured project with the matching DevPilot plugin, then reconnect."]));
              return;
            }
          }
          this.ready = true;
          this.reconnectAttempts = 0;
          this.lastConnectedAt = new Date().toISOString();
          resolve(createSuccessResponse(this.getStatus(), "Connected to Godot plugin."));
        })();
      });

      socket.once("error", () => {
        clearTimeout(timeout);
        resolve(
          createErrorResponse(
            "GODOT_NOT_CONNECTED",
            "Could not connect to the Godot plugin.",
            { host: this.config.host, port: this.config.port },
            [
              "Open the Godot project and enable the Godot DevPilot MCP plugin.",
              "Check GODOT_MCP_HOST and GODOT_MCP_PORT."
            ]
          )
        );
      });

      socket.on("message", (message) => this.handleMessage(message.toString()));
      socket.on("close", () => this.handleClose());
    });
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.ready = false;
    this.clearReconnectTimer();

    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.resolve(this.notConnectedError({ request_id: id }));
    }
    this.pendingRequests.clear();
    this.reconnectAttempts = 0;

    if (this.socket) {
      this.socket.removeAllListeners();
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
    }

    this.socket = null;
    this.lastDisconnectedAt = new Date().toISOString();
  }

  async call(method: string, params: unknown = {}): Promise<ToolResponse> {
    if (!this.isConnected()) {
      return this.notConnectedError({ method });
    }

    return this.sendRequest(method, params);
  }

  private async sendRequest(method: string, params: unknown): Promise<ToolResponse> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return this.notConnectedError({ method });

    const request = createJsonRpcRequest(method, params);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        resolve(
          createErrorResponse(
            "TIMEOUT",
            "The Godot plugin did not respond before the timeout.",
            { method, timeout_ms: this.config.timeoutMs },
            ["Check the Godot editor output for a stuck or failing handler."]
          )
        );
      }, this.config.timeoutMs);

      this.pendingRequests.set(request.id, { resolve, timeout });
      this.socket?.send(JSON.stringify({ ...request, auth: this.authToken }), (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(request.id);
          resolve(
            createErrorResponse(
              "GODOT_NOT_CONNECTED",
              "Failed to send request to the Godot plugin.",
              { method, error: error.message },
              ["Restart the Godot plugin and try again."]
            )
          );
        }
      });
    });
  }

  private get url(): string {
    return `ws://${this.config.host}:${this.config.port}`;
  }

  private isConnected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  private handleMessage(rawMessage: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return;
    }

    const id = typeof parsed === "object" && parsed !== null && "id" in parsed ? (parsed as { id: JsonRpcId }).id : null;
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
    pending.resolve(normalizePluginResponse(parsed));
  }

  private handleClose(): void {
    this.socket = null;
    this.ready = false;
    this.lastDisconnectedAt = new Date().toISOString();

    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.resolve(this.notConnectedError({ request_id: id }));
    }
    this.pendingRequests.clear();

    if (!this.manualDisconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.config.reconnect.enabled || this.reconnectTimer) {
      return;
    }

    const delayMs = calculateReconnectDelayMs(this.config.reconnect, this.reconnectAttempts);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private notConnectedError(details: Record<string, unknown>): ToolResponse {
    return createErrorResponse(
      "GODOT_NOT_CONNECTED",
      "Godot plugin is not connected.",
      { ...details, host: this.config.host, port: this.config.port },
      [
        "Open the Godot project and enable the Godot DevPilot MCP plugin.",
        "Run godot_health_check after the plugin is active."
      ]
    );
  }
}
