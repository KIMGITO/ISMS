// supabase/functions/card-payments/paystack.ts
// Paystack calls shared by card-payments and card-webhook. Card numbers never reach the app:
// customers type them on Paystack's own page or on a Paystack card reader.
// The pure helpers at the top have no Deno imports so the app's unit tests can use them.

// deno-lint-ignore-file no-explicit-any

export const PAYSTACK_API = "https://api.paystack.co";
export const MAX_CARD_AMOUNT = 1_000_000;

/** Paystack counts money in cents. */
export function toSubunits(amount: number): number {
  return Math.round(Number(amount) * 100);
}

export function fromSubunits(amount: unknown): number {
  return Math.round(Number(amount)) / 100;
}

/** test or live, read from the key itself. null when it isn't a Paystack secret key. */
export function keyEnvironment(secretKey: string): "test" | "live" | null {
  if (/^sk_test_[A-Za-z0-9]+$/.test(secretKey)) return "test";
  if (/^sk_live_[A-Za-z0-9]+$/.test(secretKey)) return "live";
  return null;
}

/** Our reference: short, unique, safe in a URL, and easy to read out over the phone. */
export function newReference(): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, "0")).join("");
  return `KK${Date.now().toString(36)}${random}`.toUpperCase();
}

/** Card brand and last four digits from a Paystack transaction, when present. */
export function cardDetails(data: any): { brand: string | null; last4: string | null } {
  const auth = data?.authorization ?? data?.payment_authorization ?? {};
  const last4 = typeof auth.last4 === "string" && /^\d{4}$/.test(auth.last4) ? auth.last4 : null;
  const brand = typeof auth.brand === "string" && auth.brand.trim() ? auth.brand.trim().slice(0, 30) : null;
  return { brand, last4 };
}

/** What a verify result means for us. "pending" means keep waiting. */
export function transactionOutcome(status: unknown): "success" | "failed" | "pending" {
  if (status === "success") return "success";
  if (status === "failed" || status === "abandoned" || status === "reversed") return "failed";
  return "pending";
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Paystack signs each webhook body with HMAC-SHA512 of the business's secret key. */
export async function signatureMatches(secretKey: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secretKey), { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const expected = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export interface PaystackResult {
  ok: boolean;
  status: number;
  message: string;
  data: any;
}

/** One Paystack API call. Never throws for an HTTP error; the caller reads ok/message. */
export async function paystack(secretKey: string, method: "GET" | "POST", path: string, body?: unknown): Promise<PaystackResult> {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return {
    ok: res.ok && json?.status === true,
    status: res.status,
    message: typeof json?.message === "string" ? json.message : `HTTP ${res.status}`,
    data: json?.data ?? null,
  };
}
