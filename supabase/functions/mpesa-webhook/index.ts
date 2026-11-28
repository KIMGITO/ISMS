// supabase/functions/mpesa-webhook/index.ts
// Receives Safaricom's STK callback, for online orders and for prompts sent from the app.
// Safaricom can't send a Supabase JWT, so the request is authorised by a secret token in the callback URL.
// The callback is stored before it is processed (shared/darajaInbox.ts), so a database error or a
// callback that beats its prompt row is retried by payment-sweep instead of being lost.

import { handleDarajaCallback } from "../shared/darajaInbox.ts";

const reply = (status: number, resultCode: number, desc: string) =>
  new Response(JSON.stringify({ ResultCode: resultCode, ResultDesc: desc }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve((req) => handleDarajaCallback(req, {
  source: "mpesa-webhook",
  logPrefix: "stk_callback",
  kind: () => "stk",
  // Daraja only needs a 200; the body follows its documented acknowledgement.
  ack: () => reply(200, 0, "Accepted"),
  nack: (status, desc) => reply(status, 1, desc),
  key: (p) => p?.Body?.stkCallback?.CheckoutRequestID,
  logFields: (p) => {
    const cb = p.Body.stkCallback;
    return {
      checkoutRequestId: cb.CheckoutRequestID, merchantRequestId: cb.MerchantRequestID ?? null,
      resultCode: cb.ResultCode ?? null, resultDesc: cb.ResultDesc ?? null,
    };
  },
}));
