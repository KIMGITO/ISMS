// supabase/edge_functions/chat/index.ts
// AI Chat Assistant — fully aware of catalog, inventory, customers, and staff.
// Strict plain text output (NO markdown tables, NO asterisks/hashes). Full Owner authority.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  requirePermission,
  enforceRateLimit,
} from "../shared/cors.ts";
import { loadAISettings, runAI, friendlyAIMessage, ownerAIHint } from "../shared/ai-runner.ts";

// What the assistant can prepare, the permission each needs (null: everyone), and an
// example. Mirrors ASSISTANT_ACTIONS in src/stores/pendingActionStore.ts, which checks
// the permission again before anything runs. Only the ones this person may do are offered.
const ACTIONS: { type: string; permission: string | null; does: string; example: string }[] = [
  { type: "create_checkout", permission: "pos.create_sale", does: "put items in the till cart for a sale", example: '{"type":"create_checkout","title":"Sale","summary":"3 Whole Milk","params":{"items":[{"productName":"Whole Milk","quantity":3}]}}' },
  { type: "create_customer", permission: "customers.create", does: "add a customer", example: '{"type":"create_customer","title":"New customer","summary":"John Doe","params":{"name":"John Doe","phone":"0712345678"}}' },
  { type: "update_customer", permission: "customers.update", does: "change a customer's name, phone or email", example: '{"type":"update_customer","title":"Edit customer","summary":"New phone for Jane","params":{"customerName":"Jane Wanjiku","phone":"0722000000"}}' },
  { type: "settle_debt", permission: "customers.debts", does: "record a payment towards a customer's debt (method Cash or M-Pesa)", example: '{"type":"settle_debt","title":"Debt payment","summary":"Jane pays 1000","params":{"customerName":"Jane Wanjiku","amount":1000,"method":"Cash"}}' },
  { type: "adjust_wallet", permission: "customers.debts", does: "add money to a customer's wallet", example: '{"type":"adjust_wallet","title":"Wallet top-up","summary":"Jane +500","params":{"customerName":"Jane Wanjiku","amount":500}}' },
  { type: "create_product", permission: "products.create", does: "add a product", example: '{"type":"create_product","title":"New product","summary":"Yoghurt 500ml","params":{"name":"Yoghurt 500ml","price":120,"cost":80,"stock":0,"unit":"Cup","category":"Dairy"}}' },
  { type: "update_product", permission: "products.update", does: "change a product's price, cost, minimum stock, category or unit (not stock: use adjust_stock)", example: '{"type":"update_product","title":"Price change","summary":"Milk to 60","params":{"productName":"Whole Milk","price":60}}' },
  { type: "adjust_stock", permission: "inventory.adjust_stock", does: "add stock (type restock) or remove damaged stock (type damage)", example: '{"type":"adjust_stock","title":"Stock adjustment","summary":"Milk -5 damaged","params":{"productName":"Whole Milk","quantity":5,"type":"damage","reason":"Spilt"}}' },
  { type: "create_expense", permission: "expenses.create", does: "record an expense", example: '{"type":"create_expense","title":"Expense","summary":"Fuel 2500","params":{"amount":2500,"category":"Fuel","description":"Delivery motorbike"}}' },
  { type: "create_shift", permission: "staff.schedule", does: "schedule a worker's shift (date YYYY-MM-DD, times HH:MM)", example: '{"type":"create_shift","title":"Shift","summary":"Peter Saturday 8-5","params":{"workerName":"Peter","date":"2026-11-14","startTime":"08:00","endTime":"17:00"}}' },
  { type: "clock_in", permission: null, does: "clock the person talking to you in", example: '{"type":"clock_in","title":"Clock in","summary":"Start my shift","params":{}}' },
  { type: "clock_out", permission: null, does: "clock the person talking to you out", example: '{"type":"clock_out","title":"Clock out","summary":"End my shift","params":{}}' },
];

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const {
      messages,
      businessId,
      employeeName,
      clientProducts,
      clientCustomers,
      clientEmployees,
    } = body;

    if (!businessId) {
      return errorResponse("businessId is required.", 400);
    }

    // Verify tenant membership
    const { userId, role: activeRole, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    const forbidden = await requirePermission(req, businessId, "ai.use");
    if (forbidden) return forbidden;

    // Per person and per business, because every AI call costs the business money.
    const limited =
      (await enforceRateLimit(`ai:user:${userId}`, 20, 60)) ||
      (await enforceRateLimit(`ai:biz:${businessId}`, 500, 86400));
    if (limited) return limited;

    if (!messages || !Array.isArray(messages)) {
      return errorResponse("messages array is required.", 400);
    }

    // Long histories and pasted documents drive up cost without improving answers.
    const boundedMessages = messages.slice(-20).map((m: any) => ({
      ...m,
      content: typeof m?.content === "string" ? m.content.slice(0, 4000) : m?.content,
    }));

    // ── 1. Create service-role Supabase client ──────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 2. Load all context in parallel ─────────────────────────────────
    const results = await Promise.allSettled([
      loadAISettings(businessId),
      supabase.from("businesses").select("name, currency").eq("id", businessId).maybeSingle(),
      supabase.from("products").select("name, price, stock, sku, min_stock_level, category, unit").eq("business_id", businessId).is("deleted_at", null).order("name").limit(200),
      supabase.from("customers").select("name, phone, debt_balance, wallet_balance, loyalty_points").eq("business_id", businessId).is("deleted_at", null).order("name").limit(100),
      supabase.from("business_memberships").select("role, status, user_id, users(full_name, phone)").eq("business_id", businessId).is("deleted_at", null),
      supabase.from("transactions").select("total, payment_method").eq("business_id", businessId).eq("status", "completed").is("deleted_at", null).gte("timestamp", new Date().toISOString().split("T")[0] + "T00:00:00Z"),
      supabase.from("schedules").select("id", { count: "exact", head: true }).eq("business_id", businessId).is("deleted_at", null).eq("date", new Date().toISOString().split("T")[0]),
    ]);

    const settings = results[0].status === "fulfilled" ? results[0].value : null;
    const bizData = results[1].status === "fulfilled" ? (results[1].value as any).data : null;
    const productsResult = results[2].status === "fulfilled" ? (results[2].value as any).data : [];
    const customersResult = results[3].status === "fulfilled" ? (results[3].value as any).data : [];
    const membershipsResult = results[4].status === "fulfilled" ? (results[4].value as any).data : [];
    const todayTxResult = results[5].status === "fulfilled" ? (results[5].value as any).data : [];
    const schedulesResult = results[6].status === "fulfilled" ? (results[6].value as any).count : 0;

    const biz = bizData;

    // Combine DB query results with client payload fallbacks
    const products = (productsResult && productsResult.length > 0) ? productsResult : (clientProducts || []);
    const customers = (customersResult && customersResult.length > 0) ? customersResult : (clientCustomers || []);

    const dbMembers = (membershipsResult || []).map((m: any) => ({
      name: m.users?.full_name || "Staff",
      role: m.role || "Staff",
      phone: m.users?.phone || ""
    }));
    const employees = dbMembers.length > 0 ? dbMembers : (clientEmployees || []);

    const todayTx = todayTxResult || [];
    const todayRevenue = todayTx.reduce(
      (sum: number, t: any) => sum + (Number(t.total) || 0),
      0
    );
    const todayCount = todayTx.length;
    const schedulesCount = (schedulesResult as number) || 0;

    // Low-stock detection
    const lowStockProducts = products.filter(
      (p: any) => (p.stock ?? 0) <= (p.min_stock_level ?? 5) && (p.stock ?? 0) >= 0
    );

    const bizName = biz?.name || "KayKay's";
    const currency = biz?.currency || "KSh";
    const aiName = Deno.env.get("VITE_AI_NAME") || "Kim";
    const userRole = activeRole || "Owner";
    const hasFullAccess = ["owner", "admin", "administrator"].includes(userRole.toLowerCase());

    // Permissions come from the database, never from the request. The assistant only sees
    // what this person may see, because anything in its context can be repeated back to them.
    const { data: grantedRows } = hasFullAccess
      ? { data: [] as any[] }
      : await supabase
          .from("role_permissions")
          .select("permission")
          .eq("business_id", businessId)
          .eq("role", userRole)
          .eq("granted", true);
    const userPerms: string[] = (grantedRows || []).map((r: any) => r.permission);
    const canSeeCustomers = hasFullAccess || userPerms.includes("customers.view");
    const canSeeStaff = hasFullAccess || userPerms.includes("staff.view");
    const userName = employeeName || "Operator";
    const mayDo = (perm: string | null) => perm === null || hasFullAccess || userPerms.includes(perm);
    const allowedActions = ACTIONS.filter((x) => mayDo(x.permission));
    const blockedActions = ACTIONS.filter((x) => !mayDo(x.permission));

    // ── 3. Guard: AI not configured ─────────────────────────────────────
    if (!settings) {
      return jsonResponse({
        success: true,
        reply:
          "The AI assistant is not yet configured for this business. Please ask the Owner to add an API key under Settings > AI Configuration.",
      });
    }

    // ── 4. Build system instruction ──────────────────────────────────────
    const systemInstruction = `You are ${aiName}, the professional enterprise-grade Workspace Assistant for "${bizName}".

OPERATOR:
Name: ${userName}
Role: ${userRole}

WHAT THIS PERSON MAY ASK YOU TO DO:
${allowedActions.length ? allowedActions.map((x) => "- " + x.does).join("\n") : "- Nothing that changes data. Answer questions only."}
${blockedActions.length ? `NOT ALLOWED FOR THIS ROLE (if asked, say politely that their role can't do it and the owner can give them access; do not prepare it):\n${blockedActions.map((x) => "- " + x.does).join("\n")}` : ""}

LIVE BUSINESS DATA (as of ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}):
Business: ${bizName}
Currency: ${currency}
Catalog Count: ${products.length} products
Low-Stock Alert Count: ${lowStockProducts.length} items below min threshold
Today's Sales Revenue: ${currency} ${todayRevenue.toLocaleString()}
Today's Completed Sales: ${todayCount}
Scheduled Shifts Today: ${schedulesCount}

PRODUCT CATALOG (${products.length} Items Total):
${products.length > 0 
  ? products.map((p: any, idx: number) => `${idx + 1}. ${p.name} - Price: ${currency} ${Number(p.price || 0).toFixed(2)} - Stock: ${p.stock ?? 0} ${p.unit || 'units'} (Category: ${p.category || "General"})`).join("\n")
  : "No products currently listed in catalog."
}

CUSTOMER DIRECTORY (${canSeeCustomers ? customers.length : 0} Registered Customers):
${!canSeeCustomers ? "Not available to this operator. Do not guess customer details." : customers.length > 0
  ? customers.map((c: any, idx: number) => `${idx + 1}. ${c.name} - Phone: ${c.phone || "N/A"} - Debt: ${currency} ${Number(c.debt_balance || c.debtBalance || 0).toLocaleString()} - Wallet: ${currency} ${Number(c.wallet_balance || c.walletBalance || 0).toLocaleString()}`).join("\n")
  : "No registered customers listed."
}

TEAM WORKERS (${canSeeStaff ? employees.length : 0} Staff Members):
${!canSeeStaff ? "Not available to this operator. Do not guess staff details." : employees.length > 0
  ? employees.map((e: any, idx: number) => `${idx + 1}. ${e.name} - Role: ${e.role} ${e.phone ? "- Phone: " + e.phone : ""}`).join("\n")
  : "No staff list available."
}

STRICT FORMATTING RULES (CRITICAL MANDATORY):
1. Output MUST be PLAIN HUMAN TEXT ONLY.
2. ABSOLUTELY NO MARKDOWN TABLES (DO NOT use pipe characters | or table divider rows like |---|).
3. ABSOLUTELY NO MARKDOWN SYNTAX: DO NOT use asterisks (** or *), hashes (#), backticks (\`), or underscores (_).
4. DO NOT use WhatsApp style formatting.
5. Present lists using clean numbered text (1., 2., 3.) or plain text bullet lines.
6. Keep responses clean, direct, organized, and helpful.
7. The PENDING_ACTION line is the only exception: write its JSON exactly as shown, underscores included.

TONE:
Be warm, polite and brief, like a helpful colleague at the shop. Answer in the language the person writes in (English or Swahili). Use real numbers from the data above; if something is not in the data, say you don't have it rather than guessing.

HOW TO DO A TASK:
When the person asks you to do one of the allowed tasks above and you know the details, say in one short sentence what you prepared, then add the action on its own line at the very end, exactly in this form:
[PENDING_ACTION: {json}]
The app shows it to the person to confirm before anything changes, so say "Tap Confirm to finish" rather than claiming it is done. Use names exactly as they appear in the data above. If a detail is missing (amount, which customer, quantity), ask for it instead of guessing. One action per task; several tasks may each have their own line.
${allowedActions.length ? "Formats:\n" + allowedActions.map((x) => `[PENDING_ACTION: ${x.example}]`).join("\n") : ""}`;

    // ── 5. Call the AI ───────────────────────────────────────────────────
    const result = await runAI(settings, {
      systemInstruction,
      messages: boundedMessages as any[],
    });

    if (result.success) {
      // Clean any accidental markdown syntax or tables from output text
      let text = result.text || "";
      // Strip markdown tables, bold/italic asterisks, hashes, backticks (preserve underscores in JSON)
      text = text.replace(/\|[^\n]+\|\n?/g, ""); // remove markdown table lines
      text = text.replace(/(\*\*|\*|#|`)/g, ""); // remove markdown formatting symbols (keep underscores for JSON)
      return jsonResponse({ success: true, reply: text });
    } else {
      console.warn("[chat] AI call failed:", result.code, result.error);
      return jsonResponse({
        success: false,
        code: result.code || "busy",
        reply: friendlyAIMessage(result.code),
        // One plain line on what to fix, shown only to Owners and Admins. Names secrets, never values.
        ownerHint: hasFullAccess ? ownerAIHint(result.code) : undefined,
      });
    }
  } catch (err: any) {
    console.error("[chat] Critical error:", err);
    return jsonResponse({ success: false, code: "busy", reply: friendlyAIMessage("busy") });
  }
});