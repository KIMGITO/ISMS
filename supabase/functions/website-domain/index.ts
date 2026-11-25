// supabase/functions/website-domain/index.ts
// A shop's own web address (module own_domain, 20261204004), through Cloudflare for SaaS.
//   add    {businessId, hostname}  register it; returns the DNS records the shop must add
//   check  {businessId}            ask Cloudflare whether it works yet (active once DNS + certificate are done)
//   remove {businessId}            take it off
//   recheck_all                    every address, oldest check first (the nightly job
//                                  website_domains_recheck, 20261208001; service key only)
// Who may do it and whether the plan allows it are checked by the database functions, called
// as the signed-in person. Cloudflare needs CF_SAAS_ZONE_ID and CF_SAAS_API_TOKEN (a token with
// "SSL and Certificates: Edit" on the platform zone); without them nothing is registered.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  createUserClient,
  enforceRateLimit,
  errorResponse,
  handleCors,
  jsonResponse,
  verifyUserMembership,
} from "../shared/cors.ts";
import { matchesAnySecret } from "../shared/guard.ts";

const CF_API = "https://api.cloudflare.com/client/v4";

interface DnsRecord {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
}

function cfConfig() {
  const zone = Deno.env.get("CF_SAAS_ZONE_ID");
  const token = Deno.env.get("CF_SAAS_API_TOKEN");
  return zone && token ? { zone, token } : null;
}

async function cf(path: string, init: RequestInit = {}): Promise<any> {
  const cfg = cfConfig()!;
  const res = await fetch(`${CF_API}/zones/${cfg.zone}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    const message = body?.errors?.[0]?.message ?? `Cloudflare answered ${res.status}`;
    throw new Error(message);
  }
  return body.result;
}

/** What the shop adds at its domain company: the CNAME, plus any check records Cloudflare asks for. */
function recordsFor(hostname: string, target: string | null, result: any): DnsRecord[] {
  const records: DnsRecord[] = [];
  if (target) records.push({ type: "CNAME", name: hostname, value: target });
  const own = result?.ownership_verification;
  if (own?.name && own?.value) records.push({ type: "TXT", name: own.name, value: own.value });
  for (const v of result?.ssl?.validation_records ?? []) {
    if (v?.txt_name && v?.txt_value) records.push({ type: "TXT", name: v.txt_name, value: v.txt_value });
  }
  return records;
}

const isActive = (result: any) => result?.status === "active" && result?.ssl?.status === "active";
/** What an address is now. A live one that stops working goes back to waiting, so visitors are no longer sent there. */
const statusOf = (result: any) =>
  isActive(result) ? "active" : result?.status === "blocked" || result?.status === "moved" ? "failed" : "pending";

/** The nightly check: at most 200 addresses per run, the longest unchecked first. */
async function recheckAll(admin: any): Promise<Response> {
  const { data, error } = await admin.from("website_domains")
    .select("business_id, hostname, cf_hostname_id, status")
    .not("cf_hostname_id", "is", null)
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (error) return errorResponse(error.message, 500);
  // The same target website_address_info gives the app.
  const target: string | null = await admin.from("platform_settings").select("platform_domain, custom_domain_target").eq("id", true).maybeSingle()
    .then((r: any) => r.data?.custom_domain_target ?? (r.data?.platform_domain ? `customers.${r.data.platform_domain}` : null), () => null);
  let changed = 0;
  let failed = 0;
  for (const d of data ?? []) {
    try {
      const result = await cf(`/custom_hostnames/${d.cf_hostname_id}`);
      const status = statusOf(result);
      if (status !== d.status) changed++;
      await admin.from("website_domains").update({
        status,
        dns_records: recordsFor(d.hostname, target, result),
        last_error: problem(result),
        checked_at: new Date().toISOString(),
      }).eq("business_id", d.business_id).eq("cf_hostname_id", d.cf_hostname_id);
    } catch (err) {
      failed++;
      console.error("[website-domain] recheck", d.hostname, (err as Error).message);
    }
  }
  return jsonResponse({ checked: (data ?? []).length - failed, changed, failed });
}

function problem(result: any): string | null {
  const errors = [...(result?.verification_errors ?? []), ...(result?.ssl?.validation_errors ?? []).map((e: any) => e?.message)];
  return errors.filter(Boolean).join(" ") || null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Use POST.", 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON payload", 400);
  }
  const { action, businessId, hostname } = body ?? {};

  if (action === "recheck_all") {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!matchesAnySecret(bearer, [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")])) return errorResponse("Not allowed.", 401);
    if (!cfConfig()) return jsonResponse({ checked: 0, changed: 0, failed: 0, note: "Cloudflare not configured" });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return recheckAll(admin);
  }
  if (!businessId || typeof businessId !== "string") return errorResponse("businessId is required.", 400);

  const { userId, errorResponse: authError } = await verifyUserMembership(req, businessId);
  if (authError) return authError;
  const limited = await enforceRateLimit(`website-domain:${userId}`, 20, 3600);
  if (limited) return limited;

  const user = createUserClient(req);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Also checks the caller is the owner or an admin of this shop.
  const info = await user.rpc("website_address_info", { p_business_id: businessId });
  if (info.error) return errorResponse(info.error.message, 403);
  const target: string | null = info.data?.domain_target ?? null;

  try {
    if (action === "remove") {
      const { data: cfId, error } = await user.rpc("website_domain_remove", { p_business_id: businessId });
      if (error) return errorResponse(error.message, 400);
      if (cfId && cfConfig()) await cf(`/custom_hostnames/${cfId}`, { method: "DELETE" }).catch(() => undefined);
      return jsonResponse({ ok: true });
    }

    if (!cfConfig()) {
      return errorResponse("Own web addresses aren't switched on yet. Please contact us.", 503, "NOT_CONFIGURED");
    }

    if (action === "add") {
      if (!hostname || typeof hostname !== "string") return errorResponse("hostname is required.", 400);
      const start = await user.rpc("website_domain_start", { p_business_id: businessId, p_hostname: hostname });
      if (start.error) return errorResponse(start.error.message, 400);
      const { hostname: clean, old_cf_id: oldId, cf_id: existingId } = start.data as any;
      if (oldId) await cf(`/custom_hostnames/${oldId}`, { method: "DELETE" }).catch(() => undefined);

      const result = existingId
        ? await cf(`/custom_hostnames/${existingId}`)
        : await cf("/custom_hostnames", {
            method: "POST",
            body: JSON.stringify({ hostname: clean, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } }),
          });
      const row = {
        cf_hostname_id: result.id,
        status: isActive(result) ? "active" : "pending",
        dns_records: recordsFor(clean, target, result),
        last_error: problem(result),
        checked_at: new Date().toISOString(),
      };
      await admin.from("website_domains").update(row).eq("business_id", businessId);
      return jsonResponse({ hostname: clean, ...row });
    }

    if (action === "check") {
      const { data: d } = await admin.from("website_domains").select("hostname, cf_hostname_id").eq("business_id", businessId).maybeSingle();
      if (!d) return errorResponse("This shop has no own web address.", 404);
      if (!d.cf_hostname_id) return errorResponse("The address wasn't registered. Remove it and add it again.", 409);
      const result = await cf(`/custom_hostnames/${d.cf_hostname_id}`);
      const row = {
        status: statusOf(result),
        dns_records: recordsFor(d.hostname, target, result),
        last_error: problem(result),
        checked_at: new Date().toISOString(),
      };
      await admin.from("website_domains").update(row).eq("business_id", businessId);
      return jsonResponse({ hostname: d.hostname, ...row });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err) {
    console.error("[website-domain]", (err as Error).message);
    return errorResponse("Cloudflare didn't accept that. Please check the address and try again.", 502);
  }
});
