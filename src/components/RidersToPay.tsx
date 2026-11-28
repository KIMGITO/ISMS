// Riders to pay: every delivery the shop pays the rider for (on our bill, free for the
// customer, website orders and trips), as bills: filter by paid / not paid and by today,
// this week, this month or all. Riders without an account are listed by the name typed at
// the sale. Rider pay counts as spending on the day it's owed; paying it records one expense
// (from petty cash or an account) that moves the money and clears what is owed.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, RotateCcw, Trash2, Wallet } from 'lucide-react';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn } from './shared/FormSheet';
import { Checkbox } from './shared/Checkbox';
import { Segmented } from './shared/Choice';
import SearchableDropdown from './SearchableDropdown';
import { ReasonSheet } from './buying/BuyingSheets';
import { formatCurrency } from '../utils/helpers';
import { toUserMessage } from '../utils/userError';
import {
  loadRidersToPay, payRider, removeRiderPayment,
  type PayFrom, type RiderPayItem, type RiderPayment, type RiderToPay,
} from '../services/riderPay';
import type { ShowToast } from '../stores/notificationStore';

const TZ = 'Africa/Nairobi';
const METHODS = ['Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'];
const STATUS: Record<string, string> = { delivered: 'Delivered', out_for_delivery: 'On the way', assigned: 'Not delivered yet' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: TZ });

export type BillStatusFilter = 'unpaid' | 'paid' | 'all';
export type BillPeriod = 'today' | 'week' | 'month' | 'all';

export const STATUS_FILTERS: { id: BillStatusFilter; label: string }[] = [
  { id: 'unpaid', label: 'Not paid' },
  { id: 'paid', label: 'Paid' },
  { id: 'all', label: 'All' },
];
export const PERIODS: { id: BillPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All' },
];

/** Start of the period on the Kenya clock (weeks start on Monday), or null for all time. */
export function periodStart(p: BillPeriod): Date | null {
  if (p === 'all') return null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  if (p === 'today') return new Date(`${today}T00:00:00+03:00`);
  if (p === 'month') return new Date(`${today.slice(0, 8)}01T00:00:00+03:00`);
  const d = new Date(`${today}T12:00:00+03:00`);
  const back = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - back * 864e5).toISOString().slice(0, 10);
  return new Date(`${monday}T00:00:00+03:00`);
}

/** The status and period chips, shared by the Bills tab and the riders sheet. */
export function BillFilters({ status, period, onStatus, onPeriod }: {
  status: BillStatusFilter; period: BillPeriod; onStatus: (s: BillStatusFilter) => void; onPeriod: (p: BillPeriod) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,22rem)]">
      <Segmented<BillStatusFilter> options={STATUS_FILTERS} value={status} onChange={onStatus} size="sm" ariaLabel="Paid or not" />
      <Segmented<BillPeriod> options={PERIODS} value={period} onChange={onPeriod} size="sm" ariaLabel="When" />
    </div>
  );
}

type Toast = ShowToast;

const payState = (i: RiderPayItem) =>
  i.balance <= 0 ? { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }
  : i.paid > 0 ? { label: 'Part paid', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }
  : { label: 'Not paid', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' };

/** Rider bills with filters and a Pay sheet. Pass `status`/`period` to control the filters
 *  from outside (the Bills tab shares them with supplier bills); otherwise it shows its own. */
export function RidersToPayList({
  businessId, canPettyCash, canAccount, canRemove = false, defaultFrom, onPaid, onToast, status: statusIn, period: periodIn,
}: {
  businessId: string;
  canPettyCash: boolean;
  canAccount: boolean;
  canRemove?: boolean;
  defaultFrom: PayFrom;
  onPaid?: () => void;
  onToast: Toast;
  status?: BillStatusFilter;
  period?: BillPeriod;
}) {
  const [ownStatus, setOwnStatus] = useState<BillStatusFilter>('unpaid');
  const [ownPeriod, setOwnPeriod] = useState<BillPeriod>('all');
  const status = statusIn ?? ownStatus;
  const period = periodIn ?? ownPeriod;

  const [data, setData] = useState<{ riders: RiderToPay[]; items: RiderPayItem[]; payments: RiderPayment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<RiderToPay | null>(null);
  const [removing, setRemoving] = useState<RiderPayment | null>(null);

  const start = useMemo(() => periodStart(period), [period]);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await loadRidersToPay(businessId, start));
    } catch (e) {
      setError(toUserMessage(e, 'Could not load riders to pay.'));
    }
  }, [businessId, start]);

  useEffect(() => { void load(); }, [load]);

  const inPeriod = (iso: string) => !start || new Date(iso) >= start;
  const items = useMemo(
    () => (data?.items || []).filter((i) => inPeriod(i.date)
      && (status === 'all' || (status === 'paid' ? i.balance <= 0 : i.balance > 0))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, status, start],
  );
  const groups = useMemo(() => {
    const m = new Map<string, RiderPayItem[]>();
    for (const i of items) m.set(i.riderKey, [...(m.get(i.riderKey) || []), i]);
    return [...m.entries()];
  }, [items]);
  const riderOf = (key: string) => data?.riders.find((r) => r.key === key);
  const payments = (data?.payments || []).filter((p) => inPeriod(p.date));

  const owedNow = (data?.riders || []).reduce((s, r) => s + r.owed, 0);
  const earned = items.reduce((s, i) => s + i.amount, 0);
  const paidShown = payments.filter((p) => !p.removed).reduce((s, p) => s + p.amount, 0);
  const canPay = canPettyCash || canAccount;
  const periodLabel = PERIODS.find((p) => p.id === period)!.label.toLowerCase();

  return (
    <div className="space-y-3">
      {statusIn === undefined && (
        <BillFilters status={status} period={period} onStatus={setOwnStatus} onPeriod={setOwnPeriod} />
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          {error}
          <button onClick={() => void load()} className="inline-flex items-center gap-1 underline cursor-pointer"><RotateCcw size={13} /> Try again</button>
        </div>
      )}
      {data === null && !error && <p className="text-sm text-app-text-muted">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-app-bg ring-1 ring-app-border/70 p-2">
              <p className="text-[11px] text-app-text-muted">Owed now</p>
              <p className="text-sm font-bold tabular-nums">{formatCurrency(owedNow)}</p>
            </div>
            <div className="rounded-xl bg-app-bg ring-1 ring-app-border/70 p-2">
              <p className="text-[11px] text-app-text-muted">In this list</p>
              <p className="text-sm font-bold tabular-nums">{formatCurrency(earned)}</p>
            </div>
            <div className="rounded-xl bg-app-bg ring-1 ring-app-border/70 p-2">
              <p className="text-[11px] text-app-text-muted">Paid {period === 'all' ? '' : periodLabel}</p>
              <p className="text-sm font-bold tabular-nums">{formatCurrency(paidShown)}</p>
            </div>
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-app-text-muted">
              {status === 'unpaid' ? 'No rider is owed anything' : status === 'paid' ? 'No paid deliveries' : 'No deliveries'}
              {period === 'all' ? '.' : ` ${periodLabel}.`}
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map(([key, rows]) => {
                const r = riderOf(key);
                const name = r?.name || rows[0].rider;
                return (
                  <section key={key} className="rounded-xl ring-1 ring-app-border/70 overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2 bg-app-bg">
                      <span className="grid place-items-center size-8 shrink-0 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400"><Bike size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{name}{r && !r.riderId && <span className="text-[11px] font-normal text-app-text-muted"> · no account</span>}</p>
                        <p className="text-[11px] text-app-text-muted">
                          Owes {formatCurrency(r?.owed || 0)}{r && r.ahead > 0 ? ` · ${formatCurrency(r.ahead)} paid ahead` : ''}
                        </p>
                      </div>
                      {canPay && r && r.owed > 0 && (
                        <button className={`${primaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => setPaying(r)}><Wallet size={13} /> Pay</button>
                      )}
                    </div>
                    <ul className="divide-y divide-app-border/60">
                      {rows.map((i) => {
                        const st = payState(i);
                        return (
                          <li key={`${i.kind}:${i.id}`} className="px-3 py-2 flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm truncate">{i.customer}{i.place ? ` · ${i.place}` : ''}</p>
                              <p className="text-[11px] text-app-text-muted">
                                {day(i.date)} · {i.reference} · {STATUS[i.status] || i.status}
                                {i.paid > 0 && i.balance > 0 ? ` · ${formatCurrency(i.balance)} left` : ''}
                              </p>
                            </div>
                            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(i.amount)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}

          {payments.length > 0 && status !== 'unpaid' && (
            <div>
              <p className="text-xs font-semibold text-app-text-muted mb-1">Payments{period === 'all' ? '' : ` ${periodLabel}`}</p>
              <ul className="divide-y divide-app-border/60 text-xs">
                {payments.map((p) => (
                  <li key={p.expenseId} className={`py-2 flex items-center gap-3 ${p.removed ? 'opacity-60' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium text-app-text truncate ${p.removed ? 'line-through' : ''}`}>{p.rider} · {p.deliveries} {p.deliveries === 1 ? 'delivery' : 'deliveries'}</p>
                      <p className="text-[11px] text-app-text-muted">{day(p.date)} · {p.from === 'petty_cash' ? 'Petty cash' : p.method} · by {p.by}{p.removed ? ' · removed' : ''}</p>
                    </div>
                    <span className="tabular-nums font-semibold text-app-text">{formatCurrency(p.amount)}</span>
                    {canRemove && !p.removed && (
                      <button type="button" onClick={() => setRemoving(p)} aria-label="Remove payment" title="Remove payment" className="p-1.5 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-red-500/10 cursor-pointer">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {paying && data && (
        <PayRiderSheet
          businessId={businessId}
          rider={paying}
          items={data.items.filter((i) => i.riderKey === paying.key && i.balance > 0).sort((a, b) => a.date.localeCompare(b.date))}
          canPettyCash={canPettyCash}
          canAccount={canAccount}
          defaultFrom={defaultFrom}
          onClose={() => setPaying(null)}
          onDone={(amount) => {
            onToast('Rider paid', `${paying.name} · ${formatCurrency(amount)}`, undefined, 'success');
            setPaying(null);
            void load();
            onPaid?.();
          }}
        />
      )}
      {removing && (
        <ReasonSheet
          title={`Remove ${formatCurrency(removing.amount)} paid to ${removing.rider}?`}
          message="The money goes back to where it came from and these deliveries are owed again."
          placeholder="e.g. Paid twice by mistake"
          confirmLabel="Remove payment"
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await removeRiderPayment(businessId, removing.expenseId, reason);
            onToast('Payment removed', `${removing.rider} · ${formatCurrency(removing.amount)}`, undefined, 'success');
            setRemoving(null);
            void load();
            onPaid?.();
          }}
        />
      )}
    </div>
  );
}

function PayRiderSheet({ businessId, rider, items, canPettyCash, canAccount, defaultFrom, onClose, onDone }: {
  businessId: string;
  rider: RiderToPay;
  items: RiderPayItem[];
  canPettyCash: boolean;
  canAccount: boolean;
  defaultFrom: PayFrom;
  onClose: () => void;
  onDone: (amount: number) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map((i) => `${i.kind}:${i.id}`)));
  const [from, setFrom] = useState<PayFrom>(defaultFrom === 'petty_cash' && canPettyCash ? 'petty_cash' : canAccount ? 'account' : 'petty_cash');
  const [method, setMethod] = useState('M-Pesa');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // One id per sheet, so a retry after a dropped connection never pays twice.
  const [referenceId] = useState(() => `rider-pay-${crypto.randomUUID()}`);

  const total = useMemo(
    () => items.filter((i) => picked.has(`${i.kind}:${i.id}`)).reduce((s, i) => s + i.balance, 0),
    [items, picked],
  );
  const all = picked.size === items.length;
  const toggle = (k: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(k); else n.delete(k); return n; });

  const save = async () => {
    if (busy || total <= 0) return;
    setBusy(true);
    setErr(null);
    try {
      const chosen = all ? null : items.filter((i) => picked.has(`${i.kind}:${i.id}`)).map((i) => ({ kind: i.kind, id: i.id }));
      const r = await payRider(businessId, rider.key, chosen, from, method, note, referenceId);
      onDone(r.amount);
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the payment.'));
      setBusy(false);
    }
  };

  const fromOptions = [
    ...(canPettyCash ? [{ id: 'petty_cash' as PayFrom, label: 'Petty cash' }] : []),
    ...(canAccount ? [{ id: 'account' as PayFrom, label: 'Account' }] : []),
  ];

  return (
    <FormSheet
      title={`Pay ${rider.name}`}
      subtitle={`Owed ${formatCurrency(rider.owed)} for ${items.length} ${items.length === 1 ? 'delivery' : 'deliveries'}`}
      onClose={onClose}
      footer={
        <>
          <button className={secondaryBtn} disabled={busy} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={busy || total <= 0} onClick={() => void save()}>
            {busy ? 'Saving…' : `Pay ${formatCurrency(total)}`}
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <Checkbox
          checked={all}
          indeterminate={!all && picked.size > 0}
          onChange={(on) => setPicked(on ? new Set(items.map((i) => `${i.kind}:${i.id}`)) : new Set())}
          label={<span className="text-sm font-medium">All deliveries</span>}
        />
        <ul className="max-h-64 overflow-y-auto divide-y divide-app-border/60 pl-1">
          {items.map((i) => {
            const k = `${i.kind}:${i.id}`;
            return (
              <li key={k} className="py-2">
                <Checkbox
                  checked={picked.has(k)}
                  onChange={(on) => toggle(k, on)}
                  label={
                    <span className="flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{i.customer}{i.place ? ` · ${i.place}` : ''}</span>
                      <span className="tabular-nums font-semibold">{formatCurrency(i.balance)}</span>
                    </span>
                  }
                  description={`${day(i.date)} · ${i.reference} · ${STATUS[i.status] || i.status}${i.paid > 0 ? ` · ${formatCurrency(i.paid)} already paid` : ''}`}
                />
              </li>
            );
          })}
        </ul>
      </div>

      {fromOptions.length > 1 && (
        <Field label="Pay from">
          <Segmented<PayFrom> options={fromOptions} value={from} onChange={setFrom} ariaLabel="Pay from" />
        </Field>
      )}
      {from === 'account' && (
        <Field label="Paid with">
          <SearchableDropdown items={METHODS.map((m) => ({ id: m, label: m }))} selectedValue={method} onChange={setMethod} placeholder="Choose how" />
        </Field>
      )}
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="e.g. M-Pesa code, week's pay" className={fieldClass} />
      </Field>
      <p className="text-[11px] text-app-text-muted">
        {from === 'petty_cash'
          ? 'Taken from the till. It shows in the petty cashbook and comes off the cash you count at the end of the shift.'
          : `The ${method} balance on the Payments screen goes down by this amount.`}
        {' '}Profit doesn't change: rider pay was counted on the day of each delivery.
      </p>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

/** A "Pay a rider" button that opens the rider bills in a sheet (Petty cash, Expenses). */
export function PayRiderButton({ businessId, canPettyCash, canAccount, canRemove, defaultFrom, onPaid, onToast, className }: {
  businessId: string;
  canPettyCash: boolean;
  canAccount: boolean;
  canRemove?: boolean;
  defaultFrom: PayFrom;
  onPaid?: () => void;
  onToast: Toast;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className || `${secondaryBtn} shrink-0`}>
        <Bike size={15} /> Pay a rider
      </button>
      {open && (
        <FormSheet title="Riders to pay" subtitle="Deliveries the shop pays the rider for." onClose={() => setOpen(false)} wide>
          <RidersToPayList
            businessId={businessId}
            canPettyCash={canPettyCash}
            canAccount={canAccount}
            canRemove={canRemove}
            defaultFrom={defaultFrom}
            onPaid={onPaid}
            onToast={onToast}
          />
        </FormSheet>
      )}
    </>
  );
}
