// src/services/devicePermissionService.ts
import { permissionService, PermissionType as CorePermissionType, PermissionStatus as CorePermissionStatus } from "../core/native/PermissionService";
import { nativePlatformService } from "../core/native/NativePlatformService";

export type PermissionType =
  | "camera"
  | "photos"
  | "storage"
  | "microphone"
  | "location"
  | "notifications"
  | "bluetooth"
  | "contacts"
  | "calendar"
  | "phone";

export type PermissionStatus = "granted" | "denied" | "prompt" | "unsupported";

export interface PermissionDetails {
  type: PermissionType;
  label: string;
  description: string;
  explanation: string;
  iconName: string;
}

export const PERMISSION_METADATA: Record<PermissionType, PermissionDetails> = {
  camera: {
    type: "camera",
    label: "Camera",
    description: "Scan barcodes and take photos.",
    explanation: "Used to scan barcodes and take product and profile photos.",
    iconName: "camera"
  },
  photos: {
    type: "photos",
    label: "Photos",
    description: "Choose logos and photos.",
    explanation: "Used to pick logos and photos from your gallery.",
    iconName: "photos"
  },
  storage: {
    type: "storage",
    label: "Storage",
    description: "Keep sales when offline.",
    explanation: "Used to keep products, customers and unsent sales on this device while offline.",
    iconName: "storage"
  },
  microphone: {
    type: "microphone",
    label: "Microphone",
    description: "Search and ask by voice.",
    explanation: "Used to search and ask the assistant by voice.",
    iconName: "microphone"
  },
  location: {
    type: "location",
    label: "Location",
    description: "Delivery routes.",
    explanation: "Used for delivery locations and rider routes.",
    iconName: "location"
  },
  notifications: {
    type: "notifications",
    label: "Notifications",
    description: "Alerts and reminders.",
    explanation: "Used for low stock alerts, payments, reminders and shift reports.",
    iconName: "notifications"
  },
  bluetooth: {
    type: "bluetooth",
    label: "Bluetooth",
    description: "Receipt printers.",
    explanation: "Used to find and print to Bluetooth receipt printers.",
    iconName: "bluetooth"
  },
  contacts: {
    type: "contacts",
    label: "Contacts",
    description: "Add customers from contacts.",
    explanation: "Used to add customers from your contacts.",
    iconName: "contacts"
  },
  calendar: {
    type: "calendar",
    label: "Calendar",
    description: "Add shifts to your calendar.",
    explanation: "Used to add your shifts to your calendar.",
    iconName: "calendar"
  },
  phone: {
    type: "phone",
    label: "Phone calls",
    description: "Call riders and customers.",
    explanation: "Used to call riders and customers from the app.",
    iconName: "phone"
  }
};

export class DevicePermissionService {
  private static instance: DevicePermissionService;

  public static getInstance(): DevicePermissionService {
    if (!DevicePermissionService.instance) {
      DevicePermissionService.instance = new DevicePermissionService();
    }
    return DevicePermissionService.instance;
  }

  public isCapacitor(): boolean {
    return nativePlatformService.isNative();
  }

  public async checkStatus(type: PermissionType): Promise<PermissionStatus> {
    const coreType = this.mapPermissionType(type);
    if (!coreType) return "unsupported";

    const status = await permissionService.checkPermission(coreType);
    return status as PermissionStatus;
  }

  public async request(type: PermissionType): Promise<PermissionStatus> {
    const coreType = this.mapPermissionType(type);
    if (!coreType) return "unsupported";

    const meta = PERMISSION_METADATA[type];
    const success = await permissionService.requestPermission(coreType, {
      title: meta.label,
      message: meta.explanation
    });

    return success ? "granted" : "denied";
  }

  public openAppSettings() {
    if (this.isCapacitor()) {
      const cap = (window as any).Capacitor;
      if (cap.Plugins && cap.Plugins.App && cap.Plugins.App.openAppSettings) {
        cap.Plugins.App.openAppSettings();
      }
    }
  }

  private mapPermissionType(type: PermissionType): CorePermissionType | null {
    switch (type) {
      case "camera":
        return "camera";
      case "photos":
        return "photos";
      case "storage":
        return "storage";
      case "location":
        return "location";
      case "notifications":
        return "notifications";
      case "bluetooth":
        return "bluetooth";
      default:
        return null;
    }
  }
}

export const devicePermissionService = DevicePermissionService.getInstance();
