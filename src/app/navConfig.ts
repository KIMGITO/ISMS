// Screen permissions, screen motion and the mobile tab list used by the app shell (App.tsx).
import {
  Activity,
  ArrowRightLeft,
  BadgePercent,
  Bot,
  Boxes,
  Building,
  CalendarClock,
  ClipboardList,
  Clock,
  Coins,
  FileBarChart,
  FlaskConical,
  Globe,
  Heart,
  History,
  Home,
  Inbox,
  Info,
  Key,
  Megaphone,
  MessageSquare,
  PieChart,
  Receipt,
  Send,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Truck,
  User,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { SCREEN_BY_ID } from '../utils/screens';

// Anyone holding one of these sees the Payments screen; each of its tabs checks its own.
export const MONEY_PERMISSIONS = SCREEN_BY_ID.get('money')!.permissions;
export const BUYING_PERMISSIONS = SCREEN_BY_ID.get('buying')!.permissions;
export const FINANCE_PERMISSIONS = SCREEN_BY_ID.get('finance')!.permissions;
export const PROMPT_PERMISSIONS = SCREEN_BY_ID.get('prompt')!.permissions;
export const TRANSFER_PERMISSIONS = SCREEN_BY_ID.get('stock-transfers')!.permissions;
export const STOCK_REPORT_PERMISSIONS = SCREEN_BY_ID.get('stock-report')!.permissions;
export const PROMOTION_PERMISSIONS = SCREEN_BY_ID.get('promotions')!.permissions;
export const MARKETING_PERMISSIONS = SCREEN_BY_ID.get('marketing')!.permissions;
export const REGULAR_ORDER_PERMISSIONS = SCREEN_BY_ID.get('regular-orders')!.permissions;

// Screens slide in like iOS: a short push with iOS easing, the old one eases out.
export const SCREEN_MOTION = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  // Screens swap in "wait" mode, so the old one leaves quickly and the new one glides in.
  exit: { opacity: 0, x: -12, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] as const } },
  transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] as const },
};

// Every tab the mobile bar or its "More" sheet can show. Order and placement come from arrangeMobileNav.
export const MOBILE_TABS = [
  { id: 'home', label: 'Home', icon: Home, permission: 'home.view' },
  { id: 'dashboard', label: 'Shift', icon: Clock, permission: 'dashboard.view' },
  { id: 'sell', label: 'Sell', icon: Zap, permission: 'pos.create_sale' },
  { id: 'pos', label: 'POS', icon: ShoppingCart, permission: 'pos.create_sale' },
  { id: 'inventory', label: 'Inventory', icon: Boxes, permission: 'inventory.view' },
  { id: 'stock-history', label: 'Stock History', icon: History, permission: 'inventory.stock_history' },
  { id: 'stock-report', label: 'Stock Report', icon: FileBarChart, permission: STOCK_REPORT_PERMISSIONS },
  { id: 'stock-transfers', label: 'Transfers', icon: ArrowRightLeft, permission: TRANSFER_PERMISSIONS },
  { id: 'sales', label: 'Sales Log', icon: Receipt, permission: 'orders.view' },
  { id: 'buying', label: 'Buying', icon: ClipboardList, permission: BUYING_PERMISSIONS },
  { id: 'customers', label: 'Customers', icon: Heart, permission: 'customers.view' },
  { id: 'feedback', label: 'Feedback', icon: MessageSquare, permission: 'complaints.view' },
  { id: 'online-store', label: 'Online orders', icon: ShoppingBag, permission: 'customers.view' },
  { id: 'website', label: 'Website', icon: Globe, permission: 'business.update' },
  { id: 'marketing', label: 'Marketing', icon: Megaphone, permission: MARKETING_PERMISSIONS },
  { id: 'promotions', label: 'Promotions', icon: BadgePercent, permission: PROMOTION_PERMISSIONS },
  { id: 'regular-orders', label: 'Regular Orders', icon: CalendarClock, permission: REGULAR_ORDER_PERMISSIONS },
  { id: 'deliveries', label: 'Deliveries', icon: Truck, permission: 'deliveries.view' },
  { id: 'workers', label: 'Workers', icon: Users, permission: 'staff.view' },
  { id: 'permissions', label: 'Roles', icon: Key, permission: 'staff.roles' },
  { id: 'ai', label: 'Assistant', icon: Bot, permission: 'ai.use' },
  { id: 'profile', label: 'Profile', icon: User, permission: 'dashboard.view' },
  { id: 'business-management', label: 'Business', icon: Building, permission: 'business.update' },
  { id: 'money', label: 'Payments', icon: Wallet, permission: MONEY_PERMISSIONS },
  { id: 'prompt', label: 'Prompts', icon: Send, permission: PROMPT_PERMISSIONS },
  { id: 'unclaimed-payments', label: 'Unclaimed', icon: Inbox, permission: ['payments.verify', 'payments.mpesa'] as const },
  { id: 'petty-cash', label: 'Petty Cash', icon: Coins, permission: 'pettycash.record' },
  { id: 'finance', label: 'Finance', icon: PieChart, permission: FINANCE_PERMISSIONS },
  { id: 'production', label: 'BOM', icon: FlaskConical, permission: 'bom.view' },
  { id: 'audit', label: 'Audit Log', icon: Activity, permission: 'audit.view' },
  { id: 'settings', label: 'Settings', icon: Settings, permission: 'settings.view' },
  { id: 'about', label: 'About', icon: Info, permission: 'about' },
] as const;

