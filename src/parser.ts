export interface RawLine {
  line: number; // 1-based source line number (for diagnostics, not used by V1 renderer)
  text: string;
}

const FRONTMATTER_DELIM = "---";
const FENCE_RE = /^```/;

/**
 * Split text into RawLines preserving original 1-based line numbers.
 * No stripping. Used by block widgets where the body text is already
 * the math sheet.
 */
export function splitIntoLines(text: string): RawLine[] {
  if (text === "") return [];
  // Drop trailing single newline so "a\n" yields one line, not two.
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n").map((t, i) => ({ line: i + 1, text: t }));
}

/**
 * Extract evaluable math lines from a full page's text. Strips frontmatter
 * and any fenced code block, preserving original line numbers for the
 * surviving lines.
 */
export function extractMathLines(text: string): RawLine[] {
  const all = splitIntoLines(text);
  if (all.length === 0) return [];

  let i = 0;

  // Strip frontmatter if present.
  if (all[0]?.text === FRONTMATTER_DELIM) {
    let close = -1;
    for (let j = 1; j < all.length; j++) {
      if (all[j].text === FRONTMATTER_DELIM) {
        close = j;
        break;
      }
    }
    if (close >= 0) {
      i = close + 1;
      // Skip one blank line directly after closing delim, if present.
      if (all[i]?.text === "") i += 1;
    }
    // If unterminated, leave i = 0 (whole doc treated as body — pragmatic).
  }

  const out: RawLine[] = [];
  let inFence = false;
  for (; i < all.length; i++) {
    const line = all[i];
    if (FENCE_RE.test(line.text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    out.push(line);
  }
  return out;
}

export interface AssignmentInfo {
  varName: string;
  rhs: string;
  isPercentageRhs: boolean; // true iff RHS is exactly `N%` (a literal percent)
}

const ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/;
const PERCENTAGE_LITERAL_RHS_RE = /^\d+(?:\.\d+)?\s*%\s*$/;

export function detectAssignment(line: string): AssignmentInfo | null {
  const m = line.match(ASSIGNMENT_RE);
  if (!m) return null;
  const varName = m[1];
  const rhs = m[2].trim();
  const isPercentageRhs = PERCENTAGE_LITERAL_RHS_RE.test(rhs);
  return { varName, rhs, isPercentageRhs };
}

/**
 * Rewrite a single math expression so mathjs sees a Soulver-compatible
 * form. `percentageVars` is the set of identifier names previously
 * assigned a percentage literal — used to make `Y + tax` mean `Y * (1 + tax)`.
 *
 * Order matters: we must rewrite additive/subtractive forms before
 * standalone `N%` so the standalone rewrite doesn't eat the `%` first.
 */
export function rewriteExpression(
  expr: string,
  percentageVars: ReadonlySet<string>,
): string {
  let out = expr;

  // (a) `Y + N%` / `Y - N%` (literal additive percentage).
  // Y is a number, identifier, or parenthesized group. Keep this loose:
  // anything non-whitespace before the operator. The standalone-N% rewrite
  // below would otherwise eat the `%` first.
  out = out.replace(
    /(\S+)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*%(?!\w)/g,
    (_m, y: string, op: string, n: string) => `${y} * (1 ${op} ${n}/100)`,
  );

  // (b) `Y + var` / `Y - var` where var is a known percentage variable.
  for (const v of percentageVars) {
    const re = new RegExp(`(\\S+)\\s*([+\\-])\\s*\\b${escapeRegex(v)}\\b`, "g");
    out = out.replace(re, (_m, y: string, op: string) => `${y} * (1 ${op} ${v})`);
  }

  // (c) `N% of Y` (binary "of" treated as multiplication).
  out = out.replace(
    /(\d+(?:\.\d+)?)\s*%\s+of\s+(\S+)/g,
    (_m, n: string, y: string) => `(${n}/100) * ${y}`,
  );

  // (d) standalone `N%` → `N/100`.
  out = out.replace(/(\d+(?:\.\d+)?)\s*%(?!\w)/g, (_m, n: string) => `${n}/100`);

  // (e) `in` → `to` for unit conversions. Aggressive whole-word rewrite;
  // false positives become parse errors → comment rows, no harm done.
  out = out.replace(/\bin\b/g, "to");

  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
