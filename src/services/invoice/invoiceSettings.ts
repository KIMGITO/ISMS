// Invoice wording per business, saved with the business's other settings.
import { useBusinessStore } from "../../stores/businessStore";
import type { Business } from "../../types";
import { InvoiceTexts } from "./types";

export const DEFAULT_ACCENT = "#1F6FEB";

export function defaultInvoiceTexts(business?: Business): InvoiceTexts {
  const footer = [business?.contactPhone, business?.address].filter(Boolean).join("   ");
  return {
    title: "Invoice",
    prefix: "INV",
    fromLabel: "From",
    toLabel: "Bill to",
    productHeader: "Product",
    priceHeader: "Price",
    qtyHeader: "Qty",
    amountHeader: "Amount",
    note: "Goods supplied on credit.",
    paymentInstructions: "",
    thankYou: "Thank you!",
    footer,
    dueDays: 7,
    showPaymentDetails: true,
    showStamp: false,
    stampLabel: "Authorised",
    stampColor: "#1D4ED8",
    defaultPeriod: "all",
  };
}

export function getInvoiceTexts(businessId?: string | null): InvoiceTexts {
  const state = useBusinessStore.getState();
  const business = state.businesses.find((b) => b.id === (businessId || state.activeBusinessId));
  const base = defaultInvoiceTexts(business);
  const saved = (state.integrationConfigs["invoice"] || {}) as Partial<InvoiceTexts>;
  const out: InvoiceTexts = { ...base };
  for (const key of Object.keys(base) as (keyof InvoiceTexts)[]) {
    const v = saved[key];
    if (key === "dueDays") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0 && n <= 365) out.dueDays = Math.round(n);
    } else if (key === "showPaymentDetails" || key === "showStamp") {
      if (typeof v === "boolean") out[key] = v;
    } else if (key === "stampColor") {
      if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out.stampColor = v;
    } else if (key === "defaultPeriod") {
      if (["all", "this_week", "last_week", "this_month", "last_month"].includes(v as string)) out.defaultPeriod = v as InvoiceTexts["defaultPeriod"];
    } else if (typeof v === "string") {
      (out as any)[key] = v;
    }
  }
  return out;
}

export function saveInvoiceTexts(texts: InvoiceTexts): Promise<void> {
  return useBusinessStore.getState().updateIntegrationConfig("invoice", texts);
}

export function invoiceAccent(business?: Business): string {
  const c = business?.primaryColor || "";
  return /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_ACCENT;
}
