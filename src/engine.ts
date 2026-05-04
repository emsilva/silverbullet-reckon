import { create, all, type MathJsInstance } from "mathjs";
import {
  extractMathLines,
  rewriteExpression,
  detectAssignment,
  type RawLine,
} from "./parser";

const math: MathJsInstance = create(all, {});

export type ResultRow =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number; source: string }
  | {
      kind: "value";
      line: number;
      source: string;
      result: string;
      /** Always finite. Undefined for units, booleans, strings, etc. */
      numeric?: number;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
      /** Always finite. Undefined for units, booleans, strings, etc. */
      numeric?: number;
    };

export interface TotalRow {
  value: string;
}

export interface EvaluateResult {
  rows: ResultRow[];
  total: TotalRow | null;
}

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

export function evaluate(text: string): EvaluateResult {
  const lines = extractMathLines(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  // Maps the user's original spelling (e.g. "current tax") to the
  // mathjs-legal canonical form ("current_tax"). Only multi-word names
  // are recorded; single-word assignments don't need rewriting.
  const multiWordVars = new Map<string, string>();
  const rows: ResultRow[] = [];

  for (const raw of lines) {
    rows.push(evaluateLine(raw, parser, percentageVars, multiWordVars));
  }

  return { rows, total: computeTotal(rows) };
}

function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
): ResultRow {
  const trimmed = raw.text.trim();
  if (trimmed === "") {
    return { kind: "blank", line: raw.line };
  }

  // Explicit comment escape: lines beginning with `#` or `//` are comments
  // even if their tail would parse as math. Locks the contract regardless
  // of whether mathjs's grammar evolves to accept them.
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return { kind: "comment", line: raw.line, source: raw.text };
  }

  const assignment = detectAssignment(raw.text);

  let canonicalAssignName: string | null = null;
  let exprToEvaluate: string;
  if (assignment) {
    canonicalAssignName = assignment.varName.replace(/\s+/g, "_");
    exprToEvaluate = `${canonicalAssignName} = ${rewriteExpression(assignment.rhs, percentageVars, multiWordVars)}`;
  } else {
    exprToEvaluate = rewriteExpression(raw.text, percentageVars, multiWordVars);
  }

  let value: unknown;
  try {
    value = parser.evaluate(exprToEvaluate);
  } catch {
    return { kind: "comment", line: raw.line, source: raw.text };
  }

  if (assignment) {
    // canonicalAssignName is non-null here because the outer `if (assignment)`
    // block initializes it; assert with `!` since TS can't see the dependency.
    // Both registries update only after a successful evaluate so a thrown
    // RHS doesn't leave a multi-word name registered with no mathjs binding.
    if (assignment.varName.includes(" ")) {
      multiWordVars.set(assignment.varName, canonicalAssignName!);
    }
    if (assignment.isPercentageRhs) {
      percentageVars.add(canonicalAssignName!);
    } else {
      // Reassignment of a percent-var to a non-percent value: clear the
      // additive flag so subsequent references use plain arithmetic.
      percentageVars.delete(canonicalAssignName!);
    }
  }

  const formatted = formatValue(value);

  if (assignment) {
    return {
      kind: "assignment",
      line: raw.line,
      source: raw.text,
      varName: assignment.varName,
      // Percent-literal assignments display the RHS as typed (e.g. "20%"),
      // not the underlying decimal (0.2). The `numeric` field still carries
      // the actual value for any internal use.
      result: assignment.isPercentageRhs ? assignment.rhs : formatted.text,
      numeric: formatted.numeric,
    };
  }
  return {
    kind: "value",
    line: raw.line,
    source: raw.text,
    result: formatted.text,
    numeric: formatted.numeric,
  };
}

interface FormattedValue {
  text: string;
  numeric?: number;
}

function formatValue(value: unknown): FormattedValue {
  // mathjs Unit values: caught explicitly via instanceof. Other math
  // object types (DenseMatrix, ResultSet) fall through to String(value).
  if (value instanceof math.Unit) {
    return { text: String(value) };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { text: String(value) }; // "Infinity" / "NaN"
    }
    return { text: NUMBER_FORMATTER.format(value), numeric: value };
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return { text: String(value) };
  }
  return { text: String(value) };
}

function computeTotal(rows: ResultRow[]): TotalRow | null {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    if (row.kind === "value" && row.numeric !== undefined && Number.isFinite(row.numeric)) {
      sum += row.numeric;
      any = true;
    }
  }
  if (!any) return null;
  return { value: NUMBER_FORMATTER.format(sum) };
}
