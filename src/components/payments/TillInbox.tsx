// src/components/payments/TillInbox.tsx
// Money paid straight to the M-Pesa till (C2B) arrives without saying who or what it is for.
// It waits here, at the top of Payments, until staff say what it was: a customer's payment,
// a sale already rung up, a walk-in payment, or ignored (with a reason).

import { useEffect, useMemo, useState } from 'react';
import { Inbox, Store, User as UserIcon, EyeOff, Undo2 } from 'lucide-react';
import type { Customer, TillPayment } from '../../types';
import { MpesaRepository, type TillPaymentAction } from '../../services/repositories';
import { onBranchChange } from '../../stores/businessStore';
import { useAppStore } from '../../stores/appStore';
import { formatCurrency } from '../../utils/helpers';
import { toUserMessage } from '../../utils/userError';
import { FormSheet } from '../shared/FormSheet';
import { TextInput } from '../shared/Input';
import SearchableDropdown from '../SearchableDropdown';
import TillSaleLink from './TillSaleLink';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function TillInbox({ customers, canAssign }: { customers: Customer[]; canAssign: boolean }) {
  const { showToast, currentEmployee } = useAppStore();
  const [rows, setRows] = useState<TillPayment[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [branchKey, setBranchKey] = useState('');
  useEffect(() => onBranchChange((id) => setBranchKey(id)), []);
  useEffect(() => MpesaRepository.subscribe(({ tillPayments }) => setRows(tillPayments)), [branchKey]);

  const items = useMemo(() => customers.map((c) => ({
    id: c.id,
    label: c.name,
    sublabel: [c.accountNumber && `Acc ${c.accountNumber}`, c.phone, Number(c.debtBalance || 0) > 0 && `owes ${formatCurrency(Number(c.debtBalance))}`].filter(Boolean).join(' · '),
  })), [customers]);

  const waiting = rows.filter((p) => p.status === 'unclaimed');
  const handled = rows.filter((p) => p.status === 'matched_sale' || p.status === 'ignored').slice(0, 10);
  const open = openId ? rows.find((p) => p.id === openId) : undefined;

  const act = async (p: TillPayment, action: TillPaymentAction) => {
    setBusy(true);
    try {
      await MpesaRepository.handleTillPayment(p.id, action, {
        customerId: action === 'customer' ? customerId : undefined,
        note: note.trim() || undefined,
        handledBy: currentEmployee?.name || 'Staff',
      });
      if (action !== 'reopen') showToast('Till payment', `${formatCurrency(p.amount)} sorted.`, undefined, 'success');
      setOpenId(null);
    } catch (err) {
      showToast('Till payment', toUserMessage(err, 'Could not save. Please try again.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (waiting.length === 0 && handled.length === 0) return null;

  return (
    <section className="bg-app-card border border-amber-500/40 rounded-2xl shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-base font-semibold text-app-text flex items-center gap-2">
          <Inbox size={16} className="text-amber-500" /> Paid to the till
          {waiting.length > 0 && <span className="text-xs font-semibold bg-amber-500 text-slate-950 rounded-full px-2 py-0.5">{waiting.length}</span>}
        </h3>
      </div>
      <p className="text-xs text-app-text-muted mb-3">
        {waiting.length > 0 ? 'Money sent straight to the till. Say what each one was.' : 'Nothing waiting.'}
      </p>

      {waiting.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto snap-x pb-1 -mx-1 px-1">
          {waiting.map((p) => (
            <li key={p.id} className="snap-start shrink-0 w-[15rem] sm:w-[16rem] border border-app-border rounded-xl p-3 flex flex-col gap-2 bg-app-bg/50">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-app-text tabular-nums">{formatCurrency(p.amount)}</div>
                <div className="text-sm text-app-text truncate">{p.payerName || 'Unknown sender'}</div>
                <div className="text-xs text-app-text-muted truncate">{[p.msisdn, when(p.transTime)].filter(Boolean).join(' · ')}</div>
                <div className="text-xs text-app-text-muted font-mono truncate">{p.transId}{p.billRef ? ` · ${p.billRef}` : ''}</div>
              </div>
              {canAssign && (
                <button type="button" onClick={() => { setOpenId(p.id); setCustomerId(''); setNote(''); }}
                  className="min-h-10 px-3 bg-amber-500 text-slate-950 font-semibold rounded-xl text-sm cursor-pointer">
                  Say what it was
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {handled.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-semibold text-app-text-muted cursor-pointer">Marked as sale or ignored ({handled.length})</summary>
          <ul className="mt-2 divide-y divide-app-border/40">
            {handled.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-app-text">{formatCurrency(p.amount)}</span>
                  <span className="block text-xs text-app-text-muted truncate">
                    {p.payerName || p.msisdn || 'Unknown'} · {p.status === 'matched_sale' ? (p.note || 'Rung up as a sale') : `Ignored: ${p.note || ''}`}
                  </span>
                </span>
                {canAssign && (
                  <button type="button" disabled={busy} onClick={() => void act(p, 'reopen')} className="shrink-0 text-xs font-semibold text-amber-600 inline-flex items-center gap-1 cursor-pointer">
                    <Undo2 size={12} /> Back to waiting
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {open && (
        <FormSheet title={`${formatCurrency(open.amount)} from ${open.payerName || open.msisdn || 'unknown'}`} subtitle={`${open.transId} · ${when(open.transTime)}`} onClose={() => setOpenId(null)}>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-app-text-muted">A customer's payment (pays their debt first, then their wallet)</span>
            <SearchableDropdown items={items} selectedValue={customerId} onChange={setCustomerId} placeholder="Choose the customer" searchPlaceholder="Name, phone or account number" />
            <button type="button" disabled={!customerId || busy} onClick={() => void act(open, 'customer')}
              className="min-h-11 px-4 bg-emerald-600 text-white font-semibold rounded-xl text-sm disabled:opacity-40 inline-flex items-center justify-center gap-1.5 cursor-pointer">
              <UserIcon size={14} /> Record for this customer
            </button>
          </div>
          <div className="pt-2"><TillSaleLink payment={open} onDone={() => setOpenId(null)} /></div>
          <div className="grid grid-cols-1 gap-2 pt-2">
            <button type="button" disabled={busy} onClick={() => void act(open, 'walk_in')}
              className="min-h-11 px-3 border border-app-border rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40">
              <Store size={14} /> Walk-in payment, not a sale
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason to ignore, e.g. test payment, refunded" className="flex-1" />
            <button type="button" disabled={!note.trim() || busy} onClick={() => void act(open, 'ignore')}
              className="min-h-11 px-4 border border-red-500/40 text-red-600 rounded-xl text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5 cursor-pointer">
              <EyeOff size={14} /> Ignore
            </button>
          </div>
        </FormSheet>
      )}
    </section>
  );
}
