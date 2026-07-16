// src/core/native/SplashScreenService.ts
import { SplashScreen } from "@capacitor/splash-screen";
import { nativePlatformService } from "./NativePlatformService";

class SplashScreenService {
  /**
   * Hide the native startup splash screen once the web view has fully loaded and mounted
   */
  public async hide(): Promise<void> {
    if (!nativePlatformService.isNative()) return;

    try {
      await SplashScreen.hide({
        fadeOutDuration: 400
      });
    } catch (e) {
      console.warn("Failed to hide native splash screen:", e);
    }
  }

  /**
   * Keep the splash screen open for a custom amount of time
   */
  public async show(duration = 2000): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await SplashScreen.show({
        autoHide: true,
        showDuration: duration
      });
    } catch {}
  }
}

export const splashScreenService = new SplashScreenService();
export default splashScreenService;
