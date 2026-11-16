// A bottom sheet on phones, a centred card on wider screens, for add/edit forms and
// details. The phone's back button closes it.
import React from 'react';
import { X } from 'lucide-react';
import SheetLayer from './SheetLayer';
import { useOverlay } from '../../hooks/useOverlay';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Buttons pinned under the content. */
  footer?: React.ReactNode;
  wide?: boolean;
}

export function FormSheet({ title, subtitle, onClose, children, footer, wide }: Props) {
  useOverlay(true, onClose, 'bottom-sheet');
  return (
    <SheetLayer>
      <div className="fixed inset-0 z-[9000] flex items-end sm:items-center justify-center bg-black/40 sm:p-6" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          className={`w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92dvh] flex flex-col bg-app-card text-app-text rounded-t-3xl sm:rounded-3xl shadow-2xl ring-1 ring-app-border`}
        >
          <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-app-border/70">
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold truncate">{title}</h3>
              {subtitle && <p className="text-xs text-app-text-muted mt-0.5">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-3">{children}</div>
          {footer && (
            <div className="px-5 pt-3 pb-[calc(0.75rem+var(--inset-bottom))] sm:pb-3 border-t border-app-border/70 flex flex-wrap gap-2 justify-end">
              {footer}
            </div>
          )}
        </div>
      </div>
    </SheetLayer>
  );
}

export const fieldClass =
  'w-full bg-app-bg border border-app-border rounded-xl px-3 py-2.5 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500';

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium text-app-text-muted">
      {label}
      <div className="mt-1">{children}</div>
      {hint && <span className="block mt-1 text-[11px] font-normal">{hint}</span>}
    </label>
  );
}

export const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 disabled:opacity-50 cursor-pointer';
export const secondaryBtn =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-app-bg text-app-text ring-1 ring-app-border hover:bg-app-border/40 disabled:opacity-50 cursor-pointer';
export const dangerBtn =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 cursor-pointer';

export default FormSheet;
