import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { isReckonSheet, toggleReckonFrontmatter } from "./frontmatter";
import { evaluate } from "./engine";
import { renderSheet } from "./render";

const DEBOUNCE_MS = 150;
const PANEL_LOCATION: "rhs" = "rhs";
const PANEL_MODE = 2;

let modifyDebounce: ReturnType<typeof setTimeout> | undefined;

/**
 * codeWidget callback for fenced ```reckon``` blocks.
 * Silverbullet calls this with the block body and current page name when
 * the cursor is outside the block. Each call gets a fresh engine
 * invocation so blocks have isolated scope (per spec §5).
 *
 * Edge case (V1 limit): if a block body literally starts with `---` and
 * has another `---` line later, engine.evaluate's extractMathLines will
 * skip that prefix as if it were frontmatter. Block bodies that look
 * like that are vanishingly rare; we accept the corner case in V1.
 */
export function reckonBlockWidget(
  bodyText: string,
  _pageName: string,
): { html: string; script: string } {
  return renderSheet(evaluate(bodyText));
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
  const result = evaluate(text);
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
