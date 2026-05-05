import { editor } from "@silverbulletmd/silverbullet/syscalls";
import {
  isReckonSheet,
  isReckonIsolated,
  isReckonShowErrors,
  toggleReckonFrontmatter,
} from "./frontmatter";
import {
  evaluate,
  evaluatePageContinuous,
  type BlockEvalResult,
} from "./engine";
import { renderSheet } from "./render";

const DEBOUNCE_MS = 150;
const PANEL_LOCATION: "rhs" = "rhs";
const PANEL_MODE = 2;

let modifyDebounce: ReturnType<typeof setTimeout> | undefined;

/**
 * codeWidget callback for fenced ```reckon``` blocks.
 *
 * Two modes:
 * - **Continuous (default).** Reads the full page text, evaluates ALL
 *   reckon blocks in source order through one shared parser, then
 *   renders just this widget's slice. Variables and `ans` flow across
 *   blocks; `lineN` and `total` stay block-internal.
 * - **Isolated** — opted into via `reckon-isolated: true` in frontmatter.
 *   Falls back to V1 behavior: each block evaluated in its own scope.
 *
 * Defensive fallback: if the body text doesn't match any extracted
 * block (e.g. SilverBullet calls the widget mid-edit with stale body),
 * use the isolated path to avoid blank panels.
 */
export async function reckonBlockWidget(
  bodyText: string,
  _pageName: string,
): Promise<{ html: string; script: string }> {
  const text = await editor.getText();
  const showErrors = isReckonShowErrors(text);
  if (isReckonIsolated(text)) {
    return renderSheet(evaluate(bodyText, { showErrors }));
  }
  const pageResult = evaluatePageContinuous(text, { showErrors });
  const block = findBlockByBody(pageResult.blocks, bodyText);
  if (!block) {
    return renderSheet(evaluate(bodyText, { showErrors }));
  }
  return renderSheet({
    rows: block.rows,
    total: block.total,
    identifierNames: pageResult.identifierNames,
    multiWordNames: pageResult.multiWordNames,
  });
}

/**
 * Match the SilverBullet-supplied bodyText to one of the extracted
 * blocks. Compares normalized bodies (CRLF→LF, drop trailing newline).
 *
 * Limitation: if a page has two byte-identical reckon blocks, both
 * widgets render with the FIRST occurrence's evaluated state. This is
 * a SilverBullet codeWidget API limitation (no positional info passed
 * to the callback). Documented; rare in practice.
 */
function findBlockByBody(
  blocks: BlockEvalResult[],
  bodyText: string,
): BlockEvalResult | undefined {
  const target = normalizeBody(bodyText);
  return blocks.find((b) => normalizeBody(b.body) === target);
}

function normalizeBody(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

/**
 * Page event handler. Decides whether the page is a Reckon sheet and
 * shows/hides the right-hand panel accordingly. Debounces pageModified;
 * runs immediately on pageLoaded.
 */
export async function onPageEvent(eventName?: string): Promise<void> {
  if (eventName === "editor:pageModified") {
    if (modifyDebounce !== undefined) clearTimeout(modifyDebounce);
    modifyDebounce = setTimeout(() => {
      modifyDebounce = undefined;
      void runPanelRefresh();
    }, DEBOUNCE_MS);
    return;
  }
  // pageLoaded / pageReloaded — fire immediately.
  if (modifyDebounce !== undefined) {
    clearTimeout(modifyDebounce);
    modifyDebounce = undefined;
  }
  await runPanelRefresh();
}

async function runPanelRefresh(): Promise<void> {
  const text = await editor.getText();
  if (!isReckonSheet(text)) {
    await editor.hidePanel(PANEL_LOCATION);
    return;
  }
  const showErrors = isReckonShowErrors(text);
  const result = evaluate(text, { showErrors });
  const { html, script } = renderSheet(result);
  await editor.showPanel(PANEL_LOCATION, PANEL_MODE, html, script);
}

/**
 * Command handler: toggle `reckon: true` frontmatter on the current page.
 * The resulting `editor:pageModified` will trigger Path A and the panel
 * will appear or disappear accordingly. We do not call show/hidePanel here.
 */
export async function toggleSheetCommand(): Promise<void> {
  const text = await editor.getText();
  const newText = toggleReckonFrontmatter(text);
  await editor.setText(newText);
}
