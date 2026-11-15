// supabase/functions/airtel-payments/airtel.ts
// Airtel Africa Open API client: collections ("USSD push" payment prompts).
// Docs: https://developers.airtel.africa  (Collection API v1)
//   POST /auth/oauth2/token                 client id + secret -> bearer token
//   POST /merchant/v1/payments/             send the prompt to the customer's phone
//   GET  /standard/v1/payments/{id}         ask how a prompt went
// Each business has its own Airtel app, so the keys are passed in, never read from env.
// Not yet tried against Airtel's servers: the field names follow the published v1 docs.

export interface AirtelKeys {
  clientId: string;
  clientSecret: string;
  environment: "staging" | "production";
  country: string;
  currency: string;
}

export const MAX_AIRTEL_AMOUNT = 150000;

function baseUrl(environment: AirtelKeys["environment"]): string {
  return environment === "production" ? "https://openapi.airtel.africa" : "https://openapiuat.airtel.africa";
}

async function readJson(res: Response): Promise<any> {
  return await res.json().catch(() => ({}));
}

export async function accessToken(keys: AirtelKeys): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  const res = await fetch(`${baseUrl(keys.environment)}/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify({ client_id: keys.clientId, client_secret: keys.clientSecret, grant_type: "client_credentials" }),
  });
  const body = await readJson(res);
  if (!res.ok || !body.access_token) {
    return { ok: false, detail: String(body.error_description || body.error || body.message || `HTTP ${res.status}`) };
  }
  return { ok: true, token: body.access_token };
}

function headers(keys: AirtelKeys, token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "X-Country": keys.country,
    "X-Currency": keys.currency,
    Authorization: `Bearer ${token}`,
  };
}

/** Our id for a prompt. Airtel wants it unique per merchant; letters and digits only. */
export function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const random = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `KK${Date.now().toString(36).toUpperCase()}${random}`.slice(0, 24);
}

export interface PushResult {
  accepted: boolean;
  detail?: string;
}

/**
 * Sends the prompt. `msisdn` is the local number without the country code (Kenya: 7XXXXXXXX
 * or 1XXXXXXXX). The customer sees `reference` on their phone.
 */
export async function pushPayment(
  keys: AirtelKeys,
  msisdn: string,
  amount: number,
  transactionId: string,
  reference: string,
): Promise<PushResult> {
  const auth = await accessToken(keys);
  if (auth.ok === false) return { accepted: false, detail: auth.detail };
  const res = await fetch(`${baseUrl(keys.environment)}/merchant/v1/payments/`, {
    method: "POST",
    headers: headers(keys, auth.token),
    body: JSON.stringify({
      reference: reference.slice(0, 30),
      subscriber: { country: keys.country, currency: keys.currency, msisdn },
      transaction: { amount, country: keys.country, currency: keys.currency, id: transactionId },
    }),
  });
  const body = await readJson(res);
  const success = body?.status?.success === true || String(body?.status?.code) === "200";
  if (!res.ok || !success) {
    return { accepted: false, detail: String(body?.status?.message || body?.message || `HTTP ${res.status}`) };
  }
  return { accepted: true };
}

export type AirtelOutcome = "success" | "failed" | "pending";

/** Airtel's transaction states: TS paid, TF failed, TA ambiguous, TIP in progress. */
export function outcomeOf(statusCode: unknown): AirtelOutcome {
  const code = String(statusCode ?? "").toUpperCase();
  if (code === "TS") return "success";
  if (code === "TF" || code === "TE") return "failed";
  return "pending";
}

export interface Enquiry {
  outcome: AirtelOutcome;
  code: string | null;
  airtelMoneyId: string | null;
  message: string | null;
}

/** Asks Airtel how a prompt went. A network or auth problem reads as still pending. */
export async function enquire(keys: AirtelKeys, transactionId: string): Promise<Enquiry> {
  const pending: Enquiry = { outcome: "pending", code: null, airtelMoneyId: null, message: null };
  const auth = await accessToken(keys);
  if (auth.ok === false) return pending;
  const res = await fetch(`${baseUrl(keys.environment)}/standard/v1/payments/${encodeURIComponent(transactionId)}`, {
    headers: headers(keys, auth.token),
  });
  const body = await readJson(res);
  const tx = body?.data?.transaction;
  if (!res.ok || !tx) return pending;
  return {
    outcome: outcomeOf(tx.status),
    code: tx.status ? String(tx.status) : null,
    airtelMoneyId: tx.airtel_money_id ? String(tx.airtel_money_id) : null,
    message: tx.message ? String(tx.message) : (body?.status?.message ? String(body.status.message) : null),
  };
}
