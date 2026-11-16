// src/utils/screens.ts
// Every screen, who may open it, and the words people search it by.
// Navigation, global search and the guided tour all read this, so they agree.

import { hasRolePermission } from "./permissions";

export type ScreenId =
  | "home" | "dashboard" | "sell" | "pos" | "inventory" | "sales" | "customers" | "feedback"
  | "online-store" | "deliveries" | "workers" | "permissions" | "ai" | "profile"
  | "business-management" | "money" | "prompt" | "petty-cash" | "finance" | "production" | "settings" | "notifications" | "about" | "stock-history" | "stock-transfers"
  | "suppliers" | "assets" | "audit" | "accounting" | "invoicing" | "buying";

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
  { id: "home", group: "Business", title: "Home", description: "Sales, stock and customer figures at a glance", keywords: ["dashboard", "overview", "kpi", "summary", "chart"], permissions: ["home.view"] },
  { id: "dashboard", group: "Team", title: "Shift", description: "Clock in and out, and see your shift so far", keywords: ["shift", "clock in", "clock out", "punch", "timesheet", "alarm", "reminder", "schedule"], permissions: ["dashboard.view"] },
  { id: "sell", group: "Selling", title: "Quick Sale", description: "Sell in a few taps", keywords: ["sell", "quick", "checkout", "till"], permissions: ["pos.create_sale"] },
  { id: "pos", group: "Selling", title: "POS", description: "Full checkout with cart, discounts and customers", keywords: ["point of sale", "cart", "checkout", "receipt"], permissions: ["pos.create_sale"] },
  { id: "inventory", group: "Stock", title: "Inventory", description: "Products, stock levels, categories and adjustments", keywords: ["stock", "products", "categories", "restock", "wastage"], permissions: ["inventory.view"] },
  { id: "stock-history", group: "Stock", title: "Stock History", description: "Every restock, wastage, count and production change to stock", keywords: ["audit", "adjustment", "log", "history", "restock", "damage", "wastage", "stock movement"], permissions: ["inventory.stock_history"] },
  { id: "stock-transfers", group: "Stock", title: "Stock Transfers", description: "Send stock to another branch and receive what branches send you", keywords: ["transfer", "branch", "send stock", "receive stock", "move stock", "supply", "main branch", "on the way", "ask for stock", "request stock", "shortage"], permissions: ["inventory.transfer_stock", "inventory.receive_stock", "inventory.request_transfer"] },
  { id: "suppliers", group: "Stock", title: "Suppliers & Purchases", description: "Who you buy from, what you ordered, asking for prices, and receiving it in parts", keywords: ["supplier", "suppliers", "purchase", "purchases", "purchase order", "order stock", "buy stock", "vendor", "receive", "delivery note", "lpo", "rfq", "quote", "grn"], permissions: ["suppliers.view", "purchases.view"] },
  { id: "buying", group: "Stock", title: "Buying", description: "What to reorder, approvals, supplier bills, returns to suppliers and approval limits", keywords: ["reorder", "reorder level", "suggested orders", "low stock", "approval", "approve purchase", "limit", "supplier bill", "bill", "three-way", "grn", "return to supplier", "vat on purchases", "lead time"], permissions: ["purchases.view", "purchases.create", "purchases.approve", "supplier_bills.manage"] },
  { id: "sales", group: "Selling", title: "Sales Log", description: "Past sales and receipts", keywords: ["transactions", "receipts", "orders", "history"], permissions: ["orders.view"] },
  { id: "customers", group: "Selling", title: "Loyalty", description: "Customers, points, debts and wallets", keywords: ["customers", "points", "debt", "wallet", "credit", "account number"], permissions: ["customers.view"] },
  { id: "money", group: "Money", title: "Payments & Expenses", description: "Record payments and expenses, void payments, M-Pesa till, Airtel Money, cards and which payment methods are on", keywords: ["payments", "expenses", "mpesa", "m-pesa", "airtel", "till", "void", "money", "cash", "payment methods", "switch off"], permissions: ["payments.view", "payments.cash", "payments.mpesa", "payments.airtel", "payments.verify", "payments.configure", "expenses.view", "expenses.create"] },
  { id: "prompt", group: "Money", title: "Payment Prompts", description: "Send an M-Pesa or Airtel Money prompt to a phone and watch it get paid", keywords: ["prompt", "stk", "stk push", "mpesa", "m-pesa", "airtel", "airtel money", "request payment", "ask to pay", "lipa", "push", "ussd"], permissions: ["payments.mpesa", "payments.airtel"] },
  { id: "petty-cash", group: "Money", title: "Petty Cash", description: "Record money taken from the till to spend, and see today's spending", keywords: ["petty cash", "cashbook", "spending", "spent", "till cash", "expense", "float"], permissions: ["pettycash.record"] },
  { id: "finance", group: "Money", title: "Finances", description: "Profit or loss, income, spending, debts, wallets and what points cost", keywords: ["finance", "profit", "loss", "income", "spending", "report", "accounts", "debts", "p&l", "books"], permissions: ["finance.view"] },
  { id: "accounting", group: "Money", title: "Accounting", description: "The books: profit & loss, balance sheet, journal, VAT, what customers and suppliers owe, money counts", keywords: ["accounting", "books", "ledger", "journal", "balance sheet", "trial balance", "p&l", "profit and loss", "chart of accounts", "vat", "kra", "payables", "receivables", "reconcile", "bookkeeping", "double entry", "pay supplier", "lock"], permissions: ["accounting.view"] },
  { id: "invoicing", group: "Selling", title: "Quotes & Invoices", description: "Quotes, sales orders, deliveries, invoices, payments on them, credit notes and who owes", keywords: ["quote", "quotation", "proforma", "estimate", "sales order", "order", "lpo", "delivery note", "invoice", "bill", "credit note", "refund", "return", "ageing", "aging", "overdue", "terms", "b2b", "wholesale"], permissions: ["quotes.view", "quotes.manage", "sales_orders.view", "sales_orders.manage", "invoices.view", "invoices.manage"] },
  { id: "feedback", group: "Business", title: "Feedback", description: "Customer reviews, suggestions and complaints", keywords: ["reviews", "complaints", "suggestions"], permissions: ["complaints.view"] },
  { id: "online-store", group: "Selling", title: "Online Store", description: "Website orders and customer messages", keywords: ["website", "orders", "online", "shop"], permissions: ["online_store.view"] },
  { id: "deliveries", group: "Selling", title: "Deliveries", description: "Delivery tasks for riders", keywords: ["rider", "delivery", "dispatch", "route"], permissions: ["deliveries.view"] },
  { id: "workers", group: "Team", title: "Workers", description: "Staff, invitations and schedules", keywords: ["staff", "employees", "team", "invite"], permissions: ["staff.view"] },
  { id: "permissions", group: "Team", title: "Roles", description: "What each role can see and do", keywords: ["permissions", "roles", "access", "security"], permissions: ["staff.roles"] },
  { id: "ai", group: "Business", title: "Assistant", description: "Ask questions about your business", keywords: ["ai", "assistant", "chat", "insights"], permissions: ["ai.use"] },
  { id: "production", group: "Stock", title: "Production & BOM", description: "Recipes and production batches", keywords: ["bom", "recipe", "batch", "production"], permissions: ["bom.view"] },
  { id: "assets", group: "Business", title: "Assets & Files", description: "What the business owns, and its documents", keywords: ["assets", "equipment", "fridge", "cooler", "motorbike", "files", "documents", "upload", "licence", "contract", "pdf"], permissions: ["assets.view", "assets.manage", "files.view", "files.manage"] },
  { id: "audit", group: "Team", title: "Audit Log", description: "Who changed what: products, suppliers, purchases, assets, files, PINs and roles", keywords: ["audit", "log", "history", "changes", "who changed", "activity", "security"], permissions: ["audit.view"] },
  { id: "business-management", group: "Business", title: "Business Management", description: "Branches, business details, logo and colours", keywords: ["business", "branches", "branding", "logo", "tax"], permissions: ["business.update"] },
  { id: "settings", group: "You & the app", title: "Settings", description: "Receipts, SMS, WhatsApp, backups and devices", keywords: ["settings", "sms", "whatsapp", "backup", "printer", "receipts"], permissions: ["settings.view"] },
  { id: "notifications", group: "You & the app", title: "Notifications", description: "Alerts and messages", keywords: ["alerts", "messages", "inbox"], permissions: [] },
  { id: "profile", group: "You & the app", title: "My Profile", description: "Your name, photo and password", keywords: ["profile", "password", "account", "pin"], permissions: [] },
  { id: "about", group: "You & the app", title: "About this app", description: "Version and updates", keywords: ["about", "version", "update", "check for updates"], permissions: [] },
];

export const SCREEN_BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

export function canOpenScreen(role: string | undefined, id: string): boolean {
  const screen = SCREEN_BY_ID.get(id as ScreenId);
  if (!screen || !role) return false;
  return screen.permissions.length === 0 || screen.permissions.some((code) => hasRolePermission(role, code as any));
}
