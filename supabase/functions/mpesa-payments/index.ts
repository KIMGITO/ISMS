// supabase/functions/mpesa-payments/index.ts
// Staff side of M-Pesa (Daraja). Actions:
//   status    what is configured, without revealing secrets
//   save_till set this business's till number              (settings.integrations)
//   register  tell Safaricom where to send till payments   (settings.integrations)
//   request   send a payment prompt to a customer's phone  (payments.mpesa)
//   check     ask Safaricom about a prompt with no answer  (payments.mpesa)
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
import { darajaStatus, registerC2bUrls, stkPush, stkQuery } from "../customer-checkout/daraja.ts";
import { toMsisdn } from "./phone.ts";

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
      return jsonResponse({
        success: true,
        ...darajaStatus(),
        tillNumber: settings?.till_number ?? null,
        registeredAt: settings?.registered_at ?? null,
      });
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
      const token = Deno.env.get("MPESA_CALLBACK_TOKEN");
      if (!token) return errorResponse("M-Pesa isn't set up on the server yet.", 400, "NOT_CONFIGURED");
      const base = Deno.env.get("MPESA_C2B_CALLBACK_URL") || `${functionsUrl()}/till-callback`;
      const withToken = (type: string) => `${base}?type=${type}&token=${encodeURIComponent(token)}`;
      const result = await registerC2bUrls(withToken("confirmation"), withToken("validation"));
      if (!result.ok) {
        console.error("[mpesa-payments] C2B registration rejected:", result.detail);
        return errorResponse(`Safaricom didn't accept the registration: ${result.detail}`, 502, "REGISTER_REJECTED");
      }
      await admin.from("mpesa_settings").upsert({
        business_id: businessId,
        registered_at: new Date().toISOString(),
        updated_by: await staffName(),
        updated_at: new Date().toISOString(),
      });
      return jsonResponse({ success: true });
    }

    if (action === "request") {
      const denied = await requirePermission(req, businessId, "payments.mpesa");
      if (denied) return denied;
      const limited =
        (await enforceRateLimit(`mpesa-prompt:user:${userId}`, 60, 3600)) ||
        (await enforceRateLimit(`mpesa-prompt:biz:${businessId}`, 600, 86400));
      if (limited) return limited;

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

      const token = Deno.env.get("MPESA_CALLBACK_TOKEN");
      if (!token) return errorResponse("M-Pesa isn't set up on the server yet.", 400, "NOT_CONFIGURED");
      const callback = Deno.env.get("MPESA_CALLBACK_URL") || `${functionsUrl()}/mpesa-webhook`;

      const push = await stkPush(msisdn, amount, accountRef, `${callback}?token=${encodeURIComponent(token)}`, "Payment");
      if (!push.accepted) {
        return errorResponse("Safaricom didn't send the prompt. Check the number and try again.", 502, "STK_REJECTED");
      }

      const description = String(body.description ?? "").trim().slice(0, 200) || null;
      const { data: row, error } = await admin.from("mpesa_transactions").insert({
        business_id: businessId,
        checkout_request_id: push.checkoutRequestId,
        merchant_request_id: push.merchantRequestId,
        phone: msisdn,
        amount,
        customer_id: customerId,
        account_reference: accountRef,
        description,
        requested_by: await staffName(),
      }).select("id, checkout_request_id").single();
      if (error) throw error;

      return jsonResponse({ success: true, id: row.id, checkoutRequestId: row.checkout_request_id });
    }

    if (action === "check") {
      const denied = await requirePermission(req, businessId, "payments.mpesa");
      if (denied) return denied;
      const { data: row } = await admin
        .from("mpesa_transactions").select("status, checkout_request_id")
        .eq("business_id", businessId).eq("checkout_request_id", body.checkoutRequestId).maybeSingle();
      if (!row) return errorResponse("Payment prompt not found.", 404);
      if (row.status !== "Pending") return jsonResponse({ success: true, status: row.status });

      const code = await stkQuery(row.checkout_request_id);
      if (code === null) return jsonResponse({ success: true, status: "Pending" });
      if (code === 0) {
        // Paid, but only the callback carries the receipt number, so it is recorded there.
        return jsonResponse({ success: true, status: "Pending", paid: true });
      }
      const { error } = await admin.rpc("confirm_store_payment_request", {
        p_checkout_request_id: row.checkout_request_id,
        p_result_code: code,
        p_amount: null,
        p_receipt: null,
        p_raw: { source: "status_query", resultCode: code },
      });
      if (error) throw error;
      return jsonResponse({ success: true, status: "Failed", resultCode: code });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err) {
    console.error("[mpesa-payments]", err);
    return errorResponse("Something went wrong with M-Pesa. Please try again.", 500);
  }
});
