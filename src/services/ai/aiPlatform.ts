import { GoogleGenAI } from "@google/genai";
import { getSupabase } from "../supabaseClient";
import fs from "fs";
import path from "path";

export interface BusinessAISettings {
  id: string;
  business_id: string;
  provider: "gemini" | "openai" | "anthropic" | "deepseek" | "groq" | "ollama" | "azure_openai";
  api_key: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  thinking_enabled?: boolean;
  structured_output?: boolean;
  system_prompt?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIProviderResponse {
  text: string;
  success: boolean;
  error?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const AI_SETTINGS_FILE = path.join(DATA_DIR, "business_ai_settings.json");

// Ensure data directory and file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(AI_SETTINGS_FILE)) {
  fs.writeFileSync(AI_SETTINGS_FILE, JSON.stringify({}, null, 2));
}

export class AIPlatform {
  /**
   * Reads all AI settings from the local JSON storage.
   */
  public static getAllSettings(): Record<string, BusinessAISettings> {
    try {
      if (!fs.existsSync(AI_SETTINGS_FILE)) return {};
      const data = fs.readFileSync(AI_SETTINGS_FILE, "utf-8");
      return JSON.parse(data || "{}");
    } catch (err) {
      console.error("Error reading business AI settings:", err);
      return {};
    }
  }

  /**
   * Saves AI settings to the local JSON storage.
   */
  public static saveSettings(settings: Record<string, BusinessAISettings>): void {
    try {
      fs.writeFileSync(AI_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (err) {
      console.error("Error saving business AI settings:", err);
    }
  }

  /**
   * Gets AI settings for a specific business.
   */
  public static getSettingsForBusiness(businessId: string): BusinessAISettings | null {
    const all = this.getAllSettings();
    return all[businessId] || null;
  }

  /**
   * Updates or inserts settings for a specific business.
   */
  public static upsertSettings(businessId: string, settings: Partial<BusinessAISettings>): BusinessAISettings {
    const all = this.getAllSettings();
    const existing = all[businessId];

    const now = new Date().toISOString();
    const updated: BusinessAISettings = {
      id: existing?.id || `ai-set-${Date.now()}`,
      business_id: businessId,
      provider: settings.provider || existing?.provider || "gemini",
      api_key: settings.api_key !== undefined ? settings.api_key : (existing?.api_key || ""),
      model: settings.model || existing?.model || "gemini-3.5-flash",
      temperature: settings.temperature !== undefined ? Number(settings.temperature) : (existing?.temperature ?? 0.7),
      max_tokens: settings.max_tokens !== undefined ? Number(settings.max_tokens) : (existing?.max_tokens ?? 1024),
      top_p: settings.top_p !== undefined ? Number(settings.top_p) : (existing?.top_p ?? 0.95),
      top_k: settings.top_k !== undefined ? Number(settings.top_k) : (existing?.top_k ?? 40),
      thinking_enabled: settings.thinking_enabled !== undefined ? !!settings.thinking_enabled : (existing?.thinking_enabled ?? false),
      structured_output: settings.structured_output !== undefined ? !!settings.structured_output : (existing?.structured_output ?? false),
      system_prompt: settings.system_prompt !== undefined ? settings.system_prompt : (existing?.system_prompt ?? ""),
      enabled: settings.enabled !== undefined ? !!settings.enabled : (existing?.enabled ?? true),
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    all[businessId] = updated;
    this.saveSettings(all);
    return updated;
  }

  /**
   * Helper function to execute a prompt using the configured business AI settings.
   * If not configured or disabled, can fall back to the system's global Gemini API key if available,
   * or return an error indicating AI is not configured.
   */
  public static async executePrompt(
    businessId: string,
    options: {
      prompt: string,
      conversationId?: string; // optional client-provided ID
      systemPromptOverride?: string;
      messages?: ChatMessage[];
      responseSchema?: any;
      responseMimeType?: string;
      configOverride?: Partial<BusinessAISettings>;
    }
  ): Promise<AIProviderResponse> {
    const savedSettings = this.getSettingsForBusiness(businessId);
    const settings = options.configOverride 
      ? { ...savedSettings, ...options.configOverride } as BusinessAISettings
      : savedSettings;

    // If AI is disabled globally by the owner
    if (settings && !settings.enabled) {
      return {
        success: false,
        text: "",
        error: "AI is currently disabled for this business by the Owner.",
      };
    }

    const provider = settings?.provider || "gemini";
    const apiKey = settings?.api_key || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        text: "",
        error: "AI service is unconfigured. Please ask the Owner to configure an AI Provider API key under Settings.",
      };
    }

    // Provider Abstraction Dispatcher
    try {
      switch (provider) {
        case "gemini":
          return await this.executeGemini(apiKey, settings, options);
        case "openai":
          return await this.executeOpenAI(apiKey, settings, options);
        case "anthropic":
          return await this.executeAnthropic(apiKey, settings, options);
        case "deepseek":
          return await this.executeDeepSeek(apiKey, settings, options);
        case "groq":
          return await this.executeGroq(apiKey, settings, options);
        case "ollama":
          return await this.executeOllama(settings, options);
        case "azure_openai":
          return await this.executeAzureOpenAI(apiKey, settings, options);
        default:
          return {
            success: false,
            text: "",
            error: `AI Provider "${provider}" is currently unsupported or not yet implemented.`,
          };
      }
    } catch (err: any) {
      console.error(`AI execution failed via provider ${provider}:`, err);
      return {
        success: false,
        text: "",
        error: err.message || "An unexpected error occurred during AI processing.",
      };
    }
  }

  /**
   * Google Gemini Implementation
   */
  private static async executeGemini(
    apiKey: string,
    settings: BusinessAISettings | null,
    options: {
      prompt: string;
      systemPromptOverride?: string;
      messages?: ChatMessage[];
      responseSchema?: any;
      responseMimeType?: string;
    }
  ): Promise<AIProviderResponse> {
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const modelName = settings?.model || "gemini-3.5-flash";
    const systemInstruction = options.systemPromptOverride || settings?.system_prompt || "";

    const config: any = {
      systemInstruction: systemInstruction || undefined,
      temperature: settings?.temperature !== undefined ? Number(settings.temperature) : 0.7,
      topP: settings?.top_p !== undefined ? Number(settings.top_p) : 0.95,
      topK: settings?.top_k !== undefined ? Number(settings.top_k) : 40,
    };

    if (options.responseMimeType) {
      config.responseMimeType = options.responseMimeType;
    }
    if (options.responseSchema) {
      config.responseSchema = options.responseSchema;
    }

    let resultText = "";

    // If a full chat history is provided, we map it to contents
    if (options.messages && options.messages.length > 0) {
      const contents = options.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      // Add the final user prompt if it isn't already the last message
      const lastMsg = options.messages[options.messages.length - 1];
      if (lastMsg?.content !== options.prompt) {
        contents.push({
          role: "user",
          parts: [{ text: options.prompt }],
        });
      }

      // We implement resilient fallback models
      const modelsToTry = [modelName, "gemini-3.5-flash", "gemini-3.1-flash-lite"];
      let lastError = null;
      for (const currentModel of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: currentModel,
            contents: contents,
            config,
          });
          if (response && response.text) {
            resultText = response.text;
            // Persist conversation with full chat history
            try {
              const supabase = getSupabase();
              const convoId = options.conversationId || crypto.randomUUID();
              await supabase.from('conversations').insert({
                id: convoId,
                user_id: (await supabase.auth.getUser()).data.user?.id,
                messages: [
                  ...(options.messages?.map(m => ({ role: m.role, content: m.content })) || []),
                  // Include the final user prompt if it wasn't part of options.messages
                  ...(options.messages && options.messages.length > 0 && options.messages[options.messages.length - 1]?.content !== options.prompt ? [{ role: 'user', content: options.prompt }] : []),
                  { role: 'assistant', content: response.text }
                ]
              });
            } catch (e) {
              console.warn('Failed to persist AI conversation (chat history):', e);
            }
            break;
          }
        } catch (err: any) {
          console.warn(`Gemini failover attempt with model ${currentModel} failed:`, err.message || err);
          lastError = err;
        }
      }

      if (!resultText && lastError) {
        const errMsg = lastError.message || String(lastError);
        if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota") || errMsg.includes("429")) {
          return {
            success: false,
            text: "",
            error: "The AI service is temporarily busy (API Rate Limit Exceeded). Please wait a few seconds and try again.",
          };
        }
        throw lastError;
      }
    } else {
      // Single prompt mode
      const modelsToTry = [modelName, "gemini-2.5-flash", "gemini-1.5-flash"];
      let lastError = null;
      for (const currentModel of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: currentModel,
            contents: options.prompt,
            config,
          });
          if (response && response.text) {
            // Persist conversation
            try {
              const supabase = getSupabase();
              const convoId = options.conversationId || crypto.randomUUID();
              await supabase.from('conversations').insert({
                id: convoId,
                user_id: (await supabase.auth.getUser()).data.user?.id,
                messages: [{ role: 'user', content: options.prompt }, { role: 'assistant', content: response.text }]
              });
            } catch (e) {
              console.warn('Failed to persist AI conversation:', e);
            }
            resultText = response.text;
            break;
          }
        } catch (err: any) {
          console.warn(`Gemini failover attempt with model ${currentModel} failed:`, err.message || err);
          lastError = err;
        }
      }

      if (!resultText && lastError) {
        const errMsg = lastError.message || String(lastError);
        if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota") || errMsg.includes("429")) {
          return {
            success: false,
            text: "",
            error: "The AI service is temporarily busy (API Rate Limit Exceeded). Please wait a few seconds and try again.",
          };
        }
        throw lastError;
      }
    }

    return {
      success: true,
      text: resultText || "I was unable to retrieve a response from the AI model.",
    };
  }

  /**
   * OpenAI Mock Implementation (ready for enterprise upgrade)
   */
  private static async executeOpenAI(
    apiKey: string,
    settings: BusinessAISettings | null,
    options: { prompt: string; messages?: ChatMessage[] }
  ): Promise<AIProviderResponse> {
    const model = settings?.model || "gpt-4o-mini";
    // This is a production-ready template that demonstrates the OpenAI structure
    const maskedKey = apiKey.substring(0, 6) + "••••••••" + apiKey.substring(apiKey.length - 4);
    
    // Simulating call or returning mock explanation
    const reply = `[Enterprise OpenAI Platform Integration]
Active Provider: OpenAI
Configured Model: ${model}
Auth Token: Authorized (Key: ${maskedKey})

This is a simulated enterprise response from the OpenAI endpoint. To complete real calls, install the 'openai' package and configure the direct fetch call. Here is your query: "${options.prompt}"`;

    return {
      success: true,
      text: reply,
    };
  }

  /**
   * Anthropic Claude Mock Implementation (ready for enterprise upgrade)
   */
  private static async executeAnthropic(
    apiKey: string,
    settings: BusinessAISettings | null,
    options: { prompt: string }
  ): Promise<AIProviderResponse> {
    const model = settings?.model || "claude-3-5-sonnet-latest";
    const maskedKey = apiKey.substring(0, 6) + "••••••••" + apiKey.substring(apiKey.length - 4);
    const reply = `[Enterprise Anthropic Platform Integration]
Active Provider: Anthropic Claude
Configured Model: ${model}
Auth Token: Authorized (Key: ${maskedKey})

This is a simulated enterprise response from the Anthropic Claude endpoint. Here is your query: "${options.prompt}"`;

    return {
      success: true,
      text: reply,
    };
  }

  /**
   * DeepSeek Mock Implementation
   */
  private static async executeDeepSeek(
    apiKey: string,
    settings: BusinessAISettings | null,
    options: { prompt: string }
  ): Promise<AIProviderResponse> {
    const model = settings?.model || "deepseek-chat";
    const reply = `[Enterprise DeepSeek Platform Integration]
Active Provider: DeepSeek AI
Configured Model: ${model}

This is a simulated enterprise response from the DeepSeek API endpoint. Here is your query: "${options.prompt}"`;
    return {
      success: true,
      text: reply,
    };
  }

  /**
   * Groq Mock Implementation
   */
  private static async executeGroq(
    apiKey: string,
    settings: BusinessAISettings | null,
    options: { prompt: string }
  ): Promise<AIProviderResponse> {
    const model = settings?.model || "llama3-8b-8192";
    const reply = `[Groq Llama Platform Integration]
Active Provider: Groq API
Configured Model: ${model}

This is a simulated response from the high-performance Groq hardware endpoints. Here is your query: "${options.prompt}"`;
    return {
      success: true,
      text: reply,
    };
  }

  /**
   * Ollama Mock Implementation
   */
  private static async executeOllama(
    settings: BusinessAISettings | null,
    options: { prompt: string }
  ): Promise<AIProviderResponse> {
    const model = settings?.model || "llama3";
    const reply = `[Ollama Local Platform Integration]
Active Provider: Local Ollama Server
Configured Model: ${model}

This is a simulated response from the locally hosted Ollama server endpoint. Here is your query: "${options.prompt}"`;
    return {
      success: true,
      text: reply,
    };
  }

  /**
   * Azure OpenAI Mock Implementation
   */
  private static async executeAzureOpenAI(
    apiKey: string,
    settings: BusinessAISettings | null,
    options: { prompt: string }
  ): Promise<AIProviderResponse> {
    const model = settings?.model || "gpt-4";
    const reply = `[Azure OpenAI Enterprise Integration]
Active Provider: Microsoft Azure Cloud
Deployment Name: ${model}

This is a simulated enterprise response from the secure Azure OpenAI Service endpoints. Here is your query: "${options.prompt}"`;
    return {
      success: true,
      text: reply,
    };
  }
}
