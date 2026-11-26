// src/features/console/ConsoleMoney.tsx
// Money the platform is paid (20261205001, section 3). Nobody types a paid-up date: each payment
// is recorded (amount, how, the code or who took the cash, the day it was paid) and the days it
// buys come from the company's price, the agreed one or the list one. A wrong payment is voided
// with a reason, never deleted, and the dates are worked out again.
// Also our own running costs, which the Home page's break-even uses.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Plus } from 'lucide-react';
import { FormSheet } from '../../components/shared/FormSheet';
import { Field, NumberInput, SearchInput, TextInput, DateTimeInput } from '../../components/shared/Input';
import { Segmented } from '../../components/shared/Choice';
import { Switch } from '../../components/shared/Switch';
import { StatGrid, StatTile } from '../../components/shared/StatTile';
import { getSupabase } from '../../services/supabaseClient';
import { formatMoney } from '../../utils/money';
import { CYCLE_TEXT, StatusPill, btnDanger, btnMain, btnQuiet, card, day, num, useCall } from './common';

type Method = 'M-Pesa' | 'Airtel Money' | 'Cash' | 'Bank' | 'Card';
const METHODS: Method[] = ['M-Pesa', 'Airtel Money', 'Cash', 'Bank', 'Card'];

export interface PaymentRow {
  id: string;
  tenant_id: string | null;
  request_id: string | null;
  company: string | null;
  paid_on: string;
  amount: number;
  method: Method;
  reference: string | null;
  received_by: string | null;
  plan: string;
  cycle: string;
  days: number | null;
  period_from: string | null;
  period_to: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

interface Rate {
  cycle: string;
  list_month?: number;
  list_year?: number;
  month?: number;
  year?: number;
  list_price?: number | null;
  full_price?: number | null;
  agreed: boolean;
}

interface BillingCompany {
  tenant_id: string;
  name: string;
  plan: string;
  cycle: string;
  status: string;
  paid_up_to: string | null;
  agreed_price: number | null;
  rate: Rate | null;
  paid_total: number;
  last_paid_on: string | null;
}

interface Billing {
  received_this_month: number;
  received_last_month: number;
  payments: PaymentRow[];
  companies: BillingCompany[];
}

interface Preview {
  plan: string;
  cycle: string;
  rate: Rate;
  days?: number;
  from?: string;
  to?: string;
  whole_months?: number | null;
  whole_years?: number | null;
  paid_up_now?: string | null;
  paid_before?: number;
  still_owed?: number;
}

/** "pro_plus" -> "Pro plus": the list carries plan codes. */
const planName = (code: string) => (code.charAt(0).toUpperCase() + code.slice(1)).replace(/_/g, ' ');

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** What one payment buys, in words. */
function buysText(p: Preview, amount: number): string {
  if (p.cycle === 'one_time') {
    const owed = num(p.still_owed);
    return owed > 0 ? `Part of the licence. ${formatMoney(owed)} still owed after this.` : 'Pays the licence in full. No end date.';
  }
  const days = num(p.days);
  if (days < 1) return 'This amount buys less than a day.';
  const whole = p.cycle === 'annual' ? num(p.whole_years) : num(p.whole_months);
  const unit = p.cycle === 'annual' ? 'year' : 'month';
  const price = p.cycle === 'annual' ? num(p.rate.year) : num(p.rate.month);
  const exact = price > 0 && Math.abs(amount - whole * price) < 0.005;
  const wholeText = exact ? `${whole} ${unit}${whole === 1 ? '' : 's'}` : `${days} days (not a whole ${unit})`;
  return `${wholeText}: ${day(p.from)} to ${day(p.to)}.`;
}

/**
 * Record a payment for a company (tenantId) or for a waiting request (requestId).
 * Shows what the money buys before it is saved.
 */
export function RecordPaymentSheet({ tenantId, requestId, title, suggestedReference, onClose, onDone }: {
  tenantId?: string | null;
  requestId?: string | null;
  title: string;
  suggestedReference?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { call, busy } = useCall();
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('M-Pesa');
  const [reference, setReference] = useState(suggestedReference ?? '');
  const [receivedBy, setReceivedBy] = useState('');
  const [paidOn, setPaidOn] = useState<string | null>(today());
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // The price and what the amount buys, from the server (the same sum it saves).
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await getSupabase().rpc('platform_payment_preview', {
        p_tenant_id: tenantId ?? null, p_amount: amount ?? 0, p_paid_on: paidOn ? paidOn.slice(0, 10) : null, p_request_id: requestId ?? null,
      });
      if (!live) return;
      if (error) {
        setPreview(null);
        setPreviewError(error.message);
      } else {
        setPreview(data as Preview);
        setPreviewError(null);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [tenantId, requestId, amount, paidOn]);

  const price = preview
    ? preview.cycle === 'one_time' ? num(preview.rate.full_price) : preview.cycle === 'annual' ? num(preview.rate.year) : num(preview.rate.month)
    : 0;
  const unit = preview?.cycle === 'annual' ? 'a year' : preview?.cycle === 'one_time' ? 'once' : 'a month';
  const missing = !amount || amount <= 0
    ? 'Enter the amount paid.'
    : method === 'Cash' ? (receivedBy.trim().length < 2 ? 'Enter who received the cash.' : null)
    : reference.trim().length < 3 ? 'Enter the payment code or bank reference.' : null;
  const tooSmall = preview && preview.cycle !== 'one_time' && num(preview.days) < 1;

  const save = async () => {
    const r = await call('platform_record_payment', {
      p_row: {
        tenant_id: tenantId ?? null, request_id: requestId ?? null, amount, method,
        reference: method === 'Cash' ? (reference.trim() || null) : reference.trim(),
        received_by: method === 'Cash' ? receivedBy.trim() : null,
        paid_on: paidOn ? paidOn.slice(0, 10) : today(), note: note.trim() || null,
      },
    }, 'Payment recorded.');
    if (r) onDone();
  };

  return (
    <FormSheet
      title="Record a payment"
      subtitle={title}
      onClose={onClose}
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnQuiet} onClick={onClose}>Cancel</button>
          <button type="button" className={btnMain} disabled={busy || !!missing || !!tooSmall || !preview} onClick={save}>Record payment</button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {preview && (
          <div className="rounded-xl bg-app-bg p-3 text-xs space-y-1">
            <p>
              <span className="text-app-text-muted">Price: </span>
              <span className="font-semibold tabular-nums">{formatMoney(price)} {unit}</span>
              {preview.rate.agreed ? <span className="text-app-text-muted"> (agreed price)</span> : <span className="text-app-text-muted"> (list price)</span>}
            </p>
            {preview.cycle !== 'one_time' && (
              <p><span className="text-app-text-muted">Paid up now: </span>{preview.paid_up_now ? day(preview.paid_up_now) : 'not yet'}</p>
            )}
            {price > 0 && preview.cycle !== 'one_time' && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(preview.cycle === 'annual' ? [1, 2] : [1, 3, 6, 12]).map((n) => (
                  <button key={n} type="button" onClick={() => setAmount(Math.round(price * n * 100) / 100)}
                    className="rounded-lg bg-app-card px-2 py-1 text-[11px] font-semibold ring-1 ring-app-border cursor-pointer hover:ring-amber-500/50">
                    {n} {preview.cycle === 'annual' ? (n === 1 ? 'year' : 'years') : (n === 1 ? 'month' : 'months')} · {formatMoney(price * n)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {previewError && <p className="text-xs text-red-600">{previewError}</p>}

        <Field label="Amount paid (KSh)">
          <NumberInput value={amount} onChange={setAmount} min={0} />
        </Field>
        <Field label="How they paid" group>
          <Segmented<Method> size="sm" value={method} onChange={setMethod} options={METHODS.map((m) => ({ id: m, label: m === 'Airtel Money' ? 'Airtel' : m }))} />
        </Field>
        {method === 'Cash' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Received by"><TextInput value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Who took the cash" /></Field>
            <Field label="Receipt number (if any)"><TextInput value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label={method === 'Bank' ? 'Bank reference' : method === 'Card' ? 'Card payment reference' : 'Payment code'}>
            <TextInput value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder={method === 'M-Pesa' ? 'e.g. SKL4ABC123' : undefined} />
          </Field>
        )}
        <Field label="Day it was paid" hint="Today or up to 90 days back">
          <DateTimeInput withTime={false} value={paidOn} onChange={setPaidOn} max={today()} />
        </Field>
        <Field label="Note (only platform admins see it)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {preview && amount ? (
          <p className={`rounded-xl p-3 text-xs font-semibold ${tooSmall ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}>
            {buysText(preview, amount)}
          </p>
        ) : null}
        {missing && amount ? <p className="text-xs text-app-text-muted">{missing}</p> : null}
      </div>
    </FormSheet>
  );
}

/** Void a payment: it stays on record, with the reason, and stops counting. */
function VoidSheet({ row, onClose, onDone }: { row: PaymentRow; onClose: () => void; onDone: () => void }) {
  const { call, busy } = useCall();
  const [reason, setReason] = useState('');
  const save = async () => {
    const r = await call('platform_void_payment', { p_payment_id: row.id, p_reason: reason.trim() }, 'Payment voided.');
    if (r) onDone();
  };
  return (
    <FormSheet
      title="Void this payment?"
      subtitle={`${row.company ?? 'Request'} · ${formatMoney(num(row.amount))} · ${row.method}${row.reference ? ` ${row.reference}` : ''}`}
      onClose={onClose}
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnQuiet} onClick={onClose}>Keep it</button>
          <button type="button" className={btnDanger} disabled={busy || reason.trim().length < 3} onClick={save}>Void payment</button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <ul className="rounded-xl bg-app-bg p-3 text-xs space-y-1 list-disc pl-5">
          <li>It stays on record, marked void, with your reason. It can't be undone; record it again if needed.</li>
          {row.cycle !== 'one_time' && row.days ? (
            <li>The {row.days} days it bought are taken off; later payments move earlier, and the company's paid-up date is worked out again.</li>
          ) : (
            <li>The licence counts as paid only by the payments left.</li>
          )}
          <li>It stops counting in money received.</li>
        </ul>
        <Field label="Why"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered twice, payment reversed" autoFocus /></Field>
      </div>
    </FormSheet>
  );
}

function PaymentList({ rows, onVoid, showCompany = true }: { rows: PaymentRow[]; onVoid: (r: PaymentRow) => void; showCompany?: boolean }) {
  if (!rows.length) return <p className="text-xs text-app-text-muted">No payments yet.</p>;
  return (
    <ul className="divide-y divide-app-border/60">
      {rows.map((r) => (
        <li key={r.id} className={`flex items-start gap-3 py-2.5 ${r.voided_at ? 'opacity-60' : ''}`}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">
              {showCompany && <>{r.company ?? 'Request'} · </>}
              <span className={`tabular-nums ${r.voided_at ? 'line-through' : ''}`}>{formatMoney(num(r.amount))}</span>
            </p>
            <p className="text-[11px] text-app-text-muted">
              {day(r.paid_on)} · {r.method}{r.reference ? ` ${r.reference}` : ''}{r.received_by ? ` · taken by ${r.received_by}` : ''}
              {' · '}{CYCLE_TEXT[r.cycle] ?? r.cycle}
              {r.days != null && r.cycle !== 'one_time' ? ` · ${r.days} days` : ''}
              {r.period_from && r.period_to && !r.voided_at ? ` (${day(r.period_from)} to ${day(r.period_to)})` : ''}
              {r.request_id && !r.tenant_id ? ' · waiting for approval' : ''}
            </p>
            {r.voided_at && <p className="text-[11px] text-red-600">Void: {r.void_reason}</p>}
            {r.note && <p className="text-[11px] text-app-text-muted">{r.note}</p>}
          </div>
          {!r.voided_at && (
            <button type="button" onClick={() => onVoid(r)} className="inline-flex items-center gap-1 rounded-lg bg-red-600 hover:bg-red-700 px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer" aria-label="Void this payment" title="Void">
              <Ban size={13} /> Void
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A company's own payments, for the company sheet. */
export function CompanyPayments({ tenantId, name, cycle, reloadKey, onChanged }: {
  tenantId: string; name: string; cycle: string; reloadKey?: unknown; onChanged: () => void;
}) {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from('platform_payments').select('*').eq('tenant_id', tenantId)
      .order('paid_on', { ascending: false }).order('created_at', { ascending: false });
    setRows(((data as any[]) ?? []).map((r) => ({ ...r, cycle: r.billing_cycle, company: name })));
  }, [tenantId, name]);
  useEffect(() => {
    load();
  }, [load, reloadKey]);
  const done = () => {
    setRecording(false);
    setVoiding(null);
    load();
    onChanged();
  };
  const paid = cycle === 'monthly' || cycle === 'annual' || cycle === 'one_time';
  return (
    <div className="space-y-2">
      {paid ? (
        <button type="button" className={btnMain} onClick={() => setRecording(true)}><Plus size={14} /> Record a payment</button>
      ) : (
        <p className="text-xs text-app-text-muted">{cycle === 'trial' ? 'On a trial: nothing to pay yet.' : 'Free: no payments are taken.'}</p>
      )}
      {rows === null ? <p className="text-xs text-app-text-muted">Loading...</p> : <PaymentList rows={rows} onVoid={setVoiding} showCompany={false} />}
      {recording && <RecordPaymentSheet tenantId={tenantId} title={name} onClose={() => setRecording(false)} onDone={done} />}
      {voiding && <VoidSheet row={voiding} onClose={() => setVoiding(null)} onDone={done} />}
    </div>
  );
}

export default function ConsoleMoney({ onOpenCompany }: { onOpenCompany: (tenantId: string) => void }) {
  const { call } = useCall();
  const [b, setB] = useState<Billing | null>(null);
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const [recordFor, setRecordFor] = useState<BillingCompany | null>(null);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [tab, setTab] = useState<'owing' | 'payments'>('owing');

  const load = useCallback(async () => {
    const r = await call<Billing>('platform_billing');
    if (r) setB(r);
  }, [call]);
  useEffect(() => {
    load();
  }, [load]);

  const now = Date.now();
  const owing = useMemo(() => (b?.companies ?? []).filter((c) => c.status === 'grace' || c.status === 'read_only' || c.status === 'suspended'), [b]);
  const dueSoon = useMemo(() => (b?.companies ?? []).filter((c) => c.status === 'active' && c.paid_up_to && new Date(c.paid_up_to).getTime() - now < 7 * 86400000), [b, now]);
  const expected = useMemo(() => (b?.companies ?? []).reduce((s, c) => {
    if (!c.rate || c.status === 'suspended') return s;
    if (c.cycle === 'monthly') return s + num(c.rate.month);
    if (c.cycle === 'annual') return s + num(c.rate.year) / 12;
    return s;
  }, 0), [b]);

  if (!b) return <p className="text-sm text-app-text-muted">Loading...</p>;

  const term = q.trim().toLowerCase();
  const payments = b.payments.filter((p) => !term || `${p.company} ${p.reference} ${p.method} ${p.received_by}`.toLowerCase().includes(term));
  const pickable = b.companies.filter((c) => !term || c.name.toLowerCase().includes(term));
  const done = () => {
    setRecordFor(null);
    setVoiding(null);
    setPicking(false);
    load();
  };
  const priceText = (c: BillingCompany) => {
    if (!c.rate) return '';
    if (c.cycle === 'one_time') return `${formatMoney(num(c.rate.full_price))} once · ${formatMoney(num(c.paid_total))} paid`;
    return `${formatMoney(c.cycle === 'annual' ? num(c.rate.year) : num(c.rate.month))} ${c.cycle === 'annual' ? 'a year' : 'a month'}${c.rate.agreed ? ' (agreed)' : ''}`;
  };

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatTile label="Received this month" value={formatMoney(num(b.received_this_month))} note={`${formatMoney(num(b.received_last_month))} last month`} tone="emerald" />
        <StatTile label="Expected each month" value={formatMoney(expected)} note="From paying companies" tone="emerald" />
        <StatTile label="Behind on paying" value={owing.length} note={owing.length ? 'Grace, read-only or suspended' : 'Nobody'} tone={owing.length ? 'red' : 'slate'} />
        <StatTile label="Due within 7 days" value={dueSoon.length} tone={dueSoon.length ? 'amber' : 'slate'} />
      </StatGrid>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnMain} onClick={() => setPicking(true)}><Plus size={14} /> Record a payment</button>
        <SearchInput value={q} onChange={setQ} placeholder="Search companies, codes" className="flex-1 min-w-[12rem]" />
      </div>

      <Segmented<'owing' | 'payments'>
        size="sm"
        value={tab}
        onChange={setTab}
        options={[{ id: 'owing', label: `Who pays (${b.companies.length})` }, { id: 'payments', label: 'Payments' }]}
      />

      {tab === 'owing' ? (
        <div className={card}>
          {!pickable.length ? (
            <p className="text-xs text-app-text-muted">No company pays monthly, yearly or once yet. Set a company's plan and how it pays under Companies.</p>
          ) : (
            <ul className="divide-y divide-app-border/60">
              {pickable.map((c) => (
                <li key={c.tenant_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <button type="button" onClick={() => onOpenCompany(c.tenant_id)} className="min-w-0 flex-1 text-left cursor-pointer">
                    <p className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold truncate">{c.name}</span>
                      <StatusPill status={c.status} />
                    </p>
                    <p className="text-[11px] text-app-text-muted">
                      {planName(c.plan)} · {CYCLE_TEXT[c.cycle] ?? c.cycle} · {priceText(c)}
                    </p>
                    <p className="text-[11px] text-app-text-muted">
                      {c.cycle === 'one_time'
                        ? (c.paid_up_to ? 'Not fully paid' : 'Paid in full')
                        : `Paid up to ${c.paid_up_to ? day(c.paid_up_to) : 'not paid yet'}`}
                      {c.last_paid_on ? ` · last paid ${day(c.last_paid_on)}` : ''}
                    </p>
                  </button>
                  <button type="button" className={`${btnQuiet} self-start sm:self-auto`} onClick={() => setRecordFor(c)}>Record payment</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className={card}><PaymentList rows={payments} onVoid={setVoiding} /></div>
      )}

      {picking && (
        <FormSheet title="Who paid?" onClose={() => setPicking(false)}>
          <div className="space-y-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search companies" autoFocus />
            {pickable.map((c) => (
              <button key={c.tenant_id} type="button" onClick={() => { setPicking(false); setRecordFor(c); }}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-app-bg cursor-pointer">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold truncate">{c.name}</span>
                  <span className="block text-[11px] text-app-text-muted">{priceText(c)}</span>
                </span>
                <StatusPill status={c.status} />
              </button>
            ))}
            {!pickable.length && <p className="text-xs text-app-text-muted">No paying company matches. A request's payment is recorded from Requests.</p>}
          </div>
        </FormSheet>
      )}
      {recordFor && <RecordPaymentSheet tenantId={recordFor.tenant_id} title={recordFor.name} onClose={() => setRecordFor(null)} onDone={done} />}
      {voiding && <VoidSheet row={voiding} onClose={() => setVoiding(null)} onDone={done} />}
    </div>
  );
}

// ============================================================================================
// Our running costs (break-even on Home)
// ============================================================================================
interface CostRow {
  id?: string;
  item: string;
  kind: 'fixed' | 'per_company' | 'share';
  per: 'month' | 'year';
  amount: number;
  note: string | null;
  active: boolean;
  sort: number;
}

const KIND_TEXT: Record<CostRow['kind'], string> = {
  fixed: 'Each month, whatever the number of companies',
  per_company: 'For each paying company, a month',
  share: 'A percent of money received',
};

export function RunningCostsSection() {
  const { call, busy } = useCall();
  const [rows, setRows] = useState<CostRow[] | null>(null);
  const [removing, setRemoving] = useState<CostRow | null>(null);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from('platform_running_costs').select('*').order('sort');
    setRows((data as CostRow[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const patch = (i: number, p: Partial<CostRow>) => setRows((r) => r && r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async (r: CostRow) => {
    if (await call('platform_save_running_cost', { p_row: r }, 'Saved.')) load();
  };
  const remove = async (r: CostRow) => {
    if (await call('platform_save_running_cost', { p_row: { id: r.id, delete: true } }, 'Removed.')) {
      setRemoving(null);
      load();
    }
  };
  const monthly = (r: CostRow) => (r.per === 'year' ? num(r.amount) / 12 : num(r.amount));
  const totals = (rows ?? []).filter((r) => r.active).reduce(
    (t, r) => ({ ...t, [r.kind]: t[r.kind] + (r.kind === 'share' ? num(r.amount) : monthly(r)) }),
    { fixed: 0, per_company: 0, share: 0 } as Record<CostRow['kind'], number>,
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-app-text-muted">
        What running the platform costs us. The starting figures are estimates from the financial model; replace them with the real bills. Home uses them for break-even.
      </p>
      <StatGrid cols={3}>
        <StatTile label="Fixed, a month" value={formatMoney(totals.fixed)} tone="rose" />
        <StatTile label="Per paying company, a month" value={formatMoney(totals.per_company)} tone="rose" />
        <StatTile label="Share of money received" value={`${totals.share.toFixed(1)}%`} tone="rose" />
      </StatGrid>
      {rows?.map((r, i) => (
        <div key={r.id ?? `new-${i}`} className={`${card} space-y-3`}>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label="What"><TextInput value={r.item} onChange={(e) => patch(i, { item: e.target.value })} /></Field>
            <Field label={r.kind === 'share' ? 'Percent' : 'Amount (KSh)'}>
              <NumberInput value={r.amount} onChange={(v) => patch(i, { amount: v ?? 0 })} min={0} />
            </Field>
          </div>
          <Field label="Counts" group>
            <Segmented<CostRow['kind']> size="sm" value={r.kind} onChange={(kind) => patch(i, { kind })}
              options={[{ id: 'fixed', label: 'Fixed' }, { id: 'per_company', label: 'Per company' }, { id: 'share', label: 'Percent' }]} />
          </Field>
          <p className="text-[11px] text-app-text-muted -mt-1">{KIND_TEXT[r.kind]}</p>
          {r.kind !== 'share' && (
            <Field label="Billed" group>
              <Segmented<'month' | 'year'> size="sm" value={r.per} onChange={(per) => patch(i, { per })}
                options={[{ id: 'month', label: 'Each month' }, { id: 'year', label: 'Each year' }]} />
            </Field>
          )}
          <Field label="Note"><TextInput value={r.note ?? ''} onChange={(e) => patch(i, { note: e.target.value })} /></Field>
          <div className="flex flex-wrap items-center gap-3">
            <Switch checked={r.active} onChange={(v) => patch(i, { active: v })} label="Counted" />
            <button type="button" disabled={busy || !r.item.trim()} className={btnQuiet} onClick={() => save(r)}>Save</button>
            {r.id && <button type="button" disabled={busy} className="text-xs font-semibold text-red-600 cursor-pointer" onClick={() => setRemoving(r)}>Remove</button>}
            {r.kind !== 'share' && r.per === 'year' && <span className="text-[11px] text-app-text-muted">{formatMoney(monthly(r))} a month</span>}
          </div>
        </div>
      ))}
      <button
        type="button"
        className={btnQuiet}
        onClick={() => setRows((r) => [...(r ?? []), { item: '', kind: 'fixed', per: 'month', amount: 0, note: null, active: true, sort: ((r?.length ?? 0) + 1) * 10 }])}
      >
        <Plus size={14} /> Add a cost
      </button>
      {removing && (
        <FormSheet
          title="Remove this cost?"
          subtitle={removing.item}
          onClose={() => setRemoving(null)}
          footer={
            <div className="flex gap-2 justify-end">
              <button type="button" className={btnQuiet} onClick={() => setRemoving(null)}>Keep it</button>
              <button type="button" className={btnDanger} disabled={busy} onClick={() => remove(removing)}>Remove</button>
            </div>
          }
        >
          <p className="text-sm text-app-text-muted">
            Break-even on Home will no longer count {removing.kind === 'share' ? `${removing.amount}% of money received` : `${formatMoney(monthly(removing))} a month`}. To stop counting it for now but keep it, switch off "Counted" instead.
          </p>
        </FormSheet>
      )}
    </div>
  );
}
