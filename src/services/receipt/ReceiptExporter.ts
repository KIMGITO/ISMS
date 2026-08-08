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
   * Generates and triggers the browser download of a modern, authentic-feeling
   * interactive HTML receipt (thermal-paper styling: monospace, dashed rules,
   * torn/zigzag bottom edge).
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
            <style>
              @media print {
                body { background: white !important; }
                .receipt-shell { box-shadow: none !important; }
                .no-print { display: none !important; }
              }
              .receipt-shell {
                font-family: 'Courier New', ui-monospace, monospace;
                background: #fffdf8;
                position: relative;
              }
              .receipt-shell::after {
                content: "";
                position: absolute;
                left: 0; right: 0; bottom: -10px;
                height: 20px;
                background:
                  linear-gradient(-45deg, #fffdf8 8px, transparent 0),
                  linear-gradient(45deg, #fffdf8 8px, transparent 0);
                background-size: 16px 20px;
                background-repeat: repeat-x;
                filter: drop-shadow(0 2px 1px rgba(0,0,0,0.08));
              }
              .dashed-rule {
                border-top: 1.5px dashed #cbd5e1;
              }
            </style>
          </head>
          <body class="bg-slate-200 p-6 flex justify-center items-start min-h-screen">
            <div class="receipt-shell p-6 pb-8 rounded-sm shadow-lg w-full max-w-[340px] border border-slate-200 text-slate-800 text-[13px] leading-snug">
              ${htmlSnippet}
              <button onclick="window.print()" class="no-print mt-6 w-full py-2 bg-slate-900 text-white font-bold text-xs tracking-wide rounded-md hover:bg-slate-800 transition">
                PRINT RECEIPT
              </button>
              <p class="no-print text-[8.5px] text-slate-400 mt-4 text-center tracking-widest">
                *** ${content.receiptNumber} ***
              </p>
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
   * Pre-measures the exact rendered height of the receipt using the SAME
   * font/size/splitTextToSize calls the real render pass uses. This is what
   * guarantees every item actually fits on the page — jsPDF does not
   * auto-paginate, so an inaccurate estimate silently clips content.
   */
  private static measurePdfHeight(
    content: ReceiptContent,
    settings: BusinessReceiptSettings,
    pageWidth: number,
    margin: number
  ): number {
    const printableWidth = pageWidth - margin * 2;
    // A throwaway doc used only for font-metric measurement (page size here
    // doesn't matter, only the font metrics do).
    const m = new jsPDF({ unit: "mm", format: [pageWidth, 1000] });

    let h = 8; // top margin, matches render start

    m.setFont("courier", "bold");
    m.setFontSize(11);
    const titleLines = m.splitTextToSize(settings.businessName.toUpperCase(), printableWidth);
    h += titleLines.length * 5;

    m.setFont("courier", "normal");
    m.setFontSize(8);
    if (settings.headerMessage) {
      h += m.splitTextToSize(settings.headerMessage, printableWidth).length * 3.5;
    }
    if (settings.address) {
      h += m.splitTextToSize(settings.address, printableWidth).length * 3.5;
    }
    if (settings.phone) h += 4;
    if (settings.pinNumber) h += 4;
    h += 3; // divider

    // transaction info: receipt, date, cashier, payment
    h += 4 * 4;
    if (content.customerName) h += 4;
    h += 3; // divider

    h += 5; // "ITEMS" section header

    m.setFontSize(8);
    content.items.forEach((item) => {
      h += 3; // divider above each item
      const nameLines = m.splitTextToSize(item.name || "Unknown Item", printableWidth);
      h += nameLines.length * 4;
      h += 5; // qty x price / total line
    });

    h += 3; // divider before totals
    h += 4; // subtotal
    if (content.overallDiscount > 0) h += 4;
    if (settings.isTaxEnabled && content.taxTotal > 0) h += 4;
    if (content.deliveryFee > 0) h += 4;
    h += 3; // divider
    h += 7; // grand total line
    h += 3; // divider

    // Outstanding balance (credit sales only)
    if (content.outstandingBalance !== undefined && content.outstandingBalance > 0) {
      h += 4; // outstanding balance line
      h += 3; // divider
    }

    m.setFontSize(8);
    const thanks = settings.thankYouMessage || "Thank you for your business";
    h += m.splitTextToSize(thanks, printableWidth).length * 4;
    h += 6; // verification line
    h += 16; // bottom margin + zigzag tear edge clearance

    return h;
  }

  /**
   * Exports an authentic 80mm thermal-style POS receipt PDF with Courier
   * monospaced font, dashed rules, a torn/zigzag tear edge, and an explicit
   * product item breakdown. Page height is computed from a real measurement
   * pass so every item is guaranteed to render (nothing gets clipped).
   */
  public static exportToPdf(content: ReceiptContent, settings: BusinessReceiptSettings): boolean {
    try {
      const pageWidth = 80;
      const margin = 4;
      const printableWidth = pageWidth - margin * 2;

      const currency = "KSh";
      

      const formatAmount = (value: number = 0) =>
        `${currency} ${value.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

      // Accurate height, not a character-count guess.
      const estimatedHeight = this.measurePdfHeight(content, settings, pageWidth, margin);

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [pageWidth, Math.max(estimatedHeight, 180)],
      });

      let y = 8;

      const divider = (dashed = true) => {
        doc.setDrawColor(170);
        if (dashed) {
          // @ts-ignore - setLineDashPattern exists on jsPDF instances
          doc.setLineDashPattern([0.6, 0.6], 0);
        }
        doc.line(margin, y, pageWidth - margin, y);
        // @ts-ignore
        doc.setLineDashPattern([], 0);
        y += 3;
      };

      const addLine = (label: string, value: string, bold = false) => {
        doc.setFont("courier", bold ? "bold" : "normal");
        doc.text(label, margin, y);
        doc.text(value, pageWidth - margin, y, { align: "right" });
        y += 4;
      };

      // ==========================
      // HEADER
      // ==========================
      doc.setFont("courier", "bold");
      doc.setFontSize(11);

      const titleLines = doc.splitTextToSize(settings.businessName.toUpperCase(), printableWidth);
      doc.text(titleLines, pageWidth / 2, y, { align: "center" });
      y += titleLines.length * 5;

      doc.setFont("courier", "normal");
      doc.setFontSize(8);

      if (settings.headerMessage) {
        const lines = doc.splitTextToSize(settings.headerMessage, printableWidth);
        doc.text(lines, pageWidth / 2, y, { align: "center" });
        y += lines.length * 3.5;
      }

      if (settings.address) {
        const lines = doc.splitTextToSize(settings.address, printableWidth);
        doc.text(lines, pageWidth / 2, y, { align: "center" });
        y += lines.length * 3.5;
      }

      if (settings.phone) {
        doc.text(`Tel: ${settings.phone}`, pageWidth / 2, y, { align: "center" });
        y += 4;
      }

      if (settings.pinNumber) {
        doc.text(`PIN: ${settings.pinNumber}`, pageWidth / 2, y, { align: "center" });
        y += 4;
      }

      divider();

      // ==========================
      // TRANSACTION INFO
      // ==========================
      addLine("Receipt", content.receiptNumber, true);
      addLine("Date", `${content.transactionDate} ${content.transactionTime}`);
      addLine("Cashier", content.cashierName || "-");
      addLine("Payment", content.paymentMethod || "-");

      if (content.customerName) {
        addLine("Customer", content.customerName);
      }

      divider();

      // ==========================
      // ITEMS — every item in content.items is rendered; height was
      // pre-measured above so nothing runs off the page.
      // ==========================
      doc.setFont("courier", "bold");
      doc.setFontSize(9);
      doc.text("ITEMS", margin, y);
      y += 5;

      content.items.forEach((item) => {
        divider();

        doc.setFont("courier", "bold");
        doc.setFontSize(8);
        const nameLines = doc.splitTextToSize(item.name || "Unknown Item", printableWidth);
        doc.text(nameLines, margin, y);
        y += nameLines.length * 4;

        doc.setFont("courier", "normal");
        doc.setFontSize(7.5);
        doc.text(`${item.quantity} x ${formatAmount(item.unitPrice)}`, margin, y);
        doc.setFont("courier", "bold");
        doc.text(formatAmount(item.total), pageWidth - margin, y, { align: "right" });
        y += 5;
      });

      divider();

      // ==========================
      // TOTALS
      // ==========================
      addLine("Subtotal", formatAmount(content.subtotal));

      if (content.overallDiscount > 0) {
        addLine("Discount", "-" + formatAmount(content.overallDiscount));
      }

      if (settings.isTaxEnabled && content.taxTotal > 0) {
        addLine(`VAT ${settings.taxPercentage}%`, formatAmount(content.taxTotal));
      }

      if (content.deliveryFee > 0) {
        addLine("Delivery", formatAmount(content.deliveryFee));
      }

      divider(false);

      doc.setFont("courier", "bold");
      doc.setFontSize(10);
      doc.text("TOTAL", margin, y);
      doc.text(formatAmount(content.grandTotal), pageWidth - margin, y, { align: "right" });
      y += 7;

      divider();

      // ==========================
      // OUTSTANDING BALANCE (credit sales only)
      // ==========================
      if (content.outstandingBalance !== undefined && content.outstandingBalance > 0) {
        doc.setFont("courier", "bold");
        doc.setFontSize(9);
        doc.setTextColor(220, 38, 38); // red
        doc.text("OUTSTANDING BAL", margin, y);
        doc.text(formatAmount(content.outstandingBalance), pageWidth - margin, y, { align: "right" });
        doc.setTextColor(0, 0, 0); // reset to black
        y += 4;

        divider();
      }

      // ==========================
      // FOOTER
      // ==========================
      doc.setFont("courier", "normal");
      doc.setFontSize(8);

      const thanks = settings.thankYouMessage || "Thank you for your business";
      const thanksLines = doc.splitTextToSize(thanks, printableWidth);
      doc.text(thanksLines, pageWidth / 2, y, { align: "center" });
      y += thanksLines.length * 4;

      doc.setFontSize(7);
      doc.text(`Verification: ${content.receiptNumber}`, pageWidth / 2, y, { align: "center" });
      y += 6;

      // Torn/zigzag tear edge for an authentic thermal-paper feel.
      const zig = 3;
      doc.setDrawColor(190);
      for (let x = 0; x < pageWidth; x += zig) {
        doc.line(x, y, x + zig / 2, y + 1.6);
        doc.line(x + zig / 2, y + 1.6, x + zig, y);
      }

      doc.save(`receipt_${content.receiptNumber}.pdf`);

      return true;
    } catch (err) {
      console.error("PDF Export Error:", err);
      return false;
    }
  }
}