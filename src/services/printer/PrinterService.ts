// src/services/printer/PrinterService.ts
// Finds receipt printers and sends ESC/POS jobs over Bluetooth (Android) or Wi-Fi/LAN (Android, desktop).
// Nothing here reports success unless the bytes reached the printer.
import { nativePlatformService } from "../../core/native/NativePlatformService";
import { BluetoothSerial, NetworkPrinter, bytesToBase64 } from "../../core/native/BluetoothService";
import { DevicePrinterPrefs, DiscoveredPrinter, PrinterTarget, PrintingSupport } from "./types";

const PREFS_KEY = "kkm_receipt_printers_v2";
const RAW_PORT = 9100;

const DEFAULT_PREFS: DevicePrinterPrefs = { printers: [], defaultId: null, copies: 1, autoCut: true };

function tauriInvoke(): (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null {
  const tauri = typeof window !== "undefined" ? (window as any).__TAURI__ : null;
  return tauri?.core?.invoke ?? null;
}

const isAndroid = () => nativePlatformService.isAndroid();

export const bluetoothId = (address: string) => `bt:${address.toUpperCase()}`;
export const networkId = (host: string, port = RAW_PORT) => `net:${host}:${port}`;

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function errorText(err: unknown, fallback: string): string {
  if (typeof err === "string") return err;
  const message = (err as any)?.message;
  return typeof message === "string" && message ? message : fallback;
}

class PrinterService {
  private listeners = new Set<(prefs: DevicePrinterPrefs) => void>();

  public support(): PrintingSupport {
    if (isAndroid()) return { bluetooth: true, network: true };
    if (tauriInvoke()) return { bluetooth: false, network: true };
    return {
      bluetooth: false,
      network: false,
      reason: "Printing to a receipt printer works in the KayKay's Android and desktop apps. Here you can download the PDF instead.",
    };
  }

  public canPrint(): boolean {
    const s = this.support();
    return s.bluetooth || s.network;
  }

  // ---------- preferences (this device only) ----------

  public getPrefs(): DevicePrinterPrefs {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        return {
          ...DEFAULT_PREFS,
          ...saved,
          printers: Array.isArray(saved.printers) ? saved.printers : [],
          copies: Math.min(5, Math.max(1, Number(saved.copies) || 1)),
        };
      }
    } catch {
      // Storage can be unavailable; fall back to defaults.
    }
    return { ...DEFAULT_PREFS };
  }

  public savePrefs(update: Partial<DevicePrinterPrefs>): DevicePrinterPrefs {
    const next = { ...this.getPrefs(), ...update };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Not fatal: the choice simply is not remembered.
    }
    this.listeners.forEach((l) => l(next));
    return next;
  }

  public onPrefsChange(listener: (prefs: DevicePrinterPrefs) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public remember(printer: PrinterTarget, makeDefault = true): void {
    const prefs = this.getPrefs();
    const printers = [printer, ...prefs.printers.filter((p) => p.id !== printer.id)];
    this.savePrefs({ printers, defaultId: makeDefault ? printer.id : prefs.defaultId ?? printer.id });
  }

  public forget(id: string): void {
    const prefs = this.getPrefs();
    const printers = prefs.printers.filter((p) => p.id !== id);
    this.savePrefs({ printers, defaultId: prefs.defaultId === id ? printers[0]?.id ?? null : prefs.defaultId });
  }

  public rename(id: string, name: string): void {
    const prefs = this.getPrefs();
    this.savePrefs({ printers: prefs.printers.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)) });
  }

  // ---------- discovery ----------

  /**
   * Searches every transport this platform has and merges the results with saved printers.
   * Saved printers that did not answer are still listed, marked unavailable.
   */
  public async discover(options: { bluetooth?: boolean; network?: boolean } = {}): Promise<{ printers: DiscoveredPrinter[]; problems: string[] }> {
    const support = this.support();
    const problems: string[] = [];
    const found = new Map<string, DiscoveredPrinter>();
    const savedIds = new Set(this.getPrefs().printers.map((p) => p.id));

    const jobs: Promise<void>[] = [];
    if (support.bluetooth && options.bluetooth !== false) {
      jobs.push(
        this.discoverBluetooth().then(
          (list) => list.forEach((p) => found.set(p.id, p)),
          (err) => {
            problems.push(errorText(err, "Bluetooth search failed."));
          },
        ),
      );
    }
    if (support.network && options.network !== false) {
      jobs.push(
        this.discoverNetwork().then(
          (list) => list.forEach((p) => found.set(p.id, p)),
          (err) => {
            problems.push(errorText(err, "Wi-Fi search failed."));
          },
        ),
      );
    }
    await Promise.all(jobs);

    // Saved network printers outside the scanned subnet (or with a custom port) are checked directly.
    for (const saved of this.getPrefs().printers) {
      if (found.has(saved.id)) continue;
      let available = false;
      if (saved.kind === "network" && support.network) {
        available = await this.probe(saved.address, saved.port ?? RAW_PORT).catch(() => false);
      }
      if (saved.kind === "bluetooth" && !support.bluetooth) continue;
      found.set(saved.id, { ...saved, available, saved: true });
    }

    const printers = Array.from(found.values()).map((p) => {
      const saved = this.getPrefs().printers.find((s) => s.id === p.id);
      return { ...p, name: saved?.name || p.name, saved: savedIds.has(p.id) };
    });
    printers.sort((a, b) => Number(b.saved) - Number(a.saved) || Number(b.available) - Number(a.available) || Number(!!b.isPrinter) - Number(!!a.isPrinter) || a.name.localeCompare(b.name));
    return { printers, problems };
  }

  private async discoverBluetooth(): Promise<DiscoveredPrinter[]> {
    const { granted } = await BluetoothSerial.ensureAccess();
    if (!granted) throw new Error("Allow Bluetooth access (Nearby devices) to find printers.");
    const { value: enabled } = await BluetoothSerial.isEnabled();
    if (!enabled) throw new Error("Bluetooth is off. Turn it on to find Bluetooth printers.");
    const { list } = await BluetoothSerial.discover({ timeoutMs: 8000 });
    return list
      // Headphones, watches and cars cannot print; keep printers, unnamed devices and anything already paired.
      .filter((d) => d.isPrinter || d.paired || !d.name)
      .map((d) => ({
        id: bluetoothId(d.address),
        kind: "bluetooth" as const,
        name: d.name || `Bluetooth printer ${d.address.slice(-5)}`,
        address: d.address,
        paired: d.paired,
        available: d.inRange || d.connected,
        isPrinter: d.isPrinter,
        saved: false,
      }));
  }

  private async discoverNetwork(): Promise<DiscoveredPrinter[]> {
    let list: Array<{ host: string; port: number; name?: string }> = [];
    const invoke = tauriInvoke();
    if (isAndroid()) {
      list = (await NetworkPrinter.scan({ port: RAW_PORT, timeoutMs: 400 })).list;
    } else if (invoke) {
      list = (await invoke<{ list: Array<{ host: string; port: number }> }>("printer_scan_network", { port: RAW_PORT, timeoutMs: 400 })).list;
    }
    return list.map((p) => ({
      id: networkId(p.host, p.port),
      kind: "network" as const,
      name: p.name || `Network printer ${p.host}`,
      address: p.host,
      port: p.port,
      available: true,
      saved: false,
    }));
  }

  public async probe(host: string, port = RAW_PORT): Promise<boolean> {
    if (!IPV4.test(host.trim())) throw new Error("Enter an IP address like 192.168.1.50.");
    const invoke = tauriInvoke();
    if (isAndroid()) return (await NetworkPrinter.probe({ host: host.trim(), port, timeoutMs: 1500 })).reachable;
    if (invoke) return invoke<boolean>("printer_probe", { host: host.trim(), port, timeoutMs: 1500 });
    return false;
  }

  /** Adds a network printer by IP after checking that it answers. */
  public async addNetworkPrinter(host: string, port = RAW_PORT, name?: string): Promise<PrinterTarget> {
    const reachable = await this.probe(host, port);
    if (!reachable) throw new Error(`Nothing answered at ${host.trim()}:${port}. Check the IP address and that the printer is on.`);
    const printer: PrinterTarget = { id: networkId(host.trim(), port), kind: "network", name: name?.trim() || `Network printer ${host.trim()}`, address: host.trim(), port };
    this.remember(printer, this.getPrefs().printers.length === 0);
    return printer;
  }

  // ---------- printing ----------

  /** Sends the job; throws with a message the cashier can act on when it does not print. */
  public async print(printer: PrinterTarget, data: Uint8Array, copies = 1): Promise<void> {
    if (!data.length) throw new Error("Nothing to print.");
    const times = Math.min(5, Math.max(1, copies));
    if (printer.kind === "bluetooth") {
      if (!isAndroid()) throw new Error("Bluetooth printers work from the Android app.");
      const { granted } = await BluetoothSerial.ensureAccess();
      if (!granted) throw new Error("Allow Bluetooth access (Nearby devices) to print.");
      try {
        await BluetoothSerial.connect({ address: printer.address });
        for (let i = 0; i < times; i++) await BluetoothSerial.write({ value: bytesToBase64(data) });
      } catch (err) {
        await BluetoothSerial.disconnect().catch(() => undefined);
        throw new Error(errorText(err, `Could not print to ${printer.name}.`));
      }
      return;
    }

    const port = printer.port ?? RAW_PORT;
    const invoke = tauriInvoke();
    try {
      for (let i = 0; i < times; i++) {
        if (isAndroid()) await NetworkPrinter.send({ host: printer.address, port, value: bytesToBase64(data) });
        else if (invoke) await invoke("printer_send", { host: printer.address, port, data: Array.from(data) });
        else throw new Error(this.support().reason);
      }
    } catch (err) {
      throw new Error(errorText(err, `Could not print to ${printer.name}.`));
    }
  }
}

export const printerService = new PrinterService();
export default printerService;
