// supabase/functions/till-callback/index.ts
// Receives payments customers send straight to the till (Daraja C2B).
// Safaricom refuses callback URLs containing "mpesa", hence the name.
// Safaricom can't send a Supabase JWT, so the request is authorised by a secret token in the URL.
//   ?type=validation   accept every payment (only called if Safaricom enabled validation on the
//                      short code; registration uses ResponseType "Completed" otherwise)
//   ?type=confirmation record the payment; it lands in the queue unless it names an account number
//   ?type=ping         reachability check after registration; stores nothing
// Every callback is stored before it is processed (shared/darajaInbox.ts).

import { handleDarajaCallback } from "../shared/darajaInbox.ts";

// Daraja C2B acknowledgement: ResultCode "0" accepts (validation and confirmation).
const reply = (status: number, resultCode: string, desc: string) =>
  new Response(JSON.stringify({ ResultCode: resultCode, ResultDesc: desc }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve((req) => handleDarajaCallback(req, {
  source: "till-callback",
  logPrefix: "c2b_callback",
  kind: (url) => url.searchParams.get("type") === "validation" ? "c2b_validation" : "c2b_confirmation",
  ack: () => reply(200, "0", "Accepted"),
  nack: (status, desc) => reply(status, "1", desc),
  key: (p) => p?.TransID,
  logFields: (p) => ({
    transId: p.TransID, transType: p.TransactionType ?? null,
    amount: p.TransAmount ?? null, shortCode: p.BusinessShortCode ?? null, billRef: p.BillRefNumber ?? null,
  }),
}));
