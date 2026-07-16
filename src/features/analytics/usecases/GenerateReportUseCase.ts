// src/features/analytics/usecases/GenerateReportUseCase.ts
import { Transaction, Expense, ExpenseCategory, Product, Customer, Employee } from "../../../types";
import { ReportFilterState } from "../domain/entities";

export class GenerateReportUseCase {
  public static execute(
    transactions: Transaction[],
    expenses: Expense[],
    categories: ExpenseCategory[],
    products: Product[],
    customers: Customer[],
    employees: Employee[],
    filter: ReportFilterState,
    dateBounds: { start: Date; end: Date }
  ) {
    // 1. Filter transactions
    const filteredTxs = transactions.filter(t => {
      // Date bounds filter
      const tDate = new Date(t.timestamp || Date.now());
      if (tDate < dateBounds.start || tDate > dateBounds.end) {
        return false;
      }

      // Cashier filter
      if (filter.cashierId && filter.cashierId !== "All" && t.staffId !== filter.cashierId) {
        return false;
      }

      // Payment method filter
      if (filter.paymentMethod && filter.paymentMethod !== "All") {
        const canonical = filter.paymentMethod.toLowerCase();
        const tMethod = (t.paymentMethod || "Cash").toLowerCase();
        if (canonical === "credit") {
          if (tMethod !== "credit" && tMethod !== "credit_debt") return false;
        } else if (canonical === "m-pesa") {
          if (tMethod !== "m-pesa" && tMethod !== "mpesa" && tMethod !== "mobile_wallet") return false;
        } else {
          if (tMethod !== canonical) return false;
        }
      }

      // Customer filter
      if (filter.customerId && filter.customerId !== "All" && t.customerId !== filter.customerId) {
        return false;
      }

      // Product and Category filters
      if ((filter.productId && filter.productId !== "All") || (filter.category && filter.category !== "All")) {
        const hasMatchingItem = t.items?.some(item => {
          if (filter.productId && filter.productId !== "All" && item.product?.id !== filter.productId) {
            return false;
          }
          if (filter.category && filter.category !== "All" && item.product?.category?.toLowerCase() !== filter.category.toLowerCase()) {
            return false;
          }
          return true;
        });
        if (!hasMatchingItem) return false;
      }

      // Role filter (find employee role)
      if (filter.role && filter.role !== "All") {
        const staff = employees.find(e => e.id === t.staffId);
        if (!staff || staff.role !== filter.role) {
          return false;
        }
      }

      // Search Query filter
      if (filter.searchQuery.trim()) {
        const q = filter.searchQuery.toLowerCase();
        const matchesSearch = 
          t.id.toLowerCase().includes(q) ||
          (t.customerName && t.customerName.toLowerCase().includes(q)) ||
          t.staffName.toLowerCase().includes(q) ||
          (t.note && t.note.toLowerCase().includes(q)) ||
          t.items?.some(item => item.product?.name.toLowerCase().includes(q));
        if (!matchesSearch) return false;
      }

      return true;
    });

    // 2. Filter expenses
    const filteredExpenses = expenses.filter(e => {
      // Date bounds filter
      const eDate = new Date(e.date);
      if (eDate < dateBounds.start || eDate > dateBounds.end) {
        return false;
      }

      // Expense category filter
      if (filter.expenseCategory && filter.expenseCategory !== "All" && e.category.toLowerCase() !== filter.expenseCategory.toLowerCase()) {
        return false;
      }

      // Cashier/Staff filter (matching staffName or staffId if available)
      if (filter.cashierId && filter.cashierId !== "All") {
        const cashier = employees.find(emp => emp.id === filter.cashierId);
        if (cashier && e.staffName.toLowerCase() !== cashier.name.toLowerCase()) {
          return false;
        }
      }

      // Search Query filter
      if (filter.searchQuery.trim()) {
        const q = filter.searchQuery.toLowerCase();
        const matchesSearch = 
          e.category.toLowerCase().includes(q) ||
          (e.description && e.description.toLowerCase().includes(q)) ||
          e.staffName.toLowerCase().includes(q) ||
          e.amount.toString().includes(q);
        if (!matchesSearch) return false;
      }

      return true;
    });

    return {
      transactions: filteredTxs,
      expenses: filteredExpenses
    };
  }
}
