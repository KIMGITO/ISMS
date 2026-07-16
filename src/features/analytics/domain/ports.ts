// src/features/analytics/domain/ports.ts
import { Expense, ExpenseCategory, Transaction, Customer, Product, Payment } from "../../../types";
export type SQLiteRow<T> = T & { id: string };
import { ReportFilterState } from "./entities";

export interface ExpenseRepositoryPort {
  getAll(): SQLiteRow<Expense>[];
  getById(id: string): SQLiteRow<Expense> | null;
  add(expense: Omit<Expense, "created_at" | "updated_at">): Promise<SQLiteRow<Expense>>;
  update(id: string, updates: Partial<Expense>): Promise<SQLiteRow<Expense> | null>;
  delete(id: string): Promise<boolean>;
  subscribe(callback: (expenses: SQLiteRow<Expense>[]) => void): () => void;
}

export interface ExpenseCategoryRepositoryPort {
  getAll(): SQLiteRow<ExpenseCategory>[];
  getById(id: string): SQLiteRow<ExpenseCategory> | null;
  add(category: Omit<ExpenseCategory, "created_at" | "updated_at">): Promise<SQLiteRow<ExpenseCategory>>;
  update(id: string, updates: Partial<ExpenseCategory>): Promise<SQLiteRow<ExpenseCategory> | null>;
  delete(id: string): Promise<boolean>;
  subscribe(callback: (categories: SQLiteRow<ExpenseCategory>[]) => void): () => void;
}

export interface ExporterData {
  filter: ReportFilterState;
  transactions: Transaction[];
  expenses: Expense[];
  categories: ExpenseCategory[];
  customers: Customer[];
  products: Product[];
  payments?: Payment[];
  metrics: {
    totalSales: number;
    totalExpenses: number;
    netProfit: number;
    orderCount: number;
    averageOrderValue: number;
  };
  chartData: any[];
}

export interface ReportExporterPort {
  exportPDF(data: ExporterData): Promise<boolean>;
  exportCSV(data: ExporterData): Promise<boolean>;
  exportExcel(data: ExporterData): Promise<boolean>;
  print(data: ExporterData): Promise<boolean>;
  share(data: ExporterData): Promise<boolean>;
}
