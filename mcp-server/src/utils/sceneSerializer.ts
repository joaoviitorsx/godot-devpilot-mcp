// Declarative scene serializer — converts a JSON SceneSpec into a Godot 4 .tscn
// text payload. Lets DevPilot tools (and the LLM client) describe whole scene
// trees in one call instead of issuing dozens of node.add / set_property RPCs.

export type ExtResource = {
  id: string;
  type: string;             // "Script" | "PackedScene" | "Texture2D" | ...
  path: string;             // res:// path
};

export type SubResource = {
  id: string;
  type: string;             // "RectangleShape2D" | "CircleShape2D" | "GDScript" | ...
  props?: Record<string, unknown>;
};

export type NodeSpec = {
  name: string;
  type?: string;            // class name. Omit if `instance` is set.
  instance?: string;        // ext_resource id (for PackedScene instances)
  script?: string;          // ext_resource id of a Script
  props?: Record<string, unknown>;
  groups?: string[];        // serialized as `groups = [...]`
  children?: NodeSpec[];
};

export type SceneSpec = {
  path: string;             // res://path/to/scene.tscn
  ext_resources?: ExtResource[];
  sub_resources?: SubResource[];
  root: NodeSpec;
};

// ── Value formatting ─────────────────────────────────────────────────────────

function isVector2(v: unknown): v is { x: number; y: number } {
  return !!v && typeof v === "object" && "x" in (v as object) && "y" in (v as object) && Object.keys(v as object).every((k) => k === "x" || k === "y");
}

function isVector3(v: unknown): v is { x: number; y: number; z: number } {
  if (!v || typeof v !== "object") return false;
  const keys = Object.keys(v as object);
  return keys.length === 3 && keys.every((k) => k === "x" || k === "y" || k === "z");
}

function isColor(v: unknown): v is { r: number; g: number; b: number; a?: number } {
  if (!v || typeof v !== "object") return false;
  const keys = Object.keys(v as object);
  return keys.every((k) => ["r", "g", "b", "a"].includes(k)) && "r" in (v as object) && "g" in (v as object) && "b" in (v as object);
}

function isResRef(v: unknown): v is { __res: string } | { __sub: string } | { __ext: string } {
  return !!v && typeof v === "object" && (
    "__res" in (v as object) || "__sub" in (v as object) || "__ext" in (v as object)
  );
}

function isPackedVector2Array(v: unknown): v is { __packed_vector2: number[] } {
  return !!v && typeof v === "object" && "__packed_vector2" in (v as object);
}

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "string") return `"${escapeString(v)}"`;
  if (isResRef(v)) {
    const ref = v as Record<string, string>;
    if ("__sub" in ref) return `SubResource("${ref.__sub}")`;
    if ("__ext" in ref || "__res" in ref) return `ExtResource("${ref.__ext ?? ref.__res}")`;
  }
  if (isPackedVector2Array(v)) {
    const arr = (v as { __packed_vector2: number[] }).__packed_vector2;
    return `PackedVector2Array(${arr.join(", ")})`;
  }
  if (isVector2(v)) return `Vector2(${v.x}, ${v.y})`;
  if (isVector3(v)) return `Vector3(${v.x}, ${v.y}, ${v.z})`;
  if (isColor(v)) return `Color(${v.r}, ${v.g}, ${v.b}, ${v.a ?? 1})`;
  if (Array.isArray(v)) {
    return `[${v.map(formatValue).join(", ")}]`;
  }
  // Fallback — JSON stringify (dictionaries become Godot Dictionary literals).
  if (typeof v === "object") {
    const entries = Object.entries(v as object).map(([k, val]) => `"${k}": ${formatValue(val)}`);
    return `{${entries.join(", ")}}`;
  }
  return JSON.stringify(v);
}

// ── Node tree flattening ─────────────────────────────────────────────────────

type FlatNode = {
  name: string;
  parent: string;          // "." for root, "Player" for first-level child, etc.
  type?: string;
  instance?: string;
  script?: string;
  props?: Record<string, unknown>;
  groups?: string[];
};

function flatten(root: NodeSpec): FlatNode[] {
  const out: FlatNode[] = [];
  function walk(node: NodeSpec, parentPath: string): void {
    const isRoot = parentPath === "";
    const nodePath = isRoot ? "." : (parentPath === "." ? node.name : `${parentPath}/${node.name}`);
    out.push({
      name: node.name,
      parent: isRoot ? "" : parentPath,
      type: node.type,
      instance: node.instance,
      script: node.script,
      props: node.props,
      groups: node.groups,
    });
    if (node.children) {
      for (const c of node.children) walk(c, nodePath === "." ? "." : nodePath);
    }
  }
  walk(root, "");
  return out;
}

// ── Main serializer ──────────────────────────────────────────────────────────

export function serializeSceneToTscn(spec: SceneSpec): string {
  const ext = spec.ext_resources ?? [];
  const sub = spec.sub_resources ?? [];
  const flat = flatten(spec.root);

  const loadSteps = ext.length + sub.length + 1; // resources + scene itself

  const lines: string[] = [];
  lines.push(`[gd_scene load_steps=${loadSteps} format=3]`);
  lines.push("");

  for (const r of ext) {
    lines.push(`[ext_resource type="${r.type}" path="${r.path}" id="${r.id}"]`);
  }
  if (ext.length > 0) lines.push("");

  for (const r of sub) {
    lines.push(`[sub_resource type="${r.type}" id="${r.id}"]`);
    if (r.props) {
      for (const [k, v] of Object.entries(r.props)) {
        lines.push(`${k} = ${formatValue(v)}`);
      }
    }
    lines.push("");
  }

  for (const n of flat) {
    const headerParts: string[] = [`name="${n.name}"`];
    if (n.type) headerParts.push(`type="${n.type}"`);
    if (n.parent !== "") headerParts.push(`parent="${n.parent}"`);
    if (n.instance) headerParts.push(`instance=ExtResource("${n.instance}")`);
    lines.push(`[node ${headerParts.join(" ")}]`);
    if (n.script) {
      lines.push(`script = ExtResource("${n.script}")`);
    }
    if (n.props) {
      for (const [k, v] of Object.entries(n.props)) {
        lines.push(`${k} = ${formatValue(v)}`);
      }
    }
    if (n.groups && n.groups.length > 0) {
      lines.push(`groups = [${n.groups.map((g) => `"${g}"`).join(", ")}]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Validation ──────────────────────────────────────────────────────────────

export type ValidationIssue = { severity: "error" | "warn"; path: string; message: string };

function collectRefs(value: unknown, path: string, refs: { sub: Set<string>; ext: Set<string> }, where: { sub: Map<string, string[]>; ext: Map<string, string[]> }): void {
  if (value === null || typeof value !== "object") return;
  if (isResRef(value)) {
    const v = value as Record<string, string>;
    if ("__sub" in v) {
      refs.sub.add(v.__sub);
      const arr = where.sub.get(v.__sub) ?? [];
      arr.push(path);
      where.sub.set(v.__sub, arr);
    }
    if ("__ext" in v || "__res" in v) {
      const id = v.__ext ?? v.__res;
      refs.ext.add(id);
      const arr = where.ext.get(id) ?? [];
      arr.push(path);
      where.ext.set(id, arr);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectRefs(v, `${path}[${i}]`, refs, where));
    return;
  }
  for (const [k, v] of Object.entries(value as object)) {
    collectRefs(v, `${path}.${k}`, refs, where);
  }
}

function visitNodes(node: NodeSpec, parentPath: string, visit: (n: NodeSpec, p: string) => void): void {
  const np = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
  visit(node, np);
  if (node.children) for (const c of node.children) visitNodes(c, np, visit);
}

export function validateSceneSpec(spec: SceneSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const subIds = new Set((spec.sub_resources ?? []).map((s) => s.id));
  const extIds = new Set((spec.ext_resources ?? []).map((e) => e.id));
  const seenSubIds = new Set<string>();
  const seenExtIds = new Set<string>();

  if (!spec.path.endsWith(".tscn")) {
    issues.push({ severity: "error", path: "path", message: "spec.path must end in .tscn" });
  }
  for (const e of spec.ext_resources ?? []) {
    if (seenExtIds.has(e.id)) issues.push({ severity: "error", path: `ext_resources.${e.id}`, message: "duplicate ext_resource id" });
    seenExtIds.add(e.id);
    if (!e.path.startsWith("res://")) issues.push({ severity: "warn", path: `ext_resources.${e.id}`, message: "ext_resource path should start with res://" });
  }
  for (const s of spec.sub_resources ?? []) {
    if (seenSubIds.has(s.id)) issues.push({ severity: "error", path: `sub_resources.${s.id}`, message: "duplicate sub_resource id" });
    seenSubIds.add(s.id);
  }

  const refs = { sub: new Set<string>(), ext: new Set<string>() };
  const where = { sub: new Map<string, string[]>(), ext: new Map<string, string[]>() };

  visitNodes(spec.root, "", (n, p) => {
    if (n.props) collectRefs(n.props, `${p}.props`, refs, where);
    if (n.script && !extIds.has(n.script)) {
      issues.push({ severity: "error", path: `${p}.script`, message: `script references unknown ext_resource id '${n.script}'` });
    }
    if (n.instance && !extIds.has(n.instance)) {
      issues.push({ severity: "error", path: `${p}.instance`, message: `instance references unknown ext_resource id '${n.instance}'` });
    }
    if (n.type && n.instance) {
      issues.push({ severity: "warn", path: p, message: "node has both type and instance — instance takes precedence; drop type to avoid confusion" });
    }
    if (!n.type && !n.instance) {
      issues.push({ severity: "error", path: p, message: "node missing both type and instance" });
    }
  });
  for (const sr of spec.sub_resources ?? []) {
    if (sr.props) collectRefs(sr.props, `sub_resources.${sr.id}.props`, refs, where);
  }

  for (const id of refs.sub) {
    if (!subIds.has(id)) {
      const where_ = where.sub.get(id) ?? [];
      issues.push({ severity: "error", path: where_[0] ?? "?", message: `SubResource("${id}") referenced but not defined in sub_resources` });
    }
  }
  for (const id of refs.ext) {
    if (!extIds.has(id)) {
      const where_ = where.ext.get(id) ?? [];
      issues.push({ severity: "error", path: where_[0] ?? "?", message: `ExtResource("${id}") referenced but not defined in ext_resources` });
    }
  }
  // Unused (warn).
  for (const id of subIds) if (!refs.sub.has(id)) issues.push({ severity: "warn", path: `sub_resources.${id}`, message: "sub_resource never referenced" });
  for (const id of extIds) if (!refs.ext.has(id)) {
    // ext can be implicitly used via script/instance — re-check.
    let used = false;
    visitNodes(spec.root, "", (n) => { if (n.script === id || n.instance === id) used = true; });
    if (!used) issues.push({ severity: "warn", path: `ext_resources.${id}`, message: "ext_resource never referenced" });
  }

  return issues;
}

// ── Convenience helpers for callers building specs ───────────────────────────

export const SubRef = (id: string) => ({ __sub: id });
export const ExtRef = (id: string) => ({ __ext: id });
export const PolygonRect = (halfW: number, halfH: number) => ({
  __packed_vector2: [-halfW, -halfH, halfW, -halfH, halfW, halfH, -halfW, halfH],
});
export const PolygonFromPoints = (points: Array<[number, number]>) => ({
  __packed_vector2: points.flat(),
});
