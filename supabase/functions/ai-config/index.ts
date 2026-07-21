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
} from "../shared/cors.ts";

import { runAI, getHuggingFaceTokens } from "../shared/ai-runner.ts";

/** Masks an API key: first 4 chars + •••••••• + last 4 chars */
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
    model: "Qwen/Qwen2.5-Coder-32B-Instruct",
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
    const { action, businessId, activeRole, config } = body;

    if (!businessId) return errorResponse("businessId is required.", 400);

    // Verify tenant membership
    const { errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    if (!action) return errorResponse("action is required.", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

      // Nothing configured yet — return safe defaults (Hugging Face default)
      if (!data) {
        return jsonResponse({ success: true, config: defaultConfig(businessId) });
      }

      const isOwner = activeRole === "Owner";
      const maskedKey = data.api_key
        ? isOwner ? maskKey(data.api_key) : "••••••••"
        : "";

      const provider = (data.provider || "huggingface").toLowerCase();

      return jsonResponse({
        success: true,
        config: {
          ...data,
          api_key: maskedKey,
          isConfigured: provider === "huggingface" || !!data.api_key,
        },
      });

    // ── SAVE ─────────────────────────────────────────────────────────────
    } else if (action === "save") {
      if (activeRole !== "Owner") {
        return errorResponse(
          "Access Denied: Only Owners can modify AI credentials.",
          403
        );
      }
      if (!config) return errorResponse("config payload is required.", 400);

      // Fetch existing key so we don't overwrite with a masked placeholder
      const { data: existing } = await supabase
        .from("ai_settings")
        .select("api_key")
        .eq("business_id", businessId)
        .maybeSingle();

      let keyToSave = config.api_key || "";
      if (keyToSave.includes("••••")) {
        // User submitted the masked display value — keep the real stored key
        keyToSave = existing?.api_key || "";
      }

      const provider = (config.provider || "huggingface").toLowerCase();
      const now = new Date().toISOString();
      const upsertPayload = {
        business_id: businessId,
        provider,
        api_key: keyToSave,
        model: config.model || (provider === "huggingface" ? "Qwen/Qwen2.5-Coder-32B-Instruct" : "gemini-2.5-flash"),
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
    } else if (action === "test") {
      const testConfig = config || defaultConfig(businessId);
      const testResult = await runAI(testConfig, {
        systemInstruction: "You are testing AI connectivity.",
        messages: [{ role: "user", content: "Ping" }],
      });

      if (testResult.success) {
        const hfTokens = getHuggingFaceTokens();
        const infoMsg = testConfig.provider === "huggingface"
          ? `Hugging Face Connection Verified! (${hfTokens.length} server rotation tokens active)`
          : `${testConfig.provider.toUpperCase()} AI Connection Verified!`;

        return jsonResponse({
          success: true,
          message: infoMsg,
          responseSample: testResult.text.slice(0, 100),
        });
      } else {
        return errorResponse(testResult.error || "AI Test connection failed.", 400);
      }

    } else {
      return errorResponse(`Unknown action: "${action}"`, 400);
    }
  } catch (err: any) {
    console.error("[ai-config] Critical error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});
