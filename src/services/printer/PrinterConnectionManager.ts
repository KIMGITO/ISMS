// src/services/printer/PrinterConnectionManager.ts
import { bluetoothPrinterService, BluetoothPrinterService } from "./BluetoothPrinterService";
import { PrinterSettingsService } from "./PrinterSettings";
import { PrinterRepository } from "./PrinterRepository";

export class PrinterConnectionManager {
  private static instance: PrinterConnectionManager;
  private reconnectInterval: any = null;
  private isReconnecting = false;

  public static getInstance(): PrinterConnectionManager {
    if (!PrinterConnectionManager.instance) {
      PrinterConnectionManager.instance = new PrinterConnectionManager();
    }
    return PrinterConnectionManager.instance;
  }

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    // Listen for connection state changes
    bluetoothPrinterService.onStateChange((state) => {
      if (state === "Disconnected" || state === "Failed") {
        this.triggerAutoReconnect();
      } else if (state === "Connected") {
        this.clearReconnectInterval();
      }
    });

    // Listen for Web online events (to check offline recovery)
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.triggerAutoReconnect();
      });
    }
  }

  /**
   * Triggers automatic reconnection attempts
   */
  public triggerAutoReconnect() {
    const config = PrinterSettingsService.load();
    if (!config.autoReconnect || this.isReconnecting) return;

    const preferred = PrinterRepository.getPreferredPrinter();
    if (!preferred) return;

    this.isReconnecting = true;
    console.log("Printer Connection Manager: Scheduling auto-reconnect to preferred printer...");

    this.clearReconnectInterval();
    
    // Attempt reconnection immediately, then periodically
    this.attemptReconnect(preferred);

    this.reconnectInterval = setInterval(() => {
      const state = bluetoothPrinterService.getConnectionState();
      if (state === "Connected") {
        this.clearReconnectInterval();
        return;
      }
      this.attemptReconnect(preferred);
    }, 15000); // Try every 15 seconds
  }

  private async attemptReconnect(device: any) {
    const state = bluetoothPrinterService.getConnectionState();
    if (state === "Connected" || state === "Connecting" || state === "Printing") {
      return;
    }
    console.log(`Printer Connection Manager: Reconnect attempt to ${device.name}...`);
    await bluetoothPrinterService.connect(device);
  }

  private clearReconnectInterval() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    this.isReconnecting = false;
  }

  public forceReconnectManual(): Promise<boolean> {
    this.clearReconnectInterval();
    const preferred = PrinterRepository.getPreferredPrinter();
    if (!preferred) {
      return Promise.resolve(false);
    }
    return bluetoothPrinterService.connect(preferred);
  }
}

export const printerConnectionManager = PrinterConnectionManager.getInstance();
