// Receipt and invoice numbers as people type them. A receipt can be printed as
// RCT-2026-ABCD1234, RCT-ABCD1234 or ABCD1234, and logs call it TXN-ABCD1234: all of them
// end in the same eight characters from the sale's ID, so that code is what is matched.
import { getShortId } from "./idUtils";

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** The sale code in what was typed ("rct-2026-abcd12" gives "ABCD12"), or null when it does not look like one. */
export function receiptCode(text: string): string | null {
  const q = (text || "").trim();
  if (UUID.test(q)) return getShortId(q);
  // A bare code first, so its letters are never taken for a prefix; then prefix, optional year, code.
  const m = /^([0-9a-f]{4,8})$/i.exec(q) || /^[a-z]{2,6}?[-\s]?(?:(?:19|20)\d{2}[-\s]?)?([0-9a-f]{4,8})$/i.exec(q);
  if (!m) return null;
  const code = m[1].toUpperCase();
  // Plain numbers under 6 digits are more likely a price or quantity than a receipt.
  if (/^\d+$/.test(code) && code.length < 6 && !/[a-z]/i.test(q)) return null;
  return code;
}

/** True when this sale is the one the code points at (the code may be the start of it). */
export function matchesReceipt(txId: string, code: string): boolean {
  return !!code && getShortId(txId).startsWith(code);
}

/** True when a log's text mentions a receipt with this code (TXN-ABCD1234, RCT-2026-ABCD1234…). */
export function mentionsReceipt(text: string | undefined | null, code: string): boolean {
  if (!text || !code) return false;
  const re = new RegExp(`(?:^|[^0-9a-z])(?:[a-z]{2,6}-)?(?:(?:19|20)\\d{2}-)?${code}`, "i");
  return re.test(text);
}

/** Sale code inside a log's text, for linking the log back to its sale. */
export function receiptCodeIn(text: string | undefined | null): string | null {
  const m = /\b(?:TXN|RCT)-(?:(?:19|20)\d{2}-)?([0-9A-F]{8})\b/i.exec(text || "");
  return m ? m[1].toUpperCase() : null;
}
