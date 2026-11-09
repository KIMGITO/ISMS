import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getFcmAccess, ringMessage, sendFcm } from '../shared/fcm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS Preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only backend callers may push: the notifications webhook and other functions.
  // The webhook must send the service role key or the FCM_WEBHOOK_SECRET value as a bearer token.
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const allowedTokens = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('FCM_WEBHOOK_SECRET')].filter(Boolean);
  if (!bearer || !allowedTokens.includes(bearer)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();

    // Support both direct client invocations and database webhooks
    const isDirectInvoke = body.notification !== undefined;
    const notificationPayload = isDirectInvoke ? body.notification : body.record;
    const targetPayload = isDirectInvoke ? body.target : body.record;

    const title = notificationPayload?.title;
    const messageText = isDirectInvoke ? notificationPayload?.body : notificationPayload?.message;
    const type = isDirectInvoke ? notificationPayload?.data?.type : notificationPayload?.type;
    const notificationId = notificationPayload?.id || notificationPayload?.notification_id || null;

    // 1. Initialize Supabase Client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. Fetch device tokens (including the per-device sound tone)
    let query = supabaseClient.from('device_fcm_tokens').select('device_token, user_id, id, sound');

    // Pushes stay inside the notification's own business; there is no all-devices fallback.
    const businessId = targetPayload?.business_id || notificationPayload?.business_id || null;

    // The database applies each person's notification settings and role.
    const { data: recipients, error: recipientsError } = await supabaseClient.rpc('fn_notification_recipients', {
      p_business_id: businessId,
      p_user_id: targetPayload?.user_id ?? null,
      p_role: targetPayload?.role ?? null,
      p_type: type ?? '',
    });
    if (recipientsError) throw recipientsError;
    query = query.in('user_id', recipients ?? []);

    const { data: tokens, error: tokensError } = await query;

    if (tokensError || !tokens || tokens.length === 0) {
      console.warn("[send-fcm] No tokens found — aborting");

      // Still mark the notification as "attempted" so it doesn't stay pending forever
      if (notificationId) {
        await supabaseClient
          .from('notifications')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', notificationId);
      }

      return new Response(JSON.stringify({ message: "No tokens found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Sign in to FCM
    const access = await getFcmAccess();

    // Alerts that ring go as data-only messages, so the app's own service rings them.
    const ring = !isDirectInvoke && targetPayload?.ring === true && !!notificationId;

    // 4. Send to each device, tracking failures for token cleanup
    const sendPromises = tokens.map(async ({ device_token: token, user_id: tokenUserId, id: tokenRowId, sound: tokenSound }) => {
      // Per-device tone: stored as e.g. "notification1.mp3" or "notification1".
      // Normalise:
      //   - Android raw resource name (no extension, lowercase).
      //   - iOS / APNs sound filename (with .mp3 extension).
      const rawSound = (tokenSound && tokenSound !== '' && tokenSound !== 'none') ? tokenSound : 'notification1.mp3';
      const androidSound = rawSound.replace(/\.mp3$/i, '');
      const apnsSound = rawSound.endsWith('.mp3') ? rawSound : `${rawSound}.mp3`;

      const message = ring
        ? ringMessage(token, {
            id: notificationId,
            title: title || 'Alert',
            body: messageText || '',
            actionTarget: targetPayload?.action_target || 'none',
            type: type || '',
            businessId: businessId || '',
          })
        : {
            token,
            notification: {
              title: title || "New Notification",
              body: messageText || "You have a new message.",
            },
            // Android uses the bundled raw resource name (no extension).
            // iOS uses the sound filename in the app bundle.
            android: {
              notification: {
                sound: androidSound,
                channel_id: 'default',
              },
            },
            apns: {
              payload: {
                aps: {
                  sound: apnsSound,
                },
              },
            },
            data: {
              type: type || 'info',
              notification_id: notificationId || '',
              priority: targetPayload?.priority || 'medium',
              action_type: targetPayload?.action_type || 'navigate',
              action_target: targetPayload?.action_target || 'none',
            },
          };

      const result = await sendFcm(access, message);
      if (!result.ok && result.staleToken) {
        // Token is stale/invalid (unregistered, invalid-argument): delete it
        console.warn(`[send-fcm] Removing stale token`);
        await supabaseClient.from('device_fcm_tokens').delete().eq('id', tokenRowId);
      }
      if (!result.ok) console.error(`[send-fcm] Send failed:`, result.error);
      return { token, success: result.ok, error: result.error, tokenRowId, tokenUserId };
    });

    const results = await Promise.all(sendPromises);
    const successfulSends = results.filter((r) => r.success).length;

    // 8. ACTUALIZE DELIVERY: update the notification's delivery status
    //    pending -> sent (FCM accepted) with sent_at timestamp
    if (notificationId) {
      await supabaseClient
        .from('notifications')
        .update({
          status: successfulSends > 0 ? 'sent' : 'delivered',
          sent_at: new Date().toISOString(),
          delivered_at: successfulSends > 0 ? new Date().toISOString() : undefined,
        })
        .eq('id', notificationId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: successfulSends,
        failed: results.length - successfulSends,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[send-fcm] FATAL ERROR:", error.message);
    return new Response(JSON.stringify({ error: 'Failed to send notification.' }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});