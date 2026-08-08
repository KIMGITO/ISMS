// src/utils/fileExport.ts
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { nativePlatformService } from "../core/native/NativePlatformService";
import { shareService } from "../core/native/ShareService";

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
      // Convert data to base64
      let base64Data: string;
      
      if (typeof options.data === "string") {
        // If it's already a data URI, extract the base64 part
        if (options.data.startsWith("data:")) {
          base64Data = options.data.split(",")[1];
        } else {
          // Encode string to base64
          base64Data = this.stringToBase64(options.data);
        }
      } else if (options.data instanceof Blob) {
        const arrayBuffer = await options.data.arrayBuffer();
        base64Data = this.arrayBufferToBase64(arrayBuffer);
      } else {
        // ArrayBuffer
        base64Data = this.arrayBufferToBase64(options.data);
      }

      // Ensure filename has correct extension
      const filename = this.ensureExtension(options.filename, options.mimeType);

      // Write file to Documents directory
      const writeResult = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true
      });

      console.log("File saved successfully:", writeResult.uri);

      // Share the file
      const shareResult = await shareService.shareContent({
        title: options.filename,
        url: writeResult.uri,
        dialogTitle: `Share ${options.filename}`
      });

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
   * Convert string to base64
   */
  private stringToBase64(str: string): string {
    try {
      // For UTF-8 strings, we need to handle them properly
      const utf8Bytes = new TextEncoder().encode(str);
      return this.arrayBufferToBase64(utf8Bytes.buffer);
    } catch (error) {
      // Fallback for older browsers
      return window.btoa(unescape(encodeURIComponent(str)));
    }
  }

  /**
   * Convert ArrayBuffer to base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    let binary = "";
    
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    return window.btoa(binary);
  }
}

export const fileExportService = new FileExportService();
export default fileExportService;