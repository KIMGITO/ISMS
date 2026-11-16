// supabase/functions/bi-analyze/index.ts
// Business advice for the Home screen. The figures come from the books (profit & loss, cash,
// who owes us, what we owe, VAT, stock) read here with the signed-in person's own access,
// plus the Home screen's sales and stock figures. Every number is worked out in code and
// sent back as a scorecard; the AI only explains them and says what to do, so it can't
// invent figures. A role that can't see the books still gets advice from the sales figures.

// deno-lint-ignore-file no-explicit-any
import {
  handleCors,
  jsonResponse,
  errorResponse,
  verifyUserMembership,
  requirePermission,
  enforceRateLimit,
  createUserClient,
} from "../shared/cors.ts";
import { loadAISettings, runAI, friendlyAIMessage } from "../shared/ai-runner.ts";
import { readBooks, n, ksh, day } from "../shared/books.ts";

// What the AI writes. Short, plain and ordered by what matters most to a small business.
const adviceSchema = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One sentence: the single most important thing about this period, with its number." },
    health: { type: "string", enum: ["good", "watch", "act"], description: "good = on track; watch = something needs an eye; act = fix something this week." },
    healthReason: { type: "string", description: "One short sentence saying why." },
    answer: { type: "string", description: "A direct answer to the owner's question, or empty when there is none." },
    whatHappened: { type: "array", items: { type: "string" }, description: "2-4 plain sentences explaining the figures: why profit moved, which costs grew, which products drove sales." },
    cash: { type: "string", description: "2-3 sentences on cash: money in hand now, money customers owe us, bills due to suppliers soon, VAT to set aside." },
    actions: {
      type: "array",
      description: "3-5 things to do this week, most valuable first.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "The action in a few words, starting with a verb." },
          why: { type: "string", description: "One sentence with the figure behind it." },
          screen: { type: "string", enum: ["inventory", "buying", "customers", "finance", "money", "pos", "sales", "workers", "home"], description: "Where in the app to do it." },
          amount: { type: "number", description: "KSh involved (to collect, save or earn); 0 if none." },
        },
        required: ["title", "why", "screen", "amount"],
      },
    },
    watchOuts: { type: "array", items: { type: "string" }, description: "1-3 risks to keep an eye on, each with its figure." },
  },
  required: ["headline", "health", "healthReason", "answer", "whatHappened", "cash", "actions", "watchOuts"],
};

function safeParseJson(raw: string): any {
  if (!raw) return {};
  let cleaned = raw.trim();

  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
  }

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to repair strategies
  }

  // Extract the largest JSON object/array from the text (handles extra prose)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    cleaned = jsonMatch[0].trim();
  }

  // Repair strategy 1: strip trailing commas before } or ]
  const noTrailingCommas = cleaned
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/,\s*$/g, "");

  try {
    return JSON.parse(noTrailingCommas);
  } catch {
    // fall through
  }

  // Repair strategy 2: fix truncated JSON by balancing braces/brackets
  const balanceJson = (input: string): string => {
    let out = input;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < out.length; i++) {
      const ch = out[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        stack.push(ch);
      } else if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
          return input; // mismatched, cannot repair
        }
      }
    }

    // Close any unclosed structures
    while (stack.length > 0) {
      const open = stack.pop();
      out += open === "{" ? "}" : "]";
    }
    return out;
  };

  const balanced = balanceJson(noTrailingCommas);
  try {
    return JSON.parse(balanced);
  } catch {
    // fall through
  }

  // Repair strategy 3: try to salvage by finding the deepest valid JSON substring
  const trySubstrings = (input: string): any => {
    const candidates: string[] = [];
    const stack: string[] = [];
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        if (stack.length === 0) start = i;
        stack.push(ch);
      } else if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
          stack.length = 0;
          start = -1;
          continue;
        }
        if (stack.length === 0 && start >= 0) {
          candidates.push(input.slice(start, i + 1));
          start = -1;
        }
      }
    }

    // Also try progressively shorter prefixes of the input
    for (let len = input.length; len > 0; len -= 10) {
      candidates.push(input.slice(0, len));
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // try next candidate
      }
    }
    return null;
  };

  const salvaged = trySubstrings(cleaned);
  if (salvaged) return salvaged;

  // Final fallback: return a minimal valid report so the frontend can still render
  return null;
}


/** The figures shown on the card, worked out here so they are always right. */
function scorecard(books: any, m: any) {
  const rows: { label: string; value: string; note?: string; tone?: "good" | "bad" }[] = [];
  const change = (c: number | null) => (c === null ? undefined : `${c >= 0 ? "+" : ""}${c}% vs before`);
  if (books) {
    const p = books.profit;
    rows.push({ label: "Sales", value: ksh(p.sales), note: change(p.salesChange) });
    rows.push({ label: "Net profit", value: ksh(p.netProfit), note: p.netMargin === null ? change(p.profitChange) : `${p.netMargin}% of sales`, tone: p.netProfit >= 0 ? "good" : "bad" });
    rows.push({ label: "Gross margin", value: p.grossMargin === null ? "—" : `${p.grossMargin}%`, note: `${ksh(p.grossProfit)} after stock cost` });
    rows.push({ label: "Expenses", value: ksh(p.expenses), note: change(p.expensesChange) });
    rows.push({ label: "Cash & M-Pesa now", value: ksh(books.cash.total) });
    rows.push({ label: "Customers owe us", value: ksh(books.owedToUs.total), note: books.owedToUs.customers ? `${books.owedToUs.customers} customer${books.owedToUs.customers === 1 ? "" : "s"}` : undefined });
    rows.push({ label: "We owe suppliers", value: ksh(books.weOwe.suppliers), note: books.weOwe.dueThisWeek ? `${ksh(books.weOwe.dueThisWeek)} due this week` : undefined, tone: books.weOwe.overdue > 0 ? "bad" : undefined });
    if (books.weOwe.vatToPay > 0) rows.push({ label: "VAT to set aside", value: ksh(books.weOwe.vatToPay) });
  } else {
    rows.push({ label: "Sales", value: ksh(n(m.totalSales)), note: m.revenueTrend == null ? undefined : `${m.revenueTrend >= 0 ? "+" : ""}${m.revenueTrend}% vs before` });
    rows.push({ label: "Estimated profit", value: ksh(n(m.netProfit)), tone: n(m.netProfit) >= 0 ? "good" : "bad" });
    rows.push({ label: "Orders", value: String(n(m.orderCount)), note: `average ${ksh(n(m.aov))}` });
    rows.push({ label: "Spending", value: ksh(n(m.totalExpenses)) });
  }
  if (n(m.lowStockCount) > 0) rows.push({ label: "Low or out of stock", value: String(n(m.lowStockCount)), tone: "bad" });
  return rows;
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON payload", 400);
    }
    const { metrics, customQuestion, businessId, period } = body;

    if (!businessId) return errorResponse("businessId is required.", 400);

    const { userId, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;

    const forbidden = await requirePermission(req, businessId, "ai.insights", "reports.view");
    if (forbidden) return forbidden;

    // Per person and per business, because every AI call costs the business money.
    const limited =
      (await enforceRateLimit(`ai:user:${userId}`, 20, 60)) ||
      (await enforceRateLimit(`ai:biz:${businessId}`, 500, 86400));
    if (limited) return limited;

    if (!metrics) return errorResponse("metrics payload is required.", 400);

    const settings = await loadAISettings(businessId);
    if (!settings) {
      return jsonResponse({
        success: false,
        error: "The assistant is not set up yet. Ask the owner to add it under Settings → AI.",
      }, 503);
    }

    // ── The period and the one before it, as calendar days in Nairobi ──
    const m = metrics || {};
    const end = typeof period?.end === "string" ? period.end.slice(0, 10) : day(new Date());
    const start = typeof period?.start === "string" ? period.start.slice(0, 10) : day(new Date(Date.now() - 6 * 86400000));
    const lengthDays = Math.max(1, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1);
    const prevEnd = day(new Date(Date.parse(`${start}T12:00:00Z`) - 86400000));
    const prevStart = day(new Date(Date.parse(`${prevEnd}T12:00:00Z`) - (lengthDays - 1) * 86400000));

    const db = createUserClient(req);
    const [books, bizRow] = await Promise.all([
      readBooks(db, businessId, start, end, prevStart, prevEnd),
      db.from("businesses").select("name, business_type, is_tax_enabled").eq("id", businessId).maybeSingle().then((r: any) => r.data).catch(() => null),
    ]);
    const bizName = bizRow?.name || "this business";
    const bizType = bizRow?.business_type || "retail shop";

    const facts = {
      period: { from: start, to: end, days: lengthDays, comparedWith: { from: prevStart, to: prevEnd } },
      books: books || "not available to this role; use the sales figures",
      sales: {
        orders: n(m.orderCount),
        averageSale: n(m.aov),
        salesChangePercent: m.revenueTrend ?? null,
        paidBy: { cash: n(m.cashReceived), mpesa: n(m.mpesaCollections), mpesaSharePercent: n(m.mpesaShare) },
        topProducts: m.topProducts || [],
        slowProducts: m.slowProducts || [],
      },
      stock: {
        products: n(m.totalProducts),
        valueAtCost: n(m.inventoryValuation),
        lowOrOut: n(m.lowStockCount),
        toReorder: (m.lowStockProducts || []).slice(0, 10),
      },
      branches: (m.branches || []).length > 1 ? m.branches : undefined,
      customers: { total: n(m.totalCustomers), new: n(m.newCustomersCount), buyingShare: n(m.retentionRate) },
    };

    const promptText = `You advise the owner of ${bizName}, a ${bizType} in Kenya. Read these figures for ${start} to ${end} (compared with ${prevStart} to ${prevEnd}) and write practical advice.

FIGURES (JSON, amounts in KSh; "books" are the double-entry accounts and are the truth for profit, cash and debts):
${JSON.stringify(facts)}

${customQuestion ? `THE OWNER ASKS: "${String(customQuestion).slice(0, 500)}". Answer it first in "answer".` : `No question: leave "answer" empty.`}

Rules:
- Use only the numbers above. Never invent a figure, product, branch or person. Write amounts as "KSh 12,500".
- Plain English a shopkeeper understands: say "profit", "money customers owe", "bills due", not accounting jargon.
- Be specific: name the product, the customer, the supplier or the cost line, with its amount.
- Actions must be things this owner can do this week, most money first: collect a named debt, pay a bill before it is late, reorder a named product, cut a cost that grew, set aside VAT, push a top seller, clear slow stock.
- If sales or profit are zero or there is little data, say so honestly and suggest how to start recording.
Return raw JSON matching the schema, no markdown.`;

    const result = await runAI(settings, {
      systemInstruction:
        "You are a careful small-business advisor in Kenya. You explain the owner's own figures plainly and suggest the few actions that matter most. You never make up numbers. Reply with raw JSON only.",
      messages: [{ role: "user", content: promptText }],
      responseMimeType: "application/json",
      responseSchema: adviceSchema,
    });

    if (!result.success) {
      console.error("[bi-analyze] AI Runner failed:", result.code, result.error);
      return jsonResponse({ success: false, code: result.code || "busy", error: friendlyAIMessage(result.code) }, 503);
    }

    const advice = safeParseJson(result.text);
    if (!advice || typeof advice !== "object" || !advice.headline) {
      console.error("[bi-analyze] AI returned unparseable JSON:", result.text?.slice(0, 500));
      return jsonResponse({ success: false, error: "The advice could not be read. Try again." }, 500);
    }
    const actions = Array.isArray(advice.actions) ? advice.actions.filter((a: any) => a && a.title).slice(0, 5) : [];

    return jsonResponse({
      success: true,
      analysis: {
        headline: String(advice.headline || ""),
        health: ["good", "watch", "act"].includes(advice.health) ? advice.health : "watch",
        healthReason: String(advice.healthReason || ""),
        answer: String(advice.answer || ""),
        whatHappened: Array.isArray(advice.whatHappened) ? advice.whatHappened.map(String).slice(0, 4) : [],
        cash: String(advice.cash || ""),
        actions: actions.map((a: any) => ({ title: String(a.title), why: String(a.why || ""), screen: String(a.screen || "home"), amount: n(a.amount) })),
        watchOuts: Array.isArray(advice.watchOuts) ? advice.watchOuts.map(String).slice(0, 3) : [],
        scorecard: scorecard(books, m),
        fromBooks: !!books,
        period: { start, end },
      },
    });
  } catch (err: any) {
    console.error("[bi-analyze] Critical error:", err);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});
