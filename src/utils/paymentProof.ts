// Money first (owner, 2026-11-28): a sale paid by M-Pesa, Airtel or bank is recorded only with
// the payment's code, read off the customer's or the till's message. The database checks the
// same rules (20261217001_sale_payment_proof.sql); these keep the till from even trying.
import type { PaymentMethod } from '../types';

const CODE_MIN_LENGTH = 6;
const CODE_MAX_LENGTH = 40;
// Any run of spaces, tabs or line breaks: "qk 12" has one, "QK12" has none.
// https://regex101.com/?regex=%5Cs%2B&flags=g&testString=qk%2012%0AQK12
const WHITESPACE = /\s+/g;
// Letters, digits and / _ . - only: matches "QK12AB-34", rejects "QK12#AB".
// https://regex101.com/?regex=%5E%5BA-Z0-9%2F_.-%5D%2B%24&flags=gm&testString=QK12AB-34%0AQK12%23AB
const CODE_CHARS = /^[A-Z0-9/_.-]+$/;

const CODE_LABELS: Readonly<Record<string, string>> = {
  'M-Pesa': 'M-Pesa code',
  'Airtel Money': 'Airtel code',
  Bank: 'Bank reference',
};

/** Methods whose money the cashier can't hold in hand, so the sale needs the payment's code. */
export const needsPaymentCode = (method: PaymentMethod | string): boolean => method in CODE_LABELS;

/** "qk 12 ab-34" -> "QK12AB-34" (same as fn_tidy_payment_ref). */
export const tidyPaymentCode = (raw: string | null | undefined): string =>
  (raw ?? '').replace(WHITESPACE, '').toUpperCase();

/** What the box is called: "M-Pesa code", "Airtel code", "Bank reference". */
export const paymentCodeLabel = (method: PaymentMethod | string): string => CODE_LABELS[method] ?? 'Payment code';

/** Why the code can't be used yet, or null when it looks right. */
export function paymentCodeProblem(method: PaymentMethod | string, raw: string | null | undefined): string | null {
  if (!needsPaymentCode(method)) return null;
  const code = tidyPaymentCode(raw);
  const label = paymentCodeLabel(method).toLowerCase();
  if (!code) return `Record the money first: enter the ${label} from the payment message. Not paid yet? Hold the sale.`;
  if (code.length < CODE_MIN_LENGTH || code.length > CODE_MAX_LENGTH || !CODE_CHARS.test(code)) {
    return `That ${label} doesn't look right. Check it against the message (letters and numbers, at least ${CODE_MIN_LENGTH}).`;
  }
  return null;
}
