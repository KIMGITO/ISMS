// The Website workspace (website engine phase 4): every screen that shapes the website, beside
// a sidebar (a scrolling row on phones). The top bar shows whether the draft differs from the
// live website and holds Preview, Throw away and Publish. Opening it needs business.update; the
// database checks the same permission on every read and write (20261206002).
import React, { useEffect, useState } from 'react';
import {
  BarChart3, Brush, ExternalLink, FileText, Globe, Home, Image, LayoutGrid, Menu, Palette, RefreshCw, Search, Send, Trash2,
} from 'lucide-react';
import { useBusinessStore } from '../../stores/businessStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { cardClass, inputClass, primaryClass, secondaryClass } from './ui';
import { useReadiness } from './useReadiness';
import { useWebsiteDraft } from './useWebsiteDraft';
import OverviewScreen from './OverviewScreen';
import BrandScreen from './BrandScreen';
import DesignScreen from './DesignScreen';
import PagesScreen from './PagesScreen';
import HomeScreen from './HomeScreen';
import ContentScreen from './ContentScreen';
import MenuScreen from './MenuScreen';
import SeoScreen from './SeoScreen';
import PublishingScreen, { usePreview } from './PublishingScreen';
import StatsScreen from './StatsScreen';

export type WebsiteScreenId = 'overview' | 'brand' | 'design' | 'home' | 'pages' | 'content' | 'menu' | 'seo' | 'publishing' | 'stats';

const SCREENS: { id: WebsiteScreenId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'brand', label: 'Brand', icon: Palette },
  { id: 'design', label: 'Design', icon: Brush },
  { id: 'home', label: 'Home page', icon: Home },
  { id: 'pages', label: 'Pages', icon: FileText },
  { id: 'content', label: 'Content', icon: Image },
  { id: 'menu', label: 'Menu', icon: Menu },
  { id: 'seo', label: 'Search engines', icon: Search },
  { id: 'publishing', label: 'Address & publishing', icon: Globe },
  { id: 'stats', label: 'Statistics', icon: BarChart3 },
];

const time = (iso: string) => new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function PublishBar({ go }: { go: (screen: WebsiteScreenId) => void }) {
  const { readiness } = useReadiness();
  const blockers = readiness?.blockers ?? [];
  const draft = useWebsiteDraft((s) => s.draft!);
  const busy = useWebsiteDraft((s) => s.busy);
  const conflict = useWebsiteDraft((s) => s.conflict);
  const dirty = useWebsiteDraft((s) => s.dirtyParts.length > 0);
  const { publish, discard, load, businessId } = useWebsiteDraft.getState();
  const showToast = useNotificationStore((s) => s.showToast);
  const preview = usePreview();
  const [mode, setMode] = useState<'idle' | 'publish' | 'discard'>('idle');
  const [note, setNote] = useState('');

  const status = draft.changed
    ? `Changes not published yet${draft.savedAt ? `, saved ${time(draft.savedAt)}${draft.savedBy ? ` by ${draft.savedBy}` : ''}` : ''}.`
    : draft.published
      ? `Live: version ${draft.published.number}, ${time(draft.published.at)}${draft.published.by ? ` by ${draft.published.by}` : ''}.`
      : 'Live. Nothing published from here yet.';

  const doPublish = async () => {
    const result = await publish(note);
    if (result.ok) {
      setMode('idle');
      setNote('');
      showToast('Website', `Published as version ${result.number}. Visitors see it within about 5 minutes.`, undefined, 'success');
    } else showToast('Website', result.message ?? 'Could not publish.', undefined, 'error');
  };
  const doDiscard = async () => {
    const result = await discard();
    setMode('idle');
    if (result.ok) showToast('Website', 'Draft thrown away. The editor shows the live website again.', undefined, 'success');
    else showToast('Website', result.message ?? 'Could not throw the draft away.', undefined, 'error');
  };

  return (
    <div className={`${cardClass} space-y-2`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-app-text" role="status">
          <span className={`size-2.5 shrink-0 rounded-full ${draft.changed ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden />
          {status}
          {dirty && <span className="text-amber-600">This screen has unsaved edits.</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryClass} disabled={preview.opening} onClick={preview.open}><ExternalLink size={15} /> Preview</button>
          {draft.changed && <button type="button" className={secondaryClass} disabled={busy !== null} onClick={() => setMode('discard')}><Trash2 size={15} /> Throw away</button>}
          <button type="button" className={primaryClass} disabled={!draft.changed || busy !== null || dirty || blockers.length > 0} title={dirty ? 'Save this screen first' : blockers.length ? 'Fix the problems listed first' : undefined} onClick={() => setMode('publish')}>
            <Send size={15} /> Publish
          </button>
        </div>
      </div>
      {draft.changed && blockers.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          <span>Publish waits until this is fixed. {blockers.map((b) => b.detail).join(' ')}</span>
          <button type="button" className={secondaryClass} onClick={() => go('overview')}>See what to fix</button>
        </div>
      )}
      {conflict && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Someone else saved the website after you opened it. Reload to see their changes.
          <button type="button" className={secondaryClass} onClick={() => businessId && load(businessId)}><RefreshCw size={15} /> Reload</button>
        </div>
      )}
      {mode === 'publish' && (
        <div className="flex flex-wrap items-end gap-2 border-t border-app-border pt-2">
          <label className="min-w-56 flex-1 text-sm font-medium text-app-text">
            What changed? (optional)
            <input autoFocus maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="New colours and home page" className={`${inputClass} mt-1`} />
          </label>
          <button type="button" className={primaryClass} disabled={busy !== null} onClick={doPublish}>{busy === 'publishing' ? 'Publishing…' : 'Publish now'}</button>
          <button type="button" className={secondaryClass} onClick={() => setMode('idle')}>Cancel</button>
        </div>
      )}
      {mode === 'discard' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-2 text-sm text-app-text">
          Throw away every unpublished change? The live website stays as it is.
          <button type="button" className={primaryClass} disabled={busy !== null} onClick={doDiscard}>Throw away</button>
          <button type="button" className={secondaryClass} onClick={() => setMode('idle')}>Keep</button>
        </div>
      )}
    </div>
  );
}

export default function WebsiteView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const draft = useWebsiteDraft((s) => s.draft);
  const draftFor = useWebsiteDraft((s) => s.businessId);
  const loadError = useWebsiteDraft((s) => s.loadError);
  const dirtyParts = useWebsiteDraft((s) => s.dirtyParts);
  const load = useWebsiteDraft((s) => s.load);
  const [screen, setScreen] = useState<WebsiteScreenId>('overview');
  const [leaving, setLeaving] = useState<WebsiteScreenId | null>(null);

  useEffect(() => {
    if (businessId) load(businessId);
  }, [businessId, load]);

  // Changing screens with unsaved edits asks first: the edits live only on that screen.
  const go = (next: WebsiteScreenId) => {
    if (next === screen) return;
    if (dirtyParts.length > 0) setLeaving(next);
    else setScreen(next);
  };

  const ready = draft && draftFor === businessId;
  const body = (() => {
    switch (screen) {
      case 'overview': return <OverviewScreen go={go} />;
      case 'brand': return <BrandScreen />;
      case 'design': return <DesignScreen />;
      case 'home': return <HomeScreen />;
      case 'pages': return <PagesScreen />;
      case 'content': return <ContentScreen />;
      case 'menu': return <MenuScreen />;
      case 'seo': return <SeoScreen />;
      case 'publishing': return <PublishingScreen />;
      case 'stats': return <StatsScreen />;
    }
  })();

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <nav aria-label="Website" className="shrink-0 border-b border-app-border lg:w-56 lg:border-b-0 lg:border-r">
        <h1 className="hidden px-4 pb-2 pt-5 font-display text-xl font-bold text-app-text lg:block">Website</h1>
        <ul className="no-scrollbar flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
          {SCREENS.map((s) => {
            const on = s.id === screen;
            const Icon = s.icon;
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => go(s.id)}
                  className={`flex min-h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition ${on ? 'bg-brand-500/15 text-app-text' : 'text-app-text-muted hover:bg-app-bg hover:text-app-text'}`}
                >
                  <Icon size={16} className={on ? 'text-brand-500' : ''} /> {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto p-4 pb-nav sm:p-6">
        {!businessId && <p className="text-sm text-app-text-muted">Choose a business first.</p>}
        {businessId && loadError && !ready && (
          <div className={`${cardClass} flex flex-wrap items-center justify-between gap-2 text-sm text-app-text-muted`}>
            {loadError}
            <button type="button" className={secondaryClass} onClick={() => load(businessId)}><RefreshCw size={15} /> Try again</button>
          </div>
        )}
        {businessId && !loadError && !ready && <p className="text-sm text-app-text-muted">Opening the website…</p>}
        {ready && (
          <div className="space-y-4">
            <PublishBar go={go} />
            {leaving && (
              <div role="alertdialog" aria-label="Unsaved edits" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-app-text">
                This screen has edits that are not saved to the draft. Leave without saving them?
                <span className="flex gap-2">
                  <button type="button" className={secondaryClass} onClick={() => setLeaving(null)}>Stay</button>
                  <button type="button" className={primaryClass} onClick={() => { setScreen(leaving); setLeaving(null); }}>Leave without saving</button>
                </span>
              </div>
            )}
            {body}
          </div>
        )}
      </div>
    </div>
  );
}
