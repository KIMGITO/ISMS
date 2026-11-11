// supabase/functions/card-webhook/index.ts
// Paystack calls this when a card payment finishes. Each business has its own Paystack
// account, so the reference finds the business, and that business's secret key must have
// signed the body. The amount isn't taken from the body: the payment is checked with Paystack
// and settled by settle_card_payment, which ignores repeats.
//
// Set this URL as the webhook on each Paystack dashboard: <project>/functions/v1/card-webhook

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { cardDetails, fromSubunits, paystack, signatureMatches, transactionOutcome } from "../card-payments/paystack.ts";

const ok = () => new Response("ok", { status: 200 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const data = event?.data ?? {};
    // Online payments carry our reference; reader payments carry the payment request code.
    const candidates = [data.reference, data.request_code, data.offline_reference, data.metadata?.reference]
      .filter((v) => typeof v === "string" && v.length > 0 && v.length < 100);
    if (candidates.length === 0) return ok();

    let row: any = null;
    for (const ref of candidates) {
      const { data: byRef } = await admin.from("card_payments").select("*").eq("reference", ref).maybeSingle();
      if (byRef) { row = byRef; break; }
      const { data: byProvider } = await admin.from("card_payments").select("*").eq("provider_reference", ref).maybeSingle();
      if (byProvider) { row = byProvider; break; }
    }
    // Not ours (another app on the same Paystack account): nothing to do, and Paystack stops retrying.
    if (!row) return ok();

    const { data: secretRow } = await admin.from("card_payment_secrets").select("secret_key").eq("business_id", row.business_id).maybeSingle();
    if (!secretRow?.secret_key) return ok();
    if (!(await signatureMatches(secretRow.secret_key, raw, req.headers.get("x-paystack-signature")))) {
      console.warn("[card-webhook] signature mismatch for", row.reference);
      return new Response("Invalid signature", { status: 401 });
    }
    if (row.status === "success") return ok();

    let success: boolean | null = null;
    let amount: number | null = null;
    let card = cardDetails(data);
    let providerRef: string | null = row.provider_reference;
    let reason: string | null = null;

    if (row.channel === "online") {
      const verify = await paystack(secretRow.secret_key, "GET", `/transaction/verify/${encodeURIComponent(row.reference)}`);
      if (!verify.ok || !verify.data) throw new Error(`verify failed: ${verify.message}`);
      const outcome = transactionOutcome(verify.data.status);
      if (outcome === "pending") return ok();
      success = outcome === "success" && String(verify.data.currency || "KES").toUpperCase() === row.currency;
      amount = fromSubunits(verify.data.amount);
      card = cardDetails(verify.data);
      providerRef = String(verify.data.id ?? providerRef ?? "");
      reason = verify.data.gateway_response ?? null;
    } else {
      const verify = await paystack(secretRow.secret_key, "GET", `/paymentrequest/verify/${encodeURIComponent(row.provider_reference)}`);
      if (!verify.ok || !verify.data) throw new Error(`paymentrequest verify failed: ${verify.message}`);
      if (verify.data.paid === true || verify.data.status === "success") {
        success = true;
        amount = fromSubunits(verify.data.amount);
        if (!card.last4) card = cardDetails(verify.data);
      } else if (event.event === "charge.failed" || event.event === "paymentrequest.failed") {
        success = false;
        reason = data.gateway_response ?? "Card was declined";
      } else {
        return ok();
      }
    }

    const { error } = await admin.rpc("settle_card_payment", {
      p_reference: row.reference,
      p_success: success,
      p_amount_paid: amount,
      p_provider_reference: providerRef,
      p_card_brand: card.brand,
      p_card_last4: card.last4,
      p_failure_reason: reason,
      p_raw: { source: "webhook", event: event.event },
    });
    if (error) throw error;
    return ok();
  } catch (err) {
    // A 500 makes Paystack try again later, so a passing outage doesn't lose the payment.
    console.error("[card-webhook]", err);
    return new Response("Error", { status: 500 });
  }
});
