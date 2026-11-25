// Website > Overview: the readiness score and every quality check for the website in the draft
// (website/src/engine/checks.ts), each open one opening the screen that fixes it, plus the last
// 30 days of website orders. Facts only, read from the draft and the database.
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, OctagonAlert } from 'lucide-react';
import type { CheckLevel, CheckResult, FixPlace } from '../../../website/src/engine/checks';
import { loadWebsiteStats, WebsiteStats } from '../../services/websiteDraft';
import { useUiStore } from '../../stores/uiStore';
import { formatMoney } from '../../utils/money';
import { cardClass, ScreenHeading } from './ui';
import { useReadiness } from './useReadiness';
import { useWebsiteDraft } from './useWebsiteDraft';
import type { WebsiteScreenId } from './WebsiteView';

const LEVEL_ORDER: Record<CheckLevel, number> = { blocker: 0, warning: 1, tip: 2 };
const LEVEL_WORD: Record<CheckLevel, string> = { blocker: 'Must fix before publishing', warning: 'Should fix', tip: 'Would help' };

const STATUS = {
  blocked: { text: 'Not ready to publish', tone: 'text-red-600 dark:text-red-400', ring: 'stroke-red-500' },
  needs_work: { text: 'Ready, could be better', tone: 'text-amber-600 dark:text-amber-400', ring: 'stroke-amber-500' },
  ready: { text: 'Ready', tone: 'text-emerald-600 dark:text-emerald-400', ring: 'stroke-emerald-500' },
} as const;

function ScoreRing({ score, ring }: { score: number; ring: string }) {
  const r = 26;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="size-20 shrink-0 -rotate-90" role="img" aria-label={`Readiness ${score} out of 100`}>
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-app-border" />
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round" className={ring}
        strokeDasharray={length} strokeDashoffset={length * (1 - score / 100)} />
      <text x="32" y="32" dy="0.35em" textAnchor="middle" transform="rotate(90 32 32)" className="fill-app-text text-[15px] font-bold">{score}</text>
    </svg>
  );
}

function CheckIcon({ check }: { check: CheckResult }) {
  if (check.passed) return <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />;
  if (check.level === 'blocker') return <OctagonAlert size={18} className="shrink-0 text-red-600" />;
  if (check.level === 'warning') return <AlertTriangle size={18} className="shrink-0 text-amber-600" />;
  return <Circle size={18} className="shrink-0 text-app-text-muted" />;
}

export default function OverviewScreen({ go }: { go: (screen: WebsiteScreenId) => void }) {
  const businessId = useWebsiteDraft((s) => s.businessId!);
  const changed = useWebsiteDraft((s) => s.draft!.changed);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const { readiness, error } = useReadiness();
  const [stats, setStats] = useState<WebsiteStats | null>(null);

  useEffect(() => {
    loadWebsiteStats(businessId, 30).then(setStats).catch(() => setStats(null));
  }, [businessId]);

  const open = (place: FixPlace) => (place === 'products' ? setActiveTab('online-store') : go(place));
  const sorted = readiness
    ? [...readiness.checks].sort((a, b) => Number(a.passed) - Number(b.passed) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    : [];
  const openCount = sorted.filter((c) => !c.passed).length;

  return (
    <div className="space-y-4">
      <ScreenHeading title="Overview">
        {changed ? 'Checks of the draft: what the website will look like after Publish.' : 'Checks of the live website.'}
      </ScreenHeading>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-3">
          {error && <p className={`${cardClass} text-sm text-app-text-muted`}>Could not read the shop's details, so the checks are not shown. Check the connection and open Overview again.</p>}
          {!readiness && !error && <p className="text-sm text-app-text-muted">Checking…</p>}
          {readiness && (
            <>
              <section className={`${cardClass} flex items-center gap-4`}>
                <ScoreRing score={readiness.score} ring={STATUS[readiness.status].ring} />
                <div className="min-w-0">
                  <p className={`text-lg font-bold ${STATUS[readiness.status].tone}`}>{STATUS[readiness.status].text}</p>
                  <p className="text-sm text-app-text-muted">
                    {readiness.blockers.length > 0
                      ? `${readiness.blockers.length} ${readiness.blockers.length === 1 ? 'problem stops' : 'problems stop'} publishing. Fix ${readiness.blockers.length === 1 ? 'it' : 'them'} first.`
                      : openCount > 0 ? `${openCount} ${openCount === 1 ? 'thing' : 'things'} left to improve. The website works without ${openCount === 1 ? 'it' : 'them'}.` : 'Everything checked is in place.'}
                  </p>
                </div>
              </section>
              <ul className={`${cardClass} divide-y divide-app-border p-0`}>
                {sorted.map((c) => (
                  <li key={c.id}>
                    <button type="button" disabled={c.passed} onClick={() => open(c.fix)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left enabled:hover:bg-app-bg">
                      <CheckIcon check={c} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-app-text">
                          {c.title}
                          {!c.passed && <span className="ml-2 text-xs font-normal text-app-text-muted">{LEVEL_WORD[c.level]}</span>}
                        </span>
                        <span className="block text-xs text-app-text-muted">{c.detail}</span>
                      </span>
                      {!c.passed && <ArrowRight size={15} className="shrink-0 text-app-text-muted" />}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <section className={`${cardClass} space-y-2`}>
          <h3 className="font-bold text-app-text">Last 30 days</h3>
          {stats ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {stats.visitsCounted && <><dt className="text-app-text-muted">Visits</dt><dd className="text-right font-semibold text-app-text">{stats.visits ?? 0}</dd></>}
              <dt className="text-app-text-muted">Website orders</dt><dd className="text-right font-semibold text-app-text">{stats.orders}</dd>
              <dt className="text-app-text-muted">Paid</dt><dd className="text-right font-semibold text-app-text">{stats.paidOrders}</dd>
              <dt className="text-app-text-muted">Money</dt><dd className="text-right font-semibold text-app-text">{formatMoney(stats.revenue)}</dd>
            </dl>
          ) : <p className="text-sm text-app-text-muted">Loading…</p>}
          <button type="button" onClick={() => go('stats')} className="inline-flex items-center gap-1 text-sm font-medium text-brand-500 hover:underline">All statistics <ArrowRight size={14} /></button>
        </section>
      </div>
    </div>
  );
}
