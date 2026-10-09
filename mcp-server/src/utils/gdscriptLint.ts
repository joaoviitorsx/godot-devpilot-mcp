// Lightweight GDScript linter / auto-fixer for templates produced by DevPilot
// codegen. Catches the small set of patterns that Godot 4 strict parser rejects
// and rewrites them into safe equivalents. Not a full parser — purely regex-driven
// — but covers the high-frequency mistakes seen in user reports:
//
//  1. @onready var X: T = $Path if has_node("Path") else null
//     → `var X: T = null` + `_ready` setup with has_node guard
//
//  2. var X := <Variant-source>
//     - var X := dict[key]               → drop `:=`
//     - var X := load(p).instantiate()   → drop `:=`
//     - var X := node.get_node(...)      → drop `:=`
//
//  3. return arr[0] if arr[0] is T else null
//     → return arr[0] as T   (safer narrowing for typed return)

export type LintIssue = {
  line: number;
  rule: string;
  severity: "warn" | "error";
  message: string;
  fixed: boolean;
};

export type LintResult = {
  ok: boolean;
  fixed: string;
  issues: LintIssue[];
};

const ONREADY_TERNARY_RE =
  /^(\s*)@onready\s+var\s+(\w+)\s*:\s*(\w+)\s*=\s*\$([\w/]+)\s+if\s+has_node\(("[^"]+")\)\s+else\s+null\s*$/;

const VARIANT_INFER_DICT_RE =
  /^(\s*)var\s+(\w+)\s*:=\s*([A-Za-z_]\w*\[[^\]]+\])(\s|$)/;

const VARIANT_INFER_LOAD_INSTANTIATE_RE =
  /^(\s*)var\s+(\w+)\s*:=\s*load\([^)]+\)\.instantiate\(\)/;

const VARIANT_INFER_GET_NODE_RE =
  /^(\s*)var\s+(\w+)\s*:=\s*get_node\(/;

const RETURN_TERNARY_TYPED_RE =
  /^(\s*)return\s+(\w+(?:\[\d+\])?)\s+if\s+\w+(?:\[\d+\])?\s+is\s+(\w+)\s+else\s+null\s*$/;

// Rule 6: var x := min/max/clamp(...) — Variant return.
const VARIANT_INFER_MIN_MAX_CLAMP_RE =
  /^(\s*)var\s+(\w+)\s*:=\s*(min|max|clamp)\s*\(/;

// Rule 7: var x := get_node_or_null(...).<chain>
const VARIANT_INFER_GET_NODE_OR_NULL_RE =
  /^(\s*)var\s+(\w+)\s*:=\s*get_node_or_null\([^)]+\)/;

// Rule 8: any min/max/clamp call (statement OR expression position) → typed variant.
// Matches `min(` / `max(` / `clamp(` not preceded by a word character (so
// `mini(` / `maxi(` are skipped). Heuristic: if any arg contains `.` it's
// treated as float, else int.
const MIN_MAX_CLAMP_CALL_RE = /\b(min|max|clamp)\s*\(/g;

function suffixForArgs(args: string): "i" | "f" {
  // Heuristic: presence of decimal point OR `f` suffix OR `delta`/`time`/`speed`/`rate`/`PI`/`TAU` keyword → float.
  if (/\d*\.\d|\bdelta\b|\btime\b|\bPI\b|\bTAU\b|\b[a-z_]*(?:speed|rate|secs|seconds|interval|duration|cooldown|gravity|float)\w*\b/.test(args)) {
    return "f";
  }
  return "i";
}

function balancedArgs(line: string, openIdx: number): { args: string; endIdx: number } | null {
  // openIdx points at "(". Walk forward respecting nesting.
  let depth = 0;
  for (let i = openIdx; i < line.length; i++) {
    const c = line[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        return { args: line.slice(openIdx + 1, i), endIdx: i };
      }
    }
  }
  return null;
}

function rewriteMinMaxClamp(line: string, issues: LintIssue[], lineNo: number): string {
  // Walk through matches manually to handle nested parens.
  let result = "";
  let cursor = 0;
  while (cursor < line.length) {
    MIN_MAX_CLAMP_CALL_RE.lastIndex = cursor;
    const m = MIN_MAX_CLAMP_CALL_RE.exec(line);
    if (!m) {
      result += line.slice(cursor);
      break;
    }
    const fnName = m[1];
    const startIdx = m.index;
    const openIdx = startIdx + fnName.length + (m[0].length - fnName.length - 1);
    // Find actual "(" position.
    const parenIdx = line.indexOf("(", startIdx);
    if (parenIdx === -1) {
      result += line.slice(cursor);
      break;
    }
    const balanced = balancedArgs(line, parenIdx);
    if (!balanced) {
      result += line.slice(cursor);
      break;
    }
    // Skip if already a typed variant by chance (shouldn't because regex requires bare `min`/`max`/`clamp`).
    const suffix = suffixForArgs(balanced.args);
    const replacement = `${fnName}${suffix}(${balanced.args})`;
    result += line.slice(cursor, startIdx) + replacement;
    cursor = balanced.endIdx + 1;
    issues.push({
      line: lineNo,
      rule: "min_max_clamp_typed_variant",
      severity: "warn",
      message: `${fnName}(...) returns Variant; rewrote as ${fnName}${suffix}(...)`,
      fixed: true,
    });
    void openIdx;
  }
  return result;
}

export function lintGDScript(source: string): LintResult {
  const lines = source.split("\n");
  const issues: LintIssue[] = [];
  const out: string[] = [];

  // Pending hoists from @onready ternary rewrites — injected into _ready at the end.
  const hoists: Array<{ varName: string; nodePath: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Rule 8 (apply first so subsequent rules see typed variants).
    if (/\b(?:min|max|clamp)\s*\(/.test(line)) {
      line = rewriteMinMaxClamp(line, issues, i + 1);
    }

    if (VARIANT_INFER_MIN_MAX_CLAMP_RE.test(line)) {
      issues.push({
        line: i + 1,
        rule: "variant_infer_min_max_clamp",
        severity: "warn",
        message: "min/max/clamp returns Variant; dropped `:=`",
        fixed: true,
      });
      line = line.replace(":=", "=");
    }

    if (VARIANT_INFER_GET_NODE_OR_NULL_RE.test(line)) {
      issues.push({
        line: i + 1,
        rule: "variant_infer_get_node_or_null",
        severity: "warn",
        message: "get_node_or_null(...) returns Node|null (Variant in chains); dropped `:=`",
        fixed: true,
      });
      line = line.replace(":=", "=");
    }

    const m1 = line.match(ONREADY_TERNARY_RE);
    if (m1) {
      const [, indent, varName, varType, , quotedPath] = m1;
      issues.push({
        line: i + 1,
        rule: "onready_ternary",
        severity: "error",
        message: `@onready ternary breaks typed parser; hoisted to _ready`,
        fixed: true,
      });
      line = `${indent}var ${varName}: ${varType} = null  # set in _ready (was @onready ternary)`;
      hoists.push({ varName, nodePath: quotedPath });
      out.push(line);
      continue;
    }

    if (VARIANT_INFER_DICT_RE.test(line)) {
      issues.push({
        line: i + 1,
        rule: "variant_infer_dict",
        severity: "warn",
        message: "Dictionary access returns Variant; dropped `:=` to avoid infer error",
        fixed: true,
      });
      line = line.replace(":=", "=");
      out.push(line);
      continue;
    }

    if (VARIANT_INFER_LOAD_INSTANTIATE_RE.test(line)) {
      issues.push({
        line: i + 1,
        rule: "variant_infer_load_instantiate",
        severity: "warn",
        message: "load(path).instantiate() returns Variant; dropped `:=`",
        fixed: true,
      });
      line = line.replace(":=", "=");
      out.push(line);
      continue;
    }

    if (VARIANT_INFER_GET_NODE_RE.test(line)) {
      issues.push({
        line: i + 1,
        rule: "variant_infer_get_node",
        severity: "warn",
        message: "get_node(...) returns Node; dropped `:=` to avoid infer error",
        fixed: true,
      });
      line = line.replace(":=", "=");
      out.push(line);
      continue;
    }

    const mr = line.match(RETURN_TERNARY_TYPED_RE);
    if (mr) {
      const [, indent, expr, typeName] = mr;
      issues.push({
        line: i + 1,
        rule: "return_ternary_typed",
        severity: "warn",
        message: "ternary return with `is` check; rewritten as `as <Type>`",
        fixed: true,
      });
      line = `${indent}return ${expr} as ${typeName}`;
      out.push(line);
      continue;
    }

    out.push(line);
  }

  let result = out.join("\n");

  if (hoists.length > 0) {
    const hoistBody = hoists
      .map((h) => `\tif has_node(${h.nodePath}): ${h.varName} = get_node(${h.nodePath})`)
      .join("\n");

    if (/^func\s+_ready\s*\(/m.test(result)) {
      // Insert at start of existing _ready body.
      result = result.replace(
        /(^func\s+_ready\s*\([^)]*\)[^:]*:\s*\n)/m,
        `$1${hoistBody}\n`,
      );
    } else {
      // Append a new _ready containing only the hoist setup.
      if (!result.endsWith("\n")) result += "\n";
      result += `\nfunc _ready() -> void:\n${hoistBody}\n`;
    }
  }

  return {
    ok: issues.filter((x) => x.severity === "error" && !x.fixed).length === 0,
    fixed: result,
    issues,
  };
}

// Convenience helper — apply lint and return the fixed source. Logs issue summary
// when callers pass a logger; pure otherwise.
export function autoFixGDScript(source: string): string {
  return lintGDScript(source).fixed;
}
