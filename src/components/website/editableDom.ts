// Converts between the website's inline text format (**bold**, _italic_, ~~struck~~,
// ==highlight==, [link](/path)) and the HTML inside the page editor's editable fields.
// Only those five kinds of formatting survive the trip; anything else the browser
// adds (fonts, colours from a paste, <div>s) is dropped, so stored text stays clean.
import { InlineNode, parseInline, SAFE_LINK } from '../../../website/src/richFormat';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function nodesToHtml(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.t) {
        case 'text':
          return escapeHtml(node.v);
        case 'b':
          return `<strong>${nodesToHtml(node.c)}</strong>`;
        case 'i':
          return `<em>${nodesToHtml(node.c)}</em>`;
        case 's':
          return `<s>${nodesToHtml(node.c)}</s>`;
        case 'mark':
          return `<mark>${nodesToHtml(node.c)}</mark>`;
        case 'a':
          return `<a href="${escapeHtml(node.href)}">${nodesToHtml(node.c)}</a>`;
      }
    })
    .join('');
}

export const inlineToHtml = (text: string) => nodesToHtml(parseInline(text));

interface Run {
  text: string;
  b: boolean;
  i: boolean;
  s: boolean;
  mark: boolean;
  href: string;
}

type Flags = Omit<Run, 'text'>;

function collectRuns(node: Node, flags: Flags, runs: Run[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/[\n\r\t ]+/g, ' ');
    if (text) runs.push({ ...flags, text });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === 'BR') {
    runs.push({ ...flags, text: ' ' });
    return;
  }
  const tag = node.tagName;
  const css = node.style;
  const weight = css.fontWeight;
  const next: Flags = {
    b: flags.b || tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600,
    i: flags.i || tag === 'I' || tag === 'EM' || css.fontStyle === 'italic',
    s: flags.s || tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || css.textDecorationLine?.includes('line-through') || css.textDecoration?.includes('line-through'),
    mark: flags.mark || tag === 'MARK',
    href: flags.href,
  };
  if (tag === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (SAFE_LINK.test(href)) next.href = href;
  }
  // Block elements a browser may insert become a space between words.
  const block = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE)$/.test(tag);
  if (block && runs.length) runs.push({ ...flags, text: ' ' });
  node.childNodes.forEach((child) => collectRuns(child, next, runs));
}

const sameFormat = (a: Run, b: Run) => a.b === b.b && a.i === b.i && a.s === b.s && a.mark === b.mark && a.href === b.href;

// Formatting markers can't hold their own marker character, so it is swapped for a look-alike.
function wrapRun(run: Run): string {
  let text = run.text;
  if (!text.trim()) return text;
  // Keep spaces outside the markers: "** word**" reads oddly when edited by hand.
  const lead = /^\s*/.exec(text)![0];
  const tail = /\s*$/.exec(text)![0];
  text = text.trim();
  if (run.mark) text = `==${text.replace(/==/g, '=')}==`;
  if (run.s) text = `~~${text.replace(/~~/g, '~')}~~`;
  if (run.i) text = `_${text.replace(/_/g, ' ')}_`;
  if (run.b) text = `**${text.replace(/\*\*/g, '*')}**`;
  return `${lead}${text}${tail}`;
}

/** The inline text format for an editable element (or a fragment cut from one). */
export function domToInline(root: Node): string {
  const runs: Run[] = [];
  root.childNodes.forEach((child) => collectRuns(child, { b: false, i: false, s: false, mark: false, href: '' }, runs));

  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && sameFormat(last, run)) last.text += run.text;
    else merged.push({ ...run });
  }

  let out = '';
  for (let i = 0; i < merged.length; i++) {
    const run = merged[i];
    if (!run.href) {
      out += wrapRun(run);
      continue;
    }
    // A link can cover several differently formatted runs.
    let label = '';
    let j = i;
    while (j < merged.length && merged[j].href === run.href) label += wrapRun(merged[j++]);
    out += label.trim() ? `[${label.replace(/[[\]]/g, '')}](${run.href})` : label;
    i = j - 1;
  }
  return out.replace(/\s+/g, ' ').replace(/^\s+/, '');
}

/** Markup before and after the caret, for splitting a block when Enter is pressed. */
export function splitAtCaret(element: HTMLElement): { before: string; after: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) return null;
  range.deleteContents();
  const tail = document.createRange();
  tail.setStart(range.endContainer, range.endOffset);
  tail.setEnd(element, element.childNodes.length);
  const fragment = tail.extractContents();
  const holder = document.createElement('div');
  holder.appendChild(fragment);
  return { before: domToInline(element), after: domToInline(holder) };
}

export function caretAtStart(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return false;
  const head = document.createRange();
  head.setStart(element, 0);
  head.setEnd(range.startContainer, range.startOffset);
  return head.toString().length === 0;
}

export function placeCaret(element: HTMLElement, at: 'start' | 'end') {
  element.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(at === 'start');
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Wraps the selection in <mark>, or removes the highlight when the selection is inside one. */
export function toggleHighlight(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return;

  const startNode = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const inside = startNode?.closest('mark');
  if (inside && element.contains(inside)) {
    const parent = inside.parentNode!;
    while (inside.firstChild) parent.insertBefore(inside.firstChild, inside);
    parent.removeChild(inside);
    parent.normalize();
    return;
  }
  if (range.collapsed) return;
  const fragment = range.extractContents();
  fragment.querySelectorAll('mark').forEach((m) => m.replaceWith(...Array.from(m.childNodes)));
  const mark = document.createElement('mark');
  mark.appendChild(fragment);
  range.insertNode(mark);
  const after = document.createRange();
  after.selectNodeContents(mark);
  selection.removeAllRanges();
  selection.addRange(after);
}

/** Removes every kind of formatting (and links) from the selection. */
export function clearFormatting(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !element.contains(range.commonAncestorContainer)) return;
  const text = range.toString();
  range.deleteContents();
  // Splitting out of the formatted elements: cut everything after the caret, insert
  // the plain text between, then put the tail back.
  const tail = document.createRange();
  tail.setStart(range.endContainer, range.endOffset);
  tail.setEnd(element, element.childNodes.length);
  const rest = tail.extractContents();
  const plain = document.createTextNode(text);
  element.appendChild(plain);
  element.appendChild(rest);
  element.querySelectorAll('strong,b,em,i,s,strike,del,mark,a,span').forEach((el) => {
    if (!el.textContent) el.remove();
  });
  const after = document.createRange();
  after.selectNode(plain);
  selection.removeAllRanges();
  selection.addRange(after);
}

/** Makes a typed link safe: "example.com" → https://, phone numbers → tel:, emails → mailto:. */
export function normaliseLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (SAFE_LINK.test(value)) return value;
  if (/^http:\/\//i.test(value)) return value.replace(/^http:/i, 'https:');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/^\+?[\d\s-]{7,}$/.test(value)) return `tel:${value.replace(/[\s-]/g, '')}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
  return null;
}
