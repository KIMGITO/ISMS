// src/services/printer/PrinterService.ts
import { bluetoothPrinterService } from "./BluetoothPrinterService";
import { PrinterSettingsService } from "./PrinterSettings";
import { PrinterRepository } from "./PrinterRepository";
import { printerConnectionManager } from "./PrinterConnectionManager";
import { printQueue } from "./PrintQueue";
import { EscPosGenerator } from "./EscPosGenerator";
import { PrinterConfig, BluetoothPrinterDevice, PrinterConnectionState } from "./types";

export class PrinterService {
  private static instance: PrinterService;

  public static getInstance(): PrinterService {
    if (!PrinterService.instance) {
      PrinterService.instance = new PrinterService();
    }
    return PrinterService.instance;
  }

  // settings wrappers
  public getConfig(): PrinterConfig {
    return PrinterSettingsService.load();
  }

  public saveConfig(config: Partial<PrinterConfig>) {
    PrinterSettingsService.save(config);
  }

  // bluetooth wrappers
  public onStateChange(listener: (state: PrinterConnectionState) => void): () => void {
    return bluetoothPrinterService.onStateChange(listener);
  }

  public onDevicesDiscovered(listener: (devices: BluetoothPrinterDevice[]) => void): () => void {
    return bluetoothPrinterService.onDevicesDiscovered(listener);
  }

  public scan() {
    return bluetoothPrinterService.scan();
  }

  public connect(device: BluetoothPrinterDevice) {
    return bluetoothPrinterService.connect(device);
  }

  public disconnect() {
    return bluetoothPrinterService.disconnect();
  }

  public forget() {
    return bluetoothPrinterService.forgetPrinter();
  }

  public getConnectedPrinter(): BluetoothPrinterDevice | null {
    return bluetoothPrinterService.getActiveDevice();
  }

  public getConnectionState(): PrinterConnectionState {
    return bluetoothPrinterService.getConnectionState();
  }

  /**
   * Run a test print on the connected printer
   */
  public async testPrint(): Promise<boolean> {
    const active = bluetoothPrinterService.getActiveDevice();
    if (!active || bluetoothPrinterService.getConnectionState() !== "Connected") {
      return false;
    }

    const config = this.getConfig();
    const bytes = EscPosGenerator.generateTestPrintBytes(active.name, config);
    
    // Print copies
    for (let i = 0; i < config.copies; i++) {
      printQueue.enqueue(`test-print-${Date.now()}-${i}`, bytes, 1);
    }
    return true;
  }

  public getQueueLength(): number {
    return printQueue.getQueueLength();
  }
}

export const printerService = PrinterService.getInstance();
