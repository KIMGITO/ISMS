import { Transaction } from "../../types";
import { ReceiptContent, BusinessReceiptSettings, ReceiptItem } from "./types";
import { BarcodeService } from "./BarcodeService";
import { QRCodeService } from "./QRCodeService";
import { getShortId } from "../../utils/idUtils";

export class ReceiptGenerator {
  /**
   * Orchestrates mapping a raw transactional record and specific business config
   * into a fully processed, compliant ReceiptContent object with SVG codes.
   */
  public static async generateReceiptContent(
    tx: Transaction,
    settings: BusinessReceiptSettings,
    additionalParams?: {
      invoiceNumber?: string;
      customerEmail?: string;
      outstandingBalance?: number;
      customNotes?: string;
    }
  ): Promise<ReceiptContent> {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://isms.co.ke";
    const verificationUrl = `${origin}/verify-receipt?id=${tx.id}`;

    // 1. Generate formatted Receipt Number based on rules
    let receiptNumber = tx.id;
    const year = new Date(tx.timestamp || Date.now()).getFullYear();
    const cleanId = getShortId(tx.id);
    
    if (settings.receiptNumberFormat === "PREFIX-YYYY-INCREMENT") {
      receiptNumber = `${settings.receiptPrefix}-${year}-${cleanId}`;
    } else if (settings.receiptNumberFormat === "PREFIX-INCREMENT") {
      receiptNumber = `${settings.receiptPrefix}-${cleanId}`;
    } else if (settings.receiptNumberFormat === "INCREMENT") {
      receiptNumber = cleanId;
    }

    // 2. Map items with precise calculations
    const items: ReceiptItem[] = tx.items.map((item) => {
      const lineOrig = item.product.price * item.quantity;
      const discountPercentage = item.discountPercentage || 0;
      const discountAmount = lineOrig * (discountPercentage / 100);
      const total = lineOrig - discountAmount;

      return {
        id: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.product.price,
        discountPercentage,
        discountAmount,
        total
      };
    });


   

    // Calculations
    const subtotal = tx.total;
    const grandTotal = tx.finalTotal;

    // Determine amount actually paid (not the full total for credit sales).
    // For credit sales, the customer only paid the wallet portion (or 0 if
    // no wallet was applied). The outstanding balance is the remaining debt.
    const isCreditSale = tx.paymentMethod === 'Credit_Debt' || tx.paymentMethod === 'Credit';
    const amountPaid = isCreditSale ? 0 : tx.finalTotal;
    const changeGiven = 0.0; // pre-populated or customized

    // Outstanding balance only applies to credit sales. For any fully-paid
    // method (Cash, M-Pesa, Card, Bank, Mobile_Wallet) it must be 0 so no
    // erroneous OUTSTANDING BAL line appears on the receipt.
    const computedOutstandingBalance = isCreditSale
      ? (additionalParams?.outstandingBalance ?? tx.finalTotal)
      : 0;

    // Human-readable payment method label
    const paymentMethodLabel = (() => {
      switch (tx.paymentMethod) {
        case 'Cash': return 'Cash';
        case 'M-Pesa': return 'M-Pesa';
        case 'Card': return 'Card';
        case 'Bank': return 'Bank Transfer';
        case 'Mobile_Wallet': return 'Mobile Wallet';
        case 'Credit_Debt': return 'Credit Sale';
        case 'Credit': return 'Credit Sale';
        default: return tx.paymentMethod || 'Cash';
      }
    })();
    
    // Taxes configuration
    const taxTotal = settings.isTaxEnabled && tx.tax > 0 ? tx.tax : undefined;

    // 3. Determine QR Code content value
    let qrValue = verificationUrl;
    switch (settings.qrCodeOption) {
      case "verification_url":
        qrValue = verificationUrl;
        break;
      case "business_website":
        qrValue = settings.website ? `https://${settings.website.replace(/^https?:\/\//, "")}` : "https://isms.co.ke";
        break;
      case "payment_link":
        qrValue = `https://mpesa.co.ke/pay?business=${encodeURIComponent(settings.businessName)}&amount=${grandTotal}`;
        break;
      case "feedback_form":
        qrValue = `${origin}/feedback?receipt=${receiptNumber}`;
        break;
      case "google_review":
        qrValue = `https://search.google.com/local/writereview?q=${encodeURIComponent(settings.businessName)}`;
        break;
      case "whatsapp_chat":
        const cleanPhone = settings.phone.replace(/[\s+()]/g, "");
        qrValue = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(`Hi, checking in regarding receipt ${receiptNumber}`)}`;
        break;
      case "custom_url":
        qrValue = settings.customQrUrl || verificationUrl;
        break;
    }

    // 4. Generate SVG codes offline
    const barcodeSvg = BarcodeService.generateCode39Svg(receiptNumber, true);
    const qrCodeSvg = await QRCodeService.generateQrCodeSvg(qrValue);

    // AI suggestion (future-proofing mock as requested by prompt)
    const aiRecommendation = "AI Recommendation: Based on purchase history, customer is eligible for 10% discount on next Greek Yogurt bottle.";

    const formattedDate = this.formatDate(new Date(tx.timestamp || Date.now()), settings.dateFormat);
    const formattedTime = this.formatTime(new Date(tx.timestamp || Date.now()), settings.timeFormat);

    return {
      receiptId: tx.id,
      receiptNumber,
      invoiceNumber: additionalParams?.invoiceNumber,
      orderNumber: tx.id,
      transactionDate: formattedDate,
      transactionTime: formattedTime,
      cashierName: tx.staffName || "System POS",
      customerName: tx.customerName,
      customerPhone: undefined, // can fetch from dynamic state
      customerEmail: additionalParams?.customerEmail,
      paymentMethod: paymentMethodLabel,
      items,
      subtotal,
      taxTotal,
      overallDiscount: tx.discount > 0 ? tx.discount : undefined,
      deliveryFee: tx.isDelivery ? tx.deliveryFee : undefined,
      shippingFee: undefined,
      grandTotal,
      amountPaid: amountPaid,
      changeGiven: changeGiven,
      outstandingBalance: computedOutstandingBalance,
      customNotes: additionalParams?.customNotes || tx.note,
      verificationUrl,
      barcodeValue: barcodeSvg,
      qrCodeValue: qrCodeSvg,
      aiRecommendation
    };
  }

  private static formatDate(date: Date, format: string): string {
    if (format === "medium") {
      return date.toLocaleDateString([], { dateStyle: "medium" });
    }
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    if (format === "MM/DD/YYYY") return `${month}/${day}/${year}`;
    if (format === "YYYY-MM-DD") return `${year}-${month}-${day}`;
    return `${day}/${month}/${year}`; // DD/MM/YYYY
  }

  private static formatTime(date: Date, format: string): string {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    
    if (format === "12h") {
      const ampm = hours >= 12 ? "PM" : "AM";
      const h12 = hours % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    }
    return `${String(hours).padStart(2, "0")}:${minutes}`; // 24h
  }
}
