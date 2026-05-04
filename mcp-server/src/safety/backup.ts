import { access, appendFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { createSafetyError, SafetyError } from "./errors.js";
import { resolveProjectPath } from "./pathGuard.js";

export type CreateFileBackupInput = {
  projectRoot: string;
  resPath: string;
  toolName: string;
  reason: string;
  now?: Date;
};

export type FileBackupResult = {
  resPath: string;
  absolutePath: string;
  backupResPath: string;
  backupAbsolutePath: string;
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

async function resolveUniqueBackupTarget(
  projectRoot: string,
  baseRelativePath: string
): Promise<{ backupRelativePath: string; backupAbsolutePath: string }> {
  let backupRelativePath = `${baseRelativePath}.bak`;
  let backupAbsolutePath = path.join(projectRoot, ...backupRelativePath.split("/"));
  let collisionIndex = 1;

  while (await exists(backupAbsolutePath)) {
    backupRelativePath = `${baseRelativePath}.${collisionIndex}.bak`;
    backupAbsolutePath = path.join(projectRoot, ...backupRelativePath.split("/"));
    collisionIndex += 1;
  }

  return { backupRelativePath, backupAbsolutePath };
}

export async function createFileBackup(input: CreateFileBackupInput): Promise<FileBackupResult> {
  const now = input.now ?? new Date();
  const source = resolveProjectPath(input.resPath, input.projectRoot);
  const backupBaseRelativePath = path.posix.join(
    ".godot_mcp",
    "backups",
    dateKey(now),
    `${source.relativePath}.${timeKey(now)}.bak`
  ).slice(0, -".bak".length);
  const { backupRelativePath, backupAbsolutePath } = await resolveUniqueBackupTarget(
    input.projectRoot,
    backupBaseRelativePath
  );
  const backupResPath = toResPath(backupRelativePath);
  const metadataPath = path.join(input.projectRoot, ".godot_mcp", "backups", dateKey(now), "metadata.jsonl");

  try {
    await mkdir(path.dirname(backupAbsolutePath), { recursive: true });
    await copyFile(source.absolutePath, backupAbsolutePath);
    await appendFile(
      metadataPath,
      `${JSON.stringify({
        timestamp: now.toISOString(),
        tool: input.toolName,
        reason: input.reason,
        source: source.resPath,
        backup: backupResPath
      })}\n`,
      "utf8"
    );
  } catch (error) {
    if (error instanceof SafetyError) {
      throw error;
    }

    throw createSafetyError(
      "BACKUP_FAILED",
      "Could not create a backup for the target file.",
      {
        path: source.resPath,
        source: source.resPath,
        backup: backupResPath,
        cause: error instanceof Error ? error.message : String(error)
      },
      ["Do not continue the write operation until backup creation succeeds."]
    );
  }

  return {
    resPath: source.resPath,
    absolutePath: source.absolutePath,
    backupResPath,
    backupAbsolutePath
  };
}
