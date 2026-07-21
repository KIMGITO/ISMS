import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { JWT } from 'https://esm.sh/google-auth-library@9';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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

    const title = isDirectInvoke ? notificationPayload.title : notificationPayload.title;
    const messageText = isDirectInvoke ? notificationPayload.body : notificationPayload.message;
    const type = isDirectInvoke ? notificationPayload.data?.type : notificationPayload.type;
    // 1. Initialize Supabase Client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. Fetch all device tokens for the user this notification is meant for
    let query = supabaseClient.from('device_fcm_tokens').select('token');
    
    // Filter based on the target payload
    if (targetPayload?.user_id) {
      query = query.eq('user_id', targetPayload.user_id);
    }
    // Optional: Add filtering by role/business_id if you want to support broadcast

    const { data: tokens, error: tokensError } = await query;

    if (tokensError || !tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ message: "No tokens found" }), { 
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Get Firebase credentials from our secret
    const serviceAccountStr = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
    if (!serviceAccountStr) {
      throw new Error("Missing FIREBASE_SERVICE_ACCOUNT secret");
    }
    const serviceAccount = JSON.parse(serviceAccountStr);

    // 4. Create a JWT for Google OAuth2
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    
    // 5. Get the access token
    const { token: accessToken } = await jwtClient.getAccessToken();

    // 6. Send push notification to each device token
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    
    const sendPromises = tokens.map(async ({ token }) => {
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
              type: type || 'info', // Pass custom data here
            }
          }
        })
      });

      return response.json();
    });

    const results = await Promise.all(sendPromises);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error sending FCM:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
