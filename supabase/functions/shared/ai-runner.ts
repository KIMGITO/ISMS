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

export async function runAI(settings: any, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const safeSettings = settings || { provider: "huggingface", model: "Qwen/Qwen2.5-72B-Instruct", enabled: true };

  if (safeSettings.enabled === false) {
    return { success: false, text: "", error: "AI is currently disabled for this business by the Owner." };
  }

  const provider = (safeSettings.provider || "huggingface").toLowerCase();
  const apiKey = safeSettings.api_key || 
    (provider === "openai" ? Deno.env.get("OPENAI_API_KEY") : "") ||
    (provider === "gemini" ? Deno.env.get("GEMINI_API_KEY") : "") ||
    (provider === "deepseek" ? Deno.env.get("DEEPSEEK_API_KEY") : "") || 
    (provider === "anthropic" ? Deno.env.get("ANTHROPIC_API_KEY") : "") || "";

  console.log(`[ai-runner] Executing with provider: ${provider}, model: ${safeSettings.model}`);

  // 1. Try primary provider
  let primaryRes = await executeProvider(provider, apiKey, safeSettings, options);
  if (primaryRes.success) return primaryRes;

  console.warn(`[ai-runner] Primary provider [${provider}] failed: ${primaryRes.error}. Initiating fallback chain...`);

  // 2. Fallback: Try Gemini if key available
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey && provider !== "gemini") {
    console.log("[ai-runner] Attempting Gemini fallback...");
    const geminiRes = await runGemini(geminiKey, { ...safeSettings, model: "gemini-1.5-flash" }, options);
    if (geminiRes.success) return geminiRes;
    console.warn(`[ai-runner] Gemini fallback failed: ${geminiRes.error}`);
  }

  // 3. Fallback: Hugging Face, unless that was the provider just tried (running the
  //    whole rotation twice only doubles the calls and the credit used)
  if (provider !== "huggingface") {
    console.log("[ai-runner] Attempting HuggingFace fallback...");
    const hfRes = await runHuggingFaceRotation("", safeSettings, options);
    if (hfRes.success) return hfRes;
    console.warn(`[ai-runner] HuggingFace fallback failed: ${hfRes.error}`);
  }

  // 4. Fallback: Try OpenRouter free models
  console.log("[ai-runner] Attempting OpenRouter fallback...");
  const openRouterRes = await runOpenRouterFree(safeSettings, options);
  if (openRouterRes.success) return openRouterRes;
  console.warn(`[ai-runner] OpenRouter fallback failed: ${openRouterRes.error}`);

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


const HF_TOKEN_NAMES = [
  // Newest names first. HUGGING_FACE_TOKEN is what the Supabase dashboard secret is called.
  "HUGGING_FACE_TOKEN", "HUGGINGFACE_TOKEN", "HF_TOKEN",
  "HF_TOKEN_A", "HF_TOKEN_B", "HF_TOKEN_C", "HF_TOKEN_D", "HF_TOKEN_E",
];

/** Hugging Face keys from the Supabase secrets, with the secret's name (never shown: the value). */
function huggingFaceTokenPool(settingsKey?: string): { label: string; token: string }[] {
  const pool: { label: string; token: string }[] = [];
  const add = (label: string, value?: string | null) => {
    const token = (value || "").trim();
    if (token && !pool.some((p) => p.token === token)) pool.push({ label, token });
  };
  add("the key in AI settings", settingsKey);
  for (const name of HF_TOKEN_NAMES) add(name, Deno.env.get(name));
  return pool;
}

export function getHuggingFaceTokens(): string[] {
  return huggingFaceTokenPool().map((p) => p.token);
}

/**
 * Tries the Hugging Face router with each key in turn (rotation), model by model.
 * A key that is invalid, lacks permission or is out of credit is dropped for the rest
 * of the request; a model the router doesn't serve moves on to the next model. If all
 * fail, the error says what happened to each key, by secret name.
 */
async function runHuggingFaceRotation(dbKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const pool = huggingFaceTokenPool(dbKey);
  if (pool.length === 0) {
    return { success: false, text: "", error: "No Hugging Face key is set. Add one in AI settings or as the HUGGING_FACE_TOKEN secret." };
  }

  // Models the Hugging Face router serves (checked against router.huggingface.co/v1/models
  // on 2026-11-07). A model it doesn't serve costs a wasted request before the next is tried.
  const servedModels = [
    "Qwen/Qwen2.5-72B-Instruct",
    "meta-llama/Llama-3.1-8B-Instruct",
    "deepseek-ai/DeepSeek-V3",
    "openai/gpt-oss-120b",
  ];
  const models = Array.from(new Set([settings.model, ...servedModels]))
    .filter((m): m is string => Boolean(m && m.trim().length > 0));

  const messages = [
    { role: "system", content: options.systemInstruction },
    ...options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
  ];

  // Why each key stopped being used, e.g. "HF_TOKEN_A: out of free monthly credits"
  const dead = new Map<string, string>();
  const modelProblems: string[] = [];

  for (const model of models) {
    let modelUnavailable = false;
    for (const { label, token } of pool) {
      if (dead.has(label) || modelUnavailable) continue;

      for (let attempt = 0; attempt < 2; attempt++) {
        let res: Response;
        try {
          const payload: any = {
            model,
            messages,
            temperature: settings.temperature ?? 0.5,
            max_tokens: settings.max_tokens ?? 1024,
            top_p: settings.top_p ?? 0.9,
          };
          if (options.responseMimeType === "application/json") payload.response_format = { type: "json_object" };
          res = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
          });
        } catch (err: any) {
          modelProblems.push(`network error reaching Hugging Face (${err?.message || "fetch failed"})`);
          break;
        }

        const body = await res.json().catch(() => ({} as any));
        const detail = String(body?.error?.message || body?.error || "").slice(0, 160);

        if (res.ok) {
          const text = body?.choices?.[0]?.message?.content || "";
          if (text.trim().length > 0) return { success: true, text };
          modelProblems.push(`${model} returned an empty reply`);
          break;
        }
        if (res.status === 401) { dead.set(label, "rejected: the key is invalid or expired"); break; }
        if (res.status === 403) { dead.set(label, "not allowed: the token needs the \"Make calls to Inference Providers\" permission"); break; }
        if (res.status === 402) { dead.set(label, "out of free monthly credits"); break; }
        if (res.status === 429) { modelProblems.push(`${label} rate-limited on ${model}`); break; }
        if ((res.status === 503 || res.status === 504) && attempt === 0) { await delay(1000); continue; }
        // 400/404/422: usually the router doesn't serve this model; try the next model
        modelUnavailable = true;
        modelProblems.push(`${model}: ${detail || `HTTP ${res.status}`}`);
        break;
      }
    }
  }

  const keyReport = pool.map(({ label }) => `${label}: ${dead.get(label) || "accepted, but no model answered"}`);
  const lastModel = modelProblems.length ? ` Last model problem: ${modelProblems[modelProblems.length - 1]}.` : "";
  return { success: false, text: "", error: `Hugging Face didn't answer. ${keyReport.join("; ")}.${lastModel}` };
}

async function runOpenRouterFree(settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const freeModels = [
    "meta-llama/llama-3.2-3b-instruct:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/pixtral-12b:free",
  ];

  const orApiKey = Deno.env.get("OPENROUTER_API_KEY") || "";

  for (const model of freeModels) {
    try {
      const messages = [
        { role: "system", content: options.systemInstruction },
        ...options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      ];

      const payload: any = {
        model,
        messages,
        temperature: settings.temperature ?? 0.5,
        max_tokens: settings.max_tokens ?? 1024,
      };

      if (options.responseMimeType === "application/json") {
        // OpenRouter supports response_format for some models
        payload.response_format = { type: "json_object" };
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (orApiKey) {
        headers["Authorization"] = `Bearer ${orApiKey}`;
      }

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.choices?.[0]?.message?.content) {
        return { success: true, text: data.choices[0].message.content };
      } else if (data.error) {
        console.warn(`[ai-runner] OpenRouter [${model}] error:`, data.error.message);
      }
    } catch (err: any) {
      console.warn(`[ai-runner] OpenRouter [${model}] fetch error:`, err.message);
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

  const baseModel = settings.model?.includes("gemini") ? settings.model : "gemini-1.5-flash";
  
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

