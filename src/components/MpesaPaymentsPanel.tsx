// src/components/MpesaPaymentsPanel.tsx
// M-Pesa (Daraja) for the till: connection status, payment prompts sent from the
// app, and money sent straight to the till waiting for staff to say what it was.
// A till payment carries no account number, so it can't be matched automatically.

import { useEffect, useMemo, useState } from 'react';
import {
  Smartphone, Send, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle, User as UserIcon,
  Store, ShoppingCart, EyeOff, Undo2, Settings2, Inbox,
} from 'lucide-react';
import type { Customer, MpesaPrompt, TillPayment } from '../types';
import { MpesaRepository, type MpesaStatus, type TillPaymentAction } from '../services/repositories';
import { useAppStore } from '../stores/appStore';
import { hasRolePermission } from '../utils/permissions';
import { formatCurrency } from '../utils/helpers';
import { toUserMessage } from '../utils/userError';
import SearchableDropdown from './SearchableDropdown';

const card = 'bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 shadow-sm';
const input = 'w-full bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500';
const label = 'text-xs font-semibold text-app-text-muted';
const WALK_IN = '__walk_in__';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function PromptStatus({ prompt }: { prompt: MpesaPrompt }) {
  if (prompt.status === 'Completed') {
    return <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold"><CheckCircle2 size={14} /> Paid {prompt.receiptNumber}</span>;
  }
  if (prompt.status === 'Failed') {
    return <span className="inline-flex items-center gap-1 text-red-500 text-xs font-bold"><XCircle size={14} /> Not paid</span>;
  }
  return <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-bold"><Clock size={14} /> Waiting for customer</span>;
}

export default function MpesaPaymentsPanel({ customers }: { customers: Customer[] }) {
  const { showToast, currentEmployee } = useAppStore();
  const role = currentEmployee?.role || 'Guest';
  const canConfigure = hasRolePermission(role, 'settings.integrations');
  const canRequest = hasRolePermission(role, 'payments.mpesa');
  const canAssign = hasRolePermission(role, 'payments.verify') || canRequest;
  const staffName = currentEmployee?.name || 'Staff';

  const [status, setStatus] = useState<MpesaStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [tillInput, setTillInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [tillPayments, setTillPayments] = useState<TillPayment[]>([]);
  const [prompts, setPrompts] = useState<MpesaPrompt[]>([]);

  // Payment prompt form
  const [payer, setPayer] = useState(WALK_IN);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [lastCheckoutId, setLastCheckoutId] = useState<string | null>(null);

  // Assigning a till payment
  const [openTillId, setOpenTillId] = useState<string | null>(null);
  const [assignCustomer, setAssignCustomer] = useState('');
  const [assignNote, setAssignNote] = useState('');

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const customerItems = useMemo(
    () => customers.map((c) => ({
      id: c.id,
      label: c.name,
      sublabel: [c.accountNumber && `Acc ${c.accountNumber}`, c.phone].filter(Boolean).join(' · '),
    })),
    [customers],
  );

  const loadStatus = () => {
    MpesaRepository.status()
      .then((s) => {
        setStatus(s);
        setTillInput(s.tillNumber || s.tillFromSecrets || '');
        setStatusError('');
      })
      .catch((err) => setStatusError(toUserMessage(err, "Couldn't reach the M-Pesa service.")));
  };

  useEffect(() => {
    loadStatus();
    return MpesaRepository.subscribe(({ tillPayments, prompts }) => {
      setTillPayments(tillPayments);
      setPrompts(prompts);
    });
  }, []);

  const run = async (key: string, fn: () => Promise<void>, success?: [string, string]) => {
    setBusy(key);
    try {
      await fn();
      if (success) showToast(success[0], success[1], undefined, 'success');
    } catch (err) {
      showToast('M-Pesa', toUserMessage(err, 'Something went wrong. Please try again.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const choosePayer = (id: string) => {
    setPayer(id);
    const customer = customerById.get(id);
    if (customer?.phone) setPhone(customer.phone);
    if (customer && !amount && Number(customer.debtBalance || 0) > 0) setAmount(String(Math.ceil(Number(customer.debtBalance))));
  };

  const sendPrompt = () =>
    run('request', async () => {
      const checkoutId = await MpesaRepository.requestPayment({
        phone,
        amount: Number(amount),
        customerId: payer === WALK_IN ? undefined : payer,
        description: note.trim() || undefined,
      });
      setLastCheckoutId(checkoutId);
      setAmount('');
      setNote('');
    }, ['Prompt Sent', 'The customer should see the M-Pesa prompt on their phone now.']);

  const assign = (payment: TillPayment, action: TillPaymentAction) =>
    run(`till-${payment.id}`, async () => {
      await MpesaRepository.handleTillPayment(payment.id, action, {
        customerId: action === 'customer' ? assignCustomer : undefined,
        note: assignNote.trim() || undefined,
        handledBy: staffName,
      });
      setOpenTillId(null);
      setAssignCustomer('');
      setAssignNote('');
    }, action === 'reopen' ? undefined : ['Payment Assigned', 'Saved.']);

  const unclaimed = tillPayments.filter((p) => p.status === 'unclaimed');
  const handled = tillPayments.filter((p) => p.status !== 'unclaimed').slice(0, 30);
  const lastPrompt = lastCheckoutId ? prompts.find((p) => p.checkoutRequestId === lastCheckoutId) : undefined;

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-200">
      {/* Connection */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-app-text flex items-center gap-2">
            <Settings2 size={16} className="text-amber-500" /> M-Pesa connection
          </h3>
          {status && (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${status.configured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/15 text-amber-700'}`}>
              {status.configured ? `Connected (${status.environment})` : 'Not set up yet'}
            </span>
          )}
        </div>

        {statusError && <p className="text-sm text-red-500">{statusError}</p>}

        {status && !status.configured && (
          <p className="text-sm text-app-text-muted mb-3">
            The Daraja keys haven't been added on the server yet.
            {canConfigure && status.missing.length > 0 && <> Missing: <span className="font-mono text-xs">{status.missing.join(', ')}</span>.</>}
            {' '}See docs/INTEGRATIONS.md.
          </p>
        )}

        {canConfigure && status && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
              <label className="flex flex-col gap-1">
                <span className={label}>Till number for this business</span>
                <input
                  inputMode="numeric"
                  value={tillInput}
                  onChange={(e) => setTillInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 5544332"
                  className={input}
                />
              </label>
              <button
                type="button"
                disabled={busy === 'till' || tillInput === (status.tillNumber || '')}
                onClick={() => run('till', async () => { await MpesaRepository.saveTill(tillInput); loadStatus(); }, ['Till Saved', 'Payments to this till will show up here.'])}
                className="min-h-10 px-4 bg-amber-500 text-slate-950 font-bold rounded-xl text-sm disabled:opacity-40 cursor-pointer"
              >
                Save till
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!status.configured || !status.tillNumber || busy === 'register'}
                onClick={() => run('register', async () => { await MpesaRepository.registerTill(); loadStatus(); }, ['Till Registered', 'Safaricom will now send till payments to the app.'])}
                className="min-h-10 px-4 border border-app-border rounded-xl text-sm font-semibold text-app-text disabled:opacity-40 cursor-pointer"
              >
                {busy === 'register' ? 'Registering…' : status.registeredAt ? 'Register again' : 'Register till with Safaricom'}
              </button>
              <span className="text-xs text-app-text-muted">
                {status.registeredAt ? `Registered ${when(status.registeredAt)}` : 'Not registered: payments sent straight to the till won’t appear yet.'}
              </span>
            </div>
          </div>
        )}

        {status && !canConfigure && (
          <p className="text-sm text-app-text-muted">Till: {status.tillNumber || 'not set'}</p>
        )}
      </section>

      {/* Payment prompt */}
      {canRequest && (
        <section className={card}>
          <h3 className="text-sm font-bold text-app-text flex items-center gap-2 mb-1">
            <Send size={16} className="text-emerald-600" /> Ask a customer to pay
          </h3>
          <p className="text-xs text-app-text-muted mb-4">
            Sends an M-Pesa prompt to their phone. When they enter their PIN, the payment is recorded by itself:
            a customer's debt goes down first, then their wallet goes up. Don't use this for a sale you'll also ring up at POS.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>Who is paying</span>
              <SearchableDropdown
                items={[{ id: WALK_IN, label: 'Walk-in customer', sublabel: 'No account' }, ...customerItems]}
                selectedValue={payer}
                onChange={choosePayer}
                placeholder="Choose a customer"
                searchPlaceholder="Name, phone or account number"
              />
              {payer !== WALK_IN && customerById.get(payer) && (
                <span className="text-xs text-app-text-muted">
                  Account {customerById.get(payer)!.accountNumber || '—'}
                  {Number(customerById.get(payer)!.debtBalance || 0) > 0 && ` · Owes ${formatCurrency(Number(customerById.get(payer)!.debtBalance))}`}
                  {Number(customerById.get(payer)!.walletBalance || 0) > 0 && ` · Wallet ${formatCurrency(Number(customerById.get(payer)!.walletBalance))}`}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Phone number</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Amount (KSh, whole shillings)</span>
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="500" className={input} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October milk balance" className={input} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button
              type="button"
              onClick={sendPrompt}
              disabled={busy === 'request' || !phone.trim() || !Number(amount) || (status !== null && !status.configured)}
              className="min-h-11 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm disabled:opacity-40 flex items-center gap-2 cursor-pointer"
            >
              <Smartphone size={16} /> {busy === 'request' ? 'Sending…' : 'Send M-Pesa prompt'}
            </button>
            {lastPrompt && (
              <div className="flex items-center gap-3">
                <PromptStatus prompt={lastPrompt} />
                {lastPrompt.status === 'Pending' && (
                  <button
                    type="button"
                    onClick={() => run('check', async () => {
                      const r = await MpesaRepository.checkPrompt(lastPrompt.checkoutRequestId);
                      if (r.paid) showToast('Paid', 'Safaricom says it’s paid. The receipt will appear in a moment.', undefined, 'info');
                    })}
                    className="text-xs font-semibold text-amber-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw size={12} className={busy === 'check' ? 'animate-spin' : ''} /> Check now
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Till queue */}
      <section className={card}>
        <h3 className="text-sm font-bold text-app-text flex items-center gap-2 mb-1">
          <Inbox size={16} className="text-amber-500" /> Paid to the till
          {unclaimed.length > 0 && (
            <span className="ml-1 text-xs font-black bg-amber-500 text-slate-950 rounded-full px-2 py-0.5">{unclaimed.length}</span>
          )}
        </h3>
        <p className="text-xs text-app-text-muted mb-4">
          A till payment doesn't say who it's for, so each one waits here until someone assigns it.
          Payments that quote a customer's account number are recorded by themselves.
        </p>

        {unclaimed.length === 0 ? (
          <p className="text-sm text-app-text-muted py-4 text-center">Nothing waiting.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {unclaimed.map((p) => {
              const isOpen = openTillId === p.id;
              const isBusy = busy === `till-${p.id}`;
              return (
                <li key={p.id} className="border border-amber-500/40 bg-amber-500/5 rounded-xl p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-base font-black text-app-text">{formatCurrency(p.amount)}</div>
                      <div className="text-sm text-app-text truncate">{p.payerName || 'Unknown sender'}</div>
                      <div className="text-xs text-app-text-muted font-mono">{[p.msisdn, p.transId, when(p.transTime)].filter(Boolean).join(' · ')}</div>
                      {p.billRef && <div className="text-xs text-app-text-muted">Reference: {p.billRef}</div>}
                    </div>
                    {canAssign && !isOpen && (
                      <button
                        type="button"
                        onClick={() => { setOpenTillId(p.id); setAssignCustomer(''); setAssignNote(''); }}
                        className="min-h-10 px-4 bg-amber-500 text-slate-950 font-bold rounded-xl text-sm cursor-pointer"
                      >
                        Assign
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <div className="mt-3 flex flex-col gap-3 border-t border-app-border/50 pt-3">
                      <div className="flex flex-col gap-2">
                        <span className={label}>A customer's payment (pays their debt, then tops up their wallet)</span>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <div className="flex-1 min-w-0">
                            <SearchableDropdown
                              items={customerItems}
                              selectedValue={assignCustomer}
                              onChange={setAssignCustomer}
                              placeholder="Choose the customer"
                              searchPlaceholder="Name, phone or account number"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={!assignCustomer || isBusy}
                            onClick={() => assign(p, 'customer')}
                            className="min-h-10 px-4 bg-emerald-600 text-white font-bold rounded-xl text-sm disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <UserIcon size={14} /> Record for customer
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => assign(p, 'sale')}
                          className="min-h-10 px-3 border border-app-border rounded-xl text-sm font-semibold text-app-text flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                          title="Already rung up at POS as an M-Pesa sale, so it isn't counted twice"
                        >
                          <ShoppingCart size={14} /> Already rung up as a sale
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => assign(p, 'walk_in')}
                          className="min-h-10 px-3 border border-app-border rounded-xl text-sm font-semibold text-app-text flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                          title="Money received from a walk-in that wasn't rung up as a sale"
                        >
                          <Store size={14} /> Walk-in, not a sale
                        </button>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          value={assignNote}
                          onChange={(e) => setAssignNote(e.target.value)}
                          placeholder="Note (needed to ignore, e.g. test payment, refunded)"
                          className={input}
                        />
                        <button
                          type="button"
                          disabled={!assignNote.trim() || isBusy}
                          onClick={() => assign(p, 'ignore')}
                          className="min-h-10 px-4 border border-red-500/40 text-red-500 rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <EyeOff size={14} /> Ignore
                        </button>
                      </div>

                      <button type="button" onClick={() => setOpenTillId(null)} className="self-start text-xs text-app-text-muted hover:underline cursor-pointer">
                        Cancel
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {handled.length > 0 && (
          <details className="mt-4">
            <summary className="text-xs font-semibold text-app-text-muted cursor-pointer">Recently handled ({handled.length})</summary>
            <ul className="mt-2 divide-y divide-app-border/40">
              {handled.map((p) => (
                <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-bold text-app-text">{formatCurrency(p.amount)}</span>
                    <span className="text-app-text-muted"> · {p.payerName || p.msisdn || 'Unknown'} · {p.transId}</span>
                    <div className="text-xs text-app-text-muted">
                      {p.status === 'recorded' && (p.customerId ? `Recorded for ${customerById.get(p.customerId)?.name || 'customer'}` : 'Recorded as walk-in')}
                      {p.status === 'matched_sale' && 'Rung up as a sale'}
                      {p.status === 'ignored' && `Ignored: ${p.note || ''}`}
                      {p.handledBy && ` · ${p.handledBy}`}
                    </div>
                  </div>
                  {canAssign && (p.status === 'matched_sale' || p.status === 'ignored') && (
                    <button
                      type="button"
                      onClick={() => assign(p, 'reopen')}
                      className="text-xs font-semibold text-amber-600 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Undo2 size={12} /> Back to queue
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-app-text-muted mt-2 flex items-center gap-1">
              <AlertTriangle size={12} /> To undo a recorded one, void its payment on the Payments tab. It comes back here.
            </p>
          </details>
        )}
      </section>

      {/* Prompt history */}
      {prompts.length > 0 && (
        <section className={card}>
          <h3 className="text-sm font-bold text-app-text mb-3">Prompts sent</h3>
          <ul className="divide-y divide-app-border/40">
            {prompts.slice(0, 20).map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <span className="font-bold text-app-text">{formatCurrency(p.amount)}</span>
                  <span className="text-app-text-muted">
                    {' · '}{p.customerId ? customerById.get(p.customerId)?.name || 'Customer' : 'Walk-in'} · {p.phone}
                  </span>
                  <div className="text-xs text-app-text-muted">{when(p.createdAt)}{p.requestedBy && ` · by ${p.requestedBy}`}{p.description && ` · ${p.description}`}</div>
                </div>
                <PromptStatus prompt={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
