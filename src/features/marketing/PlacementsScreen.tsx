// Where adverts may appear on the website, and how many share each space. Switching a placement
// off hides every campaign's creatives there at once without touching the campaigns.
import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { NumberInput } from '../../components/shared/Input';
import { Switch } from '../../components/shared/Switch';
import SearchableDropdown from '../../components/SearchableDropdown';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { getPlacements, savePlacement, setBusinessTimezone } from '../../services/marketing';
import { FORMATS, PLACEMENT_ORDER, PLACEMENTS, type AdPlacement, type PlacementSettings } from '../../../website/src/ads/rules';
import { cardClass, ErrorBox, hintClass, inputClass, labelClass, primaryClass, ScreenHeading, useCanManage, useLoad, useTimezone } from './shared';

const defaults = (p: AdPlacement): PlacementSettings => ({ enabled: true, maxItems: PLACEMENTS[p].maxItems, rotation: PLACEMENTS[p].rotation, intervalS: 7, popupDelayS: 8, popupEveryH: 24 });

const ZONES: string[] = (() => {
  try { return (Intl as any).supportedValuesOf?.('timeZone') ?? []; } catch { return []; }
})();

export default function PlacementsScreen({ businessId }: { businessId: string }) {
  const canManage = useCanManage();
  const showToast = useNotificationStore((s) => s.showToast);
  const { data, error, reload } = useLoad(() => getPlacements(businessId), [businessId]);
  const [edit, setEdit] = useState<Partial<Record<AdPlacement, PlacementSettings>>>({});
  const [saving, setSaving] = useState<AdPlacement | null>(null);
  const tz = useTimezone(businessId);
  const [zone, setZone] = useState(tz);
  useEffect(() => setZone(tz), [tz]);

  const value = (p: AdPlacement) => edit[p] ?? data?.[p] ?? defaults(p);
  const change = (p: AdPlacement, patch: Partial<PlacementSettings>) => setEdit((e) => ({ ...e, [p]: { ...value(p), ...patch } }));
  const save = async (p: AdPlacement) => {
    setSaving(p);
    try {
      await savePlacement(businessId, p, value(p));
      setEdit((e) => { const n = { ...e }; delete n[p]; return n; });
      showToast('Placements', `${PLACEMENTS[p].label} saved. The website follows within a minute.`, undefined, 'success');
      reload();
    } catch (e) { showToast('Placements', toUserMessage(e, 'Could not save.'), undefined, 'error'); } finally { setSaving(null); }
  };

  return (
    <div className="space-y-5">
      <ScreenHeading title="Placements">
        The spaces on your website that can show adverts. Each has its own layout; only the highest-priority campaigns fill a space, so the website never gets crowded.
      </ScreenHeading>
      {error && <ErrorBox message={error} onRetry={reload} />}

      <section className={`${cardClass} flex flex-wrap items-end gap-3`} aria-label="Time zone">
        <label className={`${labelClass} min-w-64 flex-1`}>Time zone for campaign dates <span className={hintClass}>Campaigns start and end by this clock.</span>
          {ZONES.length > 0 ? (
            <SearchableDropdown className="mt-1" disabled={!canManage} placeholder="Choose a time zone" selectedValue={zone} onChange={setZone} items={ZONES.map((z) => ({ id: z, label: z }))} />
          ) : <input className={`${inputClass} mt-1`} disabled={!canManage} value={zone} onChange={(e) => setZone(e.target.value)} />}
        </label>
        {canManage && zone !== tz && (
          <button type="button" className={primaryClass} onClick={async () => {
            try { await setBusinessTimezone(businessId, zone); showToast('Time zone', `Now ${zone}. Dates already set keep their moment in time.`, undefined, 'success'); }
            catch (e) { showToast('Time zone', toUserMessage(e, 'Could not change it.'), undefined, 'error'); }
          }}><Save size={15} /> Save time zone</button>
        )}
      </section>

      <ul className="grid gap-4 lg:grid-cols-2">
        {PLACEMENT_ORDER.map((p) => {
          const v = value(p);
          const spec = PLACEMENTS[p];
          const changed = !!edit[p];
          return (
            <li key={p} className={`${cardClass} space-y-3`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-app-text">{spec.label}</h3>
                  <p className="text-sm text-app-text-muted">{spec.where}</p>
                  <p className="mt-1 text-xs text-app-text-muted">Takes: {spec.formats.map((f) => `${FORMATS[f].label} (${FORMATS[f].shape})`).join(', ')}</p>
                </div>
                <Switch checked={v.enabled} disabled={!canManage} ariaLabel={`${spec.label} on`} onChange={(on: boolean) => change(p, { enabled: on })} />
              </div>
              {v.enabled && p !== 'popup' && p !== 'landing' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Most adverts at once
                    <NumberInput className="mt-1" decimals={0} min={1} max={6} disabled={!canManage} value={v.maxItems} onChange={(n) => change(p, { maxItems: Math.min(6, Math.max(1, n ?? 1)) })} />
                  </label>
                  <label className={labelClass}>When several campaigns compete
                    <SearchableDropdown className="mt-1" disabled={!canManage} placeholder="Choose" selectedValue={v.rotation} onChange={(x) => change(p, { rotation: x as PlacementSettings['rotation'] })} items={[{ id: 'priority', label: 'Highest priority wins' }, { id: 'rotate', label: 'Equal priorities take turns' }]} />
                  </label>
                  {(p === 'hero' || p === 'announcement') && (
                    <label className={labelClass}>Seconds per advert <span className={hintClass}>Moves on only when there are several, never for visitors who ask for less motion</span>
                      <NumberInput className="mt-1" decimals={0} min={4} max={30} disabled={!canManage} value={v.intervalS} onChange={(n) => change(p, { intervalS: Math.min(30, Math.max(4, n ?? 7)) })} />
                    </label>
                  )}
                </div>
              )}
              {v.enabled && p === 'popup' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Wait before showing (seconds)
                    <NumberInput className="mt-1" decimals={0} min={3} max={120} disabled={!canManage} value={v.popupDelayS} onChange={(n) => change(p, { popupDelayS: Math.min(120, Math.max(3, n ?? 8)) })} />
                  </label>
                  <label className={labelClass}>Show the same visitor again after (hours)
                    <NumberInput className="mt-1" decimals={0} min={6} max={720} disabled={!canManage} value={v.popupEveryH} onChange={(n) => change(p, { popupEveryH: Math.min(720, Math.max(6, n ?? 24)) })} />
                  </label>
                  <p className="text-xs text-app-text-muted sm:col-span-2">One pop-up per visit at most. Never on the cart, checkout or account pages. Closes with Esc or a tap outside.</p>
                </div>
              )}
              {canManage && changed && (
                <button type="button" className={primaryClass} disabled={saving === p} onClick={() => save(p)}><Save size={15} /> {saving === p ? 'Saving…' : 'Save'}</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
