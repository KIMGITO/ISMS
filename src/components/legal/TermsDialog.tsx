// src/components/legal/TermsDialog.tsx
// Shows the app's Terms of Use. The text is TERMS.md at the repository root, bundled at
// build time, so the file and the app can never say different things.

import { Fragment, type ReactNode } from 'react';
import { useOverlay } from '../../hooks/useOverlay';
import { X } from 'lucide-react';
import termsSource from '../../../TERMS.md?raw';
import { SheetLayer } from '../shared/SheetLayer';

/** "Version 1.0, 14 November 2026", the line under the title. */
export const TERMS_VERSION_LINE = termsSource.split('\n').find((line) => line.startsWith('Version '))?.trim() ?? '';

/** **bold** inside a line. Everything else is plain text, so nothing in the file can inject markup. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-app-text">{part.slice(2, -2)}</strong>
      : <Fragment key={i}>{part}</Fragment>,
  );
}

/** The small part of Markdown TERMS.md uses: #, ## headings, "- " lists and paragraphs. */
function renderTerms(source: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1">
        {list.map((item, i) => <li key={i}>{inline(item)}</li>)}
      </ul>,
    );
    list = [];
  };
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('- ')) { list.push(line.slice(2)); continue; }
    flushList();
    if (!line || line.startsWith('# ')) continue; // the title is shown in the header
    if (line.startsWith('## ')) {
      blocks.push(<h3 key={blocks.length} className="pt-2 text-sm font-bold text-app-text">{line.slice(3)}</h3>);
    } else if (line === TERMS_VERSION_LINE) {
      continue; // shown in the header
    } else {
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flushList();
  return blocks;
}

export function TermsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useOverlay(open, onClose, 'dialog');

  if (!open) return null;
  return (
    <SheetLayer>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-title"
        className="absolute inset-x-0 bottom-0 md:inset-0 md:m-auto md:max-w-2xl md:h-[85vh] max-h-[92vh] flex flex-col bg-app-card md:rounded-2xl rounded-t-2xl shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-app-border">
          <div>
            <h2 id="terms-title" className="text-lg font-bold font-display text-app-text">Terms of Use</h2>
            <p className="text-xs text-app-text-muted">{TERMS_VERSION_LINE}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 -m-1 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 pb-[calc(1rem+var(--inset-bottom,0px))] space-y-2.5 text-sm leading-relaxed text-app-text-muted">
          {renderTerms(termsSource)}
        </div>
      </div>
    </SheetLayer>
  );
}

export default TermsDialog;
