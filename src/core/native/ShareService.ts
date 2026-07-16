// src/core/native/ShareService.ts
import { Share } from "@capacitor/share";
import { nativePlatformService } from "./NativePlatformService";

export interface ShareOptions {
  title?: string;
  text?: string;
  url?: string;
  dialogTitle?: string;
}

class ShareService {
  /**
   * Share content using native OS share sheets or Web Share API fallback.
   */
  public async shareContent(options: ShareOptions): Promise<boolean> {
    const isShareSupported = typeof navigator !== "undefined" && "share" in navigator;
    
    if (nativePlatformService.isNative() || isShareSupported) {
      try {
        await Share.share({
          title: options.title || "KayKay's Milk",
          text: options.text || "",
          url: options.url,
          dialogTitle: options.dialogTitle || "Share Item"
        });
        return true;
      } catch (e: any) {
        // Log cancelations as success/handled, actual failures fall back
        if (e.message?.includes("Share canceled")) {
          return true;
        }
        console.error("Native sharing failure:", e);
      }
    }

    // Secondary fallback (Log to console or alert if not supported on browser context)
    console.log("Sharing is not supported on this platform. Content:", options);
    return false;
  }
}

export const shareService = new ShareService();
export default shareService;
