// src/features/analytics/usecases/CalculateAnalyticsUseCase.ts
import { Transaction, Expense, ExpenseCategory, Product, Customer } from "../../../types";
import { BIChartDataPoint, AnalyticsOverviewMetrics } from "../domain/entities";

export class CalculateAnalyticsUseCase {
  public static execute(
    transactions: Transaction[],
    expenses: Expense[],
    categories: ExpenseCategory[],
    products: Product[],
    customers: Customer[],
    timeframe: "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "customDate" | "customPeriod",
    dateBounds: { start: Date; end: Date },
    prevDateBounds: { start: Date; end: Date },
    debtPayments: any[] = []
  ) {
    // 1. Filter current and comparative transactions
    const filteredTxs = transactions.filter(t => {
      const d = new Date(t.timestamp || Date.now());
      return d >= dateBounds.start && d <= dateBounds.end;
    });

    const prevTxs = transactions.filter(t => {
      const d = new Date(t.timestamp || Date.now());
      return d >= prevDateBounds.start && d <= prevDateBounds.end;
    });

    // Filter debt payments
    const filteredDebtPayments = debtPayments.filter(dp => {
      const ts = dp.created_at || dp.date || Date.now();
      const d = new Date(ts);
      return d >= dateBounds.start && d <= dateBounds.end;
    });

    // 2. Filter current and comparative expenses
    const filteredExpenses = expenses.filter(e => {
      const d = new Date(e.date);
      return d >= dateBounds.start && d <= dateBounds.end;
    });

    const prevExpenses = expenses.filter(e => {
      const d = new Date(e.date);
      return d >= prevDateBounds.start && d <= prevDateBounds.end;
    });

    // 3. Sales calculations
    const totalSales = filteredTxs.reduce((sum, t) => sum + (t.finalTotal || t.total || 0), 0);
    const orderCount = filteredTxs.length;
    const averageOrderValue = orderCount > 0 ? Math.round(totalSales / orderCount) : 0;

    const prevTotalSales = prevTxs.reduce((sum, t) => sum + (t.finalTotal || t.total || 0), 0);
    const salesTrendPercentage = prevTotalSales > 0 ? Math.round(((totalSales - prevTotalSales) / prevTotalSales) * 100) : 0;

    // 4. Expenses calculations
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
    const prevTotalExpenses = prevExpenses.reduce((sum, e) => sum + e.amount, 0);
    const expensesTrendPercentage = prevTotalExpenses > 0 ? Math.round(((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100) : 0;

    // 5. Profit calculations
    const netProfit = totalSales - totalExpenses;
    const profitMargin = totalSales > 0 ? Math.round((netProfit / totalSales) * 100) : 0;
    
    const prevNetProfit = prevTotalSales - prevTotalExpenses;
    const profitTrendPercentage = prevNetProfit > 0 ? Math.round(((netProfit - prevNetProfit) / prevNetProfit) * 100) : 0;

    // 6. Payment method distribution (treating credit/debt as Accounts Receivable, cash flow counts settled cash/mpesa)
    let cash = 0;
    let mpesa = 0;
    let bank = 0;
    let credit = 0;
    let other = 0;

    filteredTxs.forEach(t => {
      const amount = t.finalTotal || t.total || 0;
      const method = (t.paymentMethod || "Cash").toLowerCase();

      if (method.includes("credit") || method.includes("debt")) {
        credit += amount;
      } else if (method === "cash") {
        cash += amount;
      } else if (method === "m-pesa" || method === "mpesa" || method === "mobile_wallet") {
        mpesa += amount;
      } else if (method === "bank") {
        bank += amount;
      } else if (method === "card") {
        bank += amount; // map Card to Bank or list separately if needed, let's keep it under bank/card
      } else {
        cash += amount;
      }
    });

    filteredDebtPayments.forEach(dp => {
      const amount = dp.amountPaid || 0;
      const method = (dp.paymentMethod || "Cash").toLowerCase();

      if (method === "cash") {
        cash += amount;
      } else if (method === "m-pesa" || method === "mpesa" || method === "mobile_wallet") {
        mpesa += amount;
      } else {
        cash += amount;
      }
    });

    const paymentMethodDistribution = { cash, mpesa, bank, credit, other };

    // 7. Inventory calculations
    const lowStockAlertsCount = products.filter(p => p.stock <= p.minStock && p.stock > 0).length;
    const inventoryValuation = products.reduce((sum, p) => sum + (p.price * p.stock), 0);

    // 8. Customer calculations
    const customersCount = customers.length;
    const newCustomers = customers.filter(c => {
      const join = new Date(c.joinDate);
      return join >= dateBounds.start && join <= dateBounds.end;
    }).length;
    const customerGrowthPercentage = customersCount > 0 ? Math.round((newCustomers / (customersCount - newCustomers || 1)) * 100) : 0;

    const activeCustomers = customers.filter(c => c.purchasesCount > 0).length;
    const retentionRatePercentage = customersCount > 0 ? Math.round((activeCustomers / customersCount) * 100) : 0;

    // 9. Generate date intervals for charts
    const chartData = this.generateChartData(filteredTxs, filteredExpenses, filteredDebtPayments, dateBounds, timeframe);

    // 10. Expenses categories breakdown (ensure unused categories have value 0)
    const activeCategories = categories.filter(c => c.status === "Enabled");
    const categoryTotals: Record<string, number> = {};
    
    // Set 0 default for all enabled categories
    activeCategories.forEach(cat => {
      categoryTotals[cat.name] = 0;
    });

    // Populate actuals
    filteredExpenses.forEach(exp => {
      const matchedCat = activeCategories.find(c => c.name.toLowerCase() === exp.category.toLowerCase());
      if (matchedCat) {
        categoryTotals[matchedCat.name] = (categoryTotals[matchedCat.name] || 0) + exp.amount;
      } else {
        categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + exp.amount;
      }
    });

    const expenseCategoryBreakdown = Object.entries(categoryTotals).map(([name, amount]) => ({
      name,
      amount,
      color: this.getCategoryColor(name)
    }));

    return {
      overview: {
        totalSales,
        orderCount,
        averageOrderValue,
        salesTrendPercentage,
        totalExpenses,
        expensesTrendPercentage,
        netProfit,
        profitMargin,
        profitTrendPercentage,
        paymentMethodDistribution,
        lowStockAlertsCount,
        inventoryValuation,
        customersCount,
        newCustomersCount: newCustomers,
        customerGrowthPercentage,
        retentionRatePercentage
      } as AnalyticsOverviewMetrics,
      chartData,
      expenseCategoryBreakdown,
      filteredTxs,
      filteredExpenses
    };
  }

  private static generateChartData(
    txs: Transaction[],
    exps: Expense[],
    debtPays: any[],
    bounds: { start: Date; end: Date },
    timeframe: string
  ): BIChartDataPoint[] {
    const dataList: BIChartDataPoint[] = [];
    const duration = bounds.end.getTime() - bounds.start.getTime();
    
    // Choose interval size: 7 ticks for dashboard smoothness
    const intervals = 7;
    const step = duration / intervals;

    for (let i = 0; i < intervals; i++) {
      const tickStart = new Date(bounds.start.getTime() + (i * step));
      const tickEnd = new Date(bounds.start.getTime() + ((i + 1) * step));
      
      const label = tickStart.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(timeframe === "today" || timeframe === "yesterday" ? { hour: "numeric", minute: "2-digit" } : {})
      });

      // Filter events in this bucket
      const bucketTxs = txs.filter(t => {
        const d = new Date(t.timestamp || Date.now());
        return d >= tickStart && d < tickEnd;
      });

      const bucketExps = exps.filter(e => {
        const d = new Date(e.date);
        return d >= tickStart && d < tickEnd;
      });

      const bucketDebtPays = debtPays.filter(dp => {
        const ts = dp.created_at || dp.date || Date.now();
        const d = new Date(ts);
        return d >= tickStart && d < tickEnd;
      });

      let sales = 0;
      let cash = 0;
      let mpesa = 0;
      let bank = 0;
      let credit = 0;
      let other = 0;

      bucketTxs.forEach(t => {
        const val = t.finalTotal || t.total || 0;
        sales += val;
        const method = (t.paymentMethod || "Cash").toLowerCase();

        if (method.includes("credit") || method.includes("debt")) {
          credit += val;
        } else if (method === "cash") {
          cash += val;
        } else if (method === "m-pesa" || method === "mpesa" || method === "mobile_wallet") {
          mpesa += val;
        } else if (method === "bank") {
          bank += val;
        } else if (method === "card") {
          bank += val;
        } else {
          cash += val;
        }
      });

      bucketDebtPays.forEach(dp => {
        const val = dp.amountPaid || 0;
        const method = (dp.paymentMethod || "Cash").toLowerCase();

        if (method === "cash") {
          cash += val;
        } else if (method === "m-pesa" || method === "mpesa" || method === "mobile_wallet") {
          mpesa += val;
        } else {
          cash += val;
        }
      });

      const expenses = bucketExps.reduce((sum, e) => sum + e.amount, 0);
      const profits = sales - expenses;

      dataList.push({
        label,
        sales,
        expenses,
        profits,
        cash,
        mpesa,
        bank,
        credit,
        other
      });
    }

    return dataList;
  }

  private static getCategoryColor(name: string): string {
    const hash = name.split("").reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
    const colors = [
      "#ef4444", "#3b82f6", "#10b981", "#eab308", "#a855f7", 
      "#ec4899", "#f97316", "#14b8a6", "#6366f1", "#84cc16"
    ];
    return colors[Math.abs(hash) % colors.length];
  }
}
