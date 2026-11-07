// src/features/home/HomeDashboard.tsx
// Home: charts first, then the key figures, then what needs doing, then reports.
// Every figure comes from metrics.ts; this file only lays them out.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, Maximize2, RefreshCw, Minus, PackageX, PackageMinus, HandCoins,
  Zap, ShoppingCart, Wallet, Receipt, Boxes, CheckCircle2, ChevronRight,
} from "lucide-react";
import { useInventoryStore } from "../../stores/inventoryStore";
import { useCustomerStore } from "../../stores/customerStore";
import { useTransactionStore } from "../../stores/transactionStore";
import { useBusinessStore } from "../../stores/businessStore";
import { useAuthStore } from "../../stores/authStore";
import { useAppStore } from "../../stores/appStore";
import { canOpenScreen } from "../../utils/screens";
import { toUuid } from "../../utils/idUtils";
import TrackedReports from "../../components/TrackedReports";
import type { Expense, Payment } from "../../types";
import {
  RANGE_LABELS, analyse, analyseBranches, formatGrowth, formatKsh, getRange, growth, makeBuckets, moneyReceived,
  pickGranularity, previousRange, stockSummary, toDateInput, METHODS, type RangeKey, type BranchSale, type MethodKey,
} from "./metrics";
import { fetchBranchSales } from "./branchSales";
import {
  TrendChart, BranchTrendChart, HoursChart, RankedBars, ShareBar, SeriesToggle, EmptyChart, CATEGORY_COLORS,
  type SeriesKey,
} from "./charts";
import { usePlayback, PlayButton, PlaybackBar } from "./playback";
import ChartViewer, { type ChartDef } from "./ChartViewer";
import AiAdvisory from "./AiAdvisory";

const RANGE_KEYS: RangeKey[] = ["today", "yesterday", "last7", "last30", "month", "quarter", "year", "custom"];
const GRAIN_WORD = { hour: "Hourly", day: "Daily", week: "Weekly", month: "Monthly" } as const;
const METHOD_LABEL: Record<MethodKey, string> = { "M-Pesa": "M-Pesa", Cash: "Cash", Card: "Card", Bank: "Bank transfer", Credit: "On credit (not yet paid)" };

const shortDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
const periodText = (r: { start: Date; end: Date }) =>
  r.start.toDateString() === r.end.toDateString() ? r.start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : `${shortDate(r.start)} – ${shortDate(r.end)}`;

export default function HomeDashboard() {
  const { products } = useInventoryStore();
  const { customers } = useCustomerStore();
  const { transactions, debtPayments, isSyncing, loadTransactionsFromServer } = useTransactionStore();
  const { businesses } = useBusinessStore();
  const { employees, shifts, currentEmployee } = useAuthStore();
  const { activeBusinessId, setActiveTab } = useAppStore();

  const [rangeKey, setRangeKey] = useState<RangeKey>("month");
  const [customStart, setCustomStart] = useState(() => toDateInput(new Date(Date.now() - 29 * 864e5)));
  const [customEnd, setCustomEnd] = useState(() => toDateInput(new Date()));
  const [visible, setVisible] = useState<SeriesKey[]>(["sales", "expenses", "profit"]);
  const [comparePrev, setComparePrev] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  useEffect(() => {
    if (!activeBusinessId) return;
    let unsubExp: (() => void) | undefined;
    let unsubPay: (() => void) | undefined;
    import("../../services/repositories")
      .then((mod) => {
        unsubExp = mod.ExpenseRepository.subscribe((rows: Expense[]) => setExpenses(Array.isArray(rows) ? rows : []));
        unsubPay = mod.PaymentRepository.subscribe((rows: Payment[]) => setPayments(Array.isArray(rows) ? rows : []));
      })
      .catch((err) => console.error("Home could not load expenses and payments", err));
    return () => {
      unsubExp?.();
      unsubPay?.();
    };
  }, [activeBusinessId]);

  // Re-evaluated each minute so "today" rolls over without a reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const dayKey = now.toDateString();

  const range = useMemo(() => getRange(rangeKey, now, customStart, customEnd), [rangeKey, dayKey, customStart, customEnd]);
  const prev = useMemo(() => previousRange(range), [range]);
  const grain = pickGranularity(range);
  const buckets = useMemo(() => makeBuckets(range, grain), [range, grain]);
  const playback = usePlayback(buckets, range.start);

  const data = useMemo(
    () => analyse({ transactions: Array.isArray(transactions) ? transactions : [], expenses, debtPayments: Array.isArray(debtPayments) ? debtPayments : [], payments }, range, buckets),
    [transactions, expenses, debtPayments, payments, range, buckets],
  );
  const { total, previous, series, cumulative } = data;
  const at = (frame: number | null) => (frame === null ? total : cumulative[frame] || total);

  // Branches: a light sales list for every branch, so they compare on the same footing.
  const branchList = useMemo(() => (businesses || []).map((b) => ({ id: toUuid(b.id), name: b.name })), [businesses]);
  const [branchSales, setBranchSales] = useState<BranchSale[]>([]);
  const [branchState, setBranchState] = useState<"idle" | "loading" | "error">("idle");
  const loadBranches = useCallback(async () => {
    if (branchList.length < 2) return;
    setBranchState("loading");
    try {
      setBranchSales(await fetchBranchSales(branchList.map((b) => b.id), { start: prev.start, end: range.end }));
      setBranchState("idle");
    } catch (err) {
      console.error("Branch sales could not be loaded", err);
      setBranchState("error");
    }
  }, [branchList, prev.start.getTime(), range.end.getTime()]);
  useEffect(() => {
    loadBranches();
  }, [loadBranches]);
  const branches = useMemo(
    () => analyseBranches(branchList, branchSales, range, buckets).map((b, i) => ({ ...b, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] })),
    [branchList, branchSales, range, buckets],
  );
  const showBranches = branchList.length > 1;

  const refresh = () => {
    loadTransactionsFromServer().catch(() => {});
    loadBranches();
  };

  // Figures that are not tied to the period.
  const safeProducts = Array.isArray(products) ? products : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const stock = useMemo(() => stockSummary(safeProducts, new Set(total.products.keys())), [safeProducts, total]);
  const owing = useMemo(() => safeCustomers.filter((c) => (c.debtBalance || 0) > 0).sort((a, b) => (b.debtBalance || 0) - (a.debtBalance || 0)), [safeCustomers]);
  const owingTotal = owing.reduce((s, c) => s + (c.debtBalance || 0), 0);
  const newCustomers = safeCustomers.filter((c) => {
    const t = new Date(c.joinDate).getTime();
    return t >= range.start.getTime() && t <= range.end.getTime();
  }).length;
  const prevNewCustomers = safeCustomers.filter((c) => {
    const t = new Date(c.joinDate).getTime();
    return t >= prev.start.getTime() && t <= prev.end.getTime();
  }).length;

  const role = currentEmployee?.role;
  const can = (id: string) => canOpenScreen(role, id);
  const vsText = `vs ${periodText(prev)}`;

  // ---------- Chart definitions (shared by the page and the full-screen viewer) ----------
  const productRows = (frame: number | null) =>
    [...at(frame).products.entries()].map(([k, v]) => ({ key: k, label: v.name, value: v.revenue, note: `${+v.qty.toFixed(2)} sold` }));
  const productScale = Math.max(0, ...[...total.products.values()].map((p) => p.revenue));
  const expenseRows = (frame: number | null) => {
    const s = at(frame);
    return [{ key: "cogs", label: "Cost of goods sold", value: s.cost }, ...[...s.expenseCategories.entries()].map(([k, v]) => ({ key: k, label: k, value: v }))];
  };
  const expenseScale = Math.max(total.cost, ...total.expenseCategories.values(), 0);
  const methodParts = (frame: number | null) => {
    const r = at(frame).received;
    return METHODS.map((m, i) => ({ key: m, label: METHOD_LABEL[m], value: r[m], color: m === "Credit" ? "var(--viz-muted)" : CATEGORY_COLORS[i] }));
  };
  const branchRows = (frame: number | null) =>
    branches.map((b) => {
      const sales = frame === null ? b.sales : b.perSlot.slice(0, frame + 1).reduce((s, v) => s + v, 0);
      return {
        key: b.id,
        label: b.name,
        value: sales,
        color: b.color,
        note: frame === null ? <GrowthText value={b.growth} /> : undefined,
      };
    });
  const branchScale = Math.max(0, ...branches.map((b) => b.sales));

  const trendVisible: SeriesKey[] = comparePrev ? [...visible, "prevSales"] : visible;

  const charts: ChartDef[] = [
    {
      id: "trend",
      title: "Sales, expenses and profit",
      subtitle: `${GRAIN_WORD[grain]}, ${periodText(range)}`,
      playable: true,
      render: ({ full, frame, animate }) =>
        total.sales === 0 && total.expenses === 0 ? (
          <EmptyChart text="No sales or expenses in this period" />
        ) : (
          <div className={full ? "flex h-full flex-col gap-3" : ""}>
            {full && <TrendControls visible={visible} setVisible={setVisible} comparePrev={comparePrev} setComparePrev={setComparePrev} totals={{ sales: at(frame).sales, expenses: at(frame).cost + at(frame).expenses, profit: at(frame).profit }} />}
            <div className={full ? "min-h-0 flex-1" : ""}>
              <TrendChart series={series} frame={frame} visible={trendVisible} height={full ? "100%" : 260} animate={animate} />
            </div>
          </div>
        ),
      table: (frame) => ({
        columns: ["Period", "Sales", "Orders", "Cost of goods", "Expenses", "Profit"],
        rows: series.filter((_, i) => frame === null || i <= frame).map((p) => [p.fullLabel, formatKsh(p.sales), p.orders, formatKsh(p.cost), formatKsh(p.expenses), formatKsh(p.profit)]),
      }),
    },
    ...(showBranches
      ? [
          {
            id: "branches",
            title: "Branches",
            subtitle: `Sales and growth ${vsText}`,
            playable: true,
            render: ({ frame }) =>
              branchState === "loading" && branchSales.length === 0 ? <EmptyChart text="Loading branch sales…" /> :
              branchState === "error" ? <EmptyChart text="Branch sales could not be loaded. Check the connection and refresh." /> :
              <RankedBars rows={branchRows(frame)} scaleMax={branchScale} limit={8} />,
            table: (frame) => ({
              columns: ["Branch", "Sales", "Orders", "Previous period", "Growth", "Share"],
              rows: branches.map((b, i) => [b.name, formatKsh(branchRows(frame)[i].value), b.orders, formatKsh(b.prevSales), formatGrowth(b.growth), `${Math.round(b.share)}%`]),
            }),
          },
          {
            id: "branch-trend",
            title: "Branch sales over time",
            subtitle: `${GRAIN_WORD[grain]}, ${periodText(range)}`,
            playable: true,
            render: ({ full, frame, animate }) =>
              branchSales.length === 0 ? <EmptyChart text={branchState === "loading" ? "Loading branch sales…" : "No branch sales in this period"} /> : (
                <div className={full ? "flex h-full flex-col gap-3" : ""}>
                  <Legend items={branches.map((b) => ({ label: b.name, color: b.color }))} />
                  <div className={full ? "min-h-0 flex-1" : ""}>
                    <BranchTrendChart branches={branches} labels={series} frame={frame} height={full ? "100%" : 240} animate={animate} />
                  </div>
                </div>
              ),
            table: (frame) => ({
              columns: ["Period", ...branches.map((b) => b.name)],
              rows: series.filter((_, i) => frame === null || i <= frame).map((p, i) => [p.fullLabel, ...branches.map((b) => formatKsh(b.perSlot[i]))]),
            }),
          } as ChartDef,
        ] as ChartDef[]
      : []),
    {
      id: "payments",
      title: "How money came in",
      subtitle: "Payments received, plus sales on credit",
      playable: true,
      render: ({ frame }) => <ShareBar parts={methodParts(frame)} />,
      table: (frame) => ({ columns: ["Method", "Amount"], rows: methodParts(frame).map((p) => [p.label, formatKsh(p.value)]) }),
    },
    {
      id: "products",
      title: "Best-selling products",
      subtitle: "By sales value",
      playable: true,
      render: ({ full, frame }) => <RankedBars rows={productRows(frame)} scaleMax={productScale} limit={full ? 15 : 6} />,
      table: (frame) => ({
        columns: ["Product", "Sold", "Sales value"],
        rows: productRows(frame).sort((a, b) => b.value - a.value).map((r) => [r.label, String(r.note).replace(" sold", ""), formatKsh(r.value)]),
      }),
    },
    {
      id: "hours",
      title: "Busiest hours",
      subtitle: "Sales by time of day, whole period",
      playable: true,
      render: ({ full, frame, animate }) =>
        total.sales === 0 ? <EmptyChart text="No sales in this period" /> : <HoursChart hours={at(frame).hours} scaleHours={total.hours} trim={!full} height={full ? "100%" : 220} animate={animate} />,
      table: (frame) => ({
        columns: ["Hour", "Sales"],
        rows: at(frame).hours.map((v, h) => [`${String(h).padStart(2, "0")}:00`, formatKsh(v)]).filter((r) => r[1] !== "KSh 0"),
      }),
    },
    {
      id: "expenses",
      title: "Where the money went",
      subtitle: "Cost of goods sold and recorded expenses",
      playable: true,
      render: ({ full, frame }) => <RankedBars rows={expenseRows(frame)} scaleMax={expenseScale} limit={full ? 15 : 6} color="var(--viz-2)" />,
      table: (frame) => ({ columns: ["Category", "Amount"], rows: expenseRows(frame).sort((a, b) => b.value - a.value).map((r) => [r.label, formatKsh(r.value)]) }),
    },
  ];
  const chartIndex = (id: string) => charts.findIndex((c) => c.id === id);
  const chart = (id: string) => charts[chartIndex(id)];
  const open = (id: string) => setViewer(chartIndex(id));
  const frame = playback.frame;
  const animate = !playback.playing;

  // ---------- Figures ----------
  const totalExpenses = total.cost + total.expenses;
  const prevExpenses = previous.cost + previous.expenses;
  const margin = total.sales > 0 ? (total.profit / total.sales) * 100 : null;
  const aov = total.orders ? total.sales / total.orders : 0;
  const prevAov = previous.orders ? previous.sales / previous.orders : 0;
  const received = moneyReceived(total);

  const figures: FigureProps[] = [
    { label: "Sales", value: formatKsh(total.sales, true), full: formatKsh(total.sales), change: growth(total.sales, previous.sales), polarity: "up" },
    { label: "Orders", value: total.orders.toLocaleString(), change: growth(total.orders, previous.orders), polarity: "up" },
    { label: "Average sale", value: formatKsh(aov, true), full: formatKsh(aov), change: growth(aov, prevAov), polarity: "up" },
    { label: "Profit (estimate)", value: formatKsh(total.profit, true), full: formatKsh(total.profit), change: growth(total.profit, previous.profit), polarity: "up", note: margin === null ? undefined : `${Math.round(margin)}% of sales` },
    { label: "Money received", value: formatKsh(received, true), full: formatKsh(received), change: growth(received, moneyReceived(previous)), polarity: "up" },
    { label: "Costs and expenses", value: formatKsh(totalExpenses, true), full: formatKsh(totalExpenses), change: growth(totalExpenses, prevExpenses), polarity: "down" },
    { label: "Sold on credit", value: formatKsh(total.creditSales, true), full: formatKsh(total.creditSales), change: growth(total.creditSales, previous.creditSales), polarity: "down" },
    { label: "New customers", value: newCustomers.toLocaleString(), change: growth(newCustomers, prevNewCustomers), polarity: "up" },
    { label: "Customers owing", value: formatKsh(owingTotal, true), full: formatKsh(owingTotal), note: `${owing.length} customer${owing.length === 1 ? "" : "s"}, today` },
    { label: "Stock value", value: formatKsh(stock.value, true), full: formatKsh(stock.value), note: `At selling price · ${formatKsh(stock.costValue, true)} at cost` },
  ];

  // ---------- AI payload (keys read by the bi-analyze function) ----------
  const branchTop = [...branches].sort((a, b) => b.sales - a.sales);
  const aiMetrics = {
    timeframe: rangeKey,
    totalSales: total.sales,
    orderCount: total.orders,
    aov: Math.round(aov),
    revenueTrend: Math.round(growth(total.sales, previous.sales) ?? 0),
    totalExpenses,
    cogs: total.cost,
    deliveryFees: 0,
    overheadExpenses: total.expenses,
    netProfit: total.profit,
    profitMargin: Math.round(margin ?? 0),
    cashReceived: total.received.Cash,
    cashBalance: total.received.Cash - total.expenses,
    mpesaCollections: total.received["M-Pesa"],
    mpesaShare: received > 0 ? Math.round((total.received["M-Pesa"] / received) * 100) : 0,
    mpesaSuccessCount: 0,
    mpesaFailedCount: 0,
    totalProducts: safeProducts.length,
    inventoryValuation: stock.value,
    lowStockCount: stock.lowStock.length + stock.outOfStock.length,
    lowStockProducts: [...stock.outOfStock, ...stock.lowStock].slice(0, 20).map((p) => ({ id: p.id, name: p.name, currentStock: p.stock, minStock: p.minStock })),
    topProducts: productRows(null).sort((a, b) => b.value - a.value).slice(0, 5).map((r) => ({ name: r.label, revenue: r.value })),
    slowProducts: stock.slowMoving.slice(0, 5).map((p) => ({ name: p.name, stock: p.stock })),
    branches: branches.map((b) => ({ id: b.id, name: b.name, revenue: b.sales, orders: b.orders, growth: b.growth === null ? null : Math.round(b.growth) })),
    topBranch: branchTop[0]?.name || "N/A",
    lowestBranch: branchTop[branchTop.length - 1]?.name || "N/A",
    activeShiftsCount: (shifts || []).filter((s: any) => s.status === "Active").length,
    checkoutVelocity: 0,
    staffTasksCompletionRate: 0,
    totalCustomers: safeCustomers.length,
    newCustomersCount: newCustomers,
    customerGrowthRate: Math.round(growth(newCustomers, prevNewCustomers) ?? 0),
    retentionRate: safeCustomers.length ? Math.round((safeCustomers.filter((c) => c.purchasesCount > 0).length / safeCustomers.length) * 100) : 0,
    feedbackCount: 0,
    averageRating: "0.0",
    sentimentPositive: 0,
    sentimentNeutral: 0,
    sentimentNegative: 0,
    openComplaintsCount: 0,
  };
  const aiFallback = () => ({
    executiveSummary: `${RANGE_LABELS[rangeKey]}: sales of ${formatKsh(total.sales)} from ${total.orders} order${total.orders === 1 ? "" : "s"} (${formatGrowth(growth(total.sales, previous.sales))} ${vsText}). Estimated profit ${formatKsh(total.profit)}. ${stock.outOfStock.length} product${stock.outOfStock.length === 1 ? " is" : "s are"} out of stock and ${stock.lowStock.length} running low.`,
    suggestedActions: [
      ...(stock.outOfStock.length ? ["Restock products that have run out"] : []),
      ...(stock.lowStock.length ? ["Order the products running low"] : []),
      ...(owing.length ? ["Follow up customers who owe money"] : []),
      "Check that today's expenses are recorded",
    ],
  });

  const quickActions = [
    { id: "sell", label: "Quick sale", icon: Zap },
    { id: "pos", label: "Checkout", icon: ShoppingCart },
    { id: "money", label: "Record expense", icon: Wallet },
    { id: "inventory", label: "Stock", icon: Boxes },
    { id: "sales", label: "Sales log", icon: Receipt },
  ].filter((a) => can(a.id));

  const attention = [
    stock.outOfStock.length > 0 && {
      key: "out", icon: PackageX, tone: "bad" as const, title: `${stock.outOfStock.length} product${stock.outOfStock.length === 1 ? "" : "s"} out of stock`,
      detail: stock.outOfStock.slice(0, 4).map((p) => p.name).join(", ") + (stock.outOfStock.length > 4 ? ` and ${stock.outOfStock.length - 4} more` : ""),
      tab: "inventory", action: "Restock",
    },
    stock.lowStock.length > 0 && {
      key: "low", icon: PackageMinus, tone: "warn" as const, title: `${stock.lowStock.length} running low`,
      detail: stock.lowStock.slice(0, 3).map((p) => `${p.name} (${p.stock} left)`).join(", ") + (stock.lowStock.length > 3 ? ` and ${stock.lowStock.length - 3} more` : ""),
      tab: "inventory", action: "Order",
    },
    owing.length > 0 && {
      key: "owing", icon: HandCoins, tone: "warn" as const, title: `${formatKsh(owingTotal)} owed by ${owing.length} customer${owing.length === 1 ? "" : "s"}`,
      detail: owing.slice(0, 3).map((c) => `${c.name} ${formatKsh(c.debtBalance || 0, true)}`).join(", "),
      tab: "customers", action: "Follow up",
    },
  ].filter(Boolean) as { key: string; icon: any; tone: "bad" | "warn"; title: string; detail: string; tab: string; action: string }[];

  const activeShifts = (shifts || []).filter((s: any) => s.status === "Active").length;
  const itemsSold = [...total.products.values()].reduce((s, p) => s + p.qty, 0);
  const tiers = (["Gold", "Silver", "Bronze"] as const).map((t) => ({ key: t, label: t, value: safeCustomers.filter((c) => (c.tier || "Bronze") === t).length }));
  const branchName = businesses?.find((b) => b.id === activeBusinessId)?.name;

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-16">
      {/* Header and the one filter row that scopes everything below */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-app-text">Home</h1>
            <p className="mt-0.5 text-sm text-app-text-muted truncate">
              {branchName ? `${branchName} · ` : ""}{periodText(range)}
            </p>
          </div>
          <button type="button" onClick={refresh} className="flex items-center gap-2 rounded-full border border-app-border px-3 py-1.5 text-xs text-app-text-muted hover:text-app-text cursor-pointer" title="Load the latest figures">
            <RefreshCw size={14} className={isSyncing || branchState === "loading" ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="inline-flex gap-1 rounded-full bg-app-card p-1 border border-app-border" role="group" aria-label="Period">
            {RANGE_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setRangeKey(k)}
                aria-pressed={rangeKey === k}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs cursor-pointer transition ${rangeKey === k ? "bg-app-text text-app-card font-semibold" : "text-app-text-muted hover:text-app-text"}`}
              >
                {RANGE_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        {rangeKey === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} className="rounded-lg border border-app-border bg-app-card px-3 py-2 text-app-text" aria-label="From" />
            <span className="text-app-text-muted">to</span>
            <input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-lg border border-app-border bg-app-card px-3 py-2 text-app-text" aria-label="To" />
          </div>
        )}
        {playback.frame !== null && (
          <div className="sticky top-2 z-20">
            <PlaybackBar playback={playback} buckets={buckets} range={range} />
          </div>
        )}
      </header>

      {/* 1. Charts */}
      <section aria-labelledby="home-trends" className="space-y-6">
        <SectionTitle id="home-trends">Trends</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel className="lg:col-span-2" def={chart("trend")} onOpen={() => open("trend")} playback={playback}>
            <div className="mb-4">
              <TrendControls visible={visible} setVisible={setVisible} comparePrev={comparePrev} setComparePrev={setComparePrev} totals={{ sales: at(frame).sales, expenses: at(frame).cost + at(frame).expenses, profit: at(frame).profit }} />
            </div>
            {chart("trend").render({ full: false, frame, animate })}
          </Panel>
          <Panel def={chart("payments")} onOpen={() => open("payments")} playback={playback}>
            {chart("payments").render({ full: false, frame, animate })}
          </Panel>
        </div>

        {showBranches && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel def={chart("branches")} onOpen={() => open("branches")} playback={playback}>
              {chart("branches").render({ full: false, frame, animate })}
            </Panel>
            <Panel def={chart("branch-trend")} onOpen={() => open("branch-trend")} playback={playback}>
              {chart("branch-trend").render({ full: false, frame, animate })}
            </Panel>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {(["products", "hours", "expenses"] as const).map((id) => (
            <Panel key={id} def={chart(id)} onOpen={() => open(id)} playback={playback}>
              {chart(id).render({ full: false, frame, animate })}
            </Panel>
          ))}
        </div>
      </section>

      {/* 2. Figures */}
      <section aria-labelledby="home-figures" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle id="home-figures">Key figures</SectionTitle>
          <span className="text-xs text-app-text-muted">Changes are {vsText}</span>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-app-border bg-app-border sm:grid-cols-3 lg:grid-cols-5">
          {figures.map((f) => <Figure key={f.label} {...f} />)}
        </div>
      </section>

      {/* 3. Actions */}
      <section aria-labelledby="home-actions" className="space-y-4">
        <SectionTitle id="home-actions">Needs attention</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-3">
          <ul className="lg:col-span-2 divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
            {attention.length === 0 ? (
              <li className="flex items-center gap-3 p-4 text-sm text-app-text">
                <CheckCircle2 size={18} className="text-[var(--good)] shrink-0" />
                Nothing needs attention right now: stock is above its minimum and no customer owes money.
              </li>
            ) : (
              attention.map((a) => {
                const Icon = a.icon;
                return (
                  <li key={a.key} className="flex items-start gap-3 p-4">
                    <Icon size={18} className={`mt-0.5 shrink-0 ${a.tone === "bad" ? "text-[var(--bad)]" : "text-[#c98500]"}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-app-text">{a.title}</div>
                      <div className="mt-0.5 text-xs text-app-text-muted break-words">{a.detail}</div>
                    </div>
                    {can(a.tab) && (
                      <button type="button" onClick={() => setActiveTab(a.tab as any)} className="flex shrink-0 items-center gap-0.5 rounded-full px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-app-bg cursor-pointer">
                        {a.action}
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </li>
                );
              })
            )}
          </ul>
          {quickActions.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-text-muted">Go to</h3>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button key={a.id} type="button" onClick={() => setActiveTab(a.id as any)} className="flex items-center gap-2 rounded-xl border border-app-border bg-app-card px-3 py-3 text-left text-sm text-app-text hover:border-brand-500/40 cursor-pointer min-w-0">
                      <Icon size={16} className="shrink-0 text-brand-500" />
                      <span className="truncate">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 4. Reports */}
      <section aria-labelledby="home-reports" className="space-y-6">
        <SectionTitle id="home-reports">Reports</SectionTitle>

        <TrackedReports
          businessId={activeBusinessId}
          transactions={(Array.isArray(transactions) ? transactions : []).filter((t) => {
            const ts = new Date(t.timestamp).getTime();
            return ts >= range.start.getTime() && ts <= range.end.getTime();
          })}
          customers={safeCustomers}
          products={safeProducts}
          formatCurrency={(n) => formatKsh(n)}
        />

        <div className="grid gap-x-10 gap-y-8 rounded-2xl border border-app-border bg-app-card p-5 md:grid-cols-3">
          <div>
            <h3 className="text-[15px] font-semibold text-app-text">Team</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="On shift now" value={activeShifts.toLocaleString()} />
              <Row label="Staff" value={(employees || []).length.toLocaleString()} />
              <Row label="Items per sale" value={total.orders ? (itemsSold / total.orders).toFixed(1) : "–"} />
            </dl>
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-app-text">Loyalty members</h3>
            <div className="mt-3">
              <RankedBars rows={tiers} scaleMax={Math.max(...tiers.map((t) => t.value), 1)} format={(n) => n.toLocaleString()} emptyText="No loyalty members yet" sort={false} />
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-app-text">Not selling</h3>
            <p className="text-xs text-app-text-muted">In stock, no sales this period. Highest stock value first.</p>
            {stock.slowMoving.length === 0 ? (
              <p className="mt-3 text-sm text-app-text-muted">Every stocked product sold at least once.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {stock.slowMoving.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-app-text">{p.name}</span>
                    <span className="shrink-0 text-xs text-app-text-muted tabular-nums">{p.stock} {p.unit} · {formatKsh(p.price * p.stock, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-app-border bg-app-card p-5">
          <AiAdvisory businessId={activeBusinessId} metrics={aiMetrics} fallback={aiFallback} />
        </div>

        <p className="text-xs text-app-text-muted leading-relaxed">
          Profit is an estimate: sales minus each product's recorded cost and the expenses entered for the period.
          Branch figures include every branch you can see.
        </p>
      </section>

      {viewer !== null && charts[viewer] && (
        <ChartViewer charts={charts} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} playback={playback} buckets={buckets} range={range} />
      )}
    </div>
  );
}

// ---------- Small building blocks ----------

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-lg font-semibold tracking-tight text-app-text">{children}</h2>;
}

function Panel({ def, onOpen, playback, className = "", children }: { def: ChartDef; onOpen: () => void; playback: ReturnType<typeof usePlayback>; className?: string; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-app-border bg-app-card p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-app-text">{def.title}</h3>
          <p className="mt-0.5 text-xs text-app-text-muted">{def.subtitle}</p>
        </div>
        <div className="-mr-2 -mt-1 flex shrink-0 items-center">
          {def.playable && <PlayButton playback={playback} />}
          <button type="button" onClick={onOpen} className="flex h-9 w-9 items-center justify-center rounded-full text-app-text-muted hover:bg-app-bg hover:text-app-text cursor-pointer" aria-label={`Open ${def.title} full screen`} title="Full screen">
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function TrendControls({ visible, setVisible, comparePrev, setComparePrev, totals }: { visible: SeriesKey[]; setVisible: (v: SeriesKey[]) => void; comparePrev: boolean; setComparePrev: (v: boolean) => void; totals: Partial<Record<SeriesKey, number>> }) {
  const toggle = (k: SeriesKey) => {
    const next = visible.includes(k) ? visible.filter((v) => v !== k) : [...visible, k];
    if (next.length) setVisible((["sales", "expenses", "profit"] as SeriesKey[]).filter((s) => next.includes(s)));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SeriesToggle keys={["sales", "expenses", "profit"]} visible={visible} onToggle={toggle} totals={totals} />
      <button
        type="button"
        onClick={() => setComparePrev(!comparePrev)}
        aria-pressed={comparePrev}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs cursor-pointer ${comparePrev ? "border-app-border bg-app-bg text-app-text" : "border-dashed border-app-border text-app-text-muted"}`}
      >
        <span className="inline-block w-3 h-0.5 rounded bg-[var(--viz-muted)]" />
        Previous period
      </button>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-app-text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 min-w-0">
          <span className="inline-block w-3 h-0.5 rounded shrink-0" style={{ background: i.color }} />
          <span className="truncate">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

function GrowthText({ value }: { value: number | null }) {
  if (value === null) return <span>New</span>;
  const up = value >= 0;
  return <span className={up ? "text-[var(--good)]" : "text-[var(--bad)]"}>{formatGrowth(value)}</span>;
}

interface FigureProps {
  label: string;
  value: string;
  /** Unrounded value, shown on hover when `value` is shortened. */
  full?: string;
  change?: number | null;
  /** Whether a rise is good ("up") or bad ("down"). */
  polarity?: "up" | "down";
  note?: string;
}

function Figure({ label, value, full, change, polarity, note }: FigureProps) {
  const hasChange = change !== undefined;
  const flat = change === null || change === undefined || Math.round(change) === 0;
  const rising = (change ?? 0) > 0;
  const good = polarity === "down" ? !rising : rising;
  const Icon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="min-w-0 bg-app-card p-4">
      <div className="text-xs text-app-text-muted leading-snug">{label}</div>
      <div className="mt-1.5 text-xl font-semibold leading-tight text-app-text break-words sm:text-[22px]" title={full}>{value}</div>
      {hasChange && (
        <div className={`mt-1.5 flex items-center gap-1 text-xs ${flat ? "text-app-text-muted" : good ? "text-[var(--good)]" : "text-[var(--bad)]"}`}>
          <Icon size={13} aria-hidden />
          <span>{change === null ? "No earlier data" : formatGrowth(change)}</span>
        </div>
      )}
      {note && <div className="mt-1 text-[11px] leading-snug text-app-text-muted">{note}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-app-text-muted">{label}</dt>
      <dd className="font-semibold text-app-text tabular-nums">{value}</dd>
    </div>
  );
}
