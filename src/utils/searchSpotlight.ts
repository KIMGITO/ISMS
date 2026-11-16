/**
 * After a search result opens its screen, find the row it was about, scroll it to the middle
 * of the screen and flash a highlight on it.
 *
 * Rows opt in with `data-search-id="<result id>"` (SwipeRow takes `searchId`). When no row is
 * tagged, the visible element whose text best matches the result's title is used instead, so
 * every result at least lands on something real. Screens open with an animation and some load
 * their lists, so this keeps looking for a few seconds before giving up quietly.
 */

const CLASS = "search-spotlight";
const WAIT_MS = 4000;
const SHOW_MS = 3200;

let run = 0;

function isVisible(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[data-global-search]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== "hidden" && st.display !== "none";
}

function byId(id: string): HTMLElement | null {
  const all = document.querySelectorAll(`[data-search-id="${CSS.escape(id)}"]`);
  for (const el of Array.from(all)) if (isVisible(el)) return el;
  return null;
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** The smallest visible block whose text holds the title, lifted to its list row when it has one. */
function byText(title: string): HTMLElement | null {
  const want = norm(title);
  if (want.length < 3) return null;
  const root = document.querySelector(".app-viewport") || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = norm(n.textContent || "");
    if (!text || !(text === want || (text.includes(want) && text.length < want.length * 3))) continue;
    const el = n.parentElement;
    if (!el || !isVisible(el)) continue;
    const score = (text === want ? 0 : 1000) + text.length;
    if (score < bestScore) { best = el; bestScore = score; }
  }
  if (!best) return null;
  return (best.closest("li, tr, [data-search-id], [role='row'], button, a, .rounded-2xl, .rounded-xl") as HTMLElement | null) || best;
}

function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const mid = r.top + r.height / 2;
  return mid > 0 && mid < window.innerHeight;
}

function show(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  // A smooth scroll can be cut short (the list re-renders, the screen is still settling):
  // if the row still isn't on screen, jump to it.
  window.setTimeout(() => {
    if (el.isConnected && !inView(el)) el.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
  }, 700);
  el.classList.remove(CLASS);
  void el.offsetWidth; // restart the animation when the same row is found twice
  el.classList.add(CLASS);
  window.setTimeout(() => el.classList.remove(CLASS), SHOW_MS);
}

/**
 * @param id     the result id rows are tagged with
 * @param title  text to look for when no row carries the id
 * @param press  a `data-shortcut` tab or button to open first, e.g. the Expenses tab on Payments
 */
export function spotlight(id: string, title?: string, press?: string) {
  const mine = ++run;
  const started = Date.now();
  let pressed = !press;
  let lastTop: number | null = null;
  // Give the screen a moment to swap in before falling back to text, so the old screen's
  // text isn't matched.
  const tick = () => {
    if (mine !== run) return;
    const waited = Date.now() - started;
    if (!pressed) {
      const button = document.querySelector<HTMLElement>(`[data-shortcut="${CSS.escape(press!)}"]`);
      if (button && isVisible(button)) {
        pressed = true;
        if (button.getAttribute("aria-selected") !== "true" && button.getAttribute("aria-pressed") !== "true") button.click();
      } else if (waited < WAIT_MS) {
        return void window.setTimeout(tick, 120);
      }
    }
    const el = byId(id) || (waited > 600 && title ? byText(title) : null);
    // Scroll only once the screen has stopped sliding in, or the scroll lands short.
    if (el) {
      const top = Math.round(el.getBoundingClientRect().top);
      if (top === lastTop || waited >= WAIT_MS) return show(el);
      lastTop = top;
    }
    if (waited < WAIT_MS) window.setTimeout(tick, 120);
  };
  window.setTimeout(tick, 80);
}
