// src/features/AboutView.tsx
// What this app is, which build is installed, and a manual update check
// for when the automatic one failed or was missed. Laid out like iOS Settings → About.

import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, Smartphone, Monitor, Globe, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useUpdateStore } from '../stores/updateStore';
import { useBusinessStore } from '../stores/businessStore';
import { updateService } from '../core/native/UpdateService';
import { ShortcutTable } from '../components/ShortcutTable';
import { useAuthStore } from '../stores/authStore';
import { ReportProblemForm } from '../components/ReportProblemForm';
import { TermsDialog, TERMS_VERSION_LINE } from '../components/legal/TermsDialog';

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
  const { status, currentVersion, platform, availableVersion, progress, error, errorCode, lastCheckedAt } = useUpdateStore();
  const { businesses, activeBusinessId } = useBusinessStore();
  const [shortcutsOpen, setShortcutsOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  );
  const business = businesses.find((b) => b.id === activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const canReport = !!business && (role === 'Owner' || role === 'Admin');
  const [termsOpen, setTermsOpen] = useState(false);
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
  if (status === 'failed') statusText = (
    <span className="inline-flex items-start gap-1 text-red-500">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{error}{errorCode && <span className="block text-xs opacity-70 font-mono">Code: {errorCode}</span>}</span>
    </span>
  );

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

  const appGroup = (
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
  );

  const updatesGroup = (
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
  );

  const helpGroup = business && (business.contactPhone || business.contactEmail) ? (
    <Group title="Help" footer="For help with this app, contact your manager.">
      {business.contactPhone && <Row label="Phone">{business.contactPhone}</Row>}
      {business.contactEmail && <Row label="Email">{business.contactEmail}</Row>}
    </Group>
  ) : null;

  const legalGroup = (
    <Group title="Legal">
      <button
        type="button"
        onClick={() => setTermsOpen(true)}
        className="w-full flex items-center justify-between gap-4 px-3 py-3 min-h-12 text-sm text-left cursor-pointer hover:bg-app-bg"
      >
        <span className="inline-flex items-center gap-2 text-app-text"><FileText size={15} aria-hidden="true" /> Terms of Use</span>
        <span className="inline-flex items-center gap-1 text-app-text-muted text-xs">{TERMS_VERSION_LINE.replace(/^Version /, 'v')} <ChevronRight size={15} aria-hidden="true" /></span>
      </button>
    </Group>
  );

  const reportGroup = canReport ? (
    <Group
      title="Report a problem"
      footer="Goes straight to the developer with the app version and screen. Customer details are never included."
    >
      <ReportProblemForm businessId={business.id} />
    </Group>
  ) : null;

  // Phones rarely have a keyboard, so the list starts closed there.
  // On wide screens the list scrolls inside its card so the page itself stays short.
  const shortcutsGroup = (
    <details
      id="keyboard-shortcuts"
      open={shortcutsOpen}
      onToggle={(e) => setShortcutsOpen(e.currentTarget.open)}
      className="group"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-app-text-muted [&::-webkit-details-marker]:hidden">
        Keyboard shortcuts
        <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      {shortcutsOpen && (
        <div className="bg-app-card rounded-lg p-3">
          <ShortcutTable listClassName="lg:max-h-[calc(100dvh-20rem)] lg:overflow-y-auto" />
        </div>
      )}
    </details>
  );

  return (
    <div className="h-full overflow-y-auto px-4 lg:px-6 pt-6 pb-nav bg-app-bg text-app-text">
      <div className="w-full flex flex-col gap-6">
        <header className="flex flex-col sm:flex-row items-center text-center sm:text-left gap-2 sm:gap-4">
          <img src="/logo.png" alt="" className="w-20 h-20 sm:w-14 sm:h-14 rounded-2xl object-cover bg-app-card shadow-sm" />
          <div>
            <h1 className="text-xl font-bold font-display">KayKay's</h1>
            <p className="text-sm text-app-text-muted">Version {currentVersion}</p>
          </div>
        </header>

        {/* One column on phones; side by side on wider screens so less scrolling is needed. */}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 items-start">
          <div className="flex flex-col gap-6 min-w-0">
            {appGroup}
            {updatesGroup}
            {helpGroup}
            {legalGroup}
          </div>
          <div className="min-w-0 md:row-span-2 xl:row-span-1">{shortcutsGroup}</div>
          {reportGroup && <div className="min-w-0">{reportGroup}</div>}
        </div>
        <TermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />

        <p className="text-center text-xs text-app-text-muted">
          © 2026 KayKay's. All rights reserved.
          <br />
          Licensed software: use needs a paid licence. Copying or sharing the app is not allowed.
        </p>
      </div>
    </div>
  );
}
