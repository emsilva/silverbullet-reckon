import {
  create,
  parserDependencies,
  unitDependencies,
  toDependencies,
  addDependencies,
  subtractDependencies,
  multiplyDependencies,
  divideDependencies,
  powDependencies,
  unaryMinusDependencies,
  unaryPlusDependencies,
  type MathJsInstance,
} from "mathjs";
import {
  extractMathLines,
  splitIntoLines,
  rewriteExpression,
  detectAssignment,
  extractBlocks,
  type RawLine,
} from "./parser";

// Tree-shaken mathjs: parserDependencies pulls the Parser class; the
// remaining aggregators cover arithmetic (+, -, *, /, ^, unary±), unit
// literals and the `to`-conversion (e.g. `100 km to miles`), and the
// `value instanceof math.Unit` check in formatValue.
// Drops the bundled plug from ~654 KB (with `all`) to ~326 KB.
// To add another mathjs feature later, find its *Dependencies aggregator
// in the mathjs source and spread it into the create() call below.
export const math: MathJsInstance = create(
  {
    ...parserDependencies,
    ...unitDependencies,
    ...toDependencies,
    ...addDependencies,
    ...subtractDependencies,
    ...multiplyDependencies,
    ...divideDependencies,
    ...powDependencies,
    ...unaryMinusDependencies,
    ...unaryPlusDependencies,
  },
  {},
);

export type ResultRow =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number; source: string }
  | { kind: "heading"; line: number; depth: number; text: string }
  | {
      kind: "value";
      line: number;
      source: string;
      result: string;
      /** Always finite. Undefined for units, booleans, strings, etc. */
      numeric?: number;
      clipboard: string;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
      /** Always finite. Undefined for units, booleans, strings, etc. */
      numeric?: number;
      clipboard: string;
    };

export interface TotalRow {
  value: string;
  clipboard: string;
}

export interface EvaluateResult {
  rows: ResultRow[];
  total: TotalRow | null;
  identifierNames: Set<string>;
  multiWordNames: Set<string>;
}

export interface BlockEvalResult {
  rows: ResultRow[];
  total: TotalRow | null;
  body: string;
  startLine: number;
}

export interface PageEvalResult {
  blocks: BlockEvalResult[];
  identifierNames: Set<string>;
  multiWordNames: Set<string>;
}

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

/**
 * Evaluate a sequence of pre-numbered RawLines through a shared parser.
 * The parser, percentage/multi-word var sets, and identifier-name sets
 * are externally owned so callers can persist them across calls (e.g.
 * cross-block continuous mode). Returns the result rows plus the auto-Σ
 * row computed via `computeTotal`.
 *
 * When any row's source contains `\btotal\b`, two-pass evaluation is used:
 * pass 1 computes Σ from rows that don't reference `total`; pass 2
 * re-evaluates with `total` preset to that Σ so derived rows resolve.
 */
function evaluateRows(
  rawLines: RawLine[],
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
): { rows: ResultRow[]; total: TotalRow | null } {
  const hasTotal = rawLines.some((r) => /\btotal\b/.test(r.text));

  if (!hasTotal) {
    const rows: ResultRow[] = [];
    for (const raw of rawLines) {
      rows.push(
        evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames),
      );
    }
    return { rows, total: computeTotal(rows) };
  }

  // Two-pass: snapshot parser scope, run pass 1, restore, preset `total`, run pass 2.
  // Pass 1 lets us compute Σ from rows that don't reference `total` (the rows
  // referencing it throw and classify as comment). Pass 2 with `total` in scope
  // re-evaluates everything; rows that reference `total` resolve cleanly.
  const snapshot = parser.getAll();

  const pass1Rows: ResultRow[] = [];
  for (const raw of rawLines) {
    pass1Rows.push(
      evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames),
    );
  }
  let pass1Sum = 0;
  for (const row of pass1Rows) {
    if (row.kind === "value" && row.numeric !== undefined && Number.isFinite(row.numeric)) {
      pass1Sum += row.numeric;
    }
  }

  // Roll the parser back to its pre-block state, then preset `total` to the
  // pass-1 sum. percVars/mwVars/identifierNames/multiWordNames intentionally
  // are NOT rolled back — pass 2 will re-add the same entries (idempotent
  // Set.add / Map.set), so the final accumulator state matches pass 2.
  parser.clear();
  for (const [k, v] of Object.entries(snapshot)) {
    parser.set(k, v);
  }
  parser.set("total", pass1Sum);

  const pass2Rows: ResultRow[] = [];
  for (const raw of rawLines) {
    pass2Rows.push(
      evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames),
    );
  }

  // Σ rule: rows whose source mentions `total` are derived — they display
  // their resolved value but do not contribute to Σ. This guarantees
  // Σ === total (the property we chose two-pass for).
  return { rows: pass2Rows, total: computeTotal(pass2Rows, { excludeTotalRefs: true }) };
}

/**
 * Evaluate one fenced reckon block's body through a shared parser.
 * `body` is split into RawLines and offset by `lineOffset` so the
 * resulting `row.line` values continue the cross-block counter
 * (block 1 starts at 1; block 2 picks up where block 1 left off; etc.).
 * The caller owns the parser and var sets; in cross-block continuous
 * mode those are shared across blocks. The gutter and `lineN` references
 * both flow continuously, so `line1` from any block resolves to the
 * first reckon row on the page.
 */
export function evaluateBlock(
  parser: ReturnType<MathJsInstance["parser"]>,
  body: string,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
  lineOffset = 0,
): { rows: ResultRow[]; total: TotalRow | null } {
  const rawLines = splitIntoLines(body);
  const offsetLines: RawLine[] = lineOffset === 0
    ? rawLines
    : rawLines.map((r) => ({ line: r.line + lineOffset, text: r.text }));
  return evaluateRows(
    offsetLines,
    parser,
    percentageVars,
    multiWordVars,
    identifierNames,
    multiWordNames,
  );
}

/**
 * Evaluate a full page in cross-block continuous mode. Walks all fenced
 * reckon blocks in source order, evaluating each through a shared
 * parser so variables, `ans`, AND `lineN` flow across blocks. The row
 * counter (used for the gutter and for `lineN` bindings) accumulates
 * across blocks, so `line1` from any block points to the first reckon
 * row on the page. `total` is removed between blocks (block-scoped).
 *
 * `identifierNames` and `multiWordNames` accumulate across all blocks
 * — they're used by the lexer for syntax coloring.
 *
 * The page panel uses `evaluate(text)` (not this function); panel and
 * blocks remain parallel timelines per the design (panel uses
 * source-line numbers, blocks use this continuous counter).
 */
export function evaluatePageContinuous(text: string): PageEvalResult {
  const blocks = extractBlocks(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  const multiWordVars = new Map<string, string>();
  const identifierNames = new Set<string>();
  const multiWordNames = new Set<string>();
  const results: BlockEvalResult[] = [];
  let lineOffset = 0;

  for (const block of blocks) {
    const { rows, total } = evaluateBlock(
      parser,
      block.body,
      percentageVars,
      multiWordVars,
      identifierNames,
      multiWordNames,
      lineOffset,
    );
    parser.remove("total");
    results.push({
      rows,
      total,
      body: block.body,
      startLine: block.startLine,
    });
    lineOffset += rows.length;
  }

  return { blocks: results, identifierNames, multiWordNames };
}

export function evaluate(text: string): EvaluateResult {
  const lines = extractMathLines(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  const multiWordVars = new Map<string, string>();
  const identifierNames = new Set<string>();
  const multiWordNames = new Set<string>();
  const { rows, total } = evaluateRows(
    lines,
    parser,
    percentageVars,
    multiWordVars,
    identifierNames,
    multiWordNames,
  );
  return { rows, total, identifierNames, multiWordNames };
}

function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
): ResultRow {
  const trimmed = raw.text.trim();
  if (trimmed === "") {
    return { kind: "blank", line: raw.line };
  }

  // ATX-form headings (`# foo`, `## bar`, ..., `###### deepest`) supersede
  // the comment escape for those shapes — Markdown convention. Any `#` line
  // that doesn't match the ATX shape (no whitespace, no content, more than
  // 6 hashes) falls through to the comment escape below.
  const headingMatch = /^(#{1,6})\s+(\S.*)$/.exec(trimmed);
  if (headingMatch) {
    return {
      kind: "heading",
      line: raw.line,
      depth: headingMatch[1].length,
      text: headingMatch[2].trim(),
    };
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
      multiWordNames.add(assignment.varName);
    } else {
      identifierNames.add(assignment.varName);
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

  const clipboard = computeClipboard(value, formatted);

  // Register the numeric result for line references (lineN).
  // Only finite numerics are referenceable; unit values, strings, and
  // booleans don't get registered, so references to those rows throw and
  // fall through to the comment classification. `ans` carries the
  // most-recent numeric — non-numeric rows leave `ans` pointing at the
  // previous numeric result.
  if (formatted.numeric !== undefined && Number.isFinite(formatted.numeric)) {
    parser.set(`line${raw.line}`, formatted.numeric);
    parser.set("ans", formatted.numeric);
  }

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
      clipboard,
    };
  }
  return {
    kind: "value",
    line: raw.line,
    source: raw.text,
    result: formatted.text,
    numeric: formatted.numeric,
    clipboard,
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

function computeClipboard(value: unknown, formatted: FormattedValue): string {
  // For finite-numeric values, the underlying number — no thousand separators,
  // no percent sign, no unit string. Matches the rule from issue #3 spec.
  if (formatted.numeric !== undefined && Number.isFinite(formatted.numeric)) {
    return String(formatted.numeric);
  }
  // For mathjs Unit values, extract the numeric part of the formatted text.
  // The formatted text is something like "62.13711922373339 miles" — the
  // leading number is what we want.
  if (value instanceof math.Unit) {
    const m = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(formatted.text);
    if (m) return m[0];
  }
  // Fallback: copy whatever the display string is.
  return formatted.text;
}

function computeTotal(
  rows: ResultRow[],
  opts?: { excludeTotalRefs?: boolean },
): TotalRow | null {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    if (row.kind !== "value") continue;
    if (row.numeric === undefined || !Number.isFinite(row.numeric)) continue;
    if (opts?.excludeTotalRefs && /\btotal\b/.test(row.source)) continue;
    sum += row.numeric;
    any = true;
  }
  if (!any) return null;
  return { value: NUMBER_FORMATTER.format(sum), clipboard: String(sum) };
}
