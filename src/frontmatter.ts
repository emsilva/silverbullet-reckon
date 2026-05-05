const FRONTMATTER_DELIM = "---";
const RECKON_LINE_RE = /^reckon:\s*true\s*$/;
const RECKON_ISOLATED_LINE_RE = /^reckon-isolated:\s*true\s*$/;
const RECKON_SHOW_ERRORS_LINE_RE = /^reckon-show-errors:\s*true\s*$/;

interface FrontmatterRange {
  open: number;   // line index of opening ---
  close: number;  // line index of closing ---
  bodyStart: number; // line index where body begins (close + 1, skipping one blank line if present)
}

function findFrontmatter(lines: string[]): FrontmatterRange | null {
  if (lines[0] !== FRONTMATTER_DELIM) return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FRONTMATTER_DELIM) {
      let bodyStart = i + 1;
      // skip one blank line directly after the closing delim, if present
      if (bodyStart < lines.length && lines[bodyStart] === "") bodyStart += 1;
      return { open: 0, close: i, bodyStart };
    }
  }
  return null;
}

export function isReckonSheet(text: string): boolean {
  const lines = text.split("\n");
  const fm = findFrontmatter(lines);
  if (!fm) return false;
  for (let i = fm.open + 1; i < fm.close; i++) {
    if (RECKON_LINE_RE.test(lines[i])) return true;
  }
  return false;
}

export function toggleReckonFrontmatter(text: string): string {
  const lines = text.split("\n");
  const fm = findFrontmatter(lines);

  if (!fm) {
    // No frontmatter — prepend one with reckon: true.
    if (text === "") {
      return `${FRONTMATTER_DELIM}\nreckon: true\n${FRONTMATTER_DELIM}\n\n`;
    }
    return `${FRONTMATTER_DELIM}\nreckon: true\n${FRONTMATTER_DELIM}\n\n${text}`;
  }

  const reckonIdx = lines.findIndex(
    (line, i) => i > fm.open && i < fm.close && RECKON_LINE_RE.test(line),
  );

  if (reckonIdx >= 0) {
    // Remove the line.
    lines.splice(reckonIdx, 1);
    // If frontmatter is now empty, strip the whole block (including the
    // single blank line we conventionally add after it).
    // After the splice above, `fm.close` is one greater than the new index
    // of the closing `---`. So `fm.close - 1` points at the delimiter, and
    // `slice(fm.open + 1, fm.close - 1)` correctly covers the keys between
    // the two delimiters in the post-splice array.
    const stillHasContent = lines
      .slice(fm.open + 1, fm.close - 1)
      .some((l) => l.trim() !== "");
    if (!stillHasContent) {
      // After splice, fm.close has shifted by 1.
      const newClose = fm.close - 1;
      // Strip lines [open .. newClose] inclusive, plus one blank line after
      // if present.
      let removeUpTo = newClose + 1;
      if (lines[removeUpTo] === "") removeUpTo += 1;
      lines.splice(fm.open, removeUpTo - fm.open);
    }
    return lines.join("\n");
  }

  // Frontmatter exists, no reckon: true — insert before the closing delim.
  lines.splice(fm.close, 0, "reckon: true");
  return lines.join("\n");
}

/**
 * Returns true iff the page's frontmatter has `reckon-isolated: true`
 * as a top-level key. Used by reckonBlockWidget to opt out of the new
 * cross-block continuous mode and preserve V1 per-block isolation.
 *
 * Mirrors isReckonSheet's parsing strategy: requires properly delimited
 * frontmatter, no quoting, no indentation. Anything else returns false
 * (defensive — when in doubt, treat as continuous since that's the
 * default).
 */
export function isReckonIsolated(text: string): boolean {
  const lines = text.split("\n");
  const fm = findFrontmatter(lines);
  if (!fm) return false;
  for (let i = fm.open + 1; i < fm.close; i++) {
    if (RECKON_ISOLATED_LINE_RE.test(lines[i])) return true;
  }
  return false;
}

/**
 * Returns true iff the page's frontmatter has `reckon-show-errors: true`
 * as a top-level key. Used by plug.ts to opt the page into visible-error
 * rendering — failed mathjs parses become `kind: "error"` rows instead
 * of the silent `kind: "comment"` fallback.
 *
 * Mirrors isReckonIsolated's parsing strategy: requires properly
 * delimited frontmatter, no quoting, no indentation. Anything else
 * returns false (defensive — when in doubt, treat as default-off).
 */
export function isReckonShowErrors(text: string): boolean {
  const lines = text.split("\n");
  const fm = findFrontmatter(lines);
  if (!fm) return false;
  for (let i = fm.open + 1; i < fm.close; i++) {
    if (RECKON_SHOW_ERRORS_LINE_RE.test(lines[i])) return true;
  }
  return false;
}
