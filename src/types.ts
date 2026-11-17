export type ProductCategory = string;

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
  cost: number;
  image: string;
  stock: number;
  minStock: number;
  unit: string;
  sku: string;
  description?: string;
  perishable?: boolean;
  expiryDays?: number;
  businessId?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  discountPercentage: number;
}


/** The four ways money comes in. Nothing else is accepted anywhere. */
export type MoneyMethod = 'Cash' | 'M-Pesa' | 'Airtel Money' | 'Card' | 'Bank';
/** How a sale is paid: one of the four, or on credit (owed by the customer). */
export type PaymentMethod = MoneyMethod | 'Credit_Debt' | 'Credit';

export interface Transaction {
  id: string;
  items: CartItem[];
  total: number;
  discount: number;
  tax: number;
  finalTotal: number;
  paymentMethod: PaymentMethod;
  customerId?: string;
  customerName?: string;
  staffId: string;
  staffName: string;
  status: 'Synced' | 'Offline_Pending';
  timestamp: string;
  note?: string;
  isDelivery?: boolean;
  /** What the customer pays THE SHOP for delivery (on the bill); 0 unless deliveryMode is 'charged'. */
  deliveryFee?: number;
  /** How the delivery is paid; see DeliveryMode. */
  deliveryMode?: DeliveryMode;
  /** What the rider earns for this delivery (owed by the shop unless 'rider_collects'). */
  riderPay?: number;
  riderName?: string;
  businessId?: string;
  referenceId?: string;
  /** Part of a credit sale paid from the customer's wallet; the rest is owed. */
  walletApplied?: number;
  /** Promotion or referral code used on the sale, and the part of `discount` it gave (set by the database). */
  promotionCode?: string;
  promotionDiscount?: number;
}

/**
 * How a delivery is paid:
 * - charged: the fee is on our bill (paid now, or later on a weekly / monthly account); the shop pays the rider.
 * - rider_collects: the customer pays the rider the fee in cash on delivery; the rider keeps it.
 * - free: the customer isn't charged; the shop pays the rider from its own money.
 */
export type DeliveryMode = 'charged' | 'rider_collects' | 'free';

export type CustomerTier = 'Bronze' | 'Silver' | 'Gold';
export type CustomerType = 'individual' | 'institution' | 'business' | 'other';
export type PaymentTerms = 'pay_now' | 'weekly' | 'monthly';
export type DeliveryFrequency = 'none' | 'daily' | 'weekly' | 'monthly';

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  individual: 'Individual',
  institution: 'Institution',
  business: 'Business',
  other: 'Other',
};
export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  pay_now: 'Pays on purchase',
  weekly: 'Pays weekly',
  monthly: 'Pays monthly',
};
export const DELIVERY_FREQUENCY_LABELS: Record<DeliveryFrequency, string> = {
  none: 'No regular delivery',
  daily: 'Daily delivery',
  weekly: 'Weekly delivery',
  monthly: 'Monthly delivery',
};

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  loyaltyPoints: number;
  joinDate: string;
  tier: CustomerTier;
  purchasesCount: number;
  debtBalance?: number;
  walletBalance?: number;
  /** Given by the database; customers quote it when paying by M-Pesa. */
  accountNumber?: string;
  businessId?: string;
  description?: string;
  customerType?: CustomerType;
  paymentTerms?: PaymentTerms;
  deliveryFrequency?: DeliveryFrequency;
  notifyService?: boolean;
  notifyPromotions?: boolean;
  /** Delivery location, the same parts the website asks for (20261128001). */
  deliveryZoneId?: string | null;
  deliveryAddress?: string;
  deliveryBuilding?: string;
  deliveryLandmark?: string;
  deliveryNotes?: string;
}

export type EmployeeRole = 'Owner' | 'Admin' | 'Administrator' | 'Manager' | 'Cashier' | 'Inventory Manager' | 'Staff' | 'Rider' | 'Production Staff' | 'Inventory Staff' | 'Sales Staff' | 'Viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar?: string;
  isVerified: boolean;
  phoneVerified?: boolean;
  pin?: string;
}

export interface Business {
  id: string;
  name: string;
  businessType: string; // Retail, Wholesale, Farm, Dairy Processing, etc.
  country: string;
  currency: string; // Default Ksh
  description?: string;
  address?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  primaryColor?: string;
  secondaryColor?: string;
  timezone?: string;
  defaultPaymentMethods?: string[];
  isTaxEnabled?: boolean;
  taxPercentage?: number;
}

export interface BusinessMembership {
  id: string;
  businessId: string;
  userId: string;
  role: EmployeeRole;
  status: 'Active' | 'Pending' | 'Suspended';
  joinedAt: string;
}

export interface Invitation {
  id: string;
  businessId: string;
  name: string;
  /** Only set when looked up by invitation code. */
  businessName?: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  invitationToken: string;
  expiresAt: string;
  acceptedAt?: string;
  status: 'Pending' | 'Accepted' | 'Expired' | 'Revoked';
  invitedBy: string; // user_id of the inviter
}

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  email: string;
  phone: string;
  pin: string;
  activeShiftId: string | null;
  tasks: { id: string; text: string; completed: boolean }[];
  avatar: string;
  assignedBranches?: string[];
}

export interface Shift {
  id: string;
  employeeId: string;
  startTime: string;
  endTime: string | null;
  salesCount: number;
  salesTotal: number;
  status: 'Active' | 'Closed';
}

/** Represents a planned schedule row from the `schedules` table */
export interface DbSchedule {
  id: string;
  businessId: string;
  employeeId: string;
  title: string;
  notes: string | null;
  date: string;           // YYYY-MM-DD
  startTime: string;      // HH:MM
  endTime: string | null; // HH:MM
  repeat: 'None' | 'Daily' | 'Weekly' | 'Monthly';
  color: string;
  reminderSent: boolean;
  /** The last day (YYYY-MM-DD, Nairobi) its alarm went off. */
  lastRemindedOn: string | null;
  createdBy: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdjustmentType =
  | 'Restock'
  | 'Damage'
  | 'Reconciliation'
  | 'Production Consumption'
  | 'Production Output'
  | 'Production Reversal'
  | 'Production Waste'
  | 'Transfer Out'
  | 'Transfer In'
  | 'Transfer Return';

export interface InventoryAdjustment {
  id: string;
  productId: string;
  productName: string;
  type: AdjustmentType;
  quantityAdjusted: number;
  previousStock: number;
  newStock: number;
  timestamp: string;
  reason: string;
  staffName: string;
  batchId?: string;
  referenceNumber?: string;
  notes?: string;
}

export interface SyncState {
  isOnline: boolean;
  pendingTransactions: Transaction[];
  lastSyncedAt: string | null;
  isSyncing: boolean;
  lastOfflineAt: string | null;
}

export type NotificationType =
  | "Stock Almost Finished"
  | "Out Of Stock"
  | "Stock Transfer"
  | "Low Cash Balance"
  | "Debt Due Reminder"
  | "Delivery Assigned"
  | "Delivery Completed"
  | "Payment Received"
  | "Credit Sale"
  | "Sales Summary"
  | "Daily Report"
  | "Weekly Report"
  | "Monthly Report"
  | "Scheduled Reminder"
  | "AI Business Insight"
  | "AI Recommendation"
  | "AI Risk Alert"
  | "System Update"
  | "Role Invitation"
  | "Account Activity"
  | "Business Announcement"
  | "Custom Notification";

export type NotificationPriority = "low" | "medium" | "high" | "critical";

export type NotificationActionType = "navigate" | "url" | "none";

export type NotificationActionTarget =
  | "inventory"
  | "delivery"
  | "customer_debt"
  | "ai_insight"
  | "sales"
  | "stock-transfers"
  | "none";

export interface AppNotification {
  id: string;
  business_id: string;
  user_id: string | null;
  role: string | null; // e.g. Owner, Manager, Cashier, Rider
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  action_type: NotificationActionType;
  action_target: NotificationActionTarget;
  payload: string; // JSON payload
  read_at: string | null;
  clicked_at: string | null;
  created_at: string;
  expires_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  status: "pending" | "sent" | "delivered" | "failed";
  created_by: string;
  archived_at?: string | null;
}

export interface NotificationPreference {
  category: string; // e.g. "Stock Alerts", "AI Insights", etc.
  enabled: boolean;
}

export type ExpenseCategoryStatus = 'Enabled' | 'Disabled' | 'Archived';

export interface ExpenseCategory {
  id: string;
  name: string;
  status: ExpenseCategoryStatus;
  isCustom?: boolean;
  businessId?: string;
}

export interface Expense {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  staffName: string;
  businessId?: string;
  paymentMethod?: PaymentMethod;
  categoryId?: string;
  created_at?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  productSupplied: string;
  businessId?: string;
  created_at?: string;
}

export interface BackupConfig {
  googleSheetUrl: string;
  googleServiceAccount: string;
  schedule: string; // "nightly_12am" | "nightly_3am" | "every_12h"
  enabled: boolean;
}

export interface BackupHistoryLog {
  id: string;
  timestamp: string;
  type: "manual" | "auto";
  status: "success" | "failed";
  error?: string;
  retries: number;
  details?: Record<string, number>;
}

export interface CustomerLedgerEntry {
  id: string;
  businessId: string;
  customerId: string;
  type: 'wallet_topup' | 'wallet_usage' | 'debt_creation' | 'debt_payment' | 'debt_adjustment' | 'refund'
    /** Wallet credit from the referral programme, and the same taken back after a refund. */
    | 'referral_reward' | 'referral_reversal';
  amount: number;
  walletBalance: number;
  debtBalance: number;
  recordedBy: string;
  note?: string;
  transactionId?: string;
  referenceId?: string;
  created_at?: string;
}

export interface DebtPayment {
  id: string;
  businessId: string;
  customerId: string;
  amountPaid: number;
  remainingDebt: number;
  paymentMethod: MoneyMethod;
  recordedBy: string;
  note?: string;
  created_at?: string;
}

export type PaymentType = 'customer' | 'walk-in';

export interface Payment {
  id: string;
  businessId: string;
  referenceCode: string;
  amount: number;
  method: MoneyMethod;
  senderName: string;
  senderPhone?: string;
  status: 'Success' | 'Pending' | 'Failed' | 'Voided';
  date: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  customerId?: string;
  customerName?: string;
  paymentType?: PaymentType;
  description?: string;
  appliedTo?: 'none' | 'debt' | 'wallet' | 'mixed';
  debtApplied?: number;
  walletApplied?: number;
  referenceId?: string;
  recordedBy?: string;
  created_at?: string;
}

export interface MoneyAsset {
  id: string;
  businessId: string;
  method: MoneyMethod;
  balance: number;
  lastPaymentAt?: string;
  created_at?: string;
  updated_at?: string;
}

// ==========================================
// BILL OF MATERIALS (BOM) - Production Batching
// ==========================================

export interface BomIngredient {
  id: string;
  bomId: string;
  productId: string;
  productName?: string;
  quantityRequired: number;
  unit: string;
  wastePercentage: number;
  createdAt?: string;
}

export interface BillOfMaterials {
  id: string;
  businessId: string;
  productId: string;
  productName?: string;
  recipeId?: string;
  recipeName?: string;
  name: string;
  yieldQuantity: number;
  yieldUnit: string;
  ingredients: BomIngredient[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductionBatchInput {
  businessId: string;
  recipeId?: string;
  recipeName: string;
  productId?: string;
  bomId?: string;
  quantityProduced: number;
  unit: string;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Cancelled';
  staffName: string;
  date?: string;
}

export interface CancellationReturnItem {
  productId: string;
  returnQty: number;
  wasteReason?: string;
}

// ==========================================
// PENDING ACTIONS (AI Copilot Drafts)
// ==========================================

export type PendingActionType =
  // Sales & Orders
  | 'create_checkout'
  | 'create_sale'
  | 'update_sale'
  | 'cancel_sale'
  | 'create_order'
  | 'update_order'
  
  // Customers
  | 'create_customer'
  | 'update_customer'
  | 'delete_customer'
  
  // Products
  | 'create_product'
  | 'update_product'
  | 'delete_product'
  
  // Inventory
  | 'adjust_stock'
  | 'transfer_stock'
  | 'create_recipe_bom'
  | 'update_recipe_bom'
  | 'delete_recipe_bom'
  
  // Suppliers & Purchases
  | 'create_purchase'
  | 'update_purchase'
  | 'delete_purchase'
  | 'create_supplier'
  | 'update_supplier'
  | 'delete_supplier'
  
  // Employees & Shifts
  | 'create_employee'
  | 'update_employee'
  | 'delete_employee'
  | 'update_role'
  | 'create_shift'
  | 'clock_in'
  | 'clock_out'
  | 'update_shift'
  | 'delete_shift'
  
  // Finance (Wallets, Debts, Expenses)
  | 'create_expense'
  | 'update_expense'
  | 'delete_expense'
  | 'adjust_wallet'
  | 'settle_debt'
  
  // Communication
  | 'create_feedback_reply'
  | 'send_message'
  
  // Settings
  | 'update_settings';

export type PendingActionStatus = 'pending_review' | 'verified' | 'rejected' | 'executed';

export interface PendingActionValidation {
  isValid: boolean;
  hasPermission: boolean;
  hasStock: boolean;
  warnings: string[];
  errors: string[];
}

export interface PendingAction {
  id: string;
  businessId: string;
  type: PendingActionType;
  title: string;
  summary: string;
  requiredPermission: string;
  params: Record<string, any>;
  status: PendingActionStatus;
  createdAt: string;
  createdBy: string;
  validation: PendingActionValidation;
  /** What happened, shown on the chat card once it has run. */
  resultMessage?: string;
}


/** Money sent straight to the till, waiting for staff to say what it was. */
export interface TillPayment {
  id: string;
  transId: string;
  amount: number;
  msisdn?: string;
  payerName?: string;
  billRef?: string;
  transTime: string;
  status: 'unclaimed' | 'recorded' | 'matched_sale' | 'ignored';
  customerId?: string;
  paymentId?: string;
  handledBy?: string;
  handledAt?: string;
  note?: string;
}

/** A payment prompt (STK push) sent from the app. */
export type PromptProvider = 'mpesa' | 'airtel';

/** A payment prompt sent to a customer's phone, M-Pesa or Airtel Money. */
export interface PaymentPrompt {
  provider: PromptProvider;
  id: string;
  /** M-Pesa: CheckoutRequestID. Airtel: our transaction id. */
  reference: string;
  phone: string;
  amount: number;
  status: 'Pending' | 'Completed' | 'Failed';
  receiptNumber?: string;
  /** What the network said, in its words, when it said anything. */
  resultMessage?: string;
  resultCode?: string;
  customerId?: string;
  description?: string;
  requestedBy?: string;
  paymentId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface MpesaPrompt {
  id: string;
  checkoutRequestId: string;
  phone: string;
  amount: number;
  status: 'Pending' | 'Completed' | 'Failed';
  receiptNumber?: string;
  customerId?: string;
  accountReference?: string;
  description?: string;
  requestedBy?: string;
  paymentId?: string;
  createdAt: string;
}
