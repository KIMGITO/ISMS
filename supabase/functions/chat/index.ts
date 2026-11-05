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
  enforceRateLimit,
} from "../shared/cors.ts";
import { loadAISettings, runAI } from "../shared/ai-runner.ts";

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

    const bizName = biz?.name || "ISMS ";
    const currency = biz?.currency || "KSh";
    const aiName = Deno.env.get("VITE_AI_NAME") || "Kim";
    const userRole = activeRole || "Owner";
    const isOwner = userRole.toLowerCase() === "owner";
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

OPERATOR AUTHORITY:
Name: ${userName}
Active Role: ${userRole}
Is Business Owner: ${isOwner ? "YES (Full Unrestricted Access)" : "NO"}
Assigned Permissions: ${isOwner ? "ALL_PERMISSIONS" : JSON.stringify(userPerms)}

ROLE AUTHORITY RULES (CRITICAL):
1. If the operator's role is "Owner" or Is Business Owner is YES, they have 100% FULL, UNRESTRICTED AUTHORITY for ALL operations (POS checkouts, sales, stock adjustments, customer management, staff inviting, purchases, expenses, etc.). NEVER refuse an Owner request or claim missing permissions!
2. For non-Owners, verify assigned permissions or standard role access (e.g. pos.create_sale, pos.checkout, products.create, inventory.adjust_stock).

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

AI PENDING ACTION (DRAFT) TRIGGERS:
When the user requests an action AND you have parameters AND the operator is authorized (always authorized if Owner), append a single JSON block at the very end of your response text:

1. POS Sale Draft:
[PENDING_ACTION: {"type": "create_checkout", "title": "POS Sale Draft", "summary": "3L Whole Milk", "requiredPermission": "pos.create_sale", "params": {"paymentMethod": "Cash", "items": [{"productName": "Whole Milk", "quantity": 3}]}}]

2. Stock Adjustment Draft:
[PENDING_ACTION: {"type": "adjust_stock", "title": "Stock Adjustment", "summary": "Whole Milk (-5L)", "requiredPermission": "inventory.adjust_stock", "params": {"productName": "Whole Milk", "quantity": 5, "type": "damage"}}]

3. Customer/Employee/Supplier Management:
[PENDING_ACTION: {"type": "create_customer", "title": "New Customer", "summary": "John Doe", "requiredPermission": "customers.create", "params": {"name": "John Doe", "phone": "0712345678"}}]
[PENDING_ACTION: {"type": "create_expense", "title": "Expense Record", "summary": "Fuel (2500)", "requiredPermission": "expenses.create", "params": {"amount": 2500, "category": "Fuel"}}]
[PENDING_ACTION: {"type": "settle_debt", "title": "Debt Settlement", "summary": "Pay 1000", "requiredPermission": "customers.debts", "params": {"customerId": "cust_1", "amount": 1000}}]`;

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
      console.warn("[chat] AI call failed:", result.error);
      return jsonResponse({
        success: false,
        error: "The assistant is unavailable right now.",
        reply: "The assistant is unavailable right now. Please try again shortly. If this continues, ask the Owner to check the AI settings.",
      });
    }
  } catch (err: any) {
    console.error("[chat] Critical error:", err);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});