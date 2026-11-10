// The text format used by website pages and guides, and the editor in the staff app.
// It is plain text, one block per line, so it stays safe (it is turned into React
// nodes, never HTML) and old pages written by hand keep working:
//
//   ## Heading            ### Smaller heading        > Quote        ---  (divider)
//   - list item           1. numbered item
//   **bold**  _italic_  ~~struck~~  ==highlight==  [label](/path or https://…)
//   ![Photo description](https://…/photo.webp "Caption") {ratio=16:9 x=50 y=30 zoom=1.2 width=md align=right}
//
// Any text line can end with a style tag: {align=center size=lg font=serif color=accent box=sand}.
// Only the keys and values listed below are accepted; anything else stays as text.
// Plain data with no browser APIs, because scripts/prerender.ts imports it.

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type TextSize = 'sm' | 'lg' | 'xl';
export type TextFont = 'sans' | 'serif' | 'mono';
export type TextColor = 'muted' | 'accent' | 'orange' | 'green';
export type TextBox = 'sand' | 'amber' | 'green' | 'outline';

export interface TextStyle {
  align?: TextAlign;
  size?: TextSize;
  font?: TextFont;
  color?: TextColor;
  box?: TextBox;
}

export type ImageRatio = 'auto' | '1:1' | '4:3' | '3:2' | '16:9' | '21:9' | '3:4' | '4:5' | '2:3';
export type ImageWidth = 'sm' | 'md' | 'lg' | 'full';
export type ImageAlign = 'left' | 'center' | 'right';

export interface ImageStyle {
  ratio: ImageRatio;
  /** Which part of the photo stays in view when it is cropped, 0 to 100 from the left/top. */
  x: number;
  y: number;
  /** 1 to 3. */
  zoom: number;
  width: ImageWidth;
  /** Left or right with a width below full lets text flow beside the photo. */
  align: ImageAlign;
}

export type TextBlockType = 'p' | 'h2' | 'h3' | 'quote';
export type ListBlockType = 'ul' | 'ol';

export type Block =
  | { type: TextBlockType; text: string; style: TextStyle }
  | { type: ListBlockType; items: string[]; style: TextStyle }
  | { type: 'img'; src: string; alt: string; caption: string; style: ImageStyle }
  | { type: 'hr' };

export const TEXT_OPTIONS = {
  align: ['left', 'center', 'right', 'justify'],
  size: ['sm', 'lg', 'xl'],
  font: ['sans', 'serif', 'mono'],
  color: ['muted', 'accent', 'orange', 'green'],
  box: ['sand', 'amber', 'green', 'outline'],
} as const satisfies Record<keyof TextStyle, readonly string[]>;

export const IMAGE_RATIOS: ImageRatio[] = ['auto', '16:9', '3:2', '4:3', '1:1', '4:5', '3:4', '2:3', '21:9'];
export const IMAGE_WIDTHS: ImageWidth[] = ['sm', 'md', 'lg', 'full'];
export const DEFAULT_IMAGE_STYLE: ImageStyle = { ratio: 'auto', x: 50, y: 50, zoom: 1, width: 'full', align: 'center' };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// Style tags
// ---------------------------------------------------------------------------

const STYLE_TAG = /\s*\{((?:\s*[a-z]+=[A-Za-z0-9:.-]+)+)\s*\}\s*$/;

function readPairs(tag: string): [string, string][] {
  return tag.trim().split(/\s+/).map((pair) => pair.split('=') as [string, string]);
}

/** Splits a trailing style tag off a line, only when every key and value is known. */
function takeTextStyle(line: string): { text: string; style: TextStyle } {
  const match = STYLE_TAG.exec(line);
  if (!match) return { text: line, style: {} };
  const style: Record<string, string> = {};
  for (const [key, value] of readPairs(match[1])) {
    const allowed = (TEXT_OPTIONS as Record<string, readonly string[]>)[key];
    if (!allowed?.includes(value)) return { text: line, style: {} };
    style[key] = value;
  }
  return { text: line.slice(0, match.index), style: style as TextStyle };
}

function readImageStyle(tag: string | undefined): ImageStyle {
  const style = { ...DEFAULT_IMAGE_STYLE };
  if (!tag) return style;
  for (const [key, value] of readPairs(tag)) {
    const number = Number(value);
    if (key === 'ratio' && (IMAGE_RATIOS as string[]).includes(value)) style.ratio = value as ImageRatio;
    else if (key === 'width' && (IMAGE_WIDTHS as string[]).includes(value)) style.width = value as ImageWidth;
    else if (key === 'align' && ['left', 'center', 'right'].includes(value)) style.align = value as ImageAlign;
    else if ((key === 'x' || key === 'y') && Number.isFinite(number)) style[key] = clamp(Math.round(number), 0, 100);
    else if (key === 'zoom' && Number.isFinite(number)) style.zoom = clamp(Math.round(number * 10) / 10, 1, 3);
  }
  return style;
}

function writeTag(pairs: [string, string | number | undefined][]): string {
  const parts = pairs.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`);
  return parts.length ? ` {${parts.join(' ')}}` : '';
}

const textTag = (style: TextStyle) =>
  writeTag((Object.keys(TEXT_OPTIONS) as (keyof TextStyle)[]).map((key) => [key, style[key]]));

function imageTag(style: ImageStyle): string {
  const d = DEFAULT_IMAGE_STYLE;
  return writeTag([
    ['ratio', style.ratio !== d.ratio ? style.ratio : undefined],
    ['x', style.x !== d.x ? style.x : undefined],
    ['y', style.y !== d.y ? style.y : undefined],
    ['zoom', style.zoom !== d.zoom ? style.zoom : undefined],
    ['width', style.width !== d.width ? style.width : undefined],
    ['align', style.align !== d.align ? style.align : undefined],
  ]);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const IMAGE_LINE = /^!\[([^\]\n]*)\]\((https:\/\/[^\s)"]+)(?:\s+"([^"\n]*)")?\)(?:\s*\{([^}]*)\})?\s*$/;

export function parseDocument(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of (body ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const image = IMAGE_LINE.exec(line);
    if (image) {
      blocks.push({ type: 'img', alt: image[1].trim(), src: image[2], caption: (image[3] ?? '').trim(), style: readImageStyle(image[4]) });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      blocks.push({ type: 'hr' });
      continue;
    }

    const bullet = /^[-*] (.*)/.exec(line);
    const numbered = /^\d+[.)] (.*)/.exec(line);
    if (bullet || numbered) {
      const type: ListBlockType = numbered ? 'ol' : 'ul';
      const { text, style } = takeTextStyle((bullet ?? numbered)![1]);
      const last = blocks[blocks.length - 1];
      if (last && last.type === type) last.items.push(text.trim());
      else blocks.push({ type, items: [text.trim()], style });
      continue;
    }

    const prefixed = /^(###|##|>) (.*)/.exec(line);
    const type: TextBlockType = prefixed ? ({ '###': 'h3', '##': 'h2', '>': 'quote' } as const)[prefixed[1] as '###' | '##' | '>'] : 'p';
    const { text, style } = takeTextStyle(prefixed ? prefixed[2] : line);
    if (text.trim()) blocks.push({ type, text: text.trim(), style });
  }
  return blocks;
}

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

export function serializeBlock(block: Block): string {
  switch (block.type) {
    case 'hr':
      return '---';
    case 'img': {
      const alt = oneLine(block.alt).replace(/[[\]]/g, '');
      const caption = oneLine(block.caption).replace(/"/g, '”');
      return `![${alt}](${block.src}${caption ? ` "${caption}"` : ''})${imageTag(block.style)}`;
    }
    case 'ul':
    case 'ol': {
      const items = block.items.map(oneLine).filter(Boolean);
      return items
        .map((item, i) => `${block.type === 'ol' ? `${i + 1}.` : '-'} ${item}${i === 0 ? textTag(block.style) : ''}`)
        .join('\n');
    }
    default: {
      const text = oneLine(block.text);
      if (!text) return '';
      const prefix = { p: '', h2: '## ', h3: '### ', quote: '> ' }[block.type];
      return `${prefix}${text}${textTag(block.style)}`;
    }
  }
}

export function serializeDocument(blocks: Block[]): string {
  return blocks.map(serializeBlock).filter(Boolean).join('\n');
}

/** Lines that start a new page section ("## " headings), with their style tag split off. */
export function readHeadingLine(line: string): { text: string; style: TextStyle } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('## ')) return null;
  const { text, style } = takeTextStyle(trimmed.slice(3));
  return { text: text.trim(), style };
}

// ---------------------------------------------------------------------------
// Inline formatting
// ---------------------------------------------------------------------------

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 's' | 'mark'; c: InlineNode[] }
  | { t: 'a'; href: string; c: InlineNode[] };

export const SAFE_LINK = /^(?:\/|https:\/\/|mailto:|tel:)[^\s)]*$/;

const INLINE =
  /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:\/|https:\/\/|mailto:|tel:)[^)\s]*)\)|==([^=]+)==|~~([^~]+)~~|(?<![A-Za-z0-9_])_([^_]+)_(?![A-Za-z0-9_])/g;

export function parseInline(text: string, depth = 0): InlineNode[] {
  if (depth > 6) return [{ t: 'text', v: text }];
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ t: 'text', v: text.slice(last, index) });
    const inner = (value: string) => parseInline(value, depth + 1);
    if (match[1] !== undefined) nodes.push({ t: 'b', c: inner(match[1]) });
    else if (match[2] !== undefined) nodes.push({ t: 'a', href: match[3], c: inner(match[2]) });
    else if (match[4] !== undefined) nodes.push({ t: 'mark', c: inner(match[4]) });
    else if (match[5] !== undefined) nodes.push({ t: 's', c: inner(match[5]) });
    else nodes.push({ t: 'i', c: inner(match[6]) });
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push({ t: 'text', v: text.slice(last) });
  return nodes;
}

const inlinePlain = (nodes: InlineNode[]): string =>
  nodes.map((n) => (n.t === 'text' ? n.v : inlinePlain(n.c))).join('');

/** Plain text, for search, descriptions and the prerendered pages. Photos give their caption. */
export function plainText(body: string): string {
  return parseDocument(body)
    .map((block) => {
      if (block.type === 'hr') return '';
      if (block.type === 'img') return block.caption;
      const text = 'items' in block ? block.items.join(' ') : block.text;
      return inlinePlain(parseInline(text));
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
