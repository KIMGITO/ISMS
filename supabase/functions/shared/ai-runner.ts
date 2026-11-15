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

/** Why the AI didn't answer, in a form the app can turn into a plain message. */
export type AIFailureCode =
  | "out_of_credit"   // every key has used its free monthly credit
  | "invalid_key"     // keys rejected or missing the Inference Providers permission
  | "no_key"          // no key set at all
  | "busy"            // rate limits, timeouts, models not answering
  | "disabled";       // the Owner turned the AI off

export interface AIRunnerResult {
  success: boolean;
  text: string;
  /** Technical reason, for logs and the Owner's hint. Never shown as-is to staff. */
  error?: string;
  code?: AIFailureCode;
}

/** What anyone using the app sees when the AI can't answer. */
export function friendlyAIMessage(code?: AIFailureCode): string {
  switch (code) {
    case "disabled":
      return "The assistant is switched off for this business. The owner can turn it on in Settings.";
    case "out_of_credit":
    case "invalid_key":
    case "no_key":
      return "The assistant is resting for now. Everything else in the app works as normal. Please try again later.";
    default:
      return "The assistant is busy right now. Please try again in a minute.";
  }
}

/** One plain line for Owners and Admins saying what to fix. Names secrets, never their values. */
export function ownerAIHint(code?: AIFailureCode): string {
  switch (code) {
    case "out_of_credit":
      return "All Hugging Face keys have used up this month's free credit. Add another key as a Supabase secret (HF_TOKEN_C, HF_TOKEN_D or HF_TOKEN_E) or wait for the credit to reset next month.";
    case "invalid_key":
      return "A Hugging Face key was refused. Check the token is valid and has the \"Make calls to Inference Providers\" permission.";
    case "no_key":
      return "No AI key is set. Add a Hugging Face token as the Supabase secret HF_TOKEN_A.";
    case "disabled":
      return "The assistant is turned off in AI settings.";
    default:
      return "The AI service is busy or slow right now. If this keeps happening, check the AI settings.";
  }
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

/** Providers the runner can call. Anything else is treated as Hugging Face. */
export const AI_PROVIDERS = ["huggingface", "gemini", "openai", "anthropic", "deepseek", "groq", "openrouter"] as const;
export type AIProvider = typeof AI_PROVIDERS[number];

export function normalizeProvider(p?: string | null): AIProvider {
  const v = String(p || "").trim().toLowerCase();
  return (AI_PROVIDERS as readonly string[]).includes(v) ? (v as AIProvider) : "huggingface";
}

/** The model each provider uses when none is chosen. Hugging Face stays the default provider. */
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  huggingface: "Qwen/Qwen2.5-72B-Instruct",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-5-5",
  deepseek: "deepseek-chat",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct",
};

/**
 * A key fit to go in an HTTP header, or "" if it isn't one. The settings screen shows
 * keys masked as "abcd••••••••wxyz"; sending that back as a key made fetch fail with
 * "headers of RequestInit is not a valid ByteString".
 */
export function cleanKey(key?: string | null): string {
  const k = String(key ?? "").trim();
  if (!k || k.includes("•") || !/^[\x21-\x7e]+$/.test(k)) return "";
  return k;
}

/** True when the value is the masked display form of a stored key. */
export function isMaskedKey(key?: string | null): boolean {
  return String(key ?? "").includes("•");
}

export async function runAI(settings: any, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const safeSettings = settings || { provider: "huggingface", model: "Qwen/Qwen2.5-72B-Instruct", enabled: true };

  if (safeSettings.enabled === false) {
    return { success: false, text: "", error: "AI is currently disabled for this business by the Owner.", code: "disabled" };
  }

  const provider = normalizeProvider(safeSettings.provider);
  const apiKey = providerKey(provider, safeSettings.api_key);

  console.log(`[ai-runner] Executing with provider: ${provider}, model: ${safeSettings.model}`);

  // 1. Try primary provider
  let primaryRes = await executeProvider(provider, apiKey, safeSettings, options);
  if (primaryRes.success) return primaryRes;

  console.warn(`[ai-runner] Primary provider [${provider}] failed: ${primaryRes.error}. Initiating fallback chain...`);

  // 2. Fallback: Gemini, only if a key is set
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey && provider !== "gemini") {
    console.log("[ai-runner] Attempting Gemini fallback...");
    const geminiRes = await runGemini(geminiKey, { ...safeSettings, model: "gemini-2.5-flash" }, options);
    if (geminiRes.success) return geminiRes;
    console.warn(`[ai-runner] Gemini fallback failed: ${geminiRes.error}`);
  }

  // 3. Fallback: Hugging Face, unless that was the provider just tried (running the
  //    whole rotation twice only doubles the calls and the credit used)
  let hfRes: AIRunnerResult | null = null;
  if (provider !== "huggingface") {
    console.log("[ai-runner] Attempting HuggingFace fallback...");
    hfRes = await runHuggingFaceRotation("", safeSettings, options);
    if (hfRes.success) return hfRes;
    console.warn(`[ai-runner] HuggingFace fallback failed: ${hfRes.error}`);
  }

  // 4. Fallback: OpenRouter free models, only if a key is set (they refuse calls without one)
  if (Deno.env.get("OPENROUTER_API_KEY")) {
    console.log("[ai-runner] Attempting OpenRouter fallback...");
    const openRouterRes = await runOpenRouterFree(safeSettings, options);
    if (openRouterRes.success) return openRouterRes;
    console.warn(`[ai-runner] OpenRouter fallback failed: ${openRouterRes.error}`);
  }

  // The Hugging Face result says most about why (its keys are the main pool).
  const failure = provider === "huggingface" ? primaryRes : (hfRes && hfRes.code !== "no_key" ? hfRes : primaryRes);
  return { ...failure, code: failure.code || "busy" };
}

/** The key to use for a provider: the one in AI settings, else its Supabase secret. */
export function providerKey(provider: AIProvider, settingsKey?: string | null): string {
  const secretName: Partial<Record<AIProvider, string>> = {
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  const name = secretName[provider];
  return cleanKey(settingsKey) || (name ? cleanKey(Deno.env.get(name)) : "");
}

/**
 * Calls only the chosen provider, with no fallback, so a test of (say) OpenAI can't
 * pass because Hugging Face answered instead.
 */
export async function testProvider(settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const provider = normalizeProvider(settings.provider);
  const apiKey = providerKey(provider, settings.api_key);
  if (provider !== "huggingface" && !apiKey) {
    return { success: false, text: "", code: "no_key", error: `No ${provider} key is set. Enter it in AI settings.` };
  }
  return executeProvider(provider, apiKey, { ...settings, model: settings.model || DEFAULT_MODELS[provider] }, options);
}

async function executeProvider(provider: string, apiKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  if (provider !== "huggingface" && !apiKey) {
    return { success: false, text: "", code: "no_key", error: `No ${provider} key is set.` };
  }
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
      case "openrouter":
        return await runOpenAICompat("https://openrouter.ai/api/v1", apiKey, settings, options);
      case "anthropic":
        return await runAnthropic(apiKey, settings, options);
      default:
        return await runHuggingFaceRotation(apiKey, settings, options);
    }
  } catch (err: any) {
    return { success: false, text: "", error: err.message || "Provider error" };
  }
}


// Rotation order: A to E first, then the older single-key names. A key set under two
// names (e.g. HF_TOKEN_A and HUGGING_FACE_TOKEN) is only tried once.
const HF_TOKEN_NAMES = [
  "HF_TOKEN_A", "HF_TOKEN_B", "HF_TOKEN_C", "HF_TOKEN_D", "HF_TOKEN_E",
  "HUGGING_FACE_TOKEN", "HUGGINGFACE_TOKEN", "HF_TOKEN",
];

/** Hugging Face keys from the Supabase secrets, with the secret's name (never shown: the value). */
function huggingFaceTokenPool(settingsKey?: string): { label: string; token: string }[] {
  const pool: { label: string; token: string }[] = [];
  const add = (label: string, value?: string | null) => {
    const token = (value || "").trim();
    if (token && !pool.some((p) => p.token === token)) pool.push({ label, token });
  };
  add("the key in AI settings", cleanKey(settingsKey));
  for (const name of HF_TOKEN_NAMES) add(name, cleanKey(Deno.env.get(name)));
  return pool;
}

export function getHuggingFaceTokens(): string[] {
  return huggingFaceTokenPool().map((p) => p.token);
}

// Keys known to be out of credit or refused, remembered while this function instance
// stays warm, so each question doesn't spend a call on a key that can't answer.
// Remembered by a short fingerprint of the key, so replacing a secret clears it.
const benchedKeys = new Map<string, { reason: "out_of_credit" | "invalid_key"; until: number }>();
const fingerprint = (token: string) => `${token.slice(0, 6)}…${token.slice(-4)}:${token.length}`;
const CREDIT_BENCH_MS = 6 * 60 * 60 * 1000;
const INVALID_BENCH_MS = 30 * 60 * 1000;

function isBenched(token: string): boolean {
  const b = benchedKeys.get(fingerprint(token));
  if (!b) return false;
  if (Date.now() > b.until) { benchedKeys.delete(fingerprint(token)); return false; }
  return true;
}

// Models the Hugging Face router serves (checked against router.huggingface.co/v1/models
// on 2026-11-15). Tried in this order after the chosen model. A model it doesn't serve
// costs a wasted request before the next is tried.
export const HF_FALLBACK_MODELS = [
  "Qwen/Qwen2.5-72B-Instruct",
  "openai/gpt-oss-120b",
  "meta-llama/Llama-3.3-70B-Instruct",
  "deepseek-ai/DeepSeek-V3-0324",
  "meta-llama/Llama-3.1-8B-Instruct",
];

// A 403 that names the token is the key's fault; any other 403 (a gated model, a
// provider that refuses this model) is the model's, so the next model is tried.
const KEY_PERMISSION_WORDS = /inference provider|permission|scope|token|unauthori|not authenticated|fine-grained/i;

const CREDIT_WORDS = /credit|quota|exceeded|billing|payment required|subscribe to pro|insufficient|balance/i;

/**
 * Rotates through the Hugging Face keys (AI-settings key, then HF_TOKEN_A to E, then
 * the older names) and uses the first one that is set and still has credit. A key
 * that is out of credit or refused moves on to the next key; a model the router
 * doesn't serve moves on to the next model with the same key.
 */
async function runHuggingFaceRotation(dbKey: string, settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const pool = huggingFaceTokenPool(dbKey);
  if (pool.length === 0) {
    return { success: false, text: "", code: "no_key", error: "No Hugging Face key is set. Add one as the HF_TOKEN_A secret." };
  }

  const models = Array.from(new Set([settings.model, ...HF_FALLBACK_MODELS]))
    .filter((m): m is string => Boolean(m && m.trim().length > 0));

  const messages = [
    { role: "system", content: options.systemInstruction },
    ...options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
  ];

  // Try benched keys last rather than never: credit may have reset since.
  const ordered = [...pool.filter((p) => !isBenched(p.token)), ...pool.filter((p) => isBenched(p.token))];

  const keyStatus = new Map<string, string>();
  const unservedModels = new Set<string>();
  let outOfCredit = 0;
  let refused = 0;

  for (const { label, token } of ordered) {
    let keyDone = false;
    let tried = 0;
    let forbidden = 0;
    let lastForbidden = "";
    for (const model of models) {
      if (keyDone || unservedModels.has(model)) continue;
      tried++;

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
            signal: AbortSignal.timeout(45000),
          });
        } catch (err: any) {
          keyStatus.set(label, `no reply from Hugging Face (${err?.name === "TimeoutError" ? "timed out" : err?.message || "network error"})`);
          break;
        }

        const body = await res.json().catch(() => ({} as any));
        const detail = String(body?.error?.message || body?.error || "").slice(0, 160);

        if (res.ok) {
          const text = body?.choices?.[0]?.message?.content || "";
          if (text.trim().length > 0) {
            benchedKeys.delete(fingerprint(token));
            console.log(`[ai-runner] Answered with ${label} on ${model}`);
            return { success: true, text };
          }
          keyStatus.set(label, `${model} returned an empty reply`);
          break;
        }
        if (res.status === 402 || CREDIT_WORDS.test(detail)) {
          benchedKeys.set(fingerprint(token), { reason: "out_of_credit", until: Date.now() + CREDIT_BENCH_MS });
          keyStatus.set(label, "out of free monthly credit");
          outOfCredit++;
          keyDone = true;
          break;
        }
        if (res.status === 401 || (res.status === 403 && KEY_PERMISSION_WORDS.test(detail))) {
          benchedKeys.set(fingerprint(token), { reason: "invalid_key", until: Date.now() + INVALID_BENCH_MS });
          keyStatus.set(label, res.status === 401
            ? `refused: the key is invalid or expired${detail ? ` (${detail})` : ""}`
            : `not allowed: the token needs the "Make calls to Inference Providers" permission${detail ? ` (${detail})` : ""}`);
          refused++;
          keyDone = true;
          break;
        }
        if (res.status === 403) {
          // Refused for this model only; try the next one with the same key.
          forbidden++;
          lastForbidden = `${model}: ${detail || "HTTP 403"}`;
          keyStatus.set(label, `not allowed to use ${lastForbidden}`);
          break;
        }
        if (res.status === 429) { keyStatus.set(label, "rate-limited"); keyDone = true; break; }
        if (res.status >= 500 && attempt === 0) { await delay(800); continue; }
        if (res.status >= 500) { keyStatus.set(label, `${model} is down (HTTP ${res.status})`); break; }
        // 400/404/422: usually the router doesn't serve this model; try the next model
        unservedModels.add(model);
        keyStatus.set(label, `${model}: ${detail || `HTTP ${res.status}`}`);
        break;
      }
    }
    // Every model said 403: the key itself is the problem after all.
    if (!keyDone && tried > 0 && forbidden === tried) {
      benchedKeys.set(fingerprint(token), { reason: "invalid_key", until: Date.now() + INVALID_BENCH_MS });
      keyStatus.set(label, `not allowed on any model (last: ${lastForbidden}). Check the token has the "Make calls to Inference Providers" permission`);
      refused++;
    }
  }

  const code: AIFailureCode =
    outOfCredit + refused === pool.length ? (outOfCredit > 0 ? "out_of_credit" : "invalid_key") : "busy";
  const keyReport = pool.map(({ label }) => `${label}: ${keyStatus.get(label) || "no model answered"}`);
  return { success: false, text: "", code, error: `Hugging Face didn't answer. ${keyReport.join("; ")}.` };
}

export interface HFKeyPing {
  label: string;
  ok: boolean;
  model?: string;
  ms?: number;
  status?: number;
  detail: string;
}

/**
 * Pings every Hugging Face key in the rotation on its own with a tiny request, so the
 * Owner can see which keys work. Never returns key values, only the secret names.
 */
export async function pingHuggingFaceKeys(settingsKey: string, model?: string): Promise<HFKeyPing[]> {
  const pool = huggingFaceTokenPool(settingsKey);
  const models = Array.from(new Set([model, ...HF_FALLBACK_MODELS].filter((m): m is string => !!m && !!m.trim())));
  return Promise.all(pool.map(async ({ label, token }) => {
    let last: HFKeyPing = { label, ok: false, detail: "no model answered" };
    for (const m of models) {
      const started = Date.now();
      try {
        const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ model: m, messages: [{ role: "user", content: "Ping. Reply with the word pong." }], max_tokens: 8 }),
          signal: AbortSignal.timeout(25000),
        });
        const ms = Date.now() - started;
        const body = await res.json().catch(() => ({} as any));
        const detail = String(body?.error?.message || body?.error || "").slice(0, 200);
        if (res.ok) {
          benchedKeys.delete(fingerprint(token));
          return { label, ok: true, model: m, ms, status: res.status, detail: "answered" };
        }
        if (res.status === 402 || CREDIT_WORDS.test(detail)) {
          return { label, ok: false, model: m, ms, status: res.status, detail: `out of free monthly credit${detail ? ` (${detail})` : ""}` };
        }
        if (res.status === 401 || (res.status === 403 && KEY_PERMISSION_WORDS.test(detail))) {
          return {
            label, ok: false, model: m, ms, status: res.status,
            detail: res.status === 401
              ? `invalid or expired key${detail ? ` (${detail})` : ""}`
              : `missing the "Make calls to Inference Providers" permission${detail ? ` (${detail})` : ""}`,
          };
        }
        if (res.status === 429) return { label, ok: false, model: m, ms, status: 429, detail: "rate-limited, try again in a minute" };
        last = { label, ok: false, model: m, ms, status: res.status, detail: detail || `HTTP ${res.status}` };
        // 400/403/404/5xx on this model: try the next model with the same key.
      } catch (err: any) {
        last = { label, ok: false, model: m, detail: err?.name === "TimeoutError" ? "timed out" : (err?.message || "network error") };
      }
    }
    return last;
  }));
}

/**
 * Chat models a provider serves right now, read from its own model list. Hugging Face
 * and OpenRouter lists are public; the others need the key.
 */
export async function listProviderModels(provider: AIProvider, apiKey: string): Promise<string[]> {
  const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(String(body?.error?.message || body?.error || `HTTP ${res.status}`).slice(0, 200));
    return body;
  };
  const bearer = { Authorization: `Bearer ${apiKey}` };
  const ids = (body: any) => (Array.isArray(body?.data) ? body.data.map((m: any) => String(m.id)) : []) as string[];
  const notChat = /embed|whisper|tts|audio|realtime|transcribe|image|dall-e|moderation|search|guard|vision-exp|davinci|babbage/i;

  let list: string[] = [];
  switch (provider) {
    case "huggingface":
      list = ids(await get("https://router.huggingface.co/v1/models"));
      break;
    case "openrouter":
      list = ids(await get("https://openrouter.ai/api/v1/models"));
      break;
    case "gemini": {
      const body = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`);
      list = (body?.models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""));
      break;
    }
    case "openai":
      list = ids(await get("https://api.openai.com/v1/models", bearer)).filter((id) => /^(gpt|o\d|chatgpt)/.test(id));
      break;
    case "groq":
      list = ids(await get("https://api.groq.com/openai/v1/models", bearer));
      break;
    case "deepseek":
      list = ids(await get("https://api.deepseek.com/models", bearer));
      break;
    case "anthropic":
      list = ids(await get("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }));
      break;
  }
  return Array.from(new Set(list.filter((id) => id && !notChat.test(id)))).sort();
}

async function runOpenRouterFree(settings: AISettings, options: AIRunnerOptions): Promise<AIRunnerResult> {
  const freeModels = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-chat-v3-0324:free",
    "google/gemma-3-27b-it:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
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

  const baseModel = settings.model?.includes("gemini") ? settings.model : "gemini-2.5-flash";
  
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
    model: settings.model || DEFAULT_MODELS.anthropic,
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

