import type { EvaluateResult, ResultRow } from "./engine";

export interface RenderOutput {
  html: string;
  script: string;
}

const STYLE = `
<style>
  html { color-scheme: light dark; }
  body {
    font-family: var(--ui-font, ui-monospace, SFMono-Regular, monospace);
    color: var(--root-color, inherit);
    background: var(--root-background-color, transparent);
    margin: 0; padding: 12px;
    font-size: 13px;
  }
  table.reckon { width: 100%; border-collapse: collapse; }
  td { padding: 2px 8px; vertical-align: top; white-space: pre-wrap; }
  td.source { color: var(--root-color, inherit); }
  td.result { text-align: right; opacity: 0.85; }
  tr.blank td { height: 1.2em; }
  tr.comment td.source { opacity: 0.6; }
  tr.total td {
    border-top: 1px solid currentColor;
    padding-top: 6px;
    font-weight: 600;
  }
  tr.total td.label { text-align: left; }
</style>`.trim();

export function renderSheet(result: EvaluateResult): RenderOutput {
  const rowsHtml = result.rows.map(rowHtml).join("\n");
  const totalHtml = result.total
    ? `<tr class="total"><td class="label">Total</td><td class="result">${escapeHtml(result.total.value)}</td></tr>`
    : "";
  const html = `${STYLE}
<table class="reckon">
${rowsHtml}
${totalHtml}
</table>`;
  return { html, script: "" };
}

function rowHtml(row: ResultRow): string {
  switch (row.kind) {
    case "blank":
      return `<tr class="blank"><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment"><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "heading":
      // Stub — Task 4 replaces this with the real heading row markup.
      return `<tr class="heading"><td class="source" colspan="2">${escapeHtml(row.text)}</td></tr>`;
    case "value":
      return `<tr class="value"><td class="source">${escapeHtml(row.source)}</td><td class="result">${escapeHtml(row.result)}</td></tr>`;
    case "assignment":
      return `<tr class="assignment"><td class="source">${escapeHtml(row.source)}</td><td class="result">${escapeHtml(row.result)}</td></tr>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
