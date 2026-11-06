// supabase/functions/mpesa-webhook/index.ts
// Receives Safaricom's STK callback, for online orders and for prompts sent from the app.
// Safaricom can't send a Supabase JWT, so the request is authorised by a secret token in the callback URL.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

function ack(status = 200): Response {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("MPESA_CALLBACK_TOKEN");
  const token = new URL(req.url).searchParams.get("token");
  if (req.method !== "POST" || !expected || token !== expected) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const payload = await req.json();
    const callback = payload?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) return ack();

    const items: any[] = callback.CallbackMetadata?.Item ?? [];
    const value = (name: string) => items.find((i) => i.Name === name)?.Value ?? null;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
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
