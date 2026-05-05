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
  table.reckon { width: 100%; border-collapse: collapse; }
  td { padding: 3px 10px; vertical-align: top; white-space: pre-wrap; }
  td.source { color: inherit; }
  td.result { text-align: right; opacity: 0.85; }
  tr.blank td { height: 1.2em; }
  tr.comment td.source { opacity: 0.6; color: #72696a; font-style: italic; }
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
  .t-num  { color: #6849c2; }
  .t-id   { color: #218a55; }
  .t-unit { color: #1c8ca8; }
  .t-op   { opacity: 0.45; }
  .t-kw   { color: #e14775; font-style: italic; }
  .t-pct  { color: #c25c00; }

  /* Click-to-copy affordance */
  td.result[data-clipboard-value] {
    cursor: pointer;
    border-radius: 3px;
    transition: background 150ms ease;
  }
  td.result[data-clipboard-value]:hover { background: rgba(104, 73, 194, 0.10); }
  td.result[data-clipboard-value]:active { transform: translateY(1px); }

  /* Dark mode — Monokai Pro */
  @media (prefers-color-scheme: dark) {
    body {
      color: var(--root-color, #fcfcfa);
      background: var(--root-background-color, #2d2a2e);
    }
    tr.comment td.source { color: #727072; }
    .t-num  { color: #ab9df2; }
    .t-id   { color: #a9dc76; }
    .t-unit { color: #78dce8; }
    .t-op   { opacity: 0.55; }
    .t-kw   { color: #ff6188; }
    .t-pct  { color: #fc9867; }
    td.result[data-clipboard-value]:hover { background: rgba(171, 157, 242, 0.14); }
  }
</style>`.trim();

const SCRIPT = `
(function () {
  // Guard against accumulating duplicate listeners when SB re-injects the
  // panel script on each render. The flag lives on window for the iframe's
  // lifetime; a single click listener handles all subsequent renders.
  if (window.__reckonClickBound) return;
  window.__reckonClickBound = true;
  document.addEventListener("click", function (e) {
    var cell = e.target.closest("[data-clipboard-value]");
    if (!cell) return;
    var value = cell.getAttribute("data-clipboard-value");
    if (!value) return;
    navigator.clipboard.writeText(value).then(function () {
      if (typeof api === "function") {
        api("editor.flashNotification", "Copied " + value);
      }
    }).catch(function () {});
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
      return `<tr class="blank"><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment"><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "heading":
      return `<tr class="heading"><td class="source" colspan="2">${escapeHtml(row.text)}</td></tr>`;
    case "value":
      return `<tr class="value"><td class="source">${tokensToHtml(tokenize(row.source, options))}</td><td class="result" data-clipboard-value="${escapeHtml(row.clipboard)}">${escapeHtml(row.result)}</td></tr>`;
    case "assignment":
      return `<tr class="assignment"><td class="source">${tokensToHtml(tokenize(row.source, options))}</td><td class="result" data-clipboard-value="${escapeHtml(row.clipboard)}">${escapeHtml(row.result)}</td></tr>`;
  }
}

function totalRowHtml(total: TotalRow): string {
  return `<tr class="total"><td class="label">Total</td><td class="result" data-clipboard-value="${escapeHtml(total.clipboard)}">${escapeHtml(total.value)}</td></tr>`;
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
