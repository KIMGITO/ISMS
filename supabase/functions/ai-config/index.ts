// supabase/functions/ai-config/index.ts
// Settings → AI for one business. The platform sets the AI up (provider, model, keys) for every
// company, own-key plans included (platform console; 20261205001). A business only switches the
// AI on or off, per use, and writes its assistant instructions.
//
//   get   → { enabled, uses, system_prompt, own_key }
//   save  → stores those three; anything else sent is ignored

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  requirePermission,
} from "../shared/cors.ts";

// The Settings → AI section: settings.integrations, or the AI permissions.
const AI_MANAGE = ["settings.integrations", "ai.configure", "ai.manage"];

/** The uses a business can switch off. Missing = on. */
const USES = ["assistant", "insights", "website", "messages"] as const;

function cleanUses(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (v && typeof v === "object") {
    for (const k of USES) {
      if ((v as any)[k] === false) out[k] = false;
    }
  }
  return out;
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

    const { errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    if (!action) return errorResponse("action is required.", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: aiPlan } = await supabase.rpc("fn_ai_plan", { p_business_id: businessId });
    const ownKey = aiPlan?.own_key === true;

    const shape = (row: any) => ({
      business_id: businessId,
      enabled: row ? row.enabled !== false : true,
      uses: cleanUses(row?.uses),
      system_prompt: row?.system_prompt || "",
      platform: true,
      own_key: ownKey,
    });

    if (action === "get") {
      const { data, error } = await supabase
        .from("ai_settings")
        .select("enabled, uses, system_prompt")
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) {
        console.error("[ai-config] get error:", error);
        return errorResponse("Failed to load the AI settings.", 500);
      }
      return jsonResponse({ success: true, config: shape(data) });
    }

    if (action === "save") {
      const denied = await requirePermission(req, businessId, ...AI_MANAGE);
      if (denied) return denied;
      if (!config) return errorResponse("config payload is required.", 400);

      const row = {
        business_id: businessId,
        enabled: config.enabled !== false,
        uses: cleanUses(config.uses),
        system_prompt: String(config.system_prompt || "").slice(0, 4000),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from("ai_settings")
        .upsert(row, { onConflict: "business_id" })
        .select("enabled, uses, system_prompt")
        .single();
      if (error) {
        console.error("[ai-config] save error:", error);
        const planErr = error.hint?.startsWith("plan_");
        return errorResponse(planErr ? error.message : "Failed to save the AI settings.", planErr ? 403 : 500);
      }
      return jsonResponse({ success: true, message: "AI settings saved.", config: shape(data) });
    }

    if (action === "test" || action === "ping" || action === "models") {
      return errorResponse("The AI is set up for you, so there is nothing to test or choose here.", 400);
    }

    return errorResponse(`Unknown action: "${action}"`, 400);
  } catch (err: any) {
    console.error("[ai-config] Critical error:", err);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});
