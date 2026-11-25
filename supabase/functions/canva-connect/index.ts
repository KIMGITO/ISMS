// supabase/functions/canva-connect/index.ts
// Canva Connect (official REST API, https://www.canva.dev/docs/connect/) for the Marketing
// Creative Studio. A person connects their own Canva account (OAuth 2.0 with PKCE); the app can
// then create a design at an advert format's exact size, list their designs, reopen one for
// editing, and import a finished design: Canva exports it (JPG for pictures, MP4 for videos),
// this function stores the file in the shop's media library and registers it as that person,
// so the database checks permission, file type, size and the plan's storage as for any upload.
//
// POST (signed in, JSON {action, businessId, ...}):
//   status | authorize {returnTo?} | disconnect | create {format, title} | list {query?, continuation?}
//   edit {designId} | import {designId, format, title?, altText?}
// GET  ?code=...&state=...   Canva's redirect after the person allows access (no JWT; the state
//                            row proves who started it and is used once).
//
// Secrets (supabase secrets set ...): CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, CANVA_TOKEN_KEY
// (32 random bytes, base64: tokens are kept encrypted with AES-GCM), CANVA_REDIRECT_URI
// (this function's URL, registered in the Canva Developer Portal), optional CANVA_DONE_URL
// (where the browser goes after connecting). Without the first four nothing is configured and
// the app shows the manual Canva workflow instead. Deploy with --no-verify-jwt (the GET callback
// has no JWT); every POST checks the caller's token itself.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, createUserClient, enforceRateLimit, errorResponse, handleCors, jsonResponse, requirePermission } from "../shared/cors.ts";

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const API = "https://api.canva.com/rest/v1";
const SCOPES = "design:content:read design:content:write design:meta:read profile:read";
const BUCKET = "website-media";

// Same sizes as website/src/ads/rules.ts DESIGN_SIZES.
const SIZES: Record<string, { width: number; height: number; video?: "horizontal" | "vertical" }> = {
  hero_16x9: { width: 1920, height: 1080 },
  wide_3x1: { width: 1800, height: 600 },
  card_4x5: { width: 1080, height: 1350 },
  square_1x1: { width: 1080, height: 1080 },
  story_9x16: { width: 1080, height: 1920 },
  video_16x9: { width: 1920, height: 1080, video: "horizontal" },
  video_9x16: { width: 1080, height: 1920, video: "vertical" },
};

const env = (k: string) => Deno.env.get(k) ?? "";
const configured = () => !!(env("CANVA_CLIENT_ID") && env("CANVA_CLIENT_SECRET") && env("CANVA_TOKEN_KEY") && env("CANVA_REDIRECT_URI"));
const admin = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

// ── helpers ─────────────────────────────────────────────────────────────────────────────────
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

let keyPromise: Promise<CryptoKey> | null = null;
function tokenKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const raw = unb64(env("CANVA_TOKEN_KEY"));
    if (raw.length !== 32) throw new Error("CANVA_TOKEN_KEY must be 32 bytes, base64");
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  })();
  return keyPromise;
}
async function seal(text: string): Promise<string> {
  const iv = random(12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), new TextEncoder().encode(text)));
  return `${b64(iv)}.${b64(data)}`;
}
async function open(sealed: string): Promise<string> {
  const [iv, data] = sealed.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(), unb64(data)));
}

async function tokenRequest(form: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${env("CANVA_CLIENT_ID")}:${env("CANVA_CLIENT_SECRET")}`)}`,
    },
    body: new URLSearchParams(form),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error_description || body?.message || `Canva sign-in failed (${res.status})`);
  return body;
}

async function saveTokens(userId: string, t: any, extra: Record<string, unknown> = {}) {
  await admin().from("canva_connections").upsert({
    user_id: userId,
    access_token_enc: await seal(t.access_token),
    refresh_token_enc: await seal(t.refresh_token),
    access_expires_at: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000 - 60_000).toISOString(),
    scopes: t.scope ?? SCOPES,
    updated_at: new Date().toISOString(),
    ...extra,
  });
}

/** A working access token for this person, refreshed when it expired. Refresh tokens are single-use. */
async function accessToken(userId: string): Promise<string> {
  const { data: row } = await admin().from("canva_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!row) throw Object.assign(new Error("Connect your Canva account first."), { status: 409, code: "NOT_CONNECTED" });
  if (Date.parse(row.access_expires_at) > Date.now()) return open(row.access_token_enc);
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: await open(row.refresh_token_enc) });
    await saveTokens(userId, t);
    return t.access_token;
  } catch {
    await admin().from("canva_connections").delete().eq("user_id", userId);
    throw Object.assign(new Error("Your Canva connection has expired. Connect again."), { status: 409, code: "NOT_CONNECTED" });
  }
}

async function canva(userId: string, path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessToken(userId);
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) throw Object.assign(new Error("Canva is busy. Try again in a minute."), { status: 429 });
  if (!res.ok) throw Object.assign(new Error(body?.message || `Canva answered ${res.status}`), { status: res.status >= 500 ? 502 : 400 });
  return body;
}

// ── reading sizes from the exported file (so nothing trusts a guess) ────────────────────────
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}
function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0x89 || b[1] !== 0x50) return null;
  const v = new DataView(b.buffer, b.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}
/** Width, height (from the first video track header) and length (movie header) of an MP4. */
function mp4Info(b: Uint8Array): { width: number; height: number; durationMs: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0, height = 0, durationMs = 0;
  const walk = (start: number, end: number) => {
    let i = start;
    while (i + 8 <= end) {
      let size = v.getUint32(i);
      const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      let header = 8;
      if (size === 1) { size = Number(v.getBigUint64(i + 8)); header = 16; }
      if (size < header || i + size > end) return;
      const body = i + header;
      if (type === "moov" || type === "trak") walk(body, i + size);
      if (type === "mvhd") {
        const version = b[body];
        const timescale = version === 1 ? v.getUint32(body + 20) : v.getUint32(body + 12);
        const duration = version === 1 ? Number(v.getBigUint64(body + 24)) : v.getUint32(body + 16);
        if (timescale) durationMs = Math.round((duration / timescale) * 1000);
      }
      if (type === "tkhd") {
        const version = b[body];
        const off = body + (version === 1 ? 88 : 76);
        const w = v.getUint32(off) >>> 16, h = v.getUint32(off + 4) >>> 16;
        if (w && h && !width) { width = w; height = h; }
      }
      i += size;
    }
  };
  walk(0, b.length);
  return width && height && durationMs ? { width, height, durationMs } : null;
}

async function exportDesign(userId: string, designId: string, format: any): Promise<string> {
  const start = await canva(userId, "/exports", { method: "POST", body: JSON.stringify({ design_id: designId, format }) });
  let job = start.job;
  for (let tries = 0; job?.status === "in_progress" && tries < 40; tries++) {
    await new Promise((r) => setTimeout(r, tries < 5 ? 1500 : 3000));
    job = (await canva(userId, `/exports/${job.id}`)).job;
  }
  if (job?.status !== "success" || !job.urls?.[0]) {
    const code = job?.error?.code;
    throw Object.assign(new Error(code === "license_required"
      ? "This design uses paid Canva elements your account hasn't bought. Remove them or buy them in Canva, then import again."
      : job?.status === "in_progress" ? "Canva is still preparing the file. Try Import again in a minute." : (job?.error?.message || "Canva could not export this design.")), { status: 400 });
  }
  return job.urls[0];
}

async function download(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("The exported file could not be downloaded from Canva.");
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw Object.assign(new Error("The exported file is too large for the media library."), { status: 400 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > maxBytes) throw Object.assign(new Error("The exported file is too large for the media library."), { status: 400 });
  return { bytes, type: (res.headers.get("content-type") || "").split(";")[0].trim() };
}

async function store(req: Request, businessId: string, bytes: Uint8Array, type: string, ext: string, meta: Record<string, unknown>): Promise<string> {
  const path = `${businessId}/canva/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const up = await admin().storage.from(BUCKET).upload(path, bytes, { contentType: type, cacheControl: "31536000", upsert: false });
  if (up.error) throw new Error(`The file could not be stored: ${up.error.message}`);
  const url = admin().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  // Registered as the person, so the database checks their permission and the plan's storage.
  const reg = await createUserClient(req).rpc("website_media_register", { p_business_id: businessId, p_path: path, p_meta: { ...meta, url, source: "canva" } });
  if (reg.error) {
    await admin().storage.from(BUCKET).remove([path]);
    throw Object.assign(new Error(reg.error.message), { status: 400 });
  }
  return reg.data as string;
}

// ── the OAuth redirect ──────────────────────────────────────────────────────────────────────
async function callback(url: URL): Promise<Response> {
  const done = (outcome: string) => {
    const target = env("CANVA_DONE_URL");
    if (target) return Response.redirect(`${target}${target.includes("?") ? "&" : "?"}canva=${outcome}`, 302);
    return new Response(outcome === "connected" ? "Canva is connected. You can close this tab and go back to the app." : "Canva was not connected. Close this tab and try again from the app.", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  };
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!state) return done("error");
  const db = admin();
  const { data: row } = await db.from("canva_oauth_states").select("*").eq("state", state).maybeSingle();
  await db.from("canva_oauth_states").delete().eq("state", state); // used once, whatever happens
  if (!row || !code || Date.now() - Date.parse(row.created_at) > 15 * 60_000) return done("error");
  try {
    const t = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: await open(row.verifier_enc), redirect_uri: env("CANVA_REDIRECT_URI") });
    let name: string | null = null;
    try {
      const me = await fetch(`${API}/users/me/profile`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json());
      name = me?.profile?.display_name ?? null;
    } catch { /* the name is only for display */ }
    await saveTokens(row.user_id, t, { display_name: name, connected_at: new Date().toISOString() });
    return done("connected");
  } catch (e) {
    console.error("[canva-connect] token exchange failed:", (e as Error).message);
    return done("error");
  }
}

// ── requests from the app ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (!configured()) return new Response("Canva is not set up.", { status: 503, headers: corsHeaders });
    return callback(url);
  }
  if (req.method !== "POST") return errorResponse("Use POST.", 405);

  let body: any;
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON payload", 400); }
  const { action, businessId } = body ?? {};
  if (typeof businessId !== "string" || !/^[0-9a-f-]{36}$/i.test(businessId)) return errorResponse("businessId is required.", 400);

  const user = createUserClient(req);
  const { data: auth } = await user.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return errorResponse("Sign in first.", 401);
  const denied = await requirePermission(req, businessId, "marketing.manage");
  if (denied) return denied;
  const limited = await enforceRateLimit(`canva:${userId}`, 60, 300);
  if (limited) return limited;

  if (action === "status") {
    if (!configured()) return jsonResponse({ configured: false, connected: false });
    const { data } = await admin().from("canva_connections").select("display_name").eq("user_id", userId).maybeSingle();
    return jsonResponse({ configured: true, connected: !!data, name: data?.display_name ?? null });
  }
  if (!configured()) return errorResponse("Canva isn't connected to this platform yet. Use Upload instead.", 503, "NOT_CONFIGURED");

  try {
    switch (action) {
      case "authorize": {
        const verifier = b64url(random(48));
        const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
        const state = b64url(random(24));
        const ins = await admin().from("canva_oauth_states").insert({ state, user_id: userId, business_id: businessId, verifier_enc: await seal(verifier) });
        if (ins.error) throw ins.error;
        const q = new URLSearchParams({
          code_challenge: challenge, code_challenge_method: "S256", scope: SCOPES, response_type: "code",
          client_id: env("CANVA_CLIENT_ID"), state, redirect_uri: env("CANVA_REDIRECT_URI"),
        });
        return jsonResponse({ url: `${AUTHORIZE_URL}?${q}` });
      }
      case "disconnect": {
        const { data: row } = await admin().from("canva_connections").select("refresh_token_enc").eq("user_id", userId).maybeSingle();
        if (row) {
          await fetch(`${API}/oauth/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${env("CANVA_CLIENT_ID")}:${env("CANVA_CLIENT_SECRET")}`)}` },
            body: new URLSearchParams({ token: await open(row.refresh_token_enc) }),
          }).catch(() => undefined);
          await admin().from("canva_connections").delete().eq("user_id", userId);
        }
        return jsonResponse({ ok: true });
      }
      case "create": {
        const size = SIZES[body.format];
        if (!size) return errorResponse("Choose a picture or video format.", 400);
        const title = String(body.title ?? "Advert").slice(0, 255) || "Advert";
        const r = await canva(userId, "/designs", { method: "POST", body: JSON.stringify({ design_type: { type: "custom", width: size.width, height: size.height }, title }) });
        return jsonResponse({ designId: r.design.id, editUrl: r.design.urls.edit_url });
      }
      case "list": {
        const q = new URLSearchParams({ ownership: "owned", sort_by: "modified_descending" });
        if (typeof body.query === "string" && body.query.trim()) q.set("query", body.query.trim().slice(0, 100));
        if (typeof body.continuation === "string") q.set("continuation", body.continuation);
        const r = await canva(userId, `/designs?${q}`);
        return jsonResponse({
          designs: (r.items ?? []).map((d: any) => ({ id: d.id, title: d.title || "Untitled", thumbnail: d.thumbnail?.url ?? null, editUrl: d.urls?.edit_url ?? null, updatedAt: d.updated_at ? new Date(d.updated_at * 1000).toISOString() : null })),
          continuation: r.continuation ?? null,
        });
      }
      case "edit": {
        if (typeof body.designId !== "string") return errorResponse("designId is required.", 400);
        const r = await canva(userId, `/designs/${encodeURIComponent(body.designId)}`);
        return jsonResponse({ editUrl: r.design.urls.edit_url });
      }
      case "import": {
        const size = SIZES[body.format];
        if (!size || typeof body.designId !== "string") return errorResponse("designId and a picture or video format are required.", 400);
        const title = typeof body.title === "string" ? body.title.slice(0, 120) : undefined;
        const alt = typeof body.altText === "string" ? body.altText.slice(0, 250) : undefined;
        const meta = { title, alt_text: alt, folder: "Canva", canva_design_id: body.designId };
        if (size.video) {
          const fileUrl = await exportDesign(userId, body.designId, { type: "mp4", quality: `${size.video}_1080p`, export_quality: "regular" });
          const file = await download(fileUrl, 50 * 1024 * 1024);
          const info = mp4Info(file.bytes);
          if (!info) return errorResponse("The exported video could not be read.", 400);
          const mediaId = await store(req, businessId, file.bytes, "video/mp4", "mp4", { ...meta, width: info.width, height: info.height, duration_ms: info.durationMs });
          // Cover picture: the design's first page as a still.
          let posterId: string | undefined;
          try {
            const stillUrl = await exportDesign(userId, body.designId, { type: "jpg", quality: 85, width: Math.min(size.width, 1920), export_quality: "regular" });
            const still = await download(stillUrl, 10 * 1024 * 1024);
            const s = jpegSize(still.bytes);
            if (s) posterId = await store(req, businessId, still.bytes, "image/jpeg", "jpg", { ...meta, title: `${title ?? "Video"} (cover)`.slice(0, 120), ...s });
          } catch { /* the app asks for a cover when there is none */ }
          return jsonResponse({ mediaId, posterId });
        }
        const fileUrl = await exportDesign(userId, body.designId, { type: "jpg", quality: 90, width: size.width, export_quality: "regular" });
        const file = await download(fileUrl, 10 * 1024 * 1024);
        const s = jpegSize(file.bytes) ?? pngSize(file.bytes);
        if (!s) return errorResponse("The exported picture could not be read.", 400);
        const isPng = file.bytes[0] === 0x89;
        const mediaId = await store(req, businessId, file.bytes, isPng ? "image/png" : "image/jpeg", isPng ? "png" : "jpg", { ...meta, ...s });
        return jsonResponse({ mediaId });
      }
      default:
        return errorResponse("Unknown action.", 400);
    }
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    console.error(`[canva-connect] ${action}:`, err.message);
    return errorResponse(err.message || "Canva request failed.", err.status ?? 500, err.code);
  }
});
