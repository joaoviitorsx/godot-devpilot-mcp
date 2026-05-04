import path from "node:path";

import { createSafetyError } from "./errors.js";

export type ResolvedProjectPath = {
  inputPath: string;
  resPath: string;
  relativePath: string;
  absolutePath: string;
};

const RES_PREFIX = "res://";

function rejectPath(inputPath: string, projectRoot: string, reason: string): never {
  throw createSafetyError(
    "PATH_OUTSIDE_PROJECT",
    "Path is outside the Godot project sandbox.",
    { path: inputPath, project_root: projectRoot, reason },
    ["Use a res:// path that stays inside the active Godot project."]
  );
}

function hasUnsafeScheme(inputPath: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(inputPath) && !inputPath.startsWith(RES_PREFIX);
}

function isWindowsAbsolutePath(inputPath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(inputPath);
}

export function resolveProjectPath(inputPath: string, projectRoot: string): ResolvedProjectPath {
  const trimmedPath = inputPath.trim();
  const absoluteRoot = path.resolve(projectRoot);

  if (!trimmedPath) {
    rejectPath(inputPath, absoluteRoot, "empty path");
  }

  if (hasUnsafeScheme(trimmedPath) || isWindowsAbsolutePath(trimmedPath) || path.isAbsolute(trimmedPath)) {
    rejectPath(inputPath, absoluteRoot, "absolute or unsupported URI path");
  }

  if (!trimmedPath.startsWith(RES_PREFIX)) {
    rejectPath(inputPath, absoluteRoot, "path must use res://");
  }

  const rawRelativePath = trimmedPath.slice(RES_PREFIX.length).replace(/\\/g, "/");
  if (!rawRelativePath || rawRelativePath.startsWith("/")) {
    rejectPath(inputPath, absoluteRoot, "invalid res:// path");
  }

  const segments = rawRelativePath.split("/");
  if (segments.some((segment) => segment === "..")) {
    rejectPath(inputPath, absoluteRoot, "path traversal segment");
  }

  const normalizedRelativePath = path.posix.normalize(rawRelativePath);
  if (
    normalizedRelativePath === "." ||
    normalizedRelativePath === ".." ||
    normalizedRelativePath.startsWith("../") ||
    normalizedRelativePath.includes("/../")
  ) {
    rejectPath(inputPath, absoluteRoot, "path traversal after normalization");
  }

  const absolutePath = path.resolve(absoluteRoot, ...normalizedRelativePath.split("/"));
  const rootPrefix = absoluteRoot.endsWith(path.sep) ? absoluteRoot : `${absoluteRoot}${path.sep}`;

  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(rootPrefix)) {
    rejectPath(inputPath, absoluteRoot, "resolved path escapes project root");
  }

  return {
    inputPath,
    resPath: `${RES_PREFIX}${normalizedRelativePath}`,
    relativePath: normalizedRelativePath,
    absolutePath
  };
}
