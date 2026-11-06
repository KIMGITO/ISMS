// supabase/functions/customer-checkout/daraja.ts
// Safaricom Daraja STK Push client. Credentials live in edge function secrets only.

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

function baseUrl(): string {
  return Deno.env.get("MPESA_BASE_URL") ||
    (Deno.env.get("MPESA_ENV") === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke");
}

/** Daraja wants YYYYMMDDHHmmss in Nairobi time (UTC+3, no daylight saving). */
function timestamp(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

async function accessToken(): Promise<string> {
  const credentials = btoa(`${env("MPESA_CONSUMER_KEY")}:${env("MPESA_CONSUMER_SECRET")}`);
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

function passwordFields() {
  const shortcode = env("MPESA_SHORTCODE");
  const stamp = timestamp();
  return {
    BusinessShortCode: shortcode,
    Password: btoa(`${shortcode}${env("MPESA_PASSKEY")}${stamp}`),
    Timestamp: stamp,
  };
}

const STK_STILL_PROCESSING = 4999;

export interface StkResult {
  accepted: boolean;
  checkoutRequestId?: string;
  merchantRequestId?: string;
}

export async function stkPush(
  phone: string,
  amount: number,
  reference: string,
  callbackUrl: string,
  description = "Order",
): Promise<StkResult> {
  const token = await accessToken();
  const fields = passwordFields();
  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...fields,
      TransactionType: Deno.env.get("MPESA_TRANSACTION_TYPE") || "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: Deno.env.get("MPESA_PARTY_B") || fields.BusinessShortCode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ResponseCode !== "0") {
    console.error("[customer-checkout] STK push rejected:", res.status, body.errorCode ?? body.ResponseCode);
    return { accepted: false };
  }
  return {
    accepted: true,
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID,
  };
}

/** Returns Daraja's final result code, or null while the customer hasn't responded. */
export async function stkQuery(checkoutRequestId: string): Promise<number | null> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...passwordFields(), CheckoutRequestID: checkoutRequestId }),
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
export async function registerC2bUrls(confirmationUrl: string, validationUrl: string): Promise<{ ok: boolean; detail: string }> {
  const token = await accessToken();
  const shortCode = Deno.env.get("MPESA_C2B_SHORTCODE") || env("MPESA_SHORTCODE");
  const res = await fetch(`${baseUrl()}/mpesa/c2b/v2/registerurl`, {
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
  return { ok: res.ok && String(body.ResponseCode ?? "") === "0", detail };
}

/** Which secrets are present, without revealing any of them. */
export function darajaStatus() {
  const has = (name: string) => !!Deno.env.get(name);
  return {
    configured: ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_TOKEN"].every(has),
    environment: Deno.env.get("MPESA_ENV") === "production" ? "production" : "sandbox",
    transactionType: Deno.env.get("MPESA_TRANSACTION_TYPE") || "CustomerPayBillOnline",
    missing: ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_TOKEN"].filter((n) => !has(n)),
    tillFromSecrets: Deno.env.get("MPESA_PARTY_B") || null,
  };
}
