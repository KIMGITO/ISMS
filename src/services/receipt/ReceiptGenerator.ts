import { Transaction } from "../../types";
import { ReceiptContent, BusinessReceiptSettings, ReceiptItem, KraSignature } from "./types";
import { getShortId } from "../../utils/idUtils";

export interface ReceiptExtras {
  customerPhone?: string;
  customerEmail?: string;
  kra?: KraSignature;
}

const PAYMENT_LABELS: Record<string, string> = {
  Cash: "Cash",
  "M-Pesa": "M-Pesa",
  Card: "Card",
  Bank: "Bank transfer",
  Mobile_Wallet: "Wallet",
  Credit_Debt: "Credit",
  Credit: "Credit",
  Other: "Other",
};

export function paymentLabel(method: string | undefined): string {
  return PAYMENT_LABELS[method || ""] || method || "Cash";
}

export function isCreditSale(method: string | undefined): boolean {
  return method === "Credit_Debt" || method === "Credit";
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function formatReceiptNo(txId: string, timestamp: string | undefined, settings: BusinessReceiptSettings): string {
  const shortId = getShortId(txId);
  const prefix = settings.receiptPrefix.replace(/[-\s]+$/, "");
  const year = new Date(timestamp || Date.now()).getFullYear();
  if (settings.receiptNumberFormat === "INCREMENT" || !prefix) return shortId;
  if (settings.receiptNumberFormat === "PREFIX-INCREMENT") return `${prefix}-${shortId}`;
  return `${prefix}-${year}-${shortId}`;
}

function extraQr(settings: BusinessReceiptSettings, receiptNumber: string): ReceiptContent["extraQr"] {
  switch (settings.extraQr) {
    case "business_website": {
      const site = settings.website.trim().replace(/^https?:\/\//, "");
      return site ? { url: `https://${site}`, caption: "Visit us online" } : undefined;
    }
    case "whatsapp_chat": {
      const phone = settings.phone.replace(/\D/g, "").replace(/^0/, "254");
      return phone
        ? { url: `https://wa.me/${phone}?text=${encodeURIComponent(`Hello, about receipt ${receiptNumber}`)}`, caption: "Chat with us on WhatsApp" }
        : undefined;
    }
    case "google_review":
      return settings.businessName
        ? { url: `https://search.google.com/local/writereview?q=${encodeURIComponent(settings.businessName)}`, caption: "Review us on Google" }
        : undefined;
    case "custom_url": {
      const url = settings.customQrUrl.trim();
      return /^https?:\/\//i.test(url) ? { url, caption: "Scan me" } : undefined;
    }
    default:
      return undefined;
  }
}

function formatDate(date: Date, format: BusinessReceiptSettings["dateFormat"]): string {
  if (format === "medium") return date.toLocaleDateString("en-KE", { dateStyle: "medium" });
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  if (format === "MM/DD/YYYY") return `${month}/${day}/${year}`;
  if (format === "YYYY-MM-DD") return `${year}-${month}-${day}`;
  return `${day}/${month}/${year}`;
}

function formatTime(date: Date, format: BusinessReceiptSettings["timeFormat"]): string {
  const minutes = String(date.getMinutes()).padStart(2, "0");
  if (format === "12h") {
    const h = date.getHours();
    return `${h % 12 || 12}:${minutes} ${h >= 12 ? "PM" : "AM"}`;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${minutes}`;
}

/** Maps a saved sale onto what a receipt shows. Uses only the sale's own figures. */
export function buildReceiptContent(tx: Transaction, settings: BusinessReceiptSettings, extras: ReceiptExtras = {}): ReceiptContent {
  const when = new Date(tx.timestamp || Date.now());
  const receiptNumber = formatReceiptNo(tx.id, tx.timestamp, settings);

  const items: ReceiptItem[] = (tx.items || []).map((item) => {
    const unitPrice = Number(item.product?.price) || 0;
    const quantity = Number(item.quantity) || 0;
    const discountPercentage = Number(item.discountPercentage) || 0;
    return {
      id: item.product?.id || "",
      name: item.product?.name || "Item",
      unit: item.product?.unit || undefined,
      quantity,
      unitPrice,
      discountPercentage,
      total: round2(unitPrice * quantity * (1 - discountPercentage / 100)),
    };
  });

  const grandTotal = round2(tx.finalTotal);
  const credit = isCreditSale(tx.paymentMethod);
  const tax = round2(tx.tax);
  const subtotalBeforeTax = round2((Number(tx.total) || 0) - (Number(tx.discount) || 0));

  return {
    receiptId: tx.id,
    receiptNumber,
    transactionDate: formatDate(when, settings.dateFormat),
    transactionTime: formatTime(when, settings.timeFormat),
    cashierName: tx.staffName || "",
    customerName: tx.customerName || undefined,
    customerPhone: extras.customerPhone || undefined,
    customerEmail: extras.customerEmail || undefined,
    paymentMethodCode: tx.paymentMethod,
    paymentMethod: paymentLabel(tx.paymentMethod),
    items,
    subtotal: round2(tx.total),
    discount: round2(tx.discount),
    taxTotal: tax,
    taxRate: tax > 0 && subtotalBeforeTax > 0 ? Math.round((tax / subtotalBeforeTax) * 1000) / 10 : 0,
    deliveryFee: tx.isDelivery ? round2(tx.deliveryFee || 0) : 0,
    grandTotal,
    amountPaid: credit ? 0 : grandTotal,
    balanceDue: credit ? grandTotal : 0,
    note: tx.note || undefined,
    kra: extras.kra,
    extraQr: extraQr(settings, receiptNumber),
  };
}
