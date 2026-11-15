// supabase/functions/airtel-payments/index.ts
// Airtel Money for the shop. The client secret stays here; the app never sees it.
//
// Actions (businessId + a member's session):
//   status         what is set up, without the secret       (payments.view, payments.airtel, settings.integrations)
//   save_settings  check the keys with Airtel, then keep them (settings.integrations)
//   remove         forget the keys                           (settings.integrations)
//   request        send a payment prompt to an Airtel number (payments.airtel)
//   check          ask Airtel how a prompt went, and settle it (payments.airtel)
// The result also arrives at airtel-callback. Both settle through confirm_airtel_payment,
// which records the payment once.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors, jsonResponse, errorResponse, verifyUserMembership, requirePermission, enforceRateLimit,
} from "../shared/cors.ts";
import { MAX_AIRTEL_AMOUNT, accessToken, newReference, pushPayment, type AirtelKeys } from "./airtel.ts";
import { keysFor, refreshPrompt } from "./settle.ts";
import { toAirtelMsisdn } from "./phone.ts";

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

function callbackUrl(token: string): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/airtel-callback?token=${encodeURIComponent(token)}`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const body = await req.json().catch(() => ({}));
    const { action, businessId } = body;
    if (!businessId) return errorResponse("businessId is required.", 400);

    const { userId, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;
    const admin = adminClient();

    const staffName = async (): Promise<string> => {
      const { data } = await admin.from("users").select("name").eq("id", userId).maybeSingle();
      return data?.name || "Staff";
    };

    if (action === "status") {
      const denied = await requirePermission(req, businessId, "payments.view", "payments.airtel", "settings.integrations");
      if (denied) return denied;
      const [{ data: settings }, { data: secret }, { data: enabled }, canConfigure] = await Promise.all([
        admin.from("airtel_payment_settings").select("*").eq("business_id", businessId).maybeSingle(),
        admin.from("airtel_payment_secrets").select("client_id, callback_token").eq("business_id", businessId).maybeSingle(),
        admin.rpc("fn_method_enabled", { p_business_id: businessId, p_method: "Airtel Money" }),
        requirePermission(req, businessId, "settings.integrations").then((r) => r === null),
      ]);
      return jsonResponse({
        success: true,
        configured: Boolean(settings && secret),
        enabled: enabled === true,
        environment: settings?.environment ?? "staging",
        country: settings?.country ?? "KE",
        currency: settings?.currency ?? "KES",
        merchantCode: settings?.merchant_code ?? null,
        status: settings?.status ?? null,
        lastError: settings?.last_error ?? null,
        // Only people who set Airtel up see where the callback goes and which app it is.
        clientIdHint: canConfigure && secret ? `…${String(secret.client_id).slice(-4)}` : null,
        callbackUrl: canConfigure && secret ? callbackUrl(secret.callback_token) : null,
      });
    }

    if (action === "save_settings") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;

      const { data: existing } = await admin
        .from("airtel_payment_secrets").select("client_id, client_secret, callback_token").eq("business_id", businessId).maybeSingle();
      const clientId = String(body.clientId ?? "").trim() || existing?.client_id || "";
      const clientSecret = String(body.clientSecret ?? "").trim() || existing?.client_secret || "";
      if (!clientId || !clientSecret) return errorResponse("Paste the client ID and client secret from your Airtel app.", 400);

      const environment = body.environment === "production" ? "production" : "staging";
      const country = String(body.country ?? "KE").trim().toUpperCase();
      const currency = String(body.currency ?? "KES").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(currency)) return errorResponse("Country is 2 letters (KE) and currency 3 (KES).", 400);
      const merchantCode = String(body.merchantCode ?? "").replace(/\s/g, "") || null;
      if (merchantCode && !/^[A-Za-z0-9]{3,20}$/.test(merchantCode)) return errorResponse("The merchant code is 3 to 20 letters or digits.", 400);

      const keys: AirtelKeys = { clientId, clientSecret, environment, country, currency };
      const auth = await accessToken(keys);
      if (auth.ok === false) {
        return errorResponse(
          `Airtel didn't accept these keys for ${environment === "production" ? "live" : "test (staging)"}: ${auth.detail}`,
          400, "KEYS_REJECTED",
        );
      }

      const token = existing?.callback_token || randomToken();
      const now = new Date().toISOString();
      const { error: secretError } = await admin.from("airtel_payment_secrets").upsert({
        business_id: businessId, client_id: clientId, client_secret: clientSecret, callback_token: token, updated_at: now,
      });
      if (secretError) throw secretError;
      const { error: settingsError } = await admin.from("airtel_payment_settings").upsert({
        business_id: businessId, environment, country, currency, merchant_code: merchantCode,
        status: "connected", last_error: null, updated_by: await staffName(), updated_at: now,
      });
      if (settingsError) throw settingsError;
      return jsonResponse({ success: true, callbackUrl: callbackUrl(token) });
    }

    if (action === "remove") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      await admin.from("airtel_payment_secrets").delete().eq("business_id", businessId);
      await admin.from("airtel_payment_settings").delete().eq("business_id", businessId);
      return jsonResponse({ success: true });
    }

    if (action === "request") {
      const denied = await requirePermission(req, businessId, "payments.airtel");
      if (denied) return denied;
      const limited =
        (await enforceRateLimit(`airtel-prompt:user:${userId}`, 60, 3600)) ||
        (await enforceRateLimit(`airtel-prompt:biz:${businessId}`, 600, 86400));
      if (limited) return limited;

      const { data: enabled } = await admin.rpc("fn_method_enabled", { p_business_id: businessId, p_method: "Airtel Money" });
      if (enabled !== true) return errorResponse("Airtel Money is switched off for this business.", 409, "METHOD_OFF");
      const keys = await keysFor(admin, businessId);
      if (!keys) return errorResponse("Airtel Money isn't set up for this business yet.", 400, "NOT_CONFIGURED");

      const msisdn = toAirtelMsisdn(body.phone);
      if (!msisdn) return errorResponse("Enter an Airtel number like 0733 123 456.", 400);
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AIRTEL_AMOUNT) {
        return errorResponse(`Airtel Money takes whole shillings from 1 to ${MAX_AIRTEL_AMOUNT.toLocaleString()}.`, 400);
      }

      let customerId: string | null = null;
      let shownReference = "Payment";
      if (body.customerId) {
        const { data: customer } = await admin
          .from("customers").select("id, account_number")
          .eq("id", body.customerId).eq("business_id", businessId).is("deleted_at", null).maybeSingle();
        if (!customer) return errorResponse("Customer not found.", 404);
        customerId = customer.id;
        shownReference = `Acc ${customer.account_number}`;
      }

      // Saved first, so a quick callback finds it.
      const reference = newReference();
      const description = String(body.description ?? "").trim().slice(0, 200) || null;
      const { data: row, error } = await admin.from("airtel_transactions").insert({
        business_id: businessId,
        reference,
        phone: `254${msisdn}`,
        amount,
        customer_id: customerId,
        description,
        requested_by: await staffName(),
      }).select("id, reference").single();
      if (error) throw error;

      const push = await pushPayment(keys, msisdn, amount, reference, shownReference);
      if (!push.accepted) {
        console.error("[airtel-payments] push rejected:", push.detail);
        await admin.from("airtel_transactions")
          .update({ status: "Failed", result_message: `Not sent: ${push.detail ?? "Airtel refused the request"}`, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        return errorResponse(`Airtel didn't send the prompt: ${push.detail ?? "check the number and try again"}.`, 502, "PUSH_REJECTED");
      }
      return jsonResponse({ success: true, id: row.id, reference: row.reference });
    }

    if (action === "check") {
      const denied = await requirePermission(req, businessId, "payments.airtel");
      if (denied) return denied;
      const { data: row } = await admin
        .from("airtel_transactions").select("*")
        .eq("business_id", businessId).eq("id", body.id).maybeSingle();
      if (!row) return errorResponse("Payment prompt not found.", 404);
      const status = await refreshPrompt(admin, row);
      return jsonResponse({ success: true, status });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err) {
    console.error("[airtel-payments]", err);
    return errorResponse("Something went wrong with Airtel Money. Please try again.", 500);
  }
});
