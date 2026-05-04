import { createSuccessResponse, type ToolSuccess } from "../godot/protocol.js";

export type DryRunInput = {
  toolName: string;
  plannedChanges: string[];
  affectedFiles?: string[];
  affectedNodes?: string[];
};

export type DryRunPayload = {
  dry_run: true;
  applied: false;
  would_change: boolean;
  tool: string;
  planned_changes: string[];
  affected_files: string[];
  affected_nodes: string[];
};

export function createDryRunResponse(input: DryRunInput): ToolSuccess<DryRunPayload> {
  return createSuccessResponse(
    {
      dry_run: true,
      applied: false,
      would_change: input.plannedChanges.length > 0,
      tool: input.toolName,
      planned_changes: input.plannedChanges,
      affected_files: input.affectedFiles ?? [],
      affected_nodes: input.affectedNodes ?? []
    },
    "Dry run completed. No changes were applied.",
    [],
    ["Run the tool again with dry_run=false to apply the reviewed changes."]
  );
}
