import { useEffect, useRef, useState } from 'react';
import { Smartphone, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import TextInput from '../shared/Input';
import { PromptRepository } from '../../services/repositories';
import { formatCurrency } from '../../utils/helpers';
import { toUserMessage } from '../../utils/userError';
import type { PaymentPrompt, Transaction } from '../../types';

/**
 * "Send M-Pesa prompt" for a sale that was just rung up as M-Pesa. Shared by POS and Quick Sale.
 * The prompt is linked to the sale BEFORE it is sent (20261212007), so when the customer pays it
 * proves the sale's money; it never records the money a second time.
 */
export default function SalePromptButton({ sale, defaultPhone = '', className = '' }: {
  sale: Transaction;
  defaultPhone?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(defaultPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PaymentPrompt['status'] | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // M-Pesa takes whole shillings; never ask for more than the sale.
  const amount = Math.floor(sale.finalTotal);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  if (sale.paymentMethod !== 'M-Pesa' || amount < 1) return null;

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await PromptRepository.send('mpesa', {
        phone: phone.trim(),
        amount,
        customerId: sale.customerId,
        saleId: sale.id,
        description: `Sale ${sale.referenceId ?? ''}`.trim(),
      });
      setStatus('Pending');
      const started = Date.now();
      timer.current = setInterval(async () => {
        try {
          const prompts = await PromptRepository.getRecent({ mpesa: true, airtel: false });
          const mine = prompts.find((p) => p.id === id);
          if (mine && mine.status === 'Pending' && Date.now() - started > 30000) {
            await PromptRepository.check(mine).catch(() => undefined);
          }
          if (mine && mine.status !== 'Pending') {
            setStatus(mine.status);
            if (mine.status === 'Failed') setError(mine.resultMessage ?? 'The customer did not pay.');
            if (timer.current) clearInterval(timer.current);
          }
        } catch { /* a weak connection; try again on the next tick */ }
        if (Date.now() - started > 180000 && timer.current) clearInterval(timer.current);
      }, 5000);
    } catch (e) {
      setError(toUserMessage(e, 'The prompt could not be sent. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (status === 'Completed') {
    return (
      <div className={`flex items-center gap-2 text-xs font-semibold text-emerald-600 ${className}`} role="status">
        <CheckCircle2 size={16} aria-hidden="true" /> M-Pesa paid {formatCurrency(amount)} for this sale.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-green-700 hover:bg-green-800 text-white text-xs font-bold cursor-pointer ${className}`}
      >
        <Smartphone size={14} aria-hidden="true" /> Send M-Pesa prompt
      </button>
    );
  }

  return (
    <div className={`w-full space-y-2 text-left ${className}`}>
      <div className="flex gap-2">
        <TextInput
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0712 345 678"
          inputMode="tel"
          aria-label="Customer's M-Pesa number"
          className="flex-1"
          disabled={status === 'Pending'}
          autoFocus
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || status === 'Pending' || phone.trim().length < 9}
          className="shrink-0 flex items-center gap-1.5 px-3 rounded-xl bg-green-700 hover:bg-green-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
        >
          {busy || status === 'Pending' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Smartphone size={14} aria-hidden="true" />}
          {status === 'Pending' ? 'Waiting' : `Ask ${formatCurrency(amount)}`}
        </button>
      </div>
      {status === 'Pending' && <p className="text-xs text-app-text-muted">Prompt sent. Waiting for the customer to enter their PIN.</p>}
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-rose-600" role="alert">
          <XCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}
