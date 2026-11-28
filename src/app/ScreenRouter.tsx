// The open screen: one slide-in view per tab, each behind its permission check.
// Pull down from the top of a screen to refresh it.
import { useAppStore } from '../stores/appStore';
import POSView from '../features/POSView';
import QuickSaleView from '../features/QuickSaleView';
import PullToRefresh from '../components/PullToRefresh';
import AboutView from '../features/AboutView';
import InventoryView from '../features/InventoryView';
import StockHistoryView from '../features/StockHistoryView';
import StockReportView from '../features/StockReportView';
import StockTransfersView from '../features/StockTransfersView';
import SalesView from '../features/SalesView';
import CustomersView from '../features/CustomersView';
import DashboardView from '../features/DashboardView';
import WorkspaceAssistantView from '../features/WorkspaceAssistantView';
import WorkersView from '../features/WorkersView';
import PermissionsView from '../features/PermissionsView';
import ProfileView from '../features/ProfileView';
import SettingsView from '../features/SettingsView';
import NotificationsView from '../features/NotificationsView';
import BusinessManagementView from '../features/BusinessManagementView';
import CustomerFeedbackView from '../features/CustomerFeedbackView';
import HomeView from '../features/HomeView';
import ProductionBOMView from '../features/ProductionBOMView';
import OnlineStoreView from '../features/OnlineStoreView';
import WebsiteView from '../features/website/WebsiteView';
import MarketingView from '../features/marketing/MarketingView';
import RiderDeliveriesView from '../features/RiderDeliveriesView';
import RegularOrdersView from '../features/RegularOrdersView';
import PettyCashView from '../features/PettyCashView';
import PaymentPromptView from '../features/PaymentPromptView';
import UnclaimedPaymentsView from '../features/UnclaimedPaymentsView';
import AccountingView from '../features/AccountingView';
import BuyingView from '../features/BuyingView';
import { setConsoleOpen } from '../utils/platformConsole';
import AuditLogView from '../features/AuditLogView';
import PromotionsView from '../features/PromotionsView';
import SecurityGuard from '../components/SecurityGuard';
import { motion, AnimatePresence } from 'motion/react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MONEY_PERMISSIONS, BUYING_PERMISSIONS, FINANCE_PERMISSIONS, PROMPT_PERMISSIONS, TRANSFER_PERMISSIONS, STOCK_REPORT_PERMISSIONS, PROMOTION_PERMISSIONS, MARKETING_PERMISSIONS, REGULAR_ORDER_PERMISSIONS, SCREEN_MOTION } from './navConfig';


export function ScreenRouter({
  refreshKey,
  onRefresh,
  isPlatformAdmin,
  onStartTour,
}: {
  /** Bumped by a refresh: every screen is rebuilt and loads its data again. */
  refreshKey: number;
  onRefresh: () => Promise<void>;
  isPlatformAdmin: boolean;
  onStartTour: () => void;
}) {
  const { activeTab, activeBusinessId } = useAppStore();
  return (
    <>
      {/* CORE VIEWPORT CARDS: pull down from the top of a screen to refresh
          (app-screens: phone edge spacing in index.css) */}
      <PullToRefresh onRefresh={onRefresh} className="app-viewport flex-1 overflow-hidden relative">
        {/* Keyed by branch too: switching branch rebuilds every screen, so nothing a
            screen loaded or was editing for the old branch carries over. */}
        <ErrorBoundary key={`${refreshKey}:${activeBusinessId}`} resetKey={activeTab}>
        <AnimatePresence mode="wait">
          {activeTab === 'sell' && (
            <motion.div
              key="sell-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="pos.create_sale">
                <QuickSaleView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'pos' && (
            <motion.div
              key="pos-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="pos.create_sale">
                <POSView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'inventory' && (
            <motion.div
              key="inv-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="inventory.view">
                <InventoryView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'stock-history' && (
            <motion.div
              key="stock-history-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="inventory.stock_history">
                <StockHistoryView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'stock-report' && (
            <motion.div
              key="stock-report-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission={STOCK_REPORT_PERMISSIONS as any}>
                <StockReportView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'stock-transfers' && (
            <motion.div
              key="stock-transfers-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission={TRANSFER_PERMISSIONS as any}>
                <StockTransfersView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'sales' && (
            <motion.div
              key="sales-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="orders.view">
                <SalesView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'home' && (
            <motion.div
              key="home-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="home.view">
                <HomeView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'customers' && (
            <motion.div
              key="cust-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="customers.view">
                <CustomersView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'dashboard' && (
            <motion.div
              key="dash-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="dashboard.view">
                <DashboardView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'ai' && (
            <motion.div
              key="ai-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="ai.use">
                <WorkspaceAssistantView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'website' && (
            <motion.div
              key="website-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="business.update">
                <WebsiteView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'marketing' && (
            <motion.div
              key="marketing-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission={MARKETING_PERMISSIONS as any}>
                <MarketingView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'online-store' && (
            <motion.div
              key="online-store-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="online_store.view">
                <OnlineStoreView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'promotions' && (
            <motion.div
              key="promotions-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission={PROMOTION_PERMISSIONS as any}>
                <PromotionsView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'regular-orders' && (
            <motion.div
              key="regular-orders-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission={REGULAR_ORDER_PERMISSIONS as any}>
                <RegularOrdersView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'deliveries' && (
            <motion.div
              key="deliveries-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="deliveries.view">
                <RiderDeliveriesView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'workers' && (
            <motion.div
              key="workers-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="staff.view">
                <WorkersView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'permissions' && (
            <motion.div
              key="permissions-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="staff.roles">
                <PermissionsView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'feedback' && (
            <motion.div
              key="feedback-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="complaints.view">
                <CustomerFeedbackView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'profile' && (
            <motion.div
              key="profile-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <ProfileView
                onRestartTour={onStartTour}
                onOpenConsole={isPlatformAdmin ? () => setConsoleOpen(true) : undefined}
              />
            </motion.div>
          )}
          {activeTab === 'settings' && (
            <motion.div
              key="settings-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="settings.view">
                <SettingsView
                  onRestartTour={onStartTour}
                />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'business-management' && (
            <motion.div
              key="business-management-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="business.update">
                <BusinessManagementView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'money' && (
            <motion.div
              key="money-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission={MONEY_PERMISSIONS as any}>
                <BusinessManagementView section="money" />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'prompt' && (
            <motion.div
              key="prompt-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission={PROMPT_PERMISSIONS as any}>
                <PaymentPromptView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'unclaimed-payments' && (
            <motion.div
              key="unclaimed-payments-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard
                permission={['payments.verify', 'payments.mpesa'] as any}
              >
                <UnclaimedPaymentsView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'petty-cash' && (
            <motion.div
              key="petty-cash-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission="pettycash.record">
                <PettyCashView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'finance' && (
            <motion.div
              key="finance-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <SecurityGuard permission={FINANCE_PERMISSIONS as any}>
                <AccountingView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'buying' && (
            <motion.div key="buying-view" {...SCREEN_MOTION} className="absolute inset-0">
              <SecurityGuard permission={BUYING_PERMISSIONS as any}>
                <BuyingView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'production' && (
            <motion.div
              key="production-view"
              {...SCREEN_MOTION}
              className="absolute inset-0 flex flex-col overflow-hidden"
            >
              <SecurityGuard permission="bom.view">
                <ProductionBOMView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'audit' && (
            <motion.div key="audit-view" {...SCREEN_MOTION} className="absolute inset-0">
              <SecurityGuard permission="audit.view">
                <AuditLogView />
              </SecurityGuard>
            </motion.div>
          )}
          {activeTab === 'notifications' && (
            <motion.div
              key="notifications-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <NotificationsView />
            </motion.div>
          )}
          {activeTab === 'about' && (
            <motion.div
              key="about-view"
              {...SCREEN_MOTION}
              className="absolute inset-0"
            >
              <AboutView />
            </motion.div>
          )}
        </AnimatePresence>
        </ErrorBoundary>
      </PullToRefresh>
    </>
  );
}
