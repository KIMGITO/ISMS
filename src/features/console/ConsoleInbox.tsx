// Console: module requests (approve only against a recorded payment) and support messages.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../../services/supabaseClient';
import { formatMoney } from '../../utils/money';
import { TextInput } from '../../components/shared/Input';
import SearchableDropdown from '../../components/SearchableDropdown';
import { ActionBar, ConfirmButton, Note, card, day, when, useCall, btnSave } from './common';

interface Req { id: string; tenant_id: string; business_id: string; module_key: string; note: string | null; payment_reference: string | null; status: string; created_at: string }
interface Pay { id: string; tenant_id: string; amount: number; paid_on: string; method: string; reference: string | null; voided_at: string | null }

export function ModuleRequests() {
  const { call, busy } = useCall();
  const [rows, setRows] = useState<Req[] | null>(null);
  const [pays, setPays] = useState<Pay[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const load = useCallback(async () => {
    const sb = getSupabase();
    const [r, p, t, m] = await Promise.all([
      sb.from('module_requests').select('*').eq('status', 'pending').order('created_at'),
      sb.from('platform_payments').select('*').is('voided_at', null).order('paid_on', { ascending: false }).limit(300),
      sb.rpc('platform_tenants'),
      sb.from('plan_modules').select('key, addon_monthly_price'),
    ]);
    setPrices(Object.fromEntries(((m.data as any[]) ?? []).map((x) => [x.key, x.addon_monthly_price == null ? null : Number(x.addon_monthly_price)])));
    setRows((r.data as Req[]) ?? []);
    setPays((p.data as Pay[]) ?? []);
    setNames(Object.fromEntries(((t.data as any[]) ?? []).map((x) => [x.tenant_id, x.name])));
  }, []);
  useEffect(() => { load(); }, [load]);
  const decide = async (r: Req, ok: boolean) => {
    if (await call('platform_decide_module_request', { p_id: r.id, p_approve: ok, p_payment_id: ok ? pick[r.id] : null, p_note: note[r.id] ?? null }, ok ? 'Module turned on.' : 'Request turned down.')) load();
  };
  if (!rows) return <p className="text-sm text-app-text-muted">Loading...</p>;
  if (!rows.length) return <p className={`${card} text-sm text-app-text-muted`}>No module requests waiting.</p>;
  return (
    <div className="space-y-3">
      <Note tone="warn">Approve only once their payment is recorded (Companies → company → Payments). Pick that payment below.</Note>
      {rows.map((r) => {
        const theirs = pays.filter((p) => p.tenant_id === r.tenant_id);
        const price = prices[r.module_key] ?? null;
        return (
          <div key={r.id} className={`${card} space-y-2`}>
            <p className="text-sm font-semibold">{names[r.tenant_id] ?? 'Company'} wants <span className="text-amber-600">{r.module_key.replace(/_/g, ' ')}</span></p>
            <p className="text-xs text-app-text-muted">Price: {price == null ? 'not set (set it in Plans → Add-ons first)' : `${formatMoney(price)} a month`}</p>
            <p className="text-xs text-app-text-muted">Asked {when(r.created_at)}{r.payment_reference ? ` · their payment ref: ${r.payment_reference}` : ' · no payment ref given'}</p>
            {theirs.length ? (
              <SearchableDropdown
                items={theirs.map((p) => ({ id: p.id, label: `${formatMoney(p.amount)} · ${p.method}`, sublabel: `${day(p.paid_on)}${p.reference ? ` · ${p.reference}` : ''}` }))}
                selectedValue={pick[r.id] ?? ''}
                onChange={(v) => setPick((x) => ({ ...x, [r.id]: v }))}
                placeholder="Pick the payment for this module"
                searchPlaceholder="Search payments"
              />
            ) : <Note tone="danger">No payment recorded for this company yet.</Note>}
            <TextInput value={note[r.id] ?? ''} onChange={(e) => setNote((x) => ({ ...x, [r.id]: e.target.value }))} placeholder="Note to them (optional)" />
            <ActionBar>
              <ConfirmButton tone="danger" label="Turn down" disabled={busy} question="Turn this request down?" onConfirm={() => decide(r, false)} />
              <ConfirmButton tone="save" label="Approve" disabled={busy || !pick[r.id] || price == null} question={`Turn on ${r.module_key.replace(/_/g, ' ')}?`} details="It is added to this company's extra modules." onConfirm={() => decide(r, true)} />
            </ActionBar>
          </div>
        );
      })}
    </div>
  );
}

interface Msg { id: string; tenant_id: string; business_id: string; from_platform: boolean; sender_name: string | null; body: string; created_at: string }

export function SupportMessages() {
  const { call, busy } = useCall();
  const [rows, setRows] = useState<Msg[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const load = useCallback(async () => {
    const sb = getSupabase();
    const [m, t] = await Promise.all([sb.from('support_messages').select('*').order('created_at', { ascending: false }).limit(500), sb.rpc('platform_tenants')]);
    setRows((m.data as Msg[]) ?? []);
    setNames(Object.fromEntries(((t.data as any[]) ?? []).map((x) => [x.tenant_id, x.name])));
  }, []);
  useEffect(() => { load(); }, [load]);
  const threads = useMemo(() => {
    const by = new Map<string, Msg[]>();
    for (const m of rows ?? []) by.set(m.business_id, [...(by.get(m.business_id) ?? []), m]);
    return [...by.entries()];
  }, [rows]);
  if (!rows) return <p className="text-sm text-app-text-muted">Loading...</p>;
  if (!threads.length) return <p className={`${card} text-sm text-app-text-muted`}>No messages yet.</p>;
  return (
    <div className="space-y-2">
      {threads.map(([bid, list]) => {
        const waiting = !list[0].from_platform;
        return (
          <div key={bid} className={`${card} space-y-2`}>
            <button type="button" className="flex w-full items-center gap-2 text-left cursor-pointer" onClick={() => setOpenId(openId === bid ? null : bid)}>
              <span className={`h-2.5 w-2.5 rounded-full ${waiting ? 'bg-red-500' : 'bg-emerald-500'}`} />
              <span className="text-sm font-semibold flex-1">{names[list[0].tenant_id] ?? 'Company'}</span>
              <span className="text-[11px] text-app-text-muted">{waiting ? 'Needs a reply · ' : ''}{when(list[0].created_at)}</span>
            </button>
            {openId !== bid ? <p className="text-xs text-app-text-muted truncate">{list[0].body}</p> : (
              <>
                {[...list].reverse().map((m) => (
                  <div key={m.id} className={`rounded-xl p-2.5 text-sm ${m.from_platform ? 'bg-sky-500/10 ml-8' : 'bg-app-bg mr-8'}`}>
                    <p className="text-[11px] text-app-text-muted">{m.from_platform ? 'You' : m.sender_name ?? 'Them'} · {when(m.created_at)}</p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
                <div className="flex gap-2">
                  <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply" className="flex-1" />
                  <button type="button" className={btnSave} disabled={busy || !text.trim()} onClick={async () => { if (await call('send_support_message', { p_business_id: bid, p_body: text }, 'Sent.')) { setText(''); load(); } }}>Send</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
