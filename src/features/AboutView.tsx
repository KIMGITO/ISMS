// src/features/AboutView.tsx
// What this app is, which build is installed, and a manual update check
// for when the automatic one failed or was missed. Laid out like iOS Settings → About.

import { useEffect, type ReactNode } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, Smartphone, Monitor, Globe } from 'lucide-react';
import { useUpdateStore } from '../stores/updateStore';
import { useBusinessStore } from '../stores/businessStore';
import { updateService } from '../core/native/UpdateService';

const PLATFORM_LABEL = {
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  android: 'Android',
  web: 'Web browser',
} as const;

function formatDate(iso: string | null, withTime = true): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

/** A titled group of rows, like an iOS settings section. */
function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section>
      {title && <h2 className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-app-text-muted">{title}</h2>}
      <div className="bg-app-card rounded-lg overflow-hidden divide-y divide-app-border">{children}</div>
      {footer && <p className="px-3 pt-1.5 text-xs text-app-text-muted">{footer}</p>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-3 min-h-12 text-sm">
      <span className="text-app-text">{label}</span>
      <span className="text-app-text-muted text-right min-w-0 truncate">{children}</span>
    </div>
  );
}

export default function AboutView() {
  const { status, currentVersion, platform, availableVersion, progress, error, lastCheckedAt } = useUpdateStore();
  const { businesses, activeBusinessId } = useBusinessStore();
  const business = businesses.find((b) => b.id === activeBusinessId);
  const canUpdate = updateService.canUpdate();
  const isBusy = status === 'checking' || status === 'downloading' || status === 'installing';
  const PlatformIcon = platform === 'android' ? Smartphone : platform === 'web' ? Globe : Monitor;

  useEffect(() => {
    updateService.init();
  }, []);

  // One short line for where the update stands
  let statusText: ReactNode = canUpdate ? 'Updates install automatically.' : 'Reload the page to get the latest version.';
  if (status === 'checking') statusText = 'Checking…';
  if (status === 'up-to-date') statusText = <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={14} /> Up to date</span>;
  if (status === 'downloading') statusText = `Downloading ${availableVersion}${progress !== null ? ` · ${progress}%` : '…'}`;
  if (status === 'ready') statusText = `Version ${availableVersion} is ready`;
  if (status === 'installing') statusText = platform === 'android' ? 'Finish the install in the window Android opened.' : `Installing ${availableVersion}…`;
  if (status === 'needs-permission') statusText = <span className="text-amber-600">{error}</span>;
  if (status === 'failed') statusText = <span className="inline-flex items-start gap-1 text-red-500"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</span>;

  // The single action that fits the current state
  let action: { label: string; run: () => void } | null = null;
  if (canUpdate) {
    if (status === 'ready') {
      action = platform === 'android'
        ? { label: 'Install update', run: () => updateService.installAndroid() }
        : { label: 'Restart and install', run: () => updateService.restartToUpdate() };
    } else if (status === 'needs-permission' || (status === 'installing' && platform === 'android')) {
      action = { label: 'Install update', run: () => updateService.installAndroid() };
    } else {
      action = { label: status === 'failed' ? 'Try again' : 'Check for updates', run: () => updateService.checkAndUpdate() };
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 pt-6 pb-nav bg-app-bg text-app-text">
      <div className="max-w-xl mx-auto flex flex-col gap-6">
        <header className="flex flex-col items-center text-center gap-2">
          <img src="/logo.png" alt="" className="w-20 h-20 rounded-2xl object-cover bg-app-card shadow-sm" />
          <div>
            <h1 className="text-xl font-bold font-display">KayKay's</h1>
            <p className="text-sm text-app-text-muted">Version {currentVersion}</p>
          </div>
        </header>

        <Group title="This app">
          <Row label="Version"><span className="font-mono">{currentVersion}</span></Row>
          <Row label="Build number">
            <span className="font-mono">
              {__BUILD_NUMBER__ || 'Local build'}
              {__APP_COMMIT__ && <span className="opacity-60"> · {__APP_COMMIT__}</span>}
            </span>
          </Row>
          <Row label="Build date">{formatDate(__BUILD_DATE__)}</Row>
          <Row label="Platform"><span className="inline-flex items-center gap-1.5"><PlatformIcon size={14} /> {PLATFORM_LABEL[platform]}</span></Row>
        </Group>

        <Group
          title="Updates"
          footer={canUpdate ? `Last checked ${formatDate(lastCheckedAt)}` : undefined}
        >
          <div className="px-3 py-3 text-sm">{statusText}</div>
          {status === 'downloading' && (
            <div className="px-3 pb-3" aria-hidden="true">
              <div className="h-1.5 w-full rounded-full bg-emerald-500/15 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress ?? 30}%` }} />
              </div>
            </div>
          )}
          {action && (
            <button
              type="button"
              onClick={action.run}
              disabled={isBusy}
              className="w-full px-3 py-3 min-h-12 text-left text-sm font-semibold text-emerald-600 inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer hover:bg-app-bg"
            >
              <RefreshCw size={15} className={status === 'checking' ? 'animate-spin' : ''} aria-hidden="true" />
              {action.label}
            </button>
          )}
        </Group>

        {business && (business.contactPhone || business.contactEmail) && (
          <Group title="Help" footer="For help with this app, contact your manager.">
            {business.contactPhone && <Row label="Phone">{business.contactPhone}</Row>}
            {business.contactEmail && <Row label="Email">{business.contactEmail}</Row>}
          </Group>
        )}

        <p className="text-center text-xs text-app-text-muted">© 2026 KayKay's. All rights reserved.</p>
      </div>
    </div>
  );
}
