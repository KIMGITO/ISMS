// src/utils/permissions.ts
// Re-engineered Role-Based Access Control Matrix (RBAC) — Streamlined 5-Role Core

import { useAuthStore } from "../stores/authStore";
import { useNotificationStore } from "../stores/notificationStore";

export type PermissionCode =
  // Business
  | 'business.view'
  | 'business.create'
  | 'business.update'
  | 'business.delete'
  | 'business.switch'
  | 'business.view_all'
  // Settings
  | 'settings.view'
  | 'settings.update'
  | 'settings.theme'
  | 'settings.tax'
  | 'settings.delivery'
  | 'settings.integrations'
  | 'settings.storage'
  | 'settings.security'
  // Users & Staff
  | 'staff.view'
  | 'staff.invite'
  | 'staff.update'
  | 'staff.remove'
  | 'staff.roles'
  | 'users.view'
  | 'users.manage'
  | 'invitations.view'
  | 'invitations.create'
  | 'invitations.delete'
  // Products & Categories
  | 'products.view'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  | 'products.import'
  | 'products.export'
  | 'products.manage_categories'
  | 'products.manage_discounts'
  | 'products.manage_tax'
  | 'products.manage_images'
  // Inventory
  | 'inventory.view'
  | 'inventory.receive_stock'
  | 'inventory.adjust_stock'
  | 'inventory.transfer_stock'
  | 'inventory.stock_count'
  | 'inventory.stock_history'
  | 'inventory.wastage'
  | 'inventory.expiry'
  | 'inventory.import'
  | 'inventory.export'
  | 'inventory.manage'
  // POS & Checkout
  | 'pos.open_shift'
  | 'pos.close_shift'
  | 'pos.create_sale'
  | 'pos.cancel_sale'
  | 'pos.refund'
  | 'pos.discount'
  | 'pos.override_price'
  | 'pos.walkin_customer'
  | 'pos.manage'
  // Customers & Loyalty
  | 'customers.view'
  | 'customers.create'
  | 'customers.update'
  | 'customers.delete'
  | 'customers.import'
  | 'customers.export'
  | 'customers.debts'
  | 'customers.loyalty'
  | 'customers.schedules'
  | 'customers.manage'
  | 'loyalty.view'
  | 'loyalty.configure'
  | 'loyalty.adjust'
  // Orders & Deliveries
  | 'orders.view'
  | 'orders.create'
  | 'orders.update'
  | 'orders.cancel'
  | 'orders.complete'
  | 'orders.assign_rider'
  | 'orders.manage'
  | 'deliveries.view'
  | 'deliveries.create'
  | 'deliveries.assign'
  | 'deliveries.complete'
  | 'deliveries.cancel'
  | 'deliveries.delivery_price'
  | 'deliveries.delivery_zones'
  | 'deliveries.manage'
  // Suppliers & Purchases
  | 'suppliers.view'
  | 'suppliers.create'
  | 'suppliers.update'
  | 'suppliers.delete'
  | 'suppliers.import'
  | 'suppliers.export'
  | 'suppliers.manage'
  | 'purchases.view'
  | 'purchases.create'
  | 'purchases.update'
  | 'purchases.cancel'
  | 'purchases.approve'
  | 'purchases.export'
  | 'purchases.import'
  | 'purchases.print'
  | 'purchases.manage'
  // Production & Recipes
  | 'production.view'
  | 'production.create'
  | 'production.update'
  | 'production.delete'
  | 'production.approve'
  | 'production.export'
  | 'production.import'
  | 'production.manage'
  | 'bom.view'
  | 'bom.create'
  | 'bom.update'
  | 'bom.delete'
  | 'bom.manage'
  // Expenses & Payments
  | 'expenses.view'
  | 'expenses.create'
  | 'expenses.update'
  | 'expenses.delete'
  | 'expenses.export'
  | 'expenses.manage'
  | 'payments.view'
  | 'payments.verify'
  | 'payments.refund'
  | 'payments.mpesa'
  | 'payments.cash'
  | 'payments.manage'
  // Reports & AI
  | 'reports.view'
  | 'reports.sales'
  | 'reports.inventory'
  | 'reports.customers'
  | 'reports.profit'
  | 'reports.expenses'
  | 'reports.tax'
  | 'reports.deliveries'
  | 'reports.export'
  | 'reports.manage'
  | 'ai.use'
  | 'ai.configure'
  | 'ai.insights'
  | 'ai.manage'
  // Storage & Logs
  | 'notifications.view'
  | 'notifications.manage'
  | 'notifications.send'
  | 'communication.view'
  | 'communication.send'
  | 'audit.view'
  | 'audit.manage'
  | 'files.view'
  | 'files.manage'
  | 'assets.view'
  | 'assets.manage'
  | 'import.data'
  | 'export.data'
  | 'google.connect';

export interface RoleConfig {
  name: string;
  description: string;
  permissions: PermissionCode[];
}

export interface PermissionDetails {
  code: PermissionCode;
  category: string;
  description: string;
}

export const ALL_PERMISSIONS: PermissionDetails[] = [
  // Business & Settings
  { code: 'business.view', category: 'Business & Settings', description: 'View company details' },
  { code: 'business.create', category: 'Business & Settings', description: 'Create new business units' },
  { code: 'business.update', category: 'Business & Settings', description: 'Modify active company info' },
  { code: 'business.delete', category: 'Business & Settings', description: 'Delete business workspace' },
  { code: 'business.switch', category: 'Business & Settings', description: 'Switch active branch context' },
  { code: 'business.view_all', category: 'Business & Settings', description: 'Access all business contexts' },
  { code: 'settings.view', category: 'Business & Settings', description: 'Access configuration dashboards' },
  { code: 'settings.update', category: 'Business & Settings', description: 'Edit settings preferences' },
  { code: 'settings.theme', category: 'Business & Settings', description: 'Toggle user themes' },
  { code: 'settings.tax', category: 'Business & Settings', description: 'Configure KRA VAT rules' },
  { code: 'settings.delivery', category: 'Business & Settings', description: 'Configure courier parameters' },
  { code: 'settings.integrations', category: 'Business & Settings', description: 'Manage third-party API links' },
  { code: 'settings.storage', category: 'Business & Settings', description: 'Configure upload folders' },
  { code: 'settings.security', category: 'Business & Settings', description: 'Initiate security lockouts' },

  // Products & Inventory
  { code: 'products.view', category: 'Products & Inventory', description: 'Browse and search products catalog' },
  { code: 'products.create', category: 'Products & Inventory', description: 'Add new items to registry' },
  { code: 'products.update', category: 'Products & Inventory', description: 'Modify prices and products info' },
  { code: 'products.delete', category: 'Products & Inventory', description: 'Archive or remove product items' },
  { code: 'products.import', category: 'Products & Inventory', description: 'Bulk load products via CSV' },
  { code: 'products.export', category: 'Products & Inventory', description: 'Export products database' },
  { code: 'products.manage_categories', category: 'Products & Inventory', description: 'Configure product category filters' },
  { code: 'products.manage_discounts', category: 'Products & Inventory', description: 'Apply product-level discount codes' },
  { code: 'products.manage_tax', category: 'Products & Inventory', description: 'Override product tax tiers' },
  { code: 'products.manage_images', category: 'Products & Inventory', description: 'Update catalog covers' },
  { code: 'inventory.view', category: 'Products & Inventory', description: 'View current stock levels' },
  { code: 'inventory.receive_stock', category: 'Products & Inventory', description: 'Accept stock arrivals' },
  { code: 'inventory.adjust_stock', category: 'Products & Inventory', description: 'Log manual adjustments' },
  { code: 'inventory.transfer_stock', category: 'Products & Inventory', description: 'Move stock to other warehouses' },
  { code: 'inventory.stock_count', category: 'Products & Inventory', description: 'Perform shelf stock audits' },
  { code: 'inventory.stock_history', category: 'Products & Inventory', description: 'View stock logs timeline' },
  { code: 'inventory.wastage', category: 'Products & Inventory', description: 'Record milk spillages or spoilage' },
  { code: 'inventory.expiry', category: 'Products & Inventory', description: 'Track product batch expiry dates' },
  { code: 'inventory.import', category: 'Products & Inventory', description: 'Import stock count logs' },
  { code: 'inventory.export', category: 'Products & Inventory', description: 'Export inventory logs' },
  { code: 'inventory.manage', category: 'Products & Inventory', description: 'General inventory supervisor controls' },

  // POS & Checkout
  { code: 'pos.open_shift', category: 'POS & Checkout', description: 'Open cashier register drawer' },
  { code: 'pos.close_shift', category: 'POS & Checkout', description: 'Reconcile register at close' },
  { code: 'pos.create_sale', category: 'POS & Checkout', description: 'Checkout sales carts' },
  { code: 'pos.cancel_sale', category: 'POS & Checkout', description: 'Void draft checkout carts' },
  { code: 'pos.refund', category: 'POS & Checkout', description: 'Process customer cashbacks' },
  { code: 'pos.discount', category: 'POS & Checkout', description: 'Apply cart waivers' },
  { code: 'pos.override_price', category: 'POS & Checkout', description: 'Override default price rules' },
  { code: 'pos.walkin_customer', category: 'POS & Checkout', description: 'Bypass loyalty on quick checkouts' },
  { code: 'pos.manage', category: 'POS & Checkout', description: 'Edit checkout register profiles' },

  // Customers & Loyalty
  { code: 'customers.view', category: 'Customers & Loyalty', description: 'Access profiles registry' },
  { code: 'customers.create', category: 'Customers & Loyalty', description: 'Add new customers' },
  { code: 'customers.update', category: 'Customers & Loyalty', description: 'Edit contact information' },
  { code: 'customers.delete', category: 'Customers & Loyalty', description: 'Revoke customer accounts' },
  { code: 'customers.import', category: 'Customers & Loyalty', description: 'Bulk upload customer lists' },
  { code: 'customers.export', category: 'Customers & Loyalty', description: 'Export client list' },
  { code: 'customers.debts', category: 'Customers & Loyalty', description: 'Review credit accounts' },
  { code: 'customers.loyalty', category: 'Customers & Loyalty', description: 'Award membership tiers' },
  { code: 'customers.schedules', category: 'Customers & Loyalty', description: 'Manage milk delivery subscriptions' },
  { code: 'customers.manage', category: 'Customers & Loyalty', description: 'Configure customer settings' },
  { code: 'loyalty.view', category: 'Customers & Loyalty', description: 'View loyalty setups' },
  { code: 'loyalty.configure', category: 'Customers & Loyalty', description: 'Adjust point tier scales' },
  { code: 'loyalty.adjust', category: 'Customers & Loyalty', description: 'Manually override points' },

  // Orders & Deliveries
  { code: 'orders.view', category: 'Orders & Deliveries', description: 'Browse pending/synced order logs' },
  { code: 'orders.create', category: 'Orders & Deliveries', description: 'Create draft orders' },
  { code: 'orders.update', category: 'Orders & Deliveries', description: 'Modify pending order parameters' },
  { code: 'orders.cancel', category: 'Orders & Deliveries', description: 'Cancel client orders' },
  { code: 'orders.complete', category: 'Orders & Deliveries', description: 'Mark orders as completed' },
  { code: 'orders.assign_rider', category: 'Orders & Deliveries', description: 'Select rider for order shipment' },
  { code: 'orders.manage', category: 'Orders & Deliveries', description: 'Override order dispatch rules' },
  { code: 'deliveries.view', category: 'Orders & Deliveries', description: 'View courier route maps' },
  { code: 'deliveries.create', category: 'Orders & Deliveries', description: 'Initialize dispatch schedules' },
  { code: 'deliveries.assign', category: 'Orders & Deliveries', description: 'Assign routes to couriers' },
  { code: 'deliveries.complete', category: 'Orders & Deliveries', description: 'Mark deliveries as successfully completed' },
  { code: 'deliveries.cancel', category: 'Orders & Deliveries', description: 'Flag deliveries as failed' },
  { code: 'deliveries.delivery_price', category: 'Orders & Deliveries', description: 'Adjust delivery fee bands' },
  { code: 'deliveries.delivery_zones', category: 'Orders & Deliveries', description: 'Configure spatial delivery regions' },
  { code: 'deliveries.manage', category: 'Orders & Deliveries', description: 'Access courier fleet manager' },

  // Suppliers & Purchases
  { code: 'suppliers.view', category: 'Suppliers & Purchases', description: 'Access suppliers catalog' },
  { code: 'suppliers.create', category: 'Suppliers & Purchases', description: 'Register raw milk suppliers' },
  { code: 'suppliers.update', category: 'Suppliers & Purchases', description: 'Edit supplier profiles' },
  { code: 'suppliers.delete', category: 'Suppliers & Purchases', description: 'Remove supplier listings' },
  { code: 'suppliers.import', category: 'Suppliers & Purchases', description: 'Bulk load supplier contracts' },
  { code: 'suppliers.export', category: 'Suppliers & Purchases', description: 'Download suppliers list' },
  { code: 'suppliers.manage', category: 'Suppliers & Purchases', description: 'Reconcile supplier statements' },
  { code: 'purchases.view', category: 'Suppliers & Purchases', description: 'Browse purchases registry' },
  { code: 'purchases.create', category: 'Suppliers & Purchases', description: 'Create wholesale milk purchase orders' },
  { code: 'purchases.update', category: 'Suppliers & Purchases', description: 'Modify draft purchase orders' },
  { code: 'purchases.cancel', category: 'Suppliers & Purchases', description: 'Cancel raw milk orders' },
  { code: 'purchases.approve', category: 'Suppliers & Purchases', description: 'Approve purchases for delivery' },
  { code: 'purchases.export', category: 'Suppliers & Purchases', description: 'Download purchase history' },
  { code: 'purchases.import', category: 'Suppliers & Purchases', description: 'Load incoming supplier invoices' },
  { code: 'purchases.print', category: 'Suppliers & Purchases', description: 'Print purchase dossiers' },
  { code: 'purchases.manage', category: 'Suppliers & Purchases', description: 'Close purchase bills' },

  // Production & Recipes
  { code: 'production.view', category: 'Production & Recipes', description: 'Browse raw milk batches' },
  { code: 'production.create', category: 'Production & Recipes', description: 'Log pasteurization run' },
  { code: 'production.update', category: 'Production & Recipes', description: 'Edit processing values' },
  { code: 'production.delete', category: 'Production & Recipes', description: 'Discard production batch logs' },
  { code: 'production.approve', category: 'Production & Recipes', description: 'Approve batch test results' },
  { code: 'production.export', category: 'Production & Recipes', description: 'Download production reports' },
  { code: 'production.import', category: 'Production & Recipes', description: 'Import formula sheets' },
  { code: 'production.manage', category: 'Production & Recipes', description: 'Manage production schedule' },
  { code: 'bom.view', category: 'Production & Recipes', description: 'View recipes database' },
  { code: 'bom.create', category: 'Production & Recipes', description: 'Create product formulas' },
  { code: 'bom.update', category: 'Production & Recipes', description: 'Edit product ingredients list' },
  { code: 'bom.delete', category: 'Production & Recipes', description: 'Archive formula entries' },
  { code: 'bom.manage', category: 'Production & Recipes', description: 'Manage pricing markup rules' },

  // Expenses & Payments
  { code: 'expenses.view', category: 'Expenses & Payments', description: 'View expenses entries' },
  { code: 'expenses.create', category: 'Expenses & Payments', description: 'Log diesel, cooling costs' },
  { code: 'expenses.update', category: 'Expenses & Payments', description: 'Edit petty cash details' },
  { code: 'expenses.delete', category: 'Expenses & Payments', description: 'Delete expense logs' },
  { code: 'expenses.export', category: 'Expenses & Payments', description: 'Download expense registers' },
  { code: 'expenses.manage', category: 'Expenses & Payments', description: 'Adjust category budget limits' },
  { code: 'payments.view', category: 'Expenses & Payments', description: 'View cash/M-Pesa registers' },
  { code: 'payments.verify', category: 'Expenses & Payments', description: 'Verify payment claims' },
  { code: 'payments.refund', category: 'Expenses & Payments', description: 'Process payment chargebacks' },
  { code: 'payments.mpesa', category: 'Expenses & Payments', description: 'Trigger M-Pesa push API' },
  { code: 'payments.cash', category: 'Expenses & Payments', description: 'Accept physical cash ledger' },
  { code: 'payments.manage', category: 'Expenses & Payments', description: 'Audit payment configurations' },

  // Staff & Roles
  { code: 'staff.view', category: 'Staff & Roles', description: 'Access workers profiles' },
  { code: 'staff.invite', category: 'Staff & Roles', description: 'Issue join invitations' },
  { code: 'staff.update', category: 'Staff & Roles', description: 'Update profile permissions' },
  { code: 'staff.remove', category: 'Staff & Roles', description: 'Revoke staff memberships' },
  { code: 'staff.roles', category: 'Staff & Roles', description: 'Access roles assignment matrix' },
  { code: 'users.view', category: 'Staff & Roles', description: 'Browse system user entries' },
  { code: 'users.manage', category: 'Staff & Roles', description: 'Administer system login blocks' },
  { code: 'invitations.view', category: 'Staff & Roles', description: 'Review active email invitations' },
  { code: 'invitations.create', category: 'Staff & Roles', description: 'Issue invitation tokens' },
  { code: 'invitations.delete', category: 'Staff & Roles', description: 'Revoke invitation tokens' },

  // Notifications & Alerts
  { code: 'notifications.view', category: 'Notifications & Alerts', description: 'Review user notification lists' },
  { code: 'notifications.send', category: 'Notifications & Alerts', description: 'Broadcast message board updates' },
  { code: 'notifications.manage', category: 'Notifications & Alerts', description: 'Modify automated alert thresholds' },
  { code: 'communication.view', category: 'Notifications & Alerts', description: 'View the Customer Communication Center' },
  { code: 'communication.send', category: 'Notifications & Alerts', description: 'Send bulk messages to customers' },

  // Reports & AI
  { code: 'reports.view', category: 'Reports & AI', description: 'Access dashboard audit ledger' },
  { code: 'reports.sales', category: 'Reports & AI', description: 'View sales trends charts' },
  { code: 'reports.inventory', category: 'Reports & AI', description: 'Analyze weekly velocity counts' },
  { code: 'reports.customers', category: 'Reports & AI', description: 'Analyze customer cohorts' },
  { code: 'reports.profit', category: 'Reports & AI', description: 'Review gross profitability' },
  { code: 'reports.expenses', category: 'Reports & AI', description: 'Review operational cost categories' },
  { code: 'reports.tax', category: 'Reports & AI', description: 'Extract tax returns data' },
  { code: 'reports.deliveries', category: 'Reports & AI', description: 'Review delivery dispatch times' },
  { code: 'reports.export', category: 'Reports & AI', description: 'Download analytics dossiers' },
  { code: 'reports.manage', category: 'Reports & AI', description: 'Manage scheduled reporting jobs' },
  { code: 'ai.use', category: 'Reports & AI', description: 'Chat with Kim AI Assistant' },
  { code: 'ai.configure', category: 'Reports & AI', description: 'Modify AI system configuration instructions' },
  { code: 'ai.insights', category: 'Reports & AI', description: 'Query AI recommendations' },
  { code: 'ai.manage', category: 'Reports & AI', description: 'Edit Gemini API keys' },

  // Files & Audit Logs
  { code: 'audit.view', category: 'Files & Audit Logs', description: 'Access system audit logs' },
  { code: 'audit.manage', category: 'Files & Audit Logs', description: 'Flush audit logs database' },
  { code: 'files.view', category: 'Files & Audit Logs', description: 'Browse uploaded cloud folders' },
  { code: 'files.manage', category: 'Files & Audit Logs', description: 'Delete cloud storage records' },
  { code: 'assets.view', category: 'Files & Audit Logs', description: 'Browse business assets registry' },
  { code: 'assets.manage', category: 'Files & Audit Logs', description: 'Modify assets status conditions' },
  { code: 'import.data', category: 'Files & Audit Logs', description: 'Bulk upload backup JSON data' },
  { code: 'export.data', category: 'Files & Audit Logs', description: 'Export full database SQL/JSON' },
  { code: 'google.connect', category: 'Files & Audit Logs', description: 'Link direct spreadsheet pipelines' }
];

export const SYSTEM_ROLES: Record<string, RoleConfig> = {
  'Admin': {
    name: 'Admin',
    description: 'System administrator with total master access to everything',
    permissions: ALL_PERMISSIONS.map(p => p.code)
  },
  'Owner': {
    name: 'Owner',
    description: 'Business Master Owner. Full access across company branches and financial parameters.',
    permissions: ALL_PERMISSIONS.map(p => p.code)
  },
  'Manager': {
    name: 'Manager',
    description: 'Business supervisor. Oversees operations, inventory, customers and deliveries.',
    permissions: [
      'business.view', 'business.switch', 'settings.view', 'settings.update', 'settings.theme', 'settings.tax',
      'products.view', 'products.create', 'products.update', 'products.import', 'products.export', 'products.manage_categories',
      'inventory.view', 'inventory.receive_stock', 'inventory.adjust_stock', 'inventory.transfer_stock', 'inventory.stock_count', 'inventory.stock_history', 'inventory.wastage', 'inventory.expiry',
      'pos.open_shift', 'pos.close_shift', 'pos.create_sale', 'pos.walkin_customer',
      'customers.view', 'customers.create', 'customers.update', 'customers.loyalty', 'customers.schedules',
      'orders.view', 'orders.create', 'orders.update', 'orders.complete', 'orders.assign_rider',
      'deliveries.view', 'deliveries.create', 'deliveries.assign', 'deliveries.complete', 'deliveries.cancel',
      'suppliers.view', 'suppliers.create', 'suppliers.update', 'suppliers.import', 'suppliers.export',
      'purchases.view', 'purchases.create', 'purchases.update', 'purchases.approve', 'purchases.export', 'purchases.print',
      'production.view', 'production.create', 'production.update', 'production.approve',
      'bom.view', 'bom.create', 'bom.update',
      'expenses.view', 'expenses.create', 'expenses.update',
      'payments.view', 'payments.verify', 'payments.cash',
      'reports.view', 'reports.sales', 'reports.inventory', 'reports.customers', 'reports.profit', 'reports.deliveries',
      'notifications.view', 'notifications.send', 'communication.view', 'communication.send',
      'ai.use', 'ai.insights',
      'files.view', 'assets.view'
    ]
  },
  'Cashier': {
    name: 'Cashier',
    description: 'Point of Sale operator. Reconciles registers and runs milk sales.',
    permissions: [
      'business.view', 'settings.theme',
      'products.view', 'inventory.view',
      'pos.open_shift', 'pos.close_shift', 'pos.create_sale', 'pos.cancel_sale', 'pos.discount', 'pos.walkin_customer',
      'customers.view', 'customers.create', 'customers.loyalty', 'customers.schedules',
      'orders.view', 'orders.create', 'orders.update',
      'payments.cash', 'payments.mpesa', 'payments.verify',
      'notifications.view', 'ai.use'
    ]
  },
  'Rider': {
    name: 'Rider',
    description: 'Delivery personnel. Navigates routes, processes cashouts, and completes dispatches.',
    permissions: [
      'business.view', 'settings.theme',
      'customers.view', 'customers.schedules',
      'orders.view', 'orders.update',
      'deliveries.view', 'deliveries.complete', 'deliveries.cancel',
      'notifications.view', 'ai.use'
    ]
  }
};

export function getDynamicRoles(): Record<string, RoleConfig> {
  try {
    const saved = localStorage.getItem('kkm_dynamic_roles_v2');
    if (saved) {
      const parsed = JSON.parse(saved);
      const merged = { ...SYSTEM_ROLES };
      for (const roleKey of Object.keys(parsed)) {
        if (merged[roleKey]) {
          const existingPerms = parsed[roleKey].permissions || [];
          const systemPerms = SYSTEM_ROLES[roleKey].permissions || [];
          const uniquePerms = Array.from(new Set([...existingPerms, ...systemPerms]));
          merged[roleKey] = {
            ...SYSTEM_ROLES[roleKey],
            ...parsed[roleKey],
            permissions: uniquePerms
          };
        } else {
          // Only preserve if it matches our strict 5 core active positions
          if (['Owner', 'Admin', 'Manager', 'Cashier', 'Rider'].includes(roleKey)) {
            merged[roleKey] = parsed[roleKey];
          }
        }
      }
      return merged;
    }
  } catch (err) {
    console.error('Error loading dynamic roles', err);
  }
  return SYSTEM_ROLES;
}

export function saveDynamicRoles(roles: Record<string, RoleConfig>) {
  try {
    // Filter to ensure only our 5 main roles persist to local configuration overrides
    const filteredRoles: Record<string, RoleConfig> = {};
    ['Owner', 'Admin', 'Manager', 'Cashier', 'Rider'].forEach(rk => {
      if (roles[rk]) filteredRoles[rk] = roles[rk];
    });
    localStorage.setItem('kkm_dynamic_roles_v2', JSON.stringify(filteredRoles));
  } catch (err) {
    console.error('Error saving dynamic roles', err);
  }
}

export function hasRolePermission(role: string, permission: PermissionCode): boolean {
  const normRole = role || 'Guest';
  if (normRole === 'Admin' || normRole === 'Owner' || normRole === 'Administrator') return true; 
  
  // 1. Check database loaded permissions first
  try {
    const dbPerms = useAuthStore.getState().dbPermissions;
    if (dbPerms && dbPerms.length > 0) {
      const record = dbPerms.find(p => p.role === normRole && p.permission === permission);
      if (record) {
        return record.granted;
      }
    }
  } catch (err) {
    console.warn("Could not read database permissions, falling back to local files", err);
  }

  // 2. Fall back to local dynamic/system roles
  const dynamicRoles = getDynamicRoles();
  const roleConfig = dynamicRoles[normRole];
  if (!roleConfig) return false;
  return roleConfig.permissions.includes(permission);
}

export function checkPermissionGate(permission: PermissionCode): boolean {
  const currentEmployee = useAuthStore.getState().currentEmployee;
  if (!currentEmployee) {
    useNotificationStore.getState().showToast(
      "Access Denied",
      "No active session or employee profile loaded.",
      undefined,
      "error",
      "security"
    );
    return false;
  }
  const allowed = hasRolePermission(currentEmployee.role, permission);
  if (!allowed) {
    useNotificationStore.getState().showToast(
      "Permission Denied",
      `You do not have the required permission (${permission}) to perform this action.`,
      undefined,
      "error",
      "security"
    );
    return false;
  }
  return true;
}