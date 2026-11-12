// Customer invoices: a statement of what a customer owes from credit sales.

export type InvoiceLineKind = "product" | "delivery" | "charge";

export interface InvoiceLine {
  id: string;
  kind: InvoiceLineKind;
  /** Day of the sale (YYYY-MM-DD), shown under the description. */
  date?: string;
  /** Editable before the invoice is issued. */
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
}

/** Wording on the invoice. All of it can be changed and saved as the default. */
export interface InvoiceTexts {
  title: string;
  prefix: string;
  fromLabel: string;
  toLabel: string;
  productHeader: string;
  priceHeader: string;
  qtyHeader: string;
  amountHeader: string;
  note: string;
  paymentInstructions: string;
  thankYou: string;
  footer: string;
  dueDays: number;
  /** "How to pay" block on the invoice. */
  showPaymentDetails: boolean;
  /** The business's digital stamp beside the totals. */
  showStamp: boolean;
  stampLabel: string;
  stampColor: string;
  /** Period a new invoice starts with. */
  defaultPeriod: InvoicePeriodPreset;
  /** Logo height on the page, in mm (A5). */
  logoSize: number;
  /** Where the stamp was dragged to, in mm from its usual place beside the totals. */
  stampOffset: { x: number; y: number };
  /** The receipt's extra QR code (Settings → Receipts → Codes). */
  showQr: boolean;
  /** Close with the receipt's line after the totals, returns policy and thank-you line. */
  closingFromReceipt: boolean;
}

/** The receipt's closing texts, copied onto the invoice when it is made. */
export interface InvoiceClosing {
  message?: string;
  policy?: string;
  thankYou?: string;
}

export type InvoicePeriodPreset = "all" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

/** Sales from `from` to `to` (YYYY-MM-DD, inclusive). */
export interface InvoicePeriod {
  from: string;
  to: string;
  /** Add what is still unpaid from before `from` as one line. */
  includeEarlier: boolean;
}

export interface InvoiceParty {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  extra?: string;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  /** Already paid towards these sales (part payments, wallet). */
  paid: number;
  balance: number;
  /** Everything the customer owes, when the invoice covers only a period. */
  owedNow?: number;
}

export interface InvoiceDocument {
  /** Set once issued: "INV-0003". */
  invoiceNo?: string;
  number?: number;
  issuedAt: string;
  dueAt: string;
  period?: InvoicePeriod;
  currency: string;
  accent: string;
  logoUrl?: string;
  from: InvoiceParty;
  to: InvoiceParty;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  texts: InvoiceTexts;
  /** From the receipt settings when the invoice was made; kept with the issued invoice. */
  closing?: InvoiceClosing;
  qr?: { url: string; caption: string };
}

/** An open credit record with its sale, as read from the database. */
export interface OpenCredit {
  id: string;
  /** The sale this credit record belongs to, when it came from a sale. */
  saleId?: string;
  createdAt: string;
  amountOwed: number;
  amountPaid: number;
  balance: number;
  note?: string | null;
  sale?: {
    id: string;
    timestamp: string;
    tax: number;
    deliveryFee: number;
    finalTotal: number;
    items: Array<{ name: string; unitPrice: number; quantity: number; unit?: string }>;
  } | null;
}
