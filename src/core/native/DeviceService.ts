// src/core/native/DeviceService.ts
import { Device } from "@capacitor/device";
import { nativePlatformService } from "./NativePlatformService";

export interface DeviceInfoDetails {
  platform: string;
  os: string;
  osVersion: string;
  model: string;
  manufacturer: string;
  language: string;
  uuid: string;
  appVersion: string;
  appBuild: string;
}

class DeviceService {
  public async getDeviceInfo(): Promise<DeviceInfoDetails> {
    try {
      const info = await Device.getInfo();
      const code = await Device.getId();
      const lang = await Device.getLanguageCode();

      return {
        platform: info.platform || nativePlatformService.getPlatform(),
        os: info.operatingSystem || "unknown",
        osVersion: info.osVersion || "1.0",
        model: info.model || "Web Client",
        manufacturer: info.manufacturer || "Browser",
        language: lang.value || "en",
        uuid: code.identifier || "web-client-session",
        appVersion: "1.0.0", // Packaged version metadata
        appBuild: "1"
      };
    } catch (e) {
      console.warn("Failed retrieving native device info, falling back to browser navigator:", e);
      return {
        platform: nativePlatformService.getPlatform(),
        os: typeof navigator !== "undefined" ? navigator.userAgent : "Web",
        osVersion: "1.0",
        model: "Web Browser",
        manufacturer: "Web",
        language: typeof navigator !== "undefined" ? navigator.language : "en",
        uuid: "browser-client-uuid",
        appVersion: "1.0.0",
        appBuild: "1"
      };
    }
  }
}

export const deviceService = new DeviceService();
export default deviceService;
