// src/core/native/NativePlatformService.ts
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

export type PlatformType = "android" | "ios" | "web";

class NativePlatformService {
  private platform: PlatformType = "web";

  constructor() {
    this.detectPlatform();
  }

  private detectPlatform() {
    const rawPlatform = Capacitor.getPlatform();
    if (rawPlatform === "android" || rawPlatform === "ios") {
      this.platform = rawPlatform;
    } else {
      this.platform = "web";
    }
  }

  public getPlatform(): PlatformType {
    return this.platform;
  }

  public isNative(): boolean {
    return this.platform !== "web";
  }

  public isAndroid(): boolean {
    return this.platform === "android";
  }

  public isIos(): boolean {
    return this.platform === "ios";
  }

  /**
   * Listen for when the application goes to the background / pauses
   */
  public onAppPause(callback: () => void): () => void {
    if (!this.isNative()) return () => {};
    const listenerPromise = App.addListener("appStateChange", (state) => {
      if (!state.isActive) {
        callback();
      }
    });

    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }

  /**
   * Listen for when the application resumes to the foreground
   */
  public onAppResume(callback: () => void): () => void {
    if (!this.isNative()) return () => {};
    const listenerPromise = App.addListener("appStateChange", (state) => {
      if (state.isActive) {
        callback();
      }
    });

    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }

  /**
   * Register a custom back-button handler (Android only)
   */
  public onBackButton(callback: (canExit: boolean) => void): () => void {
    if (!this.isAndroid()) return () => {};
    const listenerPromise = App.addListener("backButton", (data) => {
      callback(data.canGoBack);
    });

    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }

  /**
   * Minimize or exit the application
   */
  public exitApp(): void {
    if (this.isNative()) {
      App.exitApp();
    } else {
      console.log("exitApp called on web - noop");
    }
  }

  /**
   * Register handlers for deep links / app URL routing open events
   */
  public onDeepLinkReceived(callback: (url: string) => void): () => void {
    if (!this.isNative()) return () => {};
    const listenerPromise = App.addListener("appUrlOpen", (data) => {
      if (data.url) {
        callback(data.url);
      }
    });

    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }
}

export const nativePlatformService = new NativePlatformService();
export default nativePlatformService;
