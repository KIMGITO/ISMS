// supabase/functions/airtel-callback/index.ts
// Airtel calls this when a payment prompt finishes. Airtel can't send a Supabase JWT, so the
// URL carries each business's own callback token (shown under Payments → Airtel Money; paste
// it as the callback URL in the Airtel developer portal).
//
// The body isn't trusted for money: a success is only recorded after Airtel's own status
// check says paid. A failure in the body is applied directly, since it moves no money.
//
// Body (Collection callback v1): { transaction: { id, message, status_code, airtel_money_id } }

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { BodyTooLarge, MAX_CALLBACK_BYTES, readJson, securityEvent, tooLarge } from "../shared/guard.ts";
import { outcomeOf } from "../airtel-payments/airtel.ts";
import { refreshPrompt } from "../airtel-payments/settle.ts";

const ok = () => new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!/^[0-9a-f]{48}$/.test(token)) {
    await securityEvent("bad_token", "airtel-callback", req);
    return new Response("Forbidden", { status: 403 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const { data: owner } = await admin
      .from("airtel_payment_secrets").select("business_id").eq("callback_token", token).maybeSingle();
    if (!owner) {
      await securityEvent("bad_token", "airtel-callback", req);
      return new Response("Forbidden", { status: 403 });
    }

    let payload: any = null;
    try {
      payload = await readJson(req, MAX_CALLBACK_BYTES);
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        await securityEvent("too_large", "airtel-callback", req);
        return tooLarge();
      }
    }
    const tx = payload?.transaction;
    const reference = typeof tx?.id === "string" ? tx.id : null;
    if (!reference || reference.length > 64) return ok();

    const { data: row } = await admin
      .from("airtel_transactions").select("*")
      .eq("business_id", owner.business_id).eq("reference", reference).maybeSingle();
    // Not ours (another app on the same Airtel account): nothing to do.
    if (!row) return ok();

    const status = await refreshPrompt(admin, row);
    // Airtel's status check may lag behind the callback. A failure moves no money, so it can
    // be taken from the callback; a success waits for the check (the app checks again).
    if (status === "Pending" && outcomeOf(tx.status_code) === "failed") {
      await admin.rpc("confirm_airtel_payment", {
        p_reference: reference,
        p_success: false,
        p_airtel_money_id: null,
        p_code: String(tx.status_code ?? ""),
        p_message: typeof tx.message === "string" ? tx.message.slice(0, 300) : null,
        p_raw: { source: "callback", transaction: tx },
      });
    }
    console.log(`[airtel-callback] ${reference}: ${status}`);
    return ok();
  } catch (err) {
    // A non-200 asks Airtel to retry, so a database blip can't lose a payment.
    console.error("[airtel-callback]", err);
    return new Response("Error", { status: 500 });
  }
});
