// supabase/edge_functions/send-email/index.js
// Deno-compatible Supabase Edge Function to dispatch customer or management email reports using Resend API

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

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
    const { to, subject, htmlBody } = await req.json();

    if (!to || !subject || !htmlBody) {
      throw new Error("Missing parameters 'to', 'subject', or 'htmlBody'");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "KayKays Milk Operations <operations@kaykaysmilk.com>",
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        html: htmlBody,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Failed to dispatch email via Resend");
    }

    return new Response(JSON.stringify({ success: true, emailId: result.id }), {
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
