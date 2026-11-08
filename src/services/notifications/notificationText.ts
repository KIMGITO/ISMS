// src/services/notifications/notificationText.ts
// Older notifications were saved with internal IDs in their text ("for invoice #3f2a9c1e-…",
// "Order tx-1731…") and called credit sales payments. This cleans them for display.
// New notifications are written without either (see notificationTemplates.ts).

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Internal keys such as tx-1731000000000, notif-…, debt-pay-…, ws_CO_… (M-Pesa request IDs).
const INTERNAL_KEY = /\b(?:tx|notif|debt-pay|debt|pay|dep|spend|ref)-[\w-]{6,}\b|\bws_CO_\w+\b/gi;

function tidySpaces(text: string): string {
  return text
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:])\1+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Removes internal references and the words that only introduced them. */
export function stripInternalIds(text: string): string {
  if (!text) return text;
  let out = String(text)
    // "for invoice #<id>", "Order <id>", "Ref: <id>", "receipt #<id>", "(Ref <id>)"
    .replace(/\s*(?:for\s+)?(?:invoice|order|receipt|ref(?:erence)?|txn?|transaction|id)\s*[:#]?\s*#?\s*(?=[0-9a-f]{8}-|tx-|ws_CO_|notif-|debt)[\w-]+/gi, "")
    .replace(UUID, "")
    .replace(INTERNAL_KEY, "")
    .replace(/#(?=\s|$|[.,])/g, "");
  out = tidySpaces(out);
  return out;
}

export interface NotificationTextFields {
  type?: string;
  title?: string;
  message?: string;
}

const EMOJI_PREFIX = /^(?:[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+\s*)+/u;

/** Display copy of a stored notification: no internal IDs, and credit sales not shown as payments. */
export function tidyNotification<T extends NotificationTextFields>(n: T): T {
  let title = stripInternalIds(n.title || "").replace(EMOJI_PREFIX, "");
  let message = stripInternalIds(n.message || "");
  let type = n.type;

  // "A payment of KSh 500 was received via Credit Debt" was a sale on credit, not money in.
  const credit = /\bvia\s+credit(?:\s+debt)?\b/i;
  if (type === "Payment Received" && credit.test(message)) {
    type = "Credit Sale";
    title = "Sold on credit";
    const amount = message.match(/KSh\s*[\d,.]+/i)?.[0];
    message = amount ? `${amount} sold on credit. It was added to the customer's debt.` : "A sale on credit was added to the customer's debt.";
  } else if (type === "Payment Received") {
    // "A payment of KSh 500 was received via M-Pesa." -> "KSh 500 received by M-Pesa."
    message = message.replace(/^A payment of (KSh\s*[\d,.]+) was received via ([^.]+)\.?$/i, "$1 received by $2.");
  }

  if (title === n.title && message === n.message && type === n.type) return n;
  return { ...n, title, message, type };
}
