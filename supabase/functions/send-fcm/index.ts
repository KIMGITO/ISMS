import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import admin from "npm:firebase-admin@11.11.0";

// Ensure Firebase is initialized only once
const firebaseServiceAccount = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");

if (firebaseServiceAccount && !admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(firebaseServiceAccount);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Firebase Admin:", error);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    // Initialize Supabase Client with Service Role to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Authorization header is required");
    }

    const body = await req.json();
    const { notification, target } = body;

    if (!notification || !target) {
      throw new Error("Missing 'notification' or 'target' in request body");
    }

    // Verify tenant membership if business_id is targetted
    const businessId = target.business_id || target.businessId;
    if (businessId) {
      const supabaseUserClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
      if (authError || !user) {
        throw new Error("Invalid token or unauthorized user");
      }
      
      const { data: membership, error: memError } = await supabase
        .from("business_memberships")
        .select("id")
        .eq("business_id", businessId)
        .eq("user_id", user.id)
        .eq("status", "Active")
        .maybeSingle();

      if (memError || !membership) {
        throw new Error("Permission Denied: User is not an active member of this business.");
      }
    }

    let userIds: string[] = [];

    // 1. Resolve target users
    if (target.user_id) {
      userIds.push(target.user_id);
    } else if (target.business_id && target.role) {
      // Find users with specific role in the business
      const { data: memberships, error: membershipError } = await supabase
        .from("business_memberships")
        .select("user_id")
        .eq("business_id", target.business_id)
        .eq("role", target.role);

      if (membershipError) {
        throw new Error(`Error fetching memberships: ${membershipError.message}`);
      }

      userIds = memberships.map((m: any) => m.user_id);
    } else {
      throw new Error("Target must specify either 'user_id' or both 'business_id' and 'role'");
    }

    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ message: "No matching users found for target criteria", success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch device tokens for these users
    const { data: tokens, error: tokenError } = await supabase
      .from("device_fcm_tokens")
      .select("device_token")
      .in("user_id", userIds);

    if (tokenError) {
      throw new Error(`Error fetching device tokens: ${tokenError.message}`);
    }

    const fcmTokens = tokens.map((t: any) => t.device_token).filter(Boolean);

    if (fcmTokens.length === 0) {
      return new Response(
        JSON.stringify({ message: "No device tokens found for target users", success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Dispatch via Firebase Admin SDK
    if (!admin.apps.length) {
      throw new Error("Firebase Admin is not initialized. Please set FIREBASE_SERVICE_ACCOUNT secret.");
    }

    const payload = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      tokens: fcmTokens,
    };

    const response = await admin.messaging().sendMulticast(payload);
    
    // Log failures (optional: could also remove invalid tokens from the database here)
    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(fcmTokens[idx]);
          console.error("Failed to send to token", fcmTokens[idx], resp.error);
        }
      });
      console.log(`Failed to send to ${response.failureCount} tokens.`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Push notifications dispatched", 
        successCount: response.successCount,
        failureCount: response.failureCount
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-fcm function:", error);
    return new Response(JSON.stringify({ error: error.message, success: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
