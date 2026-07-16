// src/core/native/CameraService.ts
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { nativePlatformService } from "./NativePlatformService";

class CameraService {
  /**
   * Request native camera access and take a picture.
   * Returns a base64 encoded data URI or empty string on cancel/error.
   */
  public async takePhoto(): Promise<string> {
    if (!nativePlatformService.isNative()) {
      return this.takePhotoWeb();
    }

    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera
      });

      return image.base64String ? `data:image/jpeg;base64,${image.base64String}` : "";
    } catch (e) {
      console.warn("Failed capturing native camera photo:", e);
      return "";
    }
  }

  /**
   * Choose an image from the device's native photo gallery
   */
  public async chooseFromGallery(): Promise<string> {
    if (!nativePlatformService.isNative()) {
      return this.chooseFromGalleryWeb();
    }

    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos
      });

      return image.base64String ? `data:image/jpeg;base64,${image.base64String}` : "";
    } catch (e) {
      console.warn("Failed choosing gallery photo:", e);
      return "";
    }
  }

  private async takePhotoWeb(): Promise<string> {
    // Falls back to file input choice since camera stream capturing requires complex canvas overlays on pure web
    return this.chooseFromGalleryWeb();
  }

  private async chooseFromGalleryWeb(): Promise<string> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = (event: any) => {
        const file = event.target.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string || "");
          reader.onerror = () => resolve("");
          reader.readAsDataURL(file);
        } else {
          resolve("");
        }
      };
      input.click();
    });
  }
}

export const cameraService = new CameraService();
export default cameraService;
