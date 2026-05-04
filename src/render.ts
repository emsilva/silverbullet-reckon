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
    color: var(--root-color, #1f1f1f);
    background: var(--root-background-color, #f1f1f3);
    margin: 0; padding: 12px;
    font-size: 13px;
  }
  table.reckon { width: 100%; border-collapse: collapse; }
  td { padding: 2px 8px; vertical-align: top; white-space: pre-wrap; }
  td.source { color: inherit; }
  td.result { text-align: right; opacity: 0.85; }
  tr.blank td { height: 1.2em; }
  tr.comment td.source { opacity: 0.6; color: #635c81; font-style: italic; }
  tr.heading td.source {
    font-weight: 700;
    padding-top: 8px;
    padding-bottom: 5px;
    border-bottom: 1px solid currentColor;
  }
  tr.total td {
    border-top: 1px solid currentColor;
    padding-top: 6px;
    font-weight: 600;
  }
  tr.total td.label { text-align: left; }

  /* Token coloring — Alucard (light mode default) */
  .t-num  { color: #644ac9; }
  .t-id   { color: #14710a; }
  .t-unit { color: #036a96; }
  .t-op   { opacity: 0.45; }
  .t-kw   { color: #a3144d; font-style: italic; }
  .t-pct  { color: #a34d14; }

  /* Click-to-copy affordance */
  td.result[data-clipboard-value] { cursor: pointer; }
  td.result[data-clipboard-value]:hover { background: rgba(0, 0, 0, 0.06); }

  /* Dark mode — Dracula */
  @media (prefers-color-scheme: dark) {
    body {
      color: var(--root-color, #f8f8f2);
      background: var(--root-background-color, #282a36);
    }
    tr.comment td.source { color: #6272a4; }
    .t-num  { color: #bd93f9; }
    .t-id   { color: #50fa7b; }
    .t-unit { color: #8be9fd; }
    .t-op   { opacity: 0.55; }
    .t-kw   { color: #ff79c6; }
    .t-pct  { color: #ffb86c; }
    td.result[data-clipboard-value]:hover { background: rgba(255, 255, 255, 0.08); }
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
