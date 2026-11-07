export type PaperWidth = "58mm" | "80mm";

/** Optional second QR code. Each option is a real link the business controls. */
export type ExtraQrOption = "none" | "business_website" | "whatsapp_chat" | "google_review" | "custom_url";

export type ReceiptNumberFormat = "PREFIX-INCREMENT" | "PREFIX-YYYY-INCREMENT" | "INCREMENT";

export interface BusinessReceiptSettings {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** The business's own KRA PIN, printed as text. Not a KRA verification. */
  pinNumber: string;
  registrationNumber: string;
  headerMessage: string;
  thankYouMessage: string;
  footerMessage: string;
  returnPolicy: string;
  receiptPrefix: string;
  receiptNumberFormat: ReceiptNumberFormat;
  /** Paper roll width; drives the printer, the PDF page and the on-screen preview. */
  paperWidth: PaperWidth;
  /** 0 = standard for the paper (32 on 58mm, 48 on 80mm). Some printers use 42 on 80mm. */
  charsPerLine: number;
  currencyFormat: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "medium";
  timeFormat: "12h" | "24h";
  isTaxEnabled: boolean;
  taxPercentage: number;
  showBarcode: boolean;
  extraQr: ExtraQrOption;
  customQrUrl: string;
  /** After a sale, open the receipt and go straight to choosing a printer. */
  autoPrint: boolean;
  /** Send the drawer-kick pulse on cash sales. */
  openCashDrawer: boolean;
}

export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  discountPercentage: number;
  /** Line total after the line discount. */
  total: number;
}

/** What KRA eTIMS returned when it signed this sale. Only ever filled from a real response. */
export interface KraSignature {
  pin: string;
  branchId: string;
  invoiceNo: number;
  sdcId: string;
  mrcNo?: string;
  rcptNo: number;
  totRcptNo?: number;
  internalData: string;
  signature: string;
  signedAt?: string;
  qrUrl: string;
  environment: "sandbox" | "production";
}

export interface ReceiptContent {
  receiptId: string;
  receiptNumber: string;
  transactionDate: string;
  transactionTime: string;
  cashierName: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  paymentMethodCode: string;
  paymentMethod: string;
  items: ReceiptItem[];
  /** Sum of item prices before any discount. */
  subtotal: number;
  /** Item and cart discounts together. */
  discount: number;
  taxTotal: number;
  taxRate: number;
  deliveryFee: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  note?: string;
  kra?: KraSignature;
  extraQr?: { url: string; caption: string };
}
