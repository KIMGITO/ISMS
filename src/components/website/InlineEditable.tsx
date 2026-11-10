import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { caretAtStart, domToInline, inlineToHtml, placeCaret, splitAtCaret } from './editableDom';

export interface FocusRequest {
  key: string;
  /** 'start', 'end', or a character offset into the plain text. */
  at: 'start' | 'end' | number;
  /** Changes on every request, so asking twice for the same field still works. */
  n: number;
}

export interface EditableHandle {
  el: HTMLDivElement;
  /** Reads the field after a change made outside React (formatting buttons). */
  sync: () => void;
}

interface Props {
  editKey: string;
  text: string;
  onText: (text: string) => void;
  className?: string;
  placeholder?: string;
  label: string;
  focusRequest: FocusRequest | null;
  registry: Map<string, EditableHandle>;
  onFocus?: () => void;
  onEnter?: (before: string, after: string) => void;
  onBackspaceAtStart?: () => void;
  onPasteLines?: (lines: string[]) => void;
  onPasteImage?: (file: File) => void;
}

function placeCaretAtOffset(element: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let left = offset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) {
      element.focus({ preventScroll: true });
      const range = document.createRange();
      range.setStart(node, left);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    left -= length;
    node = walker.nextNode();
  }
  placeCaret(element, 'end');
}

/**
 * One editable line of page text (a paragraph, heading, quote or list item).
 * The DOM is only rewritten when the text changes from outside (undo, a new page,
 * a style conversion), never while typing, so the caret and the browser's own undo
 * keep working.
 */
export default function InlineEditable({
  editKey,
  text,
  onText,
  className = '',
  placeholder,
  label,
  focusRequest,
  registry,
  onFocus,
  onEnter,
  onBackspaceAtStart,
  onPasteLines,
  onPasteImage,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (ref.current && text !== shown.current) {
      ref.current.innerHTML = inlineToHtml(text);
      shown.current = text;
    }
  }, [text]);

  useLayoutEffect(() => {
    if (!ref.current || !focusRequest || focusRequest.key !== editKey) return;
    if (typeof focusRequest.at === 'number') placeCaretAtOffset(ref.current, focusRequest.at);
    else placeCaret(ref.current, focusRequest.at);
    ref.current.scrollIntoView({ block: 'nearest' });
  }, [focusRequest, editKey]);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    const next = domToInline(el);
    // An emptied field keeps a stray <br>, which hides the placeholder.
    if (!next && el.innerHTML) el.innerHTML = '';
    shown.current = next;
    if (next !== text) onText(next);
  };

  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registry.set(editKey, { el, sync: () => syncRef.current() });
    return () => {
      if (registry.get(editKey)?.el === el) registry.delete(editKey);
    };
  }, [editKey, registry]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current!;
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!onEnter) return;
      const parts = splitAtCaret(el);
      if (!parts) return;
      shown.current = parts.before;
      onEnter(parts.before, parts.after);
    } else if (e.key === 'Backspace' && onBackspaceAtStart && caretAtStart(el)) {
      e.preventDefault();
      onBackspaceAtStart();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const image = Array.from(e.clipboardData.files).find((file) => file.type.startsWith('image/'));
    if (image && onPasteImage) {
      e.preventDefault();
      onPasteImage(image);
      return;
    }
    // Paste as plain text, so fonts and colours from other apps never reach the website.
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/plain').replace(/\r/g, '');
    const lines = pasted.split('\n');
    document.execCommand('insertText', false, lines[0]);
    const rest = lines.slice(1);
    if (rest.some((line) => line.trim()) && onPasteLines) {
      sync();
      onPasteLines(rest);
    }
  };

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label={label}
      aria-multiline="false"
      contentEditable="true"
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      data-edit-key={editKey}
      onInput={sync}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className={`min-w-0 flex-1 whitespace-pre-wrap break-words outline-none empty:before:pointer-events-none empty:before:text-app-text-muted/70 empty:before:content-[attr(data-placeholder)] [&_a]:text-brand-600 [&_a]:underline [&_mark]:rounded-sm [&_mark]:bg-amber-300/60 [&_mark]:px-0.5 [&_mark]:text-inherit [&_s]:opacity-70 ${className}`}
    />
  );
}
