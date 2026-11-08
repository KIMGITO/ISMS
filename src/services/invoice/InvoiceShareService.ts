// Sharing an issued invoice: PDF (share sheet or download), email, WhatsApp message.
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { nativePlatformService } from "../../core/native/NativePlatformService";
import { ReceiptMail } from "../../core/native/BluetoothService";
import { ReceiptShareService } from "../receipt/ReceiptShareService";
import { getFirstName } from "../../utils/stringUtils";
import { InvoiceDocument } from "./types";
import { buildInvoicePdf } from "./invoicePdf";
import { formatInvoiceDate, formatInvoiceMoney } from "./invoiceDraft";

export function invoiceFileName(inv: InvoiceDocument): string {
  const no = (inv.invoiceNo || "draft").replace(/[^A-Za-z0-9_-]/g, "_");
  return `invoice_${no}.pdf`;
}

function titleOf(inv: InvoiceDocument): string {
  return `${inv.texts.title} ${inv.invoiceNo || ""}${inv.from.name ? ` - ${inv.from.name}` : ""}`.replace(/\s+/g, " ").trim();
}

/** The message sent with an invoice: who, how much, by when, how to pay. */
export function invoiceMessage(inv: InvoiceDocument): string {
  const lines = [
    `Hello ${getFirstName(inv.to.name) || "there"},`,
    "",
    `${inv.texts.title} ${inv.invoiceNo || ""}${inv.from.name ? ` from ${inv.from.name}` : ""}`.trim(),
    `Balance due: ${formatInvoiceMoney(inv.totals.balance, inv.currency)}`,
  ];
  if (inv.dueAt) lines.push(`Please pay by ${formatInvoiceDate(inv.dueAt)}.`);
  if (inv.texts.paymentInstructions) lines.push("", inv.texts.paymentInstructions);
  if (inv.texts.thankYou) lines.push("", inv.texts.thankYou);
  return lines.join("\n");
}

async function pdfBase64(inv: InvoiceDocument): Promise<string> {
  const doc = await buildInvoicePdf(inv);
  return doc.output("datauristring").split(",")[1];
}

async function writeNative(inv: InvoiceDocument): Promise<string> {
  const result = await Filesystem.writeFile({
    path: `invoices/${invoiceFileName(inv)}`,
    data: await pdfBase64(inv),
    directory: Directory.Cache,
    recursive: true,
  });
  return result.uri;
}

export class InvoiceShareService {
  /** Phone: share sheet with the PDF. Browser: share the file where possible, else download it. */
  static async sharePdf(inv: InvoiceDocument): Promise<"shared" | "downloaded" | "cancelled"> {
    const title = titleOf(inv);
    if (nativePlatformService.isNative()) {
      const uri = await writeNative(inv);
      try {
        await Share.share({ title, text: invoiceMessage(inv), files: [uri], dialogTitle: "Share invoice" });
        return "shared";
      } catch (err: any) {
        if (/cancel/i.test(String(err?.message))) return "cancelled";
        throw err;
      }
    }
    const doc = await buildInvoicePdf(inv);
    const isDesktopApp = !!(window as any).__TAURI__;
    if (!isDesktopApp && typeof navigator !== "undefined" && navigator.canShare) {
      const file = new File([doc.output("blob")], invoiceFileName(inv), { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title, files: [file] });
          return "shared";
        } catch (err: any) {
          if (err?.name === "AbortError") return "cancelled";
        }
      }
    }
    doc.save(invoiceFileName(inv));
    return "downloaded";
  }

  static async download(inv: InvoiceDocument): Promise<void> {
    if (nativePlatformService.isNative()) {
      await this.sharePdf(inv);
      return;
    }
    (await buildInvoicePdf(inv)).save(invoiceFileName(inv));
  }

  /** Android: email app with the PDF attached. Elsewhere: saves the PDF and opens an email with the summary. */
  static async email(inv: InvoiceDocument, to: string): Promise<"attached" | "text_only"> {
    const subject = titleOf(inv);
    const sign = inv.from.name ? `\n\nRegards,\n${inv.from.name}` : "";
    if (nativePlatformService.isAndroid()) {
      const path = await writeNative(inv);
      await ReceiptMail.compose({ to, subject, body: `${invoiceMessage(inv)}\n\nThe invoice is attached.${sign}`, path });
      return "attached";
    }
    await this.download(inv);
    await ReceiptShareService.shareTextViaEmail(to, subject, `${invoiceMessage(inv)}\n\nPlease find the invoice attached.${sign}`);
    return "text_only";
  }

  /** Opens a WhatsApp chat with the customer carrying the invoice summary. */
  static whatsapp(inv: InvoiceDocument, phone: string): Promise<boolean> {
    return ReceiptShareService.shareTextViaWhatsApp(phone, invoiceMessage(inv));
  }
}
