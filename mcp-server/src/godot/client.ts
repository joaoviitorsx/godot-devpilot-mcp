import WebSocket from "ws";

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

  constructor(private readonly config: GodotConnectionConfig) {}

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

    this.manualDisconnect = false;
    this.clearReconnectTimer();

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
        this.reconnectAttempts = 0;
        this.lastConnectedAt = new Date().toISOString();
        resolve(createSuccessResponse(this.getStatus(), "Connected to Godot plugin."));
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
    if (!this.isConnected() || !this.socket) {
      return this.notConnectedError({ method });
    }

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
      this.socket?.send(JSON.stringify(request), (error) => {
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
    return this.socket?.readyState === WebSocket.OPEN;
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
