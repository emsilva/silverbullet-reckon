import { math, type EvaluateResult, type ResultRow, type TotalRow } from "./engine";
import { tokenize, type Token, type TokenizeOptions } from "./lexer";

export interface RenderOutput {
  html: string;
  script: string;
}

const STYLE = `
<style>
  html { color-scheme: light dark; }
  body {
    font-family: var(--ui-font, ui-monospace, SFMono-Regular, Consolas, monospace);
    font-variant-numeric: tabular-nums slashed-zero;
    color: var(--root-color, #29242a);
    background: var(--root-background-color, #faf4f2);
    margin: 0; padding: 12px;
    font-size: 13px;
  }
  /* Table sizes to its content so the result column sits right next to the
     source column instead of being pushed to the far edge of the iframe. */
  table.reckon { border-collapse: collapse; }
  td {
    padding: 3px 10px;
    vertical-align: top;
    white-space: pre-wrap;
    transition: background 150ms ease;
  }
  td.source { color: inherit; }
  td.result { text-align: right; opacity: 0.85; }
  tr.blank td { height: 1.2em; }
  tr.comment td.source { opacity: 0.6; color: #72696a; font-style: italic; }
  tr.error td { background: rgba(225, 71, 117, 0.08); }
  tr.error td.source { color: #e14775; font-style: italic; }
  tr.heading td.source {
    font-weight: 700;
    letter-spacing: -0.01em;
    padding-top: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  }
  tr.total td {
    border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    padding-top: 7px;
    font-weight: 600;
  }
  tr.total td.label { text-align: left; }

  /* Token coloring — Monokai Pro Light (light mode default) */
  .t-num    { color: #6849c2; }
  .t-id     { color: #218a55; }
  .t-unit   { color: #1c8ca8; }
  .t-op     { opacity: 0.45; }
  .t-kw     { color: #e14775; font-style: italic; }
  .t-pct    { color: #c25c00; }
  .t-linref { color: #a67c00; }
  .t-totalref { color: #a67c00; }

  /* Click-to-copy affordance — transition inherited from base td rule */
  td.result[data-clipboard-value] {
    cursor: pointer;
    border-radius: 3px;
  }
  td.result[data-clipboard-value]:hover { background: rgba(104, 73, 194, 0.10); }
  td.result[data-clipboard-value]:active { transform: translateY(1px); }

  /* Gutter */
  td.gutter {
    color: color-mix(in srgb, currentColor 35%, transparent);
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: 2.5em;
    padding-right: 8px;
    user-select: none;
    white-space: nowrap;
  }
  td.gutter.referenceable {
    color: color-mix(in srgb, currentColor 75%, transparent);
    cursor: pointer;
    border-radius: 3px;
  }
  td.gutter.referenceable:hover {
    background: rgba(104, 73, 194, 0.10);
  }
  td.gutter.referenceable:active { transform: translateY(1px); }
  td.gutter.total {
    color: color-mix(in srgb, currentColor 65%, transparent);
    font-weight: 600;
  }
  tr.linref-pair td { background: rgba(104, 73, 194, 0.08); }

  /* Dark mode — Monokai Pro */
  @media (prefers-color-scheme: dark) {
    body {
      color: var(--root-color, #fcfcfa);
      background: var(--root-background-color, #2d2a2e);
    }
    tr.comment td.source { color: #727072; }
    tr.error td { background: rgba(255, 97, 136, 0.12); }
    tr.error td.source { color: #ff6188; }
    .t-num    { color: #ab9df2; }
    .t-id     { color: #a9dc76; }
    .t-unit   { color: #78dce8; }
    .t-op     { opacity: 0.55; }
    .t-kw     { color: #ff6188; }
    .t-pct    { color: #fc9867; }
    .t-linref { color: #ffd866; }
    .t-totalref { color: #ffd866; }
    td.result[data-clipboard-value]:hover { background: rgba(171, 157, 242, 0.14); }
    td.gutter.referenceable:hover { background: rgba(171, 157, 242, 0.14); }
    tr.linref-pair td { background: rgba(171, 157, 242, 0.13); }
  }
</style>`.trim();

const SCRIPT = `
(function () {
  // Guard against accumulating duplicate listeners when SB re-injects the
  // panel script on each render. The flag lives on window for the iframe's
  // lifetime; a single set of delegates handles all subsequent renders.
  if (window.__reckonClickBound) return;
  window.__reckonClickBound = true;

  function safeCopy(value) {
    if (!value) return;
    navigator.clipboard.writeText(value).then(function () {
      if (typeof api === "function") {
        api("editor.flashNotification", "Copied " + value);
      }
    }).catch(function () {});
  }

  document.addEventListener("click", function (e) {
    var gutter = e.target.closest("td.gutter.referenceable[data-line]");
    if (gutter) {
      var dataLine = gutter.getAttribute("data-line");
      if (dataLine) safeCopy("line" + dataLine);
      return;
    }
    var cell = e.target.closest("[data-clipboard-value]");
    if (!cell) return;
    var value = cell.getAttribute("data-clipboard-value");
    if (!value) return;
    safeCopy(value);
  });

  function parseRefs(attr) {
    if (!attr) return [];
    return attr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Highlight rows in THIS iframe whose data-line ∈ refs (forward) or whose
  // data-references contains targetLine (reverse). Used for both local hover
  // and cross-iframe hover messages — same rule on both sides.
  function applyPairs(targetLine, refs) {
    var allRows = document.querySelectorAll("tr[data-line]");
    for (var i = 0; i < allRows.length; i++) {
      var other = allRows[i];
      var otherLine = other.getAttribute("data-line");
      if (refs && refs.indexOf(otherLine) !== -1) {
        other.classList.add("linref-pair");
        continue;
      }
      if (targetLine) {
        var otherRefs = parseRefs(other.getAttribute("data-references"));
        if (otherRefs.indexOf(targetLine) !== -1) {
          other.classList.add("linref-pair");
        }
      }
    }
  }

  function clearPairs() {
    var paired = document.querySelectorAll("tr.linref-pair");
    for (var i = 0; i < paired.length; i++) paired[i].classList.remove("linref-pair");
  }

  // Broadcast hover events to sibling block-widget iframes so cross-block
  // lineN references light up on both sides. SilverBullet renders each
  // reckon block in its own same-origin iframe; window.top.frames lets us
  // reach siblings to deliver the message. Same-origin guarantees us
  // contentWindow access; the postMessage hop is for reaching across the
  // iframe boundary cheaply (no shared state between iframe scripts).
  function broadcastHover(msg) {
    try {
      var top = window.top;
      if (!top || top === window) return;
      var frames = top.frames;
      for (var i = 0; i < frames.length; i++) {
        try {
          if (frames[i] !== window) frames[i].postMessage(msg, "*");
        } catch (err) { /* cross-origin sibling — skip */ }
      }
    } catch (err) { /* defensive — don't let broadcast errors break local UI */ }
  }

  document.addEventListener("mouseenter", function (e) {
    if (!e.target.closest) return;
    var row = e.target.closest("tr[data-line]");
    if (!row) return;
    var dataLine = row.getAttribute("data-line");
    var refs = parseRefs(row.getAttribute("data-references"));
    applyPairs(dataLine, refs);
    // Skip the hovered row in our own iframe — :hover handles its style.
    row.classList.remove("linref-pair");
    broadcastHover({ type: "reckon:hoverEnter", dataLine: dataLine, refs: refs });
  }, true);

  document.addEventListener("mouseleave", function (e) {
    if (!e.target.closest) return;
    var row = e.target.closest("tr[data-line]");
    if (!row) return;
    clearPairs();
    broadcastHover({ type: "reckon:hoverLeave" });
  }, true);

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "reckon:hoverEnter") {
      applyPairs(d.dataLine, d.refs || []);
    } else if (d.type === "reckon:hoverLeave") {
      clearPairs();
    }
  });
})();
`.trim();

export function renderSheet(result: EvaluateResult): RenderOutput {
  const tokenOptions: TokenizeOptions = {
    identifiers: result.identifierNames,
    multiWord: result.multiWordNames,
    isUnit: makeIsUnit(),
  };
  const rowsHtml = result.rows.map((row) => rowHtml(row, tokenOptions)).join("\n");
  const totalHtml = result.total ? totalRowHtml(result.total) : "";
  const html = `${STYLE}
<table class="reckon">
${rowsHtml}
${totalHtml}
</table>`;
  return { html, script: SCRIPT };
}

function rowHtml(row: ResultRow, options: TokenizeOptions): string {
  switch (row.kind) {
    case "blank":
      return `<tr class="blank" data-line="${row.line}"><td class="gutter">${row.line}</td><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "error":
      return `<tr class="error" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "heading":
      return `<tr class="heading" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.text)}</td></tr>`;
    case "value":
    case "assignment": {
      const tokens = tokenize(row.source, options);
      const refs = extractReferencedLines(tokens);
      const refsAttr = refs.length > 0 ? ` data-references="${refs.join(",")}"` : "";
      return `<tr class="${row.kind}" data-line="${row.line}"${refsAttr}><td class="gutter referenceable" data-line="${row.line}">${row.line}</td><td class="source">${tokensToHtml(tokens)}</td><td class="result" data-clipboard-value="${escapeHtml(row.clipboard)}">${escapeHtml(row.result)}</td></tr>`;
    }
  }
}

function totalRowHtml(total: TotalRow): string {
  return `<tr class="total"><td class="gutter total">Σ</td><td class="label">Total</td><td class="result" data-clipboard-value="${escapeHtml(total.clipboard)}">${escapeHtml(total.value)}</td></tr>`;
}

function extractReferencedLines(tokens: Token[]): number[] {
  const lines: number[] = [];
  for (const t of tokens) {
    if (t.kind === "linref") {
      const m = /^line(\d+)$/.exec(t.text);
      if (m) lines.push(Number(m[1]));
    }
  }
  return lines;
}

function tokensToHtml(tokens: Token[]): string {
  return tokens.map(tokenToHtml).join("");
}

function tokenToHtml(token: Token): string {
  if (token.kind === "ws" || token.kind === "text") {
    return escapeHtml(token.text);
  }
  return `<span class="t-${token.kind}">${escapeHtml(token.text)}</span>`;
}

function makeIsUnit(): (name: string) => boolean {
  // mathjs's `Unit` class exposes `isValuelessUnit` which handles both base
  // units and SI-prefixed forms (e.g. "km"). Prefer it over the UNITS
  // dictionary, which only lists base unit keys and misses prefixed variants.
  const UnitClass = math.Unit as unknown as {
    UNITS?: Record<string, unknown>;
    isValuelessUnit?: (s: string) => boolean;
  };
  if (typeof UnitClass.isValuelessUnit === "function") {
    return (name) => UnitClass.isValuelessUnit!(name);
  }
  if (UnitClass.UNITS) {
    const known = new Set(Object.keys(UnitClass.UNITS));
    return (name) => known.has(name);
  }
  return () => false;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
