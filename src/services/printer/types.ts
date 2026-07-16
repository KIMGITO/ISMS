// src/services/printer/types.ts

export type PrinterConnectionState =
  | "Disconnected"
  | "Scanning"
  | "Connecting"
  | "Connected"
  | "Printing"
  | "Failed";

export type PaperWidth = "58mm" | "80mm";

export interface BluetoothPrinterDevice {
  name: string;
  address: string; // MAC address or UUID depending on platform
  status: PrinterConnectionState;
  signalStrength?: number; // RSSI
  batteryLevel?: number;
  isSaved?: boolean;
}

export interface PrinterConfig {
  defaultPrinterId: string | null;
  paperWidth: PaperWidth;
  charactersPerLine: number;
  isAutoCutEnabled: boolean;
  printDensity: number; // 1-5 scale
  copies: number;
  printLogo: boolean;
  printQrCode: boolean;
  printBarcode: boolean;
  connectionTimeout: number; // in milliseconds
  autoReconnect: boolean;
}
