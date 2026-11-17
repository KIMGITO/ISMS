// src/components/payments/CardChargeSheet.tsx
// Taking a card, the same way on the till and the Money page, on desktop, phone and web:
//   Card machine  any bank or PDQ machine: charge it there, type the approval code here.
//   Online        a Paystack page: open it on this device, or the customer scans the QR /
//                 opens the link on their own phone. Works anywhere there's internet.
//   Card reader   a Paystack reader in the shop: the amount is sent to it, the customer taps.
// Card numbers are never typed into this app. Paystack's page or reader takes them.

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, Copy, CreditCard, ExternalLink, Globe, Loader2, Nfc, X, XCircle } from 'lucide-react';
import { CardRepository, type CardPayment, type CardStatus } from '../../services/repositories';
import { ReceiptShareService } from '../../services/receipt/ReceiptShareService';
import { SheetLayer } from '../shared/SheetLayer';
import { useOverlay } from '../../hooks/useOverlay';
import { formatCurrency } from '../../utils/helpers';
import { toUserMessage } from '../../utils/userError';

export type CardVia = 'machine' | 'online' | 'terminal';

export interface CardChargeResult {
  via: CardVia;
  /** Approval code (machine) or our Paystack reference. */
  reference: string;
  brand?: string | null;
  last4?: string | null;
  /** Set for online and reader payments. */
  cardPaymentId?: string;
  /** True when the server already recorded it as a payment (Money page, online or reader). */
  recorded: boolean;
  amountPaid: number;
}

interface Props {
  open: boolean;
  amount: number;
  /** sale: the till records the sale after. payment: recorded on the Money page. */
  purpose: 'sale' | 'payment';
  customer?: { id: string; name: string; phone?: string; email?: string } | null;
  payerName?: string;
  description?: string;
  onPaid: (result: CardChargeResult) => void;
  onClose: () => void;
}

const POLL_MS = 4000;
const GIVE_UP_MS = 15 * 60_000;
const input = 'w-full bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500';

let statusCache: { at: number; value: CardStatus } | null = null;

/** Card setup, cached for a minute so opening the sheet is instant. */
export async function loadCardStatus(force = false): Promise<CardStatus | null> {
  if (!force && statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  try {
    const value = await CardRepository.status();
    statusCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

export function forgetCardStatus() {
  statusCache = null;
}

export function describeCard(brand?: string | null, last4?: string | null): string {
  return [brand, last4 ? `•••• ${last4}` : ''].filter(Boolean).join(' ');
}

export default function CardChargeSheet({ open, amount, purpose, customer, payerName, description, onPaid, onClose }: Props) {
  const [status, setStatus] = useState<CardStatus | null | undefined>(undefined);
  const [via, setVia] = useState<CardVia>('machine');
  const [approval, setApproval] = useState('');
  const [last4, setLast4] = useState('');
  const [email, setEmail] = useState('');
  const [payment, setPayment] = useState<CardPayment | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef(0);
  const finished = useRef(false);

  const waiting = payment?.status === 'pending';
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const amountRounded = Math.round(amount * 100) / 100;

  const requestClose = () => {
    if (waiting) setConfirmStop(true);
    else onClose();
  };
  useOverlay(open, requestClose, 'dialog');

  // Fresh state each time it opens.
  useEffect(() => {
    if (!open) return;
    finished.current = false;
    setPayment(null);
    setQr('');
    setApproval('');
    setLast4('');
    setError('');
    setConfirmStop(false);
    setEmail(customer?.email || '');
    setStatus(undefined);
    loadCardStatus().then((s) => {
      setStatus(s);
      // Without Paystack the card machine is the only way, so it's already chosen.
      setVia(s?.terminalId ? 'terminal' : s?.onlineEnabled ? 'online' : 'machine');
    });
  }, [open, customer?.email]);

  const finish = (p: CardPayment) => {
    if (finished.current) return;
    finished.current = true;
    onPaid({
      via: p.channel === 'terminal' ? 'terminal' : 'online',
      reference: p.reference,
      brand: p.cardBrand,
      last4: p.cardLast4,
      cardPaymentId: p.id,
      recorded: purpose === 'payment',
      amountPaid: p.amountPaid ?? p.amount,
    });
  };

  // Wait for Paystack. The webhook usually settles it first; asking also covers a missed webhook.
  useEffect(() => {
    if (!open || !payment || payment.status !== 'pending') return;
    const timer = setInterval(async () => {
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        clearInterval(timer);
        setError("No answer from Paystack for 15 minutes. Check the card payments list before charging again.");
        return;
      }
      try {
        const next = await CardRepository.check(payment.reference);
        setPayment(next);
        if (next.status === 'success') finish(next);
        if (next.status === 'failed') setError(next.failureReason ? `Not paid: ${next.failureReason}` : 'The card payment did not go through.');
      } catch {
        // A failed check doesn't stop the wait; the next one tries again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payment?.reference, payment?.status]);

  useEffect(() => {
    if (!payment?.authorizationUrl) return;
    QRCode.toDataURL(payment.authorizationUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [payment?.authorizationUrl]);

  if (!open) return null;

  const start = async (channel: 'online' | 'terminal') => {
    setBusy(true);
    setError('');
    try {
      const p = await CardRepository.charge({
        channel,
        purpose,
        amount: amountRounded,
        customerId: customer?.id,
        email: email.trim() || undefined,
        payerName: payerName || customer?.name,
        payerPhone: customer?.phone,
        description,
      });
      startedAt.current = Date.now();
      setPayment(p);
    } catch (err) {
      setError(toUserMessage(err, "The card payment couldn't start. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const machineDone = () => {
    const code = approval.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) {
      setError('Type the approval code printed on the card machine slip (4 to 12 letters or digits).');
      return;
    }
    if (last4 && !/^\d{4}$/.test(last4)) {
      setError('The last 4 digits are four numbers, or leave them empty.');
      return;
    }
    finished.current = true;
    onPaid({ via: 'machine', reference: code, last4: last4 || null, recorded: false, amountPaid: amountRounded });
  };

  const stopWaiting = async () => {
    if (!payment) return onClose();
    setBusy(true);
    try {
      // Checks with Paystack before cancelling, so a payment that went through still counts.
      const latest = await CardRepository.cancel(payment.reference);
      if (latest.status === 'success') finish(latest);
      else onClose();
    } catch (err) {
      setError(toUserMessage(err, "Couldn't stop it. Try again."));
    } finally {
      setBusy(false);
      setConfirmStop(false);
    }
  };

  const copyLink = async () => {
    if (!payment?.authorizationUrl) return;
    try {
      await navigator.clipboard.writeText(payment.authorizationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Long-press the link to copy it.");
    }
  };

  const hasOnline = !!status?.onlineEnabled;
  const hasReader = !!status?.terminalId;
  const tabs: { id: CardVia; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'terminal', label: 'Card reader', icon: <Nfc size={15} />, show: hasReader },
    { id: 'online', label: 'Online / link', icon: <Globe size={15} />, show: hasOnline },
    { id: 'machine', label: 'Card machine', icon: <CreditCard size={15} />, show: true },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const succeeded = payment?.status === 'success';

  return (
    <SheetLayer>
      <div className="fixed inset-0 z-[9000] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={requestClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="card-charge-title"
          className="w-full sm:max-w-md bg-app-card text-app-text rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto pb-[calc(1rem+var(--inset-bottom))] sm:pb-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 p-4 pb-2">
            <div>
              <h2 id="card-charge-title" className="text-base font-semibold">Card payment</h2>
              <p className="text-2xl font-bold tabular-nums mt-0.5">{formatCurrency(amountRounded)}</p>
              {customer?.name && <p className="text-xs text-app-text-muted">{customer.name}</p>}
            </div>
            <button type="button" onClick={requestClose} aria-label="Close" className="p-2 rounded-lg hover:bg-app-bg cursor-pointer">
              <X size={18} />
            </button>
          </div>

          {status === undefined ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-app-text-muted"><Loader2 size={16} className="animate-spin" /> Getting card options…</div>
          ) : (
            <div className="px-4 space-y-4">
              {visibleTabs.length > 1 && !payment && (
                <div className="grid gap-1 bg-app-bg p-1 rounded-xl" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }} role="tablist">
                  {visibleTabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={via === t.id}
                      onClick={() => { setVia(t.id); setError(''); }}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${via === t.id ? 'bg-app-card shadow text-amber-600 dark:text-amber-400' : 'text-app-text-muted'}`}
                    >
                      {t.icon}{t.label}
                    </button>
                  ))}
                </div>
              )}

              {via === 'machine' && (
                <div className="space-y-3">
                  <p className="text-sm text-app-text-muted">
                    Charge {formatCurrency(amountRounded)} on your card machine. Then type the approval code.
                  </p>
                  <label className="block text-xs font-semibold text-app-text-muted">
                    Approval code
                    <input autoFocus value={approval} onChange={(e) => setApproval(e.target.value)} placeholder="e.g. 004512" className={`${input} mt-1 font-mono uppercase`} />
                  </label>
                  <label className="block text-xs font-semibold text-app-text-muted">
                    Last 4 digits of the card (optional)
                    <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="1234" className={`${input} mt-1 font-mono`} />
                  </label>
                  <button type="button" onClick={machineDone} className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-sm cursor-pointer">
                    Card was approved
                  </button>
                  {!hasOnline && !hasReader && (
                    <p className="text-xs text-app-text-muted">Set up Paystack in Money → Cards to charge online.</p>
                  )}
                </div>
              )}

              {via !== 'machine' && !online && !payment && (
                <p className="text-sm text-red-600 dark:text-red-400">Offline. Use the card machine.</p>
              )}

              {via === 'online' && !payment && online && (
                <div className="space-y-3">
                  <p className="text-sm text-app-text-muted">
                    Open the card page here, or let them scan the code.
                  </p>
                  <label className="block text-xs font-semibold text-app-text-muted">
                    Email for the receipt {customer?.email ? '' : '(optional, the shop email is used if empty)'}
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" className={`${input} mt-1`} />
                  </label>
                  <button type="button" disabled={busy} onClick={() => void start('online')} className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer">
                    {busy && <Loader2 size={16} className="animate-spin" />} Start card payment
                  </button>
                </div>
              )}

              {via === 'terminal' && !payment && online && (
                <div className="space-y-3">
                  <p className="text-sm text-app-text-muted">
                    Sends {formatCurrency(amountRounded)} to {status?.terminalName || 'the card reader'}. The customer then taps or inserts their card.
                  </p>
                  <button type="button" disabled={busy} onClick={() => void start('terminal')} className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer">
                    {busy && <Loader2 size={16} className="animate-spin" />} Send to card reader
                  </button>
                </div>
              )}

              {payment && !succeeded && (
                <div className="space-y-3">
                  {payment.status === 'pending' && (
                    <div role="status" className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm">
                      <Loader2 size={16} className="animate-spin text-amber-600" />
                      {payment.channel === 'terminal' ? 'Waiting for the customer to tap or insert their card…' : 'Waiting for the customer to pay…'}
                    </div>
                  )}
                  {payment.channel === 'online' && payment.authorizationUrl && payment.status === 'pending' && (
                    <>
                      {qr && <img src={qr} alt="Scan to pay by card" className="mx-auto w-48 h-48 rounded-xl bg-white p-2" />}
                      <p className="text-xs text-center text-app-text-muted">Scan with the phone camera to pay on that phone</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => void ReceiptShareService.openExternalUrl(payment.authorizationUrl!)} className="py-2.5 rounded-xl ring-1 ring-app-border text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer hover:bg-app-bg">
                          <ExternalLink size={15} /> Open here
                        </button>
                        <button type="button" onClick={() => void copyLink()} className="py-2.5 rounded-xl ring-1 ring-app-border text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer hover:bg-app-bg">
                          <Copy size={15} /> {copied ? 'Copied' : 'Copy link'}
                        </button>
                      </div>
                    </>
                  )}
                  {payment.status !== 'pending' && (
                    <button type="button" onClick={() => { setPayment(null); setError(''); }} className="w-full py-2.5 rounded-xl ring-1 ring-app-border text-sm font-medium cursor-pointer hover:bg-app-bg">
                      Try again
                    </button>
                  )}
                  <p className="text-[11px] text-center text-app-text-muted font-mono">Ref {payment.reference}</p>
                </div>
              )}

              {succeeded && payment && (
                <div role="status" className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={18} /> Paid {formatCurrency(payment.amountPaid ?? payment.amount)} {describeCard(payment.cardBrand, payment.cardLast4)}
                </div>
              )}

              {error && (
                <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400"><XCircle size={16} className="shrink-0 mt-0.5" />{error}</p>
              )}

              {confirmStop && (
                <div className="rounded-xl ring-1 ring-app-border p-3 space-y-2">
                  <p className="text-sm">Stop waiting for this card payment?</p>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setConfirmStop(false)} className="px-3 py-2 rounded-lg text-sm bg-app-bg cursor-pointer">Keep waiting</button>
                    <button type="button" disabled={busy} onClick={() => void stopWaiting()} className="px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white disabled:opacity-60 cursor-pointer">Stop</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SheetLayer>
  );
}
