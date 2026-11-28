// src/components/payments/TestTillPaymentSheet.tsx
// Sandbox only: send the till a test payment with the amount, payer name and account
// reference typed in, without a phone. "In the app" sends Safaricom's C2B callback to the
// app's own till-callback address, so it is received, matched and booked like a real one;
// "Through Safaricom" uses Safaricom's simulator to also prove Safaricom can reach the app.

import { useState } from 'react';
import { MpesaRepository } from '../../services/repositories';
import { useAppStore } from '../../stores/appStore';
import { toUserMessage } from '../../utils/userError';
import { formatMoney, MONEY_DECIMALS } from '../../utils/money';
import { FormSheet, Field, primaryBtn, secondaryBtn } from '../shared/FormSheet';
import { NumberInput, TextInput } from '../shared/Input';
import { Segmented } from '../shared/Choice';

type Via = 'app' | 'safaricom';

/** M-Pesa's largest single payment. */
const MAX_AMOUNT = 250000;
const DEFAULT_AMOUNT = 100;

export default function TestTillPaymentSheet({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { showToast } = useAppStore();
  const [via, setVia] = useState<Via>('app');
  const [amount, setAmount] = useState<number | null>(DEFAULT_AMOUNT);
  const [name, setName] = useState('');
  const [billRef, setBillRef] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const wholeOnly = via === 'safaricom';
  const amountOk = !!amount && amount > 0 && amount <= MAX_AMOUNT && (!wholeOnly || Number.isInteger(amount));

  const send = async () => {
    if (!amount || !amountOk) return;
    setBusy(true);
    try {
      const r = await MpesaRepository.testTill({
        amount,
        via,
        billRef: billRef.trim() || undefined,
        name: via === 'app' ? name.trim() || undefined : undefined,
        phone: via === 'app' ? phone.trim() || undefined : undefined,
      });
      showToast(
        'Test payment sent',
        via === 'app'
          ? `${formatMoney(amount)}${r.transId ? ` (${r.transId})` : ''} is now under Payments.`
          : `${formatMoney(amount)} should show under Payments in a few seconds.`,
        undefined,
        'success',
      );
      onSent();
      onClose();
    } catch (err) {
      showToast('Test payment', toUserMessage(err, 'Something went wrong. Please try again.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title="Test till payment"
      subtitle="Sandbox only. No phone needed."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" onClick={send} disabled={busy || !amountOk} className={primaryBtn}>
            {busy ? 'Sending…' : `Send ${amount ? formatMoney(amount) : ''}`}
          </button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="space-y-3">
        <Segmented<Via>
          ariaLabel="How to send it"
          value={via}
          onChange={setVia}
          options={[
            { id: 'app', label: 'In the app' },
            { id: 'safaricom', label: 'Through Safaricom' },
          ]}
        />
        <p className="text-xs text-app-text-muted">
          {via === 'app'
            ? 'Sends the same callback Safaricom sends, so it is recorded like a real till payment.'
            : 'Also checks that Safaricom can reach the app. Safaricom sets the payer name and number.'}
        </p>
        <Field label="Amount (KSh)" hint={wholeOnly ? 'Whole shillings only through Safaricom.' : undefined}>
          <NumberInput value={amount} onChange={setAmount} min={0} max={MAX_AMOUNT} decimals={wholeOnly ? 0 : MONEY_DECIMALS} autoFocus />
        </Field>
        <Field label="Account reference" hint="What the customer typed as the account, e.g. an invoice or phone number. Leave empty for none.">
          <TextInput value={billRef} onChange={(e) => setBillRef(e.target.value)} maxLength={20} placeholder="e.g. INV-0012" />
        </Field>
        {via === 'app' && (
          <>
            <Field label="Payer name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Jane Wanjiku" />
            </Field>
            <Field label="Payer phone" hint="Leave empty to use Safaricom's sandbox test number.">
              <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0712 345 678" />
            </Field>
          </>
        )}
        <button type="submit" hidden aria-hidden="true" />
      </form>
    </FormSheet>
  );
}
