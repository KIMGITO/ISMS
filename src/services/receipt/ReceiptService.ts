/**
 * ReceiptService (Clean Architecture Central Facade)
 * 
 * Orchestrates receipt logic, loading configuration settings, generating content,
 * rendering, printing, sharing, and exporting digital tickets.
 */

import { Transaction } from "../../types";
import { ReceiptContent, BusinessReceiptSettings, ReceiptTemplateType } from "./types";
import { ReceiptSettingsService } from "./ReceiptSettings";
import { ReceiptGenerator } from "./ReceiptGenerator";
import { ReceiptTemplateManager } from "./ReceiptTemplateManager";
import { ReceiptPrinterService } from "./ReceiptPrinter";
import { ReceiptExporterService } from "./ReceiptExporter";
import { ReceiptShareService } from "./ReceiptShareService";

export class ReceiptService {
  /**
   * Retrieves customization parameters for a given business location.
   */
  public static getSettings(businessId: string): BusinessReceiptSettings {
    return ReceiptSettingsService.getSettings(businessId);
  }

  /**
   * Saves customization settings for a business location.
   */
  public static saveSettings(businessId: string, settings: BusinessReceiptSettings): void {
    ReceiptSettingsService.saveSettings(businessId, settings);
  }

  /**
   * Resets customization settings to defaults.
   */
  public static resetSettings(businessId: string): BusinessReceiptSettings {
    return ReceiptSettingsService.resetToDefault(businessId);
  }

  /**
   * Main entrypoint to assemble transaction data into a processed ReceiptContent structure.
   */
  public static async generateReceipt(
    tx: Transaction,
    businessId = "default",
    additionalParams?: {
      invoiceNumber?: string;
      customerEmail?: string;
      outstandingBalance?: number;
      customNotes?: string;
    }
  ): Promise<{ content: ReceiptContent; settings: BusinessReceiptSettings }> {
    const settings = this.getSettings(businessId);
    const content = await ReceiptGenerator.generateReceiptContent(tx, settings, additionalParams);
    return { content, settings };
  }

  /**
   * Triggers Native/Iframe Browser Printing.
   * Renders the receipt HTML snippet and launches the printer flow.
   */
  public static print(htmlContent: string): Promise<boolean> {
    return ReceiptPrinterService.printReceipt(htmlContent);
  }

  /**
   * Exports the receipt to text or HTML.
   */
  public static exportToText(content: ReceiptContent, settings: BusinessReceiptSettings): boolean {
    return ReceiptExporterService.exportToTextFile(content, settings);
  }

  public static exportToHtml(content: ReceiptContent, settings: BusinessReceiptSettings, htmlSnippet: string): boolean {
    return ReceiptExporterService.exportToHtmlFile(content, settings, htmlSnippet);
  }

  public static exportToPdf(content: ReceiptContent, settings: BusinessReceiptSettings, htmlSnippet: string): boolean {
    return ReceiptExporterService.exportToPdf(content, settings, htmlSnippet);
  }

  /**
   * Shares the receipt.
   */
  public static async shareNatively(content: ReceiptContent, settings: BusinessReceiptSettings) {
    return ReceiptShareService.shareNatively(content, settings);
  }

  public static async shareViaEmail(content: ReceiptContent, settings: BusinessReceiptSettings, recipientEmail?: string): Promise<boolean> {
    return ReceiptShareService.shareViaEmail(content, settings, recipientEmail);
  }

  public static async shareViaWhatsApp(content: ReceiptContent, settings: BusinessReceiptSettings, phoneNumber: string): Promise<boolean> {
    return ReceiptShareService.shareViaWhatsApp(content, settings, phoneNumber);
  }

  public static async shareViaSms(content: ReceiptContent, settings: BusinessReceiptSettings, phoneNumber: string): Promise<boolean> {
    return ReceiptShareService.shareViaSms(content, settings, phoneNumber);
  }

  public static copyToClipboard(text: string): boolean {
    return ReceiptShareService.copyToClipboard(text);
  }
}
export { ReceiptTemplateManager };
export { ReceiptRenderer } from "./ReceiptRenderer";
export { ReceiptRendererService } from "./ReceiptRenderer";
export { ReceiptPrinterService } from "./ReceiptPrinter";
export { ReceiptExporterService } from "./ReceiptExporter";
export { ReceiptShareService } from "./ReceiptShareService";
export { BarcodeService } from "./BarcodeService";
export { QRCodeService } from "./QRCodeService";
