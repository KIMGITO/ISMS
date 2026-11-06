// src/components/UpdateBar.tsx
// Thin bar across the top of the app while it updates itself.
// Green while downloading; on desktop it restarts once downloaded, but never in the middle of a sale.

import { useEffect, useState } from 'react';
import { Download, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { useUpdateStore } from '../stores/updateStore';
import { useCartStore } from '../stores/cartStore';
import { useUiStore } from '../stores/uiStore';
import { updateService } from '../core/native/UpdateService';

const RESTART_AFTER_SECONDS = 15;

export default function UpdateBar() {
  const { status, availableVersion, progress, error } = useUpdateStore();
  const cartHasItems = useCartStore((s) => s.cart.length > 0);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [postponed, setPostponed] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // Count down to the restart once downloaded, waiting while a sale is open.
  useEffect(() => {
    if (status !== 'ready' || postponed || cartHasItems) {
      setCountdown(null);
      return;
    }
    setCountdown(RESTART_AFTER_SECONDS);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c === null) return c;
        if (c <= 1) {
          clearInterval(timer);
          updateService.restartToUpdate();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status, postponed, cartHasItems]);

  useEffect(() => {
    if (status !== 'ready') setPostponed(false);
  }, [status]);

  const openAbout = () => setActiveTab('about');

  if (status === 'failed' && error && dismissedError !== error) {
    return (
      <div role="alert" className="shrink-0 flex items-center gap-3 px-3 py-2 bg-red-500/10 border-b border-red-500/30 text-sm">
        <AlertTriangle size={16} className="shrink-0 text-red-500" aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate text-app-text">Update failed: {error}</span>
        <button type="button" onClick={openAbout} className="shrink-0 font-bold text-red-600 hover:underline cursor-pointer">
          Try again
        </button>
        <button type="button" onClick={() => setDismissedError(error)} aria-label="Dismiss" className="shrink-0 p-1 text-app-text-muted cursor-pointer">
          <X size={14} />
        </button>
      </div>
    );
  }

  if (status === 'needs-permission') {
    return (
      <div role="status" className="shrink-0 flex items-center gap-3 px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 text-sm">
        <AlertTriangle size={16} className="shrink-0 text-amber-600" aria-hidden="true" />
        <span className="flex-1 min-w-0 text-app-text">Allow KayKay's to install updates, then tap Install.</span>
        <button
          type="button"
          onClick={() => updateService.installAndroid()}
          className="shrink-0 min-h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
        >
          Install
        </button>
      </div>
    );
  }

  if (status !== 'downloading' && status !== 'ready' && status !== 'installing') return null;

  const percent = status === 'downloading' ? progress : 100;
  let text = `Updating to version ${availableVersion}`;
  if (status === 'downloading') text += percent !== null ? ` · ${percent}%` : '…';
  if (status === 'installing') text = `Installing version ${availableVersion}…`;
  if (status === 'ready') {
    text = cartHasItems
      ? `Version ${availableVersion} is ready. It installs when this sale is finished.`
      : postponed
        ? `Version ${availableVersion} is ready to install.`
        : `Version ${availableVersion} is ready. Restarting in ${countdown ?? RESTART_AFTER_SECONDS}s…`;
  }

  return (
    <div role="status" aria-live="polite" className="shrink-0 relative bg-emerald-500/10 border-b border-emerald-500/30">
      <div className="flex items-center gap-3 px-3 py-1.5 text-xs sm:text-sm">
        {status === 'downloading' ? (
          <Download size={15} className="shrink-0 text-emerald-600 animate-pulse" aria-hidden="true" />
        ) : (
          <RefreshCw size={15} className={`shrink-0 text-emerald-600 ${status === 'installing' ? 'animate-spin' : ''}`} aria-hidden="true" />
        )}
        <span className="flex-1 min-w-0 truncate font-medium text-app-text">{text}</span>
        {status === 'ready' && (
          <>
            <button
              type="button"
              onClick={() => updateService.restartToUpdate()}
              className="shrink-0 min-h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              Restart now
            </button>
            {!postponed && !cartHasItems && (
              <button type="button" onClick={() => setPostponed(true)} className="shrink-0 text-xs font-semibold text-app-text-muted hover:underline cursor-pointer">
                Later
              </button>
            )}
          </>
        )}
      </div>
      <div className="h-1 w-full bg-emerald-500/15" aria-hidden="true">
        <div
          className={`h-full bg-emerald-500 transition-all duration-300 ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
