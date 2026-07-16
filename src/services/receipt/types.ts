export type PaperWidth = "58mm" | "80mm" | "A4";

export type QRCodeContentOption = 
  | "verification_url"
  | "business_website"
  | "payment_link"
  | "feedback_form"
  | "google_review"
  | "whatsapp_chat"
  | "custom_url";

export type ReceiptTemplateType = 
  | "classic"
  | "modern"
  | "compact"
  | "retail"
  | "milk_shop";

export interface BusinessReceiptSettings {
  logoUrl: string;
  businessName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  pinNumber: string; // KRA PIN or local tax ID
  registrationNumber: string;
  socialMedia: string;
  headerMessage: string;
  footerMessage: string;
  termsAndConditions: string;
  returnPolicy: string;
  thankYouMessage: string;
  receiptPrefix: string;
  receiptNumberFormat: "PREFIX-INCREMENT" | "PREFIX-YYYY-INCREMENT" | "INCREMENT";
  paperWidth: PaperWidth;
  currencyFormat: "KSh" | "$" | "€" | "£" | "UGX" | "TZS";
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "medium";
  timeFormat: "12h" | "24h";
  isTaxEnabled: boolean;
  taxPercentage: number;
  qrCodeOption: QRCodeContentOption;
  customQrUrl: string;
  templateType: ReceiptTemplateType;
  showAiRecommendation?: boolean;
}

export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number; // per item cash discount
  discountPercentage?: number; // per item percentage
  taxAmount?: number;
  total: number;
}

export interface ReceiptContent {
  receiptId: string;
  receiptNumber: string;
  invoiceNumber?: string;
  orderNumber?: string;
  transactionDate: string;
  transactionTime: string;
  cashierName: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  paymentMethod: string;
  items: ReceiptItem[];
  subtotal: number;
  taxTotal?: number;
  overallDiscount?: number;
  shippingFee?: number;
  deliveryFee?: number;
  grandTotal: number;
  amountPaid: number;
  changeGiven: number;
  outstandingBalance?: number;
  customNotes?: string;
  verificationUrl: string;
  barcodeValue: string; // The encoded value (e.g. receipt ID or URL)
  qrCodeValue: string;  // The QR value chosen by user settings
  aiRecommendation?: string;
}

export interface SharePayload {
  title: string;
  text: string;
  url?: string;
  emailSubject?: string;
  emailBody?: string;
  whatsappText?: string;
}
