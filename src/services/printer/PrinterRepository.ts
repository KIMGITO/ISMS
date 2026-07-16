// src/services/printer/PrinterRepository.ts
import { BluetoothPrinterDevice } from "./types";

const PREFERRED_PRINTER_KEY = "kkm_preferred_printer_v1";

export class PrinterRepository {
  public static getPreferredPrinter(): BluetoothPrinterDevice | null {
    try {
      const data = localStorage.getItem(PREFERRED_PRINTER_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error("Failed to load preferred printer:", e);
    }
    return null;
  }

  public static savePreferredPrinter(device: BluetoothPrinterDevice): void {
    try {
      const savedDevice = { ...device, isSaved: true };
      localStorage.setItem(PREFERRED_PRINTER_KEY, JSON.stringify(savedDevice));
    } catch (e) {
      console.error("Failed to save preferred printer:", e);
    }
  }

  public static deletePreferredPrinter(): void {
    try {
      localStorage.removeItem(PREFERRED_PRINTER_KEY);
    } catch (e) {
      console.error("Failed to delete preferred printer:", e);
    }
  }
}
