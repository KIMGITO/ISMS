// src/components/AppDialog.tsx
// In-app replacement for the browser's alert() and confirm() boxes, which look like a
// web page (and can show the page address as their title). iOS-style alert card.
//
//   if (await appDialog.confirm({ title: 'Delete expense?', confirmLabel: 'Delete', destructive: true })) ...
//   await appDialog.alert({ title: 'Link copied' })
//
// Render <AppDialogHost /> once near the root of the app.

import { AnimatePresence, motion } from 'motion/react';
import { create } from 'zustand';
import { useOverlay } from '../hooks/useOverlay';
import { nativeUiService } from '../core/native/NativeUiService';

interface DialogRequest {
  kind: 'alert' | 'confirm';
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for deleting or undoing something */
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

type DialogOptions = Omit<DialogRequest, 'kind' | 'resolve'>;

const useDialogStore = create<{ queue: DialogRequest[] }>(() => ({ queue: [] }));

function open(kind: DialogRequest['kind'], options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.setState((s) => ({ queue: [...s.queue, { ...options, kind, resolve }] }));
  });
}

export const appDialog = {
  /** Asks a yes/no question. Resolves true when confirmed. */
  confirm: (options: DialogOptions) => open('confirm', options),
  /** Shows a message with one OK button. */
  alert: (options: DialogOptions) => open('alert', options).then(() => undefined),
};

export function AppDialogHost() {
  const current = useDialogStore((s) => s.queue[0]);

  const close = (ok: boolean) => {
    if (!current) return;
    current.resolve(ok);
    useDialogStore.setState((s) => ({ queue: s.queue.slice(1) }));
  };

  // The phone's back button cancels, like a native dialog
  useOverlay(!!current, () => close(false), 'dialog');

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key="app-dialog"
          className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/40 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => close(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby={current.message ? 'app-dialog-message' : undefined}
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close(false);
            }}
            className="w-full max-w-[18rem] rounded-xl bg-app-card/95 backdrop-blur-xl shadow-2xl overflow-hidden text-center"
          >
            <div className="px-4 pt-5 pb-4">
              <h2 id="app-dialog-title" className="text-[15px] font-semibold text-app-text">
                {current.title}
              </h2>
              {current.message && (
                <p id="app-dialog-message" className="mt-1 text-[13px] leading-snug text-app-text-muted whitespace-pre-line">
                  {current.message}
                </p>
              )}
            </div>
            <div className={`grid border-t border-app-border ${current.kind === 'confirm' ? 'grid-cols-2 divide-x divide-app-border' : ''}`}>
              {current.kind === 'confirm' && (
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="min-h-11 text-[15px] text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-app-bg"
                >
                  {current.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                type="button"
                autoFocus
                onClick={() => {
                  if (current.destructive) nativeUiService.hapticError();
                  close(true);
                }}
                className={`min-h-11 text-[15px] font-semibold cursor-pointer hover:bg-app-bg ${
                  current.destructive ? 'text-red-600 dark:text-red-400' : 'text-sky-600 dark:text-sky-400'
                }`}
              >
                {current.confirmLabel || 'OK'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
