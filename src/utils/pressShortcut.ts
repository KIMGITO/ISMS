// src/utils/pressShortcut.ts
// Presses the button tagged data-shortcut="name". When that button sits inside a tab group that
// isn't open yet, the group's button (data-shortcut-within lists its parts) is pressed first,
// then the part. Global search and page keys both use this, so a tab moved into a group is
// still found by its old name.

const isVisible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;

function find(root: ParentNode, selector: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
    (b) => isVisible(b) && !(b as HTMLButtonElement).disabled,
  );
}

export function pressShortcut(name: string, root: ParentNode = document, opts: { skipIfPressed?: boolean } = {}): boolean {
  const safe = CSS.escape(name);
  const el = find(root, `[data-shortcut="${safe}"]`);
  if (el) {
    if (!(opts.skipIfPressed && (el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true"))) el.click();
    return true;
  }
  const group = find(root, `[data-shortcut-within~="${safe}"]`);
  if (!group) return false;
  group.click();
  // The group's parts render on the next frame.
  setTimeout(() => find(root, `[data-shortcut="${safe}"]`)?.click(), 60);
  return true;
}
