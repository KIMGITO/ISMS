import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { jsPDF } from "jspdf";
import { ReceiptContent, BusinessReceiptSettings } from "./types";
import { buildReceiptLines, buildReceiptText, columnsFor, linesToText, splitStyledTail } from "./layout";
import { buildReceiptPdf } from "./pdf";
import { nativePlatformService } from "../../core/native/NativePlatformService";
import { ReceiptMail } from "../../core/native/BluetoothService";
import { normalizePhone } from "../../utils/phoneUtils";
import { getFirstName } from "../../utils/stringUtils";

/** Phone chat bubbles fit about this many monospaced characters without wrapping. */
const CHAT_COLUMNS = 32;

function pdfFileName(content: ReceiptContent) {
  return `receipt_${content.receiptNumber.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
}

function pdfBase64(doc: jsPDF): string {
  return doc.output("datauristring").split(",")[1];
}

export class ReceiptShareService {
  /** Opens a link outside the app without crashing Tauri or mobile webviews. */
  public static async openExternalUrl(url: string): Promise<boolean> {
    try {
      if (typeof window !== "undefined" && (window as any).__TAURI__) {
        await (window as any).__TAURI__.core.invoke("open_url", { url });
        return true;
      }
      window.open(url, "_blank");
      return true;
    } catch (err) {
      console.error("Failed to open external URL:", err);
      return false;
    }
  }

  /** Opens WhatsApp with the text, addressed to the number when one is given. */
  public static async shareTextViaWhatsApp(phoneNumber: string, text: string): Promise<boolean> {
    const phone = phoneNumber ? normalizePhone(phoneNumber).replace(/\D/g, "") : "";
    const appUrl = `whatsapp://send?${phone ? `phone=${phone}&` : ""}text=${encodeURIComponent(text)}`;
    const webUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

    if (nativePlatformService.isNative()) {
      return new Promise<boolean>((resolve) => {
        let left = false;
        const cleanup = nativePlatformService.onAppPause(() => {
          left = true;
        });
        try {
          window.open(appUrl, "_self");
        } catch (e) {
          console.warn("Direct WhatsApp link failed:", e);
        }
        // If the app is still in front, WhatsApp is not installed: use the web link instead.
        setTimeout(async () => {
          cleanup();
          if (left) return resolve(true);
          resolve(await this.openExternalUrl(webUrl));
        }, 1500);
      });
    }
    return this.openExternalUrl(webUrl);
  }

  public static async shareTextViaEmail(recipientEmail: string, subject: string, body: string): Promise<boolean> {
    const url = `mailto:${encodeURIComponent(recipientEmail || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return this.openExternalUrl(url);
  }

  /** The receipt as chat text: the paper layout in a monospaced block, then any links. */
  public static receiptChatText(content: ReceiptContent, settings: BusinessReceiptSettings): string {
    const width = Math.min(columnsFor(settings), CHAT_COLUMNS);
    const { main, tail } = splitStyledTail(buildReceiptLines(content, { ...settings, charsPerLine: width }));
    const { body, links } = linesToText(main, width);
    let text = "```\n" + body + "\n```";
    for (const link of links) text += `\n${link.caption}: ${link.url}`;
    // Policy in italics, thank-you in bold, last as on the paper.
    if (tail.length) text += "\n";
    for (const t of tail) text += "\n" + (t.italic ? `_${t.text}_` : t.bold ? `*${t.text}*` : t.text);
    return text;
  }

  /** The receipt as plain text at the paper's own width (copy, .txt, email body). */
  public static receiptPlainText(content: ReceiptContent, settings: BusinessReceiptSettings): string {
    const { body, links } = buildReceiptText(content, settings);
    return [body, ...links.map((l) => `${l.caption}: ${l.url}`)].join("\n");
  }

  public static async whatsapp(content: ReceiptContent, settings: BusinessReceiptSettings, phone: string): Promise<boolean> {
    return this.shareTextViaWhatsApp(phone, this.receiptChatText(content, settings));
  }

  public static async buildPdf(content: ReceiptContent, settings: BusinessReceiptSettings): Promise<jsPDF> {
    return buildReceiptPdf(buildReceiptLines(content, settings), settings);
  }

  /** Writes the PDF where other Android apps can open it (the FileProvider covers the cache folder). */
  private static async writeNativePdf(content: ReceiptContent, settings: BusinessReceiptSettings): Promise<string> {
    const doc = await this.buildPdf(content, settings);
    const result = await Filesystem.writeFile({
      path: `receipts/${pdfFileName(content)}`,
      data: pdfBase64(doc),
      directory: Directory.Cache,
      recursive: true,
    });
    return result.uri;
  }

  /**
   * Phone: opens the share sheet with the PDF. Browser: shares the file where supported, otherwise downloads it.
   * Returns "shared" | "downloaded" | "cancelled".
   */
  public static async sharePdf(content: ReceiptContent, settings: BusinessReceiptSettings): Promise<"shared" | "downloaded" | "cancelled"> {
    const title = `Receipt ${content.receiptNumber} - ${settings.businessName}`.trim();
    if (nativePlatformService.isNative()) {
      const uri = await this.writeNativePdf(content, settings);
      try {
        await Share.share({ title, files: [uri], dialogTitle: "Share receipt PDF" });
        return "shared";
      } catch (err: any) {
        if (/cancel/i.test(String(err?.message))) return "cancelled";
        throw err;
      }
    }

    const doc = await this.buildPdf(content, settings);
    const isDesktopApp = !!(window as any).__TAURI__;
    if (!isDesktopApp && typeof navigator !== "undefined" && navigator.canShare) {
      const file = new File([doc.output("blob")], pdfFileName(content), { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ title, files: [file] });
          return "shared";
        } catch (err: any) {
          if (err?.name === "AbortError") return "cancelled";
        }
      }
    }
    doc.save(pdfFileName(content));
    return "downloaded";
  }

  public static async downloadPdf(content: ReceiptContent, settings: BusinessReceiptSettings): Promise<void> {
    if (nativePlatformService.isNative()) {
      await this.sharePdf(content, settings);
      return;
    }
    (await this.buildPdf(content, settings)).save(pdfFileName(content));
  }

  /**
   * Android: opens the email app addressed to the customer with the PDF attached.
   * Elsewhere: saves the PDF and opens an email with the receipt text, since mailto cannot attach files.
   */
  public static async email(content: ReceiptContent, settings: BusinessReceiptSettings, to: string): Promise<"attached" | "text_only"> {
    const subject = `Receipt ${content.receiptNumber}${settings.businessName ? ` from ${settings.businessName}` : ""}`;
    const greeting = `Dear ${getFirstName(content.customerName) || "Customer"},`;
    const sign = settings.businessName ? `\n\nRegards,\n${settings.businessName}` : "";

    if (nativePlatformService.isAndroid()) {
      const path = await this.writeNativePdf(content, settings);
      const body = `${greeting}\n\nYour receipt ${content.receiptNumber} for ${settings.currencyFormat} ${content.grandTotal.toFixed(2)} is attached.${sign}`;
      await ReceiptMail.compose({ to, subject, body, path });
      return "attached";
    }

    await this.downloadPdf(content, settings);
    const body = `${greeting}\n\nHere is your receipt:\n\n${this.receiptPlainText(content, settings)}${sign}`;
    await this.shareTextViaEmail(to, subject, body);
    return "text_only";
  }

  public static async copyText(content: ReceiptContent, settings: BusinessReceiptSettings): Promise<boolean> {
    const text = this.receiptPlainText(content, settings);
    try {
      if (nativePlatformService.isNative()) {
        const { Clipboard } = await import("@capacitor/clipboard");
        await Clipboard.write({ string: text });
        return true;
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
