/**
 * ReceiptService: the one entry point screens use to build, print and share receipts.
 */
import { Transaction } from "../../types";
import { BusinessReceiptSettings, ReceiptContent } from "./types";
import { ReceiptSettingsService } from "./ReceiptSettings";
import { buildReceiptContent, ReceiptExtras } from "./ReceiptGenerator";
import { buildReceiptLines, columnsFor, dotsFor, ReceiptLine, wrap } from "./layout";
import { EscPosGenerator } from "../printer/EscPosGenerator";
import { printerService } from "../printer/PrinterService";
import { PrinterTarget } from "../printer/types";
import { ReceiptShareService } from "./ReceiptShareService";
import { kraService } from "../kra/kraService";
import { getTillPoints } from "../loyalty/tillPoints";
import { loadPointsEnabled } from "../loyalty/pointValue";
import { loadRefundsForSale } from "../salesDocs";
import { roundMoney } from "../../utils/money";

export class ReceiptService {
  public static getSettings(businessId: string): BusinessReceiptSettings {
    return ReceiptSettingsService.getSettings(businessId);
  }

  public static saveSettings(settings: BusinessReceiptSettings): Promise<void> {
    return ReceiptSettingsService.saveSettings(settings);
  }

  /** Builds the receipt, including KRA's signature when this sale has one. */
  public static async buildForTransaction(
    tx: Transaction,
    businessId: string,
    extras: Omit<ReceiptExtras, "kra"> = {},
  ): Promise<{ content: ReceiptContent; settings: BusinessReceiptSettings }> {
    const settings = this.getSettings(businessId);
    const [kra, pointsUsed, pointsOn, refunds] = await Promise.all([
      kraService.getSignature(tx.id).catch(() => null),
      tx.customerId ? getTillPoints(tx.id) : Promise.resolve(null),
      tx.customerId ? loadPointsEnabled(businessId).catch(() => true) : Promise.resolve(true),
      // A sale not saved online yet has no refunds; a failed lookup just leaves the stamp off.
      loadRefundsForSale(tx.id).catch((): { number: string; total: number }[] => []),
    ]);
    const content = buildReceiptContent(tx, settings, { ...extras, pointsUsed, pointsOff: !pointsOn, kra: kra ?? undefined });
    const refunded = roundMoney(refunds.reduce((sum, r) => sum + r.total, 0));
    if (refunded > 0) {
      content.refund = { total: refunded, numbers: refunds.map((r) => r.number), full: refunded >= roundMoney(content.grandTotal) };
    }
    return { content, settings };
  }

  public static lines(content: ReceiptContent, settings: BusinessReceiptSettings): ReceiptLine[] {
    return buildReceiptLines(content, settings);
  }

  public static escPos(lines: ReceiptLine[], settings: BusinessReceiptSettings, options: { openDrawer?: boolean } = {}): Uint8Array {
    return EscPosGenerator.fromLines(lines, {
      columns: columnsFor(settings),
      dots: dotsFor(settings.paperWidth),
      autoCut: printerService.getPrefs().autoCut,
      openDrawer: options.openDrawer,
    });
  }

  public static async print(content: ReceiptContent, settings: BusinessReceiptSettings, printer: PrinterTarget): Promise<void> {
    const openDrawer = settings.openCashDrawer && content.paymentMethodCode === "Cash";
    const bytes = this.escPos(this.lines(content, settings), settings, { openDrawer });
    await printerService.print(printer, bytes, printerService.getPrefs().copies);
  }

  /** A short page to check the printer and paper width; prints the real shop header and settings. */
  public static async printTest(settings: BusinessReceiptSettings, printer: PrinterTarget): Promise<void> {
    const cols = columnsFor(settings);
    const lines: ReceiptLine[] = [];
    const center = (text: string, bold = false) => wrap(text, cols).forEach((l) => lines.push({ t: "text", text: l, align: "center", bold }));
    if (settings.businessName) center(settings.businessName.toUpperCase(), true);
    center("PRINTER TEST", true);
    lines.push({ t: "rule", ch: "=" });
    lines.push({ t: "text", text: `Printer: ${printer.name}`, align: "left" });
    lines.push({ t: "text", text: `Paper: ${settings.paperWidth}, ${cols} characters per line`, align: "left" });
    lines.push({ t: "text", text: `Printed: ${new Date().toLocaleString("en-KE")}`, align: "left" });
    lines.push({ t: "text", text: "The line below should fill the paper exactly:", align: "left" });
    lines.push({ t: "text", text: "1234567890".repeat(Math.ceil(cols / 10)).slice(0, cols), align: "left" });
    lines.push({ t: "rule", ch: "-" });
    await printerService.print(printer, this.escPos(lines, settings), 1);
  }

  public static share = ReceiptShareService;
}

export { ReceiptShareService };
