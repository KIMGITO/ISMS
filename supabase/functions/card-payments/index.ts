// supabase/functions/card-payments/index.ts
// Card payments through Paystack. The secret key stays here; the app never sees it.
//
// Staff actions (businessId + a member's session):
//   status         what is set up, without the key                    (payments.view, payments.card, pos.create_sale, settings.integrations)
//   save_settings  check a Paystack key with Paystack, then keep it    (settings.integrations)
//   remove         forget the key and reader                          (settings.integrations)
//   charge         start a card payment: online page/link, or reader  (payments.card, or pos.create_sale for a till sale)
//   check          ask Paystack whether it was paid, and settle it    (payments.card, pos.create_sale)
//   cancel         stop waiting for a payment nobody made             (payments.card, pos.create_sale)
// Website customer actions (a signed-in customer's session, no businessId):
//   order_start    card checkout for their own order; returns Paystack's page
//   order_check    after Paystack sends them back: was it paid?
// The result is applied by settle_card_payment, whichever comes first: this or card-webhook.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  handleCors, jsonResponse, errorResponse, verifyUserMembership, requirePermission, enforceRateLimit,
} from "../shared/cors.ts";
import {
  MAX_CARD_AMOUNT, cardDetails, fromSubunits, keyEnvironment, newReference, paystack, toSubunits, transactionOutcome,
} from "./paystack.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

function webhookUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/card-webhook`;
}

type Admin = ReturnType<typeof adminClient>;

async function secretFor(admin: Admin, businessId: string): Promise<string | null> {
  const { data } = await admin.from("card_payment_secrets").select("secret_key").eq("business_id", businessId).maybeSingle();
  return data?.secret_key ?? null;
}

/** Asks Paystack about one card payment and applies the answer. Returns the row's status. */
async function refresh(admin: Admin, row: any): Promise<{ status: string; result?: string }> {
  if (row.status !== "pending") return { status: row.status };
  const secret = await secretFor(admin, row.business_id);
  if (!secret) return { status: row.status };

  let outcome: "success" | "failed" | "pending" = "pending";
  let amount: number | null = null;
  let providerRef: string | null = row.provider_reference;
  let card = { brand: null as string | null, last4: null as string | null };
  let reason: string | null = null;
  let raw: any = null;

  if (row.channel === "online") {
    const res = await paystack(secret, "GET", `/transaction/verify/${encodeURIComponent(row.reference)}`);
    // Until the customer opens the page Paystack doesn't know the reference: still waiting.
    if (!res.ok || !res.data) return { status: "pending" };
    outcome = transactionOutcome(res.data.status);
    if (outcome === "success" && String(res.data.currency || "KES").toUpperCase() !== row.currency) outcome = "pending";
    amount = fromSubunits(res.data.amount);
    providerRef = String(res.data.id ?? providerRef ?? "");
    card = cardDetails(res.data);
    reason = res.data.gateway_response || null;
    raw = { source: "verify", status: res.data.status, id: res.data.id, channel: res.data.channel, gateway_response: res.data.gateway_response };
  } else {
    if (!row.provider_reference) return { status: "pending" };
    const res = await paystack(secret, "GET", `/paymentrequest/verify/${encodeURIComponent(row.provider_reference)}`);
    if (!res.ok || !res.data) return { status: "pending" };
    if (res.data.paid === true || res.data.status === "success") {
      outcome = "success";
      amount = fromSubunits(res.data.amount);
      card = cardDetails(res.data);
    }
    raw = { source: "paymentrequest_verify", status: res.data.status, paid: res.data.paid };
  }

  if (outcome === "pending") return { status: "pending" };
  const { data: result, error } = await admin.rpc("settle_card_payment", {
    p_reference: row.reference,
    p_success: outcome === "success",
    p_amount_paid: amount,
    p_provider_reference: providerRef,
    p_card_brand: card.brand,
    p_card_last4: card.last4,
    p_failure_reason: reason,
    p_raw: raw,
  });
  if (error) throw error;
  return { status: outcome, result };
}

/** The shape the app reads. */
function publicRow(row: any) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    channel: row.channel,
    purpose: row.purpose,
    amount: Number(row.amount),
    amountPaid: row.amount_paid === null ? null : Number(row.amount_paid),
    authorizationUrl: row.authorization_url,
    cardBrand: row.card_brand,
    cardLast4: row.card_last4,
    failureReason: row.failure_reason,
    paymentId: row.payment_id,
  };
}

async function handleCustomer(req: Request, body: any, admin: Admin): Promise<Response> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return errorResponse("Please sign in again.", 401, "AUTH_REQUIRED");

  const orderId = body.orderId;
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) return errorResponse("Order not found.", 400);

  if (body.action === "order_start") {
    const limited = await enforceRateLimit(`card-checkout:user:${user.id}`, 8, 600);
    if (limited) return limited;

    const { data: order, error } = await admin.rpc("begin_order_payment", { p_order_id: orderId, p_user_id: user.id });
    if (error) {
      if (error.code === "P0001") return errorResponse(error.message, 409);
      throw error;
    }
    const businessId = order.businessId as string;

    const { data: settings } = await admin
      .from("card_payment_settings").select("online_enabled").eq("business_id", businessId).maybeSingle();
    const secret = await secretFor(admin, businessId);
    if (!settings?.online_enabled || !secret) {
      return errorResponse("This shop doesn't take card payments online yet. Please pay with M-Pesa.", 409, "CARDS_OFF");
    }

    const { data: account } = await admin.from("customer_accounts").select("name, phone, email").eq("id", user.id).maybeSingle();
    const email = [account?.email, user.email].find((e) => typeof e === "string" && EMAIL_PATTERN.test(e));
    if (!email) return errorResponse("Add an email address to your account to pay by card.", 400, "EMAIL_REQUIRED");

    // Paystack sends the customer back here. Only to the site that asked, so it can't be used to redirect elsewhere.
    let callbackUrl: string | undefined;
    const origin = req.headers.get("Origin");
    if (typeof body.returnUrl === "string" && origin) {
      try {
        const url = new URL(body.returnUrl);
        if (url.origin === origin && /^https?:$/.test(url.protocol)) callbackUrl = url.toString();
      } catch { /* ignored: Paystack shows its own page instead */ }
    }

    const reference = newReference();
    const amount = Number(order.total);
    const init = await paystack(secret, "POST", "/transaction/initialize", {
      email,
      amount: toSubunits(amount),
      currency: "KES",
      reference,
      channels: ["card"],
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      metadata: { order_number: order.orderNumber, purpose: "online_order" },
    });
    if (!init.ok) {
      console.error("[card-payments] order initialize refused:", init.message);
      return errorResponse("Card payment couldn't start. Please try again shortly.", 502, "PAYSTACK_REFUSED");
    }

    const { error: insertError } = await admin.from("card_payments").insert({
      business_id: businessId,
      purpose: "online_order",
      channel: "online",
      amount,
      reference,
      authorization_url: init.data.authorization_url,
      email,
      payer_name: account?.name ?? null,
      payer_phone: account?.phone ?? null,
      online_order_id: orderId,
      description: `Online order #${order.orderNumber}`,
      requested_by: "Website",
    });
    if (insertError) throw insertError;

    await admin.from("online_orders").update({ status: "pending_payment" }).eq("id", orderId).eq("status", "payment_failed");
    return jsonResponse({ success: true, authorizationUrl: init.data.authorization_url, reference });
  }

  if (body.action === "order_check") {
    const { data: order } = await admin
      .from("online_orders").select("id, status").eq("id", orderId).eq("account_id", user.id).maybeSingle();
    if (!order) return errorResponse("Order not found.", 404);

    let query = admin.from("card_payments").select("*").eq("online_order_id", orderId);
    if (typeof body.reference === "string" && body.reference) query = query.eq("reference", body.reference);
    const { data: row } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (row) await refresh(admin, row);

    const { data: latest } = await admin.from("online_orders").select("status").eq("id", orderId).single();
    return jsonResponse({ success: true, status: latest?.status ?? order.status });
  }

  return errorResponse("Unknown action.", 400);
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const body = await req.json().catch(() => ({}));
    const admin = adminClient();

    if (typeof body.action === "string" && body.action.startsWith("order_")) {
      return await handleCustomer(req, body, admin);
    }

    const { action, businessId } = body;
    if (!businessId) return errorResponse("businessId is required.", 400);
    const { userId, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    const staffName = async (): Promise<string> => {
      const { data } = await admin.from("users").select("name").eq("id", userId).maybeSingle();
      return data?.name || "Staff";
    };

    if (action === "status") {
      const denied = await requirePermission(req, businessId, "payments.view", "payments.card", "pos.create_sale", "settings.integrations");
      if (denied) return denied;
      const { data: settings } = await admin.from("card_payment_settings").select("*").eq("business_id", businessId).maybeSingle();
      const hasKey = !!(await secretFor(admin, businessId));
      return jsonResponse({
        success: true,
        connected: hasKey && !!settings,
        environment: settings?.environment ?? null,
        onlineEnabled: !!settings?.online_enabled && hasKey,
        terminalId: settings?.terminal_id ?? null,
        terminalName: settings?.terminal_name ?? null,
        status: settings?.status ?? null,
        lastError: settings?.last_error ?? null,
        webhookUrl: webhookUrl(),
        updatedAt: settings?.updated_at ?? null,
        updatedBy: settings?.updated_by ?? null,
      });
    }

    if (action === "save_settings") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;

      const typedKey = typeof body.secretKey === "string" ? body.secretKey.trim() : "";
      const secret = typedKey || (await secretFor(admin, businessId));
      if (!secret) return errorResponse("Paste your Paystack secret key.", 400);
      const environment = keyEnvironment(secret);
      if (!environment) return errorResponse("That isn't a Paystack secret key. It starts with sk_test_ or sk_live_.", 400);

      // A wrong key is caught now, not at the till.
      const check = await paystack(secret, "GET", "/transaction?perPage=1");
      if (!check.ok) {
        return errorResponse(check.status === 401 ? "Paystack didn't accept that key." : `Paystack: ${check.message}`, 400, "KEY_REFUSED");
      }

      const terminalId = typeof body.terminalId === "string" ? body.terminalId.trim() : "";
      let terminalName: string | null = null;
      if (terminalId) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(terminalId)) return errorResponse("That card reader ID doesn't look right.", 400);
        const terminal = await paystack(secret, "GET", `/terminal/${encodeURIComponent(terminalId)}`);
        if (!terminal.ok) return errorResponse("Paystack doesn't know that card reader. Check its ID on your Paystack dashboard.", 400, "TERMINAL_UNKNOWN");
        terminalName = terminal.data?.name ?? null;
      }

      const now = new Date().toISOString();
      if (typedKey) {
        const { error } = await admin.from("card_payment_secrets").upsert({ business_id: businessId, secret_key: secret, updated_at: now });
        if (error) throw error;
      }
      const { error } = await admin.from("card_payment_settings").upsert({
        business_id: businessId,
        provider: "paystack",
        environment,
        online_enabled: body.onlineEnabled !== false,
        terminal_id: terminalId || null,
        terminal_name: terminalName,
        status: "connected",
        last_error: null,
        updated_by: await staffName(),
        updated_at: now,
      });
      if (error) throw error;
      return jsonResponse({ success: true, environment });
    }

    if (action === "remove") {
      const denied = await requirePermission(req, businessId, "settings.integrations");
      if (denied) return denied;
      await admin.from("card_payment_secrets").delete().eq("business_id", businessId);
      await admin.from("card_payment_settings").delete().eq("business_id", businessId);
      return jsonResponse({ success: true });
    }

    if (action === "charge") {
      const purpose = body.purpose === "payment" ? "payment" : "sale";
      const denied = purpose === "sale"
        ? await requirePermission(req, businessId, "payments.card", "pos.create_sale")
        : await requirePermission(req, businessId, "payments.card");
      if (denied) return denied;
      const limited = await enforceRateLimit(`card-charge:user:${userId}`, 120, 3600);
      if (limited) return limited;
      const { data: cardOn } = await admin.rpc("fn_method_enabled", { p_business_id: businessId, p_method: "Card" });
      if (cardOn !== true) return errorResponse("Card payments are switched off for this business.", 409, "METHOD_OFF");

      const channel = body.channel === "terminal" ? "terminal" : "online";
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!Number.isFinite(amount) || amount < 1 || amount > MAX_CARD_AMOUNT) {
        return errorResponse(`Card payments are from KSh 1 to KSh ${MAX_CARD_AMOUNT.toLocaleString()}.`, 400);
      }

      const secret = await secretFor(admin, businessId);
      const { data: settings } = await admin.from("card_payment_settings").select("*").eq("business_id", businessId).maybeSingle();
      if (!secret || !settings) return errorResponse("Card payments aren't set up. Add your Paystack key under Money → Cards.", 400, "NOT_CONFIGURED");
      if (channel === "online" && !settings.online_enabled) return errorResponse("Online card payments are switched off.", 400);
      if (channel === "terminal" && !settings.terminal_id) return errorResponse("No card reader is set up.", 400, "NO_TERMINAL");

      let customer: any = null;
      if (body.customerId) {
        const { data } = await admin.from("customers").select("id, name, phone, email")
          .eq("id", body.customerId).eq("business_id", businessId).is("deleted_at", null).maybeSingle();
        if (!data) return errorResponse("Customer not found.", 404);
        customer = data;
      }
      const { data: business } = await admin.from("businesses").select("contact_email, name").eq("id", businessId).maybeSingle();
      // Paystack needs an email for its receipt: the customer's, else the shop's.
      const email = [body.email, customer?.email, business?.contact_email]
        .find((e) => typeof e === "string" && EMAIL_PATTERN.test(e.trim()))?.trim();
      if (!email) {
        return errorResponse("Paystack needs an email for the receipt. Add the customer's email, or the shop's email in business details.", 400, "EMAIL_REQUIRED");
      }

      const reference = newReference();
      const description = String(body.description ?? "").trim().slice(0, 200) || (purpose === "sale" ? "Sale" : "Payment");
      const payerName = String(body.payerName ?? customer?.name ?? "").trim().slice(0, 120) || null;
      const payerPhone = String(body.payerPhone ?? customer?.phone ?? "").trim().slice(0, 30) || null;
      let authorizationUrl: string | null = null;
      let providerReference: string | null = null;

      if (channel === "online") {
        const init = await paystack(secret, "POST", "/transaction/initialize", {
          email,
          amount: toSubunits(amount),
          currency: "KES",
          reference,
          channels: ["card"],
          metadata: { purpose, description, business: business?.name },
        });
        if (!init.ok) {
          console.error("[card-payments] initialize refused:", init.message);
          return errorResponse(`Paystack didn't start the payment: ${init.message}`, 502, "PAYSTACK_REFUSED");
        }
        authorizationUrl = init.data.authorization_url;
      } else {
        // A reader takes a payment request sent to it. Paystack wants a customer for the request.
        const cust = await paystack(secret, "POST", "/customer", {
          email,
          ...(payerName ? { first_name: payerName.split(" ")[0] } : {}),
          ...(payerPhone ? { phone: payerPhone } : {}),
        });
        if (!cust.ok || !cust.data?.customer_code) {
          return errorResponse(`Paystack: ${cust.message}`, 502, "PAYSTACK_REFUSED");
        }
        const request = await paystack(secret, "POST", "/paymentrequest", {
          customer: cust.data.customer_code,
          amount: toSubunits(amount),
          currency: "KES",
          description,
        });
        if (!request.ok || !request.data?.request_code) {
          return errorResponse(`Paystack didn't create the payment: ${request.message}`, 502, "PAYSTACK_REFUSED");
        }
        providerReference = request.data.request_code;
        const pushed = await paystack(secret, "POST", `/terminal/${encodeURIComponent(settings.terminal_id)}/event`, {
          type: "invoice",
          action: "process",
          data: { id: String(request.data.id), reference: String(request.data.offline_reference ?? request.data.id) },
        });
        if (!pushed.ok) {
          await admin.from("card_payment_settings").update({ last_error: pushed.message }).eq("business_id", businessId);
          return errorResponse(`The card reader didn't take the payment: ${pushed.message}. Is it on and connected?`, 502, "TERMINAL_REFUSED");
        }
      }

      const { data: row, error } = await admin.from("card_payments").insert({
        business_id: businessId,
        purpose,
        channel,
        amount,
        reference,
        provider_reference: providerReference,
        authorization_url: authorizationUrl,
        email,
        payer_name: payerName,
        payer_phone: payerPhone,
        description,
        customer_id: customer?.id ?? null,
        requested_by: await staffName(),
      }).select("*").single();
      if (error) throw error;
      return jsonResponse({ success: true, payment: publicRow(row) });
    }

    if (action === "check" || action === "cancel") {
      const denied = await requirePermission(req, businessId, "payments.card", "pos.create_sale");
      if (denied) return denied;
      const { data: row } = await admin.from("card_payments").select("*")
        .eq("business_id", businessId).eq("reference", body.reference).maybeSingle();
      if (!row) return errorResponse("Card payment not found.", 404);

      // Asked first even when cancelling, so a payment that went through is never thrown away.
      await refresh(admin, row);
      if (action === "cancel") {
        await admin.from("card_payments").update({ status: "cancelled", failure_reason: "Cancelled by staff", updated_at: new Date().toISOString() })
          .eq("id", row.id).eq("status", "pending");
      }
      const { data: latest } = await admin.from("card_payments").select("*").eq("id", row.id).single();
      return jsonResponse({ success: true, payment: publicRow(latest) });
    }

    return errorResponse("Unknown action.", 400);
  } catch (err) {
    console.error("[card-payments]", err);
    return errorResponse("Something went wrong with the card payment. Please try again.", 500);
  }
});
