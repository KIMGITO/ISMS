// Every campaign of the shop, filtered by status and searchable. Opening one shows its editor.
import React, { useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { FilterChips } from '../../components/shared/Choice';
import { SearchInput } from '../../components/shared/Input';
import { formatInZone, listCampaigns } from '../../services/marketing';
import { CAMPAIGN_TYPES, STATUS_LABELS, type CampaignStatus } from '../../../website/src/ads/rules';
import type { MarketingNav } from './MarketingView';
import { cardClass, ErrorBox, primaryClass, ScreenHeading, secondaryClass, StatusBadge, useCanManage, useLoad, useTimezone } from './shared';

type Filter = 'current' | CampaignStatus | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'current', label: 'Current' },
  { id: 'active', label: STATUS_LABELS.active },
  { id: 'scheduled', label: STATUS_LABELS.scheduled },
  { id: 'draft', label: STATUS_LABELS.draft },
  { id: 'paused', label: STATUS_LABELS.paused },
  { id: 'completed', label: STATUS_LABELS.completed },
  { id: 'archived', label: STATUS_LABELS.archived },
  { id: 'all', label: 'All' },
];
const typeLabel = (v: string) => CAMPAIGN_TYPES.find((t) => t.value === v)?.label ?? v;

export default function CampaignsScreen({ businessId, nav }: { businessId: string; nav: MarketingNav }) {
  const canManage = useCanManage();
  const tz = useTimezone(businessId);
  const { data, error, loading, reload } = useLoad(() => listCampaigns(businessId), [businessId]);
  const [filter, setFilter] = useState<Filter>('current');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => filter === 'all' || (filter === 'current' ? !['archived', 'completed'].includes(c.status) : c.status === filter))
      .filter((c) => !term || `${c.name} ${c.description ?? ''} ${typeLabel(c.campaign_type)}`.toLowerCase().includes(term));
  }, [data, filter, q]);

  return (
    <div className="space-y-4">
      <ScreenHeading
        title="Campaigns"
        actions={
          <>
            <button type="button" className={secondaryClass} onClick={reload}><RefreshCw size={15} /> Refresh</button>
            {canManage && <button type="button" className={primaryClass} onClick={() => nav.openCampaign('new')}><Plus size={15} /> New campaign</button>}
          </>
        }
      >
        A campaign holds the dates, priority and button; its creatives are the adverts it shows.
      </ScreenHeading>
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips<Filter> options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Show campaigns" />
        <div className="min-w-48 flex-1"><SearchInput value={q} onChange={setQ} placeholder="Search campaigns" /></div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <p className="text-sm text-app-text-muted">Loading campaigns…</p>}
      {data && rows.length === 0 && (
        <div className={`${cardClass} text-sm text-app-text-muted`}>
          {data.length === 0 ? 'No campaigns yet. Start one for your next offer, launch or season.' : 'No campaign matches.'}
        </div>
      )}
      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => nav.openCampaign(c.id)} className={`${cardClass} flex w-full flex-wrap items-center justify-between gap-3 text-left transition hover:border-brand-500/50`}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-app-text">{c.name}</span>
                  <StatusBadge status={c.status} />
                </span>
                <span className="mt-0.5 block text-xs text-app-text-muted">
                  {typeLabel(c.campaign_type)} · {formatInZone(c.starts_at, tz)}{c.ends_at ? ` to ${formatInZone(c.ends_at, tz)}` : ', no end date'} · {c.creative_count ?? 0} creative{c.creative_count === 1 ? '' : 's'} · priority {c.priority}
                </span>
              </span>
              {c.discount_label && <span className="rounded-full bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-app-text">{c.discount_label}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
