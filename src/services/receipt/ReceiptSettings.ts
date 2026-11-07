import { BusinessReceiptSettings, ExtraQrOption, PaperWidth } from "./types";
import { useBusinessStore } from "../../stores/businessStore";
import type { Business } from "../../types";

/**
 * Values earlier versions shipped as defaults and saved into businesses' configs.
 * They describe the app's developer, not the shop, so they are treated as empty.
 */
const LEGACY_PLACEHOLDERS = new Set([
  "KayKay's",
  " Nairobi, Kenya",
  "+254 743 952 173",
  "codensons@gmail.com",
  "www.kaykays.co.ke",
  "N/A",
  "Welcome to KayKay's, Your Trusted App for your business!",
  "You were served using KayKay's POS Application!",
  "Get yourself one for your business.",
  "Contact KayKay's via +254743952173.",
  "Asante Sana! from KayKay's.",
  "https://kaykays.co.ke/verify",
]);

const EXTRA_QR: ExtraQrOption[] = ["none", "business_website", "whatsapp_chat", "google_review", "custom_url"];

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return LEGACY_PLACEHOLDERS.has(value) ? "" : value;
}

function pick(saved: unknown, fallback = ""): string {
  const value = clean(saved).trim();
  return value || fallback;
}

export function defaultReceiptSettings(business?: Business): BusinessReceiptSettings {
  return {
    businessName: business?.name || "",
    address: business?.address || "",
    phone: business?.contactPhone || "",
    email: business?.contactEmail || "",
    website: "",
    pinNumber: "",
    registrationNumber: "",
    headerMessage: "",
    thankYouMessage: "Thank you for your business.",
    footerMessage: "",
    returnPolicy: "",
    receiptPrefix: "RCT",
    receiptNumberFormat: "PREFIX-YYYY-INCREMENT",
    paperWidth: "58mm",
    charsPerLine: 0,
    currencyFormat: business?.currency && business.currency.toLowerCase() !== "ksh" ? business.currency : "KSh",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    isTaxEnabled: business ? business.isTaxEnabled !== false : false,
    taxPercentage: typeof business?.taxPercentage === "number" ? business.taxPercentage : 16,
    showBarcode: true,
    extraQr: "none",
    customQrUrl: "",
    autoPrint: false,
    openCashDrawer: false,
  };
}

/** Reads a stored config, including ones saved by older versions, into the current shape. */
export function normalizeReceiptSettings(saved: Record<string, any> | null | undefined, business?: Business): BusinessReceiptSettings {
  const base = defaultReceiptSettings(business);
  const s = saved || {};

  const paperWidth: PaperWidth = s.paperWidth === "80mm" || s.paperWidth === "A4" ? "80mm" : s.paperWidth === "58mm" ? "58mm" : base.paperWidth;

  let extraQr: ExtraQrOption = EXTRA_QR.includes(s.extraQr) ? s.extraQr : "none";
  if (!s.extraQr && s.showQrCode && EXTRA_QR.includes(s.qrCodeOption)) extraQr = s.qrCodeOption;

  const chars = Number(s.charsPerLine);
  return {
    ...base,
    businessName: pick(s.businessName, base.businessName),
    address: pick(s.address, base.address),
    phone: pick(s.phone, base.phone),
    email: pick(s.email, base.email),
    website: pick(s.website),
    pinNumber: pick(s.pinNumber).toUpperCase(),
    registrationNumber: pick(s.registrationNumber),
    headerMessage: pick(s.headerMessage),
    thankYouMessage: typeof s.thankYouMessage === "string" ? clean(s.thankYouMessage) : base.thankYouMessage,
    footerMessage: pick(s.footerMessage),
    returnPolicy: pick(s.returnPolicy),
    receiptPrefix: typeof s.receiptPrefix === "string" ? s.receiptPrefix.trim() : base.receiptPrefix,
    receiptNumberFormat: ["PREFIX-INCREMENT", "PREFIX-YYYY-INCREMENT", "INCREMENT"].includes(s.receiptNumberFormat)
      ? s.receiptNumberFormat
      : base.receiptNumberFormat,
    paperWidth,
    charsPerLine: [32, 42, 48].includes(chars) ? chars : 0,
    currencyFormat: pick(s.currencyFormat, base.currencyFormat),
    dateFormat: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "medium"].includes(s.dateFormat) ? s.dateFormat : base.dateFormat,
    timeFormat: s.timeFormat === "12h" ? "12h" : "24h",
    showBarcode: s.showBarcode !== false,
    extraQr,
    customQrUrl: pick(s.customQrUrl),
    autoPrint: s.autoPrint === true,
    openCashDrawer: s.openCashDrawer === true,
  };
}

export class ReceiptSettingsService {
  public static getSettings(businessId: string): BusinessReceiptSettings {
    const state = useBusinessStore.getState();
    const business = state.businesses.find((b) => b.id === businessId);
    const settings = normalizeReceiptSettings(state.integrationConfigs["receipt"], business);
    // Tax always follows the business setting used at checkout.
    if (business) {
      settings.isTaxEnabled = business.isTaxEnabled !== false;
      if (typeof business.taxPercentage === "number") settings.taxPercentage = business.taxPercentage;
    }
    return settings;
  }

  public static saveSettings(settings: BusinessReceiptSettings): Promise<void> {
    return useBusinessStore.getState().updateIntegrationConfig("receipt", settings);
  }
}
