// src/services/printer/BluetoothPrinterService.ts
import { BluetoothPrinterDevice, PrinterConnectionState } from "./types";
import { PrinterRepository } from "./PrinterRepository";
import { bluetoothService } from "../../core/native/BluetoothService";
import { nativePlatformService } from "../../core/native/NativePlatformService";

type StateChangeListener = (state: PrinterConnectionState) => void;
type DeviceListListener = (devices: BluetoothPrinterDevice[]) => void;

export class BluetoothPrinterService {
  private static instance: BluetoothPrinterService;

  private connectionState: PrinterConnectionState = "Disconnected";
  private discoveredDevices: BluetoothPrinterDevice[] = [];
  private activeDevice: BluetoothPrinterDevice | null = null;
  private stateListeners: Set<StateChangeListener> = new Set();
  private deviceListeners: Set<DeviceListListener> = new Set();

  public static getInstance(): BluetoothPrinterService {
    if (!BluetoothPrinterService.instance) {
      BluetoothPrinterService.instance = new BluetoothPrinterService();
    }
    return BluetoothPrinterService.instance;
  }

  constructor() {
    // Attempt auto-reconnect if preferred printer exists
    const preferred = PrinterRepository.getPreferredPrinter();
    if (preferred) {
      this.activeDevice = preferred;
    }

    // Subscribe to internal BluetoothService discovery updates
    bluetoothService.onDevicesDiscovered((devices) => {
      this.discoveredDevices = devices.map((d) => ({
        name: d.name,
        address: d.address,
        status: d.connected ? "Connected" : "Disconnected",
        signalStrength: d.rssi,
        isSaved: this.activeDevice?.address === d.address
      }));
      this.deviceListeners.forEach((l) => l(this.discoveredDevices));
    });
  }

  public onStateChange(listener: StateChangeListener): () => void {
    this.stateListeners.add(listener);
    listener(this.connectionState);
    return () => this.stateListeners.delete(listener);
  }

  public onDevicesDiscovered(listener: DeviceListListener): () => void {
    this.deviceListeners.add(listener);
    listener(this.discoveredDevices);
    return () => this.deviceListeners.delete(listener);
  }

  private updateState(newState: PrinterConnectionState) {
    this.connectionState = newState;
    if (this.activeDevice) {
      this.activeDevice.status = newState;
    }
    this.stateListeners.forEach((l) => l(newState));
  }

  public isBluetoothSupported(): boolean {
    if (nativePlatformService.isNative()) return true;
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  public async scan(): Promise<void> {
    if (this.connectionState === "Scanning") return;
    this.updateState("Scanning");

    try {
      await bluetoothService.scan();
      this.updateState("Disconnected");
    } catch (e: any) {
      console.error("Bluetooth printer scan failed:", e);
      this.updateState("Disconnected");
      throw e;
    }
  }

  public async connect(device: BluetoothPrinterDevice): Promise<boolean> {
    this.updateState("Connecting");
    this.activeDevice = device;

    try {
      const success = await bluetoothService.connect(device.address);
      if (success) {
        this.updateState("Connected");
        PrinterRepository.savePreferredPrinter(device);
        return true;
      } else {
        this.updateState("Failed");
        return false;
      }
    } catch (e) {
      console.error("Printer connection failed:", e);
      this.updateState("Failed");
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await bluetoothService.disconnect();
    } catch (e) {
      console.warn("Error during printer disconnect:", e);
    }
    this.updateState("Disconnected");
  }

  public forgetPrinter(): void {
    PrinterRepository.deletePreferredPrinter();
    if (this.activeDevice) {
      this.activeDevice.isSaved = false;
    }
    this.disconnect();
  }

  public async write(data: Uint8Array): Promise<boolean> {
    if (this.connectionState !== "Connected") {
      console.warn("Cannot write, printer is not connected.");
      return false;
    }

    this.updateState("Printing");

    try {
      const success = await bluetoothService.write(data);
      this.updateState(success ? "Connected" : "Failed");
      return success;
    } catch (e) {
      console.error("Printer write error:", e);
      this.updateState("Failed");
      return false;
    }
  }

  public getActiveDevice(): BluetoothPrinterDevice | null {
    return this.activeDevice;
  }

  public getConnectionState(): PrinterConnectionState {
    return this.connectionState;
  }
}

export const bluetoothPrinterService = BluetoothPrinterService.getInstance();
export default bluetoothPrinterService;
