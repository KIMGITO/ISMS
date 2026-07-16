// src/features/analytics/domain/entities.ts
import { PaymentMethod } from "../../../types";

export interface ReportFilterState {
  searchQuery: string;
  timeframe: "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "customDate" | "customPeriod";
  customStartDate?: string;
  customEndDate?: string;
  customPeriodMonthYear?: string; // YYYY-MM
  productId?: string;
  category?: string;
  customerId?: string;
  cashierId?: string;
  paymentMethod?: PaymentMethod | "All";
  expenseCategory?: string;
  role?: string;
}

export interface BIChartDataPoint {
  label: string;
  sales: number;
  expenses: number;
  profits: number;
  cash: number;
  mpesa: number;
  bank: number;
  credit: number;
  other: number;
  [key: string]: number | string;
}

export interface AnalyticsOverviewMetrics {
  totalSales: number;
  orderCount: number;
  averageOrderValue: number;
  salesTrendPercentage: number;
  
  totalExpenses: number;
  expensesTrendPercentage: number;
  
  netProfit: number;
  profitMargin: number;
  profitTrendPercentage: number;
  
  paymentMethodDistribution: {
    cash: number;
    mpesa: number;
    bank: number;
    credit: number;
    other: number;
  };
  
  lowStockAlertsCount: number;
  inventoryValuation: number;
  
  customersCount: number;
  newCustomersCount: number;
  customerGrowthPercentage: number;
  retentionRatePercentage: number;
}
