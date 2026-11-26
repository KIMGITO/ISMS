// supabase/functions/customer-checkout/daraja.ts
// Safaricom Daraja client. Each business connects its own Daraja app, so every call takes
// that business's keys (mpesa_payment_secrets, readable by edge functions only).

// deno-lint-ignore-file no-explicit-any

export interface DarajaKeys {
  businessId: string;
  environment: "sandbox" | "production";
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  partyB: string | null;
  transactionType: "CustomerBuyGoodsOnline" | "CustomerPayBillOnline";
  callbackToken: string;
}

/** This business's Daraja keys, or null when it hasn't connected M-Pesa. */
export async function darajaKeys(admin: any, businessId: string): Promise<DarajaKeys | null> {
  const { data } = await admin.from("mpesa_payment_secrets").select("*").eq("business_id", businessId).maybeSingle();
  return data ? fromRow(data) : null;
}

/** Finds the business a callback belongs to by the token in its URL. */
export async function darajaKeysByToken(admin: any, token: string | null): Promise<DarajaKeys | null> {
  if (!token || !/^[0-9a-f]{48}$/.test(token)) return null;
  const { data } = await admin.from("mpesa_payment_secrets").select("*").eq("callback_token", token).maybeSingle();
  return data ? fromRow(data) : null;
}

function fromRow(r: any): DarajaKeys {
  return {
    businessId: r.business_id,
    environment: r.environment === "production" ? "production" : "sandbox",
    consumerKey: r.consumer_key,
    consumerSecret: r.consumer_secret,
    passkey: r.passkey,
    shortcode: r.shortcode,
    partyB: r.party_b,
    transactionType: r.transaction_type,
    callbackToken: r.callback_token,
  };
}

function baseUrl(keys: Pick<DarajaKeys, "environment">): string {
  if (keys.environment === "production") return "https://api.safaricom.co.ke";
  return Deno.env.get("MPESA_SANDBOX_URL") || "https://sandbox.safaricom.co.ke";
}

/** Daraja wants YYYYMMDDHHmmss in Nairobi time (UTC+3, no daylight saving). */
function timestamp(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export async function accessToken(keys: Pick<DarajaKeys, "environment" | "consumerKey" | "consumerSecret">): Promise<string> {
  const credentials = btoa(`${keys.consumerKey}:${keys.consumerSecret}`);
  const res = await fetch(`${baseUrl(keys)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

function passwordFields(keys: DarajaKeys) {
  const stamp = timestamp();
  return {
    BusinessShortCode: keys.shortcode,
    Password: btoa(`${keys.shortcode}${keys.passkey}${stamp}`),
    Timestamp: stamp,
  };
}

const STK_STILL_PROCESSING = 4999;

export interface StkResult {
  accepted: boolean;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  /** Safaricom's reason when it refuses the prompt. */
  detail?: string;
}

/** Daraja success codes are "0" (STK) or "00000000" (C2B v2). */
function isSuccessCode(code: unknown): boolean {
  return /^0+$/.test(String(code ?? ""));
}

export async function stkPush(
  keys: DarajaKeys,
  phone: string,
  amount: number,
  reference: string,
  callbackUrl: string,
  description = "Order",
): Promise<StkResult> {
  const token = await accessToken(keys);
  const fields = passwordFields(keys);
  // The sandbox only takes paybill prompts (Buy Goods returns "Invalid TransactionType"),
  // and its test short code 174379 is both the payer-facing number and the receiver.
  const sandbox = keys.environment !== "production";
  const transactionType = sandbox ? "CustomerPayBillOnline" : keys.transactionType;
  const partyB = transactionType === "CustomerPayBillOnline" ? keys.shortcode : keys.partyB || keys.shortcode;
  const res = await fetch(`${baseUrl(keys)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...fields,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: partyB,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !isSuccessCode(body.ResponseCode)) {
    const detail = String(body.errorMessage ?? body.ResponseDescription ?? res.status);
    console.error("[daraja] STK push rejected:", res.status, body.errorCode ?? body.ResponseCode, detail);
    return { accepted: false, detail };
  }
  return {
    accepted: true,
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID,
  };
}

/** Returns Daraja's final result code, or null while the customer hasn't responded. */
export async function stkQuery(keys: DarajaKeys, checkoutRequestId: string): Promise<number | null> {
  const token = await accessToken(keys);
  const res = await fetch(`${baseUrl(keys)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...passwordFields(keys), CheckoutRequestID: checkoutRequestId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ResultCode === undefined) return null;
  const code = Number(body.ResultCode);
  // 4999 means still processing, not failed: the customer may yet pay.
  return code === STK_STILL_PROCESSING ? null : code;
}

/**
 * Tells Safaricom where to send payments made straight to the till (C2B).
 * Safaricom refuses URLs containing words such as "mpesa", which is why the
 * receiving function is called till-callback.
 */
export async function registerC2bUrls(
  keys: DarajaKeys,
  tillNumber: string,
  confirmationUrl: string,
  validationUrl: string,
): Promise<{ ok: boolean; detail: string }> {
  const token = await accessToken(keys);
  // Payments are sent to the till customers pay (the Buy Goods till, or the paybill).
  const shortCode = tillNumber || keys.partyB || keys.shortcode;
  const res = await fetch(`${baseUrl(keys)}/mpesa/c2b/v2/registerurl`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ShortCode: shortCode,
      ResponseType: "Completed",
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const detail = String(body.ResponseDescription ?? body.errorMessage ?? res.status);
  return { ok: res.ok && isSuccessCode(body.ResponseCode), detail };
}

/**
 * Sandbox only: asks Safaricom to send a test payment to the till, exactly as a customer
 * paying from their phone would. The result arrives at till-callback like a real payment.
 * 254708374149 is Safaricom's sandbox test number.
 */
export async function c2bSimulate(
  keys: DarajaKeys,
  tillNumber: string,
  amount: number,
  billRef: string,
): Promise<{ ok: boolean; detail: string }> {
  if (keys.environment === "production") return { ok: false, detail: "Test payments only work on sandbox." };
  const token = await accessToken(keys);
  const shortCode = tillNumber || keys.partyB || keys.shortcode;
  const send = (version: string) =>
    fetch(`${baseUrl(keys)}/mpesa/c2b/${version}/simulate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ShortCode: shortCode,
        // Sandbox test short codes are paybills (as for prompts, see stkPush).
        CommandID: "CustomerPayBillOnline",
        Amount: amount,
        Msisdn: "254708374149",
        BillRefNumber: billRef,
      }),
    });
  // Registration uses v2; older sandbox apps only have v1 simulate.
  let res = await send("v2");
  if (res.status === 404) res = await send("v1");
  const body = await res.json().catch(() => ({}));
  const detail = String(body.ResponseDescription ?? body.errorMessage ?? res.status);
  return { ok: res.ok && isSuccessCode(body.ResponseCode), detail };
}
