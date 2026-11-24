// src/components/website/WebAddressCard.tsx
// Online Store -> Settings: where the shop lives on the web (SaaS step 6, 20261204004).
// Its address is <website name>.<platform domain>; the name can change twice a year and the old
// address forwards for 90 days. Companies with "Own web address" (Pro Plus, or a Pro add-on) can
// use their own domain: added through the website-domain edge function (Cloudflare for SaaS).

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, RefreshCw, Trash2 } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { SupabaseService } from '../../services/supabaseService';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

export interface WebAddressInfo {
  slug: string | null;
  platform_domain: string | null;
  address: string | null;
  home: string | null;
  open: boolean;
  orders_open: boolean;
  changes_left: number | null;
  next_change_at: string | null;
  old_names: { slug: string; until: string }[];
  own_domain_allowed: boolean;
  domain_target: string | null;
  domain: {
    hostname: string;
    status: 'pending' | 'active' | 'failed';
    dns_records: DnsRecord[];
    last_error: string | null;
    checked_at: string | null;
  } | null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

const STATUS: Record<string, [string, string]> = {
  active: ['Working', 'bg-emerald-500/15 text-emerald-600'],
  pending: ['Waiting for your DNS', 'bg-amber-500/15 text-amber-600'],
  failed: ['Not working', 'bg-red-500/15 text-red-500'],
};

export default function WebAddressCard({ businessId, reloadKey }: { businessId: string; reloadKey?: number }) {
  const [info, setInfo] = useState<WebAddressInfo | null>(null);
  const [error, setError] = useState('');
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useNotificationStore((s) => s.showToast);

  const load = useCallback(async () => {
    const { data, error: err } = await getSupabase().rpc('website_address_info', { p_business_id: businessId });
    if (err) {
      // Older database without addresses yet: the card stays hidden.
      setInfo(null);
      return;
    }
    setInfo(data as WebAddressInfo);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const domainCall = async (action: 'add' | 'check' | 'remove', ok: string) => {
    setBusy(true);
    setError('');
    try {
      await SupabaseService.callEdgeFunction('website-domain', { action, businessId, hostname: hostname.trim() || undefined });
      toast('Web address', ok, undefined, 'success');
      if (action === 'add') setHostname('');
    } catch (err) {
      setError(toUserMessage(err, 'That did not work. Please try again.'));
    } finally {
      setBusy(false);
      load();
    }
  };

  if (!info) return null;

  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => toast('Copied', '', undefined, 'success'), () => {});

  return (
    <section className="rounded-xl border border-app-border bg-app-card p-4 space-y-3">
      <h3 className="flex items-center gap-2 font-bold text-app-text"><Globe size={16} /> Web address</h3>

      {!info.open && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-app-text">
          Your plan doesn't include the online store, so the website is closed. It opens again on Pro Plus, or Pro with the Online store add-on.
        </p>
      )}
      {info.open && !info.orders_open && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-app-text">
          The website shows, but takes no orders until the plan is paid.
        </p>
      )}

      {!info.platform_domain ? (
        <p className="text-sm text-app-text-muted">Shop addresses aren't switched on yet.</p>
      ) : info.home ? (
        <div className="text-sm">
          <span className="text-app-text-muted">Your shop is at </span>
          <a href={`https://${info.home}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-amber-600 break-all">
            {info.home} <ExternalLink size={12} aria-hidden />
          </a>
          {info.address && info.address !== info.home && (
            <span className="block text-app-text-muted">{info.address} sends visitors there.</span>
          )}
        </div>
      ) : (
        <p className="text-sm text-app-text-muted">
          Set a website name below. The shop will be at <span className="font-mono">name.{info.platform_domain}</span>
        </p>
      )}

      {info.slug && (
        <p className="text-xs text-app-text-muted">
          {info.changes_left
            ? `The website name can be changed ${info.changes_left === 1 ? 'once more' : 'twice'} this year. The old address forwards visitors for 90 days.`
            : `The website name can't be changed again until ${info.next_change_at ? day(info.next_change_at) : 'next year'}.`}
        </p>
      )}
      {info.old_names.length > 0 && (
        <p className="text-xs text-app-text-muted">
          Still forwarding: {info.old_names.map((o) => `${o.slug} (until ${day(o.until)})`).join(', ')}
        </p>
      )}

      <div className="border-t border-app-border pt-3 space-y-2">
        <h4 className="text-sm font-semibold text-app-text">Your own domain</h4>
        {!info.own_domain_allowed ? (
          <p className="text-sm text-app-text-muted">Comes with Pro Plus, or as an add-on to Pro.</p>
        ) : info.domain ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-app-text break-all">{info.domain.hostname}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[info.domain.status][1]}`}>
                {STATUS[info.domain.status][0]}
              </span>
            </div>
            {info.domain.status !== 'active' && info.domain.dns_records.length > 0 && (
              <>
                <p className="text-xs text-app-text-muted">
                  Add these at the company you bought the domain from. It can take up to a day to start working.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-app-text-muted">
                        <th className="py-1 pr-2 font-medium">Type</th>
                        <th className="py-1 pr-2 font-medium">Name</th>
                        <th className="py-1 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {info.domain.dns_records.map((r) => (
                        <tr key={`${r.type}${r.name}`} className="border-t border-app-border/50 align-top text-app-text">
                          <td className="py-1.5 pr-2 font-semibold">{r.type}</td>
                          <td className="py-1.5 pr-2 font-mono break-all">{r.name}</td>
                          <td className="py-1.5 font-mono break-all">
                            {r.value}{' '}
                            <button type="button" onClick={() => copy(r.value)} aria-label="Copy value" className="inline-flex align-middle text-app-text-muted hover:text-app-text">
                              <Copy size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {info.domain.last_error && <p className="text-xs text-red-500">{info.domain.last_error}</p>}
            <div className="flex flex-wrap gap-2">
              {info.domain.status !== 'active' && (
                <button type="button" disabled={busy} onClick={() => domainCall('check', 'Checked')} className="inline-flex items-center gap-1 rounded-lg border border-app-border px-3 py-2 text-sm font-semibold text-app-text hover:bg-app-bg disabled:opacity-60">
                  <RefreshCw size={14} /> Check now
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => domainCall('remove', 'Own domain removed')} className="inline-flex items-center gap-1 rounded-lg border border-app-border px-3 py-2 text-sm font-semibold text-red-500 hover:bg-app-bg disabled:opacity-60">
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </>
        ) : (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (hostname.trim()) domainCall('add', 'Added. Now add the DNS records shown.');
            }}
          >
            <input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="shop.example.co.ke"
              aria-label="Your own domain"
              className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text"
            />
            <button type="submit" disabled={busy || !hostname.trim()} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-600 disabled:opacity-60">
              <Check size={14} /> Use this domain
            </button>
          </form>
        )}
        {info.own_domain_allowed && info.domain_target && !info.domain && (
          <p className="text-xs text-app-text-muted">
            You'll point it to <span className="font-mono">{info.domain_target}</span> with a CNAME record. A subdomain such as shop.yourname.co.ke is the easiest.
          </p>
        )}
        {error && <p className="text-sm font-semibold text-red-500">{error}</p>}
      </div>
    </section>
  );
}
