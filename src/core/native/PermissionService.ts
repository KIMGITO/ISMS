// src/core/native/PermissionService.ts
import { nativePlatformService } from "./NativePlatformService";
import { Capacitor } from '@capacitor/core';
import { Permissions } from '@capawesome/capacitor-permissions';

export type PermissionType = "camera" | "photos" | "storage" | "notifications" | "bluetooth" | "location" | "clipboard" | "files";
export type PermissionStatus = "prompt" | "granted" | "denied";

class PermissionService {
  /**
   * Check if a specific permission is already granted
   */
  public async checkPermission(type: PermissionType): Promise<PermissionStatus> {
    if (!nativePlatformService.isNative()) {
      return this.checkWebPermission(type);
    }

    try {
      switch (type) {
        case "camera": {
          const { Camera } = await import("@capacitor/camera");
          const status = await Camera.checkPermissions();
          return status.camera as PermissionStatus;
        }
        case "photos": {
          const { Camera } = await import("@capacitor/camera");
          const status = await Camera.checkPermissions();
          return status.photos as PermissionStatus;
        }
        case "location": {
          const { Geolocation } = await import("@capacitor/geolocation");
          const status = await Geolocation.checkPermissions();
          return status.location as PermissionStatus;
        }
        case "notifications": {
          const { LocalNotifications } = await import("@capacitor/local-notifications");
          const status = await LocalNotifications.checkPermissions();
          return status.display as PermissionStatus;
        }
        case "clipboard":
        case "storage":
        case "files":
        case "bluetooth":
        default:
          return "granted"; // Assume granted or handled on usage dynamically for other native modules
      }
    } catch (e) {
      console.warn(`Error checking native permission for ${type}:`, e);
      return "prompt";
    }
  }

  /**
   * Request user permission, optionally displaying a user-friendly pre-explanation dialog first
   */
  public async requestPermission(
    type: PermissionType,
    explanation?: { title: string; message: string }
  ): Promise<boolean> {
    // Show a user-friendly explanation if provided
    if (explanation) {
      const confirmed = await this.showExplanationDialog(explanation.title, explanation.message);
      if (!confirmed) return false;
    }

    if (!nativePlatformService.isNative()) {
      return this.requestWebPermission(type);
    }

    try {
      switch (type) {
        case "camera": {
          const { Camera } = await import("@capacitor/camera");
          const status = await Camera.requestPermissions({ permissions: ["camera"] });
          return status.camera === "granted";
        }
        case "photos": {
          const { Camera } = await import("@capacitor/camera");
          const status = await Camera.requestPermissions({ permissions: ["photos"] });
          return status.photos === "granted";
        }
        case "location": {
          const { Geolocation } = await import("@capacitor/geolocation");
          const status = await Geolocation.requestPermissions({ permissions: ["coarseLocation", "location"] });
          return status.location === "granted";
        }
        case "notifications": {
          const { LocalNotifications } = await import("@capacitor/local-notifications");
          const status = await LocalNotifications.requestPermissions();
          return status.display === "granted";
        }
        case "clipboard":
        case "storage":
        case "files":
          return true; // Auto-approved for platform security boundaries
        case "bluetooth": {
          if (Capacitor.getPlatform() === 'android') {
            const { Permissions } = await import('@capawesome/capacitor-permissions');
            const scanResult = await Permissions.request({ name: 'bluetoothScan' as any });
            if (scanResult.state !== 'granted') return false;
            const connectResult = await Permissions.request({ name: 'bluetoothConnect' as any });
            if (connectResult.state !== 'granted') return false;
          }
          return true;
        }
        default:
          return true; // Auto-approved for platform security boundaries
      }
    } catch (e) {
      console.error(`Failed requesting native permission for ${type}:`, e);
      return false;
    }
  }

  private async checkWebPermission(type: PermissionType): Promise<PermissionStatus> {
    if (typeof navigator === "undefined" || !navigator.permissions) {
      return "granted";
    }

    try {
      if (type === "location") {
        const result = await navigator.permissions.query({ name: "geolocation" as any });
        return result.state as PermissionStatus;
      }
      if (type === "camera") {
        const result = await navigator.permissions.query({ name: "camera" as any });
        return result.state as PermissionStatus;
      }
      if (type === "notifications") {
        return Notification.permission === "default" 
          ? "prompt" 
          : (Notification.permission === "granted" ? "granted" : "denied");
      }
    } catch (e) {
      console.warn(`Failed querying permission for ${type}:`, e);
      return "prompt";
    }

    return "granted";
  }

  private async requestWebPermission(type: PermissionType): Promise<boolean> {
    try {
      if (type === "location") {
        return new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(true),
            () => resolve(false),
            { timeout: 3000 }
          );
        });
      }
      if (type === "notifications") {
        const status = await Notification.requestPermission();
        return status === "granted";
      }
      if (type === "camera") {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("navigator.mediaDevices.getUserMedia is not supported on this platform/context");
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((track) => track.stop());
        return true;
      }
    } catch (e) {
      console.warn(`Web permission request failed for ${type}:`, e);
      return false;
    }
    return true;
  }

  private async showExplanationDialog(title: string, message: string): Promise<boolean> {
    if (nativePlatformService.isNative()) {
      try {
        const { Dialog } = await import("@capacitor/dialog");
        const res = await Dialog.confirm({
          title,
          message,
          okButtonTitle: "Continue",
          cancelButtonTitle: "Cancel"
        });
        return res.value;
      } catch {}
    }
    return window.confirm(`${title}\n\n${message}`);
  }
}

export const permissionService = new PermissionService();
export default permissionService;
