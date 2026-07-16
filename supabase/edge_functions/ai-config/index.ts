// supabase/edge_functions/ai-config/index.ts
// AI Settings CRUD — replaces POST /api/ai/config/get and POST /api/ai/config/save
// Reads and writes directly to the `ai_settings` Supabase table so all devices
// automatically share the same owner-configured API key and provider settings.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
} from "../shared/cors.ts";

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
    provider: "gemini",
    model: "gemini-2.5-flash",
    temperature: 0.7,
    max_tokens: 2048,
    top_p: 0.95,
    top_k: 40,
    thinking_enabled: false,
    structured_output: false,
    system_prompt: "",
    enabled: true,
    api_key: "",
    isConfigured: false,
  };
}

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { action, businessId, activeRole, config } = await req.json();

    if (!businessId) return errorResponse("businessId is required.", 400);
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

      // Nothing configured yet — return safe defaults
      if (!data) {
        return jsonResponse({ success: true, config: defaultConfig(businessId) });
      }

      const isOwner = activeRole === "Owner";
      const maskedKey = data.api_key
        ? isOwner ? maskKey(data.api_key) : "••••••••"
        : "";

      return jsonResponse({
        success: true,
        config: {
          ...data,
          api_key: maskedKey,
          isConfigured: !!data.api_key,
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

      const now = new Date().toISOString();
      const upsertPayload = {
        business_id: businessId,
        provider: config.provider || "gemini",
        api_key: keyToSave,
        model: config.model || "gemini-2.5-flash",
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
          isConfigured: !!saved.api_key,
        },
      });

    } else {
      return errorResponse(`Unknown action: "${action}"`, 400);
    }
  } catch (err: any) {
    console.error("[ai-config] Critical error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});
