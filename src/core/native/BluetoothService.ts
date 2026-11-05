// src/core/native/BluetoothService.ts
import { registerPlugin } from "@capacitor/core";
import { nativePlatformService } from "./NativePlatformService";
import { permissionService } from "./PermissionService";

export interface BluetoothDeviceDetails {
  name: string;
  address: string; // MAC address or UUID identifier
  rssi?: number;
  connected: boolean;
}

interface BluetoothSerialPlugin {
  ensureAccess(): Promise<{ granted: boolean }>;
  isEnabled(): Promise<{ value: boolean }>;
  list(): Promise<{ list: Array<{ name?: string; address: string }> }>;
  connect(options: { address: string }): Promise<void>;
  write(options: { value: string }): Promise<void>;
  disconnect(): Promise<void>;
}

/** Implemented by android/app/src/main/java/com/kaykays/app/BluetoothSerialPlugin.java */
export const BluetoothSerial = registerPlugin<BluetoothSerialPlugin>("BluetoothSerial");

export type BluetoothStateListener = (devices: BluetoothDeviceDetails[]) => void;
const SPP_SERVICE_UUID = "00001101-0000-1000-8000-00805f9b34fb";

class BluetoothService {
  private discoveredDevices: BluetoothDeviceDetails[] = [];
  private stateListeners: Set<BluetoothStateListener> = new Set();
  private isScanningState = false;

  // Web Bluetooth Cache references
  private webGattServer: BluetoothRemoteGATTServer | null = null;
  private webWriteCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private webDevice: BluetoothDevice | null = null;

  public onDevicesDiscovered(listener: BluetoothStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.discoveredDevices);
    return () => this.stateListeners.delete(listener);
  }

  public isScanning(): boolean {
    return this.isScanningState;
  }

  /**
   * Scan for nearby Bluetooth devices
   */
  public async scan(): Promise<BluetoothDeviceDetails[]> {
    if (this.isScanningState) return this.discoveredDevices;
    this.isScanningState = true;
    this.discoveredDevices = [];

    // Verify Bluetooth permission
    const permGranted = await permissionService.requestPermission("bluetooth", {
      title: "Bluetooth Connection Request",
      message: "KayKay's requires Bluetooth access to scan and link thermal receipt printers."
    });

    if (!permGranted) {
      this.isScanningState = false;
      throw new Error("Bluetooth permissions were not granted.");
    }

    try {
      if (nativePlatformService.isNative()) {
        await this.scanNative();
      } else {
        await this.scanWeb();
      }
    } finally {
      this.isScanningState = false;
    }

    return this.discoveredDevices;
  }

  /**
   * Connect to a selected Bluetooth device address/GATT
   */
  public async connect(address: string): Promise<boolean> {
    try {
      if (nativePlatformService.isNative()) {
        return await this.connectNative(address);
      } else {
        return await this.connectWeb(address);
      }
    } catch (e) {
      console.error(`Failed connecting to Bluetooth device ${address}:`, e);
      return false;
    }
  }

  /**
   * Disconnect the active Bluetooth connection
   */
  public async disconnect(): Promise<void> {
    try {
      if (nativePlatformService.isNative()) {
        await this.disconnectNative();
      } else {
        await this.disconnectWeb();
      }
    } catch (e) {
      console.warn("Bluetooth disconnect threw an error:", e);
    }
  }

  /**
   * Write byte arrays directly to the Bluetooth characteristics channel
   */
  public async write(data: Uint8Array): Promise<boolean> {
    try {
      if (nativePlatformService.isNative()) {
        return await this.writeNative(data);
      } else {
        return await this.writeWeb(data);
      }
    } catch (e) {
      console.error("Error writing data over Bluetooth link:", e);
      return false;
    }
  }

  // ==========================================
  // NATIVE IMPLEMENTATIONS
  // ==========================================

  private async scanNative(): Promise<void> {
    const { value: enabled } = await BluetoothSerial.isEnabled();
    if (!enabled) throw new Error("Bluetooth is turned off. Please turn it on and try again.");

    // Thermal printers are paired once in Android settings, then listed here.
    const { list } = await BluetoothSerial.list();
    this.discoveredDevices = list.map((d) => ({
      name: d.name || "Thermal Printer",
      address: d.address,
      connected: false
    }));
    this.stateListeners.forEach((l) => l(this.discoveredDevices));
  }

  private async connectNative(address: string): Promise<boolean> {
    await BluetoothSerial.connect({ address });
    return true;
  }

  private async disconnectNative(): Promise<void> {
    await BluetoothSerial.disconnect();
  }

  private async writeNative(data: Uint8Array): Promise<boolean> {
    const binary = Array.from(data).map((b) => String.fromCharCode(b)).join("");
    await BluetoothSerial.write({ value: window.btoa(binary) });
    return true;
  }

  // ==========================================
  // WEB BLUETOOTH IMPLEMENTATIONS
  // ==========================================

  private async scanWeb(): Promise<void> {
    if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
      throw new Error("Web Bluetooth API is not supported in this browser.");
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          { namePrefix: "Printer" },
          { namePrefix: "Thermal" },
          { namePrefix: "MPT" },
          { namePrefix: "MTP" },
          { services: [SPP_SERVICE_UUID] }
        ]
      });

      if (device) {
        this.webDevice = device;
        const mapped: BluetoothDeviceDetails = {
          name: device.name || "Bluetooth Printer",
          address: device.id,
          connected: false
        };
        this.discoveredDevices = [mapped];
        this.stateListeners.forEach((l) => l(this.discoveredDevices));
      }
    } catch (err) {
      console.warn("Web Bluetooth device selection cancelled:", err);
    }
  }

  private async connectWeb(address: string): Promise<boolean> {
    if (!this.webDevice || this.webDevice.id !== address) return false;

    try {
      this.webGattServer = await this.webDevice.gatt!.connect();
      const service = await this.webGattServer.getPrimaryService(SPP_SERVICE_UUID);
      const chars = await service.getCharacteristics();
      const writeChar = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);

      if (writeChar) {
        this.webWriteCharacteristic = writeChar;
        return true;
      }
      return false;
    } catch (e) {
      console.error("Web GATT connection failed:", e);
      return false;
    }
  }

  private async disconnectWeb(): Promise<void> {
    if (this.webGattServer && this.webGattServer.connected) {
      this.webGattServer.disconnect();
    }
    this.webGattServer = null;
    this.webWriteCharacteristic = null;
    this.webDevice = null;
  }

  private async writeWeb(data: Uint8Array): Promise<boolean> {
    if (!this.webWriteCharacteristic) return false;

    try {
      const chunkSize = 20; // Chunk binary transfers for BLE payload sizes
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await this.webWriteCharacteristic.writeValue(chunk);
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const bluetoothService = new BluetoothService();
export default bluetoothService;
