// supabase/edge_functions/shared/ai-runner.ts
// Provider-agnostic AI runner for KayKay's Milk edge functions.
// Reads per-business API keys + config from the `ai_settings` Supabase table
// so all devices share the same owner-configured credentials.

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
  /** Full system instruction to inject (overrides settings.system_prompt). */
  systemInstruction: string;
  /** Full conversation history, ordered oldest → newest. Last item is the latest user message. */
  messages: ChatMessage[];
  /** Set to "application/json" to request structured JSON output (Gemini / OpenAI). */
  responseMimeType?: string;
  /** JSON Schema object for structured output (Gemini only). */
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

/**
 * Loads AI settings for a business from Supabase.
 * Tries `ai_settings` table first; falls back to `integration_configurations`.
 * Uses the service-role key so it bypasses RLS and works from edge functions.
 */
export async function loadAISettings(
  businessId: string
): Promise<AISettings | null> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Primary: dedicated ai_settings table
  const { data: aiData } = await supabase
    .from("ai_settings")
    .select("provider, api_key, model, temperature, max_tokens, top_p, top_k, system_prompt, enabled")
    .eq("business_id", businessId)
    .maybeSingle();

  if (aiData && aiData.api_key) return aiData as AISettings;

  // Fallback: integration_configurations (legacy storage)
  const { data: intData } = await supabase
    .from("integration_configurations")
    .select("payload")
    .eq("business_id", businessId)
    .eq("section", "ai_settings")
    .maybeSingle();

  if (intData?.payload && intData.payload.api_key) {
    return intData.payload as AISettings;
  }

  return null;
}

// ─────────────────────────────────────────────
// Main Dispatcher
// ─────────────────────────────────────────────

/**
 * Executes an AI prompt using the configured provider.
 * Handles Gemini (REST v1beta with model fallback), OpenAI-compatible APIs,
 * and Anthropic Claude.
 */
export async function runAI(
  settings: AISettings,
  options: AIRunnerOptions
): Promise<AIRunnerResult> {
  // Guard: disabled
  if (!settings.enabled) {
    return {
      success: false,
      text: "",
      error: "AI is currently disabled for this business by the Owner.",
    };
  }

  // Guard: no key (also allow env fallback for Gemini)
  const apiKey =
    settings.api_key ||
    (settings.provider === "gemini" ? Deno.env.get("GEMINI_API_KEY") : "") ||
    "";

  if (!apiKey) {
    return {
      success: false,
      text: "",
      error:
        "AI service is unconfigured. Please ask the Owner to add an API key under Settings > AI Configuration.",
    };
  }

  const provider = (settings.provider || "gemini").toLowerCase();

  try {
    switch (provider) {
      case "gemini":
        return await runGemini(apiKey, settings, options);
      case "openai":
        return await runOpenAICompat(
          "https://api.openai.com/v1",
          apiKey,
          settings,
          options
        );
      case "deepseek":
        return await runOpenAICompat(
          "https://api.deepseek.com",
          apiKey,
          settings,
          options
        );
      case "groq":
        return await runOpenAICompat(
          "https://api.groq.com/openai/v1",
          apiKey,
          settings,
          options
        );
      case "anthropic":
        return await runAnthropic(apiKey, settings, options);
      default:
        return {
          success: false,
          text: "",
          error: `Provider "${provider}" is not supported by this edge function.`,
        };
    }
  } catch (err: any) {
    console.error(`[ai-runner] Execution error [${provider}]:`, err);
    return {
      success: false,
      text: "",
      error: err.message || "Unexpected AI execution error.",
    };
  }
}

// ─────────────────────────────────────────────
// Gemini REST v1beta (with model fallback)
// ─────────────────────────────────────────────

async function runGemini(
  apiKey: string,
  settings: AISettings,
  options: AIRunnerOptions
): Promise<AIRunnerResult> {
  // Map chat history to Gemini's format (only user/model roles allowed)
  const contents = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const generationConfig: Record<string, unknown> = {
    temperature: settings.temperature ?? 0.7,
    topK: settings.top_k ?? 40,
    topP: settings.top_p ?? 0.95,
    maxOutputTokens: settings.max_tokens ?? 2048,
  };

  if (options.responseMimeType) {
    generationConfig.responseMimeType = options.responseMimeType;
  }
  if (options.responseSchema) {
    generationConfig.responseSchema = options.responseSchema;
  }

  const payload: Record<string, unknown> = { contents, generationConfig };

  if (options.systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: options.systemInstruction }],
    };
  }

  // Model fallback chain: configured → gemini-2.5-flash → gemini-1.5-flash
  const baseModel = settings.model || "gemini-2.5-flash";
  const fallbackChain = [
    ...new Set([baseModel, "gemini-2.5-flash", "gemini-1.5-flash"]),
  ];

  let lastError = "Unknown error";

  for (const model of fallbackChain) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await resp.json();

      if (!resp.ok) {
        const msg: string =
          result?.error?.message || `HTTP ${resp.status}`;
        // On rate limit, stop immediately — don't burn quota on other models
        if (resp.status === 429 || msg.includes("RESOURCE_EXHAUSTED")) {
          return {
            success: false,
            text: "",
            error:
              "AI quota limit reached. Please wait a moment and try again.",
          };
        }
        console.warn(`[ai-runner] Gemini model ${model} failed:`, msg);
        lastError = msg;
        continue; // Try next model
      }

      const text: string | undefined =
        result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return { success: true, text };
      }

      lastError = "Model returned an empty response";
    } catch (err: any) {
      lastError = err.message || "Network error calling Gemini";
      console.warn(`[ai-runner] Gemini model ${model} threw:`, lastError);
    }
  }

  return { success: false, text: "", error: lastError };
}

// ─────────────────────────────────────────────
// OpenAI-Compatible (OpenAI, DeepSeek, Groq)
// ─────────────────────────────────────────────

async function runOpenAICompat(
  baseUrl: string,
  apiKey: string,
  settings: AISettings,
  options: AIRunnerOptions
): Promise<AIRunnerResult> {
  const messages = [
    { role: "system", content: options.systemInstruction },
    ...options.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content })),
  ];

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: settings.temperature ?? 0.7,
    max_tokens: settings.max_tokens ?? 2048,
  };

  // Request JSON mode when applicable
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

  if (!resp.ok) {
    return {
      success: false,
      text: "",
      error: result.error?.message || `HTTP ${resp.status}`,
    };
  }

  const text: string = result.choices?.[0]?.message?.content || "";
  return { success: true, text };
}

// ─────────────────────────────────────────────
// Anthropic Claude
// ─────────────────────────────────────────────

async function runAnthropic(
  apiKey: string,
  settings: AISettings,
  options: AIRunnerOptions
): Promise<AIRunnerResult> {
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

  if (!resp.ok) {
    return {
      success: false,
      text: "",
      error: result.error?.message || `HTTP ${resp.status}`,
    };
  }

  const text: string = result.content?.[0]?.text || "";
  return { success: true, text };
}

// ─────────────────────────────────────────────
// JSON parse helper (strips ```json fences)
// ─────────────────────────────────────────────

export function safeParseJson(raw: string): any {
  if (!raw) return {};
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last-ditch: grab first JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse AI JSON response");
  }
}
