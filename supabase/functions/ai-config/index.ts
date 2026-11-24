// supabase/edge_functions/ai-config/index.ts
// AI Settings CRUD — replaces POST /api/ai/config/get and POST /api/ai/config/save
// Reads and writes directly to the `ai_settings` Supabase table so all devices
// automatically share the same owner-configured API key and provider settings.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  requirePermission,
} from "../shared/cors.ts";

import {
  testProvider,
  ownerAIHint,
  pingHuggingFaceKeys,
  listProviderModels,
  normalizeProvider,
  cleanKey,
  isMaskedKey,
  currentModel,
  providerKey,
  DEFAULT_MODELS,
  AI_PROVIDERS,
} from "../shared/ai-runner.ts";

/** Masks an API key: first 4 chars + •••••••• + last 4 chars */
// The Settings → AI assistant section: settings.integrations, or the AI permissions.
const AI_MANAGE = ["settings.integrations", "ai.configure", "ai.manage"];

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return key.substring(0, 4) + "••••••••" + key.substring(key.length - 4);
}

/** Default unconfigured AI config shape */
function defaultConfig(businessId: string) {
  return {
    business_id: businessId,
    provider: "huggingface",
    model: "Qwen/Qwen2.5-72B-Instruct",
    temperature: 0.7,
    max_tokens: 2048,
    top_p: 0.95,
    top_k: 40,
    thinking_enabled: false,
    structured_output: false,
    system_prompt: "",
    enabled: true,
    api_key: "",
    isConfigured: true,
  };
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON payload", 400);
    }
    const { action, businessId, config } = body;

    if (!businessId) return errorResponse("businessId is required.", 400);

    // Verify tenant membership
    const { errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    if (!action) return errorResponse("action is required.", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // The platform runs the AI. Only a plan where the business brings its own key (Perpetual)
    // sets provider, model and key here; every other business sets only its instructions and
    // the on/off switch. A server without plans (before 20261204002) keeps the old screen.
    const { data: aiPlan, error: aiPlanErr } = await supabase.rpc("fn_ai_plan", { p_business_id: businessId });
    const platformRun = !aiPlanErr && !!aiPlan && aiPlan.own_key !== true;

    // ── GET ──────────────────────────────────────────────────────────────
    if (action === "get") {
      const { data, error } = await supabase
        .from("ai_settings")
        .select("*")
        .eq("business_id", businessId)
        .maybeSingle();

      if (error) {
        console.error("[ai-config] get error:", error);
        return errorResponse("Failed to load AI configuration.", 500);
      }

      if (platformRun) {
        return jsonResponse({
          success: true,
          config: {
            business_id: businessId,
            system_prompt: data?.system_prompt || "",
            enabled: data ? data.enabled !== false : true,
            platform: true,
            own_key: false,
            isConfigured: true,
          },
        });
      }

      // Nothing configured yet — return safe defaults (Hugging Face default)
      if (!data) {
        return jsonResponse({ success: true, config: { ...defaultConfig(businessId), own_key: aiPlan?.own_key === true } });
      }

      // Who may change AI settings sees the key's last characters; everyone else only dots.
      const canManage = (await requirePermission(req, businessId, ...AI_MANAGE)) === null;
      const maskedKey = data.api_key
        ? canManage ? maskKey(data.api_key) : "••••••••"
        : "";

      const provider = (data.provider || "huggingface").toLowerCase();

      return jsonResponse({
        success: true,
        config: {
          ...data,
          api_key: maskedKey,
          own_key: aiPlan?.own_key === true,
          isConfigured: provider === "huggingface" || !!data.api_key,
        },
      });

    // ── SAVE ─────────────────────────────────────────────────────────────
    } else if (action === "save") {
      const denied = await requirePermission(req, businessId, ...AI_MANAGE);
      if (denied) return denied;
      if (!config) return errorResponse("config payload is required.", 400);

      if (platformRun) {
        // Only the instructions and the switch belong to the business.
        const { error: saveErr } = await supabase
          .from("ai_settings")
          .upsert({
            business_id: businessId,
            system_prompt: String(config.system_prompt || "").slice(0, 4000),
            enabled: config.enabled !== false,
            updated_at: new Date().toISOString(),
          }, { onConflict: "business_id" });
        if (saveErr) {
          console.error("[ai-config] save error:", saveErr);
          return errorResponse(saveErr.hint?.startsWith("plan_") ? saveErr.message : "Failed to save AI configuration.", saveErr.hint?.startsWith("plan_") ? 403 : 500);
        }
        return jsonResponse({
          success: true,
          message: "Assistant instructions saved.",
          config: { business_id: businessId, system_prompt: config.system_prompt || "", enabled: config.enabled !== false, platform: true, own_key: false, isConfigured: true },
        });
      }

      const rawProvider = String(config.provider || "huggingface").toLowerCase();
      if (!(AI_PROVIDERS as readonly string[]).includes(rawProvider)) {
        return errorResponse(`Unknown AI provider "${rawProvider}". Choose one from the list.`, 400);
      }
      const provider = normalizeProvider(rawProvider);

      // Fetch existing key so we don't overwrite with a masked placeholder
      const { data: existing } = await supabase
        .from("ai_settings")
        .select("api_key, provider")
        .eq("business_id", businessId)
        .maybeSingle();

      let keyToSave: string;
      if (isMaskedKey(config.api_key)) {
        // The masked display value came back: keep the stored key, but only for the
        // provider it belongs to.
        keyToSave = normalizeProvider(existing?.provider) === provider ? (existing?.api_key || "") : "";
      } else {
        keyToSave = cleanKey(config.api_key);
        if (String(config.api_key || "").trim() && !keyToSave) {
          return errorResponse("That key has spaces or characters a key can't have. Paste it again.", 400);
        }
      }
      if (provider !== "huggingface" && !providerKey(provider, keyToSave)) {
        return errorResponse(`Enter the ${provider} API key before saving.`, 400);
      }

      const model = String(config.model || "").trim() || DEFAULT_MODELS[provider];
      if (/\s/.test(model)) return errorResponse("The model name can't contain spaces.", 400);

      const now = new Date().toISOString();
      const upsertPayload = {
        business_id: businessId,
        provider,
        api_key: keyToSave,
        model,
        temperature: Number(config.temperature ?? 0.7),
        max_tokens: Number(config.max_tokens ?? 2048),
        top_p: Number(config.top_p ?? 0.95),
        top_k: Number(config.top_k ?? 40),
        thinking_enabled: !!config.thinking_enabled,
        structured_output: !!config.structured_output,
        system_prompt: config.system_prompt || "",
        enabled: config.enabled !== false,
        updated_at: now,
      };

      const { data: saved, error: saveErr } = await supabase
        .from("ai_settings")
        .upsert(upsertPayload, { onConflict: "business_id" })
        .select()
        .single();

      if (saveErr) {
        console.error("[ai-config] save error:", saveErr);
        return errorResponse("Failed to save AI configuration.", 500);
      }

      return jsonResponse({
        success: true,
        message: "AI configuration saved successfully.",
        config: {
          ...saved,
          api_key: saved.api_key ? "••••••••" : "",
          isConfigured: provider === "huggingface" || !!saved.api_key,
        },
      });

    // ── TEST ─────────────────────────────────────────────────────────────
    } else if (action === "test" || action === "ping") {
      const denied = await requirePermission(req, businessId, ...AI_MANAGE);
      if (denied) return denied;
      if (platformRun) return errorResponse("The assistant is run for you. There is nothing to test here.", 400);
      const testConfig = { ...defaultConfig(businessId), ...(config || {}) };
      const provider = normalizeProvider(testConfig.provider);
      const model = String(testConfig.model || "").trim() || DEFAULT_MODELS[provider];

      // The screen only holds the masked key; use the stored one it stands for.
      const { data: stored } = await supabase
        .from("ai_settings")
        .select("api_key, provider")
        .eq("business_id", businessId)
        .maybeSingle();
      const storedKey = normalizeProvider(stored?.provider) === provider ? (stored?.api_key || "") : "";
      const apiKey = isMaskedKey(testConfig.api_key) || !String(testConfig.api_key || "").trim()
        ? cleanKey(storedKey)
        : cleanKey(testConfig.api_key);
      if (String(testConfig.api_key || "").trim() && !isMaskedKey(testConfig.api_key) && !apiKey) {
        return errorResponse("That key has spaces or characters a key can't have. Paste it again.", 400);
      }

      if (provider === "huggingface") {
        const keys = await pingHuggingFaceKeys(apiKey, model);
        if (keys.length === 0) return errorResponse(ownerAIHint("no_key"), 400);
        const working = keys.filter((k) => k.ok);
        const lines = keys.map((k) => `${k.ok ? "OK " : "BAD"} ${k.label}: ${k.detail}${k.model ? ` [${k.model}${k.ms != null ? `, ${k.ms} ms` : ""}]` : ""}`);
        const message = working.length > 0
          ? `Hugging Face answered: ${working.length} of ${keys.length} keys in the rotation work.\n${lines.join("\n")}`
          : `No Hugging Face key answered.\n${lines.join("\n")}`;
        return jsonResponse({ success: working.length > 0, message, error: working.length ? undefined : message, keys });
      }

      const started = Date.now();
      const testResult = await testProvider({ ...testConfig, provider, model, api_key: apiKey } as any, {
        systemInstruction: "You are testing AI connectivity. Reply with the word pong.",
        messages: [{ role: "user", content: "Ping" }],
      });
      const used = currentModel(provider, model);
      const swapped = used !== model ? ` (${model} was retired by ${provider}, so ${used} was used; choose it and save)` : "";
      if (testResult.success) {
        return jsonResponse({
          success: true,
          message: `${provider} answered on ${used} in ${Date.now() - started} ms: "${testResult.text.trim().slice(0, 60)}"${swapped}`,
        });
      }
      // This is the Owner's settings screen, so the provider's own reason helps them fix it.
      return errorResponse(`${provider} did not answer on ${used}${swapped}: ${testResult.error || ownerAIHint(testResult.code)}`, 400);

    // ── MODELS ───────────────────────────────────────────────────────────
    } else if (action === "models") {
      if (platformRun) return errorResponse("The assistant is run for you. There are no models to choose.", 400);
      const provider = normalizeProvider(config?.provider);
      let key = "";
      if (provider !== "huggingface" && provider !== "openrouter") {
        const denied = await requirePermission(req, businessId, ...AI_MANAGE);
        if (denied) return denied;
        if (isMaskedKey(config?.api_key) || !String(config?.api_key || "").trim()) {
          const { data: stored } = await supabase
            .from("ai_settings").select("api_key, provider").eq("business_id", businessId).maybeSingle();
          key = providerKey(provider, normalizeProvider(stored?.provider) === provider ? stored?.api_key : "");
        } else {
          key = cleanKey(config?.api_key);
        }
        if (!key) return errorResponse(`Enter the ${provider} key to load its models.`, 400);
      }
      try {
        const models = await listProviderModels(provider, key);
        return jsonResponse({ success: true, provider, models });
      } catch (err: any) {
        return errorResponse(`Could not load ${provider} models: ${err?.message || "no reply"}`, 400);
      }

    } else {
      return errorResponse(`Unknown action: "${action}"`, 400);
    }
  } catch (err: any) {
    console.error("[ai-config] Critical error:", err);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});
