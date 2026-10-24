import { lstatSync, realpathSync } from "node:fs";
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

  // Existing ancestors may be symlinks. Check their real destinations as well as
  // the lexical path, including when the final file has not been created yet.
  const realRoot = realpathSync(absoluteRoot);
  let ancestor = absolutePath;
  while (true) {
    try {
      lstatSync(ancestor);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) rejectPath(inputPath, absoluteRoot, "path does not have an existing ancestor");
        ancestor = parent;
        continue;
      }
      throw error;
    }
    let realAncestor: string;
    try { realAncestor = realpathSync(ancestor); }
    catch { rejectPath(inputPath, absoluteRoot, "unresolvable symlink"); }
    const relative = path.relative(realRoot, realAncestor);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      rejectPath(inputPath, absoluteRoot, "symlink escapes project root");
    }
    break;
  }

  return {
    inputPath,
    resPath: `${RES_PREFIX}${normalizedRelativePath}`,
    relativePath: normalizedRelativePath,
    absolutePath
  };
}

/** Resolve an ordinary project-relative path with the same sandbox rules as res://. */
export function resolveProjectRelativePath(inputPath: string, projectRoot: string): ResolvedProjectPath {
  const value = inputPath.trim().replace(/\\/g, "/");
  if (!value || value.startsWith("/") || /^[a-zA-Z]:/.test(value) || value.includes("://")) {
    rejectPath(inputPath, path.resolve(projectRoot), "expected a project-relative path");
  }
  return resolveProjectPath(value.startsWith(RES_PREFIX) ? value : `${RES_PREFIX}${value}`, projectRoot);
}

/** Validate a single filename component supplied by a client or a JSON document. */
export function safePathComponent(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) || value === "." || value === ".." || value.endsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw createSafetyError("PATH_OUTSIDE_PROJECT", "Invalid file or snapshot name.", { name: value }, ["Use letters, numbers, dots, underscores, or hyphens without path separators."]);
  }
  return value;
}
