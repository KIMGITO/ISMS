import { BusinessReceiptSettings } from "./types";

import { useBusinessStore } from "../../stores/businessStore";

const DEFAULT_SETTINGS: Record<string, BusinessReceiptSettings> = {
  default: {
    logoUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E",
    businessName: "ISMS  App",
    address: " Nairobi, Kenya",
    phone: "+254 743 952 173",
    email: "codensons@gmail.com",
    website: "www.isms.co.ke",
    pinNumber: "N/A",
    registrationNumber: "N/A",
    socialMedia: "@codensons",
    headerMessage: "Welcome to ISMS  App,  Your Trusted App for your business!",
    footerMessage: "You were served using ISMS POS Application!",
    termsAndConditions: "Get yourself one for your business,.",
    returnPolicy: "Contact ISMS via +254743952173.",
    thankYouMessage: "Asante Sana! from ISMS .",
    receiptPrefix: "ISMS",
    receiptNumberFormat: "PREFIX-YYYY-INCREMENT",
    paperWidth: "80mm",
    currencyFormat: "KSh",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    isTaxEnabled: false,
    taxPercentage: 16.0,
    qrCodeOption: "verification_url",
    customQrUrl: "https://isms.co.ke/verify",
    templateType: "isms_app"
  }
};

export class ReceiptSettingsService {
  public static getSettings(businessId: string): BusinessReceiptSettings {
    const bizState = useBusinessStore.getState();
    const activeBiz = bizState.businesses.find((b) => b.id === businessId);
    const config = bizState.integrationConfigs['receipt'];
    
    const defaultSet = DEFAULT_SETTINGS.default;
    const baseSettings = (config && Object.keys(config).length > 0) ? config : defaultSet;
    
    return {
      ...baseSettings,
      isTaxEnabled: activeBiz ? activeBiz.isTaxEnabled !== false : baseSettings.isTaxEnabled,
      taxPercentage: activeBiz && typeof activeBiz.taxPercentage === 'number' ? activeBiz.taxPercentage : baseSettings.taxPercentage,
    };
  }

  public static saveSettings(businessId: string, settings: BusinessReceiptSettings): void {
    // Fire and forget update
    useBusinessStore.getState().updateIntegrationConfig('receipt', settings).catch(e => {
      console.error("Failed to save receipt settings:", e);
    });
  }

  public static resetToDefault(businessId: string): BusinessReceiptSettings {
    const defaultSet = DEFAULT_SETTINGS.default;
    this.saveSettings(businessId, defaultSet);
    return defaultSet;
  }
}
