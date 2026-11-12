import { Transaction } from "../../types";
import { pointsEarned as earnedOnSale } from "../loyalty/tillPoints";
import { ReceiptContent, BusinessReceiptSettings, ReceiptItem, KraSignature } from "./types";
import { getShortId } from "../../utils/idUtils";
import { customerName } from "../../utils/stringUtils";

export interface ReceiptExtras {
  customerPhone?: string;
  customerEmail?: string;
  kra?: KraSignature;
  /** Points spent on this sale (from the till) */
  pointsUsed?: { points: number; value: number } | null;
  /** The customer's points balance now */
  customerPoints?: number;
  /** Points switched off for the business: the receipt says nothing about points */
  pointsOff?: boolean;
}

const PAYMENT_LABELS: Record<string, string> = {
  Cash: "Cash",
  "M-Pesa": "M-Pesa",
  Card: "Card",
  Bank: "Bank transfer",
  Credit_Debt: "Credit",
  Credit: "Credit",
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

/** The extra QR code chosen in the receipt settings. `about` names the paper in the WhatsApp greeting. */
export function extraQr(settings: BusinessReceiptSettings, receiptNumber: string, about = "receipt"): ReceiptContent["extraQr"] {
  switch (settings.extraQr) {
    case "business_website": {
      const site = settings.website.trim().replace(/^https?:\/\//, "");
      return site ? { url: `https://${site}`, caption: "Visit us online" } : undefined;
    }
    case "whatsapp_chat": {
      const phone = settings.phone.replace(/\D/g, "").replace(/^0/, "254");
      return phone
        ? { url: `https://wa.me/${phone}?text=${encodeURIComponent(`Hello, about ${about} ${receiptNumber}`.trim())}`, caption: "Chat with us on WhatsApp" }
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
/** Points on the receipt: only for a named customer, and only when there is something to say. */
function loyaltyFor(tx: Transaction, extras: ReceiptExtras): ReceiptContent["loyalty"] {
  if (!tx.customerId || extras.pointsOff) return undefined;
  const pointsUsed = extras.pointsUsed?.points || 0;
  const pointsValue = round2(extras.pointsUsed?.value || 0);
  // Same rule as the database: 2 per KSh 1 paid; on a credit sale only the wallet-paid part earns.
  const pointsEarned = earnedOnSale(Number(tx.finalTotal) || 0, tx.isDelivery ? Number(tx.deliveryFee) || 0 : 0, tx.paymentMethod, Number(tx.walletApplied) || 0);
  const balance = typeof extras.customerPoints === "number" && Number.isFinite(extras.customerPoints) ? extras.customerPoints : undefined;
  if (!pointsUsed && !pointsEarned && balance === undefined) return undefined;
  return { pointsUsed, pointsValue, pointsEarned, balance };
}

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
  // A credit sale takes the customer's wallet money first; only the rest is owed.
  const walletPaid = credit ? Math.min(grandTotal, round2(Number(tx.walletApplied) || 0)) : 0;
  const owed = credit ? round2(grandTotal - walletPaid) : 0;
  const tax = round2(tx.tax);
  const subtotalBeforeTax = round2((Number(tx.total) || 0) - (Number(tx.discount) || 0));

  return {
    receiptId: tx.id,
    receiptNumber,
    transactionDate: formatDate(when, settings.dateFormat),
    transactionTime: formatTime(when, settings.timeFormat),
    cashierName: tx.staffName || "",
    customerName: customerName(tx.customerName) || undefined,
    customerPhone: extras.customerPhone || undefined,
    customerEmail: extras.customerEmail || undefined,
    paymentMethodCode: tx.paymentMethod,
    paymentMethod: credit && walletPaid > 0 && owed === 0 ? "Wallet" : credit && walletPaid > 0 ? "Wallet + credit" : paymentLabel(tx.paymentMethod),
    items,
    subtotal: round2(tx.total),
    discount: round2(tx.discount),
    taxTotal: tax,
    taxRate: tax > 0 && subtotalBeforeTax > 0 ? Math.round((tax / subtotalBeforeTax) * 1000) / 10 : 0,
    deliveryFee: tx.isDelivery ? round2(tx.deliveryFee || 0) : 0,
    grandTotal,
    amountPaid: credit ? 0 : grandTotal,
    walletPaid,
    balanceDue: owed,
    note: tx.note || undefined,
    loyalty: loyaltyFor(tx, extras),
    kra: extras.kra,
    extraQr: extraQr(settings, receiptNumber),
  };
}
