// Sharing a quote as a PDF or on WhatsApp. Used by the POS cart (right after saving one) and
// by Sales Log → Quotes.
import type { Business } from "../types";
import { ReceiptService } from "./receipt/ReceiptService";
import { getInvoiceTexts, invoiceAccent, receiptClosing } from "./invoice/invoiceSettings";
import { InvoiceShareService } from "./invoice/InvoiceShareService";
import { toInvoiceDocument, type Quote } from "./salesDocs";

export function quoteDocument(q: Quote, business: Business | undefined, businessId: string) {
  const shop = ReceiptService.getSettings(businessId);
  return toInvoiceDocument({
    kind: "quote",
    number: q.number,
    issueDate: q.issueDate,
    validUntil: q.validUntil,
    lines: q.lines,
    subtotal: q.subtotal,
    vat: q.vat,
    deliveryFee: q.deliveryFee,
    paid: 0,
    balance: q.total,
    from: { name: shop.businessName || business?.name || "", address: shop.address, phone: shop.phone, email: shop.email, extra: shop.pinNumber ? `PIN: ${shop.pinNumber}` : undefined },
    to: { name: q.customerName, phone: q.customerPhone || undefined },
    texts: getInvoiceTexts(businessId),
    currency: shop.currencyFormat || "KSh",
    accent: invoiceAccent(business),
    logoUrl: business?.logoUrl,
    ...receiptClosing(shop),
  });
}

/** "shared" | "downloaded" | "cancelled", like the invoice share. */
export const shareQuotePdf = (q: Quote, business: Business | undefined, businessId: string) =>
  InvoiceShareService.sharePdf(quoteDocument(q, business, businessId));

export const shareQuoteWhatsApp = (q: Quote, phone: string, business: Business | undefined, businessId: string) =>
  InvoiceShareService.whatsapp(quoteDocument(q, business, businessId), phone);
