// Website > Statistics: real records only. Orders and money come from website orders
// (website_stats over online_orders, paid orders only for money). Visits come from the counter
// (website_visit_daily: daily totals for everyone) and, for visitors who allowed statistics
// cookies, the visit history (website_visitor_stats, 20261217002). On a database without them
// the screen says so, never a made-up number.
//
// Layout: one journey strip reads left to right, visitor to paid order, with the share that
// made each step. Money and the visitor history sit under it; sources and top products last.
import { useEffect, useState, type ReactElement } from 'react';
import { Segmented } from '../../components/shared/Choice';
import { loadVisitorStats, loadWebsiteStats, type VisitorStats, type WebsiteStats } from '../../services/websiteDraft';
import { formatDate } from '../../utils/helpers';
import { formatMoney, formatQty, roundMoney } from '../../utils/money';
import { toUserMessage } from '../../utils/userError';
import { cardClass, ScreenHeading, secondaryClass } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

type Period = '7' | '30' | '90';

const PERCENT = 100;
const ONE_DECIMAL = 10;
const MAX_TRAIL = 4;
const MAX_PAGES = 6;
const MIN_BAR_PERCENT = 2;
const MIN_DAY_BAR_PERCENT = 6;
const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_SHOWN = 48;

/** "12.5%" of b that is a, or null when there is nothing to divide by. */
const share = (a: number, b: number): string | null =>
  b > 0 ? `${formatQty(Math.round((a / b) * PERCENT * ONE_DECIMAL) / ONE_DECIMAL)}%` : null;

export default function StatsScreen(): ReactElement {
  const businessId = useWebsiteDraft((s) => s.businessId!);
  const [period, setPeriod] = useState<Period>('30');
  const [stats, setStats] = useState<WebsiteStats | null>(null);
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError('');
    const days = Number(period);
    const load = async (): Promise<void> => {
      try {
        const [s, v] = await Promise.all([
          loadWebsiteStats(businessId, days),
          // The visit history is extra: if it can't be read the rest still shows.
          loadVisitorStats(businessId, days).catch(() => null),
        ]);
        if (!alive) return;
        setStats(s);
        setVisitors(v);
      } catch (err) {
        if (alive) setError(toUserMessage(err, 'Could not load the statistics.'));
      }
    };
    void load();
    return () => { alive = false; };
  }, [businessId, period, attempt]);

  return (
    <div className="space-y-4">
      <ScreenHeading title="Statistics" actions={
        <Segmented<Period> size="sm" ariaLabel="Period" value={period} onChange={setPeriod}
          options={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} />
      }>
        From the first visit to a paid order. Money counts paid orders only.
      </ScreenHeading>

      {error && (
        <div className={`${cardClass} flex flex-wrap items-center justify-between gap-2 text-sm text-app-text-muted`}>
          {error}
          <button type="button" className={secondaryClass} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}
      {!stats && !error && <p className="text-sm text-app-text-muted">Loading…</p>}

      {stats && (
        <>
          <Journey stats={stats} visitors={visitors} />
          <div className="grid gap-4 lg:grid-cols-5 lg:items-start">
            <Money stats={stats} className="lg:col-span-3" />
            <Visitors visitors={visitors} className="lg:col-span-2" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            {stats.visitsCounted ? <WhereFrom stats={stats} /> : (
              <section className={`${cardClass} space-y-1`}>
                <h3 className="font-bold text-app-text">Visits</h3>
                <p className="text-sm text-app-text-muted">Visits are not counted on this system yet. They start once the next database update is in.</p>
              </section>
            )}
            <TopProducts stats={stats} />
          </div>
        </>
      )}
    </div>
  );
}

interface Step {
  readonly label: string;
  readonly value: number | null;
  /** What share of the step before reached this one. */
  readonly rate: string | null;
  readonly hint: string;
}

/** The hero: one strip, visitor to paid order. Each step says how many of the one before made it. */
function Journey({ stats, visitors }: { readonly stats: WebsiteStats; readonly visitors: VisitorStats | null }): ReactElement {
  const visits = stats.visitsCounted ? stats.visits ?? 0 : null;
  const views = stats.visitsCounted ? stats.views ?? 0 : null;
  const people = visitors && visitors.cookieVisits > 0 ? visitors.visitors : null;
  const steps: readonly Step[] = [
    { label: 'Visitors', value: people, rate: null,
      hint: people === null ? 'Counted once visitors allow statistics cookies' : `${visitors!.returning} came back` },
    { label: 'Visits', value: visits, rate: null,
      hint: visits === null ? 'Not counted yet' : 'Arrived from outside or typed in' },
    { label: 'Pages opened', value: views, rate: null,
      hint: views !== null && visits ? `${formatQty(Math.round((views / visits) * ONE_DECIMAL) / ONE_DECIMAL)} per visit` : 'While browsing' },
    { label: 'Orders', value: stats.orders, rate: visits ? share(stats.orders, visits) : null, hint: 'of visits ordered' },
    { label: 'Paid', value: stats.paidOrders, rate: share(stats.paidOrders, stats.orders), hint: 'of orders were paid' },
  ];
  const since = stats.countingSince && stats.countingSince > (stats.byDay[0]?.day ?? '') ? stats.countingSince : null;
  return (
    <section aria-label="From visit to paid order" className={`${cardClass} p-0 overflow-hidden`}>
      {/* 1px gaps over the border colour draw the lines between steps at every width. */}
      <ol className="grid grid-cols-2 gap-px bg-app-border sm:grid-cols-3 lg:grid-cols-5">
        {steps.map((step) => (
          <li key={step.label} className="bg-app-card px-4 py-4">
            <p className="text-xs font-medium text-app-text-muted">{step.label}</p>
            <p className={`mt-1 font-display text-3xl font-bold tabular-nums leading-none ${step.value === null ? 'text-app-text-muted/60' : 'text-app-text'}`}>
              {step.value === null ? '–' : formatQty(step.value)}
            </p>
            <p className="mt-2 text-xs text-app-text-muted">
              {step.rate && <span className="mr-1 rounded-md bg-brand-500/15 px-1.5 py-0.5 font-semibold text-app-text">{step.rate}</span>}
              {step.hint}
            </p>
          </li>
        ))}
      </ol>
      {since && <p className="border-t border-app-border px-4 py-2 text-xs text-app-text-muted">Visits counted since {formatDate(since)}.</p>}
    </section>
  );
}

/** The best day full colour, other paid days lighter, empty days a hairline. */
const barColour = (revenue: number, best: boolean): string => {
  if (revenue <= 0) return 'bg-app-border/60';
  return best ? 'bg-brand-500' : 'bg-brand-500/45';
};

/** Money from paid orders, with one bar per day so a busy day stands out. */
function Money({ stats, className = '' }: { readonly stats: WebsiteStats; readonly className?: string }): ReactElement {
  const average = stats.paidOrders > 0 ? roundMoney(stats.revenue / stats.paidOrders) : null;
  const days = stats.byDay.map((d) => ({ day: d.day, revenue: Number(d.revenue) || 0 }));
  const top = Math.max(0, ...days.map((d) => d.revenue));
  const best = top > 0 ? days.find((d) => d.revenue === top) : undefined;
  return (
    <section className={`${cardClass} space-y-3 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h3 className="text-sm font-medium text-app-text-muted">Money from paid orders</h3>
          <p className="font-display text-3xl font-bold tabular-nums text-app-text">{formatMoney(stats.revenue)}</p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div><dt className="text-app-text-muted">Average order</dt><dd className="font-semibold tabular-nums text-app-text">{average !== null ? formatMoney(average) : 'None yet'}</dd></div>
          <div><dt className="text-app-text-muted">Best day</dt><dd className="font-semibold text-app-text">{best ? formatDate(best.day) : 'None yet'}</dd></div>
        </dl>
      </div>
      <div className="flex h-20 items-end gap-px" role="img"
        aria-label={best ? `Money per day; the best day was ${formatDate(best.day)} with ${formatMoney(top)}` : 'No paid orders in this period'}>
        {days.map((d) => (
          <div key={d.day} title={`${formatDate(d.day)}: ${formatMoney(d.revenue)}`}
            className={`flex-1 rounded-t-sm ${barColour(d.revenue, d === best)}`}
            style={{ height: top > 0 && d.revenue > 0 ? `${Math.max(MIN_DAY_BAR_PERCENT, (d.revenue / top) * PERCENT)}%` : '2px' }} />
        ))}
      </div>
    </section>
  );
}

const PAGE_WORD: Record<string, string> = {
  home: 'Home page', shop: 'Shop', product: 'Product pages', search: 'Search', cart: 'Cart', checkout: 'Checkout',
  order: 'Order and tracking', account: 'Account and saved', articles: 'Articles', contact: 'Contact and feedback',
  info: 'About, help and policies', campaign: 'Offer pages', other: 'Other pages',
};

const timeAgo = (iso: string): string => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / MINUTE_MS));
  if (mins < MINUTES_PER_HOUR) return `${mins} min ago`;
  const hours = Math.round(mins / MINUTES_PER_HOUR);
  return hours < HOURS_SHOWN ? `${hours} h ago` : formatDate(iso);
};

/** Who came lately (statistics cookies only): new or returning, and the pages they opened. */
function Visitors({ visitors, className = '' }: { readonly visitors: VisitorStats | null; readonly className?: string }): ReactElement {
  const recent = visitors?.recent ?? [];
  return (
    <section className={`${cardClass} space-y-3 ${className}`}>
      <div>
        <h3 className="font-bold text-app-text">Recent visitors</h3>
        <p className="text-xs text-app-text-muted">Only visitors who allowed statistics cookies. Shown by a random number, never a name.</p>
      </div>
      {visitors === null && <p className="text-sm text-app-text-muted">Visit history starts once the next database update is in.</p>}
      {visitors !== null && recent.length === 0 && (
        <p className="text-sm text-app-text-muted">No visitor has allowed statistics cookies in this period yet.</p>
      )}
      {recent.length > 0 && (
        <ul className="divide-y divide-app-border">
          {recent.map((v) => {
            const back = v.visits > 1 || new Date(v.firstSeen) < new Date(v.trail[v.trail.length - 1]?.at ?? v.lastSeen);
            return (
              <li key={v.visitor} className="py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-app-text">
                    Visitor {v.visitor}
                    <span className={`ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${back ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-app-bg text-app-text-muted'}`}>
                      {back ? 'Returning' : 'New'}
                    </span>
                    {v.signedIn && <span className="ml-1 text-[11px] text-app-text-muted">signed in</span>}
                  </span>
                  <span className="shrink-0 text-xs text-app-text-muted">{timeAgo(v.lastSeen)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-app-text-muted">
                  {v.visits} {v.visits === 1 ? 'visit' : 'visits'}, {v.pages} {v.pages === 1 ? 'page' : 'pages'}: {v.trail.slice(0, MAX_TRAIL).map((t) => PAGE_WORD[t.page] ?? t.page).join(', ')}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const SOURCE_WORD: Record<string, string> = {
  direct: 'Typed in or saved link', search: 'Search engines', social: 'Social media and WhatsApp', site: 'Other websites',
};

function WhereFrom({ stats }: { readonly stats: WebsiteStats }): ReactElement {
  const total = (stats.sources ?? []).reduce((n, s) => n + s.visits, 0);
  return (
    <section className={`${cardClass} space-y-3`}>
      <div>
        <h3 className="font-bold text-app-text">Where visits came from</h3>
        <p className="text-xs text-app-text-muted">Every visit, with or without cookies. Robots are left out.</p>
      </div>
      {total === 0 ? <p className="text-sm text-app-text-muted">No visits counted in this period.</p> : (
        <ul className="space-y-2">
          {stats.sources!.map((s) => (
            <li key={s.source} className="text-sm">
              <div className="flex justify-between gap-3 text-app-text"><span>{SOURCE_WORD[s.source] ?? s.source}</span><span className="tabular-nums text-app-text-muted">{s.visits} · {share(s.visits, total)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-app-bg"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.max(MIN_BAR_PERCENT, (s.visits / total) * PERCENT)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
      {(stats.pages ?? []).length > 0 && (
        <>
          <h3 className="pt-1 font-bold text-app-text">Pages opened most</h3>
          <ol className="divide-y divide-app-border">
            {stats.pages!.slice(0, MAX_PAGES).map((p) => (
              <li key={p.page} className="flex justify-between gap-3 py-1.5 text-sm text-app-text">
                <span>{PAGE_WORD[p.page] ?? p.page}</span><span className="tabular-nums text-app-text-muted">{p.views}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function TopProducts({ stats }: { readonly stats: WebsiteStats }): ReactElement {
  return (
    <section className={`${cardClass} space-y-2`}>
      <h3 className="font-bold text-app-text">Most ordered</h3>
      {stats.topProducts.length === 0
        ? <p className="text-sm text-app-text-muted">No paid website orders in this period.</p>
        : (
          <ol className="divide-y divide-app-border">
            {stats.topProducts.map((p) => (
              <li key={p.name} className="flex justify-between gap-3 py-2 text-sm text-app-text">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums text-app-text-muted">{formatQty(Number(p.quantity))}</span>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
