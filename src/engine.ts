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
      numeric?: number;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
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
  const rows: ResultRow[] = [];

  for (const raw of lines) {
    rows.push(evaluateLine(raw, parser, percentageVars));
  }

  return { rows, total: computeTotal(rows) };
}

function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
): ResultRow {
  if (raw.text.trim() === "") {
    return { kind: "blank", line: raw.line };
  }

  const assignment = detectAssignment(raw.text);
  const exprToEvaluate = assignment
    ? `${assignment.varName} = ${rewriteExpression(assignment.rhs, percentageVars)}`
    : rewriteExpression(raw.text, percentageVars);

  let value: unknown;
  try {
    value = parser.evaluate(exprToEvaluate);
  } catch {
    return { kind: "comment", line: raw.line, source: raw.text };
  }

  if (assignment?.isPercentageRhs) {
    percentageVars.add(assignment.varName);
  }

  const formatted = formatValue(value);

  if (assignment) {
    return {
      kind: "assignment",
      line: raw.line,
      source: raw.text,
      varName: assignment.varName,
      result: formatted.text,
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
  // mathjs Unit values: have a .toString and are NOT plain numbers.
  if (value && typeof value === "object" && "toString" in value && "type" in value) {
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
    if (row.kind === "value" || row.kind === "assignment") {
      if (row.numeric !== undefined && Number.isFinite(row.numeric)) {
        sum += row.numeric;
        any = true;
      }
    }
  }
  if (!any) return null;
  return { value: NUMBER_FORMATTER.format(sum) };
}
