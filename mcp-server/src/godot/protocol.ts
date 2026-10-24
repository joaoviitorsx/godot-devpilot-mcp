export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params: unknown;
};

export type JsonRpcError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
  suggestions: string[];
};

export type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      error: JsonRpcError;
    };

export type ToolSuccess<TData = unknown> = {
  ok: true;
  data: TData;
  message: string;
  warnings: string[];
  suggestions: string[];
};

export type ToolFailure = {
  ok: false;
  error: JsonRpcError;
};

export type ToolResponse<TData = unknown> = ToolSuccess<TData> | ToolFailure;

let nextRequestId = 1;

export function createJsonRpcRequest(
  method: string,
  params: unknown = {},
  id: JsonRpcId = `request-${nextRequestId++}`
): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

export function createSuccessResponse<TData>(
  data: TData,
  message = "Operation completed successfully.",
  warnings: string[] = [],
  suggestions: string[] = []
): ToolSuccess<TData> {
  return {
    ok: true,
    data,
    message,
    warnings,
    suggestions
  };
}

export function createErrorResponse(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  suggestions: string[] = []
): ToolFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
      suggestions
    }
  };
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.jsonrpc !== "2.0" || !("id" in candidate)) {
    return false;
  }

  return "result" in candidate || "error" in candidate;
}

function normalizeResult(result: unknown): ToolResponse {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return createErrorResponse("INVALID_PLUGIN_RESULT", "Godot returned a result without a valid tool status.", { result }, ["Check the editor output and retry the operation."]);
  }

  const candidate = result as Partial<ToolSuccess> & Partial<ToolFailure>;
  if (candidate.ok === true && "data" in candidate) {
    return {
      ok: true,
      data: candidate.data,
      message: typeof candidate.message === "string" ? candidate.message : "Operation completed successfully.",
      warnings: Array.isArray(candidate.warnings) ? candidate.warnings : [],
      suggestions: Array.isArray(candidate.suggestions) ? candidate.suggestions : []
    };
  }

  if (candidate.ok === false && candidate.error && typeof candidate.error === "object") {
    const error = candidate.error;
    return createErrorResponse(
      error.code || "UNKNOWN_ERROR",
      error.message || "Operation failed.",
      error.details || {},
      error.suggestions || []
    );
  }

  return createErrorResponse("INVALID_PLUGIN_RESULT", "Godot returned an incomplete tool result; the operation was not confirmed.", { result }, ["Check the editor output and retry the operation."]);
}

export function normalizePluginResponse(response: unknown): ToolResponse {
  if (!isJsonRpcResponse(response)) {
    return createErrorResponse(
      "INVALID_RESPONSE",
      "Plugin returned an invalid JSON-RPC response.",
      { response },
      ["Check the Godot plugin output for protocol errors."]
    );
  }

  if ("error" in response) {
    if (!response.error || typeof response.error !== "object") {
      return createErrorResponse("INVALID_RESPONSE", "Plugin returned a malformed JSON-RPC error.", { response }, []);
    }
    return createErrorResponse(
      response.error.code || "UNKNOWN_ERROR",
      response.error.message || "Plugin returned an error.",
      response.error.details || {},
      response.error.suggestions || []
    );
  }

  return normalizeResult(response.result);
}
