// supabase/functions/ops-alert/index.ts
// Tells the developer when something goes wrong, in Slack (SLACK_WEBHOOK_URL).
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
import { postToSlack, slackEscape } from "../shared/slack.ts";

const SEVERITY: Record<string, { label: string; icon: string }> = {
  blocking: { label: "Can't work", icon: ":rotating_light:" },
  broken: { label: "Something is wrong", icon: ":warning:" },
  minor: { label: "Small issue or idea", icon: ":information_source:" },
};

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function isServiceRole(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return !!key && token === key;
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
  const sent = await postToSlack({
    text: `${level.icon} *Problem report ${saved.reference}* · ${level.label}\n>${slackEscape(summary)}`,
    fields: [
      ["Business", slackEscape(await businessName(admin, businessId))],
      ["Reported by", slackEscape(`${employee?.name ?? "Unknown"} (${role})`)],
      ["App", slackEscape(`${text(body.appVersion, 32) || "?"} on ${text(body.platform, 32) || "?"}`)],
      ["Screen", slackEscape(text(body.screen, 64) || "—")],
    ],
    code: details || undefined,
  });
  if (sent) await admin.from("problem_reports").update({ slack_sent: true }).eq("id", saved.id);

  // Saved either way; the developer also sees unsent reports in the table.
  return jsonResponse({ success: true, reference: saved.reference, notified: sent });
}

async function crash(body: any): Promise<Response> {
  const crashId = text(body.crashId, 64);
  if (!crashId) return errorResponse("crashId is required.", 400);

  // Crashes before sign-in can be sent by anyone, so cap how many reach Slack.
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
  const sent = await postToSlack({
    text: isNew
      ? `:boom: *New crash* in ${slackEscape(c.app_version || "?")}\n>${slackEscape(c.message)}`
      : `:chart_with_upwards_trend: *Crash seen ${c.occurrences} times*\n>${slackEscape(c.message)}`,
    fields: [
      ["Business", slackEscape(await businessName(admin, c.business_id))],
      ["Platform", slackEscape(c.platform || "?")],
      ["Screen", slackEscape(c.screen || "—")],
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
        if (!isServiceRole(req)) return errorResponse("Not allowed.", 403);
        return await crash(body);
      case "test": {
        if (!isServiceRole(req)) return errorResponse("Not allowed.", 403);
        const sent = await postToSlack({ text: ":white_check_mark: KayKay's alerts are connected to this channel." });
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
