// src/utils/shortcuts.ts
// Every keyboard shortcut in the app, and the newer features people search for.
// The key handler, the "?" help, About → Keyboard shortcuts and global search all read
// these lists, and each person only sees what their role can open and do.

import { hasRolePermission } from "./permissions";
import { hasModule } from "../stores/planStore";
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
  /** Plan module the action needs when its permissions are core (e.g. delivery at the till). */
  module?: string;
  /**
   * For page actions run by the global handler: the single key (lower case) and the
   * `data-shortcut` name of the button it presses. A button the role can't see isn't
   * on the page, so its shortcut does nothing.
   */
  key?: string;
  target?: string;
  keywords?: string[];
}

/**
 * The second key after G that opens each screen, Gmail/GitHub style: the first letter of the
 * screen's name wherever it is free, otherwise a letter in the name that sticks (historY,
 * clocK, reViews, biZ). The sidebar shows each one on the right of its tab.
 * Merged screens (accounting, suppliers) have none: their new screen's key opens them.
 */
export const GO_TO_KEYS: Partial<Record<ScreenId, string>> = {
  home: "h",
  sell: "q", // Quick sale
  pos: "p",
  sales: "s",
  customers: "l", // Loyalty
  "online-store": "o",
  website: "@", // the web address (every letter is taken)
  promotions: "%", // % off
  marketing: "!", // announcements (every letter is taken)
  deliveries: "d",
  "regular-orders": "7", // 7 days a week (every letter is taken)
  inventory: "i",
  "stock-history": "y", // histor-Y
  "stock-transfers": "t",
  "stock-report": "g", // report: the only free letter left
  buying: "b",
  production: "j", // Jobs (production batches)
  money: "e", // payments & Expenses
  prompt: "m", // M-Pesa prompt
  "petty-cash": "c", // petty Cash
  finance: "f",
  dashboard: "k", // clocK in (Shift)
  workers: "w",
  permissions: "r", // Roles
  audit: "x",
  ai: "a", // Assistant
  feedback: "v", // reViews
  "business-management": "z", // biZ
  settings: ",", // like Ctrl+, in most apps
  notifications: "n",
  profile: "u", // yoU
  about: "?",
};

/** How a G key is written: "G then P". */
export const goToLabel = (id: ScreenId): string | undefined => {
  const key = GO_TO_KEYS[id];
  return key ? `G then ${key.toUpperCase()}` : undefined;
};

const everywhere: Shortcut[] = [
  { id: "search", keys: "Ctrl+K", action: "Search the app", scope: "everywhere", permissions: [], keywords: ["find", "global search"] },
  { id: "help", keys: "? F1", action: "Show the shortcuts for this screen", scope: "everywhere", permissions: [], keywords: ["help", "keys"] },
  { id: "page-search", keys: "/ Ctrl+F", action: "Jump to this screen's search box", scope: "everywhere", permissions: [], keywords: ["find", "filter"] },
  { id: "reload", keys: "F5 Ctrl+R", action: "Reload: fetch the latest data (Ctrl+Shift+R restarts the app)", scope: "everywhere", permissions: [], keywords: ["refresh", "reload", "sync", "update"] },
  { id: "back", keys: "Alt+←", action: "Back to the previous screen", scope: "everywhere", permissions: [], keywords: ["back", "previous"] },
  { id: "settings-key", keys: "Ctrl+,", action: "Open Settings", scope: "everywhere", permissions: ["settings.view"], keywords: ["preferences", "options"] },
  { id: "tab-prev", keys: "[", action: "Previous tab on this screen", scope: "everywhere", permissions: [] },
  { id: "tab-next", keys: "]", action: "Next tab on this screen", scope: "everywhere", permissions: [] },
  { id: "close", keys: "Esc", action: "Close a window or clear a search", scope: "everywhere", permissions: [] },
];

const goTo: Shortcut[] = SCREENS.filter((screen) => GO_TO_KEYS[screen.id]).map((screen) => ({
  id: `go-${screen.id}`,
  keys: goToLabel(screen.id)!,
  action: `Open ${screen.title}`,
  scope: "everywhere" as const,
  // Only screens this role can open are listed, and only those keys work.
  permissions: screen.permissions,
  keywords: ["go to", "navigate", screen.title.toLowerCase(), ...screen.keywords],
}));

const pages: Shortcut[] = [
  // Quick Sale and POS share keys: the same Alt+number pays the same way on both.
  { id: "sell-cash", keys: "Alt+1", action: "Paid by cash", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-mpesa", keys: "Alt+2", action: "Paid by M-Pesa", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-card", keys: "Alt+4", action: "Paid by card", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-airtel", keys: "Alt+6", action: "Paid by Airtel Money", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-customer", keys: "Alt+C", action: "Add a customer to the last sale (they get the points)", scope: "sell", permissions: ["pos.create_sale"], keywords: ["attach", "loyalty", "points", "walk-in"] },
  { id: "sell-receipt", keys: "Alt+R", action: "Receipt for the last sale", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-scan", keys: "Enter", action: "Add the scanned or highlighted product", scope: "sell", permissions: ["pos.create_sale"], keywords: ["barcode"] },
  { id: "sell-move", keys: "↑ ↓", action: "Move through the products", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-qty", keys: "+ −", action: "One more / one less of the last item", scope: "sell", permissions: ["pos.create_sale"] },
  { id: "sell-clear", keys: "Esc", action: "Clear the search, then the sale", scope: "sell", permissions: ["pos.create_sale"] },

  // POS
  { id: "pos-search", keys: "/ F2", action: "Search products", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-pick", keys: "↑ ↓ Enter", action: "Pick a product from the search", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-category", keys: "Alt+← Alt+→", action: "Previous / next category", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-qty", keys: "+ −", action: "One more / one less of the last item", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-remove", keys: "Delete", action: "Remove the last item", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-clear", keys: "Ctrl+Delete", action: "Empty the cart", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-cart", keys: "F4", action: "Show / hide the cart (phone layout)", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-cash", keys: "Alt+1", action: "Pay by cash", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-mpesa", keys: "Alt+2", action: "Pay by M-Pesa", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-credit", keys: "Alt+3", action: "Sell on credit", scope: "pos", permissions: ["customers.debts", "pos.create_sale"] },
  { id: "pos-card", keys: "Alt+4", action: "Pay by card", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-bank", keys: "Alt+5", action: "Pay by bank transfer", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-airtel", keys: "Alt+6", action: "Pay by Airtel Money", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-customer", keys: "Alt+C", action: "Choose a customer", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-delivery", keys: "Alt+D", action: "Delivery on / off", scope: "pos", permissions: ["pos.create_sale"], module: "deliveries" },
  { id: "pos-note", keys: "Alt+N", action: "Add a note", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-quote", keys: "Alt+Q", action: "Save the cart as a quote", scope: "pos", permissions: ["quotes.manage"], keywords: ["quotation", "proforma", "estimate"] },
  { id: "pos-complete", keys: "Ctrl+Enter F9", action: "Complete the sale", scope: "pos", permissions: ["pos.create_sale"] },
  { id: "pos-receipt", keys: "Alt+R R", action: "Receipt (after a sale)", scope: "pos", permissions: ["pos.create_sale"] },

  // Receipts (open from Quick Sale, POS or the Sales Log)
  { id: "receipt-print", keys: "P Ctrl+P", action: "Print the receipt", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-whatsapp", keys: "W", action: "Send the receipt on WhatsApp", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-email", keys: "E", action: "Email the receipt", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-pdf", keys: "D", action: "Save the receipt as PDF", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-copy", keys: "C", action: "Copy the receipt text", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-barcode", keys: "B", action: "Barcode on / off", scope: "sales", permissions: ["orders.view", "pos.create_sale"] },
  { id: "receipt-customer", keys: "A", action: "Add a customer to a walk-in sale", scope: "sales", permissions: ["pos.create_sale", "orders.update", "customers.loyalty"], keywords: ["attach", "points", "quick sale"] },

  // Page actions pressed through data-shortcut buttons
  // Payment Prompts
  { id: "prompt-mpesa", keys: "M", key: "m", target: "prompt-mpesa", action: "Switch to M-Pesa", scope: "prompt", permissions: ["payments.mpesa"] },
  { id: "prompt-airtel", keys: "A", key: "a", target: "prompt-airtel", action: "Switch to Airtel Money", scope: "prompt", permissions: ["payments.airtel"] },
  { id: "prompt-new", keys: "N", key: "n", target: "prompt-new", action: "New prompt (after one is sent)", scope: "prompt", permissions: ["payments.mpesa", "payments.airtel"] },
  { id: "prompt-again", keys: "R", key: "r", target: "prompt-again", action: "Send the prompt again", scope: "prompt", permissions: ["payments.mpesa", "payments.airtel"] },
  { id: "inventory-new", keys: "N", key: "n", target: "new", action: "Add a product", scope: "inventory", permissions: ["products.create"] },
  { id: "customers-new", keys: "N", key: "n", target: "new", action: "Add a customer", scope: "customers", permissions: ["customers.create"] },
  { id: "production-batch", keys: "N", key: "n", target: "new", action: "Start a production batch", scope: "production", permissions: ["production.create"] },
  { id: "production-bom", keys: "B", key: "b", target: "new-bom", action: "Create a recipe (BOM)", scope: "production", permissions: ["bom.create"] },
  { id: "shift-clock", keys: "C", key: "c", target: "clock", action: "Clock in / out", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-new", keys: "N", key: "n", target: "new", action: "Set a reminder", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-today", keys: "T", key: "t", target: "today", action: "Go to today", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-prev-day", keys: "←", key: "ArrowLeft", target: "prev-day", action: "Previous day", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-next-day", keys: "→", key: "ArrowRight", target: "next-day", action: "Next day", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-month", keys: "M", key: "m", target: "toggle-month", action: "Show the month / one week", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-form-save", keys: "Ctrl+Enter", action: "Save the reminder (in the form)", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "shift-form-cancel", keys: "Esc", action: "Close the reminder form", scope: "dashboard", permissions: ["dashboard.view"] },
  { id: "transfer-new", keys: "N", key: "n", target: "new", action: "Send stock to another branch", scope: "stock-transfers", permissions: ["inventory.transfer_stock"] },
  { id: "promotion-new", keys: "N", key: "n", target: "new", action: "New promotion", scope: "promotions", permissions: ["promotions.manage"] },
  { id: "transfer-request", keys: "A", key: "a", target: "transfer-request", action: "Ask another branch for stock", scope: "stock-transfers", permissions: ["inventory.transfer_stock", "inventory.request_transfer"] },
  { id: "buying-new", keys: "N", key: "n", target: "new", action: "Invite a supplier / new purchase / draft purchases from the ticked suggestions / enter a bill / return goods (on that tab)", scope: "buying", permissions: ["suppliers.create", "purchases.create", "supplier_bills.manage", "purchases.update"] },
  { id: "accounting-new", keys: "N", key: "n", target: "new", action: "New journal entry / account (on that tab)", scope: "finance", permissions: ["accounting.manage"] },
  { id: "branch-new", keys: "N", key: "n", target: "new", action: "Add a branch", scope: "business-management", permissions: ["settings.view"] },
  { id: "expense-new", keys: "N", key: "n", target: "new", action: "Record an expense (on the Expenses tab)", scope: "money", permissions: ["expenses.create"], keywords: ["expense", "spend", "cost"] },
  { id: "notifications-read", keys: "M", key: "m", target: "mark-read", action: "Mark all as read", scope: "notifications", permissions: [] },
];

export const SHORTCUTS: Shortcut[] = [...everywhere, ...goTo, ...pages];

function roleCan(role: string, codes: string[]): boolean {
  return codes.length === 0 || codes.some((code) => hasRolePermission(role, code as any));
}

/** The shortcuts this role can use: their screen opens for them and they may do the action. */
export function shortcutsFor(role: string | undefined): Shortcut[] {
  if (!role) return [];
  return SHORTCUTS.filter(
    (s) =>
      (s.scope === "everywhere" || canOpenScreen(role, s.scope)) &&
      roleCan(role, s.permissions) &&
      // "Go to" keys follow the screen itself (its plan module too, not only its permissions).
      (!s.id.startsWith("go-") || canOpenScreen(role, s.id.slice(3))) &&
      hasModule(s.module),
  );
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
  /** After opening the screen, press the button tagged with this `data-shortcut`. */
  target?: string;
}

export const FEATURES: AppFeature[] = [
  { id: "alarms", title: "Reminders", description: "Rings until someone taps Accept", screen: "dashboard", permissions: ["dashboard.view"], keywords: ["alarm", "reminder", "ring", "schedule", "shift", "wake"] },
  { id: "ring-tone", title: "Ringing alert tone", description: "Sound for reminders and alerts", screen: "notifications", permissions: [], keywords: ["ringtone", "alarm sound", "tone", "ring", "sound"] },
  { id: "attach-customer", title: "Add a customer to a past sale", description: "Give a walk-in sale to a customer", screen: "sales", permissions: ["pos.create_sale", "orders.update", "customers.loyalty"], keywords: ["attach", "assign", "walk-in", "quick sale", "points", "loyalty", "receipt"] },
  { id: "invoices", title: "Customer invoices", description: "Invoice a customer for what they owe, by period", screen: "customers", permissions: ["customers.debts"], keywords: ["invoice", "statement", "debt", "credit", "owes", "bill"] },
  { id: "credit-sales", title: "Credit sales and debts", description: "Sell on credit; it is added to what the customer owes", screen: "pos", permissions: ["customers.debts"], keywords: ["credit", "debt", "owe", "loan", "deni"] },
  { id: "points-report", title: "Points report", description: "Points earned and spent by every customer", screen: "promotions", permissions: ["customers.loyalty", "loyalty.view", "reports.sales"], keywords: ["loyalty", "points", "rewards", "earned", "redeemed"], target: "points" },
  { id: "points-settings", title: "Points settings", description: "Turn points on or off and set their value", screen: "promotions", permissions: ["loyalty.configure"], keywords: ["manage points", "points on", "points off", "switch off points", "turn off points", "pause points", "point value", "tier value", "bronze", "silver", "gold", "minimum points", "loyalty settings"], target: "points" },
  { id: "points-rule", title: "How points work", description: "2 points per KSh 1 paid. Silver from 20,000, Gold from 60,000", screen: "promotions", permissions: ["customers.view"], target: "points", keywords: ["loyalty", "points", "rule", "rate", "tier", "silver", "gold"] },
  { id: "message-many", title: "Message many customers", description: "One message to a group (Feedback → Communication)", screen: "feedback", target: "messages", permissions: ["communication.send"], keywords: ["bulk", "sms", "whatsapp", "debt reminder", "variables", "broadcast", "group", "ai"] },
  { id: "points-cost", title: "What points cost", description: "Points used, in Where money went", screen: "finance", permissions: ["finance.view"], keywords: ["points cost", "loyalty cost", "where money went", "discount"] },
  { id: "invoice-archive", title: "Archive or delete invoices", description: "Swipe an invoice to delete it, or hold it to archive", screen: "customers", permissions: ["customers.debts"], keywords: ["archive", "hide invoice", "delete invoice", "swipe", "hold"] },
  { id: "feedback-archive", title: "Archive feedback", description: "Hold a review to archive it", screen: "feedback", permissions: ["complaints.view"], keywords: ["archive", "hide", "complaint", "review", "swipe", "hold"] },
  { id: "petty-cash", title: "Petty cash", description: "Money taken from the till", screen: "petty-cash", permissions: ["pettycash.record"], keywords: ["petty cash", "spending", "float", "cashbook"] },
  { id: "payment-methods", title: "Payment methods", description: "Cash, M-Pesa, Airtel Money, Card or Bank", screen: "pos", permissions: ["pos.create_sale"], keywords: ["card", "paystack", "visa", "mastercard", "bank", "bank transfer", "payment method", "airtel"] },
  { id: "payment-switch", title: "Switch payment methods on or off", description: "Payments → Methods", screen: "money", permissions: ["payments.configure"], keywords: ["turn off card", "turn off bank", "disable payment", "enable payment", "payment methods", "switch off", "switch on", "methods"], target: "money-methods" },
  { id: "payment-prompts", title: "Payment prompts", description: "Send an M-Pesa or Airtel prompt (G then M)", screen: "prompt", permissions: ["payments.mpesa", "payments.airtel"], keywords: ["stk", "prompt", "push", "request payment", "ask to pay", "airtel", "mpesa"] },
  { id: "airtel-setup", title: "Airtel Money setup", description: "Payments → Airtel Money", screen: "money", permissions: ["settings.integrations", "payments.airtel"], keywords: ["airtel", "airtel money", "airtel africa", "developer", "client id", "callback"], target: "money-airtel" },
  { id: "duplicates", title: "Merge duplicate customers", description: "Find customers entered twice and join them", screen: "customers", permissions: ["customers.manage"], keywords: ["duplicate", "merge", "same customer", "link"] },
  { id: "mpesa-till", title: "M-Pesa till payments", description: "Till payments to match", screen: "money", permissions: ["payments.mpesa", "payments.verify"], keywords: ["mpesa", "m-pesa", "till", "stk", "prompt", "daraja", "unclaimed"] },
  { id: "offline-sales", title: "Offline sales", description: "Saved and sent when back online", screen: "sales", permissions: ["pos.create_sale"], keywords: ["offline", "sync", "no internet", "waiting to sync"] },
  { id: "receipt-settings", title: "Receipts and printers", description: "Receipt layout, paper size, printers and barcodes", screen: "settings", permissions: ["settings.tax"], keywords: ["receipt", "printer", "bluetooth", "thermal", "paper", "barcode", "qr"] },
  { id: "kra-etims", title: "KRA eTIMS", description: "Sign sales with KRA eTIMS", screen: "settings", permissions: ["settings.tax"], keywords: ["kra", "etims", "tax", "vat", "invoice"] },
  { id: "branch-transfers", title: "Move stock between branches", description: "Send stock; the branch confirms it", screen: "stock-transfers", permissions: ["inventory.transfer_stock", "inventory.receive_stock"], keywords: ["transfer", "branch", "supply", "send", "receive", "dispatch"] },
  { id: "transfer-request", title: "Ask a branch for stock", description: "Stock Transfers → Ask for stock", screen: "stock-transfers", permissions: ["inventory.transfer_stock", "inventory.request_transfer"], keywords: ["request stock", "ask for stock", "need stock", "branch", "running low"], target: "transfer-request" },
  { id: "transfer-shortage", title: "Settle a transfer that arrived short", description: "Arrived late, found or lost", screen: "stock-transfers", permissions: ["inventory.transfer_stock", "inventory.receive_stock"], keywords: ["short", "missing", "lost", "write off", "arrived late", "found"] },
  { id: "reorder", title: "Reorder levels and suggested orders", description: "Buying → Orders → Reorder", screen: "buying", permissions: ["purchases.view", "purchases.create"], keywords: ["reorder", "reorder point", "low stock", "suggested order", "what to buy", "lead time", "running out"], target: "buying-reorder" },
  { id: "purchase-approval", title: "Approve purchases", description: "Purchases above a limit (Buying → Approvals)", screen: "buying", permissions: ["purchases.approve"], keywords: ["approve", "approval", "limit", "authorise", "authorize", "reject"], target: "buying-approvals" },
  { id: "supplier-bills", title: "Supplier bills", description: "Enter and pay supplier invoices (Buying → Bills)", screen: "buying", permissions: ["supplier_bills.manage", "purchases.view"], keywords: ["supplier invoice", "bill", "three-way match", "vat on purchases", "input vat", "due", "pay supplier"], target: "buying-bills" },
  { id: "supplier-returns", title: "Return goods to a supplier", description: "Buying → Bills → Returns", screen: "buying", permissions: ["purchases.update", "purchases.manage", "purchases.approve"], keywords: ["return", "send back", "damaged", "wrong goods", "supplier credit", "debit note"], target: "buying-returns" },
  { id: "supplier-app-access", title: "Add or invite a supplier", description: "Workers → Supplier role", screen: "workers", permissions: ["suppliers.portal", "suppliers.create"], keywords: ["add supplier", "new supplier", "supplier login", "supplier portal", "supplier account", "invite supplier", "vendor portal", "supplier app"] },
  { id: "supplier-role", title: "What suppliers can see", description: "Roles → Supplier", screen: "permissions", permissions: ["staff.roles"], keywords: ["supplier role", "supplier permissions", "supplier portal", "vendor access"] },
  { id: "rfq", title: "Ask suppliers for prices", description: "Open a draft purchase in Buying", screen: "buying", permissions: ["purchases.request_quote"], keywords: ["rfq", "request for quote", "quotation", "compare prices", "cheapest supplier"], target: "purchases-tab" },
  { id: "delivery-requests", title: "Delivery requests", description: "Open deliveries riders can accept or give back", screen: "deliveries", permissions: ["deliveries.view"], keywords: ["accept delivery", "give back", "rider", "request", "open delivery"] },
  { id: "delivery-areas", title: "Delivery areas and prices", description: "Areas you deliver to and what each costs", screen: "deliveries", permissions: ["deliveries.delivery_zones", "deliveries.delivery_price"], keywords: ["zone", "area", "delivery fee", "delivery price", "distance"] },
  { id: "quotes", title: "Quotes", description: "Make one in POS with Quote (Alt+Q)", screen: "sales", permissions: ["quotes.view", "quotes.manage"], keywords: ["quote", "quotation", "proforma", "estimate", "price list"], target: "quotes-tab" },
  { id: "credit-notes", title: "Refund or edit a sale", description: "Sales Log → tap a sale → Edit sale or Refund", screen: "sales", permissions: ["refunds.create", "pos.cancel_sale"], keywords: ["credit note", "refund", "return", "money back", "returned goods", "edit sale", "change sale", "reverse", "void", "correct sale", "wrong sale"] },
  { id: "pay-supplier", title: "Pay a supplier", description: "Finance → Suppliers", screen: "finance", permissions: ["accounting.view"], keywords: ["pay supplier", "payables", "creditors", "owe supplier", "supplier balance", "bill"], target: "acc-payables" },
  { id: "balance-sheet", title: "Balance sheet", description: "Finance → Balance sheet", screen: "finance", permissions: ["accounting.view"], keywords: ["balance sheet", "assets", "liabilities", "net worth", "equity"], target: "acc-balance" },
  { id: "profit-loss", title: "Profit & loss statement", description: "Finance → Profit & loss", screen: "finance", permissions: ["accounting.view"], keywords: ["p&l", "income statement", "profit and loss"], target: "acc-pnl" },
  { id: "journal", title: "Journal entries", description: "Finance → Journal", screen: "finance", permissions: ["accounting.view"], keywords: ["journal", "ledger", "je", "entry", "owner capital", "drawings", "loan", "transfer to bank"], target: "acc-journal" },
  { id: "count-money", title: "Count money & match stock", description: "Finance → Count money & stock", screen: "finance", permissions: ["accounting.view"], keywords: ["reconcile", "bank reconciliation", "cash count", "cash short", "stock value"], target: "acc-checks" },
  { id: "purchase-receive", title: "Receive a purchase into stock", description: "Open a purchase → Receive", screen: "buying", permissions: ["purchases.update", "purchases.approve"], keywords: ["receive", "goods received", "grn", "restock", "delivery from supplier", "purchase order"], target: "purchases-tab" },
  { id: "purchases", title: "Purchases", description: "Orders to suppliers", screen: "buying", permissions: ["purchases.view"], keywords: ["purchase", "order", "lpo", "buy"], target: "purchases-tab" },
  { id: "website-banner", title: "Website home banner", description: "Website → Content → Home banner", screen: "website", permissions: ["business.update"], keywords: ["hero", "banner", "slider", "carousel", "website picture"] },
  { id: "website-pages", title: "Website pages", description: "Website → Pages", screen: "website", permissions: ["business.update"], keywords: ["page editor", "about page", "website text", "terms", "returns"] },
  { id: "promo-codes", title: "Promotion codes", description: "Promotions & Points → Codes", screen: "promotions", permissions: ["promotions.view", "promotions.manage"], keywords: ["promo", "coupon", "discount code", "voucher", "offer", "website promo"] },
  { id: "referral-programme", title: "Referral programme", description: "Promotions & Points → Referrals", screen: "promotions", permissions: ["referrals.view", "referrals.manage"], keywords: ["referral", "refer a friend", "invite", "reward", "bring a friend"], target: "referrals" },
  { id: "website-reviews", title: "Website reviews", description: "Online orders → Reviews", screen: "online-store", permissions: ["business.update"], keywords: ["reviews", "ratings", "stars", "approve review"] },
  { id: "background-remover", title: "Remove a photo's background", description: "Tap Remove background on a photo", screen: "inventory", permissions: ["products.create", "products.update"], keywords: ["background", "cut out", "cutout", "transparent", "remove background", "photo", "picture"] },
  { id: "delete-notifications", title: "Delete notifications", description: "Swipe a notification to delete it, or hold it for more", screen: "notifications", permissions: [], keywords: ["clear notifications", "remove alert", "swipe", "delete"] },
  { id: "home-dashboard", title: "Home figures", description: "Sales, stock and customer figures at a glance", screen: "home", permissions: ["home.view"], keywords: ["dashboard", "figures", "charts", "today"] },
  { id: "app-update", title: "App updates", description: "Check for and install a new version", screen: "about", permissions: [], keywords: ["update", "version", "upgrade", "install"] },
  { id: "keyboard-shortcuts", title: "Keyboard shortcuts", description: "Every shortcut your role can use", screen: "about", permissions: [], keywords: ["keyboard", "shortcut", "keys", "hotkey"], target: "about-shortcuts" },
];

/** The features this role can see: they can open the screen and do the thing. */
export function featuresFor(role: string | undefined): AppFeature[] {
  if (!role) return [];
  return FEATURES.filter((f) => canOpenScreen(role, f.screen) && roleCan(role, f.permissions));
}
