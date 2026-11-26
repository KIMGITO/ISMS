// src/components/payments/PaymentsList.tsx
// Every payment received, grouped by day like a supermarket's payments screen. A row shows
// who paid, how, what it paid for and how much, without breaking on a phone. Tapping a row
// opens its details with the actions that fit it: give a walk-in payment to a customer, or void.

import { useMemo, useState } from 'react';
import {
  Banknote, Ban, ChevronRight, CircleDollarSign, CreditCard, Landmark, Smartphone, Store, User as UserIcon, Wallet,
} from 'lucide-react';
import type { MoneyMethod } from '../../types';
import { formatCurrency } from '../../utils/helpers';
import { methodLabel } from '../../utils/paymentMethods';
import { FormSheet } from '../shared/FormSheet';
import { SearchInput, TextInput } from '../shared/Input';
import { Segmented } from '../shared/Choice';
import { CopyRef } from '../shared/CopyRef';
import SearchableDropdown from '../SearchableDropdown';

export interface PaymentRow {
  id: string;
  date: string;
  amount: number | string;
  method: string;
  status: string;
  senderName?: string;
  senderPhone?: string;
  referenceCode?: string;
  description?: string;
  paymentType?: string;
  customerId?: string;
  customerName?: string;
  appliedTo?: string;
  debtApplied?: number | string;
  walletApplied?: number | string;
  recordedBy?: string;
  voidReason?: string;
  voidedBy?: string;
}

interface CustomerLite { id: string; name: string; phone?: string; accountNumber?: string; debtBalance?: number | string; walletBalance?: number | string }

type Period = 'today' | 'week' | 'month' | 'all';
type Kind = 'all' | 'customer' | 'walk-in';

export function MethodIcon({ method, size = 14 }: { method: string; size?: number }) {
  if (method === 'M-Pesa') return <Smartphone size={size} className="text-emerald-600" />;
  if (method === 'Airtel Money') return <Smartphone size={size} className="text-red-600" />;
  if (method === 'Cash') return <Banknote size={size} className="text-amber-600" />;
  if (method === 'Card') return <CreditCard size={size} className="text-blue-600" />;
  if (method === 'Bank') return <Landmark size={size} className="text-violet-600" />;
  return <Wallet size={size} className="text-app-text-muted" />;
}

const isWalkIn = (p: PaymentRow) => !p.customerId && (p.paymentType || 'walk-in') !== 'customer';

/** What the money did, in plain words. */
function appliedText(p: PaymentRow): string {
  if (p.status === 'Voided') return 'Voided';
  if (p.status !== 'Success') return p.status;
  const debt = Number(p.debtApplied || 0);
  const wallet = Number(p.walletApplied || 0);
  if (isWalkIn(p)) return 'Walk-in, not on an account';
  if (debt > 0 && wallet > 0) return `Debt ${formatCurrency(debt)} + wallet ${formatCurrency(wallet)}`;
  if (debt > 0) return `Paid debt ${formatCurrency(debt)}`;
  if (wallet > 0) return `Wallet top-up ${formatCurrency(wallet)}`;
  return 'Customer account';
}

function payerName(p: PaymentRow): string {
  if (!isWalkIn(p)) return p.customerName || p.senderName || 'Customer';
  return p.senderName || p.senderPhone || 'Walk-in';
}

function dayLabel(d: Date): string {
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function amountTone(p: PaymentRow): string {
  if (p.status === 'Voided') return 'text-app-text-muted line-through';
  if (p.status === 'Failed') return 'text-red-500';
  if (p.status === 'Pending') return 'text-amber-600';
  return 'text-app-text';
}

export default function PaymentsList({ payments, customers, canVoid, canAssign, onVoid, onAssign }: {
  payments: PaymentRow[];
  customers: CustomerLite[];
  canVoid: boolean;
  canAssign: boolean;
  onVoid: (id: string, reason: string) => Promise<void>;
  onAssign: (id: string, customerId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<Period>('today');
  const [kind, setKind] = useState<Kind>('all');
  const [method, setMethod] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const methods = useMemo(() => [...new Set(payments.map((p) => p.method))], [payments]);

  const shown = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week') start.setDate(start.getDate() - 6);
    if (period === 'month') start.setDate(start.getDate() - 29);
    const q = query.trim().toLowerCase();
    return payments.filter((p) => {
      if (period !== 'all' && new Date(p.date) < start) return false;
      if (kind === 'customer' && isWalkIn(p)) return false;
      if (kind === 'walk-in' && !isWalkIn(p)) return false;
      if (method !== 'all' && p.method !== method) return false;
      if (!q) return true;
      return [p.senderName, p.customerName, p.senderPhone, p.referenceCode, p.description, String(p.amount)]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [payments, period, kind, method, query]);

  const received = shown.filter((p) => p.status === 'Success').reduce((s, p) => s + Number(p.amount || 0), 0);

  const groups = useMemo(() => {
    const out: { label: string; total: number; rows: PaymentRow[] }[] = [];
    for (const p of shown) {
      const label = dayLabel(new Date(p.date));
      let g = out[out.length - 1];
      if (!g || g.label !== label) { g = { label, total: 0, rows: [] }; out.push(g); }
      g.rows.push(p);
      if (p.status === 'Success') g.total += Number(p.amount || 0);
    }
    return out;
  }, [shown]);

  const open = openId ? payments.find((p) => p.id === openId) : undefined;

  return (
    <section className="bg-app-card border border-app-border rounded-2xl shadow-sm flex flex-col min-w-0">
      <div className="p-4 sm:p-5 flex flex-col gap-3 border-b border-app-border/60">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-app-text">Payments received</h3>
            <p className="text-xs text-app-text-muted">{shown.length} shown · {formatCurrency(received)} received</p>
          </div>
          <Segmented<Period>
            size="sm"
            ariaLabel="Period"
            value={period}
            onChange={setPeriod}
            options={[{ id: 'today', label: 'Today' }, { id: 'week', label: '7 days' }, { id: 'month', label: '30 days' }, { id: 'all', label: 'All' }]}
          />
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, phone, reference or amount" />
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5" role="group" aria-label="Filter">
          {([['all', 'Everyone'], ['customer', 'Customers'], ['walk-in', 'Walk-in']] as const).map(([id, text]) => (
            <button key={id} type="button" onClick={() => setKind(id)} aria-pressed={kind === id}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer ${kind === id ? 'bg-amber-500 border-amber-500 text-slate-950' : 'border-app-border text-app-text-muted hover:text-app-text'}`}>
              {text}
            </button>
          ))}
          <span className="shrink-0 w-px bg-app-border mx-1" />
          {['all', ...methods].map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer ${method === m ? 'bg-app-text border-app-text text-app-card' : 'border-app-border text-app-text-muted hover:text-app-text'}`}>
              {m !== 'all' && <MethodIcon method={m} size={12} />}
              {m === 'all' ? 'All methods' : methodLabel(m as MoneyMethod)}
            </button>
          ))}
        </div>
      </div>

      {/* Column names, only where there is room for columns. */}
      <div className="hidden md:grid grid-cols-[4.5rem_minmax(0,1.4fr)_7.5rem_minmax(0,1.2fr)_8rem_1rem] gap-3 px-5 py-2 text-[11px] font-semibold text-app-text-muted border-b border-app-border/60">
        <span>Time</span><span>Payer</span><span>Method</span><span>Applied to</span><span className="text-right">Amount</span><span />
      </div>

      <div className="lg:max-h-[640px] lg:overflow-y-auto overscroll-contain">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-14 px-4 text-app-text-muted">
            <CircleDollarSign size={30} className="mb-2 opacity-50" />
            <p className="text-sm font-semibold text-app-text">No payments here</p>
            <p className="text-xs mt-0.5">{period === 'all' && !query ? 'Payments you record or receive show here.' : 'Try another period or filter.'}</p>
          </div>
        ) : groups.map((g) => (
          <div key={g.label}>
            <div className="sticky top-0 z-[1] flex items-center justify-between px-4 sm:px-5 py-1.5 bg-app-bg/95 backdrop-blur text-xs font-semibold text-app-text-muted border-b border-app-border/40">
              <span>{g.label}</span><span className="tabular-nums">{formatCurrency(g.total)}</span>
            </div>
            <ul className="divide-y divide-app-border/40">
              {g.rows.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    data-search-id={`pay-${p.id}`}
                    onClick={() => setOpenId(p.id)}
                    className={`w-full text-left px-4 sm:px-5 py-3 hover:bg-app-bg/60 cursor-pointer grid items-center gap-x-3 gap-y-0.5 grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[4.5rem_minmax(0,1.4fr)_7.5rem_minmax(0,1.2fr)_8rem_1rem] ${p.status === 'Voided' ? 'opacity-60' : ''}`}
                  >
                    <span className="hidden md:block text-xs text-app-text-muted tabular-nums">{time(p.date)}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {isWalkIn(p) ? <Store size={13} className="shrink-0 text-app-text-muted" /> : <UserIcon size={13} className="shrink-0 text-blue-500" />}
                        <span className="text-sm font-semibold text-app-text truncate">{payerName(p)}</span>
                      </span>
                      <span className="block text-xs text-app-text-muted truncate md:hidden">
                        {time(p.date)} · {methodLabel(p.method as MoneyMethod)} · {appliedText(p)}
                      </span>
                      <span className="hidden md:block text-xs text-app-text-muted truncate">{p.referenceCode || p.senderPhone || ''}</span>
                    </span>
                    <span className="hidden md:flex items-center gap-1.5 text-xs font-medium text-app-text min-w-0">
                      <MethodIcon method={p.method} /> <span className="truncate">{methodLabel(p.method as MoneyMethod)}</span>
                    </span>
                    <span className={`hidden md:block text-xs truncate ${isWalkIn(p) && p.status === 'Success' ? 'text-app-text-muted' : 'text-app-text'}`}>{appliedText(p)}</span>
                    <span className="text-right">
                      <span className={`block text-sm font-semibold tabular-nums whitespace-nowrap ${amountTone(p)}`}>{formatCurrency(Number(p.amount))}</span>
                      {p.status !== 'Success' && <span className={`block text-[11px] font-semibold ${p.status === 'Pending' ? 'text-amber-600' : p.status === 'Failed' ? 'text-red-500' : 'text-app-text-muted'}`}>{p.status}</span>}
                    </span>
                    <ChevronRight size={16} className="hidden md:block text-app-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {open && (
        <PaymentDetail
          payment={open}
          customers={customers}
          canVoid={canVoid}
          canAssign={canAssign}
          onVoid={onVoid}
          onAssign={onAssign}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-app-border/40 last:border-0">
      <span className="text-xs text-app-text-muted shrink-0">{label}</span>
      <span className="text-sm text-app-text text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

function PaymentDetail({ payment: p, customers, canVoid, canAssign, onVoid, onAssign, onClose }: {
  payment: PaymentRow;
  customers: CustomerLite[];
  canVoid: boolean;
  canAssign: boolean;
  onVoid: (id: string, reason: string) => Promise<void>;
  onAssign: (id: string, customerId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'assign' | 'void'>('view');
  const [customerId, setCustomerId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const live = p.status === 'Success';
  const mayAssign = canAssign && live && isWalkIn(p);
  const mayVoid = canVoid && p.status !== 'Voided';
  const chosen = customers.find((c) => c.id === customerId);
  const debt = Number(chosen?.debtBalance || 0);
  const amount = Number(p.amount || 0);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onClose(); } catch { /* the caller shows the error */ } finally { setBusy(false); }
  };

  const footer = mode === 'assign' ? (
    <>
      <button type="button" onClick={() => setMode('view')} className="min-h-11 px-4 border border-app-border rounded-xl text-sm font-semibold cursor-pointer">Back</button>
      <button type="button" disabled={!customerId || busy} onClick={() => run(() => onAssign(p.id, customerId))}
        className="min-h-11 px-4 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 cursor-pointer">
        {busy ? 'Saving…' : `Give to ${chosen?.name || 'customer'}`}
      </button>
    </>
  ) : mode === 'void' ? (
    <>
      <button type="button" onClick={() => setMode('view')} className="min-h-11 px-4 border border-app-border rounded-xl text-sm font-semibold cursor-pointer">Keep it</button>
      <button type="button" disabled={!reason.trim() || busy} onClick={() => run(() => onVoid(p.id, reason.trim()))}
        className="min-h-11 px-4 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 cursor-pointer">
        {busy ? 'Voiding…' : 'Void payment'}
      </button>
    </>
  ) : (mayAssign || mayVoid) ? (
    <>
      {mayVoid && (
        <button type="button" onClick={() => setMode('void')} className="min-h-11 px-4 border border-red-500/40 text-red-600 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer">
          <Ban size={14} /> Void
        </button>
      )}
      {mayAssign && (
        <button type="button" onClick={() => setMode('assign')} className="min-h-11 px-4 bg-amber-500 text-slate-950 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer">
          <UserIcon size={14} /> Give to a customer
        </button>
      )}
    </>
  ) : undefined;

  return (
    <FormSheet title={formatCurrency(amount)} subtitle={`${methodLabel(p.method as MoneyMethod)} · ${new Date(p.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`} onClose={onClose} footer={footer}>
      {mode === 'assign' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-app-text-muted">
            This walk-in payment becomes the customer's payment. It pays their debt first, then the rest goes to their wallet.
          </p>
          <SearchableDropdown
            items={customers.map((c) => ({
              id: c.id,
              label: c.name,
              sublabel: [c.accountNumber && `Acc ${c.accountNumber}`, c.phone, Number(c.debtBalance || 0) > 0 && `owes ${formatCurrency(Number(c.debtBalance))}`].filter(Boolean).join(' · '),
            }))}
            selectedValue={customerId}
            onChange={setCustomerId}
            placeholder="Choose the customer"
            searchPlaceholder="Name, phone or account number"
          />
          {chosen && (
            <div className="rounded-xl bg-app-bg border border-app-border p-3 text-sm">
              {debt > 0
                ? <>Pays {formatCurrency(Math.min(debt, amount))} of their {formatCurrency(debt)} debt{amount > debt ? `, ${formatCurrency(amount - debt)} to their wallet` : ''}.</>
                : <>All {formatCurrency(amount)} goes to their wallet.</>}
            </div>
          )}
        </div>
      ) : mode === 'void' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-app-text-muted">
            Voiding takes {formatCurrency(amount)} back out of the {methodLabel(p.method as MoneyMethod)} balance
            {Number(p.debtApplied || 0) > 0 && ` and puts ${formatCurrency(Number(p.debtApplied))} back on the customer's debt`}
            {Number(p.walletApplied || 0) > 0 && ` and removes ${formatCurrency(Number(p.walletApplied))} from their wallet`}.
            The record stays, marked Voided.
          </p>
          <TextInput autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. entered twice" />
        </div>
      ) : (
        <div>
          <Row label="Paid by">{payerName(p)}</Row>
          {p.senderPhone && <Row label="Phone">{p.senderPhone}</Row>}
          <Row label="Type">{isWalkIn(p) ? 'Walk-in' : 'Customer'}</Row>
          <Row label="Method"><span className="inline-flex items-center gap-1.5"><MethodIcon method={p.method} /> {methodLabel(p.method as MoneyMethod)}</span></Row>
          <Row label="Applied to">{appliedText(p)}</Row>
          {p.referenceCode && <Row label="Reference"><CopyRef value={p.referenceCode} label="payment reference" /></Row>}
          <Row label="Status">{p.status}</Row>
          {p.description && <Row label="Note">{p.description}</Row>}
          {p.recordedBy && <Row label="Recorded by">{p.recordedBy}</Row>}
          {p.status === 'Voided' && <Row label="Voided">{p.voidReason || 'No reason'}{p.voidedBy ? ` (by ${p.voidedBy})` : ''}</Row>}
          {mayAssign && (
            <p className="text-xs text-app-text-muted pt-3">Is this someone's payment? Use <span className="font-semibold">Give to a customer</span> to put it on their account.</p>
          )}
        </div>
      )}
    </FormSheet>
  );
}
