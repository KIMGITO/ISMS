// src/core/native/PrinterService.ts
import { bluetoothService, BluetoothDeviceDetails } from "./BluetoothService";
import { nativeUiService } from "./NativeUiService";

export interface ReceiptPrintData {
  businessName: string;
  branchName?: string;
  receiptNumber: string;
  date: string;
  items: Array<{ name: string; qty: number; price: number; total: number }>;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  customerName?: string;
  customFooter?: string;
}

class PrinterService {
  private activePrinter: BluetoothDeviceDetails | null = null;

  public async getDevices(): Promise<BluetoothDeviceDetails[]> {
    return bluetoothService.scan();
  }

  public async connectPrinter(device: BluetoothDeviceDetails): Promise<boolean> {
    const success = await bluetoothService.connect(device.address);
    if (success) {
      this.activePrinter = { ...device, connected: true };
      localStorage.setItem("kkm_preferred_printer", JSON.stringify(device));
    }
    return success;
  }

  public async disconnectPrinter(): Promise<void> {
    await bluetoothService.disconnect();
    if (this.activePrinter) {
      this.activePrinter.connected = false;
    }
    this.activePrinter = null;
  }

  public getActivePrinter(): BluetoothDeviceDetails | null {
    return this.activePrinter;
  }

  /**
   * Print a test strip receipt to verify character rendering
   */
  public async printTestPage(): Promise<boolean> {
    const esc = new Uint8Array([
      0x1B, 0x40, // Initialize printer
      0x1B, 0x61, 0x01, // Center alignment
      0x1B, 0x21, 0x30, // Double width/height font
      ...this.stringToBytes("KAYKAY'S DAIRY\n"),
      0x1B, 0x21, 0x00, // Reset formatting
      ...this.stringToBytes("--------------------------------\n"),
      ...this.stringToBytes("HARDWARE TEST OK\n"),
      ...this.stringToBytes(new Date().toLocaleString() + "\n"),
      ...this.stringToBytes("--------------------------------\n\n\n\n")
    ]);

    return bluetoothService.write(esc);
  }

  /**
   * Generate ESC/POS byte commands and print a full sale receipt
   */
  public async printReceipt(data: ReceiptPrintData): Promise<boolean> {
    const escCommands: number[] = [
      0x1B, 0x40, // Initialize printer
      0x1B, 0x61, 0x01, // Center align
      0x1B, 0x21, 0x10, // Medium double width font
      ...this.stringToBytes(`${data.businessName.toUpperCase()}\n`),
      0x1B, 0x21, 0x00, // Normal font
      ...this.stringToBytes(`${data.branchName || "Branch Main"}\n`),
      ...this.stringToBytes("--------------------------------\n"),
      0x1B, 0x61, 0x00, // Left align
      ...this.stringToBytes(`Receipt #: ${data.receiptNumber}\n`),
      ...this.stringToBytes(`Date: ${data.date}\n`),
      ...(data.customerName ? this.stringToBytes(`Client: ${data.customerName}\n`) : []),
      ...this.stringToBytes("--------------------------------\n"),
      ...this.stringToBytes("Item            Qty   Price    Total\n"),
      ...this.stringToBytes("--------------------------------\n")
    ];

    data.items.forEach((item) => {
      const nameCol = item.name.substring(0, 14).padEnd(14, " ");
      const qtyCol = String(item.qty).padStart(3, " ");
      const priceCol = item.price.toFixed(1).padStart(7, " ");
      const totalCol = item.total.toFixed(1).padStart(7, " ");
      escCommands.push(...this.stringToBytes(`${nameCol}${qtyCol}${priceCol}${totalCol}\n`));
    });

    escCommands.push(
      ...this.stringToBytes("--------------------------------\n"),
      0x1B, 0x61, 0x02, // Right align
      ...this.stringToBytes(`Subtotal: ${data.subtotal.toFixed(2)}\n`),
      ...this.stringToBytes(`Tax/Levy: ${data.tax.toFixed(2)}\n`),
      0x1B, 0x21, 0x08, // Bold title
      ...this.stringToBytes(`TOTAL: KES ${data.total.toFixed(2)}\n`),
      0x1B, 0x21, 0x00, // Reset bold
      0x1B, 0x61, 0x00, // Left align
      ...this.stringToBytes(`Payment: ${data.paymentMethod}\n`),
      ...this.stringToBytes("--------------------------------\n"),
      0x1B, 0x61, 0x01, // Center align
      ...this.stringToBytes(data.customFooter || "Thank you for shopping!\n"),
      ...this.stringToBytes("\n\n\n\n") // Spacing to allow tear off
    );

    return bluetoothService.write(new Uint8Array(escCommands));
  }

  private stringToBytes(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i));
    }
    return bytes;
  }
}

export const printerService = new PrinterService();
export default printerService;
