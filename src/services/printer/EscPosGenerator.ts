// src/services/printer/EscPosGenerator.ts
import { ReceiptContent } from "../receipt/types";
import { PrinterConfig } from "./types";

export class EscPosGenerator {
  // ESC/POS Command constants
  private static readonly ESC = 0x1B;
  private static readonly GS = 0x1D;

  private static readonly INIT = new Uint8Array([EscPosGenerator.ESC, 0x40]);
  
  private static readonly ALIGN_LEFT = new Uint8Array([EscPosGenerator.ESC, 0x61, 0x00]);
  private static readonly ALIGN_CENTER = new Uint8Array([EscPosGenerator.ESC, 0x61, 0x01]);
  private static readonly ALIGN_RIGHT = new Uint8Array([EscPosGenerator.ESC, 0x61, 0x02]);

  private static readonly BOLD_ON = new Uint8Array([EscPosGenerator.ESC, 0x45, 0x01]);
  private static readonly BOLD_OFF = new Uint8Array([EscPosGenerator.ESC, 0x45, 0x00]);

  private static readonly SIZE_NORMAL = new Uint8Array([EscPosGenerator.GS, 0x21, 0x00]);
  private static readonly SIZE_DOUBLE = new Uint8Array([EscPosGenerator.GS, 0x21, 0x11]); // Double height + double width

  private static readonly CUT_PAPER = new Uint8Array([EscPosGenerator.GS, 0x56, 0x41, 0x00]); // Full cut with feed

  /**
   * Generates a complete binary ESC/POS payload for a receipt.
   */
  public static generateReceiptBytes(content: ReceiptContent, config: PrinterConfig): Uint8Array {
    const builder: Uint8Array[] = [];
    const cpl = config.charactersPerLine;

    // 1. Initialize
    builder.push(this.INIT);
    
    // Set density if supported
    // ESC/POS density command (varies by printer but ESC m density is common)
    // For general compatibility, we rely on standard init.

    // 2. Business Logo Header (Simulated text icon first)
    if (config.printLogo) {
      builder.push(this.ALIGN_CENTER);
      builder.push(this.SIZE_DOUBLE);
      builder.push(this.BOLD_ON);
      builder.push(this.textToBytes("🥛\n"));
      builder.push(this.SIZE_NORMAL);
      builder.push(this.textToBytes("KAYKAY'S DAIRY\n"));
      builder.push(this.BOLD_OFF);
      builder.push(this.textToBytes("--------------------\n"));
    }

    // 3. Receipt Details
    builder.push(this.ALIGN_CENTER);
    builder.push(this.BOLD_ON);
    builder.push(this.textToBytes("MILK RETAIL VOUCHER\n"));
    builder.push(this.BOLD_OFF);
    builder.push(this.ALIGN_LEFT);

    builder.push(this.textToBytes(`RECEIPT NO: ${content.receiptNumber}\n`));
    builder.push(this.textToBytes(`DATE/TIME: ${content.transactionDate} ${content.transactionTime}\n`));
    builder.push(this.textToBytes(`CASHIER  : ${content.cashierName}\n`));
    builder.push(this.textToBytes(`PAYMENT  : ${content.paymentMethod.toUpperCase()}\n`));

    if (content.customerName) {
      builder.push(this.textToBytes(`PATRON   : ${content.customerName}\n`));
    }
    
    builder.push(this.textToBytes("-".repeat(cpl) + "\n"));

    // 4. Table Header
    builder.push(this.BOLD_ON);
    builder.push(this.textToBytes(this.padLine("ITEM (QTY)", "TOTAL", cpl) + "\n"));
    builder.push(this.BOLD_OFF);
    builder.push(this.textToBytes("-".repeat(cpl) + "\n"));

    // 5. Items Rows
    content.items.forEach((item) => {
      // Wrap long names if necessary
      const name = item.name.length > cpl - 12 ? item.name.substring(0, cpl - 12) + ".." : item.name;
      const leftPart = `${name} x${item.quantity}`;
      const rightPart = `KSh ${item.total.toFixed(0)}`;
      builder.push(this.textToBytes(this.padLine(leftPart, rightPart, cpl) + "\n"));
      if (item.discountPercentage && item.discountPercentage > 0) {
        builder.push(this.textToBytes(`  * Swahili Waiver Applied: -${item.discountPercentage}%\n`));
      }
    });

    builder.push(this.textToBytes("-".repeat(cpl) + "\n"));

    // 6. Summary Calculations
    builder.push(this.textToBytes(this.padLine("SUBTOTAL", `KSh ${content.subtotal.toFixed(2)}`, cpl) + "\n"));

    if (content.overallDiscount && content.overallDiscount > 0) {
      builder.push(this.textToBytes(this.padLine("DISCOUNT", `-KSh ${content.overallDiscount.toFixed(2)}`, cpl) + "\n"));
    }

    if (content.taxTotal !== undefined && content.taxTotal > 0) {
      builder.push(this.textToBytes(this.padLine("KENYAN VAT (16%)", `KSh ${content.taxTotal.toFixed(2)}`, cpl) + "\n"));
    }

    if (content.deliveryFee !== undefined && content.deliveryFee > 0) {
      builder.push(this.textToBytes(this.padLine("DELIVERY FEE", `+KSh ${content.deliveryFee.toFixed(2)}`, cpl) + "\n"));
    }

    builder.push(this.textToBytes("-".repeat(cpl) + "\n"));
    
    // Grand Total (Bold & Big)
    builder.push(this.BOLD_ON);
    builder.push(this.textToBytes(this.padLine("GRAND TOTAL", `KSh ${content.grandTotal.toFixed(2)}`, cpl) + "\n"));
    builder.push(this.BOLD_OFF);

    builder.push(this.textToBytes(this.padLine("PAID", `KSh ${content.amountPaid.toFixed(2)}`, cpl) + "\n"));
    builder.push(this.textToBytes(this.padLine("CHANGE", `KSh ${content.changeGiven.toFixed(2)}`, cpl) + "\n"));

    if (content.outstandingBalance !== undefined && content.outstandingBalance > 0) {
      builder.push(this.textToBytes(this.padLine("OUTSTANDING BAL", `KSh ${content.outstandingBalance.toFixed(2)}`, cpl) + "\n"));
    }

    builder.push(this.textToBytes("-".repeat(cpl) + "\n"));

    // 7. QR / Barcodes
    if (config.printQrCode && content.verificationUrl) {
      builder.push(this.ALIGN_CENTER);
      builder.push(this.textToBytes("VERIFY TRANSACTION SECURELY\n"));
      // ESC/POS QR code generator binary commands block
      builder.push(this.generateQrCodeCmds(content.verificationUrl));
      builder.push(this.textToBytes("\n"));
    }

    if (config.printBarcode) {
      builder.push(this.ALIGN_CENTER);
      // Print barcode of the receipt number (Code 39)
      builder.push(this.generateBarcodeCmds(content.receiptNumber));
      builder.push(this.textToBytes("\n"));
    }

    // 8. Thank you Footer
    builder.push(this.ALIGN_CENTER);
    builder.push(this.BOLD_ON);
    builder.push(this.textToBytes("Asante Sana!\n"));
    builder.push(this.BOLD_OFF);
    builder.push(this.textToBytes("Thank you for supporting local dairy farmers.\n"));
    builder.push(this.textToBytes("Fresh milk daily direct to your door!\n"));
    builder.push(this.textToBytes("\n\n\n")); // Feed lines

    // 9. Cut Paper
    if (config.isAutoCutEnabled) {
      builder.push(this.CUT_PAPER);
    }

    return this.concatArrays(builder);
  }

  /**
   * Generates a test print payload.
   */
  public static generateTestPrintBytes(printerName: string, config: PrinterConfig): Uint8Array {
    const builder: Uint8Array[] = [];
    const cpl = config.charactersPerLine;

    builder.push(this.INIT);
    builder.push(this.ALIGN_CENTER);
    builder.push(this.SIZE_DOUBLE);
    builder.push(this.BOLD_ON);
    builder.push(this.textToBytes("TEST PRINT SUCCESS\n"));
    builder.push(this.SIZE_NORMAL);
    builder.push(this.textToBytes("--------------------\n"));
    builder.push(this.BOLD_OFF);

    builder.push(this.ALIGN_LEFT);
    builder.push(this.textToBytes(`PRINTER  : ${printerName}\n`));
    builder.push(this.textToBytes(`CPL      : ${cpl} Characters\n`));
    builder.push(this.textToBytes(`WIDTH    : ${config.paperWidth}\n`));
    builder.push(this.textToBytes(`DENSITY  : ${config.printDensity}/5\n`));
    builder.push(this.textToBytes(`AUTOCUT  : ${config.isAutoCutEnabled ? "ENABLED" : "DISABLED"}\n`));
    builder.push(this.textToBytes(`DATE/TIME: ${new Date().toLocaleString()}\n`));
    
    builder.push(this.textToBytes("-".repeat(cpl) + "\n"));
    builder.push(this.textToBytes("Sample Item x2         KSh 450.00\n"));
    builder.push(this.textToBytes("Sample Item x1         KSh 120.00\n"));
    builder.push(this.textToBytes("-".repeat(cpl) + "\n"));
    
    builder.push(this.ALIGN_CENTER);
    builder.push(this.generateQrCodeCmds("https://kaykaysmilk.co.ke/test"));
    builder.push(this.textToBytes("\n"));
    builder.push(this.generateBarcodeCmds("TEST-12345"));
    builder.push(this.textToBytes("\n\n\n"));

    if (config.isAutoCutEnabled) {
      builder.push(this.CUT_PAPER);
    }

    return this.concatArrays(builder);
  }

  // ==========================================
  // ESC/POS COMMAND GENERATION HELPERS
  // ==========================================

  private static textToBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  private static padLine(left: string, right: string, width: number): string {
    const spaces = Math.max(1, width - (left.length + right.length));
    return left + " ".repeat(spaces) + right;
  }

  private static concatArrays(arrays: Uint8Array[]): Uint8Array {
    let totalLength = 0;
    arrays.forEach((a) => (totalLength += a.length));
    const result = new Uint8Array(totalLength);
    let offset = 0;
    arrays.forEach((a) => {
      result.set(a, offset);
      offset += a.length;
    });
    return result;
  }

  /**
   * Standard ESC/POS QR Code binary commands block
   */
  private static generateQrCodeCmds(data: string): Uint8Array {
    const builder: Uint8Array[] = [];
    const encoder = new TextEncoder();
    const qrBytes = encoder.encode(data);
    const len = qrBytes.length + 3;
    const lenLo = len % 256;
    const lenHi = Math.floor(len / 256);

    // 1. Store QR data in symbol storage area (GS ( k)
    // Command: GS ( k pL pH cn fn m d1...dk
    // cn = 0x31 (QR Code), fn = 0x50 (store data), m = 0x30
    const storeHeader = new Uint8Array([
      EscPosGenerator.GS, 0x28, 0x6B, lenLo, lenHi, 0x31, 0x50, 0x30
    ]);
    builder.push(storeHeader);
    builder.push(qrBytes);

    // 2. Set QR code size
    // cn = 0x31 (QR Code), fn = 0x43 (set size), size = 0x06 (6 dots per module)
    builder.push(new Uint8Array([EscPosGenerator.GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06]));

    // 3. Set QR error correction level (Function 169)
    // cn = 0x31, fn = 0x45, level = 0x30 (L level 7%)
    builder.push(new Uint8Array([EscPosGenerator.GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30]));

    // 4. Print the QR symbol storage area (Function 181)
    // cn = 0x31, fn = 0x51, m = 0x30
    builder.push(new Uint8Array([EscPosGenerator.GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]));

    return this.concatArrays(builder);
  }

  /**
   * Standard ESC/POS Barcode commands block (CODE 39)
   */
  private static generateBarcodeCmds(data: string): Uint8Array {
    const builder: Uint8Array[] = [];
    const encoder = new TextEncoder();
    const barcodeBytes = encoder.encode(data);

    // 1. Set barcode height
    // Command: GS h height (height: 50 dots)
    builder.push(new Uint8Array([EscPosGenerator.GS, 0x68, 50]));

    // 2. Set barcode width
    // Command: GS w width (width: 2 dots)
    builder.push(new Uint8Array([EscPosGenerator.GS, 0x77, 2]));

    // 3. Print barcode (GS k m n d1...dn)
    // m = 69 (CODE39 format), n = length of bytes
    const printHeader = new Uint8Array([
      EscPosGenerator.GS, 0x6B, 69, barcodeBytes.length
    ]);
    builder.push(printHeader);
    builder.push(barcodeBytes);

    return this.concatArrays(builder);
  }
}
