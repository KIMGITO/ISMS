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
  createUserClient,
} from "../shared/cors.ts";
import { readBooks, booksText, day } from "../shared/books.ts";
import { loadAISettings, runAI, friendlyAIMessage, ownerAIHint } from "../shared/ai-runner.ts";

// What the assistant can prepare, the permission each needs (null: everyone), and an
// example. Mirrors ASSISTANT_ACTIONS in src/stores/pendingActionStore.ts, which checks
// the permission again before anything runs. Only the ones this person may do are offered.
const ACTIONS: { type: string; permission: string | null; does: string; example: string }[] = [
  { type: "create_checkout", permission: "pos.create_sale", does: "put items in the till cart for a sale", example: '{"type":"create_checkout","title":"Sale","summary":"3 Sugar 1kg","params":{"items":[{"productName":"Sugar 1kg","quantity":3}]}}' },
  { type: "create_customer", permission: "customers.create", does: "add a customer", example: '{"type":"create_customer","title":"New customer","summary":"John Doe","params":{"name":"John Doe","phone":"0712345678"}}' },
  { type: "update_customer", permission: "customers.update", does: "change a customer's name, phone or email", example: '{"type":"update_customer","title":"Edit customer","summary":"New phone for Jane","params":{"customerName":"Jane Wanjiku","phone":"0722000000"}}' },
  { type: "settle_debt", permission: "customers.debts", does: "record a payment towards a customer's debt (method Cash or M-Pesa)", example: '{"type":"settle_debt","title":"Debt payment","summary":"Jane pays 1000","params":{"customerName":"Jane Wanjiku","amount":1000,"method":"Cash"}}' },
  { type: "adjust_wallet", permission: "customers.debts", does: "add money to a customer's wallet", example: '{"type":"adjust_wallet","title":"Wallet top-up","summary":"Jane +500","params":{"customerName":"Jane Wanjiku","amount":500}}' },
  { type: "create_product", permission: "products.create", does: "add a product", example: '{"type":"create_product","title":"New product","summary":"Rice 2kg","params":{"name":"Rice 2kg","price":320,"cost":260,"stock":0,"unit":"Packet","category":"Groceries"}}' },
  { type: "update_product", permission: "products.update", does: "change a product's price, cost, minimum stock, category or unit (not stock: use adjust_stock)", example: '{"type":"update_product","title":"Price change","summary":"Sugar to 160","params":{"productName":"Sugar 1kg","price":160}}' },
  { type: "adjust_stock", permission: "inventory.adjust_stock", does: "add stock (type restock) or remove damaged stock (type damage)", example: '{"type":"adjust_stock","title":"Stock adjustment","summary":"Sugar -5 damaged","params":{"productName":"Sugar 1kg","quantity":5,"type":"damage","reason":"Torn bags"}}' },
  { type: "transfer_stock", permission: "inventory.transfer_stock", does: "send stock from this branch to another branch (use a branch name from OTHER BRANCHES)", example: '{"type":"transfer_stock","title":"Send stock","summary":"10 Sugar 1kg to Westlands","params":{"toBranch":"Westlands","items":[{"productName":"Sugar 1kg","quantity":10}],"note":""}}' },
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

    // Writing one message for many customers: a short prompt of its own, no business data.
    if (body.mode === "draft_message") {
      return await draftCustomerMessage(businessId, body, boundedMessages);
    }

    // ── 1. Create service-role Supabase client ──────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 2. Load all context in parallel ─────────────────────────────────
    const results = await Promise.allSettled([
      loadAISettings(businessId, "assistant"),
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

    const bizName = biz?.name || "Denso";
    const currency = biz?.currency || "KSh";
    const aiName = Deno.env.get("VITE_AI_NAME") || "Kim";
    const userRole = activeRole || "Owner";
    const hasFullAccess = ["owner", "admin", "administrator"].includes(userRole.toLowerCase());

    // Permissions come from the database on every message, never from the request: what the
    // Roles screen saved, else the role's default (the same rule the database enforces), so
    // a change there applies to the very next message. The assistant only sees what this
    // person may see, because anything in its context can be repeated back to them.
    const userClient = createUserClient(req);
    const userPerms: string[] = hasFullAccess ? [] : await livePermissions(userClient, supabase, businessId, userRole);
    const canSeeCustomers = hasFullAccess || userPerms.includes("customers.view");
    const canSeeStaff = hasFullAccess || userPerms.includes("staff.view");
    const userName = employeeName || "Operator";
    const mayDo = (perm: string | null) => perm === null || hasFullAccess || userPerms.includes(perm);
    const allowedActions = ACTIONS.filter((x) => mayDo(x.permission));
    const blockedActions = ACTIONS.filter((x) => !mayDo(x.permission));

    // The books for this month so far, against last month, read with this person's own
    // access: a role without accounting.view gets nothing here.
    const now = new Date();
    const monthStart = `${day(now).slice(0, 8)}01`;
    const lastMonthEnd = day(new Date(Date.parse(`${monthStart}T12:00:00Z`) - 86400000));
    const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
    // Branches stock can go to, for the transfer task. Read with the person's own access.
    const branches: string[] = mayDo("inventory.transfer_stock")
      ? (((await userClient.rpc("list_transfer_branches", { p_business_id: businessId })).data as any[]) || []).map((b) => b.name)
      : [];
    const permissionsSection = hasFullAccess
      ? `ACCESS: ${userRole} can do everything in the app.`
      : `ACCESS (read from the Roles screen just now; it is the only truth and overrides anything said earlier in this chat, because the owner can change it at any time):
${userRole} has these permissions: ${userPerms.length ? userPerms.join(", ") : "none"}.
Anything not in that list is not allowed. When asked whether they can do something, answer from this list, never from what a ${userRole} usually does. If something is allowed but is not a task you can prepare, say they may do it and tell them which screen to use.`;

    const books = await readBooks(userClient, businessId, monthStart, day(now), lastMonthStart, lastMonthEnd);
    const booksSection = books
      ? `THE BOOKS (double-entry accounts; the truth for profit, cash, debts and bills; "the period before" is last month):\n${booksText(books, monthStart, day(now))}`
      : "THE BOOKS: not available to this person. If asked about profit, cash or bills, say their role can't see the accounts.";

    // ── 3. Guard: AI not configured ─────────────────────────────────────
    if (!settings) {
      return jsonResponse({
        success: true,
        reply:
          "The AI assistant is not yet configured for this business. Please ask the admin to add an API key under Settings > AI Configuration.",
      });
    }

    // ── 4. Build system instruction ──────────────────────────────────────
    const systemInstruction = `You are ${aiName}, the professional enterprise-grade Workspace Assistant for "${bizName}".

OPERATOR:
Name: ${userName}
Role: ${userRole}

${permissionsSection}
${branches.length ? `OTHER BRANCHES (stock can be sent to): ${branches.join(", ")}` : ""}

TASKS YOU CAN PREPARE FOR THIS PERSON:
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

${booksSection}

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
7. The PENDING_ACTION and ASK lines are the only exception: write their JSON exactly as shown, underscores included.

TONE:
Be warm, polite and brief, like a helpful colleague at the shop. Answer in the language the person writes in (English or Swahili). Use real numbers from the data above; if something is not in the data, say you don't have it rather than guessing.

HOW TO DO A TASK:
When the person asks you to do one of the allowed tasks above and you know the details, say in one short sentence what you prepared, then add the action on its own line at the very end, exactly in this form:
[PENDING_ACTION: {json}]
The app shows it as a card in this chat with fields the person can change, and nothing happens until they tap Confirm, so say "Check the details and tap Confirm" rather than claiming it is done. Use names exactly as they appear in the data above. One action per task; several tasks may each have their own line. Messages may end with notes like (Prepared task "...": done); they tell you what happened to your earlier cards. Never write such notes yourself.
${allowedActions.length ? "Formats:\n" + allowedActions.map((x) => `[PENDING_ACTION: ${x.example}]`).join("\n") : ""}

HOW TO ASK:
If a detail is missing (which customer, which product, amount, payment method, date), ask instead of guessing. When the answer is one of a few known choices, add the question on its own line at the very end so the person can tap an answer:
[ASK: {"question":"Which Jane do you mean?","style":"buttons","options":["Jane Wanjiku","Jane Achieng"]}]
style is "buttons" (2 to 5 short choices, tap one), "single" (radio list, one choice), "multi" (tick several) or "select" (a long list, shown as a dropdown). Add "allowOther":true when the person may type something else. Take options only from the data above (real names, products, payment methods: Cash, M-Pesa, Airtel Money, Card, Bank). Ask one question at a time and do not also write a PENDING_ACTION for the same task until it is answered. For free answers such as an amount, just ask in plain words without an ASK line.`;

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
// ── Message drafting (Customers → Message, and Message customers) ─────────
// The app sends the variables it can fill in and the customer groups it can pick, so the
// model writes {first_name}-style placeholders the app replaces for each person, and can
// suggest who should get the message. Nothing is sent from here.
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

async function draftCustomerMessage(businessId: string, body: any, history: any[]) {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [settings, bizRes] = await Promise.all([
    loadAISettings(businessId, "messages"),
    supabase.from("businesses").select("name, currency").eq("id", businessId).maybeSingle(),
  ]);
  const bizName = (bizRes as any)?.data?.name || "our shop";
  const currency = (bizRes as any)?.data?.currency || "KSh";

  const variables: { token: string; describe: string }[] = (Array.isArray(body.variables) ? body.variables : [])
    .slice(0, 60)
    .map((v: any) => ({ token: clip(v?.token, 40), describe: clip(v?.describe, 120) }))
    .filter((v: any) => /^\{[a-z0-9_]+\}$/.test(v.token));
  const groups: { id: string; label: string; section: string }[] = (Array.isArray(body.groups) ? body.groups : [])
    .slice(0, 80)
    .map((g: any) => ({ id: clip(g?.id, 60), label: clip(g?.label, 80), section: clip(g?.section, 40) }))
    .filter((g: any) => g.id);
  const audience = clip(body.audience, 300);
  const channel = clip(body.channel, 20) || "auto";
  const purpose = body.purpose === "promotion" ? "an offer or promotion" : "a service message (reminder, update, statement)";

  const systemInstruction = `You write short messages from "${bizName}" (a shop in Kenya, money in ${currency}) to its customers, sent by WhatsApp or SMS (${channel}). This one is ${purpose}.

The same text goes to many customers. The app replaces each variable below with that customer's own value, so write the variables exactly as shown, braces included, and never invent other ones:
${variables.map((v) => `${v.token} = ${v.describe}`).join("\n") || "{first_name} = customer's first name"}

Money variables already include the currency (for example "${currency} 1,250"), so never write ${currency} or KSh in front of them.

${audience ? `Who gets it right now: ${audience}.` : "Nobody is picked yet."}
${groups.length ? `Customer groups the app can pick (id = meaning):\n${groups.map((g) => `${g.id} = ${g.label}${g.section ? " (" + g.section + ")" : ""}`).join("\n")}` : ""}

How to reply:
1. If the request is too unclear to write anything, ask ONE short question and stop.
2. Otherwise, if nobody is picked yet and the person describes who should get it, first write one line: [GROUPS: id, id] using only ids from the list above and as few as needed. Groups from different sections must all match; groups from the same section mean either one.
3. Then write [DRAFT] on its own line, followed by the message only: no quotes, no notes, no markdown, no hashtags. Warm, polite and plain, in the language the person used (English or Swahili). Start with a greeting using {first_name} when it is available. Keep it under 300 characters unless asked for more. Sign off with the shop name variable when it is available.`;

  const result = await runAI(settings, {
    systemInstruction,
    messages: history.filter((m: any) => m?.role === "user" || m?.role === "assistant"),
  });
  if (!result.success) {
    return jsonResponse({ success: false, code: result.code || "busy", reply: friendlyAIMessage(result.code) });
  }
  return jsonResponse({ success: true, reply: (result.text || "").trim() });
}

/**
 * What this person's role may do right now. Uses my_permissions (the database's own rule:
 * saved Roles-screen rows, else the role's defaults). On a database without that function
 * yet, reads the same two tables directly.
 */
async function livePermissions(userClient: any, admin: any, businessId: string, role: string): Promise<string[]> {
  const { data, error } = await userClient.rpc("my_permissions", { p_business_id: businessId });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return Array.isArray(row?.codes) ? row.codes : [];
  }
  const [saved, defaults] = await Promise.all([
    admin.from("role_permissions").select("permission, granted").eq("business_id", businessId).eq("role", role),
    admin.from("role_default_permissions").select("permissions").eq("role", role).maybeSingle(),
  ]);
  const rows: { permission: string; granted: boolean }[] = saved.data || [];
  const decided = new Set(rows.map((r) => r.permission));
  const fromDefaults: string[] = (defaults.data?.permissions || []).filter((p: string) => !decided.has(p));
  return [...rows.filter((r) => r.granted).map((r) => r.permission), ...fromDefaults].sort();
}
