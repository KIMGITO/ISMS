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
    explanation: "We require camera access to let your device scan product SKU barcodes on checking out and take real-time profile pictures of employees.",
    iconName: "camera"
  },
  photos: {
    type: "photos",
    label: "Photos",
    description: "Choose logos and photos.",
    explanation: "Photo library access lets you choose pre-saved high-quality store logos and employee avatars directly from your photo album.",
    iconName: "photos"
  },
  storage: {
    type: "storage",
    label: "Storage",
    description: "Keep sales when offline.",
    explanation: "Local storage persistence is essential to cache products, customers, and pending sales transactions securely on your device during network blackouts.",
    iconName: "storage"
  },
  microphone: {
    type: "microphone",
    label: "Microphone",
    description: "Search and ask by voice.",
    explanation: "We utilize microphone inputs for audio queries, letting cashiers dictate notes, search orders by voice, and communicate with the AI assistant hands-free.",
    iconName: "microphone"
  },
  location: {
    type: "location",
    label: "Location",
    description: "Delivery routes.",
    explanation: "GPS coordinates are requested to verify location accuracy for staff punch-ins at active branches and map optimal routes for dispatch riders.",
    iconName: "location"
  },
  notifications: {
    type: "notifications",
    label: "Notifications",
    description: "Alerts and reminders.",
    explanation: "Push notifications guarantee you immediately receive warning banners for expiring stocks, low-cash registers, and urgent AI audit reports.",
    iconName: "notifications"
  },
  bluetooth: {
    type: "bluetooth",
    label: "Bluetooth",
    description: "Receipt printers.",
    explanation: "We require Bluetooth search capabilities to pair with and print real-time sales receipts to external mobile thermal receipt printers.",
    iconName: "bluetooth"
  },
  contacts: {
    type: "contacts",
    label: "Contacts",
    description: "Add customers from contacts.",
    explanation: "Address book imports allow cashiers to register new loyalty customers in one tap by selecting their details from their device contacts.",
    iconName: "contacts"
  },
  calendar: {
    type: "calendar",
    label: "Calendar",
    description: "Add shifts to your calendar.",
    explanation: "Calendar access is used to export and synchronize assigned shift schedules directly to your personal device calendar.",
    iconName: "calendar"
  },
  phone: {
    type: "phone",
    label: "Phone calls",
    description: "Call riders and customers.",
    explanation: "Phone dialer integration allows cashiers to call dispatch riders and customers directly from the app to resolve delivery issues.",
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
