// supabase/functions/ussd/index.ts
// Dial-code ordering for customers without a smartphone or internet, through Africa's Talking.
// The gateway can't send a JWT, so requests are authorised by a secret token in the callback URL.
// Its phone number comes from the mobile network, so it identifies the caller.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { enforceRateLimit } from "../shared/cors.ts";
import { stkPush } from "../customer-checkout/daraja.ts";
import { respond, UssdContext } from "./menu.ts";

const reply = (text: string) => new Response(text, { headers: { "Content-Type": "text/plain" } });

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "waiting for payment",
  payment_failed: "payment failed",
  paid: "paid",
  preparing: "being prepared",
  out_for_delivery: "on the way",
  ready_for_pickup: "ready for pickup",
  completed: "completed",
  cancelled: "cancelled",
};

async function findAccount(admin: any, msisdn: string) {
  const { data, error } = await admin.rpc("find_account_by_auth_phone", { p_phone: msisdn });
  if (error) throw error;
  return data as string | null;
}

async function registerCustomer(admin: any, slug: string, msisdn: string, name: string) {
  // Someone who started phone sign-in on the website has a login but no account yet.
  const { data: existingId, error: findError } = await admin.rpc("find_auth_user_by_phone", { p_phone: msisdn });
  if (findError) throw findError;
  let userId: string | null = existingId;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      phone: msisdn,
      phone_confirm: true,
      user_metadata: { name, account_type: "customer" },
    });
    if (error) throw error;
    userId = data.user.id;
  }
  const { error: accountError } = await admin.rpc("fn_create_customer_account", {
    p_uid: userId,
    p_slug: slug,
    p_name: name,
    p_phone: msisdn,
  });
  if (accountError) throw accountError;
}

async function placeOrder(admin: any, accountId: string, msisdn: string, action: any) {
  const { data: orderId, error } = await admin.rpc("fn_build_online_order", {
    p_account_id: accountId,
    p_items: [{ productId: action.productId, quantity: action.quantity }],
    p_fulfilment: action.fulfilment,
    p_address: action.address,
    p_notes: "Ordered by dial code",
    p_schedule_id: null,
    p_zone_id: action.zoneId,
  });
  if (error) throw error;

  const { data: order, error: beginError } = await admin.rpc("begin_order_payment", {
    p_order_id: orderId,
    p_user_id: accountId,
  });
  if (beginError) throw beginError;

  const callback = Deno.env.get("MPESA_CALLBACK_URL") ||
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/mpesa-webhook`;
  const token = Deno.env.get("MPESA_CALLBACK_TOKEN");
  if (!token) throw new Error("Missing secret MPESA_CALLBACK_TOKEN");

  const push = await stkPush(
    msisdn,
    Number(order.total),
    `ORDER${order.orderNumber}`,
    `${callback}?token=${encodeURIComponent(token)}`,
  );
  if (!push.accepted) throw new Error("STK push rejected");

  const { error: recordError } = await admin.rpc("record_order_checkout", {
    p_order_id: orderId,
    p_checkout_request_id: push.checkoutRequestId,
    p_merchant_request_id: push.merchantRequestId,
    p_phone: msisdn,
  });
  if (recordError) throw recordError;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("USSD_CALLBACK_TOKEN");
  const token = new URL(req.url).searchParams.get("token");
  if (req.method !== "POST" || !expected || token !== expected) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const form = await req.formData();
    const msisdn = String(form.get("phoneNumber") ?? "").replace(/\D/g, "");
    const text = String(form.get("text") ?? "");
    const slug = Deno.env.get("USSD_SHOP_SLUG");
    if (!msisdn || !slug) throw new Error("Missing phone number or USSD_SHOP_SLUG");

    if (await enforceRateLimit(`ussd:${msisdn}`, 40, 600)) {
      return reply("END Too many requests. Please try again in a few minutes.");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: shop, error: shopError } = await admin.rpc("get_public_storefront", { p_slug: slug });
    if (shopError) throw shopError;
    if (!shop) return reply("END This shop isn't available right now.");

    // The storefront only says in or out of stock; the menu needs the amount to refuse too much.
    const { data: stockRows, error: stockError } = await admin
      .from("products")
      .select("id, stock")
      .in("id", (shop.products ?? []).map((p: any) => p.id));
    if (stockError) throw stockError;
    const stockById = new Map((stockRows ?? []).map((p: any) => [p.id, Number(p.stock)]));

    const accountId = await findAccount(admin, msisdn);
    const ctx: UssdContext = {
      shopName: shop.business.name,
      registered: !!accountId,
      products: (shop.products ?? []).map((p: any) => ({ ...p, stock: stockById.get(p.id) ?? 0 })),
      zones: shop.deliveryZones ?? [],
      deliveryEnabled: !!shop.settings.deliveryEnabled,
      deliveryFee: Number(shop.settings.deliveryFee),
    };

    if (accountId && text === "2") {
      const { data, error } = await admin
        .from("online_orders")
        .select("order_number, status, total")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      ctx.orders = (data ?? [])
        .map((o: any) => `#${o.order_number} Ksh ${o.total}: ${STATUS_LABELS[o.status] ?? o.status}`)
        .join("\n");
    }

    if (accountId && text === "3") {
      const { data, error } = await admin
        .from("customer_accounts")
        .select("customers(loyalty_points, tier, wallet_balance, debt_balance)")
        .eq("id", accountId)
        .maybeSingle();
      if (error) throw error;
      const c: any = data?.customers;
      if (c) {
        ctx.summary = `${c.tier}: ${c.loyalty_points} points\nWallet Ksh ${c.wallet_balance}\nOwed Ksh ${c.debt_balance}`;
      }
    }

    const result = respond(text, ctx);

    if (result.action?.type === "register") {
      await registerCustomer(admin, slug, msisdn, result.action.name);
    } else if (result.action?.type === "order" && accountId) {
      // A gateway retry of the last step must not place a second order and prompt.
      const sessionId = String(form.get("sessionId") ?? "");
      const { data: firstTry, error: limitError } = await admin.rpc("check_rate_limit", {
        p_key: `ussd-order:${sessionId}`,
        p_limit: 1,
        p_window_seconds: 600,
      });
      if (limitError) throw limitError;
      if (firstTry) await placeOrder(admin, accountId, msisdn, result.action);
    }

    return reply(result.text);
  } catch (err) {
    console.error("[ussd]", err);
    return reply("END Sorry, something went wrong. Please try again shortly.");
  }
});
