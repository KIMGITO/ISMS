// src/utils/shortcuts.ts
// Every keyboard shortcut in the app, and the newer features people search for.
// The key handler, the "?" help, About → Keyboard shortcuts and global search all read
// these lists, and each person only sees what their role can open and do.

import { hasRolePermission } from "./permissions";
import { SCREENS, SCREEN_BY_ID, canOpenScreen, type ScreenId } from "./screens";

export type ShortcutScope = ScreenId | "everywhere";

export interface Shortcut {
  id: string;
  /** Keys as shown, e.g. "Ctrl+K", "G then H", "F1". */
  keys: string;
  action: string;
  scope: ShortcutScope;
  /** Any one of these lets the person use it. Empty means anyone who can open the screen. */
  permissions: string[];
  /**
   * For page actions run by the global handler: the single key (lower case) and the
   * `data-shortcut` name of the button it presses. A button the role can't see isn't
   * on the page, so its shortcut does nothing.
   */
  key?: string;
  target?: string;
  keywords?: string[];
}

/** The second key after G that opens each screen. */
export const GO_TO_KEYS: Record<ScreenId, string> = {
  home: "h",
  dashboard: "j",
  sell: "s",
  pos: "p",
  inventory: "i",
  "stock-history": "k",
  sales: "l",
  customers: "c",
  money: "m",
  "petty-cash": "x",
  finance: "y",
  feedback: "f",
  "online-store": "o",
  deliveries: "d",
  workers: "w",
  permissions: "r",
  ai: "a",
  production: "b",
  "business-management": "e",
  settings: "t",
  notifications: "n",
  profile: "u",
  about: "v",
};

const everywhere: Shortcut[] = [
  { id: "search", keys: "Ctrl+K", action: "Search the app", scope: "everywhere", permissions: [], keywords: ["find", "global search"] },
  { id: "help", keys: "?", action: "Show the shortcuts for this screen", scope: "everywhere", permissions: [], keywords: ["help", "keys"] },
  { id: "page-search", keys: "/", action: "Jump to this screen's search box", scope: "everywhere", permissions: [], keywords: ["find", "filter"] },
  { id: "tab-prev", keys: "[", action: "Previous tab on this screen", scope: "everywhere", permissions: [] },
  { id: "tab-next", keys: "]", action: "Next tab on this screen", scope: "everywhere", permissions: [] },
  { id: "close", keys: "Esc", action: "Close a window or clear a search", scope: "everywhere", permissions: [] },
];

const goTo: Shortcut[] = SCREENS.map((screen) => ({
  id: `go-${screen.id}`,
  keys: `G then ${GO_TO_KEYS[screen.id].toUpperCase()}`,
  action: `Open ${screen.title}`,
  scope: "everywhere" as const,
  // Only screens this role can open are listed, and only those keys work.
  permissions: screen.permissions,
  keywords: ["go to", "navigate", screen.title.toLowerCase(), ...screen.keywords],
}));

const pages: Shortcut[] = [
  // Quick Sale
  { id: "sell-cash", keys: "F1", action: "Paid by cash", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-mpesa", keys: "F2", action: "Paid by M-Pesa", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-card", keys: "F3", action: "Paid by card", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-customer", keys: "F7", action: "Add a customer to the last sale (they get the points)", scope: "sell", permissions: ["pos.create_sale"], keywords: ["attach", "loyalty", "points", "walk-in"] },
  { id: "sell-receipt", keys: "F8", action: "Receipt for the last sale", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-scan", keys: "Enter", action: "Add the scanned or highlighted product", scope: "sell", permissions: ["pos.create_sale"], keywords: ["barcode"] },
  { id: "sell-move", keys: "↑ ↓", action: "Move through the products", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-qty", keys: "+ −", action: "One more / one less of the last item", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-clear", keys: "Esc", action: "Clear the search, then the sale", scope: "sell", permissions: ["pos.create_sale"] },

  // POS
  { id: "pos-search", keys: "F2 /", action: "Search products", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-pick", keys: "↑ ↓ Enter", action: "Pick a product from the search", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-category", keys: "Alt+← Alt+→", action: "Previous / next category", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-qty", keys: "+ −", action: "One more / one less of the last item", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-remove", keys: "Delete", action: "Remove the last item", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-clear", keys: "Ctrl+Delete", action: "Empty the cart", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-cart", keys: "F4", action: "Show / hide the cart (phone layout)", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-cash", keys: "Alt+1", action: "Pay by cash", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-mpesa", keys: "Alt+2", action: "Pay by M-Pesa", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-credit", keys: "Alt+3", action: "Sell on credit", scope: "pos", permissions: ["customers.debts", "pos.create_sale"] },
  { id: "pos-customer", keys: "Alt+C", action: "Choose a customer", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-delivery", keys: "Alt+D", action: "Delivery on / off", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-note", keys: "Alt+N", action: "Add a note", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-complete", keys: "F9 Ctrl+Enter", action: "Complete the sale", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-receipt", keys: "R", action: "Receipt (after a sale)", scope: "pos", permissions: ["pos.create_sale"] },

  // Receipts (open from Quick Sale, POS or the Sales Log)
  { id: "receipt-print", keys: "P Ctrl+P", action: "Print the receipt", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-whatsapp", keys: "W", action: "Send the receipt on WhatsApp", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-email", keys: "E", action: "Email the receipt", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-pdf", keys: "D", action: "Save the receipt as PDF", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-copy", keys: "C", action: "Copy the receipt text", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-barcode", keys: "B", action: "Barcode on / off", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-customer", keys: "A", action: "Add a customer to a walk-in sale", scope: "sales", permissions: ["pos.create_sale", "orders.update", "customers.loyalty"], keywords: ["attach", "points", "quick sale"] },

  // Page actions pressed through data-shortcut buttons
  { id: "inventory-new", keys: "N", key: "n", target: "new", action: "Add a product", scope: "inventory", permissions: ["products.create"] },
  { id: "customers-new", keys: "N", key: "n", target: "new", action: "Add a customer", scope: "customers", permissions: ["customers.create"] },
  { id: "customers-points", keys: "P", key: "p", target: "points", action: "Open the points report", scope: "customers", permissions: ["customers.view"] },
  { id: "production-batch", keys: "N", key: "n", target: "new", action: "Start a production batch", scope: "production", permissions: ["production.create"] },
  { id: "production-bom", keys: "B", key: "b", target: "new-bom", action: "Create a recipe (BOM)", scope: "production", permissions: ["bom.create"] },
  { id: "shift-clock", keys: "C", key: "c", target: "clock", action: "Clock in / out", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-new", keys: "N", key: "n", target: "new", action: "Set an alarm", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-today", keys: "T", key: "t", target: "today", action: "Go to today", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-prev-day", keys: "←", key: "ArrowLeft", target: "prev-day", action: "Previous day", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-next-day", keys: "→", key: "ArrowRight", target: "next-day", action: "Next day", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-month", keys: "M", key: "m", target: "toggle-month", action: "Show the month / one week", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-form-save", keys: "Ctrl+Enter", action: "Save the alarm (in the form)", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-form-cancel", keys: "Esc", action: "Close the alarm form", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "branch-new", keys: "N", key: "n", target: "new", action: "Add a branch", scope: "business-management", permissions: ["settings.view"] },
  { id: "notifications-read", keys: "M", key: "m", target: "mark-read", action: "Mark all as read", scope: "notifications", permissions: [] },
];

export const SHORTCUTS: Shortcut[] = [...everywhere, ...goTo, ...pages];

function roleCan(role: string, codes: string[]): boolean {
  return codes.length === 0 || codes.some((code) => hasRolePermission(role, code as any));
}

/** The shortcuts this role can use: their screen opens for them and they may do the action. */
export function shortcutsFor(role: string | undefined): Shortcut[] {
  if (!role) return [];
  return SHORTCUTS.filter((s) => (s.scope === "everywhere" || canOpenScreen(role, s.scope)) && roleCan(role, s.permissions));
}

/** Where a shortcut works, as a person reads it. */
export function scopeLabel(scope: ShortcutScope): string {
  return scope === "everywhere" ? "Everywhere" : scope === "sales" ? "Receipts & Sales Log" : SCREEN_BY_ID.get(scope)?.title || scope;
}

// ---------------------------------------------------------------------------
// Features people look for by name, so global search finds them.
// ---------------------------------------------------------------------------
export interface AppFeature {
  id: string;
  title: string;
  description: string;
  screen: ScreenId;
  /** Any one of these shows it. */
  permissions: string[];
  keywords: string[];
}

export const FEATURES: AppFeature[] = [
  { id: "alarms", title: "Alarms and reminders", description: "Set a time; it rings on the phone until Accept is tapped", screen: "dashboard", permissions: ["dashboard.view"], keywords: ["alarm", "reminder", "ring", "schedule", "shift", "wake"] },
  { id: "ring-tone", title: "Ringing alert tone", description: "Choose the sound for alarms and urgent alerts (Notification settings)", screen: "notifications", permissions: [], keywords: ["ringtone", "alarm sound", "tone", "ring", "sound"] },
  { id: "attach-customer", title: "Add a customer to a past sale", description: "Put a Quick Sale or walk-in sale on a customer's account so they get the points", screen: "sales", permissions: ["pos.create_sale", "orders.update", "customers.loyalty"], keywords: ["attach", "assign", "walk-in", "quick sale", "points", "loyalty", "receipt"] },
  { id: "invoices", title: "Customer invoices", description: "Invoice a customer for what they owe, by period", screen: "customers", permissions: ["customers.debts"], keywords: ["invoice", "statement", "debt", "credit", "owes", "bill"] },
  { id: "credit-sales", title: "Credit sales and debts", description: "Sell on credit; it is added to what the customer owes", screen: "pos", permissions: ["customers.debts"], keywords: ["credit", "debt", "owe", "loan", "deni"] },
  { id: "points-report", title: "Points report", description: "Points earned and spent by every customer", screen: "customers", permissions: ["customers.loyalty", "loyalty.view", "reports.sales"], keywords: ["loyalty", "points", "rewards", "earned", "redeemed"] },
  { id: "points-rule", title: "How points work", description: "2 points per KSh 1 paid, 1 per KSh 1 of debt repaid, 100 points = KSh 1", screen: "customers", permissions: ["customers.view"], keywords: ["loyalty", "points", "rule", "rate", "tier", "silver", "gold"] },
  { id: "duplicates", title: "Merge duplicate customers", description: "Find customers entered twice and join them", screen: "customers", permissions: ["customers.manage"], keywords: ["duplicate", "merge", "same customer", "link"] },
  { id: "mpesa-till", title: "M-Pesa till payments", description: "Payments to the till waiting to be matched, and payment prompts", screen: "money", permissions: ["payments.mpesa", "payments.verify"], keywords: ["mpesa", "m-pesa", "till", "stk", "prompt", "daraja", "unclaimed"] },
  { id: "offline-sales", title: "Offline sales", description: "Sales made without internet sync when you are back online", screen: "sales", permissions: ["pos.create_sale"], keywords: ["offline", "sync", "no internet", "waiting to sync"] },
  { id: "receipt-settings", title: "Receipts and printers", description: "Receipt layout, paper size, printers and barcodes", screen: "settings", permissions: ["settings.tax"], keywords: ["receipt", "printer", "bluetooth", "thermal", "paper", "barcode", "qr"] },
  { id: "kra-etims", title: "KRA eTIMS", description: "Sign sales with KRA eTIMS", screen: "settings", permissions: ["settings.tax"], keywords: ["kra", "etims", "tax", "vat", "invoice"] },
  { id: "home-dashboard", title: "Home figures", description: "Sales, stock and customer figures at a glance", screen: "home", permissions: ["home.view"], keywords: ["dashboard", "figures", "charts", "today"] },
  { id: "app-update", title: "App updates", description: "Check for and install a new version", screen: "about", permissions: [], keywords: ["update", "version", "upgrade", "install"] },
  { id: "keyboard-shortcuts", title: "Keyboard shortcuts", description: "Every shortcut your role can use", screen: "about", permissions: [], keywords: ["keyboard", "shortcut", "keys", "hotkey"] },
];

/** The features this role can see: they can open the screen and do the thing. */
export function featuresFor(role: string | undefined): AppFeature[] {
  if (!role) return [];
  return FEATURES.filter((f) => canOpenScreen(role, f.screen) && roleCan(role, f.permissions));
}
