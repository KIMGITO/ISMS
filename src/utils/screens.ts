// src/utils/screens.ts
// Every screen, who may open it, and the words people search it by.
// Navigation, global search and the guided tour all read this, so they agree.

import { hasRolePermission } from "./permissions";

export type ScreenId =
  | "home" | "dashboard" | "sell" | "pos" | "inventory" | "sales" | "customers" | "feedback"
  | "online-store" | "deliveries" | "workers" | "permissions" | "ai" | "profile"
  | "business-management" | "money" | "prompt" | "petty-cash" | "finance" | "production" | "settings" | "notifications" | "about" | "stock-history" | "stock-transfers" | "stock-report"
  | "suppliers" | "audit" | "accounting" | "buying" | "promotions" | "regular-orders";

export type ScreenGroup = "Selling" | "Money" | "Stock" | "Team" | "Business" | "You & the app";

/** The order groups appear in the phone's "More" sheet. */
export const SCREEN_GROUPS: ScreenGroup[] = ["Selling", "Money", "Stock", "Team", "Business", "You & the app"];

export interface AppScreen {
  id: ScreenId;
  group: ScreenGroup;
  title: string;
  description: string;
  keywords: string[];
  /** Any one of these opens the screen. Empty means everyone signed in. */
  permissions: string[];
}

export const SCREENS: AppScreen[] = [
  { id: "home", group: "Business", title: "Home", description: "Your figures at a glance", keywords: ["dashboard", "overview", "kpi", "summary", "chart"], permissions: ["home.view"] },
  { id: "dashboard", group: "Team", title: "Shift", description: "Clock in and out", keywords: ["shift", "clock in", "clock out", "punch", "timesheet", "alarm", "reminder", "schedule"], permissions: ["dashboard.view"] },
  { id: "sell", group: "Selling", title: "Quick Sale", description: "Sell in a few taps", keywords: ["sell", "quick", "checkout", "till"], permissions: ["pos.create_sale"] },
  { id: "pos", group: "Selling", title: "POS", description: "Full checkout", keywords: ["point of sale", "cart", "checkout", "receipt"], permissions: ["pos.create_sale"] },
  { id: "inventory", group: "Stock", title: "Inventory", description: "Products and stock", keywords: ["stock", "products", "categories", "restock", "wastage"], permissions: ["inventory.view"] },
  { id: "stock-history", group: "Stock", title: "Stock History", description: "Every change to stock", keywords: ["audit", "adjustment", "log", "history", "restock", "damage", "wastage", "stock movement"], permissions: ["inventory.stock_history"] },
  { id: "stock-report", group: "Stock", title: "Stock Report", description: "Daily and monthly report per product", keywords: ["report", "daily report", "monthly report", "opening", "closing", "closed", "milk report", "till", "not paid", "pending bills", "boss", "owner", "whatsapp report", "end of day"], permissions: ["reports.inventory", "reports.view", "reports.sales", "inventory.stock_history", "finance.view"] },
  { id: "stock-transfers", group: "Stock", title: "Stock Transfers", description: "Stock between branches", keywords: ["transfer", "branch", "send stock", "receive stock", "move stock", "supply", "main branch", "on the way", "ask for stock", "request stock", "shortage"], permissions: ["inventory.transfer_stock", "inventory.receive_stock", "inventory.request_transfer"] },
  { id: "buying", group: "Stock", title: "Buying", description: "Suppliers, purchases and bills", keywords: ["supplier", "suppliers", "purchase", "purchases", "purchase order", "order stock", "buy stock", "vendor", "receive", "delivery note", "lpo", "rfq", "quote", "grn", "reorder", "reorder level", "suggested orders", "low stock", "approval", "approve purchase", "limit", "supplier bill", "bill", "three-way", "return to supplier", "vat on purchases", "lead time"], permissions: ["suppliers.view", "purchases.view", "purchases.create", "purchases.approve", "supplier_bills.manage"] },
  { id: "sales", group: "Selling", title: "Sales Log", description: "Past sales and receipts", keywords: ["transactions", "receipts", "orders", "history"], permissions: ["orders.view"] },
  { id: "customers", group: "Selling", title: "Loyalty", description: "Customers, points, debts and wallets", keywords: ["customers", "points", "debt", "wallet", "credit", "account number"], permissions: ["customers.view"] },
  { id: "money", group: "Money", title: "Payments & Expenses", description: "Payments, expenses and methods", keywords: ["payments", "expenses", "mpesa", "m-pesa", "airtel", "till", "void", "money", "cash", "payment methods", "switch off"], permissions: ["payments.view", "payments.cash", "payments.mpesa", "payments.airtel", "payments.verify", "payments.configure", "expenses.view", "expenses.create"] },
  { id: "prompt", group: "Money", title: "Payment Prompts", description: "Send M-Pesa or Airtel prompts", keywords: ["prompt", "stk", "stk push", "mpesa", "m-pesa", "airtel", "airtel money", "request payment", "ask to pay", "lipa", "push", "ussd"], permissions: ["payments.mpesa", "payments.airtel"] },
  { id: "petty-cash", group: "Money", title: "Petty Cash", description: "Money taken from the till", keywords: ["petty cash", "cashbook", "spending", "spent", "till cash", "expense", "float"], permissions: ["pettycash.record"] },
  { id: "finance", group: "Money", title: "Finance & Accounting", description: "Profit, books and VAT", keywords: ["finance", "profit", "loss", "income", "spending", "report", "debts", "p&l", "accounting", "books", "ledger", "journal", "balance sheet", "trial balance", "profit and loss", "chart of accounts", "vat", "kra", "payables", "receivables", "reconcile", "bookkeeping", "double entry", "pay supplier", "lock", "wallets", "points cost"], permissions: ["finance.view", "accounting.view"] },
  { id: "feedback", group: "Business", title: "Feedback", description: "Customer reviews, suggestions and complaints", keywords: ["reviews", "complaints", "suggestions"], permissions: ["complaints.view"] },
  { id: "promotions", group: "Selling", title: "Promotions & Points", description: "Points, codes and referrals", keywords: ["points", "loyalty points", "point value", "tier", "points report", "ai", "advisor", "promotion", "promo", "promo code", "coupon", "voucher", "discount code", "offer", "campaign", "referral", "refer a friend", "invite", "reward", "buy one get one", "free product"], permissions: ["promotions.view", "promotions.manage", "referrals.view", "referrals.manage", "loyalty.view", "loyalty.configure", "customers.loyalty"] },
  { id: "online-store", group: "Selling", title: "Online Store", description: "Website orders and customer messages", keywords: ["website", "orders", "online", "shop"], permissions: ["online_store.view"] },
  { id: "regular-orders", group: "Selling", title: "Regular Orders", description: "Customers we supply on fixed days", keywords: ["schedule", "schedules", "subscription", "standing order", "regular", "weekly", "daily", "every day", "milk round", "deliver every", "tomorrow", "recurring", "repeat order"], permissions: ["customers.view", "customers.schedules", "pos.create_sale"] },
  { id: "deliveries", group: "Selling", title: "Deliveries", description: "Delivery tasks for riders", keywords: ["rider", "delivery", "dispatch", "route"], permissions: ["deliveries.view"] },
  { id: "workers", group: "Team", title: "Workers", description: "Staff, invitations and schedules", keywords: ["staff", "employees", "team", "invite"], permissions: ["staff.view"] },
  { id: "permissions", group: "Team", title: "Roles", description: "What each role can see and do", keywords: ["permissions", "roles", "access", "security"], permissions: ["staff.roles"] },
  { id: "ai", group: "Business", title: "Assistant", description: "Ask questions about your business", keywords: ["ai", "assistant", "chat", "insights"], permissions: ["ai.use"] },
  { id: "production", group: "Stock", title: "Production & BOM", description: "Recipes and production batches", keywords: ["bom", "recipe", "batch", "production"], permissions: ["bom.view"] },
  { id: "audit", group: "Team", title: "Audit Log", description: "Who changed what", keywords: ["audit", "log", "history", "changes", "who changed", "activity", "security"], permissions: ["audit.view"] },
  { id: "business-management", group: "Business", title: "Business Management", description: "Branches, business details, logo and colours", keywords: ["business", "branches", "branding", "logo", "tax"], permissions: ["business.update"] },
  { id: "settings", group: "You & the app", title: "Settings", description: "Receipts, SMS, WhatsApp, backups and devices", keywords: ["settings", "sms", "whatsapp", "backup", "printer", "receipts"], permissions: ["settings.view"] },
  { id: "notifications", group: "You & the app", title: "Notifications", description: "Alerts and messages", keywords: ["alerts", "messages", "inbox"], permissions: [] },
  { id: "profile", group: "You & the app", title: "My Profile", description: "Your name, photo and password", keywords: ["profile", "password", "account", "pin"], permissions: [] },
  { id: "about", group: "You & the app", title: "About this app", description: "Version and updates", keywords: ["about", "version", "update", "check for updates"], permissions: [] },
];

export const SCREEN_BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

/**
 * Screens that were merged into another. Opening the old id opens the new screen at the
 * matching part, so links, shortcuts, saved start screens and the tour keep working.
 */
export const SCREEN_ALIASES: Record<string, { screen: ScreenId; section: string }> = {
  accounting: { screen: "finance", section: "books" },
  suppliers: { screen: "buying", section: "suppliers" },
  // Quotes moved into POS (make) and the Sales Log (list); invoices live in Loyalty.
  invoicing: { screen: "sales", section: "quotes" },
  // Assets & Files was removed; files are added where they are used.
  assets: { screen: "home", section: "" },
};

/** The screen an id really opens (itself, or the screen it was merged into). */
export function resolveScreen(id: string): ScreenId {
  return (SCREEN_ALIASES[id]?.screen ?? id) as ScreenId;
}

export function canOpenScreen(role: string | undefined, id: string): boolean {
  const screen = SCREEN_BY_ID.get(resolveScreen(id));
  if (!screen || !role) return false;
  return screen.permissions.length === 0 || screen.permissions.some((code) => hasRolePermission(role, code as any));
}
