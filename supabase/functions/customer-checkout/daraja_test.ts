// Daraja client against a local mock of Safaricom (MPESA_SANDBOX_URL). The mock answers in the
// shapes the real sandbox returned on 2026-11-28 (bad keys: HTTP 400 with an empty body; bad
// token: errorCode 404.001.03). Simulated, not Safaricom.
//   deno test --allow-net --allow-env supabase/functions/customer-checkout/daraja_test.ts

// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accessToken, DarajaKeys, forgetToken, registerC2bUrls, stkPush, stkQuery, timestamp } from "./daraja.ts";

type Handler = (path: string, req: Request, body: any) => Response | Promise<Response>;
let handler: Handler = () => new Response("{}");
const seen: { path: string; auth: string | null; body: any }[] = [];

const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  const path = new URL(req.url).pathname;
  const text = await req.text();
  const body = text ? JSON.parse(text) : null;
  seen.push({ path, auth: req.headers.get("authorization"), body });
  return handler(path, req, body);
});
Deno.env.set("MPESA_SANDBOX_URL", `http://localhost:${server.addr.port}`);

const keys: DarajaKeys = {
  businessId: "b1",
  environment: "sandbox",
  consumerKey: "consumerkey",
  consumerSecret: "consumersecret",
  passkey: "test-passkey",
  shortcode: "174379",
  partyB: null,
  transactionType: "CustomerPayBillOnline",
  callbackToken: "a".repeat(48),
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
let tokenCount = 0;
const oauth = (path: string) => {
  if (path === "/oauth/v1/generate") {
    tokenCount++;
    return json({ access_token: `tok${tokenCount}`, expires_in: "3599" });
  }
  return null;
};
const reset = () => {
  seen.length = 0;
  tokenCount = 0;
  forgetToken();
};

Deno.test("timestamp is Nairobi time YYYYMMDDHHmmss", () => {
  assertEquals(timestamp(Date.UTC(2026, 10, 28, 21, 5, 9)), "20261129000509");
});

Deno.test("OAuth: Basic header, token cached across calls", async () => {
  reset();
  handler = (p) => oauth(p) ?? json({});
  assertEquals(await accessToken(keys), "tok1");
  assertEquals(await accessToken(keys), "tok1");
  assertEquals(tokenCount, 1);
  assertEquals(seen[0].auth, `Basic ${btoa("consumerkey:consumersecret")}`);
});

Deno.test("OAuth: wrong keys (400, empty body) is an auth error", async () => {
  reset();
  handler = () => new Response("", { status: 400 });
  const err = await accessToken(keys).then(() => null, (e) => e);
  assertEquals(err?.kind, "auth");
});

Deno.test("OAuth: 200 without access_token is refused, not cached", async () => {
  reset();
  handler = () => json({ errorMessage: "weird" });
  const err = await accessToken(keys).then(() => null, (e) => e);
  assert(err);
});

Deno.test("STK push: request matches Daraja spec and accepted result is parsed", async () => {
  reset();
  handler = (p) => oauth(p) ?? json({
    MerchantRequestID: "29115-34620561-1", CheckoutRequestID: "ws_CO_191220191020363925",
    ResponseCode: "0", ResponseDescription: "Success. Request accepted for processing", CustomerMessage: "Success. Request accepted for processing",
  });
  const r = await stkPush(keys, "254708374149", 10, "ACCOUNTREF12345", "https://x.test/cb?token=t", "Payment for goods");
  assertEquals(r.accepted, true);
  assertEquals(r.checkoutRequestId, "ws_CO_191220191020363925");
  assertEquals(r.merchantRequestId, "29115-34620561-1");
  const req = seen.find((s) => s.path === "/mpesa/stkpush/v1/processrequest")!;
  assertEquals(req.auth, "Bearer tok1");
  const b = req.body;
  assertEquals(b.BusinessShortCode, "174379");
  assert(/^\d{14}$/.test(b.Timestamp));
  assertEquals(b.Password, btoa(`174379${keys.passkey}${b.Timestamp}`));
  assertEquals(b.TransactionType, "CustomerPayBillOnline");
  assertEquals([b.Amount, b.PartyA, b.PartyB, b.PhoneNumber], [10, "254708374149", "174379", "254708374149"]);
  assertEquals(b.AccountReference, "ACCOUNTREF12");
  assertEquals(b.TransactionDesc, "Payment for g");
  assertEquals(b.CallBackURL, "https://x.test/cb?token=t");
});

Deno.test("STK push: decimal / zero amounts never reach Safaricom", async () => {
  reset();
  handler = (p) => oauth(p) ?? json({ ResponseCode: "0", CheckoutRequestID: "c" });
  for (const a of [1.5, 0, 250001]) assertEquals((await stkPush(keys, "254708374149", a, "R", "u")).accepted, false);
  assertEquals(seen.length, 0);
});

Deno.test("STK push: Safaricom rejection (invalid phone) is reported with its message", async () => {
  reset();
  handler = (p) => oauth(p) ?? json({ requestId: "1", errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" }, 400);
  const r = await stkPush(keys, "254700000000", 1, "R", "u");
  assertEquals(r.accepted, false);
  assertEquals(r.detail, "Bad Request - Invalid PhoneNumber");
});

Deno.test("Expired token: renewed once and the call succeeds", async () => {
  reset();
  let first = true;
  handler = (p) => {
    const o = oauth(p);
    if (o) return o;
    if (first) {
      first = false;
      return json({ requestId: "", errorCode: "404.001.03", errorMessage: "Invalid Access Token" }, 404);
    }
    return json({ ResponseCode: "0", CheckoutRequestID: "c2", MerchantRequestID: "m2" });
  };
  const r = await stkPush(keys, "254708374149", 1, "R", "u");
  assertEquals(r.accepted, true);
  assertEquals(tokenCount, 2);
  assertEquals(seen.filter((s) => s.path.startsWith("/mpesa")).map((s) => s.auth), ["Bearer tok1", "Bearer tok2"]);
});

Deno.test("Network failure: STK reports not sent; query reports no answer (not failed)", async () => {
  reset();
  const dead = { ...keys, consumerKey: "deadkey12345" };
  Deno.env.set("MPESA_SANDBOX_URL", "http://127.0.0.1:1");
  assertEquals((await stkPush(dead, "254708374149", 1, "R", "u")).accepted, false);
  assertEquals(await stkQuery(dead, "c"), null);
  Deno.env.set("MPESA_SANDBOX_URL", `http://localhost:${server.addr.port}`);
});

Deno.test("STK query: final codes, still processing, and errors", async () => {
  reset();
  let answer: Response | (() => Response) = () => json({});
  handler = (p) => oauth(p) ?? (typeof answer === "function" ? answer() : answer);
  answer = () => json({ ResponseCode: "0", ResultCode: "0", ResultDesc: "The service request is processed successfully." });
  assertEquals(await stkQuery(keys, "c"), 0);
  answer = () => json({ ResponseCode: "0", ResultCode: "1032", ResultDesc: "Request cancelled by user" });
  assertEquals(await stkQuery(keys, "c"), 1032);
  answer = () => json({ requestId: "x", errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }, 500);
  assertEquals(await stkQuery(keys, "c"), null);
  answer = () => json({ ResponseCode: "0", ResultCode: "4999", ResultDesc: "still under processing" });
  assertEquals(await stkQuery(keys, "c"), null);
  answer = () => new Response("<html>busy</html>", { status: 503 });
  assertEquals(await stkQuery(keys, "c"), null);
  const q = seen.find((s) => s.path === "/mpesa/stkpushquery/v1/query")!.body;
  assertEquals(q.CheckoutRequestID, "c");
  assertEquals(q.Password, btoa(`174379${keys.passkey}${q.Timestamp}`));
  assertEquals(tokenCount, 1);
});

Deno.test("C2B register: payload, success, rejection, duplicate", async () => {
  reset();
  let answer = json({});
  handler = (p) => oauth(p) ?? answer.clone();
  answer = json({ OriginatorCoverstionID: "x", ResponseCode: "0", ResponseDescription: "Success" });
  const ok = await registerC2bUrls(keys, "600999", "https://h/till-callback?type=confirmation&token=t", "https://h/till-callback?type=validation&token=t");
  assertEquals(ok.ok, true);
  const b = seen.find((s) => s.path === "/mpesa/c2b/v2/registerurl")!.body;
  assertEquals(b, { ShortCode: "600999", ResponseType: "Completed", ConfirmationURL: "https://h/till-callback?type=confirmation&token=t", ValidationURL: "https://h/till-callback?type=validation&token=t" });
  // HTTP 200 alone is not success.
  answer = json({ ResponseCode: "1", ResponseDescription: "Invalid ConfirmationURL" });
  assertEquals((await registerC2bUrls(keys, "600999", "c", "v")).ok, false);
  answer = json({ requestId: "x", errorCode: "500.003.1001", errorMessage: "Duplicate notification info" }, 500);
  const dup = await registerC2bUrls(keys, "600999", "c", "v");
  assertEquals([dup.ok, dup.duplicate], [false, true]);
});

Deno.test({ name: "stop mock", fn: async () => { await server.shutdown(); }, sanitizeOps: false, sanitizeResources: false });
