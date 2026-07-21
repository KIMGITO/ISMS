// supabase/edge_functions/shared/ai-runner.ts
// Robust Provider-Agnostic AI Runner
// Supports HuggingFace (Default/Fallback Pool), OpenAI, Gemini, DeepSeek, and Anthropic.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Settings Loader
// ─────────────────────────────────────────────

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

  // Return db settings if they exist (even if api_key is empty for HuggingFace)
  if (aiData) return aiData as AISettings;

  const { data: intData } = await supabase
    .from("integration_configurations")
    .select("payload")
    .eq("business_id", businessId)
    .eq("section", "ai_settings")
    .maybeSingle();

  if (intData?.payload) return intData.payload as AISettings;

  // Ultimate fallback instead of returning null so edge functions don't block
  return {
    provider: "huggingface",
    model: "Qwen/Qwen2.5-72B-Instruct",
    api_key: "",
    temperature: 0.7,
    max_tokens: 2048,
    top_p: 0.95,
    top_k: 40,
    enabled: true,
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────
// Main Dispatcher
// ─────────────────────────────────────────────

export async function runAI(settings: any, options: AIRunnerOptions): Promise<AIRunnerResult> {
  // Use HuggingFace Qwen as the ultimate default if no settings are provided
  const safeSettings = settings || { provider: "huggingface", model: "Qwen/Qwen2.5-72B-Instruct", enabled: true };

  if (!safeSettings.enabled) {
    return { success: false, text: "", error: "AI is currently disabled for this business by the Owner." };
  }

  const provider = (safeSettings.provider || "huggingface").toLowerCase();

  // Retrieve API keys from DB first, then fallback to edge function environment variables
  const apiKey = safeSettings.api_key || 
    (provider === "openai" ? Deno.env.get("OPENAI_API_KEY") : "") ||
    (provider === "gemini" ? Deno.env.get("GEMINI_API_KEY") : "") ||
    (provider === "deepseek" ? Deno.env.get("DEEPSEEK_API_KEY") : "") || 
    (provider === "anthropic" ? Deno.env.get("ANTHROPIC_API_KEY") : "") || "";

  // Require API key for commercial models, but bypass for HuggingFace (it uses the token pool)
  if (!apiKey && provider !== "huggingface") {
    return {
      success: false,
      text: "",
      error: `AI service is unconfigured. Please add an API key for ${provider}.`,
    };
  }

  try {
    switch (provider) {
      case "huggingface":
        return await runHuggingFaceRotation(apiKey, safeSettings, options);
      case "gemini":
        return await runGemini(apiKey, safeSettings, options);
      case "openai":
        return await runOpenAICompat("https://api.openai.com/v1", apiKey, safeSettings, options);
      case "deepseek":
        return await runOpenAICompat("https://api.deepseek.com", apiKey, safeSettings, options);
      case "groq":
        return await runOpenAICompat("https://api.groq.com/openai/v1", apiKey, safeSettings, options);
      case "anthropic":
        return await runAnthropic(apiKey, safeSettings, options);
      default:
        // Absolute fallback to free pool
        return await runHuggingFaceRotation(apiKey, safeSettings, options);
    }
  } catch (err: any) {
    console.error(`[ai-runner] Core execution crash [${provider}]:`, err);
    return { success: false, text: "", error: err.message || "Unexpected AI execution error." };
  }
}

// ─────────────────────────────────────────────
// HuggingFace (With Fallback Rotation Pool)
// ─────────────────────────────────────────────

export function getHuggingFaceTokens(): string[] {
  const envKeys = [
    "HF_TOKEN_A",
    "HF_TOKEN_B",
    "HF_TOKEN_C",
    "HF_TOKEN_D",
    "HF_TOKEN_E",
    "HF_TOKEN_F",
    "HF_TOKEN_G",
    "HF_TOKEN_H",
    "HF_TOKEN_I",
    "HF_TOKEN_J",
    "HF_TOKEN",
    "HUGGINGFACE_TOKEN",
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
  ].filter((t): t is string => Boolean(t && t.trim().length > 0)); // removes undefined/empty strings

  if (tokenPool.length === 0) {
    return { success: false, text: "", error: "Serverless token error: No valid HuggingFace Keys active in environment." };
  }

  const targetModel = settings.model || "Qwen/Qwen2.5-72B-Instruct";
  let lastError = "Tokens exhausted";

  for (let i = 0; i < tokenPool.length; i++) {
    const activeToken = tokenPool[i];
    let retries = 3;
    let waitTime = 2000;

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

        // Note: HF Router doesn't perfectly support response_format natively on all models, 
        // but passing it helps supported models (like Meta-Llama-3) output JSON.
        if (options.responseMimeType === "application/json") {
          payload.response_format = { type: "json_object" };
        }

        const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${activeToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (res.status === 429) {
          lastError = "Rate limit hit on active account quota.";
          break; // Break the while loop, move to the NEXT token in the for-loop
        }

        if (res.status === 503) {
          retries--;
          await delay(waitTime);
          waitTime += 1500;
          continue; // Stay on same token, try again
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || `HF API HTTP ${res.status}`);

        return { success: true, text: data.choices?.[0]?.message?.content || "" };
      } catch (err: any) {
        lastError = err.message;
        break; // Network/JSON error, move to next token
      }
    }
  }

  return { success: false, text: "", error: `Hugging Face fallback pool exhausted. Last error: ${lastError}` };
}

// ─────────────────────────────────────────────
// Gemini REST v1beta
// ─────────────────────────────────────────────

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

  const baseModel = settings.model || "gemini-2.5-flash";
  
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

    return { success: false, text: "", error: "Model returned an empty response" };
  } catch (err: any) {
    return { success: false, text: "", error: err.message || "Network error calling Gemini" };
  }
}

// ─────────────────────────────────────────────
// OpenAI-Compatible (OpenAI, DeepSeek, Groq)
// ─────────────────────────────────────────────

async function runOpenAICompat(baseUrl: string, apiKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const messages = [
    { role: "system", content: options.systemInstruction },
    ...options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }))
  ];

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: settings.temperature ?? 0.7,
    max_tokens: settings.max_tokens ?? 2048,
  };

  if (options.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await resp.json();

  if (!resp.ok) return { success: false, text: "", error: result.error?.message || `HTTP ${resp.status}` };

  return { success: true, text: result.choices?.[0]?.message?.content || "" };
}

// ─────────────────────────────────────────────
// Anthropic Claude
// ─────────────────────────────────────────────

async function runAnthropic(apiKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const messages = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model || "claude-3-5-sonnet-latest",
      system: options.systemInstruction,
      messages,
      max_tokens: settings.max_tokens ?? 2048,
    }),
  });

  const result = await resp.json();

  if (!resp.ok) return { success: false, text: "", error: result.error?.message || `HTTP ${resp.status}` };

  return { success: true, text: result.content?.[0]?.text || "" };
}

// ─────────────────────────────────────────────
// JSON parse helper (strips ```json fences)
// ─────────────────────────────────────────────

export function safeParseJson(raw: string): any {
  if (!raw) return {};
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse AI JSON response");
  }
}
