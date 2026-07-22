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
      activeRole,
      permissions,
      employeeName,
      clientProducts,
      clientCustomers,
      clientEmployees,
    } = body;

    if (!businessId) {
      return errorResponse("businessId is required.", 400);
    }

    // Verify tenant membership
    const { errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    if (!messages || !Array.isArray(messages)) {
      return errorResponse("messages array is required.", 400);
    }

    // ── 1. Create service-role Supabase client ──────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 2. Load all context in parallel ─────────────────────────────────
    const [
      aiSettingsResult,
      bizResult,
      productsResult,
      customersResult,
      membershipsResult,
      todayTxResult,
      schedulesResult,
    ] = await Promise.all([
      // AI provider config
      loadAISettings(businessId),

      // Business info
      supabase
        .from("businesses")
        .select("name, currency")
        .eq("id", businessId)
        .maybeSingle(),

      // Product catalog (active only)
      supabase
        .from("products")
        .select("name, price, stock, sku, min_stock_level, category, unit")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("name"),

      // Customers directory
      supabase
        .from("customers")
        .select("name, phone, debt_balance, wallet_balance, loyalty_points")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("name")
        .limit(100),

      // Business memberships / Workers
      supabase
        .from("business_memberships")
        .select("role, status, user_id, users(full_name, phone)")
        .eq("business_id", businessId)
        .is("deleted_at", null),

      // Today's transaction summary
      supabase
        .from("transactions")
        .select("total, payment_method")
        .eq("business_id", businessId)
        .eq("status", "completed")
        .is("deleted_at", null)
        .gte("timestamp", new Date().toISOString().split("T")[0] + "T00:00:00Z"),

      // Active schedules today
      supabase
        .from("schedules")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .eq("date", new Date().toISOString().split("T")[0]),
    ]);

    const settings = aiSettingsResult;
    const biz = bizResult.data;

    // Combine DB query results with client payload fallbacks
    const dbProducts = productsResult.data || [];
    const products = dbProducts.length > 0 ? dbProducts : (clientProducts || []);

    const dbCustomers = customersResult.data || [];
    const customers = dbCustomers.length > 0 ? dbCustomers : (clientCustomers || []);

    const dbMembers = (membershipsResult.data || []).map((m: any) => ({
      name: m.users?.full_name || "Staff",
      role: m.role || "Staff",
      phone: m.users?.phone || ""
    }));
    const employees = dbMembers.length > 0 ? dbMembers : (clientEmployees || []);

    const todayTx = todayTxResult.data || [];
    const todayRevenue = todayTx.reduce(
      (sum: number, t: any) => sum + (Number(t.total) || 0),
      0
    );
    const todayCount = todayTx.length;
    const schedulesCount = (schedulesResult as any).count || 0;

    // Low-stock detection
    const lowStockProducts = products.filter(
      (p: any) => (p.stock ?? 0) <= (p.min_stock_level ?? 5) && (p.stock ?? 0) >= 0
    );

    const bizName = biz?.name || "KayKay's Milk";
    const currency = biz?.currency || "KSh";
    const aiName = Deno.env.get("VITE_AI_NAME") || "Kim";
    const userRole = activeRole || "Owner";
    const isOwner = userRole.toLowerCase() === "owner";
    const userPerms: string[] = Array.isArray(permissions) ? permissions : [];
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

CUSTOMER DIRECTORY (${customers.length} Registered Customers):
${customers.length > 0
  ? customers.map((c: any, idx: number) => `${idx + 1}. ${c.name} - Phone: ${c.phone || "N/A"} - Debt: ${currency} ${Number(c.debt_balance || c.debtBalance || 0).toLocaleString()} - Wallet: ${currency} ${Number(c.wallet_balance || c.walletBalance || 0).toLocaleString()}`).join("\n")
  : "No registered customers listed."
}

TEAM WORKERS (${employees.length} Staff Members):
${employees.length > 0
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
      messages: messages as any[],
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
        error: result.error || "AI provider request failed",
        reply: `AI Assistant Error: ${result.error || "Please check your AI provider configuration under Settings."}`,
      });
    }
  } catch (err: any) {
    console.error("[chat] Critical error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});