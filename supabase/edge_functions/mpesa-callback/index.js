// supabase/edge_functions/mpesa-callback/index.js
// Deno-compatible Supabase Edge Function to process incoming Safaricom Daraja API M-Pesa STK Push callbacks/webhooks

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.14.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    const { Body } = await req.json();

    if (!Body || !Body.stkCallback) {
      throw new Error("Invalid Safaricom M-Pesa callback body");
    }

    const callback = Body.stkCallback;
    const checkoutRequestId = callback.CheckoutRequestID;
    const merchantRequestId = callback.MerchantRequestID;
    const resultCode = callback.ResultCode;
    const resultDesc = callback.ResultDesc;

    let phone = "";
    let amount = 0;
    let receiptNumber = "";
    let status = "Failed";

    if (resultCode === 0) {
      status = "Completed";
      // Parse callback parameters
      const items = callback.CallbackMetadata.Item;
      for (const item of items) {
        if (item.Name === "Amount") {
          amount = item.Value;
        } else if (item.Name === "MpesaReceiptNumber") {
          receiptNumber = item.Value;
        } else if (item.Name === "PhoneNumber") {
          phone = String(item.Value);
        }
      }
    }

    // Invoke PostgreSQL procedure inside Supabase to safely process the payment details and log notifications
    const { error } = await supabase.rpc("log_mpesa_payment", {
      p_checkout_request_id: checkoutRequestId,
      p_merchant_request_id: merchantRequestId,
      p_phone: phone || "N/A",
      p_amount: amount,
      p_status: status,
      p_receipt_number: receiptNumber || null
    });

    if (error) {
      throw error;
    }

    return new Response(JSON.stringify({ success: true, message: "Callback processed successfully" }), {
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
