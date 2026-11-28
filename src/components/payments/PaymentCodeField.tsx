import { useEffect, useState, type ReactElement } from 'react';
import { ReceiptText } from 'lucide-react';
import TextInput from '../shared/Input';
import { getSupabase } from '../../services/supabaseClient';
import { useBusinessStore } from '../../stores/businessStore';
import { formatCurrency } from '../../utils/helpers';
import { roundMoney } from '../../utils/money';
import { paymentCodeLabel, paymentCodeProblem, tidyPaymentCode } from '../../utils/paymentProof';
import type { PaymentMethod } from '../../types';

interface WaitingPayment {
  readonly code: string;
  readonly left: number;
  readonly payer: string;
}

const RECENT_HOURS = 6;
const MAX_SUGGESTIONS = 4;
const HOUR_MS = 3_600_000;
const FETCH_LIMIT = 50;
/** Half a cent: money is stored to the cent, so anything closer is the same amount. */
const CENT_SLACK = 0.004;

/**
 * The payment's code, asked for before an M-Pesa, Airtel or bank sale is recorded (money first).
 * For M-Pesa it also lists till payments that arrived in the last hours and cover the sale, so
 * the cashier can tap the one that matches instead of typing. Shared by POS and Quick Sale.
 */
export default function PaymentCodeField({ method, amount, value, onChange, showError = false, autoFocus = false, id }: {
  readonly method: PaymentMethod;
  readonly amount: number;
  readonly value: string;
  readonly onChange: (code: string) => void;
  /** Show what is wrong with the code (after the cashier tried to finish). */
  readonly showError?: boolean;
  readonly autoFocus?: boolean;
  readonly id?: string;
}): ReactElement {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const [waiting, setWaiting] = useState<readonly WaitingPayment[]>([]);
  const label = paymentCodeLabel(method);
  const problem = paymentCodeProblem(method, value);

  // Payments already at the till that could pay this sale. Staff without access to the
  // payments queue simply see none and type the code.
  useEffect(() => {
    if (method !== 'M-Pesa' || !businessId || amount <= 0) {
      setWaiting([]);
      return;
    }
    let stale = false;
    const since = new Date(Date.now() - RECENT_HOURS * HOUR_MS).toISOString();
    void (async (): Promise<void> => {
      const { data, error } = await getSupabase()
        .from('mpesa_till_payments')
        .select('trans_id, amount, allocated, payer_name, msisdn')
        .eq('business_id', businessId)
        .in('status', ['unclaimed', 'partial'])
        .gte('trans_time', since)
        .order('trans_time', { ascending: false })
        .limit(FETCH_LIMIT);
      if (stale || error || !data) return;
      setWaiting(
        data
          .map((r) => ({
            code: String(r.trans_id),
            left: roundMoney(Number(r.amount) - Number(r.allocated || 0)),
            payer: String(r.payer_name || r.msisdn || ''),
          }))
          .filter((p) => p.left + CENT_SLACK >= amount)
          .sort((a, b) => Math.abs(a.left - amount) - Math.abs(b.left - amount))
          .slice(0, MAX_SUGGESTIONS),
      );
    })();
    return () => {
      stale = true;
    };
  }, [method, businessId, amount]);

  const chosen = tidyPaymentCode(value);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold text-app-text-muted">
        {label} <span className="font-normal">· required before the sale is saved</span>
      </label>
      <TextInput
        id={id}
        icon={<ReceiptText />}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={method === 'Bank' ? 'Reference on the bank slip or SMS' : 'From the payment SMS, e.g. QK12AB34CD'}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus={autoFocus}
        invalid={showError && !!problem}
        inputClassName="uppercase tracking-wide"
      />
      {waiting.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="M-Pesa payments waiting at the till">
          {waiting.map((p) => (
            <button
              key={p.code}
              type="button"
              onClick={() => onChange(p.code)}
              className={`px-2 py-1 rounded-lg text-[11px] ring-1 transition cursor-pointer ${
                chosen === p.code.toUpperCase()
                  ? 'bg-emerald-500/15 ring-emerald-500/50 text-app-text font-semibold'
                  : 'ring-app-border text-app-text-muted hover:text-app-text'
              }`}
              title={p.payer ? `From ${p.payer}` : undefined}
            >
              {p.code} · {formatCurrency(p.left)}
            </button>
          ))}
        </div>
      )}
      {showError && problem && <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">{problem}</p>}
    </div>
  );
}
