// supabase/functions/whatsapp-config/index.ts
// Optional WhatsApp Cloud API connection. Actions: status | get | save | send
// Without it, staff send by SMS or email, or open each chat by hand.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  requirePermission,
  contactAllowed,
  enforceRateLimit,
} from "../shared/cors.ts";

const GRAPH_URL = "https://graph.facebook.com/v21.0";

function isConnected(cfg: any): boolean {
  return !!(cfg?.enabled && cfg.phone_number_id && cfg.access_token);
}

// WhatsApp only allows free text within 24 hours of the customer's last message.
// Anything else needs an approved template, which carries the text as its one variable.
function messagePayload(cfg: any, to: string, body: string) {
  const base = { messaging_product: "whatsapp", to };
  if (!cfg.template_name) return { ...base, type: "text", text: { body } };
  return {
    ...base,
    type: "template",
    template: {
      name: cfg.template_name,
      language: { code: cfg.template_language || "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: body }] }],
    },
  };
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { action, businessId, config, to, body, purpose } = await req.json().catch(() => ({}));
    if (!businessId) return errorResponse("businessId is required.", 400);

    const { userId, role, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: cfg, error: loadError } = await admin
      .from("whatsapp_settings")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();
    if (loadError) throw loadError;

    if (action === "status") {
      return jsonResponse({ success: true, connected: isConnected(cfg) });
    }

    if (action === "get" || action === "save") {
      if (role !== "Owner" && role !== "Admin") {
        return errorResponse("Only the Owner or an Admin can manage WhatsApp settings.", 403);
      }
    }

    if (action === "get") {
      // The token never goes back to the browser.
      return jsonResponse({
        success: true,
        config: {
          enabled: cfg?.enabled ?? false,
          phoneNumberId: cfg?.phone_number_id ?? "",
          templateName: cfg?.template_name ?? "",
          templateLanguage: cfg?.template_language ?? "en",
          hasToken: !!cfg?.access_token,
        },
      });
    }

    if (action === "save") {
      const { error } = await admin.from("whatsapp_settings").upsert({
        business_id: businessId,
        enabled: !!config?.enabled,
        phone_number_id: config?.phoneNumberId || null,
        // A blank token keeps the one already saved.
        access_token: config?.accessToken || cfg?.access_token || null,
        template_name: config?.templateName || null,
        template_language: config?.templateLanguage || "en",
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    if (action === "send") {
      if (!to || !body) return errorResponse("A number and a message are required.", 400);
      if (!isConnected(cfg)) return errorResponse("WhatsApp is not connected.", 400, "NOT_CONNECTED");

      const forbidden = await requirePermission(req, businessId, "communication.send");
      if (forbidden) return forbidden;

      const limited =
        (await enforceRateLimit(`whatsapp:user:${userId}`, 200, 3600)) ||
        (await enforceRateLimit(`whatsapp:biz:${businessId}`, 1000, 86400));
      if (limited) return limited;

      if (!(await contactAllowed(businessId, to, null, purpose))) {
        return jsonResponse({ success: false, optedOut: true });
      }

      const res = await fetch(`${GRAPH_URL}/${cfg.phone_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(messagePayload(cfg, String(to).replace(/\D/g, ""), String(body))),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        console.error("[whatsapp-config] Send rejected:", res.status, detail?.error?.code);
        return errorResponse("WhatsApp couldn't send this message.", 502, "SEND_REJECTED");
      }
      return jsonResponse({ success: true });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err) {
    console.error("[whatsapp-config]", err);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});
