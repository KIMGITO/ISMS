// Invoice wording per business, saved with the business's other settings.
import { useBusinessStore } from "../../stores/businessStore";
import type { Business } from "../../types";
import { ReceiptSettingsService } from "../receipt/ReceiptSettings";
import type { BusinessReceiptSettings } from "../receipt/types";
import { extraQr } from "../receipt/ReceiptGenerator";
import { InvoiceDocument, InvoiceTexts } from "./types";

export const DEFAULT_ACCENT = "#1F6FEB";

export const LOGO_SIZE = { min: 8, max: 45, default: 18 };

/** The footer's contact line, always read from the business's current details. */
export function contactsLine(shop: Pick<BusinessReceiptSettings, "phone" | "email" | "address" | "website">): string {
  return [shop.phone, shop.email, shop.address, shop.website].map((v) => (v || "").trim()).filter(Boolean).join("   ");
}

export function defaultInvoiceTexts(business?: Business): InvoiceTexts {
  const footer = [business?.contactPhone, business?.contactEmail, business?.address].filter(Boolean).join("   ");
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
    logoSize: LOGO_SIZE.default,
    stampOffset: { x: 0, y: 0 },
    showQr: true,
    closingFromReceipt: true,
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Keeps stored values in range; invoices issued before a setting existed get its default. */
export function normalizeInvoiceTexts(saved: Partial<InvoiceTexts> | undefined, base: InvoiceTexts): InvoiceTexts {
  const out: InvoiceTexts = { ...base, stampOffset: { ...base.stampOffset } };
  const s = saved || {};
  for (const key of Object.keys(base) as (keyof InvoiceTexts)[]) {
    const v = s[key];
    if (key === "dueDays") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0 && n <= 365) out.dueDays = Math.round(n);
    } else if (key === "logoSize") {
      const n = Number(v);
      if (v != null && Number.isFinite(n)) out.logoSize = clamp(Math.round(n), LOGO_SIZE.min, LOGO_SIZE.max);
    } else if (key === "stampOffset") {
      const o = v as InvoiceTexts["stampOffset"] | undefined;
      if (o && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y))) {
        out.stampOffset = { x: clamp(Number(o.x), -148, 148), y: clamp(Number(o.y), -210, 210) };
      }
    } else if (key === "showPaymentDetails" || key === "showStamp" || key === "showQr" || key === "closingFromReceipt") {
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

export function getInvoiceTexts(businessId?: string | null): InvoiceTexts {
  const state = useBusinessStore.getState();
  const id = businessId || state.activeBusinessId;
  const business = state.businesses.find((b) => b.id === id);
  const out = normalizeInvoiceTexts(state.integrationConfigs["invoice"] as Partial<InvoiceTexts>, defaultInvoiceTexts(business));
  // Contacts are never a saved copy: they follow the business details.
  out.footer = id ? contactsLine(ReceiptSettingsService.getSettings(id)) : out.footer;
  return out;
}

export function saveInvoiceTexts(texts: InvoiceTexts): Promise<void> {
  const { footer: _contacts, ...rest } = texts;
  return useBusinessStore.getState().updateIntegrationConfig("invoice", rest);
}

export function invoiceAccent(business?: Business): string {
  const c = business?.primaryColor || "";
  return /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_ACCENT;
}

/**
 * What the invoice borrows from the receipt settings: the closing texts and the extra QR code.
 * Copied when the invoice is made, so an issued invoice keeps them as they were.
 */
export function receiptClosing(shop: BusinessReceiptSettings): Pick<InvoiceDocument, "closing" | "qr"> {
  const closing = {
    message: shop.footerMessage.trim() || undefined,
    policy: shop.returnPolicy.trim() || undefined,
    thankYou: shop.thankYouMessage.trim() || undefined,
  };
  return {
    closing: closing.message || closing.policy || closing.thankYou ? closing : undefined,
    qr: extraQr(shop, "", "my invoice"),
  };
}
