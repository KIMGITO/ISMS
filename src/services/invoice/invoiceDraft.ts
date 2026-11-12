// Builds an invoice from a customer's open credit. Pure functions, so they can be tested.
import { InvoiceDocument, InvoiceLine, InvoiceParty, InvoicePeriod, InvoicePeriodPreset, InvoiceTexts, InvoiceTotals, OpenCredit } from "./types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const day = (iso: string) => (iso || "").slice(0, 10);

let seq = 0;
const lineId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * One line per product sold on credit, one per delivery fee, and one per balance added by hand.
 * The balance always equals what the customer owes now: anything not explained by the open
 * sales becomes an "Earlier balance" line (or counts as paid when they owe less).
 */
export function buildInvoiceLines(credits: OpenCredit[], owesNow: number, period?: InvoicePeriod): { lines: InvoiceLine[]; totals: InvoiceTotals } {
  const lines: InvoiceLine[] = [];
  let discount = 0;
  let tax = 0;
  let paid = 0;

  const ordered = [...credits].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const when = (c: OpenCredit) => day(c.sale?.timestamp || c.createdAt);
  const inPeriod = period ? ordered.filter((c) => when(c) >= period.from && when(c) <= period.to) : ordered;
  for (const c of inPeriod) {
    const sale = c.sale;
    if (sale) {
      let gross = 0;
      for (const it of sale.items) {
        const amount = round2(it.unitPrice * it.quantity);
        gross += amount;
        lines.push({ id: lineId(), kind: "product", date: day(sale.timestamp), description: it.name, quantity: it.quantity, unit: it.unit, unitPrice: round2(it.unitPrice), amount });
      }
      const delivery = round2(sale.deliveryFee);
      if (delivery > 0) {
        lines.push({ id: lineId(), kind: "delivery", date: day(sale.timestamp), description: "Delivery", quantity: 1, unitPrice: delivery, amount: delivery });
      }
      tax += sale.tax || 0;
      // Whatever the sale took off the line prices (item and cart discounts, points).
      discount += Math.max(0, gross + (sale.tax || 0) + delivery - sale.finalTotal);
      // Part payments and wallet money already set against this sale.
      paid += Math.max(0, sale.finalTotal - c.balance);
    } else {
      const amount = round2(c.amountOwed);
      lines.push({ id: lineId(), kind: "charge", date: day(c.createdAt), description: c.note?.trim() || "Balance added to the account", quantity: 1, unitPrice: amount, amount });
      paid += c.amountPaid || 0;
    }
  }

  let subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  discount = round2(discount);
  tax = round2(tax);
  paid = round2(paid);
  const owed = round2(owesNow);

  if (period) {
    // A weekly or monthly invoice: the period's sales, plus (if chosen) one line for what is
    // still unpaid from before it. Anything owed that no open sale explains counts as earlier.
    if (period.includeEarlier) {
      const allOpen = ordered.reduce((sum, c) => sum + c.balance, 0);
      const before = ordered.filter((c) => when(c) < period.from).reduce((sum, c) => sum + c.balance, 0);
      const earlier = round2(before + Math.max(0, owed - allOpen));
      if (earlier > 0.009) {
        lines.unshift({ id: lineId(), kind: "charge", description: `Unpaid from before ${formatInvoiceDate(period.from)}`, quantity: 1, unitPrice: earlier, amount: earlier });
        subtotal = round2(subtotal + earlier);
      }
    }
    const balance = round2(subtotal - discount + tax - paid);
    return { lines, totals: { subtotal, discount, tax, paid, balance, owedNow: owed } };
  }

  const diff = round2(owed - (subtotal - discount + tax - paid));
  if (diff > 0.009) {
    lines.unshift({ id: lineId(), kind: "charge", description: "Earlier balance", quantity: 1, unitPrice: diff, amount: diff });
    subtotal = round2(subtotal + diff);
  } else if (diff < -0.009) {
    paid = round2(paid - diff);
  }
  return { lines, totals: { subtotal, discount, tax, paid, balance: owed } };
}

/**
 * Joins lines for the same product at the same price, and delivery fees of the same amount
 * into one "Delivery" line (dates are dropped). Amounts are summed, so totals do not change.
 */
export function combineSameProducts(lines: InvoiceLine[]): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  const index = new Map<string, number>();
  for (const l of lines) {
    if (l.kind === "charge") {
      out.push({ ...l });
      continue;
    }
    const key = l.kind === "delivery" ? `delivery|${l.unitPrice}` : `product|${l.description.trim().toLowerCase()}|${l.unitPrice}|${l.unit || ""}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push({ ...l, date: undefined });
    } else {
      const m = out[at];
      m.quantity = Math.round((m.quantity + l.quantity) * 1000) / 1000;
      m.amount = round2(m.amount + l.amount);
    }
  }
  // A delivery line that now stands for several trips says so.
  for (const l of out) if (l.kind === "delivery" && l.quantity > 1 && l.description === "Delivery") l.description = "Deliveries";
  return out;
}

export function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildInvoiceDocument(args: {
  credits: OpenCredit[];
  owesNow: number;
  from: InvoiceParty;
  to: InvoiceParty;
  texts: InvoiceTexts;
  currency: string;
  accent: string;
  logoUrl?: string;
  closing?: InvoiceDocument["closing"];
  qr?: InvoiceDocument["qr"];
  combine?: boolean;
  issuedAt?: string;
  period?: InvoicePeriod;
}): InvoiceDocument {
  const { lines, totals } = buildInvoiceLines(args.credits, args.owesNow, args.period);
  const issuedAt = args.issuedAt || todayIso();
  return {
    issuedAt,
    dueAt: addDays(issuedAt, Math.max(0, args.texts.dueDays || 0)),
    currency: args.currency,
    accent: args.accent,
    logoUrl: args.logoUrl,
    period: args.period,
    from: args.from,
    to: args.to,
    lines: args.combine ? combineSameProducts(lines) : lines,
    totals,
    texts: args.texts,
    closing: args.closing,
    qr: args.qr,
  };
}

export function formatInvoiceMoney(value: number, currency: string): string {
  const n = (Number(value) || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`.trim();
}

export function formatInvoiceDate(isoDay: string): string {
  if (!isoDay) return "";
  const [y, m, d] = isoDay.split("-");
  return `${d}/${m}/${y}`;
}

export function formatQty(q: number): string {
  return String(Math.round((Number(q) || 0) * 1000) / 1000);
}


const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The dates a preset stands for, counted from `today`. Weeks start on Monday. */
export function periodFor(preset: Exclude<InvoicePeriodPreset, "all" | "custom">, today = new Date()): { from: string; to: string } {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  switch (preset) {
    case "this_week":
      return { from: iso(monday), to: iso(d) };
    case "last_week": {
      const start = new Date(monday);
      start.setDate(monday.getDate() - 7);
      const end = new Date(monday);
      end.setDate(monday.getDate() - 1);
      return { from: iso(start), to: iso(end) };
    }
    case "this_month":
      return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(d) };
    case "last_month":
      return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
  }
}

export const PERIOD_LABELS: Record<InvoicePeriodPreset, string> = {
  all: "Everything owed",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  custom: "Pick dates",
};

/** "01/11/2026 – 30/11/2026" */
export function formatPeriod(p?: { from: string; to: string }): string {
  return p ? `${formatInvoiceDate(p.from)} – ${formatInvoiceDate(p.to)}` : "";
}
