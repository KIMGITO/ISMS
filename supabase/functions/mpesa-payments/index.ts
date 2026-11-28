// supabase/functions/mpesa-payments/index.ts
// Staff side of M-Pesa (Daraja). Actions:
//   status      what is configured, without revealing secrets
//   save_keys   connect this business's own Daraja app      (settings.integrations)
//   remove_keys disconnect it                                (settings.integrations)
//   save_till   set this business's till number              (settings.integrations)
//   register  tell Safaricom where to send till payments   (settings.integrations)
//   request   send a payment prompt to a customer's phone  (payments.mpesa)
//   check     ask Safaricom about a prompt with no answer  (payments.mpesa)
//   test_till sandbox: register the till, then send it a test KSh 1 (settings.integrations)
// The prompt's result arrives at mpesa-webhook and is recorded by the database.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  requirePermission,
  enforceRateLimit,
} from "../shared/cors.ts";
import { accessToken, c2bSimulate, darajaKeys, stkPush } from "../customer-checkout/daraja.ts";
import { toMsisdn } from "./phone.ts";
import { registerTill, settlePrompt } from "./settle.ts";

const MAX_AMOUNT = 250000;


function functionsUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const body = await req.json().catch(() => ({}));
    const { action, businessId } = body;
    if (!businessId) return errorResponse("businessId is required.", 400);

    const { userId, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const staffName = async (): Promise<string> => {
      const { data } = await admin.from("users").select("name").eq("id", userId).maybeSingle();
      return data?.name || "Staff";
    };

    if (action === "status") {
      const denied = await requirePermission(req, businessId, "payments.view", "payments.mpesa", "settings.integrations");
      if (denied) return denied;
      const { data: settings } = await admin
        .from("mpesa_settings").select("till_number, registered_at").eq("business_id", businessId).maybeSingle();
      const keys = await darajaKeys(admin, businessId);
      return jsonResponse({
        success: true,
        configured: !!keys,
        environment: keys?.environment ?? "sandbox",
        transactionType: keys?.transactionType ?? "CustomerBuyGoodsOnline",
        shortcode: keys?.shortcode ?? null,
        partyB: keys?.partyB ?? null,
        tillNumber: settings?.till_number ?? null,
        registeredAt: settings?.registered_at ?? null,
      });
    }

    if (action === "save_keys") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      const limited = await enforceRateLimit(`mpesa-keys:biz:${businessId}`, 20, 3600);
      if (limited) return limited;
      const existing = await darajaKeys(admin, businessId);
      const text = (v: unknown) => String(v ?? "").trim();
      const digits = (v: unknown) => String(v ?? "").replace(/\s/g, "");
      const environment = body.environment === "production" ? "production" : "sandbox";
      const transactionType = body.transactionType === "CustomerPayBillOnline" ? "CustomerPayBillOnline" : "CustomerBuyGoodsOnline";
      // Empty secret boxes keep the saved ones, so the owner can change one thing at a time.
      const consumerKey = text(body.consumerKey) || existing?.consumerKey || "";
      const consumerSecret = text(body.consumerSecret) || existing?.consumerSecret || "";
      const passkey = text(body.passkey) || existing?.passkey || "";
      const shortcode = digits(body.shortcode);
      const partyB = transactionType === "CustomerBuyGoodsOnline" ? digits(body.partyB) || null : null;
      if (!consumerKey || !consumerSecret || !passkey) return errorResponse("Enter the consumer key, consumer secret and passkey.", 400);
      if (!/^\d{5,10}$/.test(shortcode)) return errorResponse("The short code is 5 to 10 digits.", 400);
      if (partyB && !/^\d{5,10}$/.test(partyB)) return errorResponse("The till number is 5 to 10 digits.", 400);
      try {
        await accessToken({ environment, consumerKey, consumerSecret });
      } catch {
        return errorResponse(`Safaricom refused these keys (${environment}). Check them on the Daraja portal.`, 400, "KEYS_REJECTED");
      }
      const { error } = await admin.from("mpesa_payment_secrets").upsert({
        business_id: businessId,
        environment,
        consumer_key: consumerKey,
        consumer_secret: consumerSecret,
        passkey,
        shortcode,
        party_b: partyB,
        transaction_type: transactionType,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      // The till payments arrive for is the Buy Goods till (or the paybill).
      const till = partyB || shortcode;
      const { error: tillError } = await admin.from("mpesa_settings").upsert({
        business_id: businessId,
        till_number: till,
        updated_by: await staffName(),
        updated_at: new Date().toISOString(),
      });
      if (tillError?.code === "23505") return errorResponse("Another business already uses this till number.", 409);
      if (tillError) throw tillError;
      return jsonResponse({ success: true });
    }

    if (action === "remove_keys") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      const { error } = await admin.from("mpesa_payment_secrets").delete().eq("business_id", businessId);
      if (error) throw error;
      await admin.from("mpesa_settings").update({ registered_at: null, updated_at: new Date().toISOString() }).eq("business_id", businessId);
      return jsonResponse({ success: true });
    }

    if (action === "save_till") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      const till = String(body.tillNumber ?? "").replace(/\s/g, "");
      if (till && !/^\d{5,10}$/.test(till)) return errorResponse("A till number is 5 to 10 digits.", 400);
      const { error } = await admin.from("mpesa_settings").upsert({
        business_id: businessId,
        till_number: till || null,
        updated_by: await staffName(),
        updated_at: new Date().toISOString(),
      });
      if (error) {
        if (error.code === "23505") return errorResponse("Another business already uses this till number.", 409);
        throw error;
      }
      return jsonResponse({ success: true });
    }

    if (action === "register") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      const keys = await darajaKeys(admin, businessId);
      if (!keys) return errorResponse("Connect this business's M-Pesa (Daraja) keys first.", 400, "NOT_CONFIGURED");
      const { data: settings } = await admin.from("mpesa_settings").select("till_number").eq("business_id", businessId).maybeSingle();
      const result = await registerTill(admin, keys, settings?.till_number ?? "", await staffName());
      if (!result.ok) {
        console.error("[mpesa-payments] C2B registration rejected:", result.detail);
        return errorResponse(`Safaricom didn't accept the registration: ${result.detail}`, 502, "REGISTER_REJECTED");
      }
      return jsonResponse({ success: true });
    }

    if (action === "test_till") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      const limited = await enforceRateLimit(`mpesa-test:biz:${businessId}`, 20, 3600);
      if (limited) return limited;
      const keys = await darajaKeys(admin, businessId);
      if (!keys) return errorResponse("Connect this business's M-Pesa (Daraja) keys first.", 400, "NOT_CONFIGURED");
      if (keys.environment === "production") {
        return errorResponse("On a live till, pay KSh 1 from a phone instead.", 400, "NOT_SANDBOX");
      }
      const { data: settings } = await admin.from("mpesa_settings").select("till_number").eq("business_id", businessId).maybeSingle();
      const till = settings?.till_number ?? "";
      // Sandbox short codes are shared by every Daraja developer and the last registration
      // wins, so register right before the test payment.
      const reg = await registerTill(admin, keys, till, await staffName());
      if (!reg.ok) return errorResponse(`Safaricom didn't accept the registration: ${reg.detail}`, 502, "REGISTER_REJECTED");
      const sim = await c2bSimulate(keys, till, 1, "TEST");
      if (!sim.ok) return errorResponse(`Safaricom didn't send the test payment: ${sim.detail}`, 502, "SIMULATE_REJECTED");
      return jsonResponse({ success: true, detail: sim.detail });
    }

    if (action === "request") {
      const denied = await requirePermission(req, businessId, "payments.mpesa");
      if (denied) return denied;
      const limited =
        (await enforceRateLimit(`mpesa-prompt:user:${userId}`, 60, 3600)) ||
        (await enforceRateLimit(`mpesa-prompt:biz:${businessId}`, 600, 86400));
      if (limited) return limited;

      const { data: mpesaOn } = await admin.rpc("fn_method_enabled", { p_business_id: businessId, p_method: "M-Pesa" });
      if (mpesaOn !== true) return errorResponse("M-Pesa is switched off for this business.", 409, "METHOD_OFF");

      const msisdn = toMsisdn(body.phone);
      if (!msisdn) return errorResponse("Enter a Safaricom number like 0712 345 678.", 400);
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
        return errorResponse(`M-Pesa takes whole shillings from 1 to ${MAX_AMOUNT.toLocaleString()}.`, 400);
      }

      let accountRef = "WALKIN";
      let customerId: string | null = null;
      if (body.customerId) {
        const { data: customer } = await admin
          .from("customers").select("id, account_number")
          .eq("id", body.customerId).eq("business_id", businessId).is("deleted_at", null).maybeSingle();
        if (!customer) return errorResponse("Customer not found.", 404);
        customerId = customer.id;
        accountRef = customer.account_number;
      }

      // A prompt for a sale is linked to it before it goes out, so its payment proves that
      // sale's money instead of being recorded a second time (20261212007).
      let saleId: string | null = null;
      if (body.saleId) {
        const { data: saleRef, error: saleErr } = await admin.rpc("check_sale_prompt", {
          p_business_id: businessId, p_sale_id: body.saleId, p_amount: amount,
        });
        if (saleErr) return errorResponse(saleErr.message || "This sale can't take a prompt.", 409, "SALE_NOT_PROMPTABLE");
        saleId = String(body.saleId);
        if (accountRef === "WALKIN" && saleRef) accountRef = String(saleRef).slice(0, 12);
      }

      const keys = await darajaKeys(admin, businessId);
      if (!keys) return errorResponse("This business hasn't connected M-Pesa yet.", 400, "NOT_CONFIGURED");
      const callback = Deno.env.get("MPESA_CALLBACK_URL") || `${functionsUrl()}/mpesa-webhook`;

      const push = await stkPush(keys, msisdn, amount, accountRef, `${callback}?token=${encodeURIComponent(keys.callbackToken)}`, "Payment");
      if (!push.accepted) {
        return errorResponse(`Safaricom didn't send the prompt: ${push.detail ?? "no reason given"}.`, 502, "STK_REJECTED");
      }

      const description = String(body.description ?? "").trim().slice(0, 200) || null;
      const { data: row, error } = await admin.from("mpesa_transactions").insert({
        business_id: businessId,
        checkout_request_id: push.checkoutRequestId,
        merchant_request_id: push.merchantRequestId,
        phone: msisdn,
        amount,
        customer_id: customerId,
        transaction_id: saleId,
        account_reference: accountRef,
        description,
        requested_by: await staffName(),
        // Only this person is told when the money arrives (20261214002).
        requested_user_id: userId,
      }).select("id, checkout_request_id").single();
      if (error) throw error;

      return jsonResponse({ success: true, id: row.id, checkoutRequestId: row.checkout_request_id });
    }

    if (action === "check") {
      const denied = await requirePermission(req, businessId, "payments.mpesa");
      if (denied) return denied;
      const { data: row } = await admin
        .from("mpesa_transactions").select("status, checkout_request_id, created_at, amount, online_order_id")
        .eq("business_id", businessId).eq("checkout_request_id", body.checkoutRequestId).maybeSingle();
      if (!row) return errorResponse("Payment prompt not found.", 404);
      if (row.status !== "Pending") return jsonResponse({ success: true, status: row.status });

      const keys = await darajaKeys(admin, businessId);
      if (!keys) return jsonResponse({ success: true, status: "Pending" });
      // Safaricom's callback decides the result. Once it is overdue, the status query settles
      // the prompt (payment-sweep does the same every 2 minutes when nobody is watching).
      const result = await settlePrompt(admin, keys, row);
      if (result.status === "Completed") {
        const { data: done } = await admin.from("mpesa_transactions").select("status").eq("checkout_request_id", row.checkout_request_id).maybeSingle();
        return jsonResponse({ success: true, status: done?.status ?? "Completed", resultCode: result.resultCode });
      }
      return jsonResponse({ success: true, ...result });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err) {
    console.error("[mpesa-payments]", err);
    return errorResponse("Something went wrong with M-Pesa. Please try again.", 500);
  }
});
