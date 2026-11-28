// supabase/functions/mpesa-payments/index.ts
// Staff side of M-Pesa (Daraja). Actions:
//   status      what is configured, without revealing secrets
//   save_keys   connect this business's own Daraja app      (settings.integrations)
//   remove_keys disconnect it                                (settings.integrations)
//   save_till   set this business's till number              (settings.integrations)
//   register  tell Safaricom where to send till payments   (settings.integrations)
//   request   send a payment prompt to a customer's phone  (payments.mpesa)
//   check     ask Safaricom about a prompt with no answer  (payments.mpesa)
//   test_till sandbox: a test till payment with the amount, name and account typed in, either
//             straight into the app or through Safaricom's simulator (settings.integrations)
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
import { accessToken, c2bSimulate, DarajaError, darajaKeys, darajaLog, isStkAmount, STK_MAX_AMOUNT, stkCallbackUrl, stkPush } from "../customer-checkout/daraja.ts";
import { toMsisdn } from "./phone.ts";
import { pingCallbackUrl, registerTill, settlePrompt, tillCallbackUrls } from "./settle.ts";

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

    /** Saves the till number; a registration only stays if it was for this till (and Daraja environment). */
    const saveTill = async (till: string | null, sameEnvironment = true) => {
      const { data: before } = await admin.from("mpesa_settings").select("till_number, registered_at").eq("business_id", businessId).maybeSingle();
      return admin.from("mpesa_settings").upsert({
        business_id: businessId,
        till_number: till,
        registered_at: sameEnvironment && before?.till_number === till ? before?.registered_at ?? null : null,
        updated_by: await staffName(),
        updated_at: new Date().toISOString(),
      });
    };

    if (action === "status") {
      const denied = await requirePermission(req, businessId, "payments.view", "payments.mpesa", "settings.integrations");
      if (denied) return denied;
      // The only real proof that Safaricom reaches us: the last callback it actually delivered.
      const lastCallback = async (kind: string) => {
        const { data } = await admin.from("daraja_callbacks").select("received_at")
          .eq("business_id", businessId).eq("kind", kind).order("received_at", { ascending: false }).limit(1).maybeSingle();
        return data?.received_at ?? null;
      };
      const [{ data: settings }, keys, lastStkCallbackAt, lastTillPaymentAt] = await Promise.all([
        admin.from("mpesa_settings").select("till_number, registered_at").eq("business_id", businessId).maybeSingle(),
        darajaKeys(admin, businessId),
        lastCallback("stk"),
        lastCallback("c2b_confirmation"),
      ]);
      return jsonResponse({
        success: true,
        lastStkCallbackAt,
        lastTillPaymentAt,
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
      } catch (err) {
        if (err instanceof DarajaError && (err.kind === "timeout" || err.kind === "network")) {
          return errorResponse("Safaricom didn't answer, so the keys couldn't be checked. Try again in a minute.", 504, "DARAJA_UNREACHABLE");
        }
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
      const { error: tillError } = await saveTill(partyB || shortcode, existing?.environment === environment);
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
      const { error } = await saveTill(till || null);
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
        if (result.duplicate) {
          return errorResponse(
            `Safaricom says this till's addresses are already registered (${result.detail}). If till payments aren't arriving, change the URLs for this short code on the Daraja portal or ask Safaricom to.`,
            409, "REGISTER_DUPLICATE",
          );
        }
        return errorResponse(`Safaricom didn't accept the registration: ${result.detail}`, 502, "REGISTER_REJECTED");
      }
      // Safaricom accepting the request doesn't prove it can reach us, so check the address
      // ourselves. Only a real payment proves delivery (status.lastTillPaymentAt).
      const reachable = await pingCallbackUrl(tillCallbackUrls(keys.callbackToken).ping);
      return jsonResponse({ success: true, reachable, detail: result.detail });
    }

    if (action === "test_till") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      const limited = await enforceRateLimit(`mpesa-test:biz:${businessId}`, 60, 3600);
      if (limited) return limited;
      const keys = await darajaKeys(admin, businessId);
      if (!keys) return errorResponse("Connect this business's M-Pesa (Daraja) keys first.", 400, "NOT_CONFIGURED");
      if (keys.environment === "production") {
        return errorResponse("On a live till, pay from a phone instead.", 400, "NOT_SANDBOX");
      }
      const { data: settings } = await admin.from("mpesa_settings").select("till_number").eq("business_id", businessId).maybeSingle();
      const till = settings?.till_number ?? "";

      const amount = Math.round(Number(body.amount ?? 1) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 250000) {
        return errorResponse("Enter an amount between KSh 0.01 and KSh 250,000.00.", 400, "BAD_AMOUNT");
      }
      const billRef = String(body.billRef ?? "").trim().slice(0, 20);
      const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      const phone = String(body.phone ?? "").trim();
      const msisdn = phone ? toMsisdn(phone) : "254708374149";
      if (!msisdn) return errorResponse("Enter a Safaricom number like 0712 345 678, or leave it empty.", 400);

      if (body.via === "safaricom") {
        // Safaricom's sandbox only takes whole shillings and fills in its own payer name.
        if (!Number.isInteger(amount)) return errorResponse("Safaricom's sandbox only takes whole shillings.", 400, "BAD_AMOUNT");
        // Sandbox short codes are shared by every Daraja developer and the last registration
        // wins, so register right before the test payment.
        const reg = await registerTill(admin, keys, till, await staffName());
        if (!reg.ok) return errorResponse(`Safaricom didn't accept the registration: ${reg.detail}`, 502, "REGISTER_REJECTED");
        const sim = await c2bSimulate(keys, till, amount, billRef || "TEST");
        if (!sim.ok) return errorResponse(`Safaricom didn't send the test payment: ${sim.detail}`, 502, "SIMULATE_REJECTED");
        return jsonResponse({ success: true, detail: sim.detail });
      }

      // In the app: post Safaricom's C2B confirmation to our own till-callback address, so the
      // whole receiver runs as for a real payment (token, inbox, record_till_payment, books).
      const nairobi = new Date(Date.now() + 3 * 3600_000).toISOString().replace(/\D/g, "").slice(0, 14);
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const transId = "TST" + Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => alphabet[b % alphabet.length]).join("");
      const [first = "", ...rest] = name.split(" ");
      const payload = {
        TransactionType: keys.transactionType === "CustomerPayBillOnline" ? "Pay Bill" : "Buy Goods",
        TransID: transId,
        TransTime: nairobi,
        TransAmount: amount.toFixed(2),
        BusinessShortCode: till || keys.partyB || keys.shortcode,
        BillRefNumber: billRef,
        InvoiceNumber: "",
        OrgAccountBalance: "",
        ThirdPartyTransID: "",
        MSISDN: msisdn,
        FirstName: first,
        MiddleName: rest.length > 1 ? rest.slice(0, -1).join(" ") : "",
        LastName: rest.length ? rest[rest.length - 1] : "",
        _test: { by: await staffName() },
      };
      const urls = tillCallbackUrls(keys.callbackToken);
      // Safaricom calls validation first when it is switched on for the short code.
      const post = (url: string) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      await post(urls.validation).then((r) => r.body?.cancel()).catch(() => undefined);
      const res = await post(urls.confirmation);
      const reply = await res.json().catch(() => ({} as any));
      if (!res.ok || String(reply?.ResultCode) !== "0") {
        const why = res.status === 403
          ? "the till-callback address refused it (token or MPESA_ALLOWED_IPS)"
          : String(reply?.ResultDesc ?? `HTTP ${res.status}`);
        return errorResponse(`The test callback wasn't accepted: ${why}.`, 502, "CALLBACK_REFUSED");
      }
      const { data: inbox } = await admin.from("daraja_callbacks").select("status, result, error")
        .eq("kind", "c2b_confirmation").eq("dedupe_key", transId).maybeSingle();
      const result = inbox?.result ?? inbox?.status ?? "received";
      darajaLog("c2b_test_callback", { business: businessId, transId, amount, billRef: billRef || null, result }, "log");
      if (inbox?.status === "failed") return errorResponse(`The callback arrived but wasn't recorded: ${inbox.error ?? "unknown error"}.`, 502, "CALLBACK_FAILED");
      return jsonResponse({ success: true, transId, result });
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
      if (!isStkAmount(amount)) {
        return errorResponse(`M-Pesa takes whole shillings from 1 to ${STK_MAX_AMOUNT.toLocaleString()}.`, 400);
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
      const push = await stkPush(keys, msisdn, amount, accountRef, stkCallbackUrl(keys), "Payment");
      if (!push.accepted) {
        if (push.uncertain) return errorResponse(`${push.detail}.`, 504, "STK_UNCERTAIN");
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
      if (error) {
        // The prompt is on the customer's phone; its callback is kept (daraja_callbacks) even
        // without this row, so the payment can still be traced by its CheckoutRequestID.
        darajaLog("stk_row_not_saved", { business: businessId, checkoutRequestId: push.checkoutRequestId, message: error.message }, "error");
        throw error;
      }

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
