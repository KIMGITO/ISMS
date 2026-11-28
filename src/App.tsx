import { useState, useEffect } from 'react';
import { useAppStore } from './stores/appStore';
import PreviewFrame from './components/PreviewFrame';
import { InteractiveGuide } from './components/InteractiveGuide';
import ClockBar from './components/ClockBar';
import SupplierPortalView from './features/SupplierPortalView';
import PlatformConsoleView from './features/PlatformConsoleView';
import ClaimPlatformAdminPrompt from './components/ClaimPlatformAdminPrompt';
import { setConsoleOpen, useConsoleOpen, usePlatformAdmin } from './utils/platformConsole';
import { useNotificationStore } from './stores/notificationStore';
import { NotificationRepository } from './services/notifications/notificationRepository';
import { hasRolePermission } from './utils/permissions';
import { isSupabaseConfigured } from './services/supabaseClient';
import { SystemHealthService } from './services/systemHealthService';
import { useAuthStore } from './stores/authStore';
import { useUiStore } from './stores/uiStore';
import { useKeyboardVisible } from './hooks/useKeyboardVisible';
import { AppDialogHost } from './components/AppDialog';
import { DeleteImpactHost } from './components/DeleteImpact';
import { FieldValidationHost } from './components/FieldValidation';
import { useOverlay } from './hooks/useOverlay';
import { WifiOff, RefreshCw } from 'lucide-react';
import { canOpenScreen, SCREENS, SCREEN_BY_ID } from './utils/screens';
import RingingAlerts from './components/RingingAlerts';
import { motion, AnimatePresence } from 'motion/react';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useShortcutBadges } from './hooks/useShortcutBadges';
import { ShortcutHelp } from './components/ShortcutTable';
import PlanBanner from './components/PlanBanner';
import SupportBanner from './components/support/SupportBanner';
import { tourStepsFor } from './app/tour';
import { AppToast } from './app/AppToast';
import { DbConnectScreen } from './app/DbConnectScreen';
import { TermsGate, termsAcceptedOnDevice } from './app/TermsGate';
import { AuthPortal } from './app/auth/AuthPortal';
import { useAuthFlow } from './app/auth/useAuthFlow';
import { Sidebar } from './app/Sidebar';
import { TopBar } from './app/TopBar';
import { ScreenRouter } from './app/ScreenRouter';
import { MobileNav } from './app/MobileNav';
import { BranchesModal } from './app/BranchesModal';
import { usePlanReady } from './app/usePlanReady';
import { useBranchChooser } from './app/useBranchChooser';
import { useDataSync } from './app/useDataSync';
import { useAppearance } from './app/useAppearance';
import { useBottomNavBehaviour } from './app/useBottomNavBehaviour';
import { useNativeShell } from './app/useNativeShell';
import type { ActiveBusiness, ThemeMode } from './app/types';

export default function App() {
  const isKeyboardVisible = useKeyboardVisible();
  const supplierAccounts = useAuthStore((st) => st.supplierAccounts);
  const {
    currentEmployee,
    showNav,
    activeTab,
    setActiveTab,
    businesses,
    activeBusinessId,
    currentUser,
    isInitializing,
    initializationError,
    performInitialization,
  } = useAppStore();


  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  // Keyboard shortcuts on every screen; each role only gets the ones it can use (utils/shortcuts.ts).
  useGlobalShortcuts({
    role: currentEmployee?.role,
    activeTab: activeTab as string,
    navigate: (tab) => { setShowShortcutHelp(false); setActiveTab(tab as any); },
    openSearch: () => {
      const box = document.querySelector('#global-search-container input') as HTMLInputElement | null;
      if (box && box.getClientRects().length > 0) box.focus();
      else setShowMobileSearch(true);
    },
    toggleHelp: () => setShowShortcutHelp((v) => !v),
    reload: () => void reloadNow(),
    goBack: () => useUiStore.getState().goBack(),
  });
  // Big screens: each button with a shortcut shows its key in its corner.
  useShortcutBadges(currentEmployee?.role, activeTab as string);




  // Updates, splash screen, Android Back button, and keeping typed-in fields above the keyboard.
  useNativeShell();

  const handleCloseTour = () => {
    setIsTourOpen(false);
    // Mark onboarding as completed so the tour doesn't auto-launch again
    localStorage.setItem('isms-onboarding-completed', 'true');
  };


  // Auto-launch the guided tour on first-ever app interaction (once per device).
  // The tour fires after a short delay once the user logs in, and only if
  // they haven't already completed or dismissed it on this device before.
  useEffect(() => {
    if (!currentEmployee) return;
    const completed = localStorage.getItem('isms-onboarding-completed');
    if (completed === 'true') return;
    // Give people a few seconds to look at the app before the tour appears.
    const timer = setTimeout(() => {
      setIsTourOpen(true);
    }, 6500);
    return () => clearTimeout(timer);
  }, [currentEmployee?.id]); // re-check whenever the logged-in user changes

  const activeBusiness: ActiveBusiness =
    businesses.find((b) => b.id === activeBusinessId) ||
    businesses[0] || {
      id: 'biz-1',
      name: "Denso",
      logoUrl: '/icon.png',
    };

  const assignableBranchesCount = currentEmployee
    ? hasRolePermission(currentEmployee.role, 'settings.view')
      ? businesses.length
      : (currentEmployee.assignedBranches || []).length || 1
    : 1;

  const [permissionVersion, setPermissionVersion] = useState(0);

  // The plan of the open branch's company decides which modules show; nothing opens before it is known.
  const { plan, planReady } = usePlanReady();

  // Platform console (SaaS step 7): part of this app, but only platform admins can open it,
  // and while it is open no business screen shows. The database refuses everyone else anyway.
  const isPlatformAdmin = usePlatformAdmin(currentUser?.isVerified ? currentUser.id : null);
  const consoleOpen = useConsoleOpen();
  const showConsole = !!currentUser?.isVerified && isPlatformAdmin && consoleOpen;

  // Someone in more than one branch picks the branch before any screen opens.
  const { showBranchChooser, setShowWorkspaceSwitcher, companyNames } = useBranchChooser();



  // Connectivity checking function & Auth State initialization
  useEffect(() => {
    SystemHealthService.start();
    const unsubscribe = useAuthStore.getState().initializeAuthStateListener();
    useNotificationStore.getState().init();
    return () => {
      SystemHealthService.stop();
      unsubscribe();
    };
  }, []);

  // Push registration and the phone's alarms start in authStore after sign-in.

  // Being offline shows as a thin strip under the header (no popups on every change),
  // with the number of sales still waiting on this device.


  // Listen to custom permission change event to trigger instant tab reactivity
  useEffect(() => {
    const handleUpdate = () => setPermissionVersion((v) => v + 1);
    window.addEventListener('permissionChange', handleUpdate);
    return () => window.removeEventListener('permissionChange', handleUpdate);
  }, []);

  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  useEffect(() => {
    return NotificationRepository.subscribe((rows) => {
      setUnreadNotificationsCount(rows.filter((r) => !r.read_at).length);
    });
  }, []);

  useEffect(() => {
    const handleNavigate = (e: any) => {
      const targetTab = e.detail?.tab;
      if (targetTab) {
        if (targetTab === 'inventory') {
          setActiveTab('inventory');
        } else if (targetTab === 'sales') {
          setActiveTab('sales');
        } else if (targetTab === 'customer_debt') {
          setActiveTab('customers');
        } else if (targetTab === 'ai_insight') {
          setActiveTab('ai');
        } else if (targetTab === 'delivery') {
          setActiveTab('sales');
        } else if (SCREEN_BY_ID.has(targetTab)) {
          setActiveTab(targetTab);
        }
      }
    };
    window.addEventListener('navigate-tab', handleNavigate);
    return () => window.removeEventListener('navigate-tab', handleNavigate);
  }, [setActiveTab]);



  // Theme state stored in localStorage
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => (localStorage.getItem('isms-theme') as ThemeMode) || 'light',
  );

  // Sidebar collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem('isms-sidebar-collapsed') === 'true',
  );


  // First-launch onboarding states
  const [supabaseConfiguredState, setSupabaseConfiguredState] = useState(() =>
    isSupabaseConfigured(),
  );
  const [termsAccepted, setTermsAccepted] = useState(termsAcceptedOnDevice);

  // Sign-in, sign-up and onboarding: state lives here so it survives the screens swapping.
  const auth = useAuthFlow();
  const { authViewTab, setAuthViewTab, setAuthError, setAuthSuccess, setAdminPlanCode } = auth;

  // Data loading, pull-to-refresh and the reload button.
  const { refreshKey, refreshApp, isReloading, reloadNow } = useDataSync();



  // Redirect to the first screen this role may open if the current one isn't allowed.
  // Uses the same rules as the menus (utils/screens), so a screen can't be listed but bounce.
  useEffect(() => {
    if (!currentEmployee) return;
    if (canOpenScreen(currentEmployee.role, activeTab as string)) return;
    const first = SCREENS.find((screen) => canOpenScreen(currentEmployee.role, screen.id));
    if (first && first.id !== activeTab) setActiveTab(first.id as any);
  }, [currentEmployee, activeTab, permissionVersion, plan]);




  // Offline: the top bar turns red, so the phone's status-bar icons switch to white.
  // The sign-in screens are always light, whatever the app theme.
  const onAuthScreen =
    !currentUser || !currentUser.isVerified || !currentEmployee || showBranchChooser;
  useAppearance(themeMode, onAuthScreen, activeBusiness);

  // Bottom nav: hides on scroll down or double-tap, comes back on scroll up and screen changes.
  useBottomNavBehaviour(isTourOpen, isKeyboardVisible);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('isms-sidebar-collapsed', String(next));
      return next;
    });
  };



  const isNavVisible = showNav && !isKeyboardVisible;
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [moreQuery, setMoreQuery] = useState('');
  useOverlay(isMoreOpen, () => setIsMoreOpen(false), 'bottom-sheet');
  useOverlay(showMobileSearch, () => setShowMobileSearch(false), 'other');
  useOverlay(showConsole, () => setConsoleOpen(false), 'screen');
  const authBackTo: 'login' | 'start' | null = currentEmployee || showConsole
    ? null
    : !currentUser
      ? (authViewTab !== 'login' ? 'login' : null)
      : currentUser.isVerified && (authViewTab === 'create-biz' || authViewTab === 'accept-invite')
        ? 'start'
        : null;
  useOverlay(!!authBackTo, () => {
    if (!authBackTo) return;
    setAuthError('');
    setAuthSuccess('');
    if (authBackTo === 'start') setAdminPlanCode(undefined);
    setAuthViewTab(authBackTo);
  }, 'screen');

  return (
    <PreviewFrame>
      <div className="w-full h-full flex flex-col relative bg-app-bg overflow-hidden text-app-text transition-colors duration-200">
        <ClaimPlatformAdminPrompt userId={currentUser?.isVerified ? currentUser.id : null} name={currentUser?.name} />
        {/* Toasts: a brief pill for your own actions, a card for alerts and messages */}
        <AppToast activeBusiness={activeBusiness} />

        <AnimatePresence mode="wait">
          {!supabaseConfiguredState ? (
            /* CLOUD DATABASE SYNC GATEWAY (ON FIRST LAUNCH ONLY) */
            <DbConnectScreen key="db-connect" onConnected={() => setSupabaseConfiguredState(true)} />
          ) : !termsAccepted ? (
            /* USER AGREEMENT BLOCKER (LAUNCH ONLY) */
            <TermsGate key="terms-accept" onAccepted={() => setTermsAccepted(true)} />
          ) : isInitializing ? (
            /* SLEEK INITIALIZATION SCREEN */
            <div className="flex-1 flex flex-col justify-center items-center bg-slate-950 text-slate-100 min-h-dvh">
              <div className="text-center space-y-4">
                <div className="flex justify-center mt-4">
                  <img src="/denso-animated-dark.svg" width={240} height={76} alt="Denso" />
                </div>
              </div>
            </div>
          ) : initializationError ? (
            /* SLEEK INITIALIZATION ERROR SCREEN */
            <div className="flex-1 min-h-0 flex flex-col items-center px-4 pt-[calc(1rem+var(--inset-top))] pb-[calc(1rem+var(--inset-bottom))] md:pt-[calc(2rem+var(--inset-top))] md:pb-[calc(2rem+var(--inset-bottom))] bg-slate-950 text-slate-100 overflow-y-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="my-auto shrink-0 w-full max-w-md bg-slate-900/80 border border-red-500/30 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 text-center relative overflow-hidden"
              >
                {/* Decorative glow */}

                <div className="mx-auto w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center text-red-500 shadow-xl">
                  <WifiOff size={28} />
                </div>

                <div className="space-y-2">
                  <h2 className="text-lg font-bold font-display tracking-tight text-red-400">
                    Connection Check Failed
                  </h2>
                  <p className="text-xs text-slate-350 leading-relaxed font-semibold">
                    {initializationError}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => performInitialization()}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-slate-950 font-semibold rounded-2xl text-xs cursor-pointer transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <RefreshCw size={14} />
                  <span>Retry Connection</span>
                </button>
              </motion.div>
            </div>
          ) : showConsole ? (
            /* PLATFORM CONSOLE: platform admins only, no business screens */
            <motion.div key="platform-console" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">
              <PlatformConsoleView
                themeMode={themeMode}
                onToggleTheme={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
                onClose={() => setConsoleOpen(false)}
              />
            </motion.div>
          ) : currentUser && currentUser.isVerified && !currentEmployee && supplierAccounts.length > 0 ? (
            /* SOMEONE AT A SUPPLIER: their own portal, no staff screens */
            <motion.div key="supplier-portal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">
              <SupplierPortalView themeMode={themeMode} onToggleTheme={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')} />
            </motion.div>
          ) : currentUser && currentUser.isVerified && currentEmployee && !showBranchChooser && !planReady ? (
            /* The plan of this branch is not known yet: nothing opens until it is */
            <div className="flex-1 flex flex-col justify-center items-center bg-slate-950 text-slate-100 min-h-dvh">
              <img src="/denso-loader.svg" width={96} height={96} alt="Loading" />
            </div>
          ) : !currentUser ||
            !currentUser.isVerified ||
            !currentEmployee ||
            showBranchChooser ? (
            /* ONLINE AUTHENTICATION & ONBOARDING PORTAL */
            <AuthPortal
                key="auth-portal"
              auth={auth}
              showBranchChooser={showBranchChooser}
              companyNames={companyNames}
              isPlatformAdmin={isPlatformAdmin}
              onCloseBranchChooser={() => setShowWorkspaceSwitcher(false)}
              onOpenBranchChooser={() => setShowWorkspaceSwitcher(true)}
            />
          ) : (
            /* COMPACT LOGGED-IN MAIN WORKSPACE VIEW */
            <motion.div
              key="workspace"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col md:flex-row overflow-hidden bg-app-bg"
            >
              <Sidebar
                activeBusiness={activeBusiness}
                assignableBranchesCount={assignableBranchesCount}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapsed={toggleSidebar}
                showBusinessDropdown={showBusinessDropdown}
                setShowBusinessDropdown={setShowBusinessDropdown}
                themeMode={themeMode}
                setThemeMode={setThemeMode}
                onStartTour={() => setIsTourOpen(true)}
                unreadNotificationsCount={unreadNotificationsCount}
              />

              {/* MAIN CONTENT SECTION */}
              <div className="flex-1 flex flex-col overflow-hidden relative font-sans">
                <TopBar
                  activeBusiness={activeBusiness}
                  assignableBranchesCount={assignableBranchesCount}
                  showBusinessDropdown={showBusinessDropdown}
                  setShowBusinessDropdown={setShowBusinessDropdown}
                  showMobileSearch={showMobileSearch}
                  setShowMobileSearch={setShowMobileSearch}
                  isReloading={isReloading}
                  onReload={reloadNow}
                  unreadNotificationsCount={unreadNotificationsCount}
                />
                <ClockBar />
                <PlanBanner />
                <SupportBanner />

                <ScreenRouter
                  refreshKey={refreshKey}
                  onRefresh={refreshApp}
                  isPlatformAdmin={isPlatformAdmin}
                  onStartTour={() => setIsTourOpen(true)}
                />

                <MobileNav
                  activeBusiness={activeBusiness}
                  isNavVisible={isNavVisible}
                  isKeyboardVisible={isKeyboardVisible}
                  isMoreOpen={isMoreOpen}
                  setIsMoreOpen={setIsMoreOpen}
                  moreQuery={moreQuery}
                  setMoreQuery={setMoreQuery}
                  themeMode={themeMode}
                  setThemeMode={setThemeMode}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <BranchesModal open={showBusinessDropdown} onClose={() => setShowBusinessDropdown(false)} />

        {/* In-app dialogs and field messages instead of the browser's own boxes and bubbles */}
        <AppDialogHost />
        <DeleteImpactHost />
        <FieldValidationHost />

        <ShortcutHelp open={showShortcutHelp} screen={activeTab as string} onClose={() => setShowShortcutHelp(false)} />
        <RingingAlerts />

        {/* Interactive Onboarding Tour Guide */}
        <InteractiveGuide
          isOpen={isTourOpen}
          steps={tourStepsFor(currentEmployee?.role)}
          onClose={handleCloseTour}
          onStepChange={(tab) => setActiveTab(tab as any)}
          onMoreSheet={(open) => {
            if (open) setMoreQuery('');
            setIsMoreOpen(open);
          }}
        />
      </div>
    </PreviewFrame>
  );
}
