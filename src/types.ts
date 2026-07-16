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

export type PaymentMethod = 'Cash' | 'Card' | 'Mobile_Wallet' | 'M-Pesa' | 'Credit_Debt' | 'Bank' | 'Credit' | 'Other';

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
  deliveryFee?: number;
  riderName?: string;
  businessId?: string;
}

export type CustomerTier = 'Bronze' | 'Silver' | 'Gold';

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
  businessId?: string;
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
  repeat: 'None' | 'Daily' | 'Weekly';
  color: string;
  reminderSent: boolean;
  createdBy: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdjustmentType = 'Restock' | 'Damage' | 'Reconciliation';

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
  | "Low Cash Balance"
  | "Debt Due Reminder"
  | "Delivery Assigned"
  | "Delivery Completed"
  | "Payment Received"
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
  status: "pending" | "delivered" | "failed";
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
  type: 'wallet_topup' | 'wallet_usage' | 'debt_creation' | 'debt_payment' | 'debt_adjustment' | 'refund';
  amount: number;
  walletBalance: number;
  debtBalance: number;
  recordedBy: string;
  note?: string;
  transactionId?: string;
  created_at?: string;
}

export interface DebtPayment {
  id: string;
  businessId: string;
  customerId: string;
  amountPaid: number;
  remainingDebt: number;
  paymentMethod: 'Cash' | 'M-Pesa';
  recordedBy: string;
  note?: string;
  created_at?: string;
}

export interface Payment {
  id: string;
  businessId: string;
  referenceCode: string;
  amount: number;
  method: 'M-Pesa' | 'Cash' | 'Card' | 'Bank';
  senderName: string;
  senderPhone?: string;
  status: 'Success' | 'Pending' | 'Failed';
  date: string;
  created_at?: string;
}



