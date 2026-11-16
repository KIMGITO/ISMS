// supabase/functions/shared/books.ts
// Reads the double-entry books for a period with the signed-in person's own access (so a
// role without accounting.view gets null) and turns them into plain figures: profit & loss
// against the period before, cash per account, who owes us, what we owe and when, VAT,
// stock. Used by the Home advice (bi-analyze) and the Assistant chat.

// deno-lint-ignore-file no-explicit-any

export const n = (v: unknown) => Number(v) || 0;
const r0 = (v: number) => Math.round(v);
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : null);
export const ksh = (v: number) => `KSh ${r0(v).toLocaleString("en-KE")}`;
export const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });

interface Acc { code: string; name: string; type: string; key: string | null; debit: number; credit: number; closing: number }

/** Profit & loss from one acc_report: income, cost of sales, other costs (biggest first). */
function pnl(accounts: Acc[]) {
  const moved = (a: Acc) => (a.type === "expense" ? a.debit - a.credit : a.credit - a.debit);
  const isCost = (a: Acc) => a.type === "expense" && (a.key === "cogs" || a.code.startsWith("5"));
  const income = accounts.filter((a) => a.type === "income").reduce((s, a) => s + moved(a), 0);
  const cost = accounts.filter(isCost).reduce((s, a) => s + moved(a), 0);
  const expenseRows = accounts
    .filter((a) => a.type === "expense" && !isCost(a))
    .map((a) => ({ name: a.name, amount: moved(a) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const expenses = expenseRows.reduce((s, x) => s + x.amount, 0);
  return { income, cost, gross: income - cost, expenses, net: income - cost - expenses, expenseRows };
}

/** Balances at the end date by system key (assets and expenses positive by debit). */
function closingBy(accounts: Acc[], keys: string[]) {
  return accounts
    .filter((a) => a.key && keys.includes(a.key))
    .reduce((s, a) => s + (a.type === "asset" || a.type === "expense" ? a.closing : -a.closing), 0);
}

export async function readBooks(db: any, businessId: string, start: string, end: string, prevStart: string, prevEnd: string) {
  const call = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  };
  // Without accounting.view these refuse; the advice then uses the sales figures only.
  try {
    const [now, before, receivables, payables, vat, checks] = await Promise.all([
      call("acc_report", { p_business_id: businessId, p_start: start, p_end: end }),
      call("acc_report", { p_business_id: businessId, p_start: prevStart, p_end: prevEnd }),
      call("acc_receivables", { p_business_id: businessId }).catch(() => []),
      call("acc_payables", { p_business_id: businessId }).catch(() => null),
      call("acc_vat", { p_business_id: businessId, p_start: start, p_end: end }).catch(() => null),
      call("acc_checks", { p_business_id: businessId }).catch(() => null),
    ]);
    const accNow: Acc[] = (now?.accounts || []).map((a: any) => ({ ...a, debit: n(a.debit), credit: n(a.credit), closing: n(a.closing) }));
    const accBefore: Acc[] = (before?.accounts || []).map((a: any) => ({ ...a, debit: n(a.debit), credit: n(a.credit), closing: n(a.closing) }));
    const p = pnl(accNow);
    const q = pnl(accBefore);
    const moneyKeys = ["cash", "mpesa", "airtel", "bank", "card"];
    const money = accNow
      .filter((a) => a.key && moneyKeys.includes(a.key))
      .map((a) => ({ name: a.name, amount: a.closing }))
      .filter((m) => m.amount !== 0);

    const today = day(new Date());
    const inWeek = day(new Date(Date.now() + 7 * 86400000));
    const debtors = ((receivables as any[]) || [])
      .map((r) => ({ name: r.name, owes: n(r.owes), since: r.since as string | null }))
      .filter((r) => r.owes > 0)
      .sort((a, b) => b.owes - a.owes);
    const bills = ((payables?.suppliers as any[]) || []).flatMap((s) =>
      (s.bills || []).map((b: any) => ({ supplier: s.name, owed: n(b.owed), due: b.due as string | null })),
    ).filter((b: any) => b.owed > 0);
    const owedSuppliers = ((payables?.suppliers as any[]) || []).reduce((sum, s) => sum + n(s.owed), 0);
    const dueSoon = bills.filter((b: any) => b.due && b.due <= inWeek);
    const overdueBills = bills.filter((b: any) => b.due && b.due < today);

    return {
      profit: {
        sales: p.income, costOfSales: p.cost, grossProfit: p.gross,
        grossMargin: p.income ? Math.round((p.gross / p.income) * 100) : null,
        expenses: p.expenses, netProfit: p.net,
        netMargin: p.income ? Math.round((p.net / p.income) * 100) : null,
        topExpenses: p.expenseRows.slice(0, 5),
        before: { sales: q.income, grossProfit: q.gross, expenses: q.expenses, netProfit: q.net },
        salesChange: pct(p.income, q.income), expensesChange: pct(p.expenses, q.expenses), profitChange: pct(p.net, q.net),
        // Costs that grew the most against the previous period.
        risingCosts: p.expenseRows
          .map((x) => ({ name: x.name, now: x.amount, before: q.expenseRows.find((y) => y.name === x.name)?.amount || 0 }))
          .filter((x) => x.now - x.before > 0)
          .sort((a, b) => (b.now - b.before) - (a.now - a.before))
          .slice(0, 3),
      },
      cash: {
        total: money.reduce((s, m) => s + m.amount, 0),
        byAccount: money,
      },
      owedToUs: {
        total: debtors.reduce((s, d) => s + d.owes, 0),
        customers: debtors.length,
        top: debtors.slice(0, 5),
        olderThan30Days: debtors.filter((d) => d.since && d.since < day(new Date(Date.now() - 30 * 86400000))).reduce((s, d) => s + d.owes, 0),
      },
      weOwe: {
        suppliers: owedSuppliers,
        dueThisWeek: dueSoon.reduce((s: number, b: any) => s + b.owed, 0),
        overdue: overdueBills.reduce((s: number, b: any) => s + b.owed, 0),
        dueList: dueSoon.slice(0, 5),
        vatToPay: vat ? n(vat.owedNow) : 0,
        loans: closingBy(accNow, ["loans"]),
      },
      stock: {
        valueInBooks: closingBy(accNow, ["inventory"]),
        countDifference: checks ? n(checks.stock?.difference) : 0,
        losses: accNow.filter((a) => a.key === "stock_loss").reduce((s, a) => s + (a.debit - a.credit), 0),
      },
      ownerDrawings: accNow.filter((a) => a.key === "drawings").reduce((s, a) => s + (a.debit - a.credit), 0),
      postingErrors: n(now?.errors),
    };
  } catch (err) {
    console.warn("[bi-analyze] books not read:", (err as any)?.message || err);
    return null;
  }
}


export type Books = NonNullable<Awaited<ReturnType<typeof readBooks>>>;

/** The books as short lines for a chat prompt. */
export function booksText(b: Books, from: string, to: string): string {
  const p = b.profit;
  const ch = (c: number | null) => (c === null ? "" : ` (${c >= 0 ? "+" : ""}${c}% vs the period before)`);
  return [
    `Period ${from} to ${to}:`,
    `- Sales ${ksh(p.sales)}${ch(p.salesChange)}; cost of goods ${ksh(p.costOfSales)}; gross profit ${ksh(p.grossProfit)}${p.grossMargin === null ? "" : ` (${p.grossMargin}%)`}`,
    `- Expenses ${ksh(p.expenses)}${ch(p.expensesChange)}; net profit ${ksh(p.netProfit)}${ch(p.profitChange)}`,
    p.topExpenses.length ? `- Biggest expenses: ${p.topExpenses.map((e: any) => `${e.name} ${ksh(e.amount)}`).join(", ")}` : "",
    `- Money now: ${b.cash.byAccount.map((m: any) => `${m.name} ${ksh(m.amount)}`).join(", ") || "none recorded"} (total ${ksh(b.cash.total)})`,
    `- Customers owe ${ksh(b.owedToUs.total)}${b.owedToUs.top.length ? `; most: ${b.owedToUs.top.map((d: any) => `${d.name} ${ksh(d.owes)}`).join(", ")}` : ""}`,
    `- We owe suppliers ${ksh(b.weOwe.suppliers)}; due within 7 days ${ksh(b.weOwe.dueThisWeek)}; overdue ${ksh(b.weOwe.overdue)}`,
    b.weOwe.vatToPay ? `- VAT to pay KRA ${ksh(b.weOwe.vatToPay)}` : "",
    b.weOwe.loans ? `- Loans ${ksh(b.weOwe.loans)}` : "",
    `- Stock value in the books ${ksh(b.stock.valueInBooks)}; stock losses this period ${ksh(b.stock.losses)}`,
    b.ownerDrawings ? `- Owner took out ${ksh(b.ownerDrawings)}` : "",
  ].filter(Boolean).join("\n");
}
