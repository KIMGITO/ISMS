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
    console.log("[send-fcm] Received payload:", JSON.stringify(body).slice(0, 300));

    // Support both direct client invocations and database webhooks
    const isDirectInvoke = body.notification !== undefined;
    const notificationPayload = isDirectInvoke ? body.notification : body.record;
    const targetPayload = isDirectInvoke ? body.target : body.record;

    const title = notificationPayload?.title;
    const messageText = isDirectInvoke ? notificationPayload?.body : notificationPayload?.message;
    const type = isDirectInvoke ? notificationPayload?.data?.type : notificationPayload?.type;

    console.log(`[send-fcm] title="${title}" message="${messageText}" type="${type}"`);
    console.log(`[send-fcm] target user_id="${targetPayload?.user_id}" role="${targetPayload?.role}"`);

    // 1. Initialize Supabase Client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. Fetch device tokens
    let query = supabaseClient.from('device_fcm_tokens').select('device_token');

    if (targetPayload?.user_id) {
      console.log(`[send-fcm] Filtering tokens for user_id: ${targetPayload.user_id}`);
      query = query.eq('user_id', targetPayload.user_id);
    } else if (targetPayload?.role) {
      console.log(`[send-fcm] Filtering tokens for role: ${targetPayload.role}`);
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
    console.log(`[send-fcm] Tokens result: count=${tokens?.length ?? 0} error=${tokensError?.message ?? 'none'}`);

    if (tokensError || !tokens || tokens.length === 0) {
      console.warn("[send-fcm] No tokens found — aborting");
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
    console.log("[send-fcm] Firebase service account found, authenticating...");
    const serviceAccount = JSON.parse(serviceAccountStr);

    // 4. Create a JWT for Google OAuth2
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });

    // 5. Get access token
    const { token: accessToken } = await jwtClient.getAccessToken();
    console.log(`[send-fcm] Access token: ${accessToken ? 'obtained ✅' : 'NULL ❌'}`);

    // 6. Send to each device
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    console.log(`[send-fcm] Sending to ${tokens.length} device(s)`);

    const sendPromises = tokens.map(async ({ device_token: token }) => {
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
            }
          }
        })
      });

      const result = await response.json();
      console.log(`[send-fcm] FCM result for ...${token.slice(-8)}:`, JSON.stringify(result));
      return result;
    });

    const results = await Promise.all(sendPromises);
    console.log("[send-fcm] All done ✅");

    return new Response(
      JSON.stringify({ success: true, results }),
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
