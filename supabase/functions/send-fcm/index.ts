import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { JWT } from 'https://esm.sh/google-auth-library@9';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS Preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

    // 2. Fetch device tokens
    let query = supabaseClient.from('device_fcm_tokens').select('device_token, user_id, id');

    if (targetPayload?.user_id) {
      query = query.eq('user_id', targetPayload.user_id);
    } else if (targetPayload?.role) {
      const { data: members } = await supabaseClient
        .from('business_memberships')
        .select('user_id')
        .ilike('role', targetPayload.role);

      const userIds = members?.map((m: any) => m.user_id).filter(Boolean) || [];
      if (userIds.length > 0) {
        query = query.in('user_id', userIds);
      } else {
        console.log(`[send-fcm] No specific user_ids matched role "${targetPayload.role}", delivering to all active device tokens.`);
      }
    } else {
      console.log("[send-fcm] No user_id or role filter — fetching ALL device tokens");
    }

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

    // 3. Get Firebase credentials
    const serviceAccountStr = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
    if (!serviceAccountStr) {
      console.error("[send-fcm] FIREBASE_SERVICE_ACCOUNT secret is MISSING!");
      throw new Error("Missing FIREBASE_SERVICE_ACCOUNT secret");
    }
    const serviceAccount = JSON.parse(serviceAccountStr);

    // 4. Create a JWT for Google OAuth2
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });

    // 5. Get access token
    const { token: accessToken } = await jwtClient.getAccessToken();

    // 6. Send to each device, tracking failures for token cleanup
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    const sendPromises = tokens.map(async ({ device_token: token, user_id: tokenUserId, id: tokenRowId }) => {
      try {
        const response = await fetch(fcmUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: token,
              notification: {
                title: title || "New Notification",
                body: messageText || "You have a new message.",
              },
              data: {
                type: type || 'info',
                notification_id: notificationId || '',
                priority: targetPayload?.priority || 'medium',
                action_type: targetPayload?.action_type || 'navigate',
                action_target: targetPayload?.action_target || 'none',
              }
            }
          })
        });

        const result = await response.json();

        if (response.ok) {
          return { token, success: true, result, tokenRowId, tokenUserId };
        } else {
          // 7. Token is stale/invalid (unregistered, invalid-argument): delete it
          const isInvalidToken =
            result?.error?.status === 'UNREGISTERED' ||
            result?.error?.code === 404 ||
            result?.error?.message?.includes('invalid') ||
            result?.error?.message?.includes('not found');

          if (isInvalidToken) {
            console.warn(`[send-fcm] Removing stale token ${token}`);
            await supabaseClient.from('device_fcm_tokens').delete().eq('id', tokenRowId);
          }
          return { token, success: false, error: result?.error?.message, tokenRowId };
        }
      } catch (e) {
        console.error(`[send-fcm] Network error sending to token:`, e);
        return { token, success: false, error: e.message };
      }
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
  } catch (error) {
    console.error("[send-fcm] FATAL ERROR:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});