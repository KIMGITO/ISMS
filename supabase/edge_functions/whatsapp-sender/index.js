// supabase/edge_functions/whatsapp-sender/index.js
// Deno-compatible Supabase Edge Function to dispatch customer alerts via Meta WhatsApp Business Cloud API

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";

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
    const { to, customerName, orderId, finalTotal, status } = await req.json();

    if (!to || !customerName) {
      throw new Error("Missing recipient parameters 'to' or 'customerName'");
    }

    // Standardized Kenyan Country Code cleanups (e.g., 0712345678 -> 254712345678)
    let cleanPhone = to.replace(/[\s\-\+]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "254" + cleanPhone.substring(1);
    }

    // Dispatches a highly-stylized template or text bubble message to the customer
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanPhone,
      type: "text",
      text: {
        body: `Habari ${customerName}! 🥛\n\nYour order #${orderId || "N/A"} from KayKay's Milk has been confirmed!\nAmount: KES ${finalTotal || "0.00"}\nStatus: ${status || "Confirmed"}\n\nThank you for choosing local organic dairy! For support, reply directly to this chat.`
      }
    };

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    return new Response(JSON.stringify({ success: true, meta: result }), {
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
