// src/core/native/BluetoothService.ts
import { nativePlatformService } from "./NativePlatformService";
import { permissionService } from "./PermissionService";

export interface BluetoothDeviceDetails {
  name: string;
  address: string; // MAC address or UUID identifier
  rssi?: number;
  connected: boolean;
}

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
      message: "KayKay's Milk requires Bluetooth access to scan and link thermal receipt printers."
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
    } catch (e) {
      console.error("Bluetooth scan failed:", e);
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

  private getPlugin(): any {
    const cap = (window as any).Capacitor;
    return cap?.Plugins?.BluetoothSerial || cap?.Plugins?.BluetoothLE || null;
  }

  private async scanNative(): Promise<void> {
    const plugin = this.getPlugin();
    if (!plugin) throw new Error("No native Bluetooth Capacitor plugins discovered.");

    if (plugin.isEnabled) {
      const isEnabled = await plugin.isEnabled();
      if (!isEnabled.value && plugin.enable) {
        await plugin.enable();
      }
    }

    if (plugin.discoverUnpaired) {
      const unpaired = await plugin.discoverUnpaired();
      const paired = plugin.list ? await plugin.list() : { list: [] };
      const combined = [...(paired.list || []), ...(unpaired.list || [])];
      
      this.discoveredDevices = combined.map((d: any) => ({
        name: d.name || "Thermal Printer",
        address: d.address || d.id,
        rssi: d.rssi,
        connected: false
      }));

      this.stateListeners.forEach((l) => l(this.discoveredDevices));
    }
  }

  private async connectNative(address: string): Promise<boolean> {
    const plugin = this.getPlugin();
    if (!plugin || !plugin.connect) return false;

    return new Promise((resolve) => {
      plugin.connect({ address }).subscribe(
        () => resolve(true),
        () => resolve(false)
      );
    });
  }

  private async disconnectNative(): Promise<void> {
    const plugin = this.getPlugin();
    if (plugin && plugin.disconnect) {
      await plugin.disconnect();
    }
  }

  private async writeNative(data: Uint8Array): Promise<boolean> {
    const plugin = this.getPlugin();
    if (!plugin || !plugin.write) return false;

    try {
      const binary = Array.from(data).map((b) => String.fromCharCode(b)).join("");
      const base64 = window.btoa(binary);
      await plugin.write({ value: base64 });
      return true;
    } catch {
      return false;
    }
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
