// supabase/functions/shared/darajaInbox.ts
// Shared by mpesa-webhook (STK results) and till-callback (C2B). Every Safaricom callback is
// stored in daraja_callbacks before it is processed (20261215001). Safaricom doesn't reliably
// resend callbacks, so a processing error must never lose the payload: once stored, the
// callback is acknowledged and payment-sweep retries whatever failed or hadn't matched yet.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ipAllowed, readText, BodyTooLarge, MAX_CALLBACK_BYTES, securityEvent, tooLarge } from "./guard.ts";
import { businessByCallbackToken, darajaLog } from "../customer-checkout/daraja.ts";

export type CallbackKind = "stk" | "c2b_confirmation" | "c2b_validation";

interface Stored {
  id: string;
  status: string;
  result: string | null;
  duplicate: boolean;
  key: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** What differs between the STK and C2B receivers; everything else is handleDarajaCallback. */
export interface CallbackSpec {
  /** Function name, for security events. */
  source: string;
  /** Log event prefix ("stk_callback", "c2b_callback"). */
  logPrefix: string;
  kind(url: URL): CallbackKind;
  /** Daraja's acknowledgement for a stored callback. */
  ack(): Response;
  /** A refusal Safaricom may retry (500) or a malformed payload (400). */
  nack(status: number, desc: string): Response;
  /** The id that makes a payload processable (CheckoutRequestID / TransID). */
  key(payload: any): unknown;
  /** Fields for the per-callback log line. */
  logFields(payload: any): Record<string, unknown>;
}

/**
 * Token, IP, ping, store, process, acknowledge. Once stored, a callback is acknowledged even if
 * processing failed: payment-sweep retries it. Validation is always answered "accepted":
 * "Completed" registration completes the payment anyway.
 */
export async function handleDarajaCallback(req: Request, spec: CallbackSpec): Promise<Response> {
  const url = new URL(req.url);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  // Each business has its own token, so the token names the business.
  let businessId: string | null = null;
  try {
    businessId = req.method === "POST" ? await businessByCallbackToken(admin, url.searchParams.get("token")) : null;
  } catch (err) {
    // The database is unreachable: a 500 is the only way to say "not received".
    darajaLog(`${spec.logPrefix}_token_lookup_failed`, { message: (err as Error).message }, "error");
    return spec.nack(500, "Temporarily unavailable");
  }
  if (!businessId) {
    await securityEvent("bad_token", spec.source, req);
    return new Response("Forbidden", { status: 403 });
  }
  // Optional: Safaricom's published callback IPs, comma-separated (unset = any IP).
  if (!ipAllowed(req, "MPESA_ALLOWED_IPS")) {
    await securityEvent("ip_not_allowed", spec.source, req);
    return new Response("Forbidden", { status: 403 });
  }
  // Reachability check used after setup: proves the URL and token, touches no money.
  if (url.searchParams.get("type") === "ping") return json({ ok: true });

  const kind = spec.kind(url);
  const refuse = (status: number, desc: string) => kind === "c2b_validation" ? spec.ack() : spec.nack(status, desc);

  const read = await readCallback(req, spec.source);
  if (read instanceof Response) return read;
  const { payload, parsed } = read;

  let stored: Stored;
  try {
    stored = await storeCallback(admin, kind, businessId, payload);
  } catch (err) {
    logLostCallback(kind, businessId, payload, err);
    return refuse(500, "Not stored");
  }

  if (!parsed || !spec.key(payload)) {
    darajaLog(`${spec.logPrefix}_malformed`, { kind, business: businessId, inbox: stored.id }, "error");
    return refuse(400, "Malformed callback");
  }

  const result = await processCallback(admin, stored, kind, businessId);
  if (result === "wrong_business") await securityEvent("bad_token", spec.source, req);
  darajaLog(kind === "stk" ? spec.logPrefix : kind, {
    business: businessId, ...spec.logFields(payload), inbox: stored.id, duplicate: stored.duplicate, result,
  }, result === "failed" ? "error" : "log");
  return spec.ack();
}

/** Reads the body. Unparseable JSON is still kept (as text), so nothing that arrived is lost. */
async function readCallback(req: Request, source: string): Promise<{ payload: any; parsed: boolean } | Response> {
  let text: string;
  try {
    text = await readText(req, MAX_CALLBACK_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLarge) {
      await securityEvent("too_large", source, req);
      return tooLarge();
    }
    throw e;
  }
  try {
    const payload = JSON.parse(text);
    if (payload && typeof payload === "object") return { payload, parsed: true };
  } catch { /* kept below */ }
  return { payload: { _unparsed: text.slice(0, 8000) }, parsed: false };
}

/** Stores the callback. Throws if even that fails (the caller then answers 500). */
async function storeCallback(admin: any, kind: CallbackKind, businessId: string, payload: any): Promise<Stored> {
  const { data, error } = await admin.rpc("daraja_callback_receive", {
    p_kind: kind, p_business_id: businessId, p_payload: payload,
  });
  if (error) throw error;
  return data as Stored;
}

/** Processes a stored callback. Never throws; failures stay on the row for payment-sweep. */
async function processCallback(admin: any, stored: Stored, kind: CallbackKind, businessId: string): Promise<string> {
  if (stored.status === "processed" || stored.status === "rejected") return stored.result ?? stored.status;
  const { data, error } = await admin.rpc("daraja_callback_process", { p_id: stored.id });
  if (error) {
    darajaLog("callback_process_error", { kind, business: businessId, key: stored.key, inbox: stored.id, message: error.message }, "error");
    return "failed";
  }
  return String(data);
}

/** Last resort when the database can't even store the payload: keep it in the function log. */
function logLostCallback(kind: CallbackKind, businessId: string, payload: unknown, err: unknown) {
  darajaLog("callback_not_stored", {
    kind, business: businessId, message: (err as Error)?.message ?? String(err), payload,
  }, "error");
}
