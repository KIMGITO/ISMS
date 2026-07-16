// supabase/edge_functions/sms-config/index.ts
// SMS Settings CRUD + Send — replaces /api/sms/config/* from local server.ts
// Reads and writes directly to the `sms_settings` Supabase table so all devices
// share the same Twilio credentials configured by the Owner.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
} from "../shared/cors.ts";

/** Masks a Twilio auth token: first 4 + •••••••• + last 4 */
function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••••••";
  return token.substring(0, 4) + "••••••••" + token.substring(token.length - 4);
}

/** Default unconfigured SMS config shape */
function defaultSmsConfig(businessId: string) {
  return {
    business_id: businessId,
    provider: "twilio",
    default_country: "+254",
    account_sid: "",
    auth_token: "",
    messaging_service_sid: "",
    from_phone_number: "",
    owner_phone_number: "",
    enabled: false,
    isConfigured: false,
  };
}

/** Normalises Kenyan phone numbers: 07xxx → +2547xxx */
function normalisePhone(phone: string): string {
  let clean = phone.replace(/[\s\-]/g, "");
  if (clean.startsWith("0")) clean = "254" + clean.substring(1);
  if (!clean.startsWith("+")) clean = "+" + clean;
  return clean;
}

/** Sends an SMS via Twilio REST API */
async function sendViaTwilio(cfg: {
  account_sid: string;
  auth_token: string;
  messaging_service_sid?: string;
  from_phone_number?: string;
  to: string;
  body: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!cfg.account_sid || !cfg.auth_token) {
    return { success: false, error: "Twilio Account SID or Auth Token is missing." };
  }
  if (!cfg.messaging_service_sid && !cfg.from_phone_number) {
    return { success: false, error: "Either From Phone or Messaging Service SID must be provided." };
  }

  // btoa works in Deno natively
  const auth = btoa(`${cfg.account_sid}:${cfg.auth_token}`);
  const params = new URLSearchParams();
  params.append("To", normalisePhone(cfg.to));
  params.append("Body", cfg.body);
  if (cfg.messaging_service_sid) {
    params.append("MessagingServiceSid", cfg.messaging_service_sid);
  } else if (cfg.from_phone_number) {
    params.append("From", cfg.from_phone_number);
  }

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.account_sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  const data = await resp.json();
  if (resp.ok) return { success: true, messageId: data.sid };
  return {
    success: false,
    error: data.message || `Twilio error ${data.code || resp.status}`,
  };
}

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { action, businessId, activeRole, config, to, body } =
      await req.json();

    if (!businessId) return errorResponse("businessId is required.", 400);
    if (!action) return errorResponse("action is required.", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── GET ──────────────────────────────────────────────────────────────
    if (action === "get") {
      const { data, error } = await supabase
        .from("sms_settings")
        .select("*")
        .eq("business_id", businessId)
        .maybeSingle();

      if (error) {
        console.error("[sms-config] get error:", error);
        return errorResponse("Failed to load SMS configuration.", 500);
      }

      if (!data) {
        return jsonResponse({ success: true, config: defaultSmsConfig(businessId) });
      }

      const isOwner = activeRole === "Owner";
      const maskedToken = data.auth_token
        ? isOwner ? maskToken(data.auth_token) : "••••••••"
        : "";

      return jsonResponse({
        success: true,
        config: {
          provider: "twilio",
          default_country: "+254",
          ...data,
          auth_token: maskedToken,
          isConfigured: !!data.auth_token,
        },
      });

    // ── SAVE ─────────────────────────────────────────────────────────────
    } else if (action === "save") {
      if (activeRole !== "Owner") {
        return errorResponse(
          "Access Denied: Only Owners can modify Twilio credentials.",
          403
        );
      }
      if (!config) return errorResponse("config payload is required.", 400);

      // Fetch existing token to avoid overwriting with masked placeholder
      const { data: existing } = await supabase
        .from("sms_settings")
        .select("auth_token")
        .eq("business_id", businessId)
        .maybeSingle();

      let tokenToSave = config.auth_token || "";
      if (tokenToSave.includes("••••")) {
        tokenToSave = existing?.auth_token || "";
      }

      const upsertPayload = {
        business_id: businessId,
        provider: config.provider || "twilio",
        default_country: config.default_country || "+254",
        account_sid: config.account_sid || "",
        auth_token: tokenToSave,
        messaging_service_sid: config.messaging_service_sid || "",
        from_phone_number: config.from_phone_number || "",
        owner_phone_number: config.owner_phone_number || "",
        enabled: !!config.enabled,
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error: saveErr } = await supabase
        .from("sms_settings")
        .upsert(upsertPayload, { onConflict: "business_id" })
        .select()
        .single();

      if (saveErr) {
        console.error("[sms-config] save error:", saveErr);
        return errorResponse("Failed to save SMS configuration.", 500);
      }

      return jsonResponse({
        success: true,
        message: "SMS configuration saved successfully.",
        config: {
          ...saved,
          auth_token: saved.auth_token ? "••••••••" : "",
          isConfigured: !!saved.auth_token,
        },
      });

    // ── TEST ─────────────────────────────────────────────────────────────
    } else if (action === "test") {
      if (activeRole !== "Owner") {
        return errorResponse(
          "Access Denied: Only Owners can test Twilio connections.",
          403
        );
      }
      if (!config?.account_sid) {
        return errorResponse("Account SID is required to test.", 400);
      }
      if (!config?.owner_phone_number) {
        return errorResponse("Owner phone number is required to send a test SMS.", 400);
      }

      // Resolve the real auth token (un-mask if needed)
      let tokenToTest = config.auth_token || "";
      if (tokenToTest.includes("••••")) {
        const { data: existing } = await supabase
          .from("sms_settings")
          .select("auth_token")
          .eq("business_id", businessId)
          .maybeSingle();
        tokenToTest = existing?.auth_token || "";
      }

      if (!tokenToTest) {
        return errorResponse("Auth Token is required to test the connection.", 400);
      }

      const testResult = await sendViaTwilio({
        account_sid: config.account_sid,
        auth_token: tokenToTest,
        messaging_service_sid: config.messaging_service_sid,
        from_phone_number: config.from_phone_number,
        to: config.owner_phone_number,
        body: `Test successful! Your KayKay's Milk POS SMS integration via "${config.provider || "twilio"}" is active and validated.`,
      });

      return jsonResponse({ success: testResult.success, ...testResult });

    // ── SEND ─────────────────────────────────────────────────────────────
    } else if (action === "send") {
      if (!to || !body) {
        return errorResponse("'to' and 'body' are required to send an SMS.", 400);
      }

      const { data: cfg } = await supabase
        .from("sms_settings")
        .select("*")
        .eq("business_id", businessId)
        .maybeSingle();

      if (!cfg || !cfg.enabled) {
        return errorResponse("SMS service is disabled or not configured for this business.", 400);
      }

      const sendResult = await sendViaTwilio({
        account_sid: cfg.account_sid,
        auth_token: cfg.auth_token,
        messaging_service_sid: cfg.messaging_service_sid,
        from_phone_number: cfg.from_phone_number,
        to,
        body,
      });

      return jsonResponse({ success: sendResult.success, ...sendResult });

    } else {
      return errorResponse(`Unknown action: "${action}"`, 400);
    }
  } catch (err: any) {
    console.error("[sms-config] Critical error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});
