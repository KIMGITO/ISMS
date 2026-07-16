import { ReceiptContent, BusinessReceiptSettings, SharePayload } from "./types";
import { ReceiptRendererService } from "./ReceiptRenderer";
import { ReceiptExporterService } from "./ReceiptExporter";
import { nativePlatformService } from "../../core/native/NativePlatformService";

export class ReceiptShareService {
  /**
   * Helper to open any external link safely without crashing Tauri or mobile webviews
   */
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

  /**
   * Safe sharing to WhatsApp with local app check on Capacitor and fallback
   */
  public static async shareTextViaWhatsApp(phoneNumber: string, text: string): Promise<boolean> {
    const cleanPhone = phoneNumber.replace(/[\s+()]/g, "");
    const appUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
    const webUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;

    if (nativePlatformService.isNative()) {
      return new Promise<boolean>(async (resolve) => {
        let isPaused = false;
        
        // Listen to native app state change (paused means WhatsApp app successfully opened)
        const cleanupPause = nativePlatformService.onAppPause(() => {
          isPaused = true;
        });

        try {
          window.open(appUrl, "_self");
        } catch (e) {
          console.warn("Direct whatsapp scheme navigation failed:", e);
        }

        setTimeout(async () => {
          cleanupPause();

          if (!isPaused) {
            // App remained in foreground, likely WhatsApp isn't installed.
            let confirmOpen = false;
            try {
              const { Dialog } = await import("@capacitor/dialog");
              const res = await Dialog.confirm({
                title: "Open WhatsApp",
                message: "Could not open WhatsApp app directly. Would you like to open it in the web browser instead?",
                okButtonTitle: "Yes",
                cancelButtonTitle: "Cancel"
              });
              confirmOpen = res.value;
            } catch {
              confirmOpen = window.confirm("Could not open WhatsApp app directly. Would you like to open it in the web browser instead?");
            }

            if (confirmOpen) {
              await this.openExternalUrl(webUrl);
              resolve(true);
            } else {
              resolve(false);
            }
          } else {
            resolve(true);
          }
        }, 1500);
      });
    }

    // On non-native (Tauri/Web), open the WhatsApp web page in browser safely
    return this.openExternalUrl(webUrl);
  }

  /**
   * Safe sharing to Email
   */
  public static async shareTextViaEmail(recipientEmail: string, subject: string, body: string): Promise<boolean> {
    const url = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return this.openExternalUrl(url);
  }

  /**
   * Evaluates if the platform supports native system-level sharing APIs.
   * Works on iOS/Android (via Capacitor) and modern mobile browsers.
   */
  public static canShareNatively(): boolean {
    return typeof navigator !== "undefined" && !!navigator.share;
  }

  /**
   * Invokes native system share sheet. Falls back to clipboard copy if unsupported.
   */
  public static async shareNatively(content: ReceiptContent, settings: BusinessReceiptSettings): Promise<{ success: boolean; method: "native" | "clipboard" }> {
    const rawText = ReceiptRendererService.generateThermalRawText(content, settings);
    const title = `${settings.businessName} - Receipt ${content.receiptNumber}`;
    const text = `Milk checkout receipt for KSh ${content.grandTotal.toFixed(0)} from ${settings.businessName}. Thank you!`;
    const url = content.verificationUrl;

    if (this.canShareNatively()) {
      try {
        await navigator.share({
          title,
          text: text + "\nVerify here: " + url,
          url
        });
        return { success: true, method: "native" };
      } catch (err: any) {
        // User cancelled, or native error
        console.warn("Native share cancelled or failed:", err);
      }
    }

    // Fallback: copy plain text receipt to clipboard
    const copied = this.copyToClipboard(rawText);
    return { success: copied, method: "clipboard" };
  }

  /**
   * Copies raw string to OS clipboard.
   */
  public static copyToClipboard(text: string): boolean {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch (err) {
      console.error("Failed to copy receipt text to clipboard:", err);
      return false;
    }
  }

  /**
   * Opens default email client pre-populated with stylized plain-text receipt.
   */
  public static async shareViaEmail(content: ReceiptContent, settings: BusinessReceiptSettings, recipientEmail?: string): Promise<boolean> {
    try {
      // Trigger background real PDF download so they have the file ready to attach
      ReceiptExporterService.exportToPdf(content, settings);

      const target = recipientEmail || content.customerEmail || "";
      const subject = `Receipt ${content.receiptNumber} from ${settings.businessName}`;
      const rawText = ReceiptRendererService.generateThermalRawText(content, settings);
      const body = `Dear Valued Customer,\n\nPlease find your dairy transaction receipt details below:\n\n${rawText}\n\nVerify authenticity securely online at:\n${content.verificationUrl}\n\nWarm regards,\n${settings.businessName}`;
      
      return this.shareTextViaEmail(target, subject, body);
    } catch (err) {
      console.error("Email share trigger failed:", err);
      return false;
    }
  }

  /**
   * Formats a direct WhatsApp Business API message Link and redirects the user's focus.
   */
  public static async shareViaWhatsApp(content: ReceiptContent, settings: BusinessReceiptSettings, phoneNumber: string): Promise<boolean> {
    try {
      const cleanPhone = phoneNumber.replace(/[\s+()]/g, "");
      
      const newline = "\n";
      const bold = "*";
      
      let msg = `🥛 ${bold}${settings.businessName.toUpperCase()}${bold} 🥛${newline}`;
      msg += `--------------------${newline}`;
      msg += `${bold}TX REF:${bold} ${content.receiptNumber}${newline}`;
      msg += `${bold}DATE:${bold} ${content.transactionDate} ${content.transactionTime}${newline}`;
      msg += `${bold}OPERATOR:${bold} ${content.cashierName}${newline}`;
      msg += `${bold}PAYMENT:${bold} ${content.paymentMethod.toUpperCase()}${newline}`;
      
      if (content.customerName) {
        msg += `${bold}CUSTOMER:${bold} ${content.customerName}${newline}`;
      }
      
      msg += `--------------------${newline}`;
      msg += `${bold}ITEMS:${bold}${newline}`;
      
      content.items.forEach(it => {
        msg += `- ${it.name} x${it.quantity} (${settings.currencyFormat} ${it.total.toFixed(0)})${newline}`;
      });
      
      msg += `--------------------${newline}`;
      msg += `${bold}GRAND TOTAL: ${settings.currencyFormat} ${content.grandTotal.toFixed(2)}${bold}${newline}`;
      msg += `--------------------${newline}`;
      msg += `Verify authenticity: ${content.verificationUrl}${newline}${newline}`;
      msg += `Asante! ${settings.thankYouMessage || "Thank you for supporting local farms!"}`;

      return this.shareTextViaWhatsApp(cleanPhone, msg);
    } catch (err) {
      console.error("WhatsApp redirection failed:", err);
      return false;
    }
  }

  /**
   * Prepares and triggers a native SMS draft for future/offline customer delivery.
   */
  public static async shareViaSms(content: ReceiptContent, settings: BusinessReceiptSettings, phoneNumber: string): Promise<boolean> {
    try {
      const cleanPhone = phoneNumber.replace(/[\s+()]/g, "");
      const smsText = `Receipt ${content.receiptNumber} from ${settings.businessName}. Total: ${settings.currencyFormat} ${content.grandTotal.toFixed(0)}. Secure verification: ${content.verificationUrl}`;
      const url = `sms:${cleanPhone}?body=${encodeURIComponent(smsText)}`;
      return this.openExternalUrl(url);
    } catch (err) {
      console.error("SMS draft launch failed:", err);
      return false;
    }
  }
}
