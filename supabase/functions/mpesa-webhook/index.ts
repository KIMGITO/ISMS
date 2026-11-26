// supabase/functions/mpesa-webhook/index.ts
// Receives Safaricom's STK callback, for online orders and for prompts sent from the app.
// Safaricom can't send a Supabase JWT, so the request is authorised by a secret token in the callback URL.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { BodyTooLarge, ipAllowed, MAX_CALLBACK_BYTES, readJson, securityEvent, tooLarge } from "../shared/guard.ts";
import { darajaKeysByToken } from "../customer-checkout/daraja.ts";

function ack(status = 200): Response {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  // Each business has its own token, so the token says whose prompt this is.
  const owner = req.method === "POST" ? await darajaKeysByToken(admin, new URL(req.url).searchParams.get("token")) : null;
  if (!owner) {
    await securityEvent("bad_token", "mpesa-webhook", req);
    return new Response("Forbidden", { status: 403 });
  }
  // Optional: Safaricom's published callback IPs, comma-separated (unset = any IP).
  if (!ipAllowed(req, "MPESA_ALLOWED_IPS")) {
    await securityEvent("ip_not_allowed", "mpesa-webhook", req);
    return new Response("Forbidden", { status: 403 });
  }

  try {
    let payload: any;
    try {
      payload = await readJson(req, MAX_CALLBACK_BYTES);
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        await securityEvent("too_large", "mpesa-webhook", req);
        return tooLarge();
      }
      throw e;
    }
    const callback = payload?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) return ack();

    const items: any[] = callback.CallbackMetadata?.Item ?? [];
    const value = (name: string) => items.find((i) => i.Name === name)?.Value ?? null;

    // A business's token can only settle that business's own prompts.
    const { data: prompt } = await admin.from("mpesa_transactions")
      .select("business_id").eq("checkout_request_id", callback.CheckoutRequestID).maybeSingle();
    if (prompt && prompt.business_id !== owner.businessId) {
      await securityEvent("bad_token", "mpesa-webhook", req);
      return new Response("Forbidden", { status: 403 });
    }

    const args = {
      p_checkout_request_id: callback.CheckoutRequestID,
      p_result_code: Number(callback.ResultCode),
      p_amount: value("Amount"),
      p_receipt: value("MpesaReceiptNumber"),
      p_raw: payload,
    };
    let { data, error } = await admin.rpc("confirm_online_order_payment", args);
    if (error) throw error;
    // Not an online order, so it may be a prompt staff sent from the app.
    if (data === "unknown") {
      ({ data, error } = await admin.rpc("confirm_store_payment_request", args));
      if (error) throw error;
    }

    console.log(`[mpesa-webhook] ${callback.CheckoutRequestID}: ${data}`);
    return ack();
  } catch (err) {
    // A non-200 asks Safaricom to retry, so a database blip can't lose a payment.
    console.error("[mpesa-webhook]", err);
    return ack(500);
  }
});
