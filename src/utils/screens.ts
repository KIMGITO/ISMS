// src/utils/screens.ts
// Every screen, who may open it, and the words people search it by.
// Navigation, global search and the guided tour all read this, so they agree.

import { hasRolePermission } from "./permissions";
import { hasModule } from "../stores/planStore";

export type ScreenId =
  | "home" | "dashboard" | "sell" | "pos" | "inventory" | "sales" | "customers" | "feedback"
  | "online-store" | "website" | "deliveries" | "workers" | "permissions" | "ai" | "profile"
  | "business-management" | "money" | "prompt" | "unclaimed-payments" | "petty-cash" | "finance" | "production" | "settings" | "notifications" | "about" | "stock-history" | "stock-transfers" | "stock-report"
  | "suppliers" | "audit" | "accounting" | "buying" | "promotions" | "regular-orders" | "marketing";

// Grouped by what the business is doing, not by how the code is split (2026-11-23,
// ISMS Technical Documentation Ch 11.13). Everyday work first, administration near the end.
export type ScreenGroup =
  | "Selling" | "Customers" | "Stock" | "Buying & deliveries" | "Money" | "Reports" | "Team" | "Admin" | "You & the app";

/** The order groups appear in the sidebar and the phone's "More" sheet. */
export const SCREEN_GROUPS: ScreenGroup[] = [
  "Selling", "Customers", "Stock", "Buying & deliveries", "Money", "Reports", "Team", "Admin", "You & the app",
];

export interface AppScreen {
  id: ScreenId;
  group: ScreenGroup;
  title: string;
  description: string;
  keywords: string[];
  /** Any one of these opens the screen. Empty means everyone signed in. */
  permissions: string[];
  /**
   * Plan module the whole screen needs, when its permissions alone don't say so (the Stock
   * Report shows core data, so only the app can lock it).
   */
  module?: string;
}

export const SCREENS: AppScreen[] = [
  { id: "home", group: "Reports", title: "Home", description: "Your figures at a glance", keywords: ["dashboard", "overview", "kpi", "summary", "chart"], permissions: ["home.view"] },
  { id: "sell", group: "Selling", title: "Quick Sale", description: "Sell in a few taps", keywords: ["sell", "quick", "checkout", "till"], permissions: ["pos.create_sale"] },
  { id: "pos", group: "Selling", title: "POS", description: "Full checkout", keywords: ["point of sale", "cart", "checkout", "receipt"], permissions: ["pos.create_sale"] },
  { id: "sales", group: "Selling", title: "Sales Log", description: "Past sales and receipts", keywords: ["transactions", "receipts", "orders", "history"], permissions: ["orders.view"] },
  { id: "online-store", group: "Selling", title: "Online orders", description: "Website orders and messages", keywords: ["online store", "orders", "online", "shop", "delivery fee", "minimum order", "reviews"], permissions: ["online_store.view"], module: "online_store" },
  { id: "website", group: "Selling", title: "Website", description: "Brand, design, pages and publishing", keywords: ["website", "brand", "design", "logo", "colours", "fonts", "home page", "banner", "adverts", "pages", "menu", "seo", "search engines", "domain", "web address", "publish", "preview", "guides", "statistics"], permissions: ["business.update"], module: "online_store" },
  { id: "prompt", group: "Selling", title: "Payment Prompts", description: "Send M-Pesa or Airtel prompts", keywords: ["prompt", "stk", "stk push", "mpesa", "m-pesa", "airtel", "airtel money", "request payment", "ask to pay", "lipa", "push", "ussd"], permissions: ["payments.mpesa", "payments.airtel"] },
  { id: "unclaimed-payments", group: "Money", title: "Unclaimed Payments", description: "Till payments waiting to be linked to a sale or a customer's account", keywords: ["unclaimed", "till", "c2b", "mpesa", "paybill", "match", "claim", "credit"], permissions: ["payments.verify", "payments.mpesa"] },
  { id: "customers", group: "Customers", title: "Customers", description: "Customers, debts and wallets", keywords: ["customers", "loyalty", "members", "points", "debt", "wallet", "credit", "account number"], permissions: ["customers.view"] },
  { id: "marketing", group: "Customers", title: "Marketing", description: "Campaigns and adverts on your website", keywords: ["marketing", "advertising", "adverts", "ads", "campaign", "campaigns", "banner", "promotional banner", "announcement", "pop-up", "popup", "video", "black friday", "christmas", "flash sale", "seasonal", "launch", "canva", "creative", "media library", "schedule", "impressions", "clicks"], permissions: ["marketing.view", "marketing.manage"], module: "online_store" },
  { id: "promotions", group: "Customers", title: "Promotions & Points", description: "Points, codes and referrals", keywords: ["points", "loyalty points", "point value", "tier", "points report", "ai", "advisor", "promotion", "promo", "promo code", "coupon", "voucher", "discount code", "offer", "campaign", "referral", "refer a friend", "invite", "reward", "buy one get one", "free product"], permissions: ["promotions.view", "promotions.manage", "referrals.view", "referrals.manage", "loyalty.view", "loyalty.configure", "customers.loyalty"], module: "promotions" },
  { id: "regular-orders", group: "Customers", title: "Regular Orders", description: "Fixed-day customers", keywords: ["schedule", "schedules", "subscription", "standing order", "regular", "weekly", "daily", "every day", "deliver every", "tomorrow", "recurring", "repeat order"], permissions: ["customers.view", "customers.schedules", "pos.create_sale"], module: "regular_orders" },
  { id: "feedback", group: "Customers", title: "Feedback", description: "Reviews and complaints", keywords: ["reviews", "complaints", "suggestions"], permissions: ["complaints.view"] },
  { id: "inventory", group: "Stock", title: "Inventory", description: "Products and stock", keywords: ["stock", "products", "categories", "restock", "wastage"], permissions: ["inventory.view"] },
  { id: "stock-history", group: "Stock", title: "Stock History", description: "Every change to stock", keywords: ["audit", "adjustment", "log", "history", "restock", "damage", "wastage", "stock movement"], permissions: ["inventory.stock_history"] },
  { id: "stock-transfers", group: "Stock", title: "Stock Transfers", description: "Stock between branches", keywords: ["transfer", "branch", "send stock", "receive stock", "move stock", "supply", "main branch", "on the way", "ask for stock", "request stock", "shortage"], permissions: ["inventory.transfer_stock", "inventory.receive_stock", "inventory.request_transfer"], module: "transfers" },
  { id: "production", group: "Stock", title: "Production & BOM", description: "Recipes and production batches", keywords: ["bom", "recipe", "batch", "production"], permissions: ["bom.view"], module: "production" },
  { id: "buying", group: "Buying & deliveries", title: "Buying", description: "Suppliers, purchases and bills", keywords: ["supplier", "suppliers", "purchase", "purchases", "purchase order", "order stock", "buy stock", "vendor", "receive", "delivery note", "lpo", "rfq", "quote", "grn", "reorder", "reorder level", "suggested orders", "low stock", "approval", "approve purchase", "limit", "supplier bill", "bill", "three-way", "return to supplier", "vat on purchases", "lead time"], permissions: ["suppliers.view", "purchases.view", "purchases.create", "purchases.approve", "supplier_bills.manage"], module: "buying" },
  { id: "deliveries", group: "Buying & deliveries", title: "Deliveries", description: "Riders, trips and areas", keywords: ["rider", "delivery", "dispatch", "route"], permissions: ["deliveries.view"], module: "deliveries" },
  { id: "money", group: "Money", title: "Payments & Expenses", description: "Payments, expenses and methods", keywords: ["payments", "expenses", "mpesa", "m-pesa", "airtel", "till", "void", "money", "cash", "payment methods", "switch off"], permissions: ["payments.view", "payments.cash", "payments.mpesa", "payments.airtel", "payments.verify", "payments.configure", "expenses.view", "expenses.create"] },
  { id: "petty-cash", group: "Money", title: "Petty Cash", description: "Money taken from the till", keywords: ["petty cash", "cashbook", "spending", "spent", "till cash", "expense", "float"], permissions: ["pettycash.record"] },
  { id: "finance", group: "Money", title: "Finance & Accounting", description: "Profit, books and VAT", keywords: ["finance", "profit", "loss", "income", "spending", "report", "debts", "p&l", "accounting", "books", "ledger", "journal", "balance sheet", "trial balance", "profit and loss", "chart of accounts", "vat", "kra", "payables", "receivables", "reconcile", "bookkeeping", "double entry", "pay supplier", "lock", "wallets", "points cost"], permissions: ["finance.view", "accounting.view"] },
  { id: "stock-report", group: "Reports", title: "Stock Report", description: "Daily and monthly report per product", keywords: ["report", "daily report", "monthly report", "opening", "closing", "closed", "till", "not paid", "pending bills", "boss", "owner", "whatsapp report", "end of day"], permissions: ["reports.inventory", "reports.view", "reports.sales", "inventory.stock_history", "finance.view"], module: "stock_report" },
  { id: "dashboard", group: "Team", title: "Shift", description: "Clock in and out", keywords: ["shift", "clock in", "clock out", "punch", "timesheet", "alarm", "reminder", "schedule"], permissions: ["dashboard.view"] },
  { id: "workers", group: "Team", title: "Workers", description: "Staff, invitations and schedules", keywords: ["staff", "employees", "team", "invite"], permissions: ["staff.view"] },
  { id: "permissions", group: "Admin", title: "Roles", description: "What each role can see and do", keywords: ["permissions", "roles", "access", "security"], permissions: ["staff.roles"] },
  { id: "audit", group: "Admin", title: "Audit Log", description: "Who changed what", keywords: ["audit", "log", "history", "changes", "who changed", "activity", "security"], permissions: ["audit.view"] },
  { id: "business-management", group: "Admin", title: "Business Management", description: "Branches, details and logo", keywords: ["business", "branches", "branding", "logo", "tax"], permissions: ["business.update"] },
  { id: "settings", group: "Admin", title: "Settings", description: "Receipts, messages, backups", keywords: ["settings", "sms", "whatsapp", "backup", "printer", "receipts"], permissions: ["settings.view"] },
  { id: "ai", group: "You & the app", title: "Assistant", description: "Ask about your business", keywords: ["ai", "assistant", "chat", "insights"], permissions: ["ai.use"], module: "ai" },
  { id: "notifications", group: "You & the app", title: "Notifications", description: "Alerts and messages", keywords: ["alerts", "messages", "inbox"], permissions: [] },
  { id: "profile", group: "You & the app", title: "My Profile", description: "Your details, PIN, sign out", keywords: ["profile", "password", "account", "pin"], permissions: [] },
  { id: "about", group: "You & the app", title: "About this app", description: "Version and updates", keywords: ["about", "version", "update", "check for updates"], permissions: [] },
];

export const SCREEN_BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

/** Sort key for menus: the screen's group, then its place in SCREENS. Unknown ids go last. */
export function screenOrder(id: string): number {
  const i = SCREENS.findIndex((s) => s.id === id);
  if (i < 0) return Number.MAX_SAFE_INTEGER;
  return SCREEN_GROUPS.indexOf(SCREENS[i].group) * 1000 + i;
}

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
  if (!hasModule(screen.module)) return false;
  return screen.permissions.length === 0 || screen.permissions.some((code) => hasRolePermission(role, code as any));
}
