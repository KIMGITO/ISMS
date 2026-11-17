// supabase/functions/area-advisor/index.ts
// The AI helper on two screens:
//   area "rewards": Promotions & Points (points, promotion codes, referrals)
//   area "money":   Payments & Expenses (money in by method, voids, expenses, petty cash)
// Every figure is read here with the signed-in person's own access (RLS), added up in code
// and sent back as a scorecard. The AI only explains those figures, answers the question
// and lists what to do, so it can't invent numbers. Short follow-up chats are supported:
// the app sends the last few questions and answers back as `history`.

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

type Area = "rewards" | "money" | "finance";
type Row = { label: string; value: string; note?: string; tone?: "good" | "bad" };

const AREA_PERMISSIONS: Record<Area, string[]> = {
  rewards: ["promotions.view", "promotions.manage", "referrals.view", "referrals.manage", "loyalty.view", "loyalty.configure", "customers.view"],
  finance: ["finance.view", "accounting.view"],
  money: ["payments.view", "payments.cash", "payments.mpesa", "payments.airtel", "payments.verify", "payments.configure", "expenses.view", "expenses.create"],
};

const SCREENS: Record<Area, string[]> = {
  rewards: ["promotions", "customers", "pos", "online-store", "finance"],
  money: ["money", "petty-cash", "prompt", "finance", "customers", "buying"],
  finance: ["finance", "money", "buying", "customers", "inventory", "sales"],
};

const schema = (area: Area) => ({
  type: "object",
  properties: {
    headline: { type: "string", description: "One short sentence: the most important thing, with its number." },
    health: { type: "string", enum: ["good", "watch", "act"] },
    healthReason: { type: "string", description: "One short sentence saying why." },
    answer: { type: "string", description: "A direct, short answer to the question (max 4 sentences), or empty when there is none." },
    findings: { type: "array", items: { type: "string" }, description: "2-4 short sentences explaining the figures." },
    actions: {
      type: "array",
      description: "2-4 things to do this week, most valuable first.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A few words, starting with a verb." },
          why: { type: "string", description: "One short sentence with the figure behind it." },
          screen: { type: "string", enum: SCREENS[area] },
          amount: { type: "number", description: "KSh involved; 0 if none." },
        },
        required: ["title", "why", "screen", "amount"],
      },
    },
    watchOuts: { type: "array", items: { type: "string" }, description: "0-3 short risks, each with its figure." },
  },
  required: ["headline", "health", "healthReason", "answer", "findings", "actions", "watchOuts"],
});

function parseJson(raw: string): any {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  for (const t of [s, s.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      return JSON.parse(t);
    } catch { /* next */ }
  }
  return null;
}

const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const sumBy = <T>(rows: T[], key: (r: T) => string, val: (r: T) => number) => {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r) || "Other"] = (out[key(r) || "Other"] || 0) + val(r);
  return Object.entries(out).map(([name, amount]) => ({ name, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount);
};
const dayStart = (d: string) => `${d}T00:00:00+03:00`;
const nextDay = (d: string) => day(new Date(Date.parse(`${d}T12:00:00Z`) + 86400000));
async function safe<T>(p: PromiseLike<{ data: T; error: any }>): Promise<T | null> {
  try {
    const { data, error } = await p;
    return error ? null : data;
  } catch {
    return null;
  }
}

/** Sales in a period from the sales table: how many, how much, how paid, discounts. */
async function salesIn(db: any, businessId: string, from: string, to: string) {
  const rows = (await safe<any[]>(
    db.from("transactions").select("final_total, discount, payment_method")
      .eq("business_id", businessId).is("deleted_at", null)
      .gte("created_at", dayStart(from)).lt("created_at", dayStart(nextDay(to))).limit(20000),
  )) || [];
  return {
    count: rows.length,
    total: Math.round(rows.reduce((s, r) => s + n(r.final_total), 0)),
    discounts: Math.round(rows.reduce((s, r) => s + n(r.discount), 0)),
    byMethod: sumBy(rows, (r) => (r.payment_method === "Credit_Debt" ? "Credit" : r.payment_method), (r) => n(r.final_total)),
  };
}

// ─────────────────────────────────────────────── rewards
async function rewardFacts(db: any, businessId: string, start: string, end: string, prevStart: string, prevEnd: string) {
  const rpc = (name: string, args: any) => safe<any>(db.rpc(name, args));
  const [promo, promoBefore, referral, promotions, settings, earned, used, customers, sales] = await Promise.all([
    rpc("promotion_dashboard", { p_business_id: businessId, p_from: start, p_to: end }),
    rpc("promotion_dashboard", { p_business_id: businessId, p_from: prevStart, p_to: prevEnd }),
    rpc("referral_dashboard", { p_business_id: businessId, p_from: start, p_to: end }),
    rpc("promotions_list", { p_business_id: businessId }),
    safe<any>(db.from("loyalty_settings").select("*").eq("business_id", businessId).maybeSingle()),
    safe<any[]>(db.from("loyalty_points_earned").select("points, source").eq("business_id", businessId)
      .gte("created_at", dayStart(start)).lt("created_at", dayStart(nextDay(end))).limit(20000)),
    safe<any[]>(db.from("loyalty_redemptions").select("points, value, kind").eq("business_id", businessId).is("refunded_at", null)
      .gte("created_at", dayStart(start)).lt("created_at", dayStart(nextDay(end))).limit(5000)),
    safe<any[]>(db.from("customers").select("name, loyalty_points, tier").eq("business_id", businessId).is("deleted_at", null)
      .gt("loyalty_points", 0).order("loyalty_points", { ascending: false }).limit(5000)),
    salesIn(db, businessId, start, end),
  ]);

  const value = { Bronze: n(settings?.value_bronze) || 0.02, Silver: n(settings?.value_silver) || 0.01, Gold: n(settings?.value_gold) || 0.005 } as Record<string, number>;
  const holders = customers || [];
  const owedPoints = holders.reduce((s, c) => s + n(c.loyalty_points), 0);
  const owedValue = holders.reduce((s, c) => s + n(c.loyalty_points) * (value[c.tier] ?? value.Bronze), 0);
  const tiers = sumBy(holders, (c) => c.tier, () => 1).map((t) => ({ tier: t.name, customers: t.amount }));
  const earnedRows = earned || [];
  const usedRows = used || [];
  const now = Date.now();
  const livePromos = (promotions || []).filter((p: any) => !p.archivedAt).map((p: any) => ({
    code: p.code, name: p.name, type: p.promoType, value: n(p.value), active: !!p.active,
    ends: p.endsAt ? String(p.endsAt).slice(0, 10) : null,
    endsWithin7Days: !!p.endsAt && Date.parse(p.endsAt) - now < 7 * 86400000 && Date.parse(p.endsAt) > now,
    uses: n(p.uses), maxUses: p.maxUses == null ? null : n(p.maxUses), discountGiven: Math.round(n(p.discountGiven)),
    till: !!p.usePos, website: !!p.useOnline,
  })).slice(0, 25);

  const facts = {
    sales: { count: sales.count, total: sales.total, allDiscounts: sales.discounts },
    points: settings === null && earned === null ? "not visible to this role" : {
      on: settings ? settings.points_enabled !== false : true,
      rules: "Paid sales earn 2 points per KSh 1; debt repaid earns 1 per KSh 1. Points are never cash; they only reduce a price or pay off debt. Silver from 20,000 points, Gold from 60,000.",
      pointsPerKsh1ByTier: { Bronze: Math.round(1 / value.Bronze), Silver: Math.round(1 / value.Silver), Gold: Math.round(1 / value.Gold) },
      minimumToUse: n(settings?.min_redeem_points) || 100,
      earnedThisPeriod: { fromSales: earnedRows.filter((r) => r.source === "sale").reduce((s, r) => s + n(r.points), 0), fromDebtRepaid: earnedRows.filter((r) => r.source === "debt_payment").reduce((s, r) => s + n(r.points), 0), other: earnedRows.filter((r) => !["sale", "debt_payment"].includes(r.source)).reduce((s, r) => s + n(r.points), 0) },
      usedThisPeriod: { points: usedRows.reduce((s, r) => s + n(r.points), 0), worthKsh: Math.round(usedRows.reduce((s, r) => s + n(r.value), 0)), byWhere: sumBy(usedRows, (r) => r.kind || "till", (r) => n(r.value)) },
      unusedNow: { points: owedPoints, worthKsh: Math.round(owedValue), customersHolding: holders.length, byTier: tiers },
      topHolders: holders.slice(0, 5).map((c) => ({ name: c.name, points: n(c.loyalty_points), tier: c.tier, worthKsh: Math.round(n(c.loyalty_points) * (value[c.tier] ?? value.Bronze)) })),
    },
    promotions: promo ? {
      counts: promo.counts,
      totals: promo.totals,
      before: promoBefore ? { uses: n(promoBefore.totals?.redemptions), discount: n(promoBefore.totals?.discount), netSales: n(promoBefore.totals?.netSales) } : null,
      refunds: promo.refunds,
      averageSaleWithoutCode: promo.withoutPromotion?.avgNet,
      byCode: (promo.byPromotion || []).slice(0, 10),
      topProducts: (promo.byProduct || []).slice(0, 8),
      codes: livePromos,
    } : "not visible to this role",
    referrals: referral ? {
      programme: referral.campaign ? { name: referral.campaign.name, active: referral.campaign.active ?? true } : "no referral programme set up",
      counts: referral.counts,
      costs: referral.costs,
      salesFromReferredCustomers: n(referral.referredSales),
      topReferrers: (referral.topReferrers || []).slice(0, 5).map((r: any) => ({ name: r.name, referrals: r.referrals, rewarded: r.rewarded, flagged: r.flagged, cost: r.cost })),
    } : "not visible to this role",
  };

  const rows: Row[] = [];
  if (promo) {
    const t = promo.totals || {};
    rows.push({ label: "Code uses", value: String(n(t.redemptions)), note: promoBefore ? change(pct(n(t.redemptions), n(promoBefore.totals?.redemptions))) : undefined });
    rows.push({ label: "Discount given", value: ksh(n(t.discount)), note: n(t.netSales) ? `on ${ksh(n(t.netSales))} sales` : undefined });
  }
  if (referral) {
    rows.push({ label: "Referrals", value: String(n(referral.counts?.total)), note: n(referral.counts?.flagged) ? `${n(referral.counts.flagged)} flagged` : undefined, tone: n(referral.counts?.flagged) ? "bad" : undefined });
    rows.push({ label: "Referral cost", value: ksh(n(referral.costs?.total)), note: n(referral.referredSales) ? `${ksh(n(referral.referredSales))} sales` : undefined });
  }
  if (typeof facts.points === "object") {
    rows.push({ label: "Points earned", value: (facts.points.earnedThisPeriod.fromSales + facts.points.earnedThisPeriod.fromDebtRepaid + facts.points.earnedThisPeriod.other).toLocaleString("en-KE") });
    rows.push({ label: "Points used", value: ksh(facts.points.usedThisPeriod.worthKsh) });
    rows.push({ label: "Unused points", value: ksh(facts.points.unusedNow.worthKsh), note: `${holders.length} customers` });
  }
  return { facts, rows };
}

// ─────────────────────────────────────────────── money
async function moneyFacts(db: any, businessId: string, start: string, end: string, prevStart: string, prevEnd: string) {
  const pay = (from: string, to: string) => safe<any[]>(
    db.from("payments").select("amount, method, status, payment_type, debt_applied, wallet_applied, void_reason, sender_name, date")
      .eq("business_id", businessId).gte("date", dayStart(from)).lt("date", dayStart(nextDay(to))).limit(20000),
  );
  const exp = (from: string, to: string) => safe<any[]>(
    db.from("expenses").select("amount, category, payment_method, source, description, date, staff_name")
      .eq("business_id", businessId).is("deleted_at", null).gte("date", dayStart(from)).lt("date", dayStart(nextDay(to))).limit(20000),
  );
  const [payNow, payBefore, expNow, expBefore, balances, sales, salesBefore, books] = await Promise.all([
    pay(start, end), pay(prevStart, prevEnd), exp(start, end), exp(prevStart, prevEnd),
    safe<any[]>(db.from("money_assets").select("method, balance").eq("business_id", businessId)),
    salesIn(db, businessId, start, end),
    salesIn(db, businessId, prevStart, prevEnd),
    readBooks(db, businessId, start, end, prevStart, prevEnd),
  ]);

  const days = Math.max(1, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1);
  const ok = (rows: any[] | null) => (rows || []).filter((p) => p.status === "Success");
  const paid = ok(payNow);
  const paidBefore = ok(payBefore);
  const paidTotal = paid.reduce((s, p) => s + n(p.amount), 0);
  const paidBeforeTotal = paidBefore.reduce((s, p) => s + n(p.amount), 0);
  const voided = (payNow || []).filter((p) => p.status === "Voided");
  const expRows = expNow || [];
  const expTotal = expRows.reduce((s, e) => s + n(e.amount), 0);
  const expBeforeTotal = (expBefore || []).reduce((s, e) => s + n(e.amount), 0);
  const byCatNow = sumBy(expRows, (e) => e.category, (e) => n(e.amount));
  const byCatBefore = sumBy(expBefore || [], (e) => e.category, (e) => n(e.amount));
  const moneyIn = sales.total - (sales.byMethod.find((m) => m.name === "Credit")?.amount || 0) + paidTotal;

  const facts = {
    days,
    sales: { count: sales.count, total: sales.total, byMethod: sales.byMethod, before: { total: salesBefore.total, byMethod: salesBefore.byMethod }, discounts: sales.discounts },
    payments: payNow === null ? "not visible to this role" : {
      note: "Payments are money received outside a sale: debt repaid, wallet top-ups, walk-in receipts.",
      received: Math.round(paidTotal), count: paid.length, before: Math.round(paidBeforeTotal), change: pct(paidTotal, paidBeforeTotal),
      byMethod: sumBy(paid, (p) => p.method, (p) => n(p.amount)),
      towardsDebt: Math.round(paid.reduce((s, p) => s + n(p.debt_applied), 0)),
      intoWallets: Math.round(paid.reduce((s, p) => s + n(p.wallet_applied), 0)),
      pending: (payNow || []).filter((p) => p.status === "Pending").length,
      failed: (payNow || []).filter((p) => p.status === "Failed").length,
      voided: { count: voided.length, amount: Math.round(voided.reduce((s, p) => s + n(p.amount), 0)), reasons: voided.slice(0, 5).map((p) => ({ amount: n(p.amount), method: p.method, reason: p.void_reason || "no reason" })) },
    },
    expenses: expNow === null ? "not visible to this role" : {
      total: Math.round(expTotal), before: Math.round(expBeforeTotal), change: pct(expTotal, expBeforeTotal), perDay: Math.round(expTotal / days),
      count: expRows.length,
      pettyCash: Math.round(expRows.filter((e) => e.source === "petty_cash").reduce((s, e) => s + n(e.amount), 0)),
      byCategory: byCatNow.slice(0, 10).map((c) => ({ ...c, before: byCatBefore.find((b) => b.name === c.name)?.amount || 0 })),
      byMethod: sumBy(expRows, (e) => e.payment_method, (e) => n(e.amount)),
      largest: [...expRows].sort((a, b) => n(b.amount) - n(a.amount)).slice(0, 5).map((e) => ({ amount: n(e.amount), category: e.category, note: (e.description || "").slice(0, 60), by: e.staff_name, day: String(e.date).slice(0, 10) })),
      withoutNote: expRows.filter((e) => !(e.description || "").trim()).length,
      shareOfSales: sales.total ? Math.round((expTotal / sales.total) * 100) : null,
    },
    balancesNow: (balances || []).map((b) => ({ method: b.method, balance: Math.round(n(b.balance)) })),
    books: books ? { profit: books.profit, cash: books.cash, owedToUs: books.owedToUs, weOwe: books.weOwe } : "not available to this role",
  };

  const rows: Row[] = [];
  rows.push({ label: "Money in", value: ksh(moneyIn), note: "sales paid + payments" });
  if (payNow !== null) rows.push({ label: "Payments", value: ksh(paidTotal), note: change(pct(paidTotal, paidBeforeTotal)) });
  if (expNow !== null) {
    rows.push({ label: "Expenses", value: ksh(expTotal), note: change(pct(expTotal, expBeforeTotal)), tone: expTotal > expBeforeTotal && expBeforeTotal > 0 ? "bad" : undefined });
    if (byCatNow[0]) rows.push({ label: "Biggest cost", value: ksh(byCatNow[0].amount), note: byCatNow[0].name });
  }
  if (voided.length) rows.push({ label: "Voided", value: ksh(voided.reduce((s, p) => s + n(p.amount), 0)), note: `${voided.length} payment${voided.length === 1 ? "" : "s"}`, tone: "bad" });
  if (books) rows.push({ label: "Net profit", value: ksh(books.profit.netProfit), tone: books.profit.netProfit >= 0 ? "good" : "bad" });
  return { facts, rows };
}

// ─────────────────────────────────────────────── finance & accounting
async function financeFacts(db: any, businessId: string, start: string, end: string, prevStart: string, prevEnd: string) {
  const books = await readBooks(db, businessId, start, end, prevStart, prevEnd);
  if (!books) return { facts: { books: "not available to this role" }, rows: [] as Row[] };
  const p = books.profit;
  const rows: Row[] = [
    { label: "Sales", value: ksh(p.sales), note: change(p.salesChange) },
    { label: "Net profit", value: ksh(p.netProfit), note: p.netMargin === null ? change(p.profitChange) : `${p.netMargin}% of sales`, tone: p.netProfit >= 0 ? "good" : "bad" },
    { label: "Expenses", value: ksh(p.expenses), note: change(p.expensesChange) },
    { label: "Cash & M-Pesa", value: ksh(books.cash.total) },
    { label: "Customers owe", value: ksh(books.owedToUs.total), note: books.owedToUs.olderThan30Days ? `${ksh(books.owedToUs.olderThan30Days)} over 30 days` : undefined },
    { label: "We owe suppliers", value: ksh(books.weOwe.suppliers), note: books.weOwe.overdue ? `${ksh(books.weOwe.overdue)} overdue` : undefined, tone: books.weOwe.overdue > 0 ? "bad" : undefined },
  ];
  if (books.weOwe.vatToPay > 0) rows.push({ label: "VAT to pay", value: ksh(books.weOwe.vatToPay) });
  return { facts: { books }, rows };
}

function change(c: number | null) {
  return c === null ? undefined : `${c >= 0 ? "+" : ""}${c}% vs before`;
}

const GUIDE: Record<Area, string> = {
  finance: `You advise on the business books: profit and loss, cash, who owes us, what we owe, VAT, stock value and owner drawings.
- Explain why profit moved (sales, cost of goods, rising expenses) and whether cash covers bills due soon.
- Flag old debts, overdue supplier bills, VAT to set aside, stock count differences and posting errors (postingErrors above 0 means entries need fixing).
- Suggest concrete steps: which debt to collect, which bill to pay first, which cost to cut, what to set aside.`,
  rewards: `You advise on the loyalty points, promotion codes and referral programme.
- Judge each code by what it brought in against what it cost: netPerShilling (sales per KSh of discount), discount share, and how the average sale with a code compares with the average without one.
- Unused points are a promise to customers (worth KSh at today's tier values), not cash owed. Points never become money.
- For referrals compare total cost with sales from referred customers; mention flagged or pending reviews.
- Suggest concrete changes: end or tighten a weak code, extend a strong one, set a minimum spend or a cap, remind top point holders to use points, or launch a referral programme if none exists.`,
  money: `You advise on payments received, expenses and petty cash.
- Explain how money came in (cash, M-Pesa, Airtel, card, bank, credit) and how that moved against the period before.
- Point out costs that grew, the largest single expenses, expenses without a note, voided payments and their reasons, and pending or failed payments.
- Suggest concrete changes: cut or cap a growing category, move cash sales to M-Pesa for a clean record, chase debts, set a daily petty cash limit, add notes or receipts to expenses, look into repeated voids by one method.`,
};

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON payload", 400);
    }
    const { businessId, question, period } = body || {};
    const area: Area = body?.area === "money" ? "money" : body?.area === "finance" ? "finance" : "rewards";
    if (!businessId) return errorResponse("businessId is required.", 400);

    const { userId, errorResponse: authError } = await verifyUserMembership(req, businessId);
    if (authError) return authError;
    const noAi = await requirePermission(req, businessId, "ai.use", "ai.insights");
    if (noAi) return noAi;
    const noArea = await requirePermission(req, businessId, ...AREA_PERMISSIONS[area]);
    if (noArea) return noArea;

    const limited =
      (await enforceRateLimit(`ai:user:${userId}`, 20, 60)) ||
      (await enforceRateLimit(`ai:biz:${businessId}`, 500, 86400));
    if (limited) return limited;

    const settings = await loadAISettings(businessId);
    if (!settings) {
      return jsonResponse({ success: false, error: "The assistant is not set up yet. Ask the owner to add it under Settings → AI." }, 503);
    }

    const end = typeof period?.end === "string" ? period.end.slice(0, 10) : day(new Date());
    const start = typeof period?.start === "string" ? period.start.slice(0, 10) : day(new Date(Date.now() - 29 * 86400000));
    const lengthDays = Math.max(1, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1);
    const prevEnd = day(new Date(Date.parse(`${start}T12:00:00Z`) - 86400000));
    const prevStart = day(new Date(Date.parse(`${prevEnd}T12:00:00Z`) - (lengthDays - 1) * 86400000));

    const db = createUserClient(req);
    const [{ facts, rows }, bizRow] = await Promise.all([
      area === "finance"
        ? financeFacts(db, businessId, start, end, prevStart, prevEnd)
        : area === "money"
        ? moneyFacts(db, businessId, start, end, prevStart, prevEnd)
        : rewardFacts(db, businessId, start, end, prevStart, prevEnd),
      safe<any>(db.from("businesses").select("name, business_type").eq("id", businessId).maybeSingle()),
    ]);

    const q = typeof question === "string" ? question.trim().slice(0, 500) : "";
    const history = (Array.isArray(body?.history) ? body.history : [])
      .slice(-3)
      .filter((h: any) => h && typeof h.q === "string" && typeof h.a === "string")
      .map((h: any) => `Q: ${h.q.slice(0, 300)}\nA: ${h.a.slice(0, 600)}`)
      .join("\n");

    const prompt = `${GUIDE[area]}

Business: ${bizRow?.name || "this business"}, a ${bizRow?.business_type || "shop"} in Kenya.
Period ${start} to ${end} (${lengthDays} days), compared with ${prevStart} to ${prevEnd}.

FIGURES (JSON, amounts in KSh):
${JSON.stringify(facts)}
${history ? `\nEARLIER IN THIS CHAT:\n${history}\n` : ""}
${q ? `THE OWNER ASKS: "${q}". Answer it first in "answer", plainly and briefly.` : `No question: leave "answer" empty.`}

Rules:
- Use only the figures above. Never invent a number, code, customer or category. Write amounts as "KSh 12,500".
- If something is "not visible to this role", don't guess it; say it can't be seen.
- Plain, short English a shopkeeper understands. No jargon, no long paragraphs.
- If there is little or no data, say so honestly and say how to start.
Return raw JSON matching the schema, no markdown.`;

    const result = await runAI(settings, {
      systemInstruction: "You are a careful small-business advisor in Kenya. You explain the owner's own figures plainly and briefly, and suggest the few actions that matter most. You never make up numbers. Reply with raw JSON only.",
      messages: [{ role: "user", content: prompt }],
      responseMimeType: "application/json",
      responseSchema: schema(area),
    });
    if (!result.success) {
      console.error("[area-advisor] AI failed:", result.code, result.error);
      return jsonResponse({ success: false, code: result.code || "busy", error: friendlyAIMessage(result.code), scorecard: rows }, 503);
    }
    const a = parseJson(result.text);
    if (!a || typeof a !== "object" || !a.headline) {
      console.error("[area-advisor] unreadable reply:", result.text?.slice(0, 400));
      return jsonResponse({ success: false, error: "The advice could not be read. Try again.", scorecard: rows }, 500);
    }
    const strs = (v: any, max: number) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, max) : []);
    return jsonResponse({
      success: true,
      advice: {
        headline: String(a.headline),
        health: ["good", "watch", "act"].includes(a.health) ? a.health : "watch",
        healthReason: String(a.healthReason || ""),
        answer: String(a.answer || ""),
        findings: strs(a.findings, 4),
        actions: (Array.isArray(a.actions) ? a.actions : []).filter((x: any) => x?.title).slice(0, 4).map((x: any) => ({
          title: String(x.title), why: String(x.why || ""),
          screen: SCREENS[area].includes(x.screen) ? x.screen : SCREENS[area][0], amount: n(x.amount),
        })),
        watchOuts: strs(a.watchOuts, 3),
        scorecard: rows,
        period: { start, end },
      },
    });
  } catch (err: any) {
    console.error("[area-advisor] error:", err);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});
