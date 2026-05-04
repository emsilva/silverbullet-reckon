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
  // Normalize Windows (CRLF) and old Mac (CR) line endings to LF first,
  // then drop trailing single newline so "a\n" yields one line, not two.
  const normalized = text.replace(/\r\n?/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
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

// Accepts whitespace-separated runs of identifiers as the LHS so
// `current tax = 20%` parses as a single multi-word assignment. Internal
// whitespace is normalized in `detectAssignment` so `current\ttax` and
// `current  tax` map to the same name (`current tax`).
const ASSIGNMENT_RE =
  /^([A-Za-z_][A-Za-z0-9_]*(?:\s+[A-Za-z_][A-Za-z0-9_]*)*)\s*=(?!=)\s*(.+)$/;
const PERCENTAGE_LITERAL_RHS_RE = /^\d+(?:\.\d+)?\s*%\s*$/;

export function detectAssignment(line: string): AssignmentInfo | null {
  const m = line.match(ASSIGNMENT_RE);
  if (!m) return null;
  // Normalize all internal whitespace runs to a single space so multi-word
  // names compare equal regardless of how the user spelled them.
  const varName = m[1].trim().replace(/\s+/g, " ");
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
  multiWordVars: ReadonlyMap<string, string> = new Map(),
): string {
  let out = expr;

  // (0) Multi-word variable substitution. Apply longest-original-first so
  // overlapping names (`a b` and `a b c`) prefer the more specific match.
  // Each registered name's literal whitespace is replaced with `\s+` in
  // the regex so a later reference written with a tab still matches a name
  // registered with a space. `\b` boundaries prevent false matches inside
  // longer identifiers (`mycurrent tax` won't match `current tax`).
  if (multiWordVars.size > 0) {
    const names = Array.from(multiWordVars.keys()).sort(
      (a, b) => b.length - a.length,
    );
    for (const name of names) {
      if (!name.includes(" ")) continue; // single-word names need no rewrite
      const canonical = multiWordVars.get(name)!;
      const pattern = name
        .split(/\s+/)
        .map(escapeRegex)
        .join("\\s+");
      const re = new RegExp(`\\b${pattern}\\b`, "g");
      out = out.replace(re, canonical);
    }
  }

  // (a) `Y + N%` / `Y - N%` (literal additive percentage).
  // Looped to chain: `100 + 20% + 30%` → `100 * (1 + 20/100) * (1 + 30/100)`.
  // Each iteration rewrites the leftmost remaining match; stable when none left.
  // Cap at 10 iterations (defensive — real inputs converge in N steps).
  for (let i = 0; i < 10; i++) {
    const next = out.replace(
      /(\S+)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*%(?!\w)/g,
      (_m, y: string, op: string, n: string) => `${y} * (1 ${op} ${n}/100)`,
    );
    if (next === out) break;
    out = next;
  }

  // (b) `Y + var` / `Y - var` where var is a known percentage variable.
  // Looped for the same reason as (a) — chained percent-var references.
  // Uses a negative lookbehind `(?<!\()` so that `1` inside an already-rewritten
  // `(1 + var)` group is not matched again on subsequent iterations.
  for (let i = 0; i < 10; i++) {
    let changed = false;
    for (const v of percentageVars) {
      const re = new RegExp(
        `(?<!\\()\\b(\\S+)\\s*([+\\-])\\s*\\b${escapeRegex(v)}\\b`,
        "g",
      );
      const next = out.replace(re, (_m, y: string, op: string) => `${y} * (1 ${op} ${v})`);
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // (c) `N% of Y` (binary "of" treated as multiplication).
  out = out.replace(
    /(\d+(?:\.\d+)?)\s*%\s+of\s+(\S+)/g,
    (_m, n: string, y: string) => `(${n}/100) * ${y}`,
  );

  // (d) standalone `N%` → `N/100`.
  out = out.replace(/(\d+(?:\.\d+)?)\s*%(?!\w)/g, (_m, n: string) => `${n}/100`);

  // (e) Soulver-style ` in ` → mathjs ` to ` for unit conversions.
  // Only fires when followed by an identifier (not by `to`, not at end of
  // expression) — leaves bare `12 in` (inches) and `12 in to cm` alone.
  out = out.replace(/\bin\s+(?!to\b)(?=[A-Za-z])/g, "to ");

  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
