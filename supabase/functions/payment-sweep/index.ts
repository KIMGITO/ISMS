// supabase/functions/payment-sweep/index.ts
// Called every 2 minutes by run_payment_sweep (pg_cron, 20261212008). Service key only.
// Deploy with --no-verify-jwt: the Vault key may be an sb_secret_ key, which the JWT gate refuses.
//
// 1. Prompts whose Safaricom callback is overdue are settled from Safaricom's status query, so a
//    paid prompt is recorded within minutes even if the callback is lost and nobody is watching.
// 2. Sandbox tills are registered again: the sandbox short codes (600000...) are shared by every
//    Daraja developer and the last registration wins, so ours is renewed every few minutes.
//    Live tills are registered once by the owner and never touched here.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { isServiceKey } from "../shared/guard.ts";
import { darajaKeys, DarajaKeys } from "../customer-checkout/daraja.ts";
import { PAID_GRACE_SECONDS, registerTill, settlePrompt } from "../mpesa-payments/settle.ts";

const MAX_PROMPTS = 50;
const RENEW_SANDBOX_MINUTES = 4;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST" || !(await isServiceKey(req))) return json({ error: "Not allowed." }, 403);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const keyCache = new Map<string, DarajaKeys | null>();
  const keysFor = async (businessId: string) => {
    if (!keyCache.has(businessId)) keyCache.set(businessId, await darajaKeys(admin, businessId));
    return keyCache.get(businessId)!;
  };

  const out = { prompts: 0, settled: 0, renewed: 0, errors: 0 };

  // 1. Overdue prompts from the last day.
  const now = Date.now();
  const { data: prompts, error } = await admin.from("mpesa_transactions")
    .select("business_id, checkout_request_id, created_at, amount, online_order_id")
    .eq("status", "Pending")
    .not("checkout_request_id", "is", null)
    .lt("created_at", new Date(now - PAID_GRACE_SECONDS * 1000).toISOString())
    .gt("created_at", new Date(now - 86400_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_PROMPTS);
  if (error) {
    console.error("[payment-sweep] prompts:", error.message);
    return json({ error: "Couldn't read prompts." }, 500);
  }
  for (const row of prompts ?? []) {
    out.prompts++;
    try {
      const keys = await keysFor(row.business_id);
      if (!keys) continue;
      const result = await settlePrompt(admin, keys, row);
      if (result.status !== "Pending") out.settled++;
    } catch (err) {
      out.errors++;
      console.error("[payment-sweep]", row.checkout_request_id, (err as Error).message);
    }
  }

  // 2. Sandbox tills registered earlier: register again so test payments keep arriving.
  const { data: tills } = await admin.from("mpesa_settings")
    .select("business_id, till_number, registered_at")
    .not("registered_at", "is", null)
    .lt("registered_at", new Date(now - RENEW_SANDBOX_MINUTES * 60_000).toISOString());
  for (const t of tills ?? []) {
    try {
      const keys = await keysFor(t.business_id);
      if (!keys || keys.environment !== "sandbox") continue;
      const result = await registerTill(admin, keys, t.till_number ?? "", "Automatic");
      if (result.ok) out.renewed++;
      else console.error("[payment-sweep] renew", t.business_id, result.detail);
    } catch (err) {
      out.errors++;
      console.error("[payment-sweep] renew", t.business_id, (err as Error).message);
    }
  }

  console.log("[payment-sweep]", JSON.stringify(out));
  return json(out);
});
