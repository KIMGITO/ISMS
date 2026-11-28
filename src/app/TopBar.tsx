// Top bar of the workspace (it carries the status-bar inset): branch, search, reload,
// payment prompts, unclaimed payments and the bell. Below it, the offline strip.
import { useAppStore } from '../stores/appStore';
import type { ActiveBusiness } from './types';
import GlobalSearch from '../components/GlobalSearch';
import { usePromptProviders } from '../features/PaymentPromptView';
import UnclaimedPaymentsIndicator from '../components/payments/UnclaimedPaymentsIndicator';
import { useTransactionStore } from '../stores/transactionStore';
import { Search, X, WifiOff, Bell, CloudOff, RefreshCw, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';


export function TopBar({
  activeBusiness,
  assignableBranchesCount,
  showBusinessDropdown,
  setShowBusinessDropdown,
  showMobileSearch,
  setShowMobileSearch,
  isReloading,
  onReload,
  unreadNotificationsCount,
}: {
  activeBusiness: ActiveBusiness;
  assignableBranchesCount: number;
  showBusinessDropdown: boolean;
  setShowBusinessDropdown: (open: boolean) => void;
  showMobileSearch: boolean;
  setShowMobileSearch: (open: boolean) => void;
  isReloading: boolean;
  onReload: () => Promise<void>;
  unreadNotificationsCount: number;
}) {
  const { isOnline, activeTab, setActiveTab } = useAppStore();
  // Waiting offline sales show in the strip under the bar.
  const offlineSalesCount = useTransactionStore((s) => s.offlineSales.length);
  // Networks this person can send payment prompts with; shows the quick prompt button.
  const promptProviders = usePromptProviders();
  return (
    <>
      {/* TOP APPLICATION BAR (it carries the status-bar inset) */}
      <header
        className={`app-header border-b px-1 md:px-3 py-1.5 flex items-center justify-between gap-3 shrink-0 shadow-xs z-30 min-h-14 transition-colors duration-300 ${
          isOnline ? 'bg-app-card border-app-border' : 'bg-red-600 border-red-700'
        }`}
        style={{
          paddingTop:
            'calc(0.375rem + var(--inset-top))',
          backgroundImage: isOnline && activeBusiness?.coverImageUrl
            ? `linear-gradient(to right, rgba(15, 23, 42, 0.85), rgba(15, 23, 42, 0.75)), url(${activeBusiness.coverImageUrl})`
            : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {showMobileSearch ? (
          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1">
              <GlobalSearch
                autoFocus
                onNavigateTab={(tab) => {
                  setActiveTab(tab);
                  setShowMobileSearch(false);
                }}
              />
            </div>
            <button
              onClick={() => setShowMobileSearch(false)}
              className="p-1.5 bg-app-bg border border-app-border text-app-text-muted hover:text-app-text rounded-lg transition cursor-pointer shrink-0"
              title="Close Search"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <>
            {/* Brand Logo or Indicator for mobile/tablet only */}
            <div
              id="mobile-brand-header"
              onClick={() => {
                if (assignableBranchesCount > 1) {
                  setShowBusinessDropdown(!showBusinessDropdown);
                }
              }}
              className={`flex items-center gap-1.5 shrink-0 md:hidden select-none ${
                assignableBranchesCount > 1
                  ? 'cursor-pointer'
                  : 'cursor-default'
              }`}
              title={
                assignableBranchesCount > 1
                  ? 'Click to switch branch'
                  : undefined
              }
            >
              <img
                src={
                  activeBusiness.logoUrl ||
                  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E"
                }
                alt={activeBusiness.name}
                className="w-7 h-7 rounded-lg object-cover shrink-0 shadow-xs border border-amber-500/20"
                referrerPolicy="no-referrer"
              />
              <span className="font-display font-semibold text-xs text-app-text hidden md:hidden lg:inline-block">
                {activeBusiness.name}
              </span>
              {assignableBranchesCount > 1 && (
                <span className="text-[11px] text-amber-500">▼</span>
              )}
            </div>

            {/* Desktop dummy spacer for balanced layout */}
            <div className="hidden md:block shrink-0" />

            {/* Global Unified Search Bar */}
            <div
              id="global-search-container"
              className="flex-1 max-w-sm hidden md:block"
            >
              <GlobalSearch
                onNavigateTab={(tab) => setActiveTab(tab)}
              />
            </div>

            {/* Offline: says so in the red bar; work keeps going and syncs when back online */}
            {!isOnline && (
              <div
                role="status"
                aria-live="polite"
                className="flex-1 min-w-0 flex items-center justify-center md:justify-end gap-1.5 text-white"
              >
                <WifiOff size={15} className="shrink-0" />
                <span className="text-xs font-bold truncate">
                  Offline<span className="font-medium opacity-90 hidden min-[380px]:inline"> · changes will sync later</span>
                </span>
              </div>
            )}

            {/* Top Right Action Items */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Search icon for mobile only */}
              <button
                onClick={() => setShowMobileSearch(true)}
                className="p-2 md:hidden bg-app-bg border border-app-border text-app-text hover:bg-app-card rounded-xl transition cursor-pointer"
                title="Search App"
              >
                <Search size={16} />
              </button>

              {/* Reload on big screens; phones pull down instead */}
              <button
                id="header-reload"
                onClick={() => void onReload()}
                disabled={isReloading}
                className="hidden md:flex p-2 bg-app-bg border border-app-border text-app-text hover:bg-app-card rounded-xl transition cursor-pointer disabled:opacity-60"
                title="Reload the latest data (F5 or Ctrl+R)"
                aria-label="Reload"
              >
                <RefreshCw size={16} className={isReloading ? 'animate-spin' : ''} />
              </button>

              {/* Payment prompts, one tap from any screen */}
              {promptProviders.length > 0 && (
                <button
                  id="header-payment-prompt"
                  onClick={() => setActiveTab('prompt')}
                  className={`p-2 rounded-xl border transition cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'prompt'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                      : 'bg-app-bg border-app-border text-app-text hover:text-app-text'
                  }`}
                  title="Send a payment prompt (G then M)"
                  aria-label="Send a payment prompt"
                >
                  <Send size={16} />
                  <span className="hidden lg:inline text-xs font-bold">Prompt</span>
                </button>
              )}

              {/* Till payments still to match, from any screen (POS and Quick Sale too) */}
              <UnclaimedPaymentsIndicator />

              {/* Notification Bell Icon (Always visible) */}
              <button
                id="header-notification-bell"
                onClick={() => setActiveTab('notifications')}
                className={`p-2 rounded-xl border transition cursor-pointer relative ${
                  activeTab === 'notifications'
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                    : 'bg-app-bg border-app-border text-app-text hover:text-app-text'
                }`}
                title="System Message Center"
              >
                <Bell
                  size={16}
                  className={
                    unreadNotificationsCount > 0
                      ? 'animate-swing'
                      : ''
                  }
                />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-amber-500 text-slate-950 font-semibold rounded-full w-3.5 h-3.5 text-[11px] flex items-center justify-center shadow-sm">
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>

            </div>
          </>
        )}
      </header>

      <AnimatePresence initial={false}>
        {(!isOnline || offlineSalesCount > 0) && (
          <motion.div
            key="offline-strip"
            role="status"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="shrink-0 overflow-hidden bg-rose-600/12 text-rose-700 dark:text-rose-300 text-xs font-medium text-center"
          >
            <div className="py-1 inline-flex items-center justify-center gap-1.5 w-full">
              <CloudOff size={13} aria-hidden="true" />
              {!isOnline ? 'Offline' : 'Syncing'}
              {offlineSalesCount > 0
                ? ` · ${offlineSalesCount} sale${offlineSalesCount === 1 ? '' : 's'} waiting to sync`
                : " · sales save on this phone and sync when you're back"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
