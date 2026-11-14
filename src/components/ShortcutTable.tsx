// Keyboard shortcuts this person's role can use, with a search and a "where" filter.
// Used in About this app (all screens) and the "?" help (the current screen).
import { Fragment, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Keyboard, Search, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useOverlay } from '../hooks/useOverlay';
import { scopeLabel, shortcutsFor, type ShortcutScope } from '../utils/shortcuts';

/** "G then H" → [G] then [H]; "Ctrl+K" → [Ctrl]+[K]; "F9 Ctrl+Enter" → two choices. */
function Keys({ keys }: { keys: string }) {
  const kbd = 'inline-block min-w-6 px-1.5 py-0.5 rounded border border-app-border bg-app-bg text-[11px] font-mono font-semibold text-app-text text-center';
  if (keys.includes(' then ')) {
    const [a, b] = keys.split(' then ');
    return <span className="inline-flex items-center gap-1 whitespace-nowrap"><kbd className={kbd}>{a}</kbd><span className="text-[11px] text-app-text-muted">then</span><kbd className={kbd}>{b}</kbd></span>;
  }
  const choices = keys === '+ −' || keys === '↑ ↓' || keys === '↑ ↓ Enter' ? [keys] : keys.split(' ');
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {choices.map((choice, i) => (
        <Fragment key={choice}>
          {i > 0 && <span className="text-[11px] text-app-text-muted">or</span>}
          <kbd className={kbd}>{choice.split('+').filter(Boolean).join(' + ') || choice}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

interface TableProps {
  /** Only these places (the help window passes the current screen and "everywhere"). */
  scopes?: ShortcutScope[];
  autoFocus?: boolean;
  /** Extra classes for the list's scroll box, e.g. a max height so a wide page doesn't grow. */
  listClassName?: string;
}

export function ShortcutTable({ scopes, autoFocus, listClassName = '' }: TableProps) {
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const [query, setQuery] = useState('');
  const [where, setWhere] = useState<ShortcutScope | 'all'>('all');

  const allowed = useMemo(
    () => shortcutsFor(role).filter((s) => !scopes || scopes.includes(s.scope)),
    [role, scopes?.join()],
  );
  const places = useMemo(() => Array.from(new Set(allowed.map((s) => s.scope))), [allowed]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allowed.filter(
      (s) =>
        (where === 'all' || s.scope === where) &&
        (!q || [s.action, s.keys, scopeLabel(s.scope), ...(s.keywords || [])].some((t) => t.toLowerCase().includes(q))),
    );
  }, [allowed, query, where]);

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search shortcuts</span>
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-app-text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions or keys"
            className="w-full bg-app-bg text-app-text text-sm pl-8 pr-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>
        {places.length > 1 && (
          <select
            value={where}
            onChange={(e) => setWhere(e.target.value as ShortcutScope | 'all')}
            aria-label="Where the shortcut works"
            className="bg-app-bg text-app-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="all">All screens</option>
            {places.map((p) => <option key={p} value={p}>{scopeLabel(p)}</option>)}
          </select>
        )}
      </div>

      <div className={`overflow-x-auto rounded-lg ${listClassName}`}>
        <table className="w-full text-sm">
          <thead className={listClassName ? 'sticky top-0 bg-app-card' : undefined}>
            <tr className="text-left text-xs text-app-text-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">Keys</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Action</th>
              {where === 'all' && places.length > 1 && <th scope="col" className="py-1.5 font-medium">Where</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border/60">
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="py-2 pr-3 align-top"><Keys keys={s.keys} /></td>
                <td className="py-2 pr-3 align-top text-app-text">{s.action}</td>
                {where === 'all' && places.length > 1 && <td className="py-2 align-top text-xs text-app-text-muted whitespace-nowrap">{scopeLabel(s.scope)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-6 text-center text-sm text-app-text-muted">No shortcuts match.</p>}
      </div>
      <p className="text-xs text-app-text-muted">
        Shortcuts don't work while you're typing in a box, apart from F-keys, Ctrl+K and Esc. You only see the ones your role can use.
      </p>
    </div>
  );
}

/** The "?" window: shortcuts for the screen you're on, plus the ones that work everywhere. */
export function ShortcutHelp({ open, screen, onClose }: { open: boolean; screen: string; onClose: () => void }) {
  useOverlay(open, onClose, 'dialog');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            className="w-full sm:max-w-xl max-h-[85dvh] overflow-y-auto bg-app-card text-app-text rounded-t-2xl sm:rounded-2xl shadow-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold flex items-center gap-2"><Keyboard size={18} /> Keyboard shortcuts</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="p-2 -m-1 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer"><X size={18} /></button>
            </div>
            <ShortcutTable scopes={[screen as ShortcutScope, 'everywhere', ...(screen === 'sell' || screen === 'pos' ? ['sales' as const] : [])]} autoFocus />
            <p className="mt-2 text-xs text-app-text-muted">Every shortcut is listed in About this app.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ShortcutTable;
