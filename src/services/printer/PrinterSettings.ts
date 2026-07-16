// src/services/printer/PrinterSettings.ts
import { PrinterConfig, PaperWidth } from "./types";

const PRINTER_CONFIG_KEY = "kkm_printer_config_v1";

const DEFAULT_CONFIG: PrinterConfig = {
  defaultPrinterId: null,
  paperWidth: "80mm",
  charactersPerLine: 42,
  isAutoCutEnabled: true,
  printDensity: 3,
  copies: 1,
  printLogo: true,
  printQrCode: true,
  printBarcode: true,
  connectionTimeout: 10000,
  autoReconnect: true,
};

export class PrinterSettingsService {
  public static load(): PrinterConfig {
    try {
      const data = localStorage.getItem(PRINTER_CONFIG_KEY);
      if (data) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      }
    } catch (e) {
      console.error("Failed to load printer config from localStorage:", e);
    }
    return DEFAULT_CONFIG;
  }

  public static save(config: Partial<PrinterConfig>): void {
    try {
      const current = this.load();
      const updated = { ...current, ...config };
      localStorage.setItem(PRINTER_CONFIG_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to save printer config to localStorage:", e);
    }
  }

  public static reset(): PrinterConfig {
    this.save(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}
