// supabase/functions/accept-alert/index.ts
// Accepts a ringing alert for the signed-in person, then stops it ringing on every other
// device it went to. Accepting in the database alone would leave closed phones ringing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../shared/cors.ts";
import { getFcmAccess, ringCancelMessage, sendFcm } from "../shared/fcm.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const authorization = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) return json({ error: "Please sign in again." }, 401);

  let notificationId: string | undefined;
  try {
    notificationId = (await req.json())?.notificationId;
  } catch {
    // handled below
  }
  if (!notificationId || !/^[0-9a-f-]{36}$/i.test(notificationId)) {
    return json({ error: "That alert was not found." }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authorization } },
  });
  const { data: result, error } = await asUser.rpc("accept_alert", { p_notification_id: notificationId });
  if (error) {
    return json({ error: error.message || "Could not accept the alert." }, error.code === "42501" ? 403 : 400);
  }

  // Stop it ringing elsewhere. A failure here is logged, not shown: the alert is accepted,
  // and the other phones stop when their app next opens.
  try {
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: row } = await admin
      .from("notifications")
      .select("business_id, user_id, role, type")
      .eq("id", notificationId)
      .single();
    if (row) {
      const { data: recipients } = await admin.rpc("fn_notification_recipients", {
        p_business_id: row.business_id,
        p_user_id: row.user_id,
        p_role: row.role,
        p_type: row.type,
      });
      const { data: tokens } = await admin
        .from("device_fcm_tokens")
        .select("id, device_token")
        .in("user_id", recipients ?? []);
      if (tokens && tokens.length > 0) {
        const access = await getFcmAccess();
        await Promise.all(tokens.map(async (t) => {
          const sent = await sendFcm(access, ringCancelMessage(t.device_token, notificationId!));
          if (!sent.ok && sent.staleToken) await admin.from("device_fcm_tokens").delete().eq("id", t.id);
        }));
      }
    }
  } catch (e) {
    console.error("[accept-alert] Could not stop ringing on other devices:", (e as Error).message);
  }

  return json(result);
});
