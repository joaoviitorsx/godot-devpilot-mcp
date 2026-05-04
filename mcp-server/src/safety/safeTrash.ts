import { access, appendFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { createSafetyError, SafetyError } from "./errors.js";
import { resolveProjectPath } from "./pathGuard.js";

export type MoveToSafeTrashInput = {
  projectRoot: string;
  resPath: string;
  toolName: string;
  now?: Date;
};

export type SafeTrashResult = {
  resPath: string;
  absolutePath: string;
  trashResPath: string;
  trashAbsolutePath: string;
};

function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function timeKey(now: Date): string {
  return now.toISOString().slice(11, 19).replace(/:/g, "");
}

function toResPath(relativePath: string): string {
  return `res://${relativePath.split(path.sep).join("/")}`;
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueTrashTarget(
  projectRoot: string,
  baseRelativePath: string
): Promise<{ trashRelativePath: string; trashAbsolutePath: string }> {
  let trashRelativePath = `${baseRelativePath}.deleted`;
  let trashAbsolutePath = path.join(projectRoot, ...trashRelativePath.split("/"));
  let collisionIndex = 1;

  while (await exists(trashAbsolutePath)) {
    trashRelativePath = `${baseRelativePath}.${collisionIndex}.deleted`;
    trashAbsolutePath = path.join(projectRoot, ...trashRelativePath.split("/"));
    collisionIndex += 1;
  }

  return { trashRelativePath, trashAbsolutePath };
}

export async function moveToSafeTrash(input: MoveToSafeTrashInput): Promise<SafeTrashResult> {
  const now = input.now ?? new Date();
  const source = resolveProjectPath(input.resPath, input.projectRoot);
  const trashBaseRelativePath = path.posix.join(
    ".godot_mcp",
    "trash",
    dateKey(now),
    `${source.relativePath}.${timeKey(now)}.deleted`
  ).slice(0, -".deleted".length);
  const { trashRelativePath, trashAbsolutePath } = await resolveUniqueTrashTarget(
    input.projectRoot,
    trashBaseRelativePath
  );
  const trashResPath = toResPath(trashRelativePath);
  const metadataPath = path.join(input.projectRoot, ".godot_mcp", "trash", dateKey(now), "metadata.jsonl");

  try {
    await mkdir(path.dirname(trashAbsolutePath), { recursive: true });
    await rename(source.absolutePath, trashAbsolutePath);
    await appendFile(
      metadataPath,
      `${JSON.stringify({
        timestamp: now.toISOString(),
        tool: input.toolName,
        source: source.resPath,
        trash: trashResPath
      })}\n`,
      "utf8"
    );
  } catch (error) {
    if (error instanceof SafetyError) {
      throw error;
    }

    throw createSafetyError(
      "SAFE_TRASH_FAILED",
      "Could not move the target file into safe trash.",
      {
        source: source.resPath,
        trash: trashResPath,
        cause: error instanceof Error ? error.message : String(error)
      },
      ["Do not continue the delete operation until safe trash succeeds."]
    );
  }

  return {
    resPath: source.resPath,
    absolutePath: source.absolutePath,
    trashResPath,
    trashAbsolutePath
  };
}
