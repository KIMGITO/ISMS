import { BusinessReceiptSettings } from "./types";

import { useBusinessStore } from "../../stores/businessStore";

const DEFAULT_SETTINGS: Record<string, BusinessReceiptSettings> = {
  default: {
    logoUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E",
    businessName: "KayKay's Milk Ltd",
    address: "Westlands Mall, Nairobi, Kenya",
    phone: "+254 711 000 100",
    email: "orders@kaykaysmilk.co.ke",
    website: "www.kaykaysmilk.co.ke",
    pinNumber: "P051234567F",
    registrationNumber: "CPR/2023/12345",
    socialMedia: "@kaykaysmilk",
    headerMessage: "FRESH DAILY DAIRY DIRECT TO YOUR DOOR",
    footerMessage: "Thank you for supporting local Kenyan Dairy farmers!",
    termsAndConditions: "Goods once sold can only be returned if sourness is verified at delivery.",
    returnPolicy: "Contact customer care within 12 hours for immediate product replacement.",
    thankYouMessage: "Asante Sana! Stay Healthy with KayKay's Milk.",
    receiptPrefix: "KKM",
    receiptNumberFormat: "PREFIX-YYYY-INCREMENT",
    paperWidth: "80mm",
    currencyFormat: "KSh",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    isTaxEnabled: true,
    taxPercentage: 16.0,
    qrCodeOption: "verification_url",
    customQrUrl: "https://kaykaysmilk.co.ke/verify",
    templateType: "milk_shop"
  }
};

export class ReceiptSettingsService {
  public static getSettings(businessId: string): BusinessReceiptSettings {
    const config = useBusinessStore.getState().integrationConfigs['receipt'];
    
    // Fallback to businessId, then default settings
    if (config && Object.keys(config).length > 0) {
      return config;
    }
    
    // Auto-create customized settings based on the business if possible
    const defaultSet = DEFAULT_SETTINGS.default;
    
    // We can fetch from businessStore dynamically, or just adapt defaultSet
    return {
      ...defaultSet,
      // Customize name if we want, otherwise default is fine
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
