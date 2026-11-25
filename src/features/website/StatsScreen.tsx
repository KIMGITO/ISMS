// Website > Statistics: real records only. Orders and money come from website orders
// (website_stats over online_orders, paid orders only for money). Visits come from the private
// counter (website_visit_daily, 20261208001): daily totals, nothing about the visitor. On a
// database without the counter the screen says visits are not counted, never a made-up number.
import { useEffect, useState } from 'react';
import { Segmented } from '../../components/shared/Choice';
import { StatTile } from '../../components/shared/StatTile';
import { loadWebsiteStats, WebsiteStats } from '../../services/websiteDraft';
import { formatDate } from '../../utils/helpers';
import { formatMoney, formatQty, roundMoney } from '../../utils/money';
import { toUserMessage } from '../../utils/userError';
import { cardClass, ScreenHeading, secondaryClass } from './ui';
import { useWebsiteDraft } from './useWebsiteDraft';

type Period = '7' | '30' | '90';

export default function StatsScreen() {
  const businessId = useWebsiteDraft((s) => s.businessId!);
  const [period, setPeriod] = useState<Period>('30');
  const [stats, setStats] = useState<WebsiteStats | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError('');
    loadWebsiteStats(businessId, Number(period))
      .then((s) => alive && setStats(s))
      .catch((err) => alive && setError(toUserMessage(err, 'Could not load the statistics.')));
    return () => { alive = false; };
  }, [businessId, period, attempt]);

  const average = stats && stats.paidOrders > 0 ? roundMoney(stats.revenue / stats.paidOrders) : null;
  const paidShare = stats && stats.orders > 0 ? Math.round((stats.paidOrders / stats.orders) * 100) : null;

  return (
    <div className="space-y-4">
      <ScreenHeading title="Statistics" actions={
        <Segmented<Period> size="sm" ariaLabel="Period" value={period} onChange={setPeriod}
          options={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} />
      }>
        Visits and orders on your website. Money counts paid orders only.
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
          {stats.visitsCounted && <VisitTiles stats={stats} />}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Orders" value={stats.orders} spark={stats.byDay.map((d) => d.orders)} tone="sky" />
            <StatTile label="Paid orders" value={stats.paidOrders} note={paidShare !== null ? `${paidShare}% of orders` : undefined} tone="emerald" />
            <StatTile label="Money from paid orders" value={formatMoney(stats.revenue)} spark={stats.byDay.map((d) => Number(d.revenue))} tone="amber" />
            <StatTile label="Average paid order" value={average !== null ? formatMoney(average) : 'None yet'} tone="violet" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <section className={`${cardClass} space-y-2`}>
              <h3 className="font-bold text-app-text">Most ordered</h3>
              {stats.topProducts.length === 0
                ? <p className="text-sm text-app-text-muted">No paid website orders in this period.</p>
                : (
                  <ol className="divide-y divide-app-border">
                    {stats.topProducts.map((p, i) => (
                      <li key={p.name} className="flex justify-between gap-3 py-2 text-sm text-app-text">
                        <span className="truncate">{i + 1}. {p.name}</span>
                        <span className="shrink-0 text-app-text-muted">{formatQty(Number(p.quantity))}</span>
                      </li>
                    ))}
                  </ol>
                )}
            </section>
            {stats.visitsCounted ? <WhereFrom stats={stats} /> : (
              <section className={`${cardClass} space-y-1`}>
                <h3 className="font-bold text-app-text">Visits</h3>
                <p className="text-sm text-app-text-muted">Visits are not counted on this system yet. They start once the next database update is in.</p>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const SOURCE_WORD: Record<string, string> = {
  direct: 'Typed in or saved link', search: 'Search engines', social: 'Social media and WhatsApp', site: 'Other websites',
};
const PAGE_WORD: Record<string, string> = {
  home: 'Home page', shop: 'Shop', product: 'Product pages', search: 'Search', cart: 'Cart', checkout: 'Checkout',
  order: 'Order and tracking', account: 'Account and saved', articles: 'Articles', contact: 'Contact and feedback',
  info: 'About, help and policies', campaign: 'Offer pages', other: 'Other pages',
};

function VisitTiles({ stats }: { stats: WebsiteStats }) {
  const visits = stats.visits ?? 0;
  const views = stats.views ?? 0;
  const perVisit = visits > 0 ? Math.round((views / visits) * 10) / 10 : null;
  const per100 = visits > 0 ? Math.round((stats.orders / visits) * 1000) / 10 : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <StatTile label="Visits" value={visits} spark={stats.byDay.map((d) => d.visits ?? 0)} tone="sky"
        note={stats.countingSince && stats.countingSince > (stats.byDay[0]?.day ?? '') ? `Counted since ${formatDate(stats.countingSince)}` : undefined} />
      <StatTile label="Pages opened" value={views} note={perVisit !== null ? `${formatQty(perVisit)} per visit` : undefined} tone="violet" />
      <StatTile label="Orders per 100 visits" value={per100 !== null ? formatQty(per100) : 'None yet'} tone="emerald" />
    </div>
  );
}

function WhereFrom({ stats }: { stats: WebsiteStats }) {
  const total = (stats.sources ?? []).reduce((n, s) => n + s.visits, 0);
  return (
    <section className={`${cardClass} space-y-3`}>
      <div>
        <h3 className="font-bold text-app-text">Where visits came from</h3>
        <p className="text-xs text-app-text-muted">Counted without cookies and without keeping anything about the visitor. Robots are left out; the same person visiting twice counts twice.</p>
      </div>
      {total === 0 ? <p className="text-sm text-app-text-muted">No visits counted in this period.</p> : (
        <ul className="space-y-2">
          {stats.sources!.map((s) => (
            <li key={s.source} className="text-sm">
              <div className="flex justify-between gap-3 text-app-text"><span>{SOURCE_WORD[s.source] ?? s.source}</span><span className="text-app-text-muted">{s.visits}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-app-bg"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.max(2, (s.visits / total) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
      {(stats.pages ?? []).length > 0 && (
        <>
          <h3 className="pt-1 font-bold text-app-text">Pages opened most</h3>
          <ol className="divide-y divide-app-border">
            {stats.pages!.slice(0, 6).map((p) => (
              <li key={p.page} className="flex justify-between gap-3 py-1.5 text-sm text-app-text">
                <span>{PAGE_WORD[p.page] ?? p.page}</span><span className="text-app-text-muted">{p.views}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
