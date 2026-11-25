// Marketing overview: what is showing, what is coming, what is waiting, how adverts did in the
// last 30 days, and quick starts. Every figure comes from the database (marketing_overview);
// nothing is estimated. Order value is read from the orders themselves.
import React, { useMemo } from 'react';
import { CalendarDays, Plus, RefreshCw } from 'lucide-react';
import { StatGrid, StatTile } from '../../components/shared/StatTile';
import { Sparkline } from '../../components/shared/Sparkline';
import { formatMoney } from '../../utils/money';
import { clickRate, formatInZone, listCampaigns, overview, recentEvents } from '../../services/marketing';
import { CAMPAIGN_TYPES } from '../../../website/src/ads/rules';
import type { MarketingNav } from './MarketingView';
import { cardClass, count, ErrorBox, EVENT_LABELS, percent, primaryClass, ScreenHeading, secondaryClass, StatusBadge, useCanManage, useLoad, useTimezone } from './shared';

/** Dates shops plan around. Fixed rules only (no guesses); Black Friday is the day after the fourth Thursday of November. */
export function upcomingDates(now = new Date(), days = 120): { date: Date; name: string; type: string }[] {
  const out: { date: Date; name: string; type: string }[] = [];
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    const nov1 = new Date(year, 10, 1);
    const firstThursday = 1 + ((4 - nov1.getDay() + 7) % 7);
    const blackFriday = new Date(year, 10, firstThursday + 22);
    out.push(
      { date: new Date(year, 1, 14), name: "Valentine's Day", type: 'seasonal' },
      { date: new Date(year, 5, 1), name: 'Madaraka Day', type: 'seasonal' },
      { date: new Date(year, 9, 20), name: 'Mashujaa Day', type: 'seasonal' },
      { date: blackFriday, name: 'Black Friday', type: 'black_friday' },
      { date: new Date(year, 10, firstThursday + 25), name: 'Cyber Monday', type: 'discount' },
      { date: new Date(year, 11, 12), name: 'Jamhuri Day', type: 'seasonal' },
      { date: new Date(year, 11, 25), name: 'Christmas', type: 'christmas' },
      { date: new Date(year + 1, 0, 1), name: 'New Year', type: 'seasonal' },
    );
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return out
    .filter((d) => d.date.getTime() >= start && d.date.getTime() <= start + days * 86_400_000)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .filter((d, i, all) => all.findIndex((x) => x.name === d.name) === i);
}

export default function DashboardScreen({ businessId, nav }: { businessId: string; nav: MarketingNav }) {
  const canManage = useCanManage();
  const tz = useTimezone(businessId);
  const o = useLoad(() => overview(businessId, 30), [businessId]);
  const c = useLoad(() => listCampaigns(businessId), [businessId]);
  const e = useLoad(() => recentEvents(businessId, 8), [businessId]);
  const dates = useMemo(() => upcomingDates(), []);

  const active = (c.data ?? []).filter((x) => x.status === 'active').sort((a, b) => b.priority - a.priority);
  const scheduled = (c.data ?? []).filter((x) => x.status === 'scheduled').sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const drafts = (c.data ?? []).filter((x) => x.status === 'draft');
  const t = o.data?.totals;
  const rate = t ? clickRate(t) : null;
  const reload = () => { o.reload(); c.reload(); e.reload(); };

  return (
    <div className="space-y-5">
      <ScreenHeading
        title="Marketing"
        actions={
          <>
            <button type="button" className={secondaryClass} onClick={reload}><RefreshCw size={15} /> Refresh</button>
            {canManage && <button type="button" className={primaryClass} onClick={() => nav.openCampaign('new')}><Plus size={15} /> New campaign</button>}
          </>
        }
      >
        Campaigns on your website, their adverts and how they do. Times are in {tz}.
      </ScreenHeading>

      {(o.error || c.error) && <ErrorBox message={o.error || c.error || ''} onRetry={reload} />}

      <StatGrid cols={4}>
        <StatTile label="Showing now" value={count(o.data?.counts.active)} tone="emerald" onClick={() => nav.go('campaigns')} />
        <StatTile label="Scheduled" value={count(o.data?.counts.scheduled)} tone="sky" onClick={() => nav.go('campaigns')} />
        <StatTile label="Drafts" value={count(o.data?.counts.draft)} tone="slate" onClick={() => nav.go('campaigns')} />
        <StatTile label="Finished" value={count(o.data?.counts.completed)} tone="violet" onClick={() => nav.go('campaigns')} />
      </StatGrid>

      <section className={cardClass} aria-label="Last 30 days">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-app-text">Last 30 days</h3>
          <button type="button" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => nav.go('performance')}>All figures</button>
        </div>
        {t && t.loads === 0 ? (
          <p className="mt-2 text-sm text-app-text-muted">No adverts have been shown yet. Figures appear here once a published campaign is on your website.</p>
        ) : (
          <>
            <StatGrid cols={4} className="mt-3">
              <StatTile label="Seen" value={count(t?.views)} note={`${count(t?.loads)} loaded on a page`} />
              <StatTile label="Clicked" value={count(t?.clicks)} note={`Click rate ${percent(rate)}`} />
              <StatTile label="Orders after a click" value={count(t?.conversions)} />
              <StatTile label="Value of those orders" value={formatMoney(o.data?.orderValue ?? 0)} note="Paid and active orders only" />
            </StatGrid>
            {(o.data?.byDay.length ?? 0) > 1 && (
              <div className="mt-3">
                <p className="text-xs text-app-text-muted">Times seen per day</p>
                <Sparkline values={o.data!.byDay.map((d) => Number(d.views))} color="var(--color-brand-500, #f59e0b)" className="h-10" />
              </div>
            )}
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cardClass} aria-label="Showing now">
          <h3 className="font-semibold text-app-text">Showing now</h3>
          {active.length === 0 ? <p className="mt-2 text-sm text-app-text-muted">Nothing is showing on your website.</p> : (
            <ul className="mt-2 divide-y divide-app-border">
              {active.slice(0, 6).map((x) => (
                <li key={x.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left" onClick={() => nav.openCampaign(x.id)}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-app-text">{x.name}</span>
                      <span className="block text-xs text-app-text-muted">{x.ends_at ? `Ends ${formatInZone(x.ends_at, tz)}` : 'No end date'} · priority {x.priority}</span>
                    </span>
                    <StatusBadge status={x.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cardClass} aria-label="Coming up">
          <h3 className="font-semibold text-app-text">Coming up</h3>
          {scheduled.length === 0 && drafts.length === 0 ? <p className="mt-2 text-sm text-app-text-muted">No scheduled campaigns or drafts.</p> : (
            <ul className="mt-2 divide-y divide-app-border">
              {[...scheduled, ...drafts].slice(0, 6).map((x) => (
                <li key={x.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left" onClick={() => nav.openCampaign(x.id)}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-app-text">{x.name}</span>
                      <span className="block text-xs text-app-text-muted">Starts {formatInZone(x.starts_at, tz)}</span>
                    </span>
                    <StatusBadge status={x.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cardClass} aria-label="Dates to plan for">
          <h3 className="font-semibold text-app-text">Dates to plan for</h3>
          <ul className="mt-2 divide-y divide-app-border">
            {dates.slice(0, 5).map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2 text-sm text-app-text">
                  <CalendarDays size={15} className="text-app-text-muted" />
                  {d.name}
                  <span className="text-xs text-app-text-muted">{d.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                </span>
                {canManage && <button type="button" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => nav.openCampaign('new', d.type)}>Plan</button>}
              </li>
            ))}
          </ul>
        </section>

        <section className={cardClass} aria-label="Recent activity">
          <h3 className="font-semibold text-app-text">Recent activity</h3>
          {(e.data ?? []).length === 0 ? <p className="mt-2 text-sm text-app-text-muted">Nothing yet.</p> : (
            <ul className="mt-2 space-y-1.5">
              {e.data!.map((ev) => (
                <li key={ev.id} className="text-sm text-app-text">
                  <button type="button" className="text-left hover:underline" onClick={() => nav.openCampaign(ev.campaign_id)}>
                    <span className="font-medium">{ev.name}</span>: {EVENT_LABELS[ev.event] ?? ev.event}
                  </button>
                  <span className="ml-1 text-xs text-app-text-muted">{formatInZone(ev.at, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canManage && (
        <section aria-label="Quick start">
          <h3 className="mb-2 text-sm font-semibold text-app-text">Start a campaign</h3>
          <div className="flex flex-wrap gap-2">
            {CAMPAIGN_TYPES.filter((x) => ['black_friday', 'christmas', 'flash_sale', 'new_product', 'brand_awareness', 'discount'].includes(x.value)).map((x) => (
              <button key={x.value} type="button" className={secondaryClass} onClick={() => nav.openCampaign('new', x.value)}>{x.label}</button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
