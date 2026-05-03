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
