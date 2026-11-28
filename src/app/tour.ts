// The first-run tour of the app shell. Steps for screens a role can't open are left out.
import type { TourStep } from '../components/InteractiveGuide';
import { canOpenScreen } from '../utils/screens';
import { hasRolePermission } from '../utils/permissions';

// Each step with a tab is only shown to roles that can open that screen (see utils/screens.ts).
const tourSteps: TourStep[] = [
  {
    title: "Welcome to Denso",
    content: "A quick tour of the screens you can use.",
    placement: 'bottom',
  },
  {
    targetSelector: '#sidebar-brand-header',
    title: 'Your business',
    content: 'The branch you are working in. Switch here if you work at more than one; screens, cart and figures change to that branch.',
    placement: 'right',
  },
  {
    targetSelector: '#clock-bar',
    title: 'Clock in and out',
    content: 'Clock in when you start and out when you finish. Clocking out sends the shift report.',
    placement: 'bottom',
  },
  {
    targetSelector: '#sidebar-tab-home',
    title: 'Home',
    content: 'Sales, stock and customer figures.',
    placement: 'right',
    tab: 'home',
  },
  {
    targetSelector: '#sidebar-tab-dashboard',
    title: 'Shift',
    content: 'Your shift so far: time on shift, sales and deliveries.',
    placement: 'right',
    tab: 'dashboard',
  },
  {
    targetSelector: '#sidebar-tab-sell',
    title: 'Quick Sale',
    content: 'Pick products, choose how the customer pays, done.',
    placement: 'right',
    tab: 'sell',
  },
  {
    targetSelector: '#sidebar-tab-pos',
    title: 'POS',
    content: 'The full checkout, with a cart, discounts, customers and credit.',
    placement: 'right',
    tab: 'pos',
  },
  {
    targetSelector: '#sidebar-tab-inventory',
    title: 'Inventory',
    content: 'Products, stock levels and categories. Record restocks, wastage and counts here.',
    placement: 'right',
    tab: 'inventory',
  },
  {
    targetSelector: '#sidebar-tab-stock-history',
    title: 'Stock History',
    content: 'Every restock, wastage, count, transfer and production change to stock, with who did it.',
    placement: 'right',
    tab: 'stock-history',
  },
  {
    targetSelector: '#sidebar-tab-stock-transfers',
    title: 'Stock Transfers',
    content: 'Send stock to another branch, ask one for stock, and confirm what arrived. A transfer is not a sale, so profit does not change.',
    placement: 'right',
    tab: 'stock-transfers',
  },
  {
    targetSelector: '#sidebar-tab-buying',
    title: 'Buying',
    content: 'Suppliers, orders, deliveries and bills. See what is running low and how much to order.',
    placement: 'right',
    tab: 'buying',
  },
  {
    targetSelector: '#sidebar-tab-sales',
    title: 'Sales Log',
    content: 'Every sale and its receipt. Reprint or share a receipt from here, or refund it: the sale stays and a credit note is made.',
    placement: 'right',
    tab: 'sales',
  },
  {
    targetSelector: '#sidebar-tab-customers',
    title: 'Customers',
    content: 'Customers, their debts, wallets and invoices.',
    placement: 'right',
    tab: 'customers',
  },
  {
    targetSelector: '#sidebar-tab-promotions',
    title: 'Promotions & Points',
    content: 'Switch points on or off, set what a point is worth, and see the points report. Promo codes and referrals are here too.',
    placement: 'right',
    tab: 'promotions',
    permissions: ['loyalty.configure'],
  },
  {
    targetSelector: '#sidebar-tab-money',
    title: 'Payments & Expenses',
    content: 'Record payments and expenses, and match M-Pesa till payments to customers.',
    placement: 'right',
    tab: 'money',
  },
  {
    targetSelector: '#sidebar-tab-prompt',
    title: 'Payment Prompts',
    content: 'Send an M-Pesa or Airtel Money prompt to a customer\'s phone and see when it is paid.',
    placement: 'right',
    tab: 'prompt',
    permissions: ['payments.mpesa', 'payments.airtel'],
    desktopOnly: true,
  },
  {
    targetSelector: '#sidebar-tab-petty-cash',
    title: 'Petty Cash',
    content: 'Record money taken from the till to spend, and what it was spent on.',
    placement: 'right',
    tab: 'petty-cash',
  },
  {
    targetSelector: '#sidebar-tab-audit',
    title: 'Audit Log',
    content: 'Who changed what: product prices, suppliers, purchases, assets, files, and staff PINs and roles.',
    placement: 'right',
    tab: 'audit',
  },
  {
    targetSelector: '#sidebar-tab-finance',
    title: 'Finance & Accounting',
    content: 'Profit, money in and out, debts and VAT. The books update from every sale, expense and payment.',
    placement: 'right',
    tab: 'finance',
  },
  {
    targetSelector: '#sidebar-tab-deliveries',
    title: 'Deliveries',
    content: 'Delivery requests, each rider\'s deliveries, and delivery areas.',
    placement: 'right',
    tab: 'deliveries',
  },
  {
    targetSelector: '#sidebar-tab-online-store',
    title: 'Online orders',
    content: 'Orders and messages from customers using the website.',
    placement: 'right',
    tab: 'online-store',
  },
  {
    targetSelector: '#sidebar-tab-website',
    title: 'Your website',
    content: 'Brand, design, home page, pages and menu. Changes stay in a draft until you publish.',
    placement: 'right',
    tab: 'website',
    permissions: ['business.update'],
  },
  {
    targetSelector: '#sidebar-tab-marketing',
    title: 'Marketing',
    content: 'Campaigns with banners, cards, videos and pop-ups on your website, on a schedule, with real figures.',
    placement: 'right',
    tab: 'marketing',
    permissions: ['marketing.view', 'marketing.manage'],
  },
  {
    targetSelector: '#sidebar-tab-feedback',
    title: 'Feedback',
    content: 'Reviews, suggestions and complaints from customers.',
    placement: 'right',
    tab: 'feedback',
  },
  {
    targetSelector: '#sidebar-tab-workers',
    title: 'Workers',
    content: 'Your team, invitations and schedules.',
    placement: 'right',
    tab: 'workers',
  },
  {
    targetSelector: '#sidebar-tab-ai',
    title: 'Assistant',
    content: 'Ask questions about your sales, stock and customers.',
    placement: 'right',
    tab: 'ai',
  },
  {
    targetSelector: '#sidebar-tab-permissions',
    title: 'Roles',
    content: 'What each role can see and do.',
    placement: 'right',
    tab: 'permissions',
  },
  {
    targetSelector: '#sidebar-tab-production',
    title: 'Production & BOM',
    content: 'Recipes and production batches.',
    placement: 'right',
    tab: 'production',
  },
  {
    targetSelector: '#sidebar-tab-business-management',
    title: 'Business Management',
    content: 'Branches, business details, logo, colours and tax.',
    placement: 'right',
    tab: 'business-management',
  },
  {
    targetSelector: '#sidebar-tab-settings',
    title: 'Settings',
    content: 'Receipts, printers, SMS, WhatsApp and backups.',
    placement: 'right',
    tab: 'settings',
  },
  {
    targetSelector: '#sidebar-tab-profile',
    title: 'My Profile',
    content: 'Your name, photo and password.',
    placement: 'right',
    tab: 'profile',
  },
  {
    targetSelector: '#sidebar-tab-about',
    title: 'About this app',
    content: 'Your version, updates and keyboard shortcuts.',
    placement: 'right',
    tab: 'about',
  },
  {
    targetSelector: '#mobile-tab-more',
    title: 'More',
    content: 'Screens that don\'t fit on the bar, including Settings and About.',
    placement: 'top',
  },
  {
    targetSelector: '#global-search-container',
    title: 'Search',
    content: 'Find any screen, product, customer, receipt or setting.',
    placement: 'bottom',
  },
  {
    title: 'Keyboard shortcuts',
    content: 'Ctrl+K searches, ? shows the shortcuts for this screen, and G then a letter opens a screen (G then P for POS). The full list is in About this app.',
    placement: 'bottom',
    desktopOnly: true,
  },
  {
    targetSelector: '#header-notification-bell',
    title: 'Notifications',
    content: 'Low stock, M-Pesa payments, shift reports and other alerts.',
    placement: 'left',
  },
  {
    targetSelector: '#restart-tour-button',
    title: 'Take the tour again',
    content: 'Start this tour again any time from here.',
    placement: 'right',
  },
];

/** The tour for one role: steps for screens it can't open are left out. */
export function tourStepsFor(role: string | undefined): TourStep[] {
  const onPhone = typeof window !== 'undefined' && window.innerWidth < 768;
  return tourSteps.filter((step) => {
    if (step.tab && !canOpenScreen(role, step.tab)) return false;
    if (step.permissions?.length && !(role && step.permissions.some((code) => hasRolePermission(role, code as any)))) return false;
    if (step.desktopOnly && onPhone) return false;
    // "More" only exists on phones.
    if (step.targetSelector === '#mobile-tab-more' && !onPhone) return false;
    return true;
  });
}
