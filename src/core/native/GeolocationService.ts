// src/core/native/GeolocationService.ts
import { Geolocation } from "@capacitor/geolocation";
import { nativePlatformService } from "./NativePlatformService";

export interface LatLng {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

class GeolocationService {
  /**
   * Fetch the current device coordinates using native GPS or web geolocation API.
   */
  public async getCurrentPosition(): Promise<LatLng | null> {
    try {
      if (nativePlatformService.isNative()) {
        const coordinates = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 3600000
        });

        return {
          latitude: coordinates.coords.latitude,
          longitude: coordinates.coords.longitude,
          accuracy: coordinates.coords.accuracy,
          timestamp: coordinates.timestamp
        };
      } else {
        return new Promise((resolve) => {
          if (typeof navigator !== "undefined" && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                resolve({
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  accuracy: pos.coords.accuracy,
                  timestamp: pos.timestamp
                });
              },
              (err) => {
                console.warn("Browser Geolocation query rejected:", err);
                resolve(null);
              },
              { timeout: 8000 }
            );
          } else {
            resolve(null);
          }
        });
      }
    } catch (e) {
      console.error("Geolocation fetch failed:", e);
      return null;
    }
  }
}

export const geolocationService = new GeolocationService();
export default geolocationService;
