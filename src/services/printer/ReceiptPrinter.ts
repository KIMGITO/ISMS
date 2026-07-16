// src/services/printer/ReceiptPrinter.ts
import { ReceiptContent } from "../receipt/types";
import { printerService } from "./PrinterService";
import { EscPosGenerator } from "./EscPosGenerator";
import { printQueue } from "./PrintQueue";

export class ReceiptPrinter {
  /**
   * Translates a transaction ReceiptContent into ESC/POS binary format and submits to the print queue
   */
  public static printReceipt(content: ReceiptContent): boolean {
    const activePrinter = printerService.getConnectedPrinter();
    const isConnected = printerService.getConnectionState() === "Connected";

    if (!activePrinter || !isConnected) {
      console.warn("ReceiptPrinter: No thermal printer connected. Skipping hardware print queue.");
      return false;
    }

    const config = printerService.getConfig();
    
    // Generate commands
    const dataBytes = EscPosGenerator.generateReceiptBytes(content, config);

    // Enqueue for each requested copy
    for (let i = 0; i < config.copies; i++) {
      const jobId = `${content.receiptId}-copy-${i}`;
      printQueue.enqueue(jobId, dataBytes, 2); // Max 2 retries
    }

    console.log(`ReceiptPrinter: Submitted ${config.copies} print jobs to the print queue for transaction ${content.receiptNumber}.`);
    return true;
  }
}
export default ReceiptPrinter;
