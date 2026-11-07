// src/utils/fileExport.ts
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { nativePlatformService } from "../core/native/NativePlatformService";

export interface ExportOptions {
  filename: string;
  mimeType: string;
  data: string | ArrayBuffer | Blob;
}

export interface ExportResult {
  success: boolean;
  error?: string;
}

/**
 * Platform-aware file export utility.
 * - Web: Uses browser download APIs
 * - Android/iOS: Uses Capacitor Filesystem + Share
 */
export class FileExportService {
  /**
   * Export a file with platform-specific handling
   */
  public async exportFile(options: ExportOptions): Promise<ExportResult> {
    try {
      if (nativePlatformService.isNative()) {
        return await this.exportNative(options);
      } else {
        return await this.exportWeb(options);
      }
    } catch (error) {
      console.error("File export failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during file export"
      };
    }
  }

  /**
   * Export PDF from jsPDF document
   */
  public async exportPdf(
    doc: any, // jsPDF instance
    filename: string
  ): Promise<ExportResult> {
    try {
      if (nativePlatformService.isNative()) {
        // Get PDF as ArrayBuffer for native platforms
        const pdfArrayBuffer = doc.output("arraybuffer");
        return await this.exportFile({
          filename,
          mimeType: "application/pdf",
          data: pdfArrayBuffer
        });
      } else {
        // Web: use jsPDF's built-in save
        doc.save(filename);
        return { success: true };
      }
    } catch (error) {
      console.error("PDF export failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate PDF"
      };
    }
  }

  /**
   * Export text file
   */
  public async exportText(
    content: string,
    filename: string
  ): Promise<ExportResult> {
    return this.exportFile({
      filename,
      mimeType: "text/plain",
      data: content
    });
  }

  /**
   * Export CSV file
   */
  public async exportCsv(
    content: string,
    filename: string
  ): Promise<ExportResult> {
    return this.exportFile({
      filename,
      mimeType: "text/csv",
      data: content
    });
  }

  /**
   * Export HTML file
   */
  public async exportHtml(
    content: string,
    filename: string
  ): Promise<ExportResult> {
    return this.exportFile({
      filename,
      mimeType: "text/html",
      data: content
    });
  }

  /**
   * Web platform export using browser download APIs
   */
  private async exportWeb(options: ExportOptions): Promise<ExportResult> {
    try {
      const blob = options.data instanceof Blob 
        ? options.data 
        : new Blob([options.data], { type: options.mimeType });
      
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = url;
      link.download = options.filename;
      document.body.appendChild(link);
      link.click();
      
      // Cleanup after a short delay
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);

      return { success: true };
    } catch (error) {
      console.error("Web export failed:", error);
      return {
        success: false,
        error: "Failed to download file in browser"
      };
    }
  }

  /**
   * Native platform export using Capacitor Filesystem + Share
   */
  private async exportNative(options: ExportOptions): Promise<ExportResult> {
    try {
      // Binary data is written as base64 with no encoding; plain text is written as UTF-8.
      // (Writing base64 with UTF-8 encoding stores the base64 text itself and breaks PDFs.)
      let fileData: string;
      let encoding: Encoding | undefined;

      if (typeof options.data === "string") {
        if (options.data.startsWith("data:")) {
          fileData = options.data.split(",")[1];
        } else {
          fileData = options.data;
          encoding = Encoding.UTF8;
        }
      } else if (options.data instanceof Blob) {
        fileData = this.arrayBufferToBase64(await options.data.arrayBuffer());
      } else {
        fileData = this.arrayBufferToBase64(options.data);
      }

      const filename = this.ensureExtension(options.filename, options.mimeType);

      // The cache folder is covered by the app's FileProvider, so other apps can open the file.
      const writeResult = await Filesystem.writeFile({
        path: `exports/${filename}`,
        data: fileData,
        directory: Directory.Cache,
        ...(encoding ? { encoding } : {}),
        recursive: true
      });

      let shareResult = true;
      try {
        await Share.share({ title: filename, files: [writeResult.uri], dialogTitle: `Share ${filename}` });
      } catch (err: any) {
        shareResult = false;
        if (!/cancel/i.test(String(err?.message))) console.error("Native file share failed:", err);
      }

      if (!shareResult) {
        // File was saved but sharing was cancelled/failed
        return {
          success: true,
          error: "File saved but sharing was cancelled"
        };
      }

      return { success: true };
    } catch (error) {
      console.error("Native export failed:", error);
      throw error; // Let the caller handle the error
    }
  }

  /**
   * Ensure filename has the correct extension based on MIME type
   */
  private ensureExtension(filename: string, mimeType: string): string {
    const extensionMap: Record<string, string> = {
      "application/pdf": ".pdf",
      "text/plain": ".txt",
      "text/csv": ".csv",
      "text/html": ".html"
    };

    const expectedExtension = extensionMap[mimeType];
    if (!expectedExtension) return filename;

    // Check if filename already has the correct extension
    if (filename.toLowerCase().endsWith(expectedExtension)) {
      return filename;
    }

    // Add the extension
    return filename + expectedExtension;
  }

  /**
   * Convert ArrayBuffer to base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return window.btoa(binary);
  }
}

export const fileExportService = new FileExportService();
export default fileExportService;