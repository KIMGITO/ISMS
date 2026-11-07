// src/features/AboutView.tsx
// What this app is, which version is installed, and a manual update check
// for when the automatic one failed or was missed.

import { useEffect } from 'react';
import {
  Info, RefreshCw, CheckCircle2, AlertTriangle, Download, ExternalLink, Smartphone, Monitor, Globe, Building, Scale,
} from 'lucide-react';
import { useUpdateStore } from '../stores/updateStore';
import { useBusinessStore } from '../stores/businessStore';
import { updateService, RELEASES_PAGE } from '../core/native/UpdateService';

const card = 'bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 shadow-sm';

function openExternal(url: string) {
  const tauri = (window as any).__TAURI__;
  if (tauri?.core?.invoke) tauri.core.invoke('open_url', { url });
  else window.open(url, '_blank', 'noopener');
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const PLATFORM_LABEL = {
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  android: 'Android',
  web: 'Web browser',
} as const;

export default function AboutView() {
  const { status, currentVersion, platform, availableVersion, notes, progress, error, lastCheckedAt } = useUpdateStore();
  const { businesses, activeBusinessId } = useBusinessStore();
  const business = businesses.find((b) => b.id === activeBusinessId);
  const canUpdate = updateService.canUpdate();
  const isBusy = status === 'checking' || status === 'downloading' || status === 'installing';
  const PlatformIcon = platform === 'android' ? Smartphone : platform === 'web' ? Globe : Monitor;

  useEffect(() => {
    updateService.init();
  }, []);

  let statusLine: React.ReactNode = canUpdate
    ? 'Updates install automatically when you are connected to the internet.'
    : 'The web version is always the latest; reloading the page updates it.';
  if (status === 'checking') statusLine = 'Checking for updates…';
  if (status === 'up-to-date') statusLine = <span className="text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 size={14} /> You have the latest version.</span>;
  if (status === 'downloading') statusLine = `Downloading version ${availableVersion}${progress !== null ? ` · ${progress}%` : '…'}`;
  if (status === 'ready') statusLine = `Version ${availableVersion} is downloaded and ready to install.`;
  if (status === 'installing') statusLine = platform === 'android' ? 'Finish the install in the window Android opened.' : `Installing version ${availableVersion}…`;
  if (status === 'needs-permission') statusLine = <span className="text-amber-600">{error}</span>;
  if (status === 'failed') statusLine = <span className="text-red-500 inline-flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</span>;

  return (
    <div className="h-full overflow-y-auto p-4 pb-nav bg-app-bg text-app-text">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <header className="flex items-center gap-4 pt-2">
          <img src="/logo.png" alt="" className="w-16 h-16 rounded-2xl object-cover border border-app-border bg-app-card" />
          <div className="min-w-0">
            <h1 className="text-xl font-black font-display">KayKay's</h1>
            <p className="text-sm text-app-text-muted">Sales, stock, customers and payments for your shop.</p>
          </div>
        </header>

        <section className={card}>
          <h2 className="text-sm font-bold flex items-center gap-2 mb-3"><Info size={16} className="text-amber-500" /> This app</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-app-text-muted">Version</dt>
            <dd className="font-bold font-mono">{currentVersion}</dd>
            <dt className="text-app-text-muted">Running on</dt>
            <dd className="inline-flex items-center gap-1.5"><PlatformIcon size={14} /> {PLATFORM_LABEL[platform]}</dd>
            {__APP_COMMIT__ && (
              <>
                <dt className="text-app-text-muted">Build</dt>
                <dd className="font-mono">{__APP_COMMIT__} · {new Date(__BUILD_DATE__).toLocaleDateString()}</dd>
              </>
            )}
          </dl>
        </section>

        <section className={card}>
          <h2 className="text-sm font-bold flex items-center gap-2 mb-2"><Download size={16} className="text-emerald-600" /> Updates</h2>
          <p className="text-sm mb-1">{statusLine}</p>
          {canUpdate && <p className="text-xs text-app-text-muted mb-3">Last checked: {formatWhen(lastCheckedAt)}</p>}

          {status === 'downloading' && (
            <div className="h-2 w-full rounded-full bg-emerald-500/15 overflow-hidden mb-3" aria-hidden="true">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress ?? 30}%` }} />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canUpdate && status !== 'ready' && status !== 'needs-permission' && (
              <button
                type="button"
                onClick={() => updateService.checkAndUpdate()}
                disabled={isBusy}
                className="min-h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={16} className={status === 'checking' ? 'animate-spin' : ''} />
                {status === 'failed' ? 'Try again' : 'Check for updates'}
              </button>
            )}
            {status === 'ready' && (
              <button
                type="button"
                onClick={() => (platform === 'android' ? updateService.installAndroid() : updateService.restartToUpdate())}
                className="min-h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold cursor-pointer"
              >
                {platform === 'android' ? 'Install update' : 'Restart and install'}
              </button>
            )}
            {(status === 'needs-permission' || (status === 'installing' && platform === 'android')) && (
              <button
                type="button"
                onClick={() => updateService.installAndroid()}
                className="min-h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold cursor-pointer"
              >
                Install update
              </button>
            )}
            <button
              type="button"
              onClick={() => openExternal(RELEASES_PAGE)}
              className="min-h-11 px-4 rounded-xl border border-app-border text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <ExternalLink size={14} /> All versions
            </button>
          </div>

          {notes && availableVersion && (
            <div className="mt-4 border-t border-app-border/50 pt-3">
              <h3 className="text-xs font-bold text-app-text-muted mb-1">What's new in {availableVersion}</h3>
              <p className="text-sm whitespace-pre-line">{notes.replace(/^#+\s*/gm, '').replace(/\*\*/g, '')}</p>
            </div>
          )}
        </section>

        {business && (
          <section className={card}>
            <h2 className="text-sm font-bold flex items-center gap-2 mb-2"><Building size={16} className="text-amber-500" /> {business.name}</h2>
            <p className="text-sm text-app-text-muted">
              For help with this app, contact your manager
              {business.contactPhone && <> or call <span className="font-semibold text-app-text">{business.contactPhone}</span></>}
              {business.contactEmail && <> or email <span className="font-semibold text-app-text">{business.contactEmail}</span></>}.
            </p>
          </section>
        )}

        <section className={card}>
          <h2 className="text-sm font-bold flex items-center gap-2 mb-2"><Scale size={16} className="text-app-text-muted" /> Legal</h2>
          <p className="text-sm text-app-text-muted">© 2026 KayKay's. All rights reserved. Proprietary software.</p>
        </section>
      </div>
    </div>
  );
}
