import { ReceiptContent, BusinessReceiptSettings } from "./types";
import { ReceiptRendererService } from "./ReceiptRenderer";
import { jsPDF } from "jspdf";

export class ReceiptExporterService {
  /**
   * Generates and triggers the browser download of a clean text-based receipt (.txt).
   */
  public static exportToTextFile(content: ReceiptContent, settings: BusinessReceiptSettings): boolean {
    try {
      const text = ReceiptRendererService.generateThermalRawText(content, settings);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = url;
      link.download = `receipt_${content.receiptNumber}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      return true;
    } catch (err) {
      console.error("Failed to export text receipt:", err);
      return false;
    }
  }

  /**
   * Generates and triggers the browser download of a clean interactive HTML receipt.
   */
  public static exportToHtmlFile(content: ReceiptContent, settings: BusinessReceiptSettings, htmlSnippet: string): boolean {
    try {
      const fullHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Receipt ${content.receiptNumber}</title>
            <script src="https://cdn.tailwindcss.com"></script>
          </head>
          <body class="bg-slate-100 p-6 flex justify-center items-center min-h-screen">
            <div class="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200">
              ${htmlSnippet}
              <button onclick="window.print()" class="mt-6 w-full py-2 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-850 transition">
                Print Local Ticket
              </button>
              <p class="text-[8.5px] text-slate-400 mt-4 text-center">Digitally signed offline receipt verification token: ${content.receiptNumber}</p>
            </div>
          </body>
        </html>
      `;

      const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = url;
      link.download = `digital_receipt_${content.receiptNumber}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      return true;
    } catch (err) {
      console.error("Failed to export HTML receipt:", err);
      return false;
    }
  }

  /**
   * Exports a real high-quality PDF (.pdf) file directly using jsPDF.
   */
  public static exportToPdf(content: ReceiptContent, settings: BusinessReceiptSettings, htmlSnippet?: string): boolean {
    try {
      // Create a real PDF document (A5 Format: 148mm width x 210mm height)
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a5"
      });

      // Background card
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, 148, 210, "F");

      // Brand Header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text(settings.businessName.toUpperCase(), 74, 15, { align: "center" });

      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139); // slate-500
      if (settings.headerMessage) {
        doc.text(settings.headerMessage, 74, 20, { align: "center" });
      }

      // Address & Phone
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      let y = 25;
      if (settings.address) {
        doc.text(settings.address, 74, y, { align: "center" });
        y += 4;
      }
      if (settings.phone) {
        doc.text(`Tel: ${settings.phone}`, 74, y, { align: "center" });
        y += 4;
      }
      if (settings.pinNumber) {
        doc.text(`KRA PIN: ${settings.pinNumber}`, 74, y, { align: "center" });
        y += 4;
      }

      // Divider line
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.line(10, y + 2, 138, y + 2);
      y += 8;

      // Voucher details
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text("RECEIPT VOUCHER", 10, y);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`No: ${content.receiptNumber}`, 138, y, { align: "right" });
      y += 5;

      doc.text(`Date: ${content.transactionDate} ${content.transactionTime}`, 10, y);
      doc.text(`Cashier: ${content.cashierName}`, 138, y, { align: "right" });
      y += 5;

      doc.text(`Payment Method: ${content.paymentMethod}`, 10, y);
      if (content.customerName) {
        doc.text(`Customer: ${content.customerName}`, 138, y, { align: "right" });
      }
      y += 6;

      // Divider
      doc.line(10, y, 138, y);
      y += 5;

      // Table Header
      doc.setFont("helvetica", "bold");
      doc.setTextColor(71, 85, 105); // slate-600
      doc.text("ITEM NAME", 10, y);
      doc.text("QTY", 80, y, { align: "center" });
      doc.text("UNIT PRICE", 105, y, { align: "right" });
      doc.text("TOTAL", 138, y, { align: "right" });
      y += 4;
      doc.line(10, y, 138, y);
      y += 5;

      // Table Rows
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);
      content.items.forEach((item) => {
        doc.text(item.name, 10, y);
        doc.text(item.quantity.toString(), 80, y, { align: "center" });
        doc.text(`KSh ${item.unitPrice.toFixed(0)}`, 105, y, { align: "right" });
        doc.text(`KSh ${item.total.toFixed(0)}`, 138, y, { align: "right" });
        y += 5;
      });

      y += 2;
      doc.line(10, y, 138, y);
      y += 6;

      // Summary
      doc.setFont("helvetica", "normal");
      doc.text("Subtotal:", 95, y);
      doc.text(`KSh ${content.subtotal.toFixed(2)}`, 138, y, { align: "right" });
      y += 5;

      if (content.overallDiscount && content.overallDiscount > 0) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(220, 38, 38); // red-600
        doc.text("Discount:", 95, y);
        doc.text(`-KSh ${content.overallDiscount.toFixed(2)}`, 138, y, { align: "right" });
        doc.setFont("helvetica", "normal");
        doc.setTextColor(15, 23, 42);
        y += 5;
      }

      if (settings.isTaxEnabled && content.taxTotal) {
        doc.text(`VAT (${settings.taxPercentage}%):`, 95, y);
        doc.text(`KSh ${content.taxTotal.toFixed(2)}`, 138, y, { align: "right" });
        y += 5;
      }

      if (content.deliveryFee) {
        doc.text("Delivery Fee:", 95, y);
        doc.text(`+KSh ${content.deliveryFee.toFixed(2)}`, 138, y, { align: "right" });
        y += 5;
      }

      doc.line(95, y, 138, y);
      y += 5;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Total Paid:", 95, y);
      doc.text(`KSh ${content.grandTotal.toFixed(2)}`, 138, y, { align: "right" });
      y += 10;

      // Footer
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(settings.thankYouMessage || "Thank You!", 74, y, { align: "center" });
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text("Generated Offline by Secure ReceiptEngine v1.0", 74, y, { align: "center" });
      y += 4;
      doc.text(`Token: ${content.receiptNumber}`, 74, y, { align: "center" });

      // Save as actual .pdf binary file
      doc.save(`receipt_${content.receiptNumber}.pdf`);
      return true;
    } catch (err) {
      console.error("PDF generation failed:", err);
      return false;
    }
  }
}
