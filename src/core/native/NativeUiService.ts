// src/core/native/NativeUiService.ts
import { Dialog } from "@capacitor/dialog";
import { Toast } from "@capacitor/toast";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Clipboard } from "@capacitor/clipboard";
import { Keyboard } from "@capacitor/keyboard";
import { nativePlatformService } from "./NativePlatformService";

class NativeUiService {
  // ==========================================
  // NATIVE DIALOGS
  // ==========================================

  public async alert(title: string, message: string, buttonTitle = "OK"): Promise<void> {
    if (nativePlatformService.isNative()) {
      try {
        await Dialog.alert({ title, message, buttonTitle });
        return;
      } catch {}
    }
    window.alert(`${title}\n\n${message}`);
  }

  public async confirm(title: string, message: string, okButtonTitle = "OK", cancelButtonTitle = "Cancel"): Promise<boolean> {
    if (nativePlatformService.isNative()) {
      try {
        const res = await Dialog.confirm({ title, message, okButtonTitle, cancelButtonTitle });
        return res.value;
      } catch {}
    }
    return window.confirm(`${title}\n\n${message}`);
  }

  public async prompt(title: string, message: string, okButtonTitle = "OK", cancelButtonTitle = "Cancel", inputPlaceholder = ""): Promise<string | null> {
    if (nativePlatformService.isNative()) {
      try {
        const res = await Dialog.prompt({ title, message, okButtonTitle, cancelButtonTitle, inputPlaceholder });
        return res.cancelled ? null : res.value;
      } catch {}
    }
    return window.prompt(`${title}\n\n${message}`) || null;
  }

  // ==========================================
  // NATIVE TOASTS
  // ==========================================

  public async showToast(message: string, duration: "short" | "long" = "short"): Promise<void> {
    if (nativePlatformService.isNative()) {
      try {
        await Toast.show({ text: message, duration });
        return;
      } catch {}
    }
    console.log(`[Toast Fallback]: ${message}`);
  }

  // ==========================================
  // HAPTIC FEEDBACK
  // ==========================================

  /**
   * Subtle tap vibration feedback
   */
  public async hapticTap(): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {}
  }

  /**
   * Haptic feedback signal for success transactions
   */
  public async hapticSuccess(): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {}
  }

  /**
   * Haptic feedback signal for errors and locks
   */
  public async hapticError(): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch {}
  }

  // ==========================================
  // CLIPBOARD COPY
  // ==========================================

  public async copyToClipboard(text: string, label?: string): Promise<boolean> {
    try {
      await Clipboard.write({ string: text });
      this.hapticSuccess();
      return true;
    } catch (e) {
      console.warn("Native clipboard failure, falling back to browser API:", e);
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ==========================================
  // KEYBOARD CONTROL
  // ==========================================

  /**
   * Programmatically hide the soft keyboard
   */
  public async hideKeyboard(): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await Keyboard.hide();
    } catch {}
  }

  public onKeyboardShow(callback: (keyboardHeight: number) => void): () => void {
    if (!nativePlatformService.isNative()) return () => {};
    const listenerPromise = Keyboard.addListener("keyboardWillShow", (info) => {
      callback(info.keyboardHeight);
    });
    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }

  public onKeyboardHide(callback: () => void): () => void {
    if (!nativePlatformService.isNative()) return () => {};
    const listenerPromise = Keyboard.addListener("keyboardWillHide", () => {
      callback();
    });
    return () => {
      listenerPromise.then((h) => h.remove());
    };
  }

  // ==========================================
  // BADGES (Deprecated/Moved to community; wrapped safely)
  // ==========================================

  public setBadgeCount(count: number) {
    if (typeof navigator !== "undefined" && "setAppBadge" in navigator) {
      try {
        (navigator as any).setAppBadge(count);
      } catch {}
    }
  }

  public clearBadgeCount() {
    if (typeof navigator !== "undefined" && "clearAppBadge" in navigator) {
      try {
        (navigator as any).clearAppBadge();
      } catch {}
    }
  }
}

export const nativeUiService = new NativeUiService();
export default nativeUiService;
