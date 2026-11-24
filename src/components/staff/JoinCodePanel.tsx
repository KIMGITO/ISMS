// src/components/staff/JoinCodePanel.tsx
// Workers -> Join code: one code per branch that people type (or scan) after making an account.
// They don't get in by the code alone: their request shows here and someone who may invite
// staff lets them in with a role, or turns them away (decide_join_request, 20261204003).

import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, KeyRound, RefreshCw, UserCheck, X } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import { getDynamicRoles } from '../../utils/permissions';
import { toUserMessage } from '../../utils/userError';
import { useNotificationStore } from '../../stores/notificationStore';
import { Segmented } from '../shared/Choice';
import SearchableDropdown from '../SearchableDropdown';

interface JoinCode {
  code: string;
  expires_at: string;
}

interface JoinRequest {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
}

/** "ABCDEFGH" -> "ABCD-EFGH" (easier to read out). */
export const showJoinCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** The web address that opens the join screen with the code filled in, when the app runs on the web. */
function joinLink(code: string): string | null {
  if (typeof window === 'undefined') return null;
  const origin = window.location.origin;
  if (!origin.startsWith('https://')) return null;
  return `${origin}/?join=${code}`;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

export default function JoinCodePanel({ businessId }: { businessId: string }) {
  const myRole = useAuthStore((s) => s.currentEmployee?.role);
  const [code, setCode] = useState<JoinCode | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [c, r] = await Promise.all([
      supabase.rpc('get_join_code', { p_business_id: businessId }),
      supabase
        .from('join_requests')
        .select('id, name, email, phone, created_at')
        .eq('business_id', businessId)
        .eq('status', 'pending')
        .order('created_at'),
    ]);
    if (!c.error) setCode((c.data as JoinCode) ?? null);
    if (!r.error) setRequests((r.data as JoinRequest[]) ?? []);
  }, [businessId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!code) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(joinLink(code.code) ?? showJoinCode(code.code), { margin: 1, width: 160 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [code]);

  // Only the Owner makes admins (the database refuses it for anyone else).
  const roleOptions = Object.values(getDynamicRoles())
    .filter((r) => !['Owner', 'Supplier'].includes(r.name))
    .filter((r) => myRole === 'Owner' || !['Admin', 'Administrator'].includes(r.name))
    .map((r) => ({ id: r.name, label: r.name }));

  const call = async (fn: () => PromiseLike<{ error: any }>, ok?: string) => {
    setBusy(true);
    setError('');
    const { error: err } = await fn();
    setBusy(false);
    if (err) {
      setError(toUserMessage(err, 'That did not work. Please try again.'));
      return false;
    }
    if (ok) useNotificationStore.getState().showToast(ok, '', undefined, 'success');
    await load();
    return true;
  };

  const supabase = getSupabase();

  return (
    <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <div className="border-b border-app-border/40 pb-2.5">
        <h3 className="text-xs font-bold text-app-text flex items-center gap-1.5">
          <KeyRound size={14} className="text-amber-500" aria-hidden /> Join code
        </h3>
        <p className="text-[11px] text-app-text-muted mt-0.5">
          For people who already have an account. They enter the code, then you let them in and choose their role.
        </p>
      </div>

      {code ? (
        <div className="flex flex-wrap items-center gap-4">
          {qr && <img src={qr} alt="QR code of the join code" className="w-28 h-28 rounded-lg bg-white p-1" />}
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-lg font-bold tracking-widest text-app-text font-mono">{showJoinCode(code.code)}</span>
            <span className="text-[11px] text-app-text-muted">Works until {day(code.expires_at)}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-app-text px-2.5 py-1.5 rounded-lg border border-app-border hover:bg-app-bg"
                onClick={() => {
                  navigator.clipboard?.writeText(joinLink(code.code) ?? showJoinCode(code.code)).then(
                    () => useNotificationStore.getState().showToast('Copied', '', undefined, 'success'),
                    () => {},
                  );
                }}
              >
                <Copy size={12} aria-hidden /> Copy
              </button>
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500 px-2.5 py-1.5 rounded-lg border border-app-border hover:bg-app-bg"
                onClick={() => call(() => supabase.rpc('revoke_join_code', { p_business_id: businessId }), 'Join code stopped')}
              >
                <X size={12} aria-hidden /> Stop code
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-app-text-muted">No join code now.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<'1' | '7' | '30'>
          size="sm"
          ariaLabel="How long the code works"
          value={days}
          onChange={setDays}
          options={[
            { id: '1', label: '1 day' },
            { id: '7', label: '7 days' },
            { id: '30', label: '30 days' },
          ]}
        />
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-semibold disabled:opacity-60"
          onClick={() => call(() => supabase.rpc('create_join_code', { p_business_id: businessId, p_days: Number(days) }))}
        >
          <RefreshCw size={12} aria-hidden /> {code ? 'New code' : 'Make a code'}
        </button>
        {code && <span className="text-[11px] text-app-text-muted">A new code stops the old one.</span>}
      </div>

      {error && <p className="text-[11px] font-semibold text-red-500">{error}</p>}

      {requests.length > 0 && (
        <div className="flex flex-col gap-2 pt-1">
          <span className="text-[11px] font-bold text-app-text">Asking to join ({requests.length})</span>
          {requests.map((r) => (
            <div key={r.id} className="rounded-xl border border-app-border bg-app-bg p-3 flex flex-col gap-2">
              <div className="min-w-0 text-[11px]">
                <span className="font-semibold text-app-text block">{r.name}</span>
                <span className="text-app-text-muted break-all">
                  {[r.email, r.phone].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[10rem]">
                  <SearchableDropdown
                    items={roleOptions}
                    selectedValue={roles[r.id] ?? 'Cashier'}
                    onChange={(v: string) => setRoles({ ...roles, [r.id]: v })}
                    placeholder="Choose a role"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-60"
                  onClick={() =>
                    call(
                      () => supabase.rpc('decide_join_request', { p_request_id: r.id, p_approve: true, p_role: roles[r.id] ?? 'Cashier' }),
                      `${r.name} can now open the business`,
                    ).then((ok) => ok && useAuthStore.getState().refreshSession())
                  }
                >
                  <UserCheck size={12} aria-hidden /> Let in
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-app-border text-app-text text-[11px] font-semibold hover:bg-app-card"
                  onClick={() => call(() => supabase.rpc('decide_join_request', { p_request_id: r.id, p_approve: false }))}
                >
                  <X size={12} aria-hidden /> Turn away
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {requests.length === 0 && code && (
        <p className="text-[11px] text-app-text-muted inline-flex items-center gap-1">
          <Check size={12} aria-hidden /> Nobody is waiting.
        </p>
      )}
    </div>
  );
}
