// supabase/functions/shared/guard.ts
// Small defences for functions anyone on the internet can call (Phase 6):
//   safeEqual        compare secrets without leaking their contents through timing
//   readText/readJson read a request body, refusing anything over a size cap
//   ipAllowed        optional allow-list of caller IPs, from an env var (off when unset)
//   securityEvent    note a refused call, so the database watchdog can alert on abuse

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/** Constant-time string comparison. False when either side is empty. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i % x.length] ?? 0) ^ (y[i % y.length] ?? 0);
  return diff === 0;
}

/** True when the value matches any of the (non-empty) secrets. */
export function matchesAnySecret(value: string, secrets: (string | undefined)[]): boolean {
  let hit = false;
  for (const s of secrets) if (s && safeEqual(value, s)) hit = true;
  return hit;
}

export class BodyTooLarge extends Error {
  constructor() {
    super("Request body is too large.");
  }
}

/** Reads the body as text, stopping as soon as it passes maxBytes. */
export async function readText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Reads and parses a JSON body of at most maxBytes. Throws BodyTooLarge or SyntaxError. */
export async function readJson(req: Request, maxBytes: number): Promise<any> {
  return JSON.parse(await readText(req, maxBytes));
}

/** Body caps used by the public functions. Provider callbacks are a few KB. */
export const MAX_CALLBACK_BYTES = 64 * 1024;
export const MAX_PUBLIC_JSON_BYTES = 32 * 1024;

export const tooLarge = (headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ success: false, error: "Request is too large." }), {
    status: 413,
    headers: { ...headers, "Content-Type": "application/json" },
  });

/** The IP the platform's proxy saw (cannot be set by the caller). */
export function platformIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "").trim();
}

/**
 * Whether the caller's IP is on the comma-separated list in env var `envName`.
 * An unset or empty list allows everyone, so turning this on is a settings change only.
 */
export function ipAllowed(req: Request, envName: string): boolean {
  const list = (Deno.env.get(envName) || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  const ip = platformIp(req);
  return !!ip && list.includes(ip);
}

/**
 * Records a refused call (wrong token, bad signature, IP not allowed, too large).
 * Never throws and never stores the secret that was sent. The database caps how many it keeps.
 */
export async function securityEvent(kind: string, source: string, req: Request): Promise<void> {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await admin.rpc("log_security_event", {
      p_kind: kind,
      p_source: source,
      p_ip: platformIp(req) || null,
    });
  } catch (err) {
    console.error("[guard] could not log security event:", (err as Error).message);
  }
}
