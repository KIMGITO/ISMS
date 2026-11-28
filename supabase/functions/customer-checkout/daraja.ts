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

/**
 * The business a callback URL's token belongs to. Kept in its own table, so it still works
 * while M-Pesa is disconnected and after reconnecting (20261215001).
 */
export async function businessByCallbackToken(admin: any, token: string | null): Promise<string | null> {
  if (!token || !/^[0-9a-f]{48}$/.test(token)) return null;
  const { data, error } = await admin.rpc("fn_mpesa_business_by_token", { p_token: token });
  if (error) throw error;
  return (data as string | null) ?? null;
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
export function timestamp(now = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** One JSON line per Daraja event. Never pass keys, secrets, passkeys or tokens here. */
export function darajaLog(event: string, fields: Record<string, unknown> = {}, level: "log" | "error" = "log") {
  console[level](JSON.stringify({ src: "daraja", event, ...fields }));
}

/** How long each call may take before we stop waiting for Safaricom. */
const TIMEOUT_MS = { auth: 15_000, stk: 30_000, query: 15_000, register: 30_000 };

export type DarajaFailure = "auth" | "timeout" | "network" | "rejected";

export class DarajaError extends Error {
  constructor(public kind: DarajaFailure, message: string, public status?: number) {
    super(message);
  }
}

interface DarajaResponse {
  status: number;
  ok: boolean;
  body: any;
}

/** fetch with a timeout; the body is read as text so an empty or HTML body can't throw. */
async function call(url: string, init: RequestInit, timeoutMs: number): Promise<DarajaResponse> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new DarajaError("timeout", `Safaricom did not answer within ${timeoutMs / 1000} s.`);
    }
    throw new DarajaError("network", `Could not reach Safaricom: ${(err as Error)?.message ?? err}`);
  }
  const text = await res.text().catch(() => "");
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { errorMessage: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, body };
}

// Tokens are valid for about an hour. Asking for a new one on every call gets the app
// rate-limited by Safaricom, which made prompts fail at random, so each instance keeps them.
// The secret is part of the key, so re-saved keys with a new secret are really checked.
type TokenKeys = Pick<DarajaKeys, "environment" | "consumerKey" | "consumerSecret">;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
// Calls that need a token while one is being fetched wait for that fetch instead of starting another.
const tokenFetches = new Map<string, Promise<string>>();
const cacheKey = (k: TokenKeys) => `${k.environment}|${k.consumerKey}|${k.consumerSecret}`;

/** Forgets the cached token (Safaricom said it is invalid). For tests too. */
export function forgetToken(keys?: TokenKeys) {
  if (keys) tokenCache.delete(cacheKey(keys));
  else tokenCache.clear();
}

export function accessToken(keys: TokenKeys): Promise<string> {
  const key = cacheKey(keys);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.token);
  let fetching = tokenFetches.get(key);
  if (!fetching) {
    fetching = fetchToken(keys, key).finally(() => tokenFetches.delete(key));
    tokenFetches.set(key, fetching);
  }
  return fetching;
}

async function fetchToken(keys: TokenKeys, key: string): Promise<string> {
  const credentials = btoa(`${keys.consumerKey}:${keys.consumerSecret}`);
  const res = await call(`${baseUrl(keys)}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: { Authorization: `Basic ${credentials}` },
  }, TIMEOUT_MS.auth);
  const token = typeof res.body?.access_token === "string" ? res.body.access_token : "";
  if (!res.ok || !token) {
    // Wrong keys come back as 400 with an empty body (checked against the sandbox).
    darajaLog("auth_failed", { env: keys.environment, status: res.status, code: res.body?.errorCode ?? null }, "error");
    const kind: DarajaFailure = res.status === 400 || res.status === 401 ? "auth" : "rejected";
    throw new DarajaError(kind, `Daraja auth failed: ${res.status}`, res.status);
  }
  // expires_in is a string of seconds ("3599"); renew a minute early.
  const life = Number(res.body.expires_in) > 0 ? Number(res.body.expires_in) : 3599;
  tokenCache.set(key, { token, expiresAt: Date.now() + Math.max(life - 60, 30) * 1000 });
  return token;
}

/** Daraja's answers for a token it no longer accepts (seen on the sandbox). */
function invalidToken(res: DarajaResponse): boolean {
  const code = String(res.body?.errorCode ?? "");
  return code === "404.001.03" || code.startsWith("401.003") || /invalid access token/i.test(String(res.body?.errorMessage ?? ""));
}

/** An authorised POST; a token Safaricom has dropped is renewed once. */
async function post(keys: DarajaKeys, path: string, payload: unknown, timeoutMs: number): Promise<DarajaResponse> {
  const send = async () => call(`${baseUrl(keys)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(keys)}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, timeoutMs);
  let res = await send();
  if (invalidToken(res)) {
    forgetToken(keys);
    res = await send();
  }
  return res;
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
/** Daraja's STK maximum per transaction. */
export const STK_MAX_AMOUNT = 250000;

/** Daraja takes whole shillings only, from 1 to STK_MAX_AMOUNT; a decimal is refused with a misleading message. */
export function isStkAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount >= 1 && amount <= STK_MAX_AMOUNT;
}

export interface StkResult {
  accepted: boolean;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  customerMessage?: string;
  /** Safaricom's reason when it refuses the prompt. */
  detail?: string;
  /** True when we stopped waiting: the prompt may still have reached the phone. */
  uncertain?: boolean;
}

/** Daraja success codes are "0" (STK) or "00000000" (C2B v2). */
function isSuccessCode(code: unknown): boolean {
  return /^0+$/.test(String(code ?? ""));
}

/** Where Safaricom sends this business's prompt results. */
export function stkCallbackUrl(keys: Pick<DarajaKeys, "callbackToken">): string {
  const base = Deno.env.get("MPESA_CALLBACK_URL") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/mpesa-webhook`;
  return `${base}?token=${encodeURIComponent(keys.callbackToken)}`;
}

export async function stkPush(
  keys: DarajaKeys,
  phone: string,
  amount: number,
  reference: string,
  callbackUrl: string,
  description = "Order",
): Promise<StkResult> {
  if (!isStkAmount(amount)) {
    return { accepted: false, detail: `M-Pesa takes whole shillings from 1 to ${STK_MAX_AMOUNT}` };
  }
  const fields = passwordFields(keys);
  // The sandbox only takes paybill prompts (Buy Goods returns "Invalid TransactionType"),
  // and its test short code 174379 is both the payer-facing number and the receiver.
  const sandbox = keys.environment !== "production";
  const transactionType = sandbox ? "CustomerPayBillOnline" : keys.transactionType;
  const partyB = transactionType === "CustomerPayBillOnline" ? keys.shortcode : keys.partyB || keys.shortcode;
  let res: DarajaResponse;
  try {
    res = await post(keys, "/mpesa/stkpush/v1/processrequest", {
      ...fields,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: partyB,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    }, TIMEOUT_MS.stk);
  } catch (err) {
    const e = err as DarajaError;
    darajaLog("stk_push_error", { business: keys.businessId, env: keys.environment, kind: e.kind ?? "unknown", message: e.message }, "error");
    if (e.kind === "timeout") {
      return { accepted: false, uncertain: true, detail: "Safaricom did not answer in time. Check the customer's phone before sending again" };
    }
    if (e.kind === "auth") return { accepted: false, detail: "Safaricom refused this business's Daraja keys" };
    return { accepted: false, detail: e.message };
  }
  const body = res.body;
  if (!res.ok || !isSuccessCode(body.ResponseCode) || !body.CheckoutRequestID) {
    const detail = String(body.errorMessage ?? body.ResponseDescription ?? `HTTP ${res.status}`);
    darajaLog("stk_push_rejected", {
      business: keys.businessId, env: keys.environment, status: res.status,
      code: body.errorCode ?? body.ResponseCode ?? null, detail,
    }, "error");
    return { accepted: false, detail };
  }
  // Accepted means the prompt was sent, not that anyone paid.
  darajaLog("stk_push_accepted", {
    business: keys.businessId, env: keys.environment,
    checkoutRequestId: body.CheckoutRequestID, merchantRequestId: body.MerchantRequestID,
  });
  return {
    accepted: true,
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID,
    customerMessage: body.CustomerMessage,
  };
}

/**
 * Returns Daraja's final result code, or null while there is no final answer: the customer
 * hasn't responded, or Safaricom timed out, rate-limited or errored. Null never means "failed".
 */
export async function stkQuery(keys: DarajaKeys, checkoutRequestId: string): Promise<number | null> {
  let res: DarajaResponse;
  try {
    res = await post(keys, "/mpesa/stkpushquery/v1/query", { ...passwordFields(keys), CheckoutRequestID: checkoutRequestId }, TIMEOUT_MS.query);
  } catch (err) {
    darajaLog("stk_query_error", { business: keys.businessId, checkoutRequestId, kind: (err as DarajaError).kind ?? "unknown", message: (err as Error).message }, "error");
    return null;
  }
  const body = res.body;
  // Still processing comes back as HTTP 500 with errorCode 500.001.1001 and no ResultCode.
  if (!res.ok || body.ResultCode === undefined || body.ResultCode === null || body.ResultCode === "") {
    darajaLog("stk_query_pending", { business: keys.businessId, checkoutRequestId, status: res.status, code: body.errorCode ?? null });
    return null;
  }
  const code = Number(body.ResultCode);
  if (!Number.isFinite(code)) return null;
  darajaLog("stk_query_result", { business: keys.businessId, checkoutRequestId, resultCode: code, desc: body.ResultDesc ?? null });
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
): Promise<{ ok: boolean; detail: string; duplicate?: boolean }> {
  // Payments are sent to the till customers pay (the Buy Goods till, or the paybill).
  const shortCode = tillNumber || keys.partyB || keys.shortcode;
  let res: DarajaResponse;
  try {
    res = await post(keys, "/mpesa/c2b/v2/registerurl", {
      ShortCode: shortCode,
      // Completed: if our validation URL can't be reached, Safaricom completes the payment.
      ResponseType: "Completed",
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl,
    }, TIMEOUT_MS.register);
  } catch (err) {
    darajaLog("c2b_register_error", { business: keys.businessId, shortCode, kind: (err as DarajaError).kind ?? "unknown", message: (err as Error).message }, "error");
    return { ok: false, detail: (err as Error).message };
  }
  const body = res.body;
  const detail = String(body.ResponseDescription ?? body.errorMessage ?? `HTTP ${res.status}`);
  const ok = res.ok && isSuccessCode(body.ResponseCode);
  // A live short code whose URLs are already registered is refused; they have to be changed
  // on the Daraja portal (or by Safaricom) instead.
  const duplicate = !ok && /duplicate|already registered/i.test(detail);
  darajaLog(ok ? "c2b_register_accepted" : "c2b_register_rejected", {
    business: keys.businessId, env: keys.environment, shortCode, status: res.status,
    code: body.ResponseCode ?? body.errorCode ?? null, detail,
  }, ok ? "log" : "error");
  return { ok, detail, duplicate };
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
  const shortCode = tillNumber || keys.partyB || keys.shortcode;
  const payload = {
    ShortCode: shortCode,
    // Sandbox test short codes are paybills (as for prompts, see stkPush).
    CommandID: "CustomerPayBillOnline",
    Amount: amount,
    Msisdn: "254708374149",
    BillRefNumber: billRef,
  };
  try {
    // Registration uses v2; older sandbox apps only have v1 simulate.
    let res = await post(keys, "/mpesa/c2b/v2/simulate", payload, TIMEOUT_MS.register);
    if (res.status === 404 && !invalidToken(res)) res = await post(keys, "/mpesa/c2b/v1/simulate", payload, TIMEOUT_MS.register);
    const detail = String(res.body.ResponseDescription ?? res.body.errorMessage ?? `HTTP ${res.status}`);
    const ok = res.ok && isSuccessCode(res.body.ResponseCode);
    darajaLog(ok ? "c2b_simulate_accepted" : "c2b_simulate_rejected", { business: keys.businessId, shortCode, status: res.status, detail }, ok ? "log" : "error");
    return { ok, detail };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
