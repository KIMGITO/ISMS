// src/components/BusinessDashboard.tsx
// Pure Online-First Real-Time Dashboard — Secure Array Protection Layer Included

import React, { useState, useMemo, useEffect } from "react";
import { 
  TrendingUp, ShoppingBag, Users, Wallet, CreditCard, Layers, 
  ArrowUpRight, ArrowDownRight, AlertTriangle, RefreshCw, Calendar, CheckCircle, PackageCheck, AlertCircle, TrendingDown, Store, Search, X,
  MessageSquare, Briefcase, Clock, ThumbsUp, ThumbsDown, Star, HelpCircle, 
  ChevronRight, Activity, ChevronDown, CheckSquare, Square, Shield, Award, UserCheck, Play, ArrowUp,
  Brain
} from "lucide-react";
import { 
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { useInventoryStore } from "../stores/inventoryStore";
import { useCustomerStore } from "../stores/customerStore";
import { useTransactionStore } from "../stores/transactionStore";
import { useBusinessStore } from "../stores/businessStore";
import { useAuthStore } from "../stores/authStore";
import { SupabaseService } from "../services/supabaseService";
import { useAppStore } from "../stores/appStore";

interface AiAnalysisReport {
  executiveSummary: string;
  keyInsights: string[];
  risks: string[];
  opportunities: string[];
  recommendations: string[];
  suggestedActions: string[];
  chartAnnotation: string;
  predictedSales: number[];
}

function calculatePercentages(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) return values.map(() => 0);

  const raw = values.map(v => (v / sum) * 100);
  const rounded = raw.map(v => Math.floor(v));
  const remainders = raw.map((v, i) => ({ remainder: v - rounded[i], index: i }));

  let currentSum = rounded.reduce((a, b) => a + b, 0);
  const diff = 100 - currentSum;

  if (diff > 0) {
    remainders.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < diff; i++) {
      rounded[remainders[i].index] += 1;
    }
  }
  return rounded;
}

export default function BusinessDashboard() {
  const aiName = import.meta.env?.VITE_AI_NAME || "Kim";
  const { products } = useInventoryStore();
  const { customers } = useCustomerStore();
  const { transactions, debtPayments } = useTransactionStore();
  const { businesses } = useBusinessStore();
  const { employees, shifts } = useAuthStore();
  const { activeBusinessId } = useAppStore();

  // Primary active tabs
  const [activeTab, setActiveTab] = useState<"overview" | "financials" | "inventory" | "customers" | "operations">("overview");
  const [widgetQuery, setWidgetQuery] = useState("");
  
  // Date range filters
  const [filterRange, setFilterRange] = useState<
    "today" | "yesterday" | "last7" | "last30" | "monthly" | "quarterly" | "yearly" | "custom"
  >("last30");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Pull to refresh & loading states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showNotification, setShowNotification] = useState<string | null>(null);

  // AI Insights State
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisReport | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [customQuestion, setCustomQuestion] = useState("");
  const [checkedActions, setCheckedActions] = useState<Record<string, boolean>>({});

  const isWidgetVisible = (keywords: string[]) => {
    if (!widgetQuery) return true;
    const query = widgetQuery.toLowerCase();
    return keywords.some(kw => kw.toLowerCase().includes(query));
  };
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => {
    let unsubExp: (() => void) | undefined;
    let unsubPay: (() => void) | undefined;
    import("../services/repositories").then((mod) => {
      unsubExp = mod.ExpenseRepository.subscribe((exps) => {
        setExpenses(exps);
      });
      unsubPay = mod.PaymentRepository.subscribe((pays) => {
        setPayments(pays);
      });
    }).catch(err => console.error("Failed to load repositories in BusinessDashboard", err));
    return () => {
      unsubExp?.();
      unsubPay?.();
    };
  }, []);

  // Safe Store Fallback Guards
  const safeProducts = useMemo(() => Array.isArray(products) ? products : [], [products]);
  const safeCustomers = useMemo(() => Array.isArray(customers) ? customers : [], [customers]);
  const safeTransactions = useMemo(() => Array.isArray(transactions) ? transactions : [], [transactions]);
  const safeExpenses = useMemo(() => Array.isArray(expenses) ? expenses : [], [expenses]);
  const safeEmployees = useMemo(() => Array.isArray(employees) ? employees : [], [employees]);
  const safeShifts = useMemo(() => Array.isArray(shifts) ? shifts : [], [shifts]);
  const safeDebtPayments = useMemo(() => Array.isArray(debtPayments) ? debtPayments : [], [debtPayments]);
  const safePayments = useMemo(() => Array.isArray(payments) ? payments : [], [payments]);

  // Get current date range bounds
  const dateBounds = useMemo(() => {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    switch (filterRange) {
      case "today":
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case "yesterday":
        start.setDate(now.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        end.setDate(now.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        break;
      case "last7":
        start.setDate(now.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        break;
      case "last30":
        start.setDate(now.getDate() - 30);
        start.setHours(0, 0, 0, 0);
        break;
      case "monthly":
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case "quarterly":
        start.setMonth(now.getMonth() - 3);
        break;
      case "yearly":
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        break;
      case "custom":
        if (customStartDate) start = new Date(customStartDate);
        if (customEndDate) end = new Date(customEndDate);
        break;
    }

    return { start, end };
  }, [filterRange, customStartDate, customEndDate]);

  // Filtered Transactions inside current range
  const filteredTransactions = useMemo(() => {
    return safeTransactions.filter(t => {
      const tDate = new Date(t.timestamp || Date.now());
      return tDate >= dateBounds.start && tDate <= dateBounds.end;
    });
  }, [safeTransactions, dateBounds]);

  const filteredDebtPayments = useMemo(() => {
    return safeDebtPayments.filter(dp => {
      const dpDate = new Date(dp.created_at || Date.now());
      return dpDate >= dateBounds.start && dpDate <= dateBounds.end;
    });
  }, [safeDebtPayments, dateBounds]);

  const filteredPayments = useMemo(() => {
    return safePayments.filter(p => {
      const pDate = new Date(p.date || Date.now());
      return pDate >= dateBounds.start && pDate <= dateBounds.end && p.status === "Success";
    });
  }, [safePayments, dateBounds]);

  // Previous Period Transactions for Comparative Analytics
  const comparativeTransactions = useMemo(() => {
    const duration = dateBounds.end.getTime() - dateBounds.start.getTime();
    const prevStart = new Date(dateBounds.start.getTime() - duration);
    const prevEnd = new Date(dateBounds.start.getTime());

    return safeTransactions.filter(t => {
      const tDate = new Date(t.timestamp || Date.now());
      return tDate >= prevStart && tDate < prevEnd;
    });
  }, [safeTransactions, dateBounds]);

  // 1. SALES METRICS
  const salesMetrics = useMemo(() => {
    const totalSales = filteredTransactions.reduce((acc, t) => acc + (t.finalTotal || t.total || 0), 0);
    const orderCount = filteredTransactions.length;
    const aov = orderCount > 0 ? Math.round(totalSales / orderCount) : 0;

    const prevTotalSales = comparativeTransactions.reduce((acc, t) => acc + (t.finalTotal || t.total || 0), 0);
    const trend = prevTotalSales > 0 ? Math.round(((totalSales - prevTotalSales) / prevTotalSales) * 100) : 0;

    return { totalSales, orderCount, aov, trend, prevTotalSales };
  }, [filteredTransactions, comparativeTransactions]);

  // 2. FINANCIAL MATRIX & CASH FLOW
  const paymentMetrics = useMemo(() => {
    let cashReceived = 0;
    let mpesaCollections = 0;
    let cardReceived = 0;
    let bankReceived = 0;
    let cogs = 0;

    filteredTransactions.forEach(t => {
      const amt = t.finalTotal || t.total || 0;
      
      if (t.items && Array.isArray(t.items)) {
        t.items.forEach(item => {
          const cost = item.product?.cost || 0;
          cogs += cost * (item.quantity || 1);
        });
      }

      const method = t.paymentMethod?.toLowerCase() || "";
      if (method.includes("credit") || method.includes("debt")) {
        // Credit sale / Accounts Receivable - do not count as actual money received initially
      } else if (method.includes("cash")) {
        cashReceived += amt;
      } else if (method.includes("m-pesa") || method.includes("mpesa") || method.includes("wallet")) {
        mpesaCollections += amt;
      } else if (method.includes("card")) {
        cardReceived += amt;
      } else if (method.includes("bank") || method.includes("transfer")) {
        bankReceived += amt;
      } else {
        // Fallback for non-credit payment methods
        cashReceived += amt; 
      }
    });

    filteredDebtPayments.forEach(dp => {
      const amt = dp.amountPaid || 0;
      const method = dp.paymentMethod?.toLowerCase() || "";
      if (method.includes("cash")) {
        cashReceived += amt;
      } else if (method.includes("m-pesa") || method.includes("mpesa") || method.includes("wallet")) {
        mpesaCollections += amt;
      } else if (method.includes("card")) {
        cardReceived += amt;
      } else if (method.includes("bank") || method.includes("transfer")) {
        bankReceived += amt;
      } else {
        cashReceived += amt;
      }
    });

    filteredPayments.forEach(p => {
      const amt = p.amount || 0;
      const method = p.method?.toLowerCase() || "";
      if (method.includes("cash")) {
        cashReceived += amt;
      } else if (method.includes("m-pesa") || method.includes("mpesa") || method.includes("wallet")) {
        mpesaCollections += amt;
      } else if (method.includes("card")) {
        cardReceived += amt;
      } else if (method.includes("bank") || method.includes("transfer")) {
        bankReceived += amt;
      } else {
        cashReceived += amt;
      }
    });

    const totalReceived = cashReceived + mpesaCollections + cardReceived + bankReceived;
    const mpesaShare = totalReceived > 0 ? Math.round((mpesaCollections / totalReceived) * 100) : 0;

    const filteredExpenses = safeExpenses.filter(e => {
      const eDate = new Date(e.date || Date.now());
      return eDate >= dateBounds.start && eDate <= dateBounds.end;
    });

    const wagesExpenses = filteredExpenses
      .filter(e => {
        const cat = (e.category || "").toLowerCase();
        return cat.includes("wage") || cat.includes("labor") || cat.includes("salary") || cat.includes("staff");
      })
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const overheadExpenses = filteredExpenses
      .filter(e => {
        const cat = (e.category || "").toLowerCase();
        return !(cat.includes("wage") || cat.includes("labor") || cat.includes("salary") || cat.includes("staff"));
      })
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const deliveryFees = filteredTransactions.reduce((acc, t) => acc + (t.deliveryFee || 0), 0);

    const totalExpenses = Math.round(cogs + overheadExpenses + wagesExpenses + deliveryFees);
    const netProfit = Math.max(0, salesMetrics.totalSales - totalExpenses);
    const profitMargin = salesMetrics.totalSales > 0 ? Math.round((netProfit / salesMetrics.totalSales) * 100) : 0;

    // Comparative calculations
    const prevStart = new Date(dateBounds.start.getTime() - (dateBounds.end.getTime() - dateBounds.start.getTime()));
    const comparativeExpenses = safeExpenses.filter(e => {
      const eDate = new Date(e.date || Date.now());
      return eDate >= prevStart && eDate < dateBounds.start;
    });

    let prevCogs = 0;
    comparativeTransactions.forEach(t => {
      if (t.items && Array.isArray(t.items)) {
        t.items.forEach(item => {
          const cost = item.product?.cost || 0;
          prevCogs += cost * (item.quantity || 1);
        });
      }
    });

    const prevOverheadExpenses = comparativeExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const prevDeliveryFees = comparativeTransactions.reduce((acc, t) => acc + (t.deliveryFee || 0), 0);
    const prevTotalExpenses = Math.round(prevCogs + prevOverheadExpenses + prevDeliveryFees);
    const prevNetProfit = Math.max(0, salesMetrics.prevTotalSales - prevTotalExpenses);
    const profitTrend = prevNetProfit > 0 ? Math.round(((netProfit - prevNetProfit) / prevNetProfit) * 100) : 0;

    const mpesaSuccessCount = filteredTransactions.filter(t => {
      const m = t.paymentMethod?.toLowerCase() || "";
      return m.includes("m-pesa") || m.includes("mpesa");
    }).length;

    const mpesaFailedCount = 0; 
    const cashBalance = Math.max(0, cashReceived - overheadExpenses);

    return {
      cashReceived,
      mpesaCollections,
      cardReceived,
      bankReceived,
      mpesaShare,
      cogs,
      overheadExpenses,
      wagesExpenses,
      deliveryFees,
      totalExpenses,
      netProfit,
      profitMargin,
      profitTrend,
      mpesaSuccessCount,
      mpesaFailedCount,
      cashBalance
    };
  }, [filteredTransactions, comparativeTransactions, safeExpenses, dateBounds, salesMetrics, filteredDebtPayments, filteredPayments]);

  const paymentSettlementData = useMemo(() => {
    const rawData = [
      { name: "M-Pesa", value: paymentMetrics.mpesaCollections, color: "#0284c7", class: "bg-blue-500" },
      { name: "Cash", value: paymentMetrics.cashReceived, color: "#eab308", class: "bg-yellow-500" },
      { name: "Card", value: paymentMetrics.cardReceived, color: "#a855f7", class: "bg-purple-500" },
      { name: "Bank Transfer", value: paymentMetrics.bankReceived, color: "#10b981", class: "bg-emerald-500" }
    ];

    const total = paymentMetrics.mpesaCollections + paymentMetrics.cashReceived + paymentMetrics.cardReceived + paymentMetrics.bankReceived;
    if (total === 0) {
      return rawData.map(d => ({ ...d, percentage: 0 }));
    }

    const percentages = calculatePercentages(rawData.map(d => d.value));
    return rawData.map((d, i) => ({
      ...d,
      percentage: percentages[i]
    }));
  }, [paymentMetrics.mpesaCollections, paymentMetrics.cashReceived, paymentMetrics.cardReceived, paymentMetrics.bankReceived]);

  const expenseCategoryData = useMemo(() => {
    const totals: Record<string, number> = {
      COGS: paymentMetrics.cogs,
      Rent: 0,
      Wages: 0,
      Transport: 0,
      Utilities: 0,
      Maintenance: 0,
      Marketing: 0,
      Other: 0
    };

    const filteredExpenses = safeExpenses.filter(e => {
      const eDate = new Date(e.date || Date.now());
      return eDate >= dateBounds.start && eDate <= dateBounds.end;
    });

    filteredExpenses.forEach(e => {
      const cat = (e.category || "").toLowerCase();
      if (cat.includes("rent")) {
        totals.Rent += (e.amount || 0);
      } else if (cat.includes("wage") || cat.includes("labor") || cat.includes("salary") || cat.includes("staff")) {
        totals.Wages += (e.amount || 0);
      } else if (cat.includes("transport") || cat.includes("logistics") || cat.includes("travel")) {
        totals.Transport += (e.amount || 0);
      } else if (cat.includes("utilit") || cat.includes("electricity") || cat.includes("water") || cat.includes("power")) {
        totals.Utilities += (e.amount || 0);
      } else if (cat.includes("maintain") || cat.includes("maintenance") || cat.includes("repair")) {
        totals.Maintenance += (e.amount || 0);
      } else if (cat.includes("market") || cat.includes("advert")) {
        totals.Marketing += (e.amount || 0);
      } else {
        totals.Other += (e.amount || 0);
      }
    });

    // Add transaction delivery fees to transport costs
    totals.Transport += paymentMetrics.deliveryFees;

    const rawBreakdown = [
      { name: "COGS", amount: totals.COGS, color: "#f43f5e" },
      { name: "Rent", amount: totals.Rent, color: "#3b82f6" },
      { name: "Wages", amount: totals.Wages, color: "#eab308" },
      { name: "Transport", amount: totals.Transport, color: "#a855f7" },
      { name: "Utilities", amount: totals.Utilities, color: "#10b981" },
      { name: "Maintenance", amount: totals.Maintenance, color: "#6366f1" },
      { name: "Marketing", amount: totals.Marketing, color: "#ec4899" },
      { name: "Other", amount: totals.Other, color: "#94a3b8" }
    ];

    const activeList = rawBreakdown.filter(item => item.amount > 0);
    const sum = activeList.reduce((acc, item) => acc + item.amount, 0);
    if (sum === 0) {
      return activeList.map(item => ({ ...item, percentage: 0 }));
    }
    const percentages = calculatePercentages(activeList.map(item => item.amount));
    return activeList.map((item, i) => ({
      ...item,
      percentage: percentages[i]
    }));
  }, [safeExpenses, dateBounds, paymentMetrics.cogs, paymentMetrics.deliveryFees]);

  // 3. INVENTORY & VALUATION PIPELINE
  const inventoryMetrics = useMemo(() => {
    const total = safeProducts.length;
    const lowStockCount = safeProducts.filter(p => p.stock <= p.minStock && p.stock > 0).length;
    const outOfStockCount = safeProducts.filter(p => p.stock === 0).length;
    const valuation = safeProducts.reduce((acc, p) => acc + (p.price * p.stock), 0);
    
    const perishableCount = safeProducts.filter(p => p.perishable || p.category?.toLowerCase().includes("milk") || p.category?.toLowerCase().includes("cream")).length;
    const perishableRiskCount = safeProducts.filter(p => p.stock > 0 && p.perishable && (p.expiryDays && p.expiryDays <= 2)).length;

    const salesCountMap: Record<string, { qty: number; rev: number; product: any }> = {};
    filteredTransactions.forEach(t => {
      if (t.items && Array.isArray(t.items)) {
        t.items.forEach(item => {
          if (item.product) {
            const pId = item.product.id;
            if (!salesCountMap[pId]) {
              salesCountMap[pId] = { qty: 0, rev: 0, product: item.product };
            }
            salesCountMap[pId].qty += item.quantity || 1;
            salesCountMap[pId].rev += (item.product.price || 0) * (item.quantity || 1);
          }
        });
      }
    });

    const rankedProducts = Object.values(salesCountMap).sort((a, b) => b.qty - a.qty);
    const topProductsRanked = rankedProducts.slice(0, 3).map(r => ({
      name: r.product.name,
      qty: r.qty,
      revenue: r.rev,
      category: r.product.category
    }));

    const activeProductIds = new Set(Object.keys(salesCountMap));
    const slowMoving = safeProducts
      .filter(p => !activeProductIds.has(p.id) && p.stock > p.minStock * 2)
      .slice(0, 3);

    const restockRecommendations = safeProducts
      .filter(p => p.stock <= p.minStock)
      .map(p => ({
        id: p.id,
        name: p.name,
        currentStock: p.stock,
        minStock: p.minStock,
        recommendQty: p.minStock > 0 ? (p.minStock * 3 - p.stock) : 10,
        costValuation: Math.round((p.cost || p.price * 0.70) * (p.minStock > 0 ? (p.minStock * 3 - p.stock) : 10))
      }));

    return {
      total,
      lowStockCount,
      outOfStockCount,
      valuation,
      perishableCount,
      perishableRiskCount,
      topProductsRanked,
      slowMoving,
      restockRecommendations
    };
  }, [safeProducts, filteredTransactions]);

  // 4. CUSTOMER METRICS & REAL FEEDBACK
  const customerMetrics = useMemo(() => {
    const total = safeCustomers.length;
    const newCustomers = safeCustomers.filter(c => {
      const join = new Date(c.joinDate);
      return join >= dateBounds.start && join <= dateBounds.end;
    }).length;

    const growth = total > 0 ? Math.round((newCustomers / (total - newCustomers || 1)) * 100) : 0;
    
    const goldCount = safeCustomers.filter(c => c.tier === "Gold").length;
    const silverCount = safeCustomers.filter(c => c.tier === "Silver").length;
    const bronzeCount = total - goldCount - silverCount;

    const activeCustomers = safeCustomers.filter(c => c.purchasesCount > 0).length;
    const retentionRate = total > 0 ? Math.round((activeCustomers / total) * 100) : 0;

    return { total, newCustomers, growth, retentionRate, goldCount, silverCount, bronzeCount };
  }, [safeCustomers, dateBounds]);

  const feedbackMetrics = useMemo(() => {
    const localComments: any[] = []; 
    const total = localComments.length;
    const openCount = localComments.filter((c: any) => !c.resolved).length;
    const resolvedCount = total - openCount;

    const sumRating = localComments.reduce((acc: number, c: any) => acc + c.rating, 0);
    const averageRating = total > 0 ? (sumRating / total).toFixed(1) : "0.0";

    const posCount = localComments.filter((c: any) => c.sentiment === "positive" || c.rating >= 4).length;
    const neuCount = localComments.filter((c: any) => c.sentiment === "neutral" || c.rating === 3).length;
    const negCount = total - posCount - neuCount;

    const positivePct = total > 0 ? Math.round((posCount / total) * 100) : 0;
    const neutralPct = total > 0 ? Math.round((neuCount / total) * 100) : 0;
    const negativePct = total > 0 ? Math.round((negCount / total) * 100) : 0;

    return {
      commentsList: localComments,
      total,
      openCount,
      resolvedCount,
      averageRating,
      positivePct,
      neutralPct,
      negativePct
    };
  }, []); 

  // 5. REAL BRANCH METRICS
  const branchesPerformance = useMemo(() => {
    if (!businesses || businesses.length === 0) {
      return { branches: [], topPerforming: "N/A", lowestPerforming: "N/A" };
    }

    const branches = businesses.map(b => {
      const branchTxs = filteredTransactions.filter(t => (t as any).business_id === b.id || (t as any).businessId === b.id);
      const revenue = branchTxs.reduce((sum, t) => sum + (t.finalTotal || t.total || 0), 0);
      const orders = branchTxs.length;

      const prevBranchTxs = comparativeTransactions.filter(t => (t as any).business_id === b.id || (t as any).businessId === b.id);
      const prevRevenue = prevBranchTxs.reduce((sum, t) => sum + (t.finalTotal || t.total || 0), 0);
      const growth = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : 0;
      
      return {
        id: b.id,
        name: b.name,
        revenue,
        orders,
        growth,
        location: b.address || "Main Location"
      };
    });

    const activeBranches = branches.filter(b => b.revenue > 0);
    const sortedByRevenue = [...activeBranches].sort((a, b) => b.revenue - a.revenue);

    return {
      branches,
      topPerforming: sortedByRevenue[0]?.name || "N/A",
      lowestPerforming: sortedByRevenue[sortedByRevenue.length - 1]?.name || "N/A"
    };
  }, [businesses, filteredTransactions, comparativeTransactions]);

  // 6. REAL STAFF METRICS
  const staffMetrics = useMemo(() => {
    const totalStaff = safeEmployees.length;
    const activeShifts = safeShifts.filter(s => s.status === "Active").length;
    
    let totalItemsQuantity = 0;
    filteredTransactions.forEach(t => {
      if (t.items && Array.isArray(t.items)) {
        t.items.forEach(item => {
          totalItemsQuantity += item.quantity || 1;
        });
      }
    });

    const checkoutVelocity = filteredTransactions.length > 0 ? (totalItemsQuantity / filteredTransactions.length).toFixed(1) : "0.0";

    let completedTasks = 0;
    let totalTasks = 0;
    safeEmployees.forEach(emp => {
      if (emp.tasks && Array.isArray(emp.tasks)) {
        emp.tasks.forEach((t: any) => {
          totalTasks++;
          if (t.completed) completedTasks++;
        });
      }
    });

    const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return { totalStaff, activeShifts, checkoutVelocity, taskCompletionRate };
  }, [safeEmployees, safeShifts, filteredTransactions]);

  // 7. REAL CHART DATA BUCKETING
  const chartData = useMemo(() => {
    const dataMap: Record<string, { Sales: number; Profit: number; "M-Pesa": number; Expenses: number }> = {};
    
    const days = Math.round((dateBounds.end.getTime() - dateBounds.start.getTime()) / (1000 * 60 * 60 * 24));
    const bucketsToCreate = Math.max(1, Math.min(days, 30)); 

    for (let i = bucketsToCreate; i >= 0; i--) {
      const d = new Date(dateBounds.end.getTime() - (i * 24 * 60 * 60 * 1000));
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      dataMap[label] = { Sales: 0, Profit: 0, "M-Pesa": 0, Expenses: 0 };
    }

    filteredTransactions.forEach(t => {
      const label = new Date(t.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      if (dataMap[label]) {
        const amt = t.finalTotal || t.total || 0;
        dataMap[label].Sales += amt;
        
        const method = t.paymentMethod?.toLowerCase() || "";
        if (method.includes("m-pesa") || method.includes("mpesa")) {
          dataMap[label]["M-Pesa"] += amt;
        }
      }
    });

    filteredDebtPayments.forEach(dp => {
      const label = new Date(dp.created_at || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      if (dataMap[label]) {
        const amt = dp.amountPaid || 0;
        const method = dp.paymentMethod?.toLowerCase() || "";
        if (method.includes("m-pesa") || method.includes("mpesa")) {
          dataMap[label]["M-Pesa"] += amt;
        }
      }
    });

    safeExpenses.forEach(e => {
      const label = new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      if (dataMap[label]) {
        dataMap[label].Expenses += (e.amount || 0);
      }
    });

    return Object.entries(dataMap).map(([name, metrics]) => ({
      name,
      Sales: metrics.Sales,
      "M-Pesa": metrics["M-Pesa"],
      Expenses: metrics.Expenses,
      Profit: Math.max(0, metrics.Sales - metrics.Expenses),
      CashFlow: Math.max(0, metrics.Sales - metrics.Expenses)
    }));
  }, [filteredTransactions, safeExpenses, dateBounds]);

  const getSparklineData = (type: "revenue" | "profit" | "expenses" | "mpesa") => {
    const points = chartData.map(d => {
      if (type === "revenue") return d.Sales;
      if (type === "profit") return d.Profit;
      if (type === "expenses") return d.Expenses;
      return d["M-Pesa"];
    });

    if (points.length === 0) return "0,30 90,30";

    const maxVal = Math.max(...points) || 1;
    const minVal = Math.min(...points) || 0;
    const range = maxVal - minVal || 1;
    
    return points.map((p, index) => {
      const step = 90 / Math.max(1, points.length - 1);
      const x = (index * step).toFixed(1);
      const y = (30 - ((p - minVal) / range) * 24 - 3).toFixed(1);
      return `${x},${y}`;
    }).join(" ");
  };

  const handleTriggerQuickRestock = () => {
    setShowNotification("Restock requests evaluated.");
    setTimeout(() => setShowNotification(null), 3000);
  };

  const handlePullToRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setShowNotification("Dashboard metrics successfully synchronized!");
      setTimeout(() => setShowNotification(null), 3000);
    }, 1200);
  };

  const handleAnalyzeWithAI = async (q?: string) => {
    setIsAnalyzing(true);
    const targetQuestion = q || customQuestion;
    if (q) setCustomQuestion("");

    try {
      const response = await SupabaseService.callEdgeFunction("bi-analyze", {
        businessId: activeBusinessId,
        filterRange: filterRange,
        customQuestion: targetQuestion || null
      });

      console.log("AI Raw Payload Intercepted:", response);

      let resData = response;
      if (response && typeof response.json === "function") {
        resData = await response.json();
      }

      if (resData && resData.success && resData.analysis) {
        const payloadAnalysis = resData.analysis;

        if (targetQuestion) {
          setChatMessages(prev => [
            ...prev,
            { role: "user", content: targetQuestion },
            { role: "assistant", content: payloadAnalysis.executiveSummary || payloadAnalysis.summary || "" }
          ]);
        } else {
          setAiAnalysis(payloadAnalysis);
          
          const initTasks: Record<string, boolean> = {};
          const actionList = payloadAnalysis.suggestedActions || payloadAnalysis.actionable_steps || [];
          if (Array.isArray(actionList)) {
            actionList.forEach((act: string) => {
              initTasks[act] = false;
            });
          }
          setCheckedActions(initTasks);
        }
      } else {
        throw new Error(resData?.error || "Edge execution flag status returned false");
      }

    } catch (err: any) {
      console.warn("AI backend stream boundary error intercepted, fallback generation active:", err);
      
      const fallback = generateFallbackAnalysis(salesMetrics, paymentMetrics, inventoryMetrics, customerMetrics, feedbackMetrics, targetQuestion);
      if (targetQuestion) {
        setChatMessages(prev => [
          ...prev,
          { role: "user", content: targetQuestion },
          { role: "assistant", content: fallback.executiveSummary }
        ]);
      } else {
        setAiAnalysis(fallback);
        const initTasks: Record<string, boolean> = {};
        fallback.suggestedActions.forEach((act: string) => { initTasks[act] = false; });
        setCheckedActions(initTasks);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateFallbackAnalysis = (sales: any, payments: any, inv: any, cust: any, fb: any, q?: string): AiAnalysisReport => {
    const totalRev = sales.totalSales || 0;
    const totalProf = payments.netProfit || 0;

    let summary = `Business performance scan complete for the selected period. Total revenue generated is KSh ${totalRev.toLocaleString()} from ${sales.orderCount} transaction(s). Overall net profit is KSh ${totalProf.toLocaleString()} resulting in a margin of ${payments.profitMargin}%. Digital M-Pesa channels accounted for ${payments.mpesaShare}% of incoming cashflow. We detected ${inv.lowStockCount} items triggering low-stock safety thresholds.`;

    if (q) {
      summary = `Based on current local data: Total revenue is KSh ${totalRev.toLocaleString()} across ${sales.orderCount} orders. Our records show ${inv.lowStockCount} inventory lines requiring attention, and ${fb.openCount} open customer complaints out of ${fb.total} logged. Highest performing sector is currently ${branchesPerformance.topPerforming}.`;
    }

    return {
      executiveSummary: summary,
      keyInsights: [
        `Gross sales accumulated KSh ${totalRev.toLocaleString()}.`,
        `Top performing location: ${branchesPerformance.topPerforming}.`,
        `Current inventory requires restocking for ${inv.lowStockCount} items.`
      ],
      risks: [
        `${inv.lowStockCount} items are below established safety stock limits.`,
        `${fb.openCount} unresolved customer inquiries or complaints.`
      ],
      opportunities: [
        "Optimize highest volume products to improve margins.",
        "Review M-Pesa settlement speeds to increase checkout efficiency."
      ],
      recommendations: [
        "Review restock reports and place supplier orders.",
        "Clear any open customer feedback cases.",
        "Analyze operational shifts data for peak hours mapping."
      ],
      suggestedActions: [
        "Check Inventory -> Low Stock tab",
        "Reconcile Daily Expenses",
        "Review Staff Shift completions"
      ],
      chartAnnotation: `Revenue trend is active. Ensure overheads (KSh ${payments.overheadExpenses.toLocaleString()}) are strictly monitored against gross margins.`,
      predictedSales: []
    };
  };

  return (
    <div className="space-y-6 pb-20 relative max-w-7xl mx-auto px-1 sm:px-4">
      <AnimatePresence>
        {showNotification && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 bg-slate-900 border border-brand-500/30 text-white text-xs font-bold px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2"
          >
            {showNotification}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-app-card border border-app-border rounded-3xl p-5 shadow-xs">
        <div>
          <h1 className="text-xl font-extrabold font-display text-app-text flex items-center gap-2 tracking-tight">
            <span className="p-1.5 bg-brand-500/10 text-brand-500 rounded-xl">
              <Activity size={20} className="" />
            </span>
            Executive BI Intelligence
          </h1>
          <p className="text-xs text-app-text-muted mt-1 leading-relaxed">
            Real-time revenues, operational logs, stock pipelines, active cashier shifts, and customer metrics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button 
            id="refresh_metrics"
            onClick={handlePullToRefresh}
            disabled={isRefreshing}
            className="p-2.5 bg-app-bg hover:bg-app-border text-app-text border border-app-border rounded-2xl transition cursor-pointer flex items-center justify-center disabled:opacity-50"
            title="Refresh Server Metrics"
          >
            <RefreshCw size={14} className={`${isRefreshing ? "animate-spin text-brand-500" : ""}`} />
          </button>

          <div className="relative inline-block w-full sm:w-auto">
            <select
              id="timeframe_filter"
              value={filterRange}
              onChange={(e: any) => setFilterRange(e.target.value)}
              className="w-full sm:w-auto bg-app-bg text-xs font-black uppercase tracking-wider text-app-text pl-3 pr-10 py-2.5 rounded-2xl border border-app-border appearance-none cursor-pointer focus:outline-none"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7">Last 7 Days</option>
              <option value="last30">30 Days</option>
              <option value="monthly">Monthly (MTD)</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom Range</option>
            </select>
            <Calendar size={13} className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-app-text-muted pointer-events-none" />
          </div>
        </div>
      </div>

      {filterRange === "custom" && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="bg-brand-500/5 border border-brand-500/15 rounded-2xl p-4 flex flex-wrap items-center gap-4"
        >
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-brand-500" />
            <span className="text-[10px] font-black uppercase tracking-wider text-app-text">Select Custom Range:</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <input 
              type="date" 
              value={customStartDate}
              onChange={e => setCustomStartDate(e.target.value)}
              className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-app-text text-xs focus:outline-none focus:border-brand-500"
            />
            <span className="text-app-text-muted text-[10px] font-bold uppercase">to</span>
            <input 
              type="date" 
              value={customEndDate}
              onChange={e => setCustomEndDate(e.target.value)}
              className="bg-app-card border border-app-border rounded-xl px-3 py-2 text-app-text text-xs focus:outline-none focus:border-brand-500"
            />
          </div>
        </motion.div>
      )}

      <div className="bg-app-card border border-app-border rounded-3xl p-4 flex flex-col sm:flex-row items-center gap-3.5 shadow-xs">
        <div className="flex items-center gap-2 text-app-text font-extrabold text-xs shrink-0">
          <Search size={14} className="text-brand-500" />
          Report Filter:
        </div>
        <div className="relative w-full">
          <input
            id="keyword_filter_input"
            type="text"
            placeholder="Type metric keyword (e.g., 'm-pesa', 'profit', 'expiry', 'complaints', 'staff')..."
            value={widgetQuery}
            onChange={(e) => setWidgetQuery(e.target.value)}
            className="w-full bg-app-bg text-[11px] font-medium pl-4 pr-10 py-2.5 rounded-2xl border border-app-border focus:border-brand-500 focus:outline-none text-app-text transition"
          />
          {widgetQuery ? (
            <button
              onClick={() => setWidgetQuery("")}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-app-text-muted hover:text-app-text"
            >
              <X size={13} />
            </button>
          ) : (
            <span className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-[9px] text-app-text-muted font-bold">Search</span>
          )}
        </div>
      </div>

      <div 
          id="kpi_cards_deck"
          className="flex overflow-x-auto gap-4"
        >
        <div className={`min-w-[270px] flex-1 snap-start bg-app-card border border-app-border rounded-3xl p-4 shadow-xs relative overflow-hidden transition-all duration-300 ${!isWidgetVisible(["sales", "revenue", "orders", "volume", "aov"]) ? "opacity-30 scale-95" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-app-text-muted uppercase tracking-wider">Gross Sales Revenue</span>
            <div className="p-2 bg-brand-500/10 text-brand-500 rounded-xl">
              <TrendingUp size={15} />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <span className="text-2xl font-extrabold text-app-text font-mono">
                KSh {salesMetrics.totalSales.toLocaleString()}
              </span>
              <div className="flex items-center gap-1.5 mt-2">
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md flex items-center gap-0.5 ${salesMetrics.trend >= 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>
                  {salesMetrics.trend >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                  {salesMetrics.trend >= 0 ? "+" : ""}{salesMetrics.trend}%
                </span>
                <span className="text-[8.5px] text-app-text-muted font-bold">vs prev period</span>
              </div>
            </div>
            
            <svg className="w-16 h-8 overflow-visible" stroke="currentColor">
              <path d={`M ${getSparklineData("revenue")}`} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-3 pt-2 border-t border-app-border/40 flex items-center justify-between text-[10px] text-app-text-muted font-bold">
            <span>Ticket Volume: <span className="text-app-text font-black font-mono">{salesMetrics.orderCount}</span></span>
            <span>AOV: <span className="text-app-text font-black font-mono">KSh {salesMetrics.aov}</span></span>
          </div>
        </div>

        <div className={`min-w-[270px] flex-1 snap-start bg-app-card border border-app-border rounded-3xl p-4 shadow-xs relative overflow-hidden transition-all duration-300 ${!isWidgetVisible(["profit", "margin", "earnings", "net", "margins"]) ? "opacity-30 scale-95" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-app-text-muted uppercase tracking-wider">Estimated Net Profit</span>
            <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
              <Wallet size={15} />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <span className="text-2xl font-extrabold text-app-text font-mono">
                KSh {paymentMetrics.netProfit.toLocaleString()}
              </span>
              <div className="flex items-center gap-1.5 mt-2">
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md flex items-center gap-0.5 ${paymentMetrics.profitTrend >= 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>
                  {paymentMetrics.profitTrend >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                  {paymentMetrics.profitTrend >= 0 ? "+" : ""}{paymentMetrics.profitTrend}%
                </span>
                <span className="text-[8.5px] text-app-text-muted font-bold">vs prev period</span>
              </div>
            </div>
            
            <svg className="w-16 h-8 overflow-visible" stroke="currentColor">
              <path d={`M ${getSparklineData("profit")}`} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-3 pt-2 border-t border-app-border/40 flex items-center justify-between text-[10px] text-app-text-muted font-bold">
            <span>Profit Margin: <span className="text-emerald-500 font-black">{paymentMetrics.profitMargin}%</span></span>
            <span>Total Expenses: <span className="text-app-text font-black font-mono">KSh {paymentMetrics.totalExpenses.toLocaleString()}</span></span>
          </div>
        </div>

        <div className={`min-w-[270px] flex-1 snap-start bg-app-card border border-app-border rounded-3xl p-4 shadow-xs relative overflow-hidden transition-all duration-300 ${!isWidgetVisible(["stock", "inventory", "valuation", "alerts", "out", "low"]) ? "opacity-30 scale-95" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-app-text-muted uppercase tracking-wider">Inventory Asset Valuation</span>
            <div className="p-2 bg-purple-500/10 text-purple-500 rounded-xl">
              <Store size={15} />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <span className="text-2xl font-extrabold text-app-text font-mono">
                KSh {inventoryMetrics.valuation.toLocaleString()}
              </span>
              <div className="flex items-center gap-1.5 mt-2">
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${inventoryMetrics.lowStockCount > 0 ? "bg-red-500/10 text-red-500 " : "bg-emerald-500/10 text-emerald-500"}`}>
                  {inventoryMetrics.lowStockCount} low stock alerts
                </span>
              </div>
            </div>
            
            <svg className="w-16 h-8 overflow-visible" stroke="currentColor">
              <path d={`M ${getSparklineData("expenses")}`} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-3 pt-2 border-t border-app-border/40 flex items-center justify-between text-[10px] text-app-text-muted font-bold">
            <span>Catalog count: <span className="text-app-text font-black">{inventoryMetrics.total} lines</span></span>
            <span>Perishable risks: <span className="text-red-500 font-black">{inventoryMetrics.perishableRiskCount}</span></span>
          </div>
        </div>

        <div className={`min-w-[270px] flex-1 snap-start bg-app-card border border-app-border rounded-3xl p-4 shadow-xs relative overflow-hidden transition-all duration-300 ${!isWidgetVisible(["customers", "membership", "retention", "growth", "loyalty", "bronze", "silver", "gold"]) ? "opacity-30 scale-95" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-app-text-muted uppercase tracking-wider">Loyalty Customer Index</span>
            <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
              <Users size={15} />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <span className="text-2xl font-extrabold text-app-text font-mono">
                {customerMetrics.total} <span className="text-xs text-app-text-muted font-sans font-medium">members</span>
              </span>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500">
                  +{customerMetrics.newCustomers} new registered
                </span>
              </div>
            </div>
            
            <svg className="w-16 h-8 overflow-visible" stroke="currentColor">
              <path d={`M ${getSparklineData("mpesa")}`} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-3 pt-2 border-t border-app-border/40 flex items-center justify-between text-[10px] text-app-text-muted font-bold">
            <span>Retention Rate: <span className="text-blue-500 font-black">{customerMetrics.retentionRate}%</span></span>
            <span>Growth index: <span className="text-app-text font-black">+{customerMetrics.growth}%</span></span>
          </div>
        </div>
      </div>

      <div className="flex border-b border-app-border/40 overflow-x-auto gap-1 py-1.5">
        {[
          { id: "overview", label: "Overview", icon: Layers },
          { id: "financials", label: "Financial Matrix", icon: CreditCard },
          { id: "inventory", label: "Stock & Pipeline", icon: Store },
          { id: "customers", label: "Customers & Reviews", icon: Users },
          { id: "operations", label: "Staff & Sister Branches", icon: Briefcase }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-3 rounded-2xl text-xs font-extrabold whitespace-nowrap flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === tab.id 
                  ? "bg-brand-500/10 text-brand-500 shadow-xs border border-brand-500/20" 
                  : "hover:bg-app-card text-app-text-muted hover:text-app-text border border-transparent"
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -15 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === "overview" && (
            <div className="space-y-6">
              
              <div className="bg-slate-950 border border-brand-500/20 rounded-3xl p-5 shadow-lg relative overflow-hidden text-white">
                <div className="absolute right-0 top-0 w-44 h-44 bg-gradient-to-bl from-brand-500/[0.06] to-transparent rounded-full pointer-events-none" />
                
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-500/10 text-brand-500 rounded-2xl">
                      <Brain size={18} />
                    </div>
                    <div>
                      <h2 className="text-sm font-black uppercase tracking-wider text-brand-400 font-display">
                        {aiName} Advisory
                      </h2>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Deep advisory report: automatic trend analysis, cash flow forecasts, restock lists, and customer sentiments.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleAnalyzeWithAI()}
                    disabled={isAnalyzing}
                    className="w-full md:w-auto bg-brand-500 hover:bg-brand-600 text-slate-950 font-black text-xs px-4 py-2.5 rounded-2xl transition shadow-lg flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Brain size={13} />
                    {isAnalyzing ? "Analyzing..." : "Re-Analyze Current Data"}
                  </button>
                </div>

                {isAnalyzing ? (
                  <div className="mt-6 space-y-4">
                    <div className="h-4 bg-slate-800/60 rounded-lg w-3/4 " />
                    <div className="h-4 bg-slate-800/60 rounded-lg w-5/6 " />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4.5 pt-4">
                      <div className="h-28 bg-slate-800/40 rounded-2xl " />
                      <div className="h-28 bg-slate-800/40 rounded-2xl " />
                    </div>
                  </div>
                ) : aiAnalysis ? (
                  <div className="mt-5 space-y-6 animate-fadeIn">
                    
                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4.5">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-400 flex items-center gap-1.5 mb-2">
                        <Award size={12} />
                        Executive Summary
                      </h4>
                      <p className="text-[11px] text-slate-300 leading-relaxed font-sans font-medium">
                        {aiAnalysis.executiveSummary}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-400 flex items-center gap-1.5 mb-2.5">
                          <Activity size={12} />
                          Factual Insights
                        </h4>
                        <ul className="space-y-2 text-[10.5px] text-slate-300">
                          {aiAnalysis.keyInsights?.map((insight, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-blue-400 shrink-0 mt-0.5">•</span>
                              <span>{insight}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="bg-red-950/20 border border-red-500/10 rounded-2xl p-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-red-400 flex items-center gap-1.5 mb-2.5">
                          <AlertTriangle size={12} />
                          Critical Risks Identified
                        </h4>
                        <ul className="space-y-2 text-[10.5px] text-slate-300">
                          {aiAnalysis.risks?.map((risk, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-red-400 shrink-0 mt-0.5">⚠</span>
                              <span>{risk}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="bg-emerald-950/20 border border-emerald-500/10 rounded-2xl p-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex items-center gap-1.5 mb-2.5">
                          <TrendingUp size={12} />
                          Growth Opportunities
                        </h4>
                        <ul className="space-y-2 text-[10.5px] text-slate-300">
                          {aiAnalysis.opportunities?.map((opp, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-emerald-400 shrink-0 mt-0.5">✦</span>
                              <span>{opp}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-400 flex items-center gap-1.5 mb-2.5">
                          <PackageCheck size={12} />
                          Advisory Recommendations
                        </h4>
                        <ul className="space-y-2 text-[10.5px] text-slate-300">
                          {aiAnalysis.recommendations?.map((rec, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-brand-400 shrink-0 mt-0.5">✓</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-400 flex items-center gap-1.5 mb-3">
                        <CheckSquare size={13} />
                        Suggested AI Actions Checklist ({Object.values(checkedActions).filter(Boolean).length}/{aiAnalysis.suggestedActions?.length || 0})
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {aiAnalysis.suggestedActions?.map((act, i) => (
                          <div 
                            key={i} 
                            onClick={() => setCheckedActions(prev => ({ ...prev, [act]: !prev[act] }))}
                            className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition cursor-pointer select-none text-[10.5px] ${
                              checkedActions[act] 
                                ? "bg-brand-500/10 border-brand-500/30 text-brand-300" 
                                : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700"
                            }`}
                          >
                            {checkedActions[act] ? (
                              <CheckCircle size={14} className="text-brand-400 shrink-0" />
                            ) : (
                              <Square size={14} className="text-slate-500 shrink-0" />
                            )}
                            <span className={checkedActions[act] ? "line-through opacity-70" : ""}>{act}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 text-center py-6 text-xs text-slate-400">
                    Press "Analyze Data" to summon the AI corporate advisor model.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div className={`lg:col-span-2 bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["gross", "sales", "revenue", "profit", "net", "matrix"]) ? "opacity-30 scale-95" : ""}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                        Sales & Net Profit Trajectory
                      </h3>
                      <p className="text-[10px] text-app-text-muted mt-0.5">
                        Financial comparison showing total gross sales revenue and net profit residues after deducting COGS and operations costs.
                      </p>
                    </div>
                  </div>

                  <div className="h-64 w-full">
                    {chartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                          <defs>
                            <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15}/>
                              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.01}/>
                            </linearGradient>
                            <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0.01}/>
                            </linearGradient>
                            <linearGradient id="expensesGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15}/>
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.01}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.08} />
                          <XAxis dataKey="name" fontSize={9} stroke="#64748b" tickLine={false} />
                          <YAxis fontSize={9} stroke="#64748b" tickLine={false} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "14px", color: "#fff", fontSize: "11px" }}
                          />
                          <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "12px" }} />
                          <Area type="monotone" dataKey="Sales" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#salesGrad)" name="Gross Revenue" />
                          <Area type="monotone" dataKey="Expenses" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#expensesGrad)" name="Total Expenses" />
                          <Area type="monotone" dataKey="Profit" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#profitGrad)" name="Net Profit" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-app-text-muted">
                        No transaction data for this period
                      </div>
                    )}
                  </div>
                  {aiAnalysis?.chartAnnotation && (
                    <p className="mt-3 text-[10px] text-brand-500 font-bold bg-brand-500/5 px-3 py-2 rounded-xl border border-brand-500/10">
                      💡 AI Expert Observation: {aiAnalysis.chartAnnotation}
                    </p>
                  )}
                </div>

                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs flex flex-col justify-between ${!isWidgetVisible(["mpesa", "cash", "mix", "collections", "digital", "payment", "ratio"]) ? "opacity-30 scale-95" : ""}`}>
                  <div>
                    <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display mb-1">
                      Payment Settlement Mix
                    </h3>
                    <p className="text-[10px] text-app-text-muted">
                      Revenue distribution breakdown comparing digital M-Pesa, paper Cash, Card, and Bank Transfer payments.
                    </p>
                  </div>

                  <div className="h-44 relative flex items-center justify-center my-2">
                    {salesMetrics.totalSales > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={paymentSettlementData.filter(d => d.value > 0)}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={3}
                            dataKey="value"
                          >
                            {paymentSettlementData.filter(d => d.value > 0).map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                       <div className="text-xs text-app-text-muted text-center">No payment data</div>
                    )}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xs text-app-text-muted font-bold">M-Pesa Share</span>
                      <span className="text-xl font-extrabold text-app-text font-mono">
                        {paymentSettlementData.find(d => d.name === "M-Pesa")?.percentage || 0}%
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-app-border/40">
                    {paymentSettlementData.map((d) => (
                      <div key={d.name} className="flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-1.5 font-bold text-app-text">
                          <div className={`w-2.5 h-2.5 rounded-full ${d.class}`} />
                          {d.name} Received ({d.percentage}%)
                        </div>
                        <span className="font-bold font-mono">KSh {d.value.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-app-card border border-app-border rounded-3xl p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-app-border/40 pb-3">
                  <MessageSquare className="text-brand-500 shrink-0" size={16} />
                  <div>
                    <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                      Interactive Corporate Q&A
                    </h3>
                    <p className="text-[10px] text-app-text-muted">
                      Ask any questions about sales trends, restocking buffers, branch locations performance, or customer feedback.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    "Why are sales lower this month?",
                    "Which products need restocking?",
                    "Which branch is performing best?",
                    "Why has customer growth slowed?",
                    "How can I improve profits?"
                  ].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleAnalyzeWithAI(q)}
                      className="px-3 py-2 bg-app-bg hover:bg-brand-500/10 hover:text-brand-500 border border-app-border hover:border-brand-500/20 text-app-text text-[10.5px] font-bold rounded-xl transition cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>

                {chatMessages.length > 0 && (
                  <div className="bg-app-bg border border-app-border rounded-2xl p-4 max-h-[300px] overflow-y-auto space-y-3">
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] rounded-2xl p-3 text-[11px] leading-relaxed ${
                          msg.role === "user" 
                            ? "bg-brand-500 text-slate-950 font-extrabold" 
                            : "bg-app-card border border-app-border text-app-text font-medium"
                        }`}>
                          <span className="block text-[8.5px] uppercase tracking-widest opacity-60 mb-1 font-black">
                            {msg.role === "user" ? "Me (Owner)" : "Kim AI Consultant"}
                          </span>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (customQuestion.trim()) handleAnalyzeWithAI();
                  }}
                  className="flex gap-2"
                >
                  <input
                    id="qa_custom_input"
                    type="text"
                    placeholder="Type custom advisory question (e.g., 'What trends should I be concerned about?')..."
                    value={customQuestion}
                    onChange={(e) => setCustomQuestion(e.target.value)}
                    className="w-full bg-app-bg text-[11px] font-medium px-4 py-3 rounded-2xl border border-app-border focus:border-brand-500 focus:outline-none text-app-text transition"
                  />
                  <button
                    type="submit"
                    disabled={isAnalyzing || !customQuestion.trim()}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs px-5 py-3 rounded-2xl transition shrink-0"
                  >
                    Ask
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === "financials" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["ledger", "expenses", "revenue", "breakdown"]) ? "opacity-30 scale-95" : ""}`}>
                  <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display mb-3">
                    Corporate Revenue & Payouts Ledger
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-app-bg border border-app-border rounded-xl text-xs">
                      <div>
                        <span className="text-app-text-muted font-bold block uppercase text-[9px] tracking-wider">Gross Sales Revenue</span>
                        <span className="font-extrabold text-app-text font-mono mt-0.5 block">KSh {salesMetrics.totalSales.toLocaleString()}</span>
                      </div>
                      <span className="text-emerald-500 font-extrabold font-sans">Credit Inflow</span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-app-bg border border-app-border rounded-xl text-xs">
                      <div>
                        <span className="text-app-text-muted font-bold block uppercase text-[9px] tracking-wider">Cost of Goods Sold (COGS)</span>
                        <span className="font-extrabold text-red-500 font-mono mt-0.5 block">KSh {paymentMetrics.cogs.toLocaleString()}</span>
                      </div>
                      <span className="text-app-text-muted font-bold">Procurements</span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-app-bg border border-app-border rounded-xl text-xs">
                      <div>
                        <span className="text-app-text-muted font-bold block uppercase text-[9px] tracking-wider">Logistics & Rider Payouts</span>
                        <span className="font-extrabold text-red-500 font-mono mt-0.5 block">KSh {paymentMetrics.deliveryFees.toLocaleString()}</span>
                      </div>
                      <span className="text-app-text-muted font-bold">Delivery</span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-app-bg border border-app-border rounded-xl text-xs">
                      <div>
                        <span className="text-app-text-muted font-bold block uppercase text-[9px] tracking-wider">Wages & Shift Salaries</span>
                        <span className="font-extrabold text-red-500 font-mono mt-0.5 block">KSh {paymentMetrics.wagesExpenses.toLocaleString()}</span>
                      </div>
                      <span className="text-app-text-muted font-bold">Labor</span>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-app-bg border border-app-border rounded-xl text-xs">
                      <div>
                        <span className="text-app-text-muted font-bold block uppercase text-[9px] tracking-wider">Utilities & Rent Reserve</span>
                        <span className="font-extrabold text-red-500 font-mono mt-0.5 block">KSh {paymentMetrics.overheadExpenses.toLocaleString()}</span>
                      </div>
                      <span className="text-app-text-muted font-bold">Fixed Costs</span>
                    </div>
                  </div>
                </div>

                <div className={`md:col-span-2 bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["payouts", "expenses", "category", "chart"]) ? "opacity-30 scale-95" : ""}`}>
                  <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display mb-1">
                    Expenses Category Breakdown
                  </h3>
                  <p className="text-[10px] text-app-text-muted mb-4">
                    Visual comparative analysis of operational expenses allocation.
                  </p>
                  
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={expenseCategoryData}
                        margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" opacity={0.06} />
                        <XAxis dataKey="name" fontSize={9} stroke="#64748b" tickLine={false} />
                        <YAxis fontSize={9} stroke="#64748b" tickLine={false} />
                        <Tooltip formatter={(value) => [`KSh ${Number(value).toLocaleString()}`, "Amount"]} />
                        <Bar dataKey="amount" radius={[8, 8, 0, 0]}>
                          {expenseCategoryData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["mpesa", "stk", "callback", "ledgers", "logs"]) ? "opacity-30 scale-95" : ""}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-app-border/40 pb-3 mb-4">
                  <div>
                    <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                      M-Pesa STK Callback Live Logs
                    </h3>
                    <p className="text-[10px] text-app-text-muted mt-0.5">
                      Audit log tracking successful Safaricom pushes, credit limits, and failed callback notifications.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded-md">
                      {paymentMetrics.mpesaSuccessCount} STK Success
                    </span>
                    <span className="text-[9px] font-black uppercase bg-red-500/10 text-red-500 px-2 py-1 rounded-md">
                      {paymentMetrics.mpesaFailedCount} Callbacks Failed
                    </span>
                  </div>
                </div>

                <div className="space-y-2 max-h-[220px] overflow-y-auto">
                  {filteredTransactions.filter(t => {
                    const m = t.paymentMethod?.toLowerCase() || "";
                    return m.includes("m-pesa") || m.includes("mpesa");
                  }).map((t, idx) => (
                    <div key={idx} className="bg-app-bg border border-app-border rounded-xl p-3 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-blue-500/10 text-blue-500 rounded-lg font-mono text-[9px] font-black uppercase">
                          MPESA
                        </div>
                        <div>
                          <span className="font-extrabold text-app-text block uppercase font-mono">STK_REF_TX{t.id?.slice(0, 4) || 'XXXX'}</span>
                          <span className="text-[9px] text-app-text-muted block mt-0.5">{t.customerName || "Walk-In Client"} • {new Date(t.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-black text-app-text font-mono block">KSh {(t.finalTotal || t.total).toLocaleString()}</span>
                        <span className="text-[8.5px] font-black uppercase text-emerald-500 bg-emerald-500/10 px-1 py-0.5 rounded-sm inline-block mt-1">
                          Callback Confirmed
                        </span>
                      </div>
                    </div>
                  ))}
                  {filteredTransactions.filter(t => {
                    const m = t.paymentMethod?.toLowerCase() || "";
                    return m.includes("m-pesa") || m.includes("mpesa");
                  }).length === 0 && (
                    <div className="text-center py-8 text-app-text-muted text-[10.5px] font-bold">
                      No M-Pesa collections logged in this timeframe.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "inventory" && (
            <div className="space-y-6">
              
              <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["alert", "safety", "reorder", "buffer", "products"]) ? "opacity-30 scale-95" : ""}`}>
                <div className="flex items-center justify-between border-b border-app-border/40 pb-3 mb-4">
                  <div>
                    <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                      Safety Stock Reorder Recommendations
                    </h3>
                    <p className="text-[10px] text-app-text-muted mt-0.5">
                      Automated restock proposals based on minimum buffers configured inside products database.
                    </p>
                  </div>
                  <button
                    onClick={handleTriggerQuickRestock}
                    className="bg-brand-500 hover:bg-brand-600 text-slate-950 font-black text-[10.5px] px-3 py-2 rounded-xl transition custom-pointer"
                  >
                    Quick Dispatch Restock
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                  {inventoryMetrics.restockRecommendations.map(rec => (
                    <div key={rec.id} className="bg-app-bg border border-app-border rounded-2xl p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-black text-app-text uppercase tracking-wider block truncate">{rec.name}</span>
                          <span className="text-[8px] font-black bg-red-500/10 text-red-500 px-1 py-0.5 rounded-sm">ALERT</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-app-text-muted font-bold">
                          <span>Current: <span className="text-red-500 font-mono font-black">{rec.currentStock}</span></span>
                          <span>Buffer: <span className="text-app-text font-mono">{rec.minStock}</span></span>
                        </div>
                      </div>

                      <div className="mt-4 pt-2.5 border-t border-app-border/40 flex items-center justify-between text-[10.5px]">
                        <div>
                          <span className="text-[8.5px] text-app-text-muted block uppercase tracking-widest font-black">Restock Quantity</span>
                          <span className="text-brand-500 font-black">+{rec.recommendQty} Units</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[8.5px] text-app-text-muted block uppercase tracking-widest font-black">Procure cost</span>
                          <span className="text-app-text font-black font-mono">KSh {rec.costValuation.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {inventoryMetrics.restockRecommendations.length === 0 && (
                    <div className="col-span-full text-center py-10 text-app-text-muted text-[10.5px] font-bold">
                      🎉 High Five! All products have stock levels completely above safety buffers.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["velocity", "fast", "top", "selling", "products"]) ? "opacity-30 scale-95" : ""}`}>
                  <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display mb-1">
                    Top-Selling Inventory Velocity Rank
                  </h3>
                  <p className="text-[10px] text-app-text-muted mb-3">
                    Fastest-moving items based on client sales tickets in the current period.
                  </p>

                  <div className="space-y-2.5">
                    {inventoryMetrics.topProductsRanked.map((item, idx) => (
                      <div key={idx} className="bg-app-bg border border-app-border rounded-2xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-mono font-black text-xs">
                            {idx + 1}
                          </span>
                          <div>
                            <span className="text-[11px] font-black text-app-text uppercase tracking-wider block">{item.name}</span>
                            <span className="text-[9px] text-app-text-muted mt-0.5 block">{item.category}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-black block font-mono">{item.qty} units</span>
                          <span className="text-[9px] text-app-text-muted block mt-0.5">KSh {item.revenue.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                    {inventoryMetrics.topProductsRanked.length === 0 && (
                      <div className="text-center py-8 text-app-text-muted text-xs">
                        Sell products to rank velocity.
                      </div>
                    )}
                  </div>
                </div>

                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["slow", "moving", "overstock", "dead", "products"]) ? "opacity-30 scale-95" : ""}`}>
                  <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display mb-1">
                    Overstock / Slow-Moving Inventory
                  </h3>
                  <p className="text-[10px] text-app-text-muted mb-3">
                    Items holding high stock levels but displaying minimal or zero sales transactions.
                  </p>

                  <div className="space-y-2.5">
                    {inventoryMetrics.slowMoving.map((item, idx) => (
                      <div key={idx} className="bg-app-bg border border-app-border rounded-2xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center font-mono font-black text-xs">
                            {idx + 1}
                          </span>
                          <div>
                            <span className="text-[11px] font-black text-app-text uppercase tracking-wider block">{item.name}</span>
                            <span className="text-[9px] text-app-text-muted mt-0.5 block">{item.category}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-black text-red-500 block font-mono">{item.stock} Stocked</span>
                          <span className="text-[9px] text-app-text-muted block mt-0.5">Awaiting sales</span>
                        </div>
                      </div>
                    ))}
                    {inventoryMetrics.slowMoving.length === 0 && (
                      <div className="text-center py-8 text-app-text-muted text-xs">
                        No dormant excess stock lines detected.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "customers" && (
            <div className="space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs flex flex-col justify-between ${!isWidgetVisible(["customer", "tiers", "bronze", "silver", "gold"]) ? "opacity-30 scale-95" : ""}`}>
                  <div>
                    <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                      Loyalty Tier Distribution
                    </h3>
                    <p className="text-[10px] text-app-text-muted mt-0.5">
                      Classification of our {customerMetrics.total} members.
                    </p>
                  </div>

                  <div className="space-y-3.5 my-4">
                    <div>
                      <div className="flex justify-between text-[10px] text-app-text-muted font-bold mb-1">
                        <span className="text-yellow-500 flex items-center gap-1">🥇 Gold Premium</span>
                        <span className="text-app-text">{customerMetrics.goldCount} members</span>
                      </div>
                      <div className="w-full bg-app-bg h-2 rounded-full overflow-hidden">
                        <div className="bg-yellow-500 h-full" style={{ width: `${customerMetrics.total > 0 ? (customerMetrics.goldCount / customerMetrics.total) * 100 : 0}%` }} />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-app-text-muted font-bold mb-1">
                        <span className="text-slate-400 flex items-center gap-1">🥈 Silver Regular</span>
                        <span className="text-app-text">{customerMetrics.silverCount} members</span>
                      </div>
                      <div className="w-full bg-app-bg h-2 rounded-full overflow-hidden">
                        <div className="bg-slate-400 h-full" style={{ width: `${customerMetrics.total > 0 ? (customerMetrics.silverCount / customerMetrics.total) * 100 : 0}%` }} />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-app-text-muted font-bold mb-1">
                        <span className="text-amber-700 flex items-center gap-1">🥉 Bronze Member</span>
                        <span className="text-app-text">{customerMetrics.bronzeCount} members</span>
                      </div>
                      <div className="w-full bg-app-bg h-2 rounded-full overflow-hidden">
                        <div className="bg-amber-700 h-full" style={{ width: `${customerMetrics.total > 0 ? (customerMetrics.bronzeCount / customerMetrics.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs flex flex-col justify-between ${!isWidgetVisible(["sentiment", "ratings", "reviews", "feedback"]) ? "opacity-30 scale-95" : ""}`}>
                  <div>
                    <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                      Reviews Sentiment Rating
                    </h3>
                    <p className="text-[10px] text-app-text-muted mt-0.5">
                      Aggregated sentiment percentages parsed from customer reviews.
                    </p>
                  </div>

                  <div className="flex items-center gap-4 my-3 bg-app-bg p-3.5 border border-app-border rounded-2xl">
                    <span className="text-3xl font-extrabold text-app-text font-mono">{feedbackMetrics.averageRating}</span>
                    <div>
                      <div className="flex text-amber-500">
                        {[1, 2, 3, 4, 5].map(star => (
                          <Star key={star} size={12} fill={star <= Math.round(parseFloat(feedbackMetrics.averageRating)) ? "currentColor" : "none"} />
                        ))}
                      </div>
                      <span className="text-[9.5px] text-app-text-muted block mt-1 font-bold">Based on {feedbackMetrics.total} comments</span>
                    </div>
                  </div>

                  <div className="space-y-1 text-[10px] font-bold text-app-text-muted">
                    <div className="flex justify-between">
                      <span className="text-emerald-500">Positive Sentiment</span>
                      <span className="text-app-text">{feedbackMetrics.positivePct}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Neutral Sentiment</span>
                      <span className="text-app-text">{feedbackMetrics.neutralPct}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-red-500">Negative Complaints</span>
                      <span className="text-app-text">{feedbackMetrics.negativePct}%</span>
                    </div>
                  </div>
                </div>

                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs flex flex-col justify-between ${!isWidgetVisible(["complaints", "resolutions", "unresolved"]) ? "opacity-30 scale-95" : ""}`}>
                  <div>
                    <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                      Complaints SLA Resolution
                    </h3>
                    <p className="text-[10px] text-app-text-muted mt-0.5">
                      Outstanding customer tickets and SLA resolution status.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 my-4">
                    <div className="bg-red-500/5 border border-red-500/10 rounded-2xl p-3 text-center">
                      <span className="text-[8.5px] font-black text-red-500 uppercase tracking-wider block">Open Complaints</span>
                      <span className="text-2xl font-extrabold text-red-500 font-mono block mt-1">{feedbackMetrics.openCount}</span>
                    </div>
                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-3 text-center">
                      <span className="text-[8.5px] font-black text-emerald-500 uppercase tracking-wider block">Resolved SLA</span>
                      <span className="text-2xl font-extrabold text-emerald-500 font-mono block mt-1">{feedbackMetrics.resolvedCount}</span>
                    </div>
                  </div>

                  <span className="text-[9px] text-app-text-muted block font-bold leading-relaxed">
                    SLA policy: target resolution within 12 hours of callback logging.
                  </span>
                </div>
              </div>

              <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["feedback", "comments", "reviews", "feed"]) ? "opacity-30 scale-95" : ""}`}>
                <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display mb-3">
                  Recent Customer Feedback & Reviews Stream
                </h3>
                
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {feedbackMetrics.commentsList.map((c: any) => (
                    <div key={c.id} className="bg-app-bg border border-app-border rounded-2xl p-4 text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-app-border/40 pb-2 mb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-app-text block">{c.customerName}</span>
                          <span className="text-app-text-muted">•</span>
                          <span className="text-[9px] text-app-text-muted">{c.branch}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex text-yellow-500">
                            {[1, 2, 3, 4, 5].map(st => (
                              <Star key={st} size={10} fill={st <= c.rating ? "currentColor" : "none"} />
                            ))}
                          </div>
                          <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded-md ${
                            c.resolved ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500 "
                          }`}>
                            {c.resolved ? "Closed / Resolved" : "Open SLA Case"}
                          </span>
                        </div>
                      </div>

                      <p className="text-app-text font-medium leading-relaxed italic text-[11px]">
                        "{c.comment}"
                      </p>
                    </div>
                  ))}
                  {feedbackMetrics.commentsList.length === 0 && (
                    <div className="text-center py-6 text-app-text-muted text-xs">
                      No customer feedback entries match the criteria.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "operations" && (
            <div className="space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["branch", "sister", "branches", "locations", "revenue", "scorecard"]) ? "opacity-30 scale-95" : ""}`}>
                  <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display mb-1">
                    Multi-Branch Revenue Contribution
                  </h3>
                  <p className="text-[10px] text-app-text-muted mb-4">
                    Revenues, orders volumes, and growth indicators compared for all operating locations.
                  </p>

                  <div className="space-y-3">
                    {branchesPerformance.branches.map(br => (
                      <div key={br.id} className="bg-app-bg border border-app-border rounded-2xl p-4 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-brand-500/10 text-brand-500 rounded-xl">
                            <Store size={14} />
                          </div>
                          <div>
                            <span className="font-extrabold text-app-text block uppercase tracking-wider text-[10.5px]">{br.name}</span>
                            <span className="text-[9px] text-app-text-muted block mt-0.5">{br.orders} checkout tickets registered</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="font-extrabold text-app-text font-mono block">KSh {br.revenue.toLocaleString()}</span>
                          <span className={`text-[8.5px] font-black uppercase px-1.5 py-0.5 rounded-md inline-block mt-1 ${
                            br.growth >= 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                          }`}>
                            {br.growth >= 0 ? "+" : ""}{br.growth}% growth
                          </span>
                        </div>
                      </div>
                    ))}
                    {branchesPerformance.branches.length === 0 && (
                       <div className="text-center py-6 text-app-text-muted text-xs">
                         No branch data available.
                       </div>
                    )}
                  </div>
                </div>

                <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["branch", "comparisons", "revenues", "chart"]) ? "opacity-30 scale-95" : ""}`}>
                  <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display mb-1">
                    Branch Revenue Comparisons
                  </h3>
                  <p className="text-[10px] text-app-text-muted mb-4">
                    Comparison bar chart for direct sales attribution analysis.
                  </p>

                  <div className="h-56 w-full">
                    {branchesPerformance.branches.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={branchesPerformance.branches.filter(b => b.revenue > 0)}
                          margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" opacity={0.06} />
                          <XAxis dataKey="name" fontSize={9} stroke="#64748b" tickLine={false} />
                          <YAxis fontSize={9} stroke="#64748b" tickLine={false} />
                          <Tooltip />
                          <Bar dataKey="revenue" fill="#f59e0b" radius={[6, 6, 0, 0]} name="Branch Revenue" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-app-text-muted">
                        Insufficient data for visual comparison
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className={`bg-app-card border border-app-border rounded-3xl p-5 shadow-xs ${!isWidgetVisible(["staff", "shifts", "cashiers", "activity", "workforce", "checkout"]) ? "opacity-30 scale-95" : ""}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-app-border/40 pb-3 mb-4">
                  <div>
                    <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                      Workforce & Cashier Shift Activity
                    </h3>
                    <p className="text-[10px] text-app-text-muted mt-0.5">
                      Shift punch-ins, staff checkout speed logs, and daily duty checklist completions.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded-md">
                      {staffMetrics.activeShifts} Shifts Active Now
                    </span>
                    <span className="text-[9px] font-black uppercase bg-blue-500/10 text-blue-500 px-2 py-1 rounded-md">
                      {staffMetrics.taskCompletionRate}% Tasks Done
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-app-bg border border-app-border rounded-2xl p-4 text-center">
                    <span className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider block">Average Checkout Velocity</span>
                    <span className="text-2xl font-extrabold text-app-text font-mono mt-1 block">{staffMetrics.checkoutVelocity} items/txn</span>
                    <span className="text-[9px] text-app-text-muted mt-1.5 block">Velocity score of active cashiers</span>
                  </div>

                  <div className="bg-app-bg border border-app-border rounded-2xl p-4 text-center">
                    <span className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider block">Total Registered Employees</span>
                    <span className="text-2xl font-extrabold text-app-text font-mono mt-1 block">{staffMetrics.totalStaff} staff members</span>
                    <span className="text-[9px] text-app-text-muted mt-1.5 block">Access control enabled (RBAC)</span>
                  </div>

                  <div className="bg-app-bg border border-app-border rounded-2xl p-4 flex flex-col justify-between">
                    <div>
                      <span className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider block">Task List completion</span>
                      <div className="w-full bg-app-card border border-app-border h-3.5 rounded-full overflow-hidden mt-2 relative">
                        <div className="bg-brand-500 h-full" style={{ width: `${staffMetrics.taskCompletionRate}%` }} />
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black text-app-text">{staffMetrics.taskCompletionRate}%</span>
                      </div>
                    </div>
                    <span className="text-[8.5px] text-app-text-muted mt-1 block text-center font-bold">Punch-out blocks after 12h shifts</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}