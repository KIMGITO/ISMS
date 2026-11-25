// How adverts did: loaded, seen, clicked and orders that followed a click, for the shop and per
// campaign. Only counted figures: a click rate is shown only once something was seen, and order
// value is read from the orders themselves (cancelled and unpaid orders left out).
import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Segmented } from '../../components/shared/Choice';
import { StatGrid, StatTile } from '../../components/shared/StatTile';
import { Sparkline } from '../../components/shared/Sparkline';
import { formatMoney } from '../../utils/money';
import { getSupabase } from '../../services/supabaseClient';
import { clickRate, listCampaigns, overview, type Totals } from '../../services/marketing';
import type { MarketingNav } from './MarketingView';
import { cardClass, count, ErrorBox, percent, ScreenHeading, secondaryClass, StatusBadge, useLoad } from './shared';

type Days = '7' | '30' | '90';

async function perCampaign(businessId: string, from: string): Promise<Record<string, Totals>> {
  const { data, error } = await getSupabase()
    .from('marketing_ad_daily')
    .select('campaign_id, loads, views, clicks, conversions')
    .eq('business_id', businessId)
    .gte('day', from)
    .limit(10000);
  if (error) throw error;
  const out: Record<string, Totals> = {};
  for (const r of (data ?? []) as any[]) {
    const t = (out[r.campaign_id] ??= { loads: 0, views: 0, clicks: 0, conversions: 0 });
    t.loads += r.loads; t.views += r.views; t.clicks += r.clicks; t.conversions += r.conversions;
  }
  return out;
}

export default function PerformanceScreen({ businessId, nav }: { businessId: string; nav: MarketingNav }) {
  const [days, setDays] = useState<Days>('30');
  const o = useLoad(() => overview(businessId, Number(days)), [businessId, days]);
  const c = useLoad(() => listCampaigns(businessId), [businessId]);
  const p = useLoad(() => (o.data ? perCampaign(businessId, o.data.from) : Promise.resolve({} as Record<string, Totals>)), [businessId, o.data?.from]);
  const t = o.data?.totals;

  const rows = useMemo(() => (c.data ?? [])
    .map((x) => ({ c: x, t: p.data?.[x.id] ?? { loads: 0, views: 0, clicks: 0, conversions: 0 } }))
    .filter((r) => r.t.loads > 0 || r.c.status === 'active')
    .sort((a, b) => b.t.views - a.t.views), [c.data, p.data]);

  return (
    <div className="space-y-5">
      <ScreenHeading title="Performance" actions={<button type="button" className={secondaryClass} onClick={() => { o.reload(); c.reload(); }}><RefreshCw size={15} /> Refresh</button>}>
        Loaded: the advert was on a page. Seen: at least half of it was on screen for a second. Clicked: its button or picture was pressed. Orders: online orders the same visitor placed after clicking, within a day. Each is counted once per visit and day. Visitors whose browser asks not to be tracked are not counted.
      </ScreenHeading>
      <Segmented<Days> ariaLabel="Period" value={days} onChange={setDays} options={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} className="max-w-sm" />
      {(o.error || c.error || p.error) && <ErrorBox message={o.error || c.error || p.error || ''} onRetry={() => { o.reload(); c.reload(); }} />}

      <StatGrid cols={4}>
        <StatTile label="Loaded" value={count(t?.loads)} />
        <StatTile label="Seen" value={count(t?.views)} note={t && t.loads ? `${((t.views / t.loads) * 100).toFixed(0)}% of loaded` : undefined} />
        <StatTile label="Clicked" value={count(t?.clicks)} note={`Click rate ${percent(t ? clickRate(t) : null)}`} />
        <StatTile label="Orders after a click" value={count(t?.conversions)} note={`Worth ${formatMoney(o.data?.orderValue ?? 0)}`} />
      </StatGrid>

      {(o.data?.byDay.length ?? 0) > 1 && (
        <section className={cardClass} aria-label="Per day">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="text-xs text-app-text-muted">Seen per day</p><Sparkline values={o.data!.byDay.map((d) => Number(d.views))} color="var(--color-brand-500, #f59e0b)" className="h-12" /></div>
            <div><p className="text-xs text-app-text-muted">Clicks per day</p><Sparkline values={o.data!.byDay.map((d) => Number(d.clicks))} color="#0ea5e9" className="h-12" /></div>
          </div>
        </section>
      )}

      <section className={cardClass} aria-label="By campaign">
        <h3 className="font-semibold text-app-text">By campaign</h3>
        {rows.length === 0 ? <p className="mt-2 text-sm text-app-text-muted">No advert has been shown in this period.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-app-text-muted">
                <tr><th className="py-2 font-medium">Campaign</th><th className="py-2 text-right font-medium">Seen</th><th className="py-2 text-right font-medium">Clicked</th><th className="py-2 text-right font-medium">Click rate</th><th className="py-2 text-right font-medium">Orders</th></tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {rows.map(({ c: x, t: r }) => {
                  const rate = clickRate(r);
                  return (
                    <tr key={x.id}>
                      <td className="py-2"><button type="button" className="flex items-center gap-2 text-left font-medium text-app-text hover:underline" onClick={() => nav.openCampaign(x.id)}>{x.name} <StatusBadge status={x.status} /></button></td>
                      <td className="py-2 text-right tabular-nums">{count(r.views)}</td>
                      <td className="py-2 text-right tabular-nums">{count(r.clicks)}</td>
                      <td className="py-2 text-right tabular-nums">{rate === null ? '-' : `${rate.toFixed(1)}%`}</td>
                      <td className="py-2 text-right tabular-nums">{count(r.conversions)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
