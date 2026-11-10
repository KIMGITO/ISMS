import { ReactNode } from 'react';

/**
 * Renders the small text format used by guides and info pages:
 *   ## Heading        ### Smaller heading
 *   - list item       1. numbered item
 *   **bold**          [label](/path or https://…)
 * Everything becomes React nodes, so stored text can never inject HTML.
 */

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:\/|https:\/\/|mailto:|tel:)[^)\s]*)\)/g;

export function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1]) {
      nodes.push(<strong key={match.index} className="font-semibold text-ink">{match[1]}</strong>);
    } else {
      const href = match[3];
      const external = href.startsWith('https://');
      nodes.push(
        <a
          key={match.index}
          href={href}
          className="font-medium text-brand-deep underline underline-offset-2 hover:text-ink"
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {match[2]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function RichText({ body, className = '' }: { body: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(
      list.ordered
        ? <ol key={blocks.length} className="list-decimal space-y-1.5 pl-6">{items}</ol>
        : <ul key={blocks.length} className="list-disc space-y-1.5 pl-6">{items}</ul>,
    );
    list = null;
  };

  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*] (.*)/.exec(line);
    const numbered = /^\d+[.)] (.*)/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (line.startsWith('### ')) {
      blocks.push(<h3 key={blocks.length} className="pt-2 text-lg font-semibold">{inline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={blocks.length} className="pt-4 text-2xl">{inline(line.slice(3))}</h2>);
    } else if (line) {
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className={`rich-text space-y-4 leading-relaxed text-ink/85 ${className}`}>{blocks}</div>;
}

/** Splits text at "## " headings, for pages shown as sections or questions. */
export function splitSections(body: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) sections.push({ heading: line.slice(3), body: '' });
    else if (sections.length) sections[sections.length - 1].body += `${raw}\n`;
    else if (line) sections.push({ heading: '', body: `${raw}\n` });
  }
  return sections;
}

export { plainText } from './infoPages';
