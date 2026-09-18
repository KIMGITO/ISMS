import { BusinessReceiptSettings } from "./types";

import { useBusinessStore } from "../../stores/businessStore";

const DEFAULT_SETTINGS: Record<string, BusinessReceiptSettings> = {
  default: {
    logoUrl: "/icon.png",
    businessName: "KayKay's",
    address: " Nairobi, Kenya",
    phone: "+254 743 952 173",
    email: "codensons@gmail.com",
    website: "www.kaykays.co.ke",
    pinNumber: "N/A",
    registrationNumber: "N/A",
    socialMedia: "@codensons",
    headerMessage: "Welcome to KayKay's, Your Trusted App for your business!",
    footerMessage: "You were served using KayKay's POS Application!",
    termsAndConditions: "Get yourself one for your business.",
    returnPolicy: "Contact KayKay's via +254743952173.",
    thankYouMessage: "Asante Sana! from KayKay's.",
    receiptPrefix: "KK",
    receiptNumberFormat: "PREFIX-YYYY-INCREMENT",
    paperWidth: "80mm",
    currencyFormat: "KSh",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    isTaxEnabled: false,
    taxPercentage: 16.0,
    qrCodeOption: "verification_url",
    customQrUrl: "https://kaykays.co.ke/verify",
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
