// src/features/home/HomeDashboard.tsx
// Home: charts first, then four key figures, then what needs doing, then reports.
// Every figure comes from metrics.ts; this file only lays them out.
// On phones, secondary groups scroll sideways so the page stays short.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Maximize2, RefreshCw, Minus, PackageX, PackageMinus, HandCoins, CheckCircle2, ChevronRight } from "lucide-react";
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
  TrendChart, BranchTrendChart, HoursChart, RankedBars, ShareBar, SeriesToggle, EmptyChart, GrowthBars, Sparkline,
  CATEGORY_COLORS, type SeriesKey,
} from "./charts";
import { usePlayback, PlayButton, PlaybackBar, type Playback } from "./playback";
import ChartViewer, { type ChartDef } from "./ChartViewer";
import AiAdvisory from "./AiAdvisory";

const RANGE_KEYS: RangeKey[] = ["today", "yesterday", "last7", "last30", "month", "quarter", "year", "custom"];
const GRAIN_WORD = { hour: "Hourly", day: "Daily", week: "Weekly", month: "Monthly" } as const;
const METHOD_LABEL: Record<MethodKey, string> = { "M-Pesa": "M-Pesa", Cash: "Cash", Card: "Card", Bank: "Bank", Credit: "On credit" };

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

  // Branches (each business is a branch): a light sales list for all of them, on the same footing.
  const branchList = useMemo(() => (businesses || []).map((b) => ({ id: toUuid(b.id), name: b.name })), [businesses]);
  const [branchSales, setBranchSales] = useState<BranchSale[]>([]);
  const [branchState, setBranchState] = useState<"idle" | "loading" | "error">("idle");
  const loadBranches = useCallback(async () => {
    if (branchList.length === 0) return;
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
  const manyBranches = branchList.length > 1;

  const refresh = () => {
    loadTransactionsFromServer().catch(() => {});
    loadBranches();
  };

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

  const can = (id: string) => canOpenScreen(currentEmployee?.role, id);
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
  const branchSalesAt = (b: (typeof branches)[number], frame: number | null) => (frame === null ? b.sales : b.perSlot.slice(0, frame + 1).reduce((s, v) => s + v, 0));
  const branchScale = Math.max(0, ...branches.map((b) => b.sales));
  const branchLoadingOrError =
    branchState === "error" ? <EmptyChart text="Couldn't load branch sales. Refresh to try again." /> :
    branchState === "loading" && branchSales.length === 0 ? <EmptyChart text="Loading branches…" /> : null;

  const trendVisible: SeriesKey[] = comparePrev ? [...visible, "prevSales"] : visible;
  const trendTotals = (frame: number | null) => ({ sales: at(frame).sales, expenses: at(frame).cost + at(frame).expenses, profit: at(frame).profit });

  const charts: ChartDef[] = [
    {
      id: "trend",
      title: "Sales, expenses and profit",
      subtitle: `${GRAIN_WORD[grain]} · ${periodText(range)}`,
      playable: true,
      render: ({ full, frame, animate }) =>
        total.sales === 0 && total.expenses === 0 ? (
          <EmptyChart text="No sales or expenses yet" />
        ) : (
          <div className={full ? "flex h-full flex-col gap-2" : ""}>
            {full && (
              <div className="shrink-0 overflow-x-auto">
                <TrendControls visible={visible} setVisible={setVisible} comparePrev={comparePrev} setComparePrev={setComparePrev} totals={trendTotals(frame)} />
              </div>
            )}
            <div className={full ? "min-h-0 flex-1" : "h-[210px] sm:h-[280px]"}>
              <TrendChart series={series} frame={frame} visible={trendVisible} height="100%" animate={animate} />
            </div>
          </div>
        ),
      table: (frame) => ({
        columns: ["Period", "Sales", "Orders", "Cost of goods", "Expenses", "Profit"],
        rows: series.filter((_, i) => frame === null || i <= frame).map((p) => [p.fullLabel, formatKsh(p.sales), p.orders, formatKsh(p.cost), formatKsh(p.expenses), formatKsh(p.profit)]),
      }),
    },
    {
      id: "growth",
      title: manyBranches ? "Branch growth" : "Growth",
      subtitle: vsText,
      playable: false,
      render: () =>
        branchLoadingOrError ?? (
          <div>
            <GrowthBars rows={branches.map((b) => ({ key: b.id, label: b.name, growth: b.growth, sales: b.sales, color: b.color }))} />
            {!manyBranches && (
              <p className="mt-4 text-xs text-app-text-muted">
                Open another branch in Business Management to compare them here.
              </p>
            )}
          </div>
        ),
      table: () => ({
        columns: ["Branch", "Sales", "Previous period", "Growth", "Share"],
        rows: branches.map((b) => [b.name, formatKsh(b.sales), formatKsh(b.prevSales), formatGrowth(b.growth), `${Math.round(b.share)}%`]),
      }),
    },
    ...(manyBranches
      ? ([
          {
            id: "branches",
            title: "Branch sales",
            subtitle: periodText(range),
            playable: true,
            render: ({ frame }) =>
              branchLoadingOrError ?? (
                <RankedBars rows={branches.map((b) => ({ key: b.id, label: b.name, value: branchSalesAt(b, frame), color: b.color, note: `${Math.round(b.share)}%` }))} scaleMax={branchScale} limit={8} />
              ),
            table: (frame) => ({
              columns: ["Branch", "Sales", "Orders", "Share"],
              rows: branches.map((b) => [b.name, formatKsh(branchSalesAt(b, frame)), b.orders, `${Math.round(b.share)}%`]),
            }),
          },
          {
            id: "branch-trend",
            title: "Branches over time",
            subtitle: `${GRAIN_WORD[grain]} · ${periodText(range)}`,
            playable: true,
            render: ({ full, frame, animate }) =>
              branchLoadingOrError ?? (
                <div className={full ? "flex h-full flex-col" : ""}>
                  <Legend items={branches.map((b) => ({ label: b.name, color: b.color }))} />
                  <div className={full ? "min-h-0 flex-1" : "h-[190px]"}>
                    <BranchTrendChart branches={branches} labels={series} frame={frame} height="100%" animate={animate} />
                  </div>
                </div>
              ),
            table: (frame) => ({
              columns: ["Period", ...branches.map((b) => b.name)],
              rows: series.filter((_, i) => frame === null || i <= frame).map((p, i) => [p.fullLabel, ...branches.map((b) => formatKsh(b.perSlot[i]))]),
            }),
          },
        ] as ChartDef[])
      : []),
    {
      id: "payments",
      title: "How money came in",
      subtitle: "Payments received, and sales on credit",
      playable: true,
      render: ({ frame }) => <ShareBar parts={methodParts(frame)} />,
      table: (frame) => ({ columns: ["Method", "Amount"], rows: methodParts(frame).map((p) => [p.label, formatKsh(p.value)]) }),
    },
    {
      id: "products",
      title: "Best sellers",
      subtitle: "By sales value",
      playable: true,
      render: ({ full, frame }) => <RankedBars rows={productRows(frame)} scaleMax={productScale} limit={full ? 15 : 5} />,
      table: (frame) => ({
        columns: ["Product", "Sold", "Sales value"],
        rows: productRows(frame).sort((a, b) => b.value - a.value).map((r) => [r.label, String(r.note).replace(" sold", ""), formatKsh(r.value)]),
      }),
    },
    {
      id: "hours",
      title: "Busiest hours",
      subtitle: "Sales by time of day",
      playable: true,
      render: ({ full, frame, animate }) =>
        total.sales === 0 ? <EmptyChart text="No sales yet" /> : (
          <div className={full ? "h-full" : "h-[190px]"}>
            <HoursChart hours={at(frame).hours} scaleHours={total.hours} trim={!full} height="100%" animate={animate} />
          </div>
        ),
      table: (frame) => ({
        columns: ["Hour", "Sales"],
        rows: at(frame).hours.map((v, h) => [`${String(h).padStart(2, "0")}:00`, formatKsh(v)]).filter((r) => r[1] !== "KSh 0"),
      }),
    },
    {
      id: "expenses",
      title: "Where money went",
      subtitle: "Cost of goods and expenses",
      playable: true,
      render: ({ full, frame }) => <RankedBars rows={expenseRows(frame)} scaleMax={expenseScale} limit={full ? 15 : 5} color="var(--viz-2)" />,
      table: (frame) => ({ columns: ["Category", "Amount"], rows: expenseRows(frame).sort((a, b) => b.value - a.value).map((r) => [r.label, formatKsh(r.value)]) }),
    },
  ];
  const chartIndex = (id: string) => charts.findIndex((c) => c.id === id);
  const chart = (id: string) => charts[chartIndex(id)];
  const open = (id: string) => setViewer(chartIndex(id));
  const frame = playback.frame;
  const animate = !playback.playing;
  const sideCharts = charts.filter((c) => c.id !== "trend");

  // ---------- The four figures that matter, each with its trend and one line of meaning ----------
  const spending = total.cost + total.expenses;
  const margin = total.sales > 0 ? (total.profit / total.sales) * 100 : null;
  const aov = total.orders ? total.sales / total.orders : 0;
  const received = moneyReceived(total);

  const figures: FigureProps[] = [
    {
      label: "Sales", value: formatKsh(total.sales, true), full: formatKsh(total.sales), change: growth(total.sales, previous.sales), polarity: "up",
      spark: series.map((p) => p.sales), color: "var(--viz-1)",
      meaning: total.orders ? `${total.orders.toLocaleString()} orders · ${formatKsh(aov, true)} each` : "No orders yet",
    },
    {
      label: "Profit", hint: "Estimate: sales minus product cost and expenses", value: formatKsh(total.profit, true), full: formatKsh(total.profit), change: growth(total.profit, previous.profit), polarity: "up",
      spark: series.map((p) => p.profit), color: "var(--viz-3)",
      meaning: margin === null ? "No sales yet" : total.profit < 0 ? "Spending is above sales" : `Kept ${Math.round(margin)}% of sales`,
    },
    {
      label: "Money in", value: formatKsh(received, true), full: formatKsh(received), change: growth(received, moneyReceived(previous)), polarity: "up",
      spark: series.map((p) => p.received), color: "var(--viz-4)",
      meaning: total.creditSales > 0 ? `${formatKsh(total.creditSales, true)} sold on credit` : "No credit sales",
    },
    {
      label: "Spending", value: formatKsh(spending, true), full: formatKsh(spending), change: growth(spending, previous.cost + previous.expenses), polarity: "down",
      spark: series.map((p) => p.spending), color: "var(--viz-2)",
      meaning: spending > 0 ? `${Math.round((total.cost / spending) * 100)}% is stock sold` : "Nothing spent yet",
    },
  ];

  // ---------- AI payload (keys read by the bi-analyze function) ----------
  const branchTop = [...branches].sort((a, b) => b.sales - a.sales);
  const aiMetrics = {
    timeframe: rangeKey,
    totalSales: total.sales,
    orderCount: total.orders,
    aov: Math.round(aov),
    revenueTrend: Math.round(growth(total.sales, previous.sales) ?? 0),
    totalExpenses: spending,
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

  const attention: AttentionItem[] = [
    stock.outOfStock.length > 0 && {
      key: "out", icon: PackageX, tone: "bad", count: stock.outOfStock.length.toLocaleString(), title: "out of stock",
      detail: stock.outOfStock.slice(0, 3).map((p) => p.name).join(", ") + (stock.outOfStock.length > 3 ? ` +${stock.outOfStock.length - 3}` : ""),
      tab: "inventory", action: "Restock",
    },
    stock.lowStock.length > 0 && {
      key: "low", icon: PackageMinus, tone: "warn", count: stock.lowStock.length.toLocaleString(), title: "running low",
      detail: stock.lowStock.slice(0, 3).map((p) => `${p.name} (${p.stock})`).join(", ") + (stock.lowStock.length > 3 ? ` +${stock.lowStock.length - 3}` : ""),
      tab: "inventory", action: "Order",
    },
    owing.length > 0 && {
      key: "owing", icon: HandCoins, tone: "warn", count: formatKsh(owingTotal, true), title: `owed by ${owing.length} customer${owing.length === 1 ? "" : "s"}`,
      detail: owing.slice(0, 2).map((c) => `${c.name} ${formatKsh(c.debtBalance || 0, true)}`).join(", "),
      tab: "customers", action: "Follow up",
    },
  ].filter(Boolean) as AttentionItem[];

  const activeShifts = (shifts || []).filter((s: any) => s.status === "Active").length;
  const itemsSold = [...total.products.values()].reduce((s, p) => s + p.qty, 0);
  const tiers = (["Gold", "Silver", "Bronze"] as const).map((t) => ({ key: t, label: t, value: safeCustomers.filter((c) => (c.tier || "Bronze") === t).length }));
  const branchName = businesses?.find((b) => b.id === activeBusinessId)?.name;

  return (
    <div className="mx-auto max-w-7xl space-y-9 pb-16">
      {/* Header and the one filter row that scopes everything below */}
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-app-text">Home</h1>
            <p className="text-[13px] text-app-text-muted truncate">{branchName ? `${branchName} · ` : ""}{periodText(range)}</p>
          </div>
          <button type="button" onClick={refresh} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-app-text-muted hover:bg-app-card hover:text-app-text cursor-pointer" aria-label="Refresh" title="Refresh">
            <RefreshCw size={17} className={isSyncing || branchState === "loading" ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 no-scrollbar">
          <div className="inline-flex gap-1 rounded-full border border-app-border bg-app-card p-1" role="group" aria-label="Period">
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

      {/* 1. Charts: the main trend, then the rest side by side (swipe on phones) */}
      <section aria-label="Trends" className="space-y-4">
        <Panel def={chart("trend")} onOpen={() => open("trend")} playback={playback} showSubtitle>
          <div className="mb-3 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 no-scrollbar">
            <TrendControls visible={visible} setVisible={setVisible} comparePrev={comparePrev} setComparePrev={setComparePrev} totals={trendTotals(frame)} />
          </div>
          {chart("trend").render({ full: false, frame, animate })}
        </Panel>
        <Rail label="More charts" className="lg:grid-cols-3">
          {sideCharts.map((c, i) => (
            <Panel key={c.id} def={c} onOpen={() => open(c.id)} playback={playback} className={i === sideCharts.length - 1 ? lastSpan(sideCharts.length) : ""}>
              {c.render({ full: false, frame: c.playable ? frame : null, animate })}
            </Panel>
          ))}
        </Rail>
      </section>

      {/* 2. Key figures */}
      <section aria-labelledby="home-figures" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <SectionTitle id="home-figures">Key figures</SectionTitle>
          <span className="truncate text-xs text-app-text-muted">{vsText}</span>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-app-border bg-app-border lg:grid-cols-4">
          {figures.map((f) => <Figure key={f.label} {...f} />)}
        </div>
      </section>

      {/* 3. Needs attention: coloured so it can't be missed */}
      <section aria-labelledby="home-actions" className="space-y-3">
        <SectionTitle id="home-actions">Needs attention</SectionTitle>
        {attention.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl p-4 text-sm text-app-text" style={tint("var(--good)")}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: "var(--good)" }}><CheckCircle2 size={18} /></span>
            All clear: stock is above minimum and nobody owes money.
          </div>
        ) : (
          <Rail label="Needs attention" className="lg:grid-cols-3" narrow>
            {attention.map((a) => <AttentionCard key={a.key} item={a} onGo={can(a.tab) ? () => setActiveTab(a.tab as any) : undefined} />)}
          </Rail>
        )}
      </section>

      {/* 4. Reports */}
      <section aria-labelledby="home-reports" className="space-y-4">
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
        <Rail label="Reports" className="lg:grid-cols-3" narrow>
          <Card title="Team">
            <dl className="space-y-2.5 text-sm">
              <Row label="On shift now" value={activeShifts.toLocaleString()} />
              <Row label="Staff" value={(employees || []).length.toLocaleString()} />
              <Row label="Items per sale" value={total.orders ? (itemsSold / total.orders).toFixed(1) : "–"} />
              <Row label="New customers" value={newCustomers.toLocaleString()} />
            </dl>
          </Card>
          <Card title="Loyalty members">
            <RankedBars rows={tiers} scaleMax={Math.max(...tiers.map((t) => t.value), 1)} format={(n) => n.toLocaleString()} emptyText="No loyalty members yet" sort={false} />
          </Card>
          <Card title="Not selling">
            {stock.slowMoving.length === 0 ? (
              <p className="text-sm text-app-text-muted">Every stocked product sold this period.</p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {stock.slowMoving.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-app-text">{p.name}</span>
                    <span className="shrink-0 text-xs text-app-text-muted tabular-nums">{formatKsh(p.price * p.stock, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Rail>
        <div className="rounded-2xl border border-app-border bg-app-card p-4 sm:p-5">
          <AiAdvisory businessId={activeBusinessId} metrics={aiMetrics} fallback={aiFallback} />
        </div>
      </section>

      {viewer !== null && charts[viewer] && (
        <ChartViewer charts={charts} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} playback={playback} buckets={buckets} range={range} />
      )}
    </div>
  );
}

// ---------- Small building blocks ----------

const tint = (color: string): React.CSSProperties => ({
  background: `color-mix(in srgb, ${color} 11%, var(--app-card))`,
  border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
});

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-[17px] font-semibold tracking-tight text-app-text">{children}</h2>;
}

/**
 * Cards in a row that swipes sideways on phones (the next card peeks in so it's
 * clear there is more) and becomes a grid on wide screens.
 */
function Rail({ label, className = "", narrow, children }: { label: string; className?: string; narrow?: boolean; children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      className={`-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 scroll-px-4 no-scrollbar md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 ${className} ${
        narrow ? "[&>*]:w-[78%]" : "[&>*]:w-[86%]"
      } [&>*]:shrink-0 [&>*]:snap-start md:[&>*]:w-auto`}
    >
      {children}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-app-border bg-app-card p-4">
      <h3 className="mb-3 text-[15px] font-semibold text-app-text">{title}</h3>
      {children}
    </div>
  );
}

/** The last card stretches to fill its row, so no card sits alone with a gap beside it. */
function lastSpan(count: number) {
  const md = count % 2 === 1 ? "md:col-span-2" : "";
  const lg = count % 3 === 1 ? "lg:col-span-3" : count % 3 === 2 ? "lg:col-span-2" : "lg:col-span-1";
  return `${md} ${lg}`;
}

function Panel({ def, onOpen, playback, showSubtitle, className = "", children }: { def: ChartDef; onOpen: () => void; playback: Playback; showSubtitle?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-app-border bg-app-card p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-app-text">{def.title}</h3>
          <p className={`mt-0.5 text-xs text-app-text-muted truncate ${showSubtitle ? "" : "hidden sm:block"}`}>{def.subtitle}</p>
        </div>
        <div className="-mr-2 -mt-1.5 flex shrink-0 items-center">
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
    <div className="flex w-max items-center gap-2">
      <SeriesToggle keys={["sales", "expenses", "profit"]} visible={visible} onToggle={toggle} totals={totals} />
      <button
        type="button"
        onClick={() => setComparePrev(!comparePrev)}
        aria-pressed={comparePrev}
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs cursor-pointer ${comparePrev ? "border-app-border bg-app-bg text-app-text" : "border-dashed border-app-border text-app-text-muted"}`}
      >
        <span className="inline-block w-3 h-0.5 rounded bg-[var(--viz-muted)]" />
        Last period
      </button>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-app-text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex min-w-0 items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 shrink-0 rounded" style={{ background: i.color }} />
          <span className="truncate max-w-[9rem]">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

interface AttentionItem {
  key: string;
  icon: React.ComponentType<{ size?: number }>;
  tone: "bad" | "warn";
  count: string;
  title: string;
  detail: string;
  tab: string;
  action: string;
}

const TONE = { bad: "var(--bad)", warn: "#d97706" } as const;

function AttentionCard({ item, onGo }: { item: AttentionItem; onGo?: () => void }) {
  const Icon = item.icon;
  const color = TONE[item.tone];
  return (
    <div className="flex min-w-0 flex-col rounded-2xl p-4" style={tint(color)}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: color }} aria-hidden>
          <Icon size={19} />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-xl font-bold text-app-text tabular-nums">{item.count}</div>
          <div className="text-[13px] font-medium text-app-text">{item.title}</div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-xs text-app-text-muted">{item.detail}</p>
      {onGo && (
        <button type="button" onClick={onGo} className="mt-3 flex w-max items-center gap-0.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer" style={{ background: color }}>
          {item.action}
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

interface FigureProps {
  label: string;
  /** Shown on hover/long-press of the label. */
  hint?: string;
  value: string;
  /** Unrounded value, shown on hover when `value` is shortened. */
  full?: string;
  change: number | null;
  /** Whether a rise is good ("up") or bad ("down"). */
  polarity: "up" | "down";
  spark: number[];
  color: string;
  meaning: string;
}

function Figure({ label, hint, value, full, change, polarity, spark, color, meaning }: FigureProps) {
  const flat = change === null || Math.round(change) === 0;
  const rising = (change ?? 0) > 0;
  const good = polarity === "down" ? !rising : rising;
  const Icon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="min-w-0 bg-app-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-app-text-muted" title={hint}>{label}</span>
        <span className={`flex shrink-0 items-center gap-0.5 text-xs font-medium ${flat ? "text-app-text-muted" : good ? "text-[var(--good)]" : "text-[var(--bad)]"}`}>
          <Icon size={13} aria-hidden />
          {change === null ? "–" : formatGrowth(change)}
        </span>
      </div>
      <div className="mt-1 truncate text-[19px] font-semibold leading-tight text-app-text sm:text-[22px]" title={full}>{value}</div>
      <div className="mt-2"><Sparkline values={spark} color={color} /></div>
      <div className="mt-1.5 truncate text-[11px] text-app-text-muted" title={meaning}>{meaning}</div>
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
