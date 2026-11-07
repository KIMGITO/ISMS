// src/utils/screens.ts
// Every screen, who may open it, and the words people search it by.
// Navigation, global search and the guided tour all read this, so they agree.

import { hasRolePermission } from "./permissions";

export type ScreenId =
  | "home" | "dashboard" | "sell" | "pos" | "inventory" | "sales" | "customers" | "feedback"
  | "online-store" | "deliveries" | "workers" | "permissions" | "ai" | "profile"
  | "business-management" | "money" | "production" | "settings" | "notifications" | "about";

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
  { id: "dashboard", group: "Team", title: "Shift", description: "Clock in and out, and see your shift so far", keywords: ["shift", "clock in", "clock out", "punch", "timesheet"], permissions: ["dashboard.view"] },
  { id: "sell", group: "Selling", title: "Quick Sale", description: "Sell in a few taps", keywords: ["sell", "quick", "checkout", "till"], permissions: ["pos.create_sale"] },
  { id: "pos", group: "Selling", title: "POS", description: "Full checkout with cart, discounts and customers", keywords: ["point of sale", "cart", "checkout", "receipt"], permissions: ["pos.create_sale"] },
  { id: "inventory", group: "Stock", title: "Inventory", description: "Products, stock levels, categories and adjustments", keywords: ["stock", "products", "categories", "restock", "wastage"], permissions: ["inventory.view"] },
  { id: "sales", group: "Selling", title: "Sales Log", description: "Past sales and receipts", keywords: ["transactions", "receipts", "orders", "history"], permissions: ["orders.view"] },
  { id: "customers", group: "Selling", title: "Loyalty", description: "Customers, points, debts and wallets", keywords: ["customers", "points", "debt", "wallet", "credit", "account number"], permissions: ["customers.view"] },
  { id: "money", group: "Money", title: "Payments & Expenses", description: "Record payments and expenses, void payments, M-Pesa till and prompts", keywords: ["payments", "expenses", "mpesa", "m-pesa", "till", "void", "money", "cash", "stk"], permissions: ["payments.view", "payments.cash", "payments.mpesa", "payments.verify", "expenses.view", "expenses.create"] },
  { id: "feedback", group: "Business", title: "Feedback", description: "Customer reviews, suggestions and complaints", keywords: ["reviews", "complaints", "suggestions"], permissions: ["complaints.view"] },
  { id: "online-store", group: "Selling", title: "Online Store", description: "Website orders and customer messages", keywords: ["website", "orders", "online", "shop"], permissions: ["online_store.view"] },
  { id: "deliveries", group: "Selling", title: "Deliveries", description: "Delivery tasks for riders", keywords: ["rider", "delivery", "dispatch", "route"], permissions: ["deliveries.view"] },
  { id: "workers", group: "Team", title: "Workers", description: "Staff, invitations and schedules", keywords: ["staff", "employees", "team", "invite"], permissions: ["staff.view"] },
  { id: "permissions", group: "Team", title: "Roles", description: "What each role can see and do", keywords: ["permissions", "roles", "access", "security"], permissions: ["staff.roles"] },
  { id: "ai", group: "Business", title: "Assistant", description: "Ask questions about your business", keywords: ["ai", "assistant", "chat", "insights"], permissions: ["ai.use"] },
  { id: "production", group: "Stock", title: "Production & BOM", description: "Recipes and production batches", keywords: ["bom", "recipe", "batch", "production"], permissions: ["bom.view"] },
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
