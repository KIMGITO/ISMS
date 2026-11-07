// src/services/printer/types.ts

export type PrinterKind = "bluetooth" | "network";

export interface PrinterTarget {
  /** "bt:<mac>" or "net:<host>:<port>" */
  id: string;
  kind: PrinterKind;
  name: string;
  /** MAC address for Bluetooth, IP address for network printers. */
  address: string;
  port?: number;
}

/** A printer as seen in the latest search. */
export interface DiscoveredPrinter extends PrinterTarget {
  /** Bluetooth: paired with this phone. */
  paired?: boolean;
  /** Seen during this search (Bluetooth in range, or network port answered). */
  available: boolean;
  /** Bluetooth device class says it is a printer. */
  isPrinter?: boolean;
  saved: boolean;
}

/** Printing preferences kept on this device (each till has its own printer). */
export interface DevicePrinterPrefs {
  printers: PrinterTarget[];
  defaultId: string | null;
  copies: number;
  autoCut: boolean;
}

export interface PrintingSupport {
  bluetooth: boolean;
  network: boolean;
  /** Why printing is unavailable here, when it is. */
  reason?: string;
}
