// src/core/native/BluetoothService.ts
// Bindings for the app's own native printer plugins (Android only).
import { registerPlugin } from "@capacitor/core";

export interface NativeBluetoothDevice {
  name?: string;
  address: string;
  paired: boolean;
  inRange: boolean;
  isPrinter: boolean;
  connected: boolean;
}

interface BluetoothSerialPlugin {
  ensureAccess(): Promise<{ granted: boolean }>;
  isEnabled(): Promise<{ value: boolean }>;
  list(): Promise<{ list: NativeBluetoothDevice[] }>;
  discover(options: { timeoutMs: number }): Promise<{ list: NativeBluetoothDevice[] }>;
  connect(options: { address: string }): Promise<void>;
  write(options: { value: string }): Promise<void>;
  disconnect(): Promise<void>;
}

interface NetworkPrinterPlugin {
  scan(options: { port: number; timeoutMs: number }): Promise<{ list: Array<{ host: string; port: number; name?: string }>; subnet: string }>;
  probe(options: { host: string; port: number; timeoutMs?: number }): Promise<{ reachable: boolean }>;
  send(options: { host: string; port: number; value: string }): Promise<void>;
}

interface ReceiptMailPlugin {
  compose(options: { to?: string; subject: string; body: string; path?: string }): Promise<void>;
}

/** android/app/src/main/java/com/kaykays/app/BluetoothSerialPlugin.java */
export const BluetoothSerial = registerPlugin<BluetoothSerialPlugin>("BluetoothSerial");
/** android/app/src/main/java/com/kaykays/app/NetworkPrinterPlugin.java */
export const NetworkPrinter = registerPlugin<NetworkPrinterPlugin>("NetworkPrinter");
/** android/app/src/main/java/com/kaykays/app/ReceiptMailPlugin.java */
export const ReceiptMail = registerPlugin<ReceiptMailPlugin>("ReceiptMail");

export function bytesToBase64(data: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < data.length; i += step) {
    binary += String.fromCharCode(...data.subarray(i, i + step));
  }
  return btoa(binary);
}
