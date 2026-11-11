// The four ways money comes in, in the order the app shows them. One list so the till,
// the Money page, customers and expenses can't drift apart.
import type { MoneyMethod } from "../types";

export const MONEY_METHODS: readonly MoneyMethod[] = ["Cash", "M-Pesa", "Card", "Bank"] as const;

const LABELS: Record<string, string> = {
  Cash: "Cash",
  "M-Pesa": "M-Pesa",
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

export function isMoneyMethod(method: unknown): method is MoneyMethod {
  return typeof method === "string" && (MONEY_METHODS as readonly string[]).includes(method);
}

/** What the reference field asks for with each method. Cash needs none. */
export function referenceHint(method: MoneyMethod): { label: string; placeholder: string } | null {
  switch (method) {
    case "M-Pesa": return { label: "M-Pesa code", placeholder: "e.g. SXK2M9Q1TZ" };
    case "Card": return { label: "Approval code from the card machine", placeholder: "e.g. 004512" };
    case "Bank": return { label: "Bank reference", placeholder: "e.g. FT24310ABC" };
    default: return null;
  }
}

/** M-Pesa codes are capitals; bank and card references stay as typed, trimmed. */
export function normalizeReference(method: MoneyMethod, reference: string): string {
  const trimmed = reference.trim().replace(/\s+/g, " ");
  return method === "M-Pesa" ? trimmed.replace(/\s/g, "").toUpperCase() : trimmed;
}
