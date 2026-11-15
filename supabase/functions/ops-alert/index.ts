// supabase/functions/ops-alert/index.ts
// Tells the developer when something goes wrong, in Telegram (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
//
//   GET                      Health check for an uptime monitor: is the database answering?
//   POST {action:"report"}   An owner or admin reports a problem (About this app → Report a problem).
//   POST {action:"crash"}    A new or growing crash, sent by the crash_reports trigger (service role only).
//   POST {action:"test"}     Sends a test message (service role only), to check the setup.
//
// verify_jwt is off (supabase/config.toml) so the uptime monitor can call GET without a key.
// Every POST action checks its own caller.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  enforceRateLimit,
} from "../shared/cors.ts";
import { sendAlert, htmlEscape } from "../shared/telegram.ts";

const SEVERITY: Record<string, { label: string; icon: string }> = {
  blocking: { label: "Can't work", icon: "🚨" },
  broken: { label: "Something is wrong", icon: "⚠️" },
  minor: { label: "Small issue or idea", icon: "ℹ️" },
};

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Keys already checked in this instance, so a burst of crashes asks Auth only once.
const confirmedServiceKeys = new Set<string>();

/** The key the caller sent, from Authorization: Bearer or the apikey header. */
function callerKey(req: Request): string {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return bearer || (req.headers.get("apikey") || "").trim();
}

/**
 * True when the caller holds a service key for this project. A project can have more than
 * one (the legacy service_role JWT and the newer sb_secret_ keys), and the copy saved in
 * Vault need not be the one this function was given, so a key that isn't an exact match is
 * checked with Auth: only a service key may list users.
 */
async function isServiceRole(req: Request): Promise<boolean> {
  const token = callerKey(req);
  if (token.length < 20) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || confirmedServiceKeys.has(token)) return true;

  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return false;
  try {
    const headers: Record<string, string> = { apikey: token };
    if (token.startsWith("eyJ")) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    await res.body?.cancel();
    if (!res.ok) return false;
    confirmedServiceKeys.add(token);
    return true;
  } catch (err) {
    console.error("[ops-alert] Couldn't check the caller's key:", err);
    return false;
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function businessName(admin: any, businessId: string | null): Promise<string> {
  if (!businessId) return "Not signed in";
  const { data } = await admin.from("businesses").select("name").eq("id", businessId).maybeSingle();
  return data?.name || businessId;
}

async function health(): Promise<Response> {
  const started = Date.now();
  const { error } = await adminClient().from("businesses").select("id", { head: true, count: "exact" }).limit(1);
  const ms = Date.now() - started;
  if (error) {
    console.error("[ops-alert] Health check failed:", error.message);
    return jsonResponse({ ok: false, database: false, ms }, 503);
  }
  return jsonResponse({ ok: true, database: true, ms });
}

async function report(req: Request, body: any): Promise<Response> {
  const businessId = text(body.businessId, 64);
  if (!businessId) return errorResponse("businessId is required.", 400);

  const { userId, role, errorResponse: authError } = await verifyUserMembership(req, businessId);
  if (authError) return authError;
  if (userId === "service_role" || (role !== "Owner" && role !== "Admin")) {
    return errorResponse("Only the owner or an admin can report problems. Ask them to report it for you.", 403, "FORBIDDEN");
  }

  const limited = await enforceRateLimit(`ops-report:${userId}`, 10, 3600);
  if (limited) return limited;

  const severity = SEVERITY[body.severity] ? body.severity : "broken";
  const summary = text(body.summary, 200);
  if (!summary) return errorResponse("Say what went wrong.", 400);
  const details = text(body.details, 4000);

  const admin = adminClient();
  const { data: employee } = await admin
    .from("employees")
    .select("name")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  const { data: saved, error } = await admin
    .from("problem_reports")
    .insert({
      business_id: businessId,
      reported_by: userId,
      reporter: employee?.name ?? null,
      severity,
      summary,
      details: details || null,
      screen: text(body.screen, 64) || null,
      platform: text(body.platform, 32) || null,
      app_version: text(body.appVersion, 32) || null,
      app_commit: text(body.appCommit, 64) || null,
    })
    .select("id, reference")
    .single();
  if (error) {
    console.error("[ops-alert] Saving report failed:", error.message);
    return errorResponse("The report couldn't be saved. Please try again.", 500);
  }

  const level = SEVERITY[severity];
  const sent = await sendAlert({
    text: `${level.icon} <b>Problem report ${saved.reference}</b> · ${level.label}\n<i>${htmlEscape(summary)}</i>`,
    fields: [
      ["Business", await businessName(admin, businessId)],
      ["Reported by", `${employee?.name ?? "Unknown"} (${role})`],
      ["App", `${text(body.appVersion, 32) || "?"} on ${text(body.platform, 32) || "?"}`],
      ["Screen", text(body.screen, 64) || "—"],
    ],
    code: details || undefined,
  });
  if (sent) await admin.from("problem_reports").update({ alert_sent: true }).eq("id", saved.id);

  // Saved either way; the developer also sees unsent reports in the table.
  return jsonResponse({ success: true, reference: saved.reference, notified: sent });
}

async function crash(body: any): Promise<Response> {
  const crashId = text(body.crashId, 64);
  if (!crashId) return errorResponse("crashId is required.", 400);

  // Crashes before sign-in can be sent by anyone, so cap how many reach Telegram.
  const limited = await enforceRateLimit("ops-crash-alerts", 30, 3600);
  if (limited) return jsonResponse({ success: true, skipped: "rate_limited" });

  const admin = adminClient();
  const { data: c, error } = await admin
    .from("crash_reports")
    .select("business_id, message, stack, screen, platform, app_version, occurrences, first_seen_at")
    .eq("id", crashId)
    .maybeSingle();
  if (error || !c) return errorResponse("Crash not found.", 404);

  const isNew = c.occurrences <= 1;
  const sent = await sendAlert({
    text: isNew
      ? `💥 <b>New crash</b> in ${htmlEscape(c.app_version || "?")}\n<i>${htmlEscape(c.message)}</i>`
      : `📈 <b>Crash seen ${c.occurrences} times</b>\n<i>${htmlEscape(c.message)}</i>`,
    fields: [
      ["Business", await businessName(admin, c.business_id)],
      ["Platform", c.platform || "?"],
      ["Screen", c.screen || "—"],
      ["First seen", new Date(c.first_seen_at).toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ],
    code: (c.stack || "").split("\n").slice(0, 12).join("\n") || undefined,
  });
  return jsonResponse({ success: true, notified: sent });
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    if (req.method === "GET") return await health();
    if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body.", 400);
    }

    switch (body?.action) {
      case "report":
        return await report(req, body);
      case "crash":
        if (!(await isServiceRole(req))) return errorResponse("Not allowed.", 403);
        return await crash(body);
      case "test": {
        if (!(await isServiceRole(req))) return errorResponse("Not allowed.", 403);
        const sent = await sendAlert({ text: "✅ KayKay's alerts are connected to this chat." });
        return jsonResponse({ success: sent }, sent ? 200 : 502);
      }
      default:
        return errorResponse(`Unknown action: "${body?.action}"`, 400);
    }
  } catch (err) {
    console.error("[ops-alert] Unexpected error:", err);
    return errorResponse("Something went wrong.", 500);
  }
});
