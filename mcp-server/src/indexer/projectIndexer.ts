import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRS = new Set([".godot", ".godot_mcp", "node_modules", ".git"]);

export type ProjectFileKind = "scene" | "script" | "resource" | "asset" | "other";

export type ProjectFile = {
  res_path: string;
  absolute_path: string;
  size_bytes: number;
  kind: ProjectFileKind;
};

export function classifyByExt(name: string): ProjectFileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tscn") || lower.endsWith(".scn")) return "scene";
  if (lower.endsWith(".gd")) return "script";
  if (lower.endsWith(".tres") || lower.endsWith(".res")) return "resource";
  if (
    lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") || lower.endsWith(".svg") ||
    lower.endsWith(".ogg") || lower.endsWith(".wav") || lower.endsWith(".mp3") ||
    lower.endsWith(".gltf") || lower.endsWith(".glb") || lower.endsWith(".fbx") ||
    lower.endsWith(".obj") || lower.endsWith(".ttf") || lower.endsWith(".otf")
  ) return "asset";
  return "other";
}

export async function indexProject(projectRoot: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = [];
  await walk(projectRoot, projectRoot, files);
  return files;
}

async function walk(absDir: string, projectRoot: string, out: ProjectFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(abs, projectRoot, out);
    } else if (entry.isFile()) {
      if (entry.name.startsWith(".") && !entry.name.endsWith(".gd")) continue;
      const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      out.push({
        res_path: `res://${rel}`,
        absolute_path: abs,
        size_bytes: st.size,
        kind: classifyByExt(entry.name)
      });
    }
  }
}

export type ProjectSummary = {
  scenes: number;
  scripts: number;
  resources: number;
  assets: number;
  other: number;
  total: number;
  main_scene: string | null;
  largest_files: Array<{ res_path: string; size_bytes: number }>;
};

export async function buildProjectSummary(projectRoot: string): Promise<ProjectSummary> {
  const files = await indexProject(projectRoot);
  const counts = { scene: 0, script: 0, resource: 0, asset: 0, other: 0 };
  for (const f of files) counts[f.kind]++;

  const mainScene = await readMainScene(projectRoot);
  const largest = [...files].sort((a, b) => b.size_bytes - a.size_bytes).slice(0, 5)
    .map((f) => ({ res_path: f.res_path, size_bytes: f.size_bytes }));

  return {
    scenes: counts.scene,
    scripts: counts.script,
    resources: counts.resource,
    assets: counts.asset,
    other: counts.other,
    total: files.length,
    main_scene: mainScene,
    largest_files: largest
  };
}

async function readMainScene(projectRoot: string): Promise<string | null> {
  try {
    const content = await readFile(path.join(projectRoot, "project.godot"), "utf8");
    const match = content.match(/run\/main_scene\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Dependency graph ──────────────────────────────────────────────────────────

export type DependencyEdge = { from: string; to: string; kind: "preload" | "load" | "extends" | "scene_resource" };

export type DependencyGraph = {
  nodes: string[];
  edges: DependencyEdge[];
};

const PRELOAD_RE = /preload\s*\(\s*["']([^"']+)["']\s*\)/g;
const LOAD_RE = /(?:^|[^a-zA-Z0-9_])load\s*\(\s*["']([^"']+)["']\s*\)/g;
const EXTENDS_RE = /extends\s+["']([^"']+)["']/g;
const SCENE_EXT_RES_RE = /\[ext_resource\s+[^\]]*path="([^"]+)"/g;

export async function buildDependencyGraph(projectRoot: string): Promise<DependencyGraph> {
  const files = await indexProject(projectRoot);
  const nodes = new Set<string>();
  const edges: DependencyEdge[] = [];

  for (const file of files) {
    if (file.kind !== "script" && file.kind !== "scene") continue;
    nodes.add(file.res_path);
    const content = await readFile(file.absolute_path, "utf8").catch(() => "");

    if (file.kind === "script") {
      collect(PRELOAD_RE, content, file.res_path, "preload", edges, nodes);
      collect(LOAD_RE, content, file.res_path, "load", edges, nodes);
      collect(EXTENDS_RE, content, file.res_path, "extends", edges, nodes);
    } else {
      collect(SCENE_EXT_RES_RE, content, file.res_path, "scene_resource", edges, nodes);
    }
  }

  return { nodes: [...nodes].sort(), edges };
}

function collect(re: RegExp, content: string, fromPath: string, kind: DependencyEdge["kind"], edges: DependencyEdge[], nodes: Set<string>): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const target = m[1];
    if (!target.startsWith("res://")) continue;
    edges.push({ from: fromPath, to: target, kind });
    nodes.add(target);
  }
}

// ── Signal map (parsed from .tscn ──────────────────────────────────────────────

export type SignalConnection = {
  scene: string;
  signal: string;
  from: string;
  to: string;
  method: string;
};

const TSCN_CONNECTION_RE = /\[connection\s+([^\]]+)\]/g;

export async function buildSignalMap(projectRoot: string): Promise<SignalConnection[]> {
  const files = await indexProject(projectRoot);
  const connections: SignalConnection[] = [];

  for (const file of files) {
    if (file.kind !== "scene") continue;
    const content = await readFile(file.absolute_path, "utf8").catch(() => "");
    TSCN_CONNECTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TSCN_CONNECTION_RE.exec(content)) !== null) {
      const attrs = parseAttributes(m[1]);
      if (!attrs.signal || !attrs.from || !attrs.to) continue;
      connections.push({
        scene: file.res_path,
        signal: attrs.signal,
        from: attrs.from,
        to: attrs.to,
        method: attrs.method ?? ""
      });
    }
  }

  return connections;
}

function parseAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

// ── Conventions check ─────────────────────────────────────────────────────────

export type ConventionViolation = {
  res_path: string;
  rule: string;
  message: string;
};

export function checkConventions(files: ProjectFile[]): ConventionViolation[] {
  const violations: ConventionViolation[] = [];
  for (const f of files) {
    const baseName = f.res_path.split("/").pop() ?? "";
    const stem = baseName.replace(/\.[^.]+$/, "");

    if (f.kind === "scene" && !/^[A-Z][A-Za-z0-9]*$/.test(stem)) {
      violations.push({ res_path: f.res_path, rule: "scene_pascal_case", message: "Scene file should use PascalCase." });
    }
    if (f.kind === "script" && !/^[A-Z][A-Za-z0-9_]*$/.test(stem) && !/^_?[a-z][a-z0-9_]*$/.test(stem)) {
      violations.push({ res_path: f.res_path, rule: "script_naming", message: "Script file should be PascalCase (class) or snake_case (helper)." });
    }
    if (f.kind === "asset" && /[A-Z\s]/.test(stem)) {
      violations.push({ res_path: f.res_path, rule: "asset_snake_case", message: "Asset file should use snake_case lowercase." });
    }
  }
  return violations;
}
