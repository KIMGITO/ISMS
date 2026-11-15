// The five ways money comes in, in the order the app shows them. One list so the till,
// the Money page, customers and expenses can't drift apart.
// Each business switches methods on and off (businesses.default_payment_methods); use
// enabledMethods() wherever someone picks how a customer pays.
import type { MoneyMethod } from "../types";

export const MONEY_METHODS: readonly MoneyMethod[] = ["Cash", "M-Pesa", "Airtel Money", "Card", "Bank"] as const;

/** What a business that never chose gets: everything except Airtel Money, which needs setting up. */
export const DEFAULT_ENABLED_METHODS: readonly MoneyMethod[] = ["Cash", "M-Pesa", "Card", "Bank"];

const LABELS: Record<string, string> = {
  Cash: "Cash",
  "M-Pesa": "M-Pesa",
  "Airtel Money": "Airtel Money",
  Card: "Card",
  Bank: "Bank",
  Credit_Debt: "Credit",
  Credit: "Credit",
};

/** How a method reads on screen and receipts. Older records may still say something else. */
export function methodLabel(method: string | null | undefined): string {
  if (!method) return "";
  return LABELS[method] ?? method.replace(/_/g, " ");
}

/** Short label for tight buttons (the POS row). */
export function methodShortLabel(method: string): string {
  return method === "Airtel Money" ? "Airtel" : methodLabel(method);
}

export function isMoneyMethod(method: unknown): method is MoneyMethod {
  return typeof method === "string" && (MONEY_METHODS as readonly string[]).includes(method);
}

/**
 * The methods a business takes, in the app's order. A missing or empty list (old data,
 * offline first start) falls back to the defaults so the till is never left with nothing.
 */
export function enabledMethods(list: readonly string[] | null | undefined): MoneyMethod[] {
  const chosen = (list ?? []).filter(isMoneyMethod);
  const source = chosen.length > 0 ? chosen : DEFAULT_ENABLED_METHODS;
  return MONEY_METHODS.filter((m) => source.includes(m));
}

/** What the reference field asks for with each method. Cash needs none. */
export function referenceHint(method: MoneyMethod): { label: string; placeholder: string } | null {
  switch (method) {
    case "M-Pesa": return { label: "M-Pesa code", placeholder: "e.g. SXK2M9Q1TZ" };
    case "Airtel Money": return { label: "Airtel Money transaction ID", placeholder: "e.g. MP241114.1530.A12345" };
    case "Card": return { label: "Approval code from the card machine", placeholder: "e.g. 004512" };
    case "Bank": return { label: "Bank reference", placeholder: "e.g. FT24310ABC" };
    default: return null;
  }
}

/** M-Pesa and Airtel codes are capitals; bank and card references stay as typed, trimmed. */
export function normalizeReference(method: MoneyMethod, reference: string): string {
  const trimmed = reference.trim().replace(/\s+/g, " ");
  return method === "M-Pesa" || method === "Airtel Money" ? trimmed.replace(/\s/g, "").toUpperCase() : trimmed;
}
