// supabase/functions/till-callback/index.ts
// Receives payments customers send straight to the till (Daraja C2B).
// Safaricom refuses callback URLs containing "mpesa", hence the name.
// Safaricom can't send a Supabase JWT, so the request is authorised by a secret token in the URL.
//   ?type=validation   accept every payment (only called if Safaricom enables validation)
//   ?type=confirmation record the payment; it lands in the queue unless it names an account number

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

function reply(status = 200): Response {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const expected = Deno.env.get("MPESA_CALLBACK_TOKEN");
  if (req.method !== "POST" || !expected || url.searchParams.get("token") !== expected) {
    return new Response("Forbidden", { status: 403 });
  }

  if (url.searchParams.get("type") === "validation") return reply();

  try {
    const payload = await req.json();
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
