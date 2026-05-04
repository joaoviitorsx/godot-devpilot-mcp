import { appendActionLog } from "./actionLogger.js";
import { createSafetyError, SafetyError } from "./errors.js";
import { enforceReadOnlyMode } from "./permissions.js";
import { createErrorResponse, type ToolResponse } from "../godot/protocol.js";

export type ToolExecutionContext = {
  toolName: string;
  readOnly: boolean;
  projectRoot: string;
  requestId?: string;
};

function safetyErrorToResponse(error: SafetyError): ToolResponse {
  return createErrorResponse(
    error.code,
    error.message,
    error.details,
    error.suggestions
  );
}

function unknownErrorToResponse(error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return createErrorResponse(
    "TOOL_EXECUTION_FAILED",
    "Tool execution failed with an unexpected error.",
    { cause: message },
    ["Check the server logs for more details."]
  );
}

export async function executeToolSafely<T>(
  ctx: ToolExecutionContext,
  handler: () => Promise<ToolResponse<T>>
): Promise<ToolResponse<T>> {
  const start = Date.now();

  try {
    enforceReadOnlyMode({ toolName: ctx.toolName, readOnly: ctx.readOnly });
  } catch (error) {
    const response = error instanceof SafetyError
      ? safetyErrorToResponse(error)
      : safetyErrorToResponse(
          createSafetyError("READ_ONLY_MODE", "Read-only check failed.", {}, [])
        );

    await appendActionLog({
      projectRoot: ctx.projectRoot,
      toolName: ctx.toolName,
      status: "blocked",
      durationMs: Date.now() - start,
      requestId: ctx.requestId,
      summary: (error instanceof SafetyError ? error.message : "Read-only mode blocked tool."),
      details: error instanceof SafetyError ? error.details : {}
    }).catch(() => undefined);

    return response as ToolResponse<T>;
  }

  try {
    const result = await handler();
    const durationMs = Date.now() - start;

    const status = result.ok && typeof result.data === "object" && result.data !== null && "dry_run" in result.data
      ? "dry_run"
      : result.ok ? "success" : "error";

    await appendActionLog({
      projectRoot: ctx.projectRoot,
      toolName: ctx.toolName,
      status,
      durationMs,
      requestId: ctx.requestId,
      summary: result.ok ? result.message : result.error.message,
      details: result.ok ? undefined : result.error.details
    }).catch(() => undefined);

    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    const response = error instanceof SafetyError
      ? safetyErrorToResponse(error)
      : unknownErrorToResponse(error);

    await appendActionLog({
      projectRoot: ctx.projectRoot,
      toolName: ctx.toolName,
      status: error instanceof SafetyError ? "blocked" : "error",
      durationMs,
      requestId: ctx.requestId,
      summary: error instanceof Error ? error.message : String(error),
      details: error instanceof SafetyError ? error.details : {}
    }).catch(() => undefined);

    return response as ToolResponse<T>;
  }
}
