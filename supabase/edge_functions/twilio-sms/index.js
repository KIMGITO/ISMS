// supabase/edge_functions/twilio-sms/index.js
// Deno-compatible Supabase Edge Function to send bulk or transactional SMS alerts using Twilio APIs

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_SENDER_NUMBER = Deno.env.get("TWILIO_SENDER_NUMBER") || "";

serve(async (req) => {
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      }
    });
  }

  try {
    const { to, body } = await req.json();

    if (!to || !body) {
      throw new Error("Missing parameters 'to' or 'body'");
    }

    // Normalize phone numbers for Kenya (e.g. 0712345678 -> +254712345678)
    let cleanPhone = to.replace(/[\s\-\+]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "254" + cleanPhone.substring(1);
    }
    if (!cleanPhone.startsWith("+")) {
      cleanPhone = "+" + cleanPhone;
    }

    // Prepare credentials for Basic Auth
    const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    // Build URL-encoded request body
    const formData = new URLSearchParams();
    formData.append("To", cleanPhone);
    formData.append("From", TWILIO_SENDER_NUMBER);
    formData.append("Body", body);

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Failed to dispatch Twilio SMS");
    }

    return new Response(JSON.stringify({ success: true, sid: result.sid }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 400,
    });
  }
});
