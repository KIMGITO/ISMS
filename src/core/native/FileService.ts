// src/core/native/FileService.ts
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { nativePlatformService } from "./NativePlatformService";

class FileService {
  /**
   * Save a binary or string file to local app storage.
   * Returns the file absolute path URL.
   */
  public async saveFile(
    filename: string,
    data: string | Blob | ArrayBuffer,
    mimeType = "application/octet-stream"
  ): Promise<string> {
    if (!nativePlatformService.isNative()) {
      return this.saveFileWeb(filename, data, mimeType);
    }

    try {
      let base64String = "";
      if (typeof data === "string") {
        // If already base64 encoded data URI
        if (data.startsWith("data:")) {
          base64String = data.split(",")[1];
        } else {
          base64String = window.btoa(data);
        }
      } else {
        const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
        base64String = this.arrayBufferToBase64(buffer);
      }

      const result = await Filesystem.writeFile({
        path: filename,
        data: base64String,
        directory: Directory.Documents
      });

      return result.uri;
    } catch (e) {
      console.error("Native write file operation failed:", e);
      throw e;
    }
  }

  /**
   * Read file contents from local Documents folder.
   */
  public async readFile(filename: string): Promise<string> {
    if (!nativePlatformService.isNative()) {
      throw new Error("Local filesystem reads are unsupported on Web mode");
    }

    try {
      const result = await Filesystem.readFile({
        path: filename,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });
      return result.data as string;
    } catch (e) {
      console.error(`Native read file ${filename} failed:`, e);
      throw e;
    }
  }

  /**
   * Delete a file from local Documents folder.
   */
  public async deleteFile(filename: string): Promise<void> {
    if (!nativePlatformService.isNative()) return;
    try {
      await Filesystem.deleteFile({
        path: filename,
        directory: Directory.Documents
      });
    } catch (e) {
      console.warn(`Native delete file ${filename} failed:`, e);
    }
  }

  /**
   * Abstract native file selection for documents (CSV, Excel, PDF)
   */
  public async pickDocument(acceptTypes = "*/*"): Promise<{ name: string; content: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = acceptTypes;
      input.onchange = (event: any) => {
        const file = event.target.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve({
              name: file.name,
              content: e.target?.result as string || ""
            });
          };
          reader.onerror = () => resolve(null);
          reader.readAsText(file);
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  }

  private saveFileWeb(filename: string, data: any, mimeType: string): string {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    return url;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

export const fileService = new FileService();
export default fileService;
