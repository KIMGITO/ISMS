/**
 * QRCodeService
 * 
 * Reusable, offline-first service that generates high-quality, high-contrast,
 * vector-crisp QR Codes for digital receipt verification, loyalty feedback,
 * payment gateways, and social channels.
 */

import QRCode from "qrcode";

export class QRCodeService {
  /**
   * Generates a vector SVG string for a given text value.
   * Runs completely offline and locally on Web, Android, or iOS.
   */
  public static async generateQrCodeSvg(value: string): Promise<string> {
    try {
      const svgString = await QRCode.toString(value, {
        type: "svg",
        margin: 1,
        color: {
          dark: "#0f172a", // Slate-900 for modern professional look
          light: "#ffffff", // Pure white background
        },
      });
      return svgString;
    } catch (err) {
      console.error("Failed to generate QR Code SVG:", err);
      // Fallback clean placeholder SVG
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="auto">
        <rect width="100" height="100" fill="#f1f5f9" rx="8"/>
        <text x="50" y="55" fill="#64748b" font-family="sans-serif" font-size="6" text-anchor="middle" font-weight="bold">QR CODE ERROR</text>
      </svg>`;
    }
  }

  /**
   * Generates a Data URL (base64 PNG) for a given text value,
   * which is useful for raw img source tags or PDF embeds.
   */
  public static async generateQrCodeDataUrl(value: string): Promise<string> {
    try {
      const dataUrl = await QRCode.toDataURL(value, {
        margin: 1,
        width: 256,
        color: {
          dark: "#0f172a",
          light: "#ffffff"
        }
      });
      return dataUrl;
    } catch (err) {
      console.error("Failed to generate QR Code Data URL:", err);
      return "";
    }
  }
}
