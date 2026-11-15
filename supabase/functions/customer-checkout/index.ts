// supabase/functions/customer-checkout/index.ts
// Starts a payment prompt for a signed-in customer's own order: M-Pesa (STK push) or
// Airtel Money (USSD push, with the business's own Airtel keys).
// Actions: pay (method "mpesa" by default, or "airtel") | check (both kinds)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCors, jsonResponse, errorResponse, enforceRateLimit } from "../shared/cors.ts";
import { stkPush, stkQuery } from "./daraja.ts";
import { MAX_AIRTEL_AMOUNT, newReference, pushPayment } from "../airtel-payments/airtel.ts";
import { keysFor, refreshPrompt } from "../airtel-payments/settle.ts";
import { toAirtelMsisdn } from "../airtel-payments/phone.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Daraja's PartyA format: 2547XXXXXXXX or 2541XXXXXXXX. */
function toDarajaPhone(phone: string): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return errorResponse("Please sign in again.", 401, "AUTH_REQUIRED");

    const { action, orderId, phone, method } = await req.json().catch(() => ({}));
    if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) {
      return errorResponse("Order not found.", 400);
    }

    if (action === "pay" && method === "airtel") {
      const limited = await enforceRateLimit(`checkout:user:${user.id}`, 6, 600);
      if (limited) return limited;

      const msisdn = toAirtelMsisdn(phone);
      if (!msisdn) return errorResponse("Please enter a valid Airtel number, like 0733 123 456.", 400, "BAD_PHONE");

      const { data: order, error } = await admin.rpc("begin_order_payment", { p_order_id: orderId, p_user_id: user.id });
      if (error) {
        if (error.code === "P0001") return errorResponse(error.message, 409);
        throw error;
      }

      const { data: airtelOn } = await admin.rpc("fn_method_enabled", { p_business_id: order.businessId, p_method: "Airtel Money" });
      const keys = airtelOn === true ? await keysFor(admin, order.businessId) : null;
      if (!keys) {
        return errorResponse("This shop isn't taking Airtel Money online right now. Please pay with M-Pesa.", 409, "METHOD_OFF");
      }

      const amount = Number(order.total);
      if (!Number.isInteger(amount)) {
        return errorResponse("Airtel Money only takes whole shillings, and this order has cents. Please pay with M-Pesa.", 409, "NOT_WHOLE");
      }
      if (amount < 1 || amount > MAX_AIRTEL_AMOUNT) {
        return errorResponse(`Airtel Money takes payments up to Ksh ${MAX_AIRTEL_AMOUNT.toLocaleString()}. Please pay with M-Pesa.`, 409, "AMOUNT_LIMIT");
      }

      // The customer at the order's own branch (the account may have moved to another branch since).
      let customerId: string | null = null;
      const { data: storeCustomer, error: storeError } = await admin.rpc("fn_account_customer", { p_account_id: user.id, p_business_id: order.businessId });
      if (!storeError) {
        customerId = (storeCustomer as string | null) ?? null;
      } else {
        // Database without branch stores yet (before 20261114006).
        const { data: account } = await admin.from("customer_accounts").select("customer_id").eq("id", user.id).maybeSingle();
        customerId = account?.customer_id ?? null;
      }

      // Saved before the prompt goes out, so a quick callback finds it.
      const reference = newReference();
      const { data: row, error: insertError } = await admin.from("airtel_transactions").insert({
        business_id: order.businessId,
        reference,
        phone: `254${msisdn}`,
        amount,
        customer_id: customerId,
        online_order_id: orderId,
        description: `Online order #${order.orderNumber}`,
        requested_by: "Website",
      }).select("id").single();
      if (insertError) throw insertError;

      const push = await pushPayment(keys, msisdn, amount, reference, `Order ${order.orderNumber}`);
      if (!push.accepted) {
        console.error("[customer-checkout] airtel push rejected:", push.detail);
        await admin.from("airtel_transactions")
          .update({ status: "Failed", result_message: `Not sent: ${push.detail ?? "Airtel refused the request"}`, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        return errorResponse("Airtel Money couldn't send the payment prompt. Check the number is on Airtel and try again.", 502, "PUSH_REJECTED");
      }

      await admin.from("online_orders").update({ status: "pending_payment" }).eq("id", orderId).eq("status", "payment_failed");
      return jsonResponse({ success: true });
    }

    if (action === "pay") {
      // Each attempt sends a payment prompt to the number given, so it can't be left unlimited.
      const limited = await enforceRateLimit(`checkout:user:${user.id}`, 6, 600);
      if (limited) return limited;

      // Without this token Safaricom's callback is refused, and a paid order would never settle.
      const callbackToken = Deno.env.get("MPESA_CALLBACK_TOKEN");
      if (!callbackToken) throw new Error("Missing secret MPESA_CALLBACK_TOKEN");

      const darajaPhone = toDarajaPhone(phone);
      if (!darajaPhone) {
        return errorResponse("Please enter a valid M-Pesa number, like 0712 345 678.", 400);
      }

      const { data: order, error } = await admin.rpc("begin_order_payment", {
        p_order_id: orderId,
        p_user_id: user.id,
      });
      if (error) {
        // P0001 is a RAISE EXCEPTION written for customers; anything else stays in the logs.
        if (error.code === "P0001") return errorResponse(error.message, 409);
        throw error;
      }

      const { data: mpesaOn } = await admin.rpc("fn_method_enabled", { p_business_id: order.businessId, p_method: "M-Pesa" });
      if (mpesaOn !== true) {
        return errorResponse("This shop isn't taking M-Pesa online right now.", 409, "METHOD_OFF");
      }

      const callback = Deno.env.get("MPESA_CALLBACK_URL") || `${url}/functions/v1/mpesa-webhook`;
      const push = await stkPush(
        darajaPhone,
        Number(order.total),
        `ORDER${order.orderNumber}`,
        `${callback}?token=${encodeURIComponent(callbackToken)}`,
      );
      if (!push.accepted) {
        return errorResponse("M-Pesa couldn't send the payment prompt. Check the number is on Safaricom and try again in a minute.", 502, "STK_REJECTED");
      }

      const { error: recordError } = await admin.rpc("record_order_checkout", {
        p_order_id: orderId,
        p_checkout_request_id: push.checkoutRequestId,
        p_merchant_request_id: push.merchantRequestId,
        p_phone: darajaPhone,
      });
      if (recordError) throw recordError;

      return jsonResponse({ success: true });
    }

    if (action === "check") {
      // Fallback for a callback that never arrived. A successful query is not settled here,
      // because only the callback carries the receipt, so it flags the order for staff instead.
      const { data: order, error: orderError } = await admin
        .from("online_orders")
        .select("id, status, order_number")
        .eq("id", orderId)
        .eq("account_id", user.id)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order) return errorResponse("Order not found.", 404);

      const { data: pending, error: pendingError } = await admin
        .from("mpesa_transactions")
        .select("checkout_request_id, created_at")
        .eq("online_order_id", orderId)
        .eq("status", "Pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingError) throw pendingError;

      if (pending && Date.now() - new Date(pending.created_at).getTime() > 20_000) {
        const code = await stkQuery(pending.checkout_request_id).catch(() => null);
        if (code === 0) {
          const { error: flagError } = await admin.rpc("flag_order_payment_unconfirmed", {
            p_order_id: orderId,
            p_checkout_request_id: pending.checkout_request_id,
          });
          if (flagError) throw flagError;
        }
        if (code !== null && code !== 0) {
          await admin.rpc("confirm_online_order_payment", {
            p_checkout_request_id: pending.checkout_request_id,
            p_result_code: code,
            p_amount: null,
            p_receipt: null,
            p_raw: { source: "stk_query", ResultCode: code },
          });
        }
      }

      // Airtel prompts for this order: ask Airtel directly, since its callback may be late.
      const { data: airtelPending } = await admin
        .from("airtel_transactions")
        .select("*")
        .eq("online_order_id", orderId)
        .eq("status", "Pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (airtelPending && Date.now() - new Date(airtelPending.created_at).getTime() > 10_000) {
        await refreshPrompt(admin, airtelPending).catch((err) => console.error("[customer-checkout] airtel check:", err));
      }

      const { data: latest, error: latestError } = await admin.from("online_orders").select("status").eq("id", orderId).single();
      if (latestError) throw latestError;
      return jsonResponse({ success: true, status: latest.status });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err: any) {
    console.error("[customer-checkout]", err);
    return errorResponse("The payment service had a problem on our side. Please check your order in a minute before paying again, so you are not charged twice.", 500);
  }
});
