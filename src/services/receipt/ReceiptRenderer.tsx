import React from "react";
import { ReceiptContent, BusinessReceiptSettings } from "./types";
import { ReceiptTemplateManager } from "./ReceiptTemplateManager";

interface ReceiptRendererProps {
  content: ReceiptContent;
  settings: BusinessReceiptSettings;
}

/**
 * ReceiptRenderer
 * 
 * Production-ready visual renderer component that handles styling, adaptations, 
 * paper width adjustments, dark mode adaptions (always outputting black-on-white 
 * for printer clarity), and outputs correct JSX elements.
 */
export function ReceiptRenderer({ content, settings }: ReceiptRendererProps) {
  const TemplateComponent = ReceiptTemplateManager.getTemplate(settings.templateType);

  return (
    <div className="bg-white rounded-3xl p-1 shadow-inner border border-slate-200/40 flex justify-center overflow-x-auto min-h-[380px] w-full">
      <div className="bg-white text-slate-950 p-2 rounded-2xl flex justify-center items-start w-full">
        {/* Force always black on white for printer styling inside container */}
        <div className="print-receipt-container">
          <TemplateComponent content={content} settings={settings} />
        </div>
      </div>
    </div>
  );
}

export class ReceiptRendererService {
  /**
   * Generates raw plain-text thermal-printer-compatible output (ideal for 58mm/80mm ESC/POS hardware)
   */
  public static generateThermalRawText(content: ReceiptContent, settings: BusinessReceiptSettings): string {
    const is58 = settings.paperWidth === "58mm";
    const colWidth = is58 ? 32 : 42;
    
    const center = (text: string) => {
      const pad = Math.max(0, Math.floor((colWidth - text.length) / 2));
      return " ".repeat(pad) + text;
    };

    const leftRight = (left: string, right: string) => {
      const spaceCount = Math.max(1, colWidth - (left.length + right.length));
      return left + " ".repeat(spaceCount) + right;
    };

    const separator = "-".repeat(colWidth);
    const doubleSeparator = "=".repeat(colWidth);

    let output = "";
    output += center(settings.businessName.toUpperCase()) + "\n";
    if (settings.headerMessage) {
      output += center(`"${settings.headerMessage}"`) + "\n";
    }
    output += center(settings.address) + "\n";
    output += center(`Tel: ${settings.phone}`) + "\n";
    if (settings.pinNumber) {
      output += center(`KRA PIN: ${settings.pinNumber}`) + "\n";
    }
    
    output += doubleSeparator + "\n";
    output += leftRight("TX ID:", content.receiptNumber) + "\n";
    output += leftRight("DATE:", `${content.transactionDate} ${content.transactionTime}`) + "\n";
    output += leftRight("OPERATOR:", content.cashierName) + "\n";
    output += leftRight("PAYMENT:", content.paymentMethod) + "\n";
    
    if (content.customerName) {
      output += leftRight("PATRON:", content.customerName) + "\n";
    }
    
    output += separator + "\n";
    output += leftRight("ITEM (QTY)", "TOTAL") + "\n";
    output += separator + "\n";
    
    content.items.forEach((item) => {
      output += `${item.name.substring(0, colWidth - 10)}\n`;
      const qtyStr = `  x${item.quantity} @ ${item.unitPrice}`;
      const totStr = `${settings.currencyFormat} ${item.total.toFixed(2)}`;
      output += leftRight(qtyStr, totStr) + "\n";
    });
    
    output += separator + "\n";
    output += leftRight("SUBTOTAL", `${settings.currencyFormat} ${content.subtotal.toFixed(2)}`) + "\n";
    
    if (content.overallDiscount) {
      output += leftRight("DISCOUNT", `-${settings.currencyFormat} ${content.overallDiscount.toFixed(2)}`) + "\n";
    }
    
    if (settings.isTaxEnabled && content.taxTotal) {
      output += leftRight(`VAT (${settings.taxPercentage}%)`, `${settings.currencyFormat} ${content.taxTotal.toFixed(2)}`) + "\n";
    }
    
    if (content.deliveryFee) {
      output += leftRight("DELIVERY", `+${settings.currencyFormat} ${content.deliveryFee.toFixed(2)}`) + "\n";
    }
    
    output += doubleSeparator + "\n";
    output += leftRight("GRAND TOTAL", `${settings.currencyFormat} ${content.grandTotal.toFixed(2)}`) + "\n";
    output += leftRight("PAID", `${settings.currencyFormat} ${content.amountPaid.toFixed(2)}`) + "\n";
    output += leftRight("CHANGE", `${settings.currencyFormat} ${content.changeGiven.toFixed(2)}`) + "\n";
    
    if (content.outstandingBalance) {
      output += leftRight("OUTSTANDING BAL", `${settings.currencyFormat} ${content.outstandingBalance.toFixed(2)}`) + "\n";
    }
    
    output += separator + "\n";
    output += center(settings.thankYouMessage || "Thank you!") + "\n";
    output += center(settings.footerMessage || "Have a dairy-good day!") + "\n";
    if (settings.returnPolicy) {
      output += center(`Policy: ${settings.returnPolicy.substring(0, colWidth - 8)}`) + "\n";
    }
    output += center("------------------------") + "\n";
    output += center(`*${content.receiptNumber}*`) + "\n";
    
    return output;
  }
}
