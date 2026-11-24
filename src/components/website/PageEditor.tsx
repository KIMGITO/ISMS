import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SearchableDropdown from '../SearchableDropdown';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Columns2,
  Copy,
  Eraser,
  Eye,
  Highlighter,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  Monitor,
  Move,
  PenLine,
  Smartphone,
  Strikethrough,
  Trash2,
  Undo2,
  Unlink,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  Block,
  DEFAULT_IMAGE_STYLE,
  ImageAlign,
  ImageStyle,
  ImageWidth,
  ListBlockType,
  parseDocument,
  serializeDocument,
  TextAlign,
  TextBlockType,
  TextStyle,
} from '../../../website/src/richFormat';
import { renderBlock } from '../../../website/src/RichText';
import { toUserMessage } from '../../utils/userError';
import { clearFormatting, inlineToHtml, normaliseLink, toggleHighlight } from './editableDom';
import { FocalLayer, ImageBlock, ImageCard, withAlign } from './ImageControls';
import UnifiedUploader from '../shared/UnifiedUploader';
import ProgressBar from '../shared/ProgressBar';
import InlineEditable, { EditableHandle, FocusRequest } from './InlineEditable';
import { uploadPageImage } from './pageImages';

interface PickedImage {
  src: string;
  alt: string;
}


/** A starting alt text from a file name: "shop-front_2.jpg" becomes "shop front 2". */
const altFromName = (name = '') =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/^(img|image|photo|dsc|pxl|linked image)\s*\d*/i, '')
    .trim();

// ---------------------------------------------------------------------------
// Blocks with ids, for React keys and focus
// ---------------------------------------------------------------------------

type EBlock = Block & { id: string };
type TextEBlock = Extract<EBlock, { type: TextBlockType }>;
type ListEBlock = Extract<EBlock, { type: ListBlockType }>;
type BlockKind = TextBlockType | ListBlockType | 'img' | 'hr';

let counter = 0;
const newId = () => `b${++counter}`;
const withIds = (blocks: Block[]): EBlock[] => blocks.map((block) => ({ ...block, id: newId() }) as EBlock);
const emptyParagraph = (style: TextStyle = {}): TextEBlock => ({ id: newId(), type: 'p', text: '', style });
const startBlocks = (value: string): EBlock[] => {
  const blocks = withIds(parseDocument(value));
  return blocks.length ? blocks : [emptyParagraph()];
};
const toText = (blocks: EBlock[]) => serializeDocument(blocks.map(({ id: _id, ...block }) => block as Block));

const isText = (b: EBlock | undefined): b is TextEBlock => !!b && (b.type === 'p' || b.type === 'h2' || b.type === 'h3' || b.type === 'quote');
const isList = (b: EBlock | undefined): b is ListEBlock => !!b && (b.type === 'ul' || b.type === 'ol');
const isEmptyText = (b: EBlock | undefined) => isText(b) && !b.text.trim();

const textLength = (markup: string) => {
  const holder = document.createElement('div');
  holder.innerHTML = inlineToHtml(markup);
  return holder.textContent?.length ?? 0;
};

function convert(block: EBlock, type: TextBlockType | ListBlockType): EBlock[] {
  const listType = type === 'ul' || type === 'ol';
  if (isText(block)) {
    return [listType ? { id: block.id, type, items: [block.text], style: block.style } : { ...block, type }];
  }
  if (isList(block)) {
    if (listType) return [{ ...block, type }];
    return block.items.map((text, i) => ({ id: i === 0 ? block.id : newId(), type, text, style: block.style }));
  }
  return [block];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const TYPE_OPTIONS: { value: TextBlockType | ListBlockType; label: string }[] = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h2', label: 'Heading' },
  { value: 'h3', label: 'Subheading' },
  { value: 'quote', label: 'Quote' },
  { value: 'ul', label: 'Bulleted list' },
  { value: 'ol', label: 'Numbered list' },
];

const INSERT_OPTIONS: { value: BlockKind; label: string }[] = [
  ...TYPE_OPTIONS,
  { value: 'img', label: 'Photo' },
  { value: 'hr', label: 'Divider line' },
];

const BADGES: Record<BlockKind, string> = { p: '¶', h2: 'H1', h3: 'H2', quote: '❝', ul: '•', ol: '1.', img: '▣', hr: '—' };

const SIZE_OPTIONS = [
  { value: '', label: 'Normal size' },
  { value: 'sm', label: 'Small' },
  { value: 'lg', label: 'Large' },
  { value: 'xl', label: 'Extra large' },
];
const FONT_OPTIONS = [
  { value: '', label: 'Usual font' },
  { value: 'sans', label: 'Sans (clean)' },
  { value: 'serif', label: 'Serif (classic)' },
  { value: 'mono', label: 'Typewriter' },
];
const COLOR_OPTIONS = [
  { value: '', label: 'Usual colour', swatch: '#23160e' },
  { value: 'muted', label: 'Soft brown', swatch: '#6b5a4b' },
  { value: 'accent', label: 'Rust', swatch: '#9a4313' },
  { value: 'orange', label: 'Orange', swatch: '#c2571a' },
  { value: 'green', label: 'Green', swatch: '#2f6b45' },
];
const BOX_OPTIONS = [
  { value: '', label: 'No background' },
  { value: 'sand', label: 'Sand box' },
  { value: 'amber', label: 'Warm box' },
  { value: 'green', label: 'Green box' },
  { value: 'outline', label: 'Outlined box' },
];

// How each block looks in the editor column (the app's theme, light or dark).
const EDIT_TYPE_CLASS: Record<TextBlockType, string> = {
  p: 'text-[15px] leading-relaxed',
  h2: 'font-display text-xl font-bold leading-snug',
  h3: 'text-base font-semibold leading-snug',
  quote: 'border-l-4 border-brand-500/60 pl-3 italic leading-relaxed',
};
const EDIT_SIZE_CLASS: Record<string, string> = { sm: 'text-sm', lg: 'text-lg', xl: 'text-2xl' };
const EDIT_COLOR_CLASS: Record<string, string> = {
  muted: 'text-app-text-muted',
  accent: 'text-amber-800 dark:text-amber-400',
  orange: 'text-orange-600 dark:text-orange-400',
  green: 'text-emerald-700 dark:text-emerald-400',
};
const EDIT_BOX_CLASS: Record<string, string> = {
  sand: 'rounded-md bg-amber-500/10 px-2 py-1',
  amber: 'rounded-md bg-orange-500/10 px-2 py-1',
  green: 'rounded-md bg-emerald-500/10 px-2 py-1',
  outline: 'rounded-md border border-app-border px-2 py-1',
};

function editTextClass(type: TextBlockType | null, style: TextStyle) {
  return [
    type ? EDIT_TYPE_CLASS[type] : 'text-[15px] leading-relaxed',
    style.size && EDIT_SIZE_CLASS[style.size],
    style.align && EDIT_ALIGN_CLASS[style.align],
    style.font === 'serif' && 'font-serif',
    style.font === 'mono' && 'font-mono',
    style.font === 'sans' && 'font-sans',
    style.color ? EDIT_COLOR_CLASS[style.color] : 'text-app-text',
    style.box && EDIT_BOX_CLASS[style.box],
  ]
    .filter(Boolean)
    .join(' ');
}

const EDIT_ALIGN_CLASS: Record<TextAlign, string> = { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify' };
const QUICK_FORMATS = { '###': 'h3', '##': 'h2', '>': 'quote', '-': 'ul', '*': 'ul', '1.': 'ol', '1)': 'ol' } as const;

const WIDTH_STEPS: [ImageWidth, number][] = [['sm', 1 / 3], ['md', 0.5], ['lg', 0.75], ['full', 1]];

function useWebsiteFonts() {
  useEffect(() => {
    if (document.getElementById('website-preview-fonts')) return;
    const link = document.createElement('link');
    link.id = 'website-preview-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);
}

// ---------------------------------------------------------------------------
// Small toolbar parts
// ---------------------------------------------------------------------------

function ToolButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Keeps the text selection, so the formatting applies to what was selected.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 text-app-text transition disabled:opacity-35 ${pressed ? 'bg-brand-500/20 text-app-text' : 'hover:bg-app-bg'}`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-6 w-px shrink-0 bg-app-border" aria-hidden />;

function ToolSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  className = '',
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div title={label} aria-label={label} className={`w-36 shrink-0 ${disabled ? 'opacity-40' : ''} ${className}`}>
      <SearchableDropdown
        items={options.map((o) => ({ id: o.value, label: o.label }))}
        selectedValue={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={label}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

export interface PageEditorProps {
  value: string;
  onChange: (text: string) => void;
  businessId: string;
  /** What the website shows while the text is empty (an info page's standard text). */
  fallback?: string;
  /** The page's own heading, drawn at the top of the preview. */
  header: { eyebrow?: string; title: string; summary?: string };
  /** Info pages: "## " headings start page sections and are drawn larger. */
  sectionHeadings?: boolean;
  /** Shown above the preview, for pages the website lays out in a special way. */
  previewNote?: ReactNode;
  placeholder?: string;
}

type View = 'split' | 'edit' | 'preview';

/**
 * Rich editor for website pages and guides: a column of blocks (paragraphs,
 * headings, lists, quotes, photos, dividers) with a formatting toolbar, beside a
 * live preview drawn by the website's own renderer. Photos can be dragged in the
 * preview to reposition them inside their frame, moved to another place (left,
 * centre or right of the text) and resized.
 */
export default function PageEditor({
  value,
  onChange,
  businessId,
  fallback = '',
  header,
  sectionHeadings,
  previewNote,
  placeholder = 'Start writing here…',
}: PageEditorProps) {
  useWebsiteFonts();

  const [blocks, setBlocks] = useState<EBlock[]>(() => startBlocks(value));
  const blocksRef = useRef(blocks);
  const emitted = useRef(value);
  const history = useRef<EBlock[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const registry = useMemo(() => new Map<string, EditableHandle>(), []);
  const lastField = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [formats, setFormats] = useState({ field: '', bold: false, italic: false, strike: false, mark: false, link: '' });
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches ? 'split' : 'edit',
  );
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [picker, setPicker] = useState<{ replace: string | null } | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  // Percent of a pasted photo's upload, or null when none is running.
  const [uploading, setUploading] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [dropMarker, setDropMarker] = useState<{ top: number; left: number; width: number; side: ImageAlign } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const richRef = useRef<HTMLDivElement>(null);

  // A new page, or text changed outside the editor: start again from that text.
  useEffect(() => {
    if (value === emitted.current) return;
    const next = startBlocks(value);
    blocksRef.current = next;
    setBlocks(next);
    emitted.current = value;
    history.current = [];
    setCanUndo(false);
  }, [value]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const emit = useCallback(
    (next: EBlock[]) => {
      blocksRef.current = next;
      setBlocks(next);
      const text = toText(next);
      if (text !== emitted.current) {
        emitted.current = text;
        onChange(text);
      }
    },
    [onChange],
  );

  const remember = useCallback(() => {
    history.current.push(blocksRef.current);
    if (history.current.length > 80) history.current.shift();
    setCanUndo(true);
  }, []);

  /** structural: a change worth its own undo step (typing uses the browser's own undo). */
  const commit = useCallback(
    (next: EBlock[], structural = false) => {
      if (structural) remember();
      emit(next);
    },
    [emit, remember],
  );

  const undo = () => {
    const previous = history.current.pop();
    if (!previous) return;
    setCanUndo(history.current.length > 0);
    emit(previous);
  };

  const focus = (key: string, at: FocusRequest['at']) => setFocusRequest({ key, at, n: Math.random() });
  const indexOf = (id: string) => blocksRef.current.findIndex((b) => b.id === id);
  const replaceBlock = (id: string, replacement: EBlock[], structural = true) => {
    const list = [...blocksRef.current];
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) return;
    list.splice(i, 1, ...replacement);
    commit(list.length ? list : [emptyParagraph()], structural);
  };
  const patchBlock = (id: string, change: (b: EBlock) => EBlock, structural = false) =>
    commit(blocksRef.current.map((b) => (b.id === id ? change(b) : b)), structural);

  /** Puts new blocks after the selected one, or in place of it when it is an empty line. */
  const insertBlocks = (fresh: EBlock[], afterId: string | null = activeId) => {
    const list = [...blocksRef.current];
    const i = afterId ? list.findIndex((b) => b.id === afterId) : list.length - 1;
    if (i >= 0 && isEmptyText(list[i])) list.splice(i, 1, ...fresh);
    else list.splice(i < 0 ? list.length : i + 1, 0, ...fresh);
    commit(list, true);
    setActiveId(fresh[0].id);
  };

  const active = blocks.find((b) => b.id === activeId);

  // ---- Selection tracking, for the formatting buttons ----
  useEffect(() => {
    const onSelection = () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const node = selection.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      const field = element?.closest<HTMLElement>('[data-edit-key]');
      if (!field || !rootRef.current?.contains(field)) return;
      lastField.current = field.dataset.editKey ?? null;
      savedRange.current = selection.getRangeAt(0).cloneRange();
      const next = {
        field: lastField.current ?? '',
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        strike: document.queryCommandState('strikeThrough'),
        mark: Boolean(element?.closest('mark')),
        link: element?.closest('a')?.getAttribute('href') ?? '',
      };
      setFormats((old) =>
        old.field === next.field && old.bold === next.bold && old.italic === next.italic && old.strike === next.strike && old.mark === next.mark && old.link === next.link ? old : next,
      );
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const textSelected = Boolean(formats.field && registry.get(formats.field) && (isText(active) || isList(active)));

  /** Runs a formatting change on the field the selection was last in. */
  const runInline = (change: (el: HTMLElement) => void) => {
    const handle = lastField.current ? registry.get(lastField.current) : undefined;
    if (!handle) {
      setNotice('Tap into the text first, select some words, then choose the formatting.');
      return;
    }
    handle.el.focus({ preventScroll: true });
    const range = savedRange.current;
    if (range && handle.el.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    change(handle.el);
    handle.sync();
  };

  const command = (name: 'bold' | 'italic' | 'strikeThrough') => runInline(() => document.execCommand(name));

  const applyLink = () => {
    const href = normaliseLink(linkDraft ?? '');
    if (!href) {
      setNotice('Type a website page like /delivery, a full link like https://…, a phone number or an email address.');
      return;
    }
    runInline(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const existing = start?.closest('a');
      if (existing) existing.setAttribute('href', href);
      else if (range.collapsed) {
        const link = document.createElement('a');
        link.setAttribute('href', href);
        link.textContent = (linkDraft ?? '').trim();
        range.insertNode(link);
      } else document.execCommand('createLink', false, href);
    });
    setLinkDraft(null);
  };

  const removeLink = () =>
    runInline(() => {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const link = (node instanceof Element ? node : node?.parentElement)?.closest('a');
      if (link) link.replaceWith(...Array.from(link.childNodes));
    });

  // ---- Block style ----
  const setStyle = (change: Partial<TextStyle>) => {
    if (!active || !(isText(active) || isList(active))) return;
    patchBlock(active.id, (b) => {
      const style = { ...(b as TextEBlock).style, ...change };
      (Object.keys(style) as (keyof TextStyle)[]).forEach((k) => !style[k] && delete style[k]);
      return { ...b, style } as EBlock;
    }, true);
  };

  const setType = (type: TextBlockType | ListBlockType) => {
    if (!active || !(isText(active) || isList(active))) return;
    const replacement = convert(active, type);
    replaceBlock(active.id, replacement);
    const first = replacement[0];
    focus(isList(first) ? `${first.id}:0` : first.id, 'end');
  };

  const moveBlock = (id: string, by: -1 | 1) => {
    const list = [...blocksRef.current];
    const i = list.findIndex((b) => b.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commit(list, true);
  };

  const duplicateBlock = (id: string) => {
    const b = blocksRef.current.find((x) => x.id === id);
    if (!b) return;
    const copy = { ...structuredClone(b), id: newId() } as EBlock;
    insertBlocks([copy], id);
  };

  const deleteBlock = (id: string) => {
    const i = indexOf(id);
    replaceBlock(id, []);
    const neighbour = blocksRef.current[Math.max(0, i - 1)];
    setActiveId(neighbour?.id ?? null);
    setNotice('Block deleted. Use Undo to bring it back.');
  };

  const addBlock = (kind: BlockKind) => {
    if (kind === 'img') {
      setPicker({ replace: null });
      return;
    }
    const fresh: EBlock =
      kind === 'hr'
        ? { id: newId(), type: 'hr' }
        : kind === 'ul' || kind === 'ol'
          ? { id: newId(), type: kind, items: [''], style: {} }
          : { id: newId(), type: kind, text: '', style: {} };
    const after: EBlock[] = kind === 'hr' ? [fresh, emptyParagraph()] : [fresh];
    insertBlocks(after);
    if (kind === 'hr') focus(after[1].id, 'start');
    else focus(isList(fresh) ? `${fresh.id}:0` : fresh.id, 'start');
  };

  // ---- Photos ----
  const placePhoto = (image: PickedImage) => {
    const target = picker?.replace;
    setPicker(null);
    if (target) {
      patchBlock(target, (b) => ({ ...b, src: image.src, alt: (b as ImageBlock).alt || image.alt }) as EBlock, true);
      return;
    }
    const block: EBlock = { id: newId(), type: 'img', src: image.src, alt: image.alt, caption: '', style: { ...DEFAULT_IMAGE_STYLE, ratio: '16:9' } };
    insertBlocks([block]);
  };

  const uploadAndInsert = async (file: File, afterId: string | null) => {
    setUploading(0);
    try {
      const src = await uploadPageImage(businessId, file, setUploading);
      insertBlocks([{ id: newId(), type: 'img', src, alt: '', caption: '', style: { ...DEFAULT_IMAGE_STYLE, ratio: '16:9' } }], afterId);
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not upload the photo.'));
    } finally {
      setUploading(null);
    }
  };

  const setImageStyle = (id: string, style: ImageStyle, structural: boolean) =>
    patchBlock(id, (b) => ({ ...b, style }) as EBlock, structural);

  // ---- Text editing: Enter, Backspace, pasting several lines ----
  const pasteLines = (afterId: string, lines: string[]) => {
    const fresh = withIds(parseDocument(lines.join('\n')));
    if (!fresh.length) return;
    const list = [...blocksRef.current];
    list.splice(list.findIndex((b) => b.id === afterId) + 1, 0, ...fresh);
    commit(list, true);
  };

  const textHandlers = (b: TextEBlock) => ({
    onText: (text: string) => {
      // Quick formats typed at the start of a line, as in most editors.
      const quick = b.type === 'p' ? /^(###|##|>|[-*]|1[.)]) (.*)$/.exec(text) : null;
      if (quick) {
        const type = QUICK_FORMATS[quick[1] as keyof typeof QUICK_FORMATS];
        const replacement = convert({ ...b, text: quick[2] }, type);
        replaceBlock(b.id, replacement);
        focus(isList(replacement[0]) ? `${b.id}:0` : b.id, 'end');
        return;
      }
      patchBlock(b.id, (x) => ({ ...x, text }) as EBlock);
    },
    onEnter: (before: string, after: string) => {
      const next = emptyParagraph(b.type === 'p' ? { ...b.style } : {});
      next.text = after;
      replaceBlock(b.id, [{ ...b, text: before }, next]);
      focus(next.id, 'start');
    },
    onBackspaceAtStart: () => {
      const list = blocksRef.current;
      const i = indexOf(b.id);
      const previous = list[i - 1];
      if (b.type !== 'p') {
        replaceBlock(b.id, [{ ...b, type: 'p' }]);
        focus(b.id, 'start');
        return;
      }
      if (!previous) return;
      if (isText(previous)) {
        const offset = textLength(previous.text);
        const merged = [...list];
        merged.splice(i - 1, 2, { ...previous, text: previous.text + b.text });
        commit(merged, true);
        focus(previous.id, offset);
      } else if (isList(previous)) {
        const last = previous.items.length - 1;
        const offset = textLength(previous.items[last]);
        const items = [...previous.items];
        items[last] += b.text;
        const merged = [...list];
        merged.splice(i - 1, 2, { ...previous, items });
        commit(merged, true);
        focus(`${previous.id}:${last}`, offset);
      } else {
        if (!b.text.trim()) replaceBlock(b.id, []);
        setActiveId(previous.id);
      }
    },
    onPasteLines: (lines: string[]) => pasteLines(b.id, lines),
    onPasteImage: (file: File) => uploadAndInsert(file, b.id),
  });

  const itemHandlers = (b: ListEBlock, j: number) => ({
    onText: (text: string) =>
      patchBlock(b.id, (x) => {
        const items = [...(x as ListEBlock).items];
        items[j] = text;
        return { ...x, items } as EBlock;
      }),
    onEnter: (before: string, after: string) => {
      if (!before.trim() && !after.trim()) {
        // Enter on an empty item ends the list.
        const head = b.items.slice(0, j);
        const tail = b.items.slice(j + 1);
        const paragraph = emptyParagraph();
        replaceBlock(b.id, [
          ...(head.length ? [{ ...b, items: head }] : []),
          paragraph,
          ...(tail.length ? [{ ...b, id: newId(), items: tail }] : []),
        ]);
        focus(paragraph.id, 'start');
        return;
      }
      const items = [...b.items];
      items.splice(j, 1, before, after);
      replaceBlock(b.id, [{ ...b, items }]);
      focus(`${b.id}:${j + 1}`, 'start');
    },
    onBackspaceAtStart: () => {
      if (j === 0) {
        const paragraph = { ...emptyParagraph(), text: b.items[0] };
        const rest = b.items.slice(1);
        replaceBlock(b.id, [paragraph, ...(rest.length ? [{ ...b, items: rest }] : [])]);
        focus(paragraph.id, 'start');
        return;
      }
      const offset = textLength(b.items[j - 1]);
      const items = [...b.items];
      items.splice(j - 1, 2, items[j - 1] + items[j]);
      replaceBlock(b.id, [{ ...b, items }]);
      focus(`${b.id}:${j - 1}`, offset);
    },
    onPasteLines: (lines: string[]) => pasteLines(b.id, lines),
    onPasteImage: (file: File) => uploadAndInsert(file, b.id),
  });

  // ---- Preview: keep the selected block in view ----
  useEffect(() => {
    const shell = previewRef.current;
    const i = activeId ? blocksRef.current.findIndex((b) => b.id === activeId) : -1;
    const el = i >= 0 ? richRef.current?.querySelector<HTMLElement>(`:scope > [data-rt-index="${i}"]`) : null;
    if (!shell || !el) return;
    const box = shell.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < box.top + 8 || r.bottom > box.bottom - 8) {
      shell.scrollTo({ top: shell.scrollTop + r.top - box.top - box.height / 3, behavior: 'smooth' });
    }
  }, [activeId, view]);

  // ---- Preview: drag a photo to another place ----
  const startMove = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const root = richRef.current;
    const shell = previewRef.current;
    if (!root || !shell) return;
    handle.setPointerCapture(e.pointerId);
    const from = indexOf(id);
    let drop: { index: number; side: ImageAlign } | null = null;

    const compute = (x: number, y: number) => {
      const rootBox = root.getBoundingClientRect();
      const shellBox = shell.getBoundingClientRect();
      if (y < shellBox.top + 40) shell.scrollTop -= 12;
      else if (y > shellBox.bottom - 40) shell.scrollTop += 12;
      const others = Array.from(root.querySelectorAll<HTMLElement>(':scope > [data-rt-index]')).filter(
        (el) => Number(el.dataset.rtIndex) !== from,
      );
      let index = blocksRef.current.length;
      let line = rootBox.top;
      for (const el of others) {
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          index = Number(el.dataset.rtIndex);
          line = r.top - 8;
          break;
        }
        line = r.bottom + 8;
      }
      const across = (x - rootBox.left) / rootBox.width;
      const side: ImageAlign = across < 0.33 ? 'left' : across > 0.67 ? 'right' : 'center';
      drop = { index, side };
      setDropMarker({ top: line - shellBox.top + shell.scrollTop, left: rootBox.left - shellBox.left, width: rootBox.width, side });
    };
    compute(e.clientX, e.clientY);

    const onMove = (ev: PointerEvent) => compute(ev.clientX, ev.clientY);
    const finish = (place: boolean) => () => {
      handle.removeEventListener('pointermove', onMove);
      setDropMarker(null);
      if (!place || !drop) return;
      const list = [...blocksRef.current];
      const at = list.findIndex((b) => b.id === id);
      const [moved] = list.splice(at, 1);
      const to = drop.index > at ? drop.index - 1 : drop.index;
      const placed = moved.type === 'img' ? ({ ...moved, style: withAlign(moved.style, drop.side) } as EBlock) : moved;
      list.splice(Math.min(to, list.length), 0, placed);
      commit(list, true);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish(true), { once: true });
    handle.addEventListener('pointercancel', finish(false), { once: true });
  };

  // ---- Preview: drag the corner to resize a photo ----
  const startResize = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const figure = handle.closest('figure');
    const root = richRef.current;
    if (!figure || !root) return;
    handle.setPointerCapture(e.pointerId);
    remember();
    const startX = e.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const columnWidth = root.getBoundingClientRect().width;

    const onMove = (ev: PointerEvent) => {
      const b = blocksRef.current.find((x) => x.id === id);
      if (!b || b.type !== 'img') return;
      const floated = b.style.width !== 'full' && b.style.align !== 'center';
      const factor = !floated ? 2 : b.style.align === 'right' ? -1 : 1;
      const fraction = (startWidth + (ev.clientX - startX) * factor) / columnWidth;
      const [width] = WIDTH_STEPS.reduce((best, step) => (Math.abs(step[1] - fraction) < Math.abs(best[1] - fraction) ? step : best));
      if (width !== b.style.width) {
        const style = { ...b.style, width, align: width === 'full' ? ('center' as const) : b.style.align };
        emit(blocksRef.current.map((x) => (x.id === id ? ({ ...x, style } as EBlock) : x)));
      }
    };
    const finish = () => handle.removeEventListener('pointermove', onMove);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish, { once: true });
    handle.addEventListener('pointercancel', finish, { once: true });
  };

  const zoomBy = (id: string, step: number) =>
    patchBlock(id, (b) => {
      const style = (b as ImageBlock).style;
      return { ...b, style: { ...style, zoom: Math.min(3, Math.max(1, Math.round((style.zoom + step) * 10) / 10)) } } as EBlock;
    }, true);

  // ---- Rendering ----
  const empty = !toText(blocks);
  const activeStyle: TextStyle = isText(active) || isList(active) ? active.style : {};
  const textTools = isText(active) || isList(active);

  const selectFromPreview = (b: EBlock) => {
    setActiveId(b.id);
    if (view === 'preview') return;
    if (isText(b)) focus(b.id, 'end');
    else if (isList(b)) focus(`${b.id}:${b.items.length - 1}`, 'end');
    else document.querySelector<HTMLElement>(`[data-block-row="${b.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const photoHandles = (b: ImageBlock) => (
    <>
      <FocalLayer style={b.style} onStart={remember} onChange={(style) => setImageStyle(b.id, style, false)} />
      <button
        type="button"
        onPointerDown={startMove(b.id)}
        className="absolute left-2 top-2 inline-flex touch-none cursor-move items-center gap-1 rounded-full bg-black/65 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow"
        aria-label="Move photo. Drag to another place on the page."
      >
        <Move size={13} /> Move
      </button>
      <span className="absolute right-2 top-2 flex gap-1">
        <button type="button" onClick={() => zoomBy(b.id, -0.2)} disabled={b.style.zoom <= 1} className="rounded-full bg-black/65 p-1.5 text-white shadow disabled:opacity-40" aria-label="Zoom out">
          <ZoomOut size={14} />
        </button>
        <button type="button" onClick={() => zoomBy(b.id, 0.2)} disabled={b.style.zoom >= 3} className="rounded-full bg-black/65 p-1.5 text-white shadow disabled:opacity-40" aria-label="Zoom in">
          <ZoomIn size={14} />
        </button>
      </span>
      <span
        role="presentation"
        onPointerDown={startResize(b.id)}
        className={`absolute bottom-1.5 h-6 w-6 touch-none rounded-md border-2 border-white bg-brand-500 shadow ${b.style.align === 'right' && b.style.width !== 'full' ? 'left-1.5 cursor-nesw-resize' : 'right-1.5 cursor-nwse-resize'}`}
        title="Drag to resize"
      />
      <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
        Drag to reposition
      </span>
    </>
  );

  const preview = (
    <div
      ref={previewRef}
      // Links in the preview are for looking at, not for leaving the editor.
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault();
      }}
      className={`relative overflow-y-auto bg-[#e9e1d4] ${view === 'split' ? 'max-h-[78vh]' : 'max-h-[85vh]'} ${device === 'phone' ? 'px-3 py-4' : 'p-0'}`}
    >
      <div
        className={`mx-auto bg-[#fffdf9] text-[#23160e] ${device === 'phone' ? 'max-w-[390px] rounded-[1.75rem] border-[6px] border-[#2b1409] shadow-xl' : 'w-full'}`}
        style={{ fontFamily: 'var(--rt-sans)' }}
      >
        <div className={`border-b border-[#eadfce] bg-[#f6eee2] ${device === 'phone' ? 'rounded-t-[1.35rem] px-4 py-6' : 'px-8 py-8'}`}>
          {header.eyebrow && <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#9a4313]">{header.eyebrow}</p>}
          <h1 className="mt-2 text-[clamp(1.75rem,3.2vw,2.6rem)] font-medium leading-tight tracking-tight" style={{ fontFamily: 'var(--rt-serif)' }}>
            {header.title || 'Untitled'}
          </h1>
          {header.summary && <p className="mt-2 max-w-2xl text-[1.0625rem] leading-relaxed text-[#6b5a4b]">{header.summary}</p>}
        </div>
        <div className={device === 'phone' ? 'px-4 py-6' : 'px-8 py-8'}>
          {empty ? (
            <>
              <p className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
                {fallback ? 'Customers see the standard text below. Write in the editor to replace it.' : 'Nothing written yet.'}
              </p>
              {fallback && (
                <div className="rich-text">{parseDocument(fallback).map((b, i) => renderBlock(b, i, { sectionHeadings }))}</div>
              )}
            </>
          ) : (
            <div ref={richRef} className="rich-text max-w-3xl">
              {blocks.map((b, i) => {
                if (isEmptyText(b) || (isList(b) && !b.items.some((t) => t.trim()))) return null;
                const selected = b.id === activeId;
                return renderBlock(b, b.id, {
                  sectionHeadings,
                  props: {
                    'data-rt-index': i,
                    onClick: () => selectFromPreview(b),
                    className: `cursor-pointer rounded-sm outline-offset-4 transition-[outline-color] ${selected ? 'outline outline-2 outline-[#f59e0b]' : 'hover:outline hover:outline-1 hover:outline-[#f59e0b]/50'}`,
                  },
                  frameExtra: b.type === 'img' && selected ? photoHandles(b as ImageBlock) : undefined,
                });
              })}
            </div>
          )}
        </div>
      </div>
      {dropMarker && (
        <div className="pointer-events-none absolute z-10" style={{ top: dropMarker.top, left: dropMarker.left, width: dropMarker.width }}>
          <div
            className="h-1 rounded-full bg-[#f59e0b]"
            style={{
              width: dropMarker.side === 'center' ? '100%' : '40%',
              marginLeft: dropMarker.side === 'right' ? '60%' : 0,
            }}
          />
          <span
            className="absolute -top-7 rounded-full bg-[#23160e] px-2.5 py-1 text-[11px] font-semibold text-white"
            style={dropMarker.side === 'right' ? { right: 0 } : { left: dropMarker.side === 'center' ? '50%' : 0, transform: dropMarker.side === 'center' ? 'translateX(-50%)' : undefined }}
          >
            {dropMarker.side === 'center' ? 'Place here, on its own line' : `Place here, on the ${dropMarker.side} with text beside it`}
          </span>
        </div>
      )}
    </div>
  );

  const blockRow = (b: EBlock, i: number) => {
    const selected = b.id === activeId;
    let content: ReactNode;
    if (isText(b)) {
      content = (
        <InlineEditable
          editKey={b.id}
          text={b.text}
          label={TYPE_OPTIONS.find((t) => t.value === b.type)!.label}
          placeholder={i === 0 && blocks.length === 1 ? placeholder : b.type === 'p' ? 'Type, or press the + menu to add a photo' : TYPE_OPTIONS.find((t) => t.value === b.type)!.label}
          className={`py-1 ${editTextClass(b.type, b.style)}`}
          focusRequest={focusRequest}
          registry={registry}
          onFocus={() => setActiveId(b.id)}
          {...textHandlers(b)}
        />
      );
    } else if (isList(b)) {
      content = (
        <ol className={`space-y-0.5 ${EDIT_BOX_CLASS[b.style.box ?? ''] ?? ''}`}>
          {b.items.map((item, j) => (
            <li key={j} className="flex items-start gap-2">
              <span className="mt-1 w-5 shrink-0 text-right text-sm text-app-text-muted">{b.type === 'ol' ? `${j + 1}.` : '•'}</span>
              <InlineEditable
                editKey={`${b.id}:${j}`}
                text={item}
                label={`List item ${j + 1}`}
                placeholder="List item"
                className={`py-0.5 ${editTextClass(null, { ...b.style, box: undefined })}`}
                focusRequest={focusRequest}
                registry={registry}
                onFocus={() => setActiveId(b.id)}
                {...itemHandlers(b, j)}
              />
            </li>
          ))}
        </ol>
      );
    } else if (b.type === 'img') {
      content = (
        <ImageCard
          block={b as ImageBlock}
          onStart={remember}
          onStyle={(style, structural) => setImageStyle(b.id, style, structural)}
          onField={(field, text) => patchBlock(b.id, (x) => ({ ...x, [field]: text }) as EBlock)}
          onReplace={() => setPicker({ replace: b.id })}
        />
      );
    } else {
      content = <div className="flex h-8 items-center"><hr className="w-full border-app-border" /></div>;
    }

    return (
      <div
        key={b.id}
        data-block-row={b.id}
        tabIndex={b.type === 'img' || b.type === 'hr' ? 0 : undefined}
        onFocus={() => setActiveId(b.id)}
        onClick={() => setActiveId(b.id)}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === e.currentTarget) {
            e.preventDefault();
            deleteBlock(b.id);
          }
        }}
        className={`group relative flex items-start gap-1.5 rounded-lg py-1 pl-1 pr-1 outline-none transition ${selected ? 'bg-brand-500/[0.06] ring-1 ring-brand-500/40' : 'hover:bg-app-bg/70'}`}
      >
        <span
          className="mt-1.5 w-7 shrink-0 select-none text-center text-[11px] font-bold text-app-text-muted/70"
          title={INSERT_OPTIONS.find((o) => o.value === b.type)?.label}
          aria-hidden
        >
          {BADGES[b.type]}
        </span>
        <div className="min-w-0 flex-1">{content}</div>
        <div className={`shrink-0 flex-col gap-0.5 sm:flex-row ${selected ? 'flex' : 'hidden sm:flex sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-60'}`}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => moveBlock(b.id, -1)} disabled={i === 0} className="rounded p-1 text-app-text-muted hover:bg-app-bg hover:text-app-text disabled:opacity-30" aria-label="Move up">
            <ArrowUp size={15} />
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => moveBlock(b.id, 1)} disabled={i === blocks.length - 1} className="rounded p-1 text-app-text-muted hover:bg-app-bg hover:text-app-text disabled:opacity-30" aria-label="Move down">
            <ArrowDown size={15} />
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => duplicateBlock(b.id)} className="rounded p-1 text-app-text-muted hover:bg-app-bg hover:text-app-text" aria-label="Duplicate">
            <Copy size={15} />
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => deleteBlock(b.id)} className="rounded p-1 text-app-text-muted hover:bg-red-500/10 hover:text-red-500" aria-label="Delete">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  };

  const editor = (
    <div className={`space-y-1 p-2 sm:p-3 ${view === 'split' ? 'max-h-[78vh] overflow-y-auto' : ''}`}>
      {blocks.map(blockRow)}
      <div className="flex flex-wrap items-center gap-1.5 px-1 pt-2">
        {INSERT_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => addBlock(o.value)}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-dashed border-app-border px-2.5 text-xs font-medium text-app-text-muted hover:border-brand-500 hover:text-app-text"
          >
            + {o.label}
          </button>
        ))}
      </div>
      <p className="px-1 pt-2 text-[11px] leading-relaxed text-app-text-muted">
        Tips: type <b>##</b> and a space for a heading, <b>-</b> for a list, <b>&gt;</b> for a quote. Ctrl+B bold, Ctrl+I italic. Paste a photo straight into the text to upload it.
      </p>
    </div>
  );

  const viewButton = (v: View, label: string, Icon: typeof Eye, extra = '') => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      aria-label={label}
      title={label}
      className={`${extra || 'inline-flex'} h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold ${view === v ? 'bg-app-card text-app-text shadow-sm' : 'text-app-text-muted'}`}
    >
      <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div ref={rootRef} className="overflow-hidden rounded-xl border border-app-border bg-app-card">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 border-b border-app-border bg-app-card/95 backdrop-blur">
        <div className="flex items-center">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:thin]">
          <ToolButton label="Undo" onClick={undo} disabled={!canUndo}>
            <Undo2 size={16} />
          </ToolButton>
          <Divider />
          <ToolSelect
            label="Block type"
            value={textTools ? active!.type : ''}
            disabled={!textTools}
            options={textTools ? TYPE_OPTIONS : [{ value: '', label: active?.type === 'img' ? 'Photo' : 'Select a block' }]}
            onChange={(v) => setType(v as TextBlockType | ListBlockType)}
            className="w-[8.5rem]"
          />
          <Divider />
          <ToolButton label="Bold (Ctrl+B)" pressed={formats.bold} disabled={!textSelected} onClick={() => command('bold')}>
            <Bold size={16} />
          </ToolButton>
          <ToolButton label="Italic (Ctrl+I)" pressed={formats.italic} disabled={!textSelected} onClick={() => command('italic')}>
            <Italic size={16} />
          </ToolButton>
          <ToolButton label="Strikethrough" pressed={formats.strike} disabled={!textSelected} onClick={() => command('strikeThrough')}>
            <Strikethrough size={16} />
          </ToolButton>
          <ToolButton label="Highlight" pressed={formats.mark} disabled={!textSelected} onClick={() => runInline(toggleHighlight)}>
            <Highlighter size={16} />
          </ToolButton>
          <ToolButton label={formats.link ? 'Edit link' : 'Add link'} pressed={Boolean(formats.link) || linkDraft !== null} disabled={!textSelected} onClick={() => setLinkDraft(formats.link || '')}>
            <LinkIcon size={16} />
          </ToolButton>
          {formats.link && (
            <ToolButton label="Remove link" onClick={removeLink}>
              <Unlink size={16} />
            </ToolButton>
          )}
          <ToolButton label="Clear formatting" disabled={!textSelected} onClick={() => runInline(clearFormatting)}>
            <Eraser size={16} />
          </ToolButton>
          <Divider />
          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as [TextAlign, typeof AlignLeft][]).map(([align, Icon]) => (
            <ToolButton
              key={align}
              label={`Align ${align}`}
              disabled={!textTools}
              pressed={textTools && (activeStyle.align ?? 'left') === align}
              onClick={() => setStyle({ align: align === 'left' ? undefined : align })}
            >
              <Icon size={16} />
            </ToolButton>
          ))}
          <Divider />
          <ToolSelect label="Text size" value={activeStyle.size ?? ''} disabled={!textTools} options={SIZE_OPTIONS} onChange={(v) => setStyle({ size: (v || undefined) as TextStyle['size'] })} />
          <ToolSelect label="Font" value={activeStyle.font ?? ''} disabled={!textTools} options={FONT_OPTIONS} onChange={(v) => setStyle({ font: (v || undefined) as TextStyle['font'] })} />
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-app-border px-1" role="group" aria-label="Text colour">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-pressed={textTools && (activeStyle.color ?? '') === c.value}
                disabled={!textTools}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setStyle({ color: (c.value || undefined) as TextStyle['color'] })}
                className={`h-6 w-6 rounded-full border-2 disabled:opacity-35 ${textTools && (activeStyle.color ?? '') === c.value ? 'border-brand-500' : 'border-transparent'}`}
              >
                <span className="block h-full w-full rounded-full border border-white/40" style={{ background: c.swatch }} />
              </button>
            ))}
          </div>
          <ToolSelect label="Background box" value={activeStyle.box ?? ''} disabled={!textTools} options={BOX_OPTIONS} onChange={(v) => setStyle({ box: (v || undefined) as TextStyle['box'] })} />
          <Divider />
          <ToolButton label="Add a photo" onClick={() => setPicker({ replace: null })}>
            <ImagePlus size={16} />
          </ToolButton>
          <ToolSelect
            label="Add a block"
            value=""
            options={[{ value: '', label: '+ Add…' }, ...INSERT_OPTIONS]}
            onChange={(v) => v && addBlock(v as BlockKind)}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-app-border px-1.5">
          <div className="flex shrink-0 rounded-lg bg-app-bg p-0.5">
            {viewButton('edit', 'Edit', PenLine)}
            {viewButton('split', 'Split', Columns2, 'hidden lg:inline-flex')}
            {viewButton('preview', 'Preview', Eye)}
          </div>
          {view !== 'edit' && (
            <div className="flex shrink-0 rounded-lg bg-app-bg p-0.5">
              <button type="button" onClick={() => setDevice('desktop')} aria-pressed={device === 'desktop'} title="Computer width" aria-label="Preview at computer width" className={`rounded-md p-1.5 ${device === 'desktop' ? 'bg-app-card text-app-text shadow-sm' : 'text-app-text-muted'}`}>
                <Monitor size={15} />
              </button>
              <button type="button" onClick={() => setDevice('phone')} aria-pressed={device === 'phone'} title="Phone width" aria-label="Preview at phone width" className={`rounded-md p-1.5 ${device === 'phone' ? 'bg-app-card text-app-text shadow-sm' : 'text-app-text-muted'}`}>
                <Smartphone size={15} />
              </button>
            </div>
          )}
        </div>
        </div>

        {linkDraft !== null && (
          <div className="flex flex-wrap items-center gap-2 border-t border-app-border px-3 py-2">
            <LinkIcon size={15} className="text-app-text-muted" />
            <input
              autoFocus
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setLinkDraft(null);
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                }
              }}
              placeholder="/delivery, https://…, 0712 345 678 or name@example.com"
              className="h-8 min-w-0 flex-1 rounded-md border border-app-border bg-app-bg px-2 text-sm text-app-text outline-none focus:border-brand-500"
            />
            <button type="button" onClick={applyLink} className="h-8 rounded-md bg-brand-500 px-3 text-xs font-semibold text-slate-950 hover:bg-brand-600">
              {formats.link ? 'Update link' : 'Add link'}
            </button>
            <button type="button" onClick={() => setLinkDraft(null)} className="h-8 rounded-md px-3 text-xs font-semibold text-app-text-muted hover:bg-app-bg">
              Cancel
            </button>
          </div>
        )}
        {uploading !== null && (
          <div className="border-t border-app-border px-3 py-2" aria-live="polite">
            <ProgressBar size="compact" percent={uploading} label="Uploading pasted photo" />
          </div>
        )}
        {notice && (
          <p role="status" className="border-t border-app-border bg-amber-500/10 px-3 py-1.5 text-xs text-app-text">
            {notice}
          </p>
        )}
      </div>

      {view === 'split' ? (
        <div className="grid lg:grid-cols-2">
          <div className="min-w-0 border-r border-app-border">{editor}</div>
          <div className="min-w-0">
            {previewNote && <div className="border-b border-app-border px-3 py-2 text-xs text-app-text-muted">{previewNote}</div>}
            {preview}
          </div>
        </div>
      ) : view === 'edit' ? (
        editor
      ) : (
        <>
          {previewNote && <div className="border-b border-app-border px-3 py-2 text-xs text-app-text-muted">{previewNote}</div>}
          {preview}
        </>
      )}

      <UnifiedUploader
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker?.replace ? 'Change photo' : 'Add a photo'}
        allowedTypes={['image']}
        bucketName="business-logos"
        maxSizeMb={15}
        cropAspect="original"
        outputWidth={1600}
        onUploadSuccess={(src, info) => placePhoto({ src, alt: altFromName(info?.name) })}
      />
    </div>
  );
}
