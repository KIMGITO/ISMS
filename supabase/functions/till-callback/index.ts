// supabase/functions/till-callback/index.ts
// Receives payments customers send straight to the till (Daraja C2B).
// Safaricom refuses callback URLs containing "mpesa", hence the name.
// Safaricom can't send a Supabase JWT, so the request is authorised by a secret token in the URL.
//   ?type=validation   accept every payment (only called if Safaricom enables validation)
//   ?type=confirmation record the payment; it lands in the queue unless it names an account number

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { BodyTooLarge, ipAllowed, MAX_CALLBACK_BYTES, readJson, safeEqual, securityEvent, tooLarge } from "../shared/guard.ts";

function reply(status = 200): Response {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const expected = Deno.env.get("MPESA_CALLBACK_TOKEN");
  if (req.method !== "POST" || !safeEqual(url.searchParams.get("token"), expected)) {
    await securityEvent("bad_token", "till-callback", req);
    return new Response("Forbidden", { status: 403 });
  }
  // Optional: Safaricom's published callback IPs, comma-separated (unset = any IP).
  if (!ipAllowed(req, "MPESA_ALLOWED_IPS")) {
    await securityEvent("ip_not_allowed", "till-callback", req);
    return new Response("Forbidden", { status: 403 });
  }

  if (url.searchParams.get("type") === "validation") return reply();

  try {
    let payload: any;
    try {
      payload = await readJson(req, MAX_CALLBACK_BYTES);
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        await securityEvent("too_large", "till-callback", req);
        return tooLarge();
      }
      throw e;
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await admin.rpc("record_till_payment", { p_raw: payload });
    if (error) throw error;
    console.log(`[till-callback] ${payload?.TransID}: ${data}`);
    return reply();
  } catch (err) {
    // A non-200 asks Safaricom to retry, so a database blip can't lose a payment.
    console.error("[till-callback]", err);
    return reply(500);
  }
});
