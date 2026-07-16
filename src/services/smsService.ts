// src/services/smsService.ts
import fs from "fs";
import path from "path";

export interface SmsConfig {
  business_id: string;
  provider: "twilio" | "future_mock";
  default_country: string;
  account_sid: string;
  auth_token: string;
  messaging_service_sid?: string;
  from_phone_number?: string;
  owner_phone_number: string;
  enabled: boolean;
}

const DATA_DIR = path.join(process.cwd(), "data");
const SMS_CONFIG_FILE = path.join(DATA_DIR, "sms_config.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface SmsProvider {
  sendSms(to: string, body: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
  testConnection(): Promise<{ success: boolean; error?: string }>;
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(private config: SmsConfig) {}

  public async sendSms(to: string, body: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const { account_sid, auth_token, messaging_service_sid, from_phone_number } = this.config;

      if (!account_sid || !auth_token) {
        return { success: false, error: "Twilio Account SID or Auth Token is missing." };
      }

      if (!messaging_service_sid && !from_phone_number) {
        return { success: false, error: "Either From Phone Number or Messaging Service SID must be provided." };
      }

      // Prepare basic authorization header
      const auth = Buffer.from(`${account_sid}:${auth_token}`).toString("base64");

      // Set up Twilio API request payload
      const params = new URLSearchParams();
      params.append("To", to);
      params.append("Body", body);

      if (messaging_service_sid) {
        params.append("MessagingServiceSid", messaging_service_sid);
      } else if (from_phone_number) {
        params.append("From", from_phone_number);
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Messages.json`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      const responseData = await response.json();

      if (response.ok) {
        return {
          success: true,
          messageId: responseData.sid,
        };
      } else {
        return {
          success: false,
          error: responseData.message || `Twilio Error Code ${responseData.code || response.status}`,
        };
      }
    } catch (err: any) {
      console.error("SMS Send Exception via Twilio Provider:", err);
      return {
        success: false,
        error: err.message || "Unknown error occurred while dispatching SMS via Twilio.",
      };
    }
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const { account_sid, auth_token } = this.config;
      if (!account_sid || !auth_token) {
        return { success: false, error: "Twilio credentials missing." };
      }
      const auth = Buffer.from(`${account_sid}:${auth_token}`).toString("base64");
      const url = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}.json`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });

      if (response.ok) {
        return { success: true };
      } else {
        const responseData = await response.json();
        return { success: false, error: responseData.message || "Twilio authentication failed." };
      }
    } catch (err: any) {
      return { success: false, error: err.message || "Network error checking Twilio status." };
    }
  }
}

export class FutureMockSmsProvider implements SmsProvider {
  constructor(private config: SmsConfig) {}

  public async sendSms(to: string, body: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    console.log(`[FUTURE MOCK SMS] sending body "${body}" to "${to}"`);
    return {
      success: true,
      messageId: `mock_msg_${Math.random().toString(36).substr(2, 9)}`,
    };
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }
}

export class SmsProviderFactory {
  public static getProvider(config: SmsConfig): SmsProvider {
    switch (config.provider) {
      case "twilio":
        return new TwilioSmsProvider(config);
      case "future_mock":
      default:
        return new FutureMockSmsProvider(config);
    }
  }
}

export class SmsService {
  private static loadAllConfigs(): Record<string, SmsConfig> {
    try {
      if (fs.existsSync(SMS_CONFIG_FILE)) {
        const data = fs.readFileSync(SMS_CONFIG_FILE, "utf-8");
        return JSON.parse(data);
      }
    } catch (err) {
      console.error("Failed to read SMS configuration file:", err);
    }
    return {};
  }

  private static saveAllConfigs(configs: Record<string, SmsConfig>) {
    try {
      fs.writeFileSync(SMS_CONFIG_FILE, JSON.stringify(configs, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save SMS configurations to file:", err);
    }
  }

  /**
   * Get SMS Settings for a business.
   */
  public static getSettings(businessId: string): SmsConfig | null {
    const configs = this.loadAllConfigs();
    return configs[businessId] || null;
  }

  /**
   * Save SMS Settings for a business.
   */
  public static saveSettings(businessId: string, config: SmsConfig): SmsConfig {
    const configs = this.loadAllConfigs();
    configs[businessId] = {
      ...config,
      business_id: businessId,
    };
    this.saveAllConfigs(configs);
    return configs[businessId];
  }

  /**
   * Send an SMS using the configured provider.
   */
  public static async sendSms(
    businessId: string,
    to: string,
    body: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const config = this.getSettings(businessId);
    if (!config || !config.enabled) {
      return { success: false, error: "SMS service is disabled or unconfigured." };
    }
    const provider = SmsProviderFactory.getProvider(config);
    return provider.sendSms(to, body);
  }

  /**
   * Test connection credentials for the configured provider.
   */
  public static async testConnection(
    businessId: string
  ): Promise<{ success: boolean; error?: string }> {
    const config = this.getSettings(businessId);
    if (!config) {
      return { success: false, error: "SMS service settings not found." };
    }
    const provider = SmsProviderFactory.getProvider(config);
    return provider.testConnection();
  }
}
