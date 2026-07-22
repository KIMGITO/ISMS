// supabase/edge_functions/shared/ai-runner.ts
// Provider-Agnostic AI Runner with automatic free model fallback (HuggingFace + OpenRouter + Gemini)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AISettings {
  provider: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  top_k: number;
  system_prompt?: string;
  enabled: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIRunnerOptions {
  systemInstruction: string;
  messages: ChatMessage[];
  responseMimeType?: string;
  responseSchema?: unknown;
}

export interface AIRunnerResult {
  success: boolean;
  text: string;
  error?: string;
}

export async function loadAISettings(businessId: string): Promise<AISettings> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: aiData } = await supabase
    .from("ai_settings")
    .select("provider, api_key, model, temperature, max_tokens, top_p, top_k, system_prompt, enabled")
    .eq("business_id", businessId)
    .maybeSingle();

  if (aiData) return aiData as AISettings;

  const { data: intData } = await supabase
    .from("integration_configurations")
    .select("payload")
    .eq("business_id", businessId)
    .eq("section", "ai_settings")
    .maybeSingle();

  if (intData?.payload) return intData.payload as AISettings;

  return {
    provider: "huggingface",
    model: "Qwen/Qwen2.5-Coder-32B-Instruct",
    api_key: "",
    temperature: 0.7,
    max_tokens: 2048,
    top_p: 0.95,
    top_k: 40,
    enabled: true,
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runAI(settings: any, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const safeSettings = settings || { provider: "huggingface", model: "openai/gpt-oss-120b", enabled: true };

  if (safeSettings.enabled === false) {
    return { success: false, text: "", error: "AI is currently disabled for this business by the Owner." };
  }

  const provider = (safeSettings.provider || "huggingface").toLowerCase();
  const apiKey = safeSettings.api_key || 
    (provider === "openai" ? Deno.env.get("OPENAI_API_KEY") : "") ||
    (provider === "gemini" ? Deno.env.get("GEMINI_API_KEY") : "") ||
    (provider === "deepseek" ? Deno.env.get("DEEPSEEK_API_KEY") : "") || 
    (provider === "anthropic" ? Deno.env.get("ANTHROPIC_API_KEY") : "") || "";

  // 1. Try primary provider
  let primaryRes = await executeProvider(provider, apiKey, safeSettings, options);
  if (primaryRes.success) return primaryRes;

  console.warn(`[ai-runner] Primary provider [${provider}] failed (${primaryRes.error}). Initiating fallback...`);

  // 2. Fallback: Try Gemini if key available
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    const geminiRes = await runGemini(geminiKey, { ...safeSettings, model: "gemini-1.5-flash" }, options);
    if (geminiRes.success) return geminiRes;
  }

  // 3. Fallback: Try HuggingFace free model pool
  const hfRes = await runHuggingFaceRotation(apiKey, safeSettings, options);
  if (hfRes.success) return hfRes;

  // 4. Fallback: Try OpenRouter free models
  const openRouterRes = await runOpenRouterFree(safeSettings, options);
  if (openRouterRes.success) return openRouterRes;

  return primaryRes;
}

async function executeProvider(provider: string, apiKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  try {
    switch (provider) {
      case "huggingface":
        return await runHuggingFaceRotation(apiKey, settings, options);
      case "gemini":
        return await runGemini(apiKey, settings, options);
      case "openai":
        return await runOpenAICompat("https://api.openai.com/v1", apiKey, settings, options);
      case "deepseek":
        return await runOpenAICompat("https://api.deepseek.com", apiKey, settings, options);
      case "groq":
        return await runOpenAICompat("https://api.groq.com/openai/v1", apiKey, settings, options);
      case "anthropic":
        return await runAnthropic(apiKey, settings, options);
      default:
        return await runHuggingFaceRotation(apiKey, settings, options);
    }
  } catch (err: any) {
    return { success: false, text: "", error: err.message || "Provider error" };
  }
}

export function getHuggingFaceTokens(): string[] {
  const envKeys = [
    "HF_TOKEN_A", "HF_TOKEN_B", "HF_TOKEN_C", "HF_TOKEN_D", "HF_TOKEN_E", "HF_TOKEN", "HUGGINGFACE_TOKEN"
  ];

  const tokens: string[] = [];
  for (const key of envKeys) {
    const val = Deno.env.get(key);
    if (val && val.trim().length > 0 && !tokens.includes(val.trim())) {
      tokens.push(val.trim());
    }
  }
  return tokens;
}

async function runHuggingFaceRotation(dbKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const envTokens = getHuggingFaceTokens();
  const tokenPool = [
    dbKey,
    ...envTokens,
  ].filter((t): t is string => Boolean(t && t.trim().length > 0));

  // Only enabled models on user's HuggingFace Router provider account
  const validChatModels = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "Qwen/Qwen2.5-72B-Instruct",
    "deepseek-ai/DeepSeek-V4-Pro",
    "deepseek-ai/DeepSeek-V4-Flash"
  ];

  const modelsToTry = Array.from(new Set([
    settings.model,
    ...validChatModels
  ])).filter((m): m is string => Boolean(m && m.trim().length > 0 && validChatModels.includes(m)));

  let lastError = "Tokens exhausted";

  for (const targetModel of modelsToTry) {
    for (const activeToken of tokenPool.length > 0 ? tokenPool : [""]) {
      let retries = 2;
      let waitTime = 1000;

      while (retries > 0) {
        try {
          const messages = [
            { role: "system", content: options.systemInstruction },
            ...options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }))
          ];

          const payload: any = {
            model: targetModel,
            messages,
            temperature: settings.temperature ?? 0.5,
            max_tokens: settings.max_tokens ?? 1024,
            top_p: settings.top_p ?? 0.9,
          };

          if (options.responseMimeType === "application/json") {
            payload.response_format = { type: "json_object" };
          }

          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (activeToken) headers["Authorization"] = `Bearer ${activeToken}`;

          const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });

          if (res.status === 402 || res.status === 429 || res.status === 400 || res.status === 404) {
            const errData = await res.json().catch(() => ({}));
            lastError = errData.error?.message || `HF HTTP ${res.status} on ${targetModel}`;
            break; // Move to next model
          }

          if (res.status === 503) {
            retries--;
            await delay(waitTime);
            waitTime += 1000;
            continue;
          }

          const data = await res.json();
          if (!res.ok) {
            lastError = data.error?.message || `HF API HTTP ${res.status}`;
            break;
          }

          const responseText = data.choices?.[0]?.message?.content || "";
          if (responseText.trim().length > 0) {
            return { success: true, text: responseText };
          }
        } catch (err: any) {
          lastError = err.message || "Network error";
          break;
        }
      }
    }
  }

  return { success: false, text: "", error: `Hugging Face free pool exhausted. Last error: ${lastError}` };
}

async function runOpenRouterFree(settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const freeModels = [
    "meta-llama/llama-3.2-3b-instruct:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
    "google/gemma-2-9b-it:free",
  ];

  for (const model of freeModels) {
    try {
      const messages = [
        { role: "system", content: options.systemInstruction },
        ...options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          temperature: settings.temperature ?? 0.5,
          max_tokens: settings.max_tokens ?? 1024,
        }),
      });

      const data = await res.json();
      if (res.ok && data.choices?.[0]?.message?.content) {
        return { success: true, text: data.choices[0].message.content };
      }
    } catch {
      continue;
    }
  }

  return { success: false, text: "", error: "OpenRouter free pool exhausted" };
}

async function runGemini(apiKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const contents = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const generationConfig: Record<string, unknown> = {
    temperature: settings.temperature ?? 0.4,
    topK: settings.top_k ?? 40,
    topP: settings.top_p ?? 0.95,
    maxOutputTokens: settings.max_tokens ?? 2048,
  };

  if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;
  if (options.responseSchema) generationConfig.responseSchema = options.responseSchema;

  const payload: Record<string, unknown> = { contents, generationConfig };

  if (options.systemInstruction) {
    payload.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  const baseModel = settings.model || "gemini-1.5-flash";
  
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${baseModel}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await resp.json();
    if (!resp.ok) return { success: false, text: "", error: result.error?.message || `HTTP ${resp.status}` };

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return { success: true, text };

    return { success: false, text: "", error: "Gemini returned empty response" };
  } catch (err: any) {
    return { success: false, text: "", error: err.message || "Network error calling Gemini" };
  }
}

async function runOpenAICompat(baseUrl: string, apiKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const messages = [
    { role: "system", content: options.systemInstruction },
    ...options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
  ];

  const payload: Record<string, unknown> = {
    model: settings.model || "gpt-4o-mini",
    messages,
    temperature: settings.temperature ?? 0.5,
    max_tokens: settings.max_tokens ?? 2048,
  };

  if (options.responseMimeType === "application/json") {
    payload.response_format = { type: "json_object" };
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) return { success: false, text: "", error: data.error?.message || `HTTP ${res.status}` };

    return { success: true, text: data.choices?.[0]?.message?.content || "" };
  } catch (err: any) {
    return { success: false, text: "", error: err.message || "Network error" };
  }
}

async function runAnthropic(apiKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const messages = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const payload: Record<string, unknown> = {
    model: settings.model || "claude-3-5-haiku-20241022",
    system: options.systemInstruction,
    messages,
    max_tokens: settings.max_tokens ?? 2048,
    temperature: settings.temperature ?? 0.5,
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) return { success: false, text: "", error: data.error?.message || `HTTP ${res.status}` };

    return { success: true, text: data.content?.[0]?.text || "" };
  } catch (err: any) {
    return { success: false, text: "", error: err.message || "Network error calling Anthropic" };
  }
}
