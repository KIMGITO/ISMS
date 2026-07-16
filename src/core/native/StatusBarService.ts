// src/core/native/StatusBarService.ts
import { StatusBar, Style } from "@capacitor/status-bar";
import { nativePlatformService } from "./NativePlatformService";

class StatusBarService {
  /**
   * Configure the device status bar appearance based on theme mode
   */
  public async setStyle(mode: "light" | "dark"): Promise<void> {
    if (!nativePlatformService.isNative()) return;

    try {
      // Ensure the webview overlays the status bar so env(safe-area-inset-top) applies
      await StatusBar.setOverlaysWebView({ overlay: true });

      if (mode === "dark") {
        await StatusBar.setStyle({ style: Style.Dark });
      } else {
        await StatusBar.setStyle({ style: Style.Light });
      }
    } catch (e) {
      console.warn("StatusBar style configuration failed natively:", e);
    }
  }

  /**
   * Hide the status bar (e.g. for full screen scanning or splash launch screen)
   */
  public async hide(): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await StatusBar.hide();
    } catch {}
  }

  /**
   * Show the status bar
   */
  public async show(): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await StatusBar.show();
    } catch {}
  }
}

export const statusBarService = new StatusBarService();
export default statusBarService;
