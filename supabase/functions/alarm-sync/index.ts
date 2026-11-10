// supabase/functions/alarm-sync/index.ts
// Copies a reminder to its person's phones, so each phone can ring it as its own alarm, even
// offline. Called by the trg_schedule_alarm_sync trigger whenever a reminder is created, edited,
// moved to someone else or deleted. Phones that miss this message pick the change up from
// get_my_alarms() when the app next opens, and the server still pushes at the alarm time.
//
// Body: { schedule_id: uuid, user_ids: uuid[] }  (the people it was for and is for now)
// Auth: the service role key or FCM_WEBHOOK_SECRET, like send-fcm.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { alarmCancelMessage, alarmUpsertMessage, getFcmAccess, sendFcm, type AlarmPayload } from "../shared/fcm.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 all year, no daylight saving
const URGENT_WITHIN_MS = 60 * 60 * 1000;

/** Next time this reminder rings (ms since epoch), or null if it never will again. */
function nextRing(date: string, time: string, repeat: string, lastRemindedOn: string | null, now = Date.now()): number | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const at = (yy: number, mo: number, dd: number) => Date.UTC(yy, mo - 1, dd, hh, mm) - NAIROBI_OFFSET_MS;
  const nairobiToday = new Date(now + NAIROBI_OFFSET_MS);
  for (let i = -1; i <= 62; i++) {
    const day = new Date(Date.UTC(nairobiToday.getUTCFullYear(), nairobiToday.getUTCMonth(), nairobiToday.getUTCDate() + i));
    const key = day.toISOString().slice(0, 10);
    if (key < date || key === lastRemindedOn) continue;
    const matches =
      repeat === "Daily" ||
      (repeat === "None" && key === date) ||
      (repeat === "Weekly" && day.getUTCDay() === new Date(Date.UTC(y, m - 1, d)).getUTCDay()) ||
      (repeat === "Monthly" && day.getUTCDate() === d);
    if (!matches) continue;
    const t = at(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    if (t >= now - 10 * 60 * 1000) return t;
  }
  return null;
}

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const allowed = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("FCM_WEBHOOK_SECRET")].filter(Boolean);
  if (!bearer || !allowed.includes(bearer)) return json({ error: "Unauthorized" }, 401);

  let body: { schedule_id?: string; user_ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const scheduleId = body.schedule_id;
  const userIds = (body.user_ids || []).filter((u) => typeof u === "string" && UUID.test(u));
  if (!scheduleId || !UUID.test(scheduleId) || userIds.length === 0) return json({ error: "Bad request" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  try {
    // Read the reminder as it is now: the trigger's copy may already be out of date.
    const { data: s } = await admin
      .from("schedules")
      .select("id, business_id, employee_id, title, notes, date, start_time, repeat, last_reminded_on, updated_at, deleted_at")
      .eq("id", scheduleId)
      .maybeSingle();
    let owner: string | null = null;
    if (s && !s.deleted_at) {
      const { data: u } = await admin.rpc("fn_schedule_user", { p_employee_id: s.employee_id });
      owner = (u as string | null) ?? null;
    }

    const { data: tokens } = await admin
      .from("device_fcm_tokens")
      .select("id, user_id, device_token")
      .in("user_id", userIds);
    if (!tokens || tokens.length === 0) {
      console.log(`[alarm-sync] REMINDER_SYNC schedule=${scheduleId.slice(0, 8)} no devices for ${userIds.length} user(s)`);
      return json({ sent: 0, devices: 0 });
    }

    const time = s ? String(s.start_time).slice(0, 5) : "";
    const next = s ? nextRing(s.date, time, String(s.repeat), s.last_reminded_on) : null;
    const urgent = next !== null && next - Date.now() < URGENT_WITHIN_MS;
    const ttl = next === null ? 60 : s!.repeat === "None" ? Math.ceil((next - Date.now()) / 1000) + 600 : 2419200;

    const access = await getFcmAccess();
    let sent = 0;
    await Promise.all(tokens.map(async (t) => {
      const keep = owner !== null && t.user_id === owner && next !== null;
      const alarm: AlarmPayload | null = keep
        ? {
            id: s!.id,
            business_id: s!.business_id,
            user_id: owner!,
            title: s!.title || "Reminder",
            notes: s!.notes || "",
            date: s!.date,
            start_time: time,
            repeat: String(s!.repeat),
            last_reminded_on: s!.last_reminded_on || "",
            updated_at: s!.updated_at || "",
          }
        : null;
      const message = alarm
        ? alarmUpsertMessage(t.device_token, alarm, urgent, ttl)
        : alarmCancelMessage(t.device_token, scheduleId, t.user_id);
      const result = await sendFcm(access, message);
      if (result.ok) sent++;
      else {
        console.error(`[alarm-sync] REMINDER_SYNC failed for token row ${t.id}: ${result.error}`);
        if (result.staleToken) await admin.from("device_fcm_tokens").delete().eq("id", t.id);
      }
    }));

    console.log(
      `[alarm-sync] REMINDER_SYNC schedule=${scheduleId.slice(0, 8)} action=${owner ? "upsert" : "cancel"} ` +
      `urgent=${urgent} accepted=${sent}/${tokens.length}`,
    );
    return json({ sent, devices: tokens.length, urgent });
  } catch (e) {
    console.error("[alarm-sync] REMINDER_SYNC error:", (e as Error).message);
    return json({ error: "Could not sync the reminder." }, 500);
  }
});
