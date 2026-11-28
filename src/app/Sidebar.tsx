// Side menu for tablets and big screens: branch header, profile badge, the grouped
// screens with their G-key shortcuts, and the tour and theme buttons.
import { useAppStore } from '../stores/appStore';
import type { ActiveBusiness, ThemeMode } from './types';
import React from 'react';
import { useCartStore } from '../stores/cartStore';
import { useUnclaimedPaymentsStore } from '../stores/unclaimedPaymentsStore';
import { Zap, Boxes, Receipt, Users, Bot, Sun, Moon, HelpCircle, ChevronLeft, ChevronRight, Key, User, Clock, ShoppingCart, Heart, Settings, MessageSquare, Home, Building, Globe, Megaphone, ShoppingBag, BadgePercent, Coins, FlaskConical, Truck, Activity, Info, Wallet, History, ArrowRightLeft, PieChart, ClipboardList, Send, FileBarChart, CalendarClock } from 'lucide-react';
import { canOpenScreen, SCREEN_BY_ID, screenOrder, type ScreenId } from '../utils/screens';
import { GO_TO_KEYS, goToLabel } from '../utils/shortcuts';
import { MONEY_PERMISSIONS, BUYING_PERMISSIONS, FINANCE_PERMISSIONS, PROMPT_PERMISSIONS, TRANSFER_PERMISSIONS, STOCK_REPORT_PERMISSIONS, PROMOTION_PERMISSIONS, MARKETING_PERMISSIONS, REGULAR_ORDER_PERMISSIONS } from './navConfig';


export function Sidebar({
  activeBusiness,
  assignableBranchesCount,
  isCollapsed: isSidebarCollapsed,
  onToggleCollapsed: toggleSidebar,
  showBusinessDropdown,
  setShowBusinessDropdown,
  themeMode,
  setThemeMode,
  onStartTour,
  unreadNotificationsCount,
}: {
  activeBusiness: ActiveBusiness;
  assignableBranchesCount: number;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  showBusinessDropdown: boolean;
  setShowBusinessDropdown: (open: boolean) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  onStartTour: () => void;
  unreadNotificationsCount: number;
}) {
  const { currentEmployee, activeTab, setActiveTab, showToast } = useAppStore();
  const cart = useCartStore((s) => s.cart);
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const unclaimedCount = useUnclaimedPaymentsStore((s) => s.unclaimedCount);
  return (
    <>
      {/* SIDEBAR NAVIGATION FOR LARGE SCREENS & TABLETS */}
      <aside
        className={`hidden md:flex flex-col bg-app-card border-r border-app-border transition-all duration-300 shrink-0 z-30 select-none ${
          isSidebarCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {/* Brand / Expand Toggle Header */}
        <div
          id="sidebar-brand-header"
          className={`relative border-b border-app-border shrink-0 transition-all duration-300 bg-app-card ${
            isSidebarCollapsed
              ? 'p-4 flex flex-col items-center justify-center gap-4'
              : 'h-40'
          }`}
        >
          {isSidebarCollapsed ? (
            <div className="flex flex-col items-center gap-4 w-full">
              <div
                onClick={() => {
                  if (assignableBranchesCount > 1) {
                    setShowBusinessDropdown(!showBusinessDropdown);
                  }
                }}
                className={`select-none group/brand shrink-0 transition-opacity ${
                  assignableBranchesCount > 1
                    ? 'cursor-pointer hover:opacity-90'
                    : 'cursor-default'
                }`}
                title={
                  assignableBranchesCount > 1
                    ? 'Click to switch branch'
                    : undefined
                }
              >
                {activeBusiness.logoUrl ? (
                  <img
                    src={activeBusiness.logoUrl}
                    alt={activeBusiness.name}
                    className="w-10 h-10 rounded-full object-cover shadow-sm border border-app-border"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-slate-800 flex items-center justify-center border border-amber-500/20 transition-colors duration-300">
                    <Building size={18} className="text-amber-500" />
                  </div>
                )}
              </div>
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded-lg hover:bg-app-bg text-app-text-muted transition cursor-pointer shrink-0"
                title="Expand Sidebar"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col w-full h-full relative">
              {/* Cover Photo Banner Area */}
              <div className="relative h-20 w-full shrink-0 bg-amber-500/10 dark:bg-amber-500/5">
                {(activeBusiness as any).coverImageUrl && (
                  <img
                    src={(activeBusiness as any).coverImageUrl}
                    alt="Cover"
                    className="w-full h-full object-cover filter brightness-[0.85] dark:brightness-[0.6] transition-all duration-300"
                    referrerPolicy="no-referrer"
                  />
                )}

                {/* Top-Right Toggle Button Overlay */}
                <div className="absolute top-2 right-2 z-10">
                  <button
                    onClick={toggleSidebar}
                    className="p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm transition cursor-pointer"
                    title="Collapse Sidebar"
                  >
                    <ChevronLeft size={14} />
                  </button>
                </div>
              </div>

              {/* Profile Section (Overlapping Logo & Text) */}
              <div className="relative flex-1 px-3 pb-3 bg-app-card">
                {/* Overlapping Logo (Twitter-style avatar placement) */}
                <div className="absolute -top-7 left-3 p-1 bg-app-card rounded-full z-10 shadow-sm">
                  <div
                    onClick={() => {
                      if (assignableBranchesCount > 1)
                        setShowBusinessDropdown(!showBusinessDropdown);
                    }}
                    className={`w-12 h-12 rounded-full overflow-hidden bg-app-bg ${
                      assignableBranchesCount > 1
                        ? 'cursor-pointer hover:opacity-90'
                        : 'cursor-default'
                    }`}
                  >
                    {activeBusiness.logoUrl ? (
                      <img
                        src={activeBusiness.logoUrl}
                        alt={activeBusiness.name}
                        className="w-full h-full object-cover border border-app-border/50 rounded-full"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center border border-app-border/50 rounded-full bg-amber-100 dark:bg-slate-800">
                        <Building
                          size={20}
                          className="text-amber-500"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Branch Badge / Spacer (Pushed to the right of the overlapping logo) */}
                <div className="flex justify-end pt-2">
                  {assignableBranchesCount > 1 ? (
                    <button
                      onClick={() =>
                        setShowBusinessDropdown(!showBusinessDropdown)
                      }
                      className="px-2.5 py-0.5 text-[11px] bg-app-bg border border-app-border hover:border-amber-500/50 text-app-text font-bold rounded-full transition cursor-pointer"
                    >
                      Switch ▾
                    </button>
                  ) : (
                    <div className="h-5" />
                  )}
                </div>

                {/* Business Name Block */}
                <div
                  onClick={() => {
                    if (assignableBranchesCount > 1)
                      setShowBusinessDropdown(!showBusinessDropdown);
                  }}
                  className={`mt-1 min-w-0 flex flex-col select-none group/brand ${
                    assignableBranchesCount > 1
                      ? 'cursor-pointer'
                      : 'cursor-default'
                  }`}
                >
                  <span className="font-display font-semibold text-[14px] text-app-text whitespace-nowrap leading-tight truncate">
                    {activeBusiness.name}
                  </span>
                  <span className="text-[10px] text-app-text-muted font-medium mt-0.5 truncate">
                    {activeBusiness.address || 'Main branch'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Profile Badge (Collapsible) */}
        {!isSidebarCollapsed && currentEmployee && (
          <div
            onClick={() => setActiveTab('profile')}
            className="mx-3 my-4 p-2.5 bg-app-card hover:bg-app-bg border border-app-border hover:border-amber-500/40 rounded-2xl flex items-center gap-3 shrink-0 cursor-pointer group transition-all duration-300 shadow-sm animate-fade-in"
          >
            {/* Avatar with Status Indicator */}
            <div className="relative shrink-0">
              <img
                src={currentEmployee.avatar}
                alt={currentEmployee.name}
                className="w-10 h-10 rounded-xl object-cover border border-app-border group-hover:border-amber-500/50 transition-colors"
                referrerPolicy="no-referrer"
              />
              {/* Green Online/Active Dot */}
              <span
                className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-app-card rounded-full"
                title="Active Shift"
              />
            </div>

            {/* User Details */}
            <div className="min-w-0 flex-1">
              <h4 className="text-[12px] font-semibold text-app-text truncate group-hover:text-amber-500 transition-colors">
                {currentEmployee.name}
              </h4>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[11px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded font-semibold truncate">
                  {currentEmployee.role}
                </span>
              </div>
            </div>

            {/* Hover Action Chevron */}
            <div className="shrink-0 text-app-text-muted group-hover:text-amber-500 transition-all duration-300 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0">
              <ChevronRight size={14} />
            </div>
          </div>
        )}

        {/* Navigation items (Sidebar) */}
        <nav className="flex-1 p-2.5 flex flex-col gap-1 overflow-y-auto">
          {[
            {
              id: 'home',
              icon: Home,
              permission: 'home.view' as const,
            },
            {
              id: 'dashboard',
              icon: Clock,
              permission: 'dashboard.view' as const,
            },
            {
              id: 'sell',
              icon: Zap,
              permission: 'pos.create_sale' as const,
            },
            {
              id: 'pos',
              icon: ShoppingCart,
              permission: 'pos.create_sale' as const,
            },
            {
              id: 'inventory',
              icon: Boxes,
              permission: 'inventory.view' as const,
            },
            {
              id: 'stock-history',
              icon: History,
              permission: 'inventory.stock_history' as const,
            },
            {
              id: 'stock-report',
              icon: FileBarChart,
              permission: STOCK_REPORT_PERMISSIONS,
            },
            {
              id: 'stock-transfers',
              icon: ArrowRightLeft,
              permission: TRANSFER_PERMISSIONS,
            },
            {
              id: 'buying',
              icon: ClipboardList,
              permission: BUYING_PERMISSIONS,
            },
            {
              id: 'sales',
              icon: Receipt,
              permission: 'orders.view' as const,
            },
            {
              id: 'customers',
              icon: Heart,
              permission: 'customers.view' as const,
            },
            {
              id: 'regular-orders',
              icon: CalendarClock,
              permission: REGULAR_ORDER_PERMISSIONS,
            },
            {
              id: 'deliveries',
              icon: Truck,
              permission: 'deliveries.view' as const,
            },
            {
              id: 'feedback',
              icon: MessageSquare,
              permission: 'complaints.view' as const,
            },
            {
              id: 'online-store',
              icon: ShoppingBag,
              permission: 'online_store.view' as const,
            },
            {
              id: 'website',
              icon: Globe,
              permission: 'business.update' as const,
            },
            {
              id: 'marketing',
              icon: Megaphone,
              permission: MARKETING_PERMISSIONS,
            },
            {
              id: 'promotions',
              icon: BadgePercent,
              permission: PROMOTION_PERMISSIONS,
            },
            {
              id: 'workers',
              icon: Users,
              permission: 'staff.view' as const,
            },
            {
              id: 'permissions',
              icon: Key,
              permission: 'staff.roles' as const,
            },
            {
              id: 'ai',
              icon: Bot,
              permission: 'ai.use' as const,
            },
            {
              id: 'profile',
              icon: User,
              permission: 'dashboard.view' as const,
            },
            {
              id: 'business-management',
              icon: Building,
              permission: 'business.update' as const,
            },
            {
              id: 'money',
              icon: Wallet,
              permission: MONEY_PERMISSIONS,
            },
            {
              id: 'prompt',
              icon: Send,
              permission: PROMPT_PERMISSIONS,
            },
            {
              id: 'petty-cash',
              icon: Coins,
              permission: 'pettycash.record' as const,
            },
            {
              id: 'finance',
              icon: PieChart,
              permission: FINANCE_PERMISSIONS,
            },
            {
              id: 'production',
              icon: FlaskConical,
              permission: 'bom.view' as const,
            },
            {
              id: 'audit',
              icon: Activity,
              permission: 'audit.view' as const,
            },
            {
              id: 'settings',
              icon: Settings,
              permission: 'settings.view' as const,
            },
            {
              id: 'about',
              icon: Info,
              permission: 'dashboard.view' as const,
            },
          ]
            // Names and subtitles come from the screens registry, so the sidebar, the
            // phone menu, search, the tour and each page's title all agree.
            .map((tab) => {
              const screen = SCREEN_BY_ID.get(tab.id as ScreenId);
              return { ...tab, label: screen?.title ?? tab.id, desc: screen?.description ?? '' };
            })
            .filter((tab) =>
              currentEmployee
                ? canOpenScreen(currentEmployee.role, tab.id)
                : false,
            )
            // Grouped like the phone's More sheet, so related screens sit together.
            // Home always comes first, on its own, above the groups.
            .sort((a, b) => {
              if (a.id === 'home' || b.id === 'home') return a.id === 'home' ? -1 : b.id === 'home' ? 1 : 0;
              return screenOrder(a.id) - screenOrder(b.id);
            })
            .map((tab, index, list) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const group = tab.id === 'home' ? undefined : SCREEN_BY_ID.get(tab.id as any)?.group;
              const startsGroup = index === 0 || list[index - 1].id === 'home' || SCREEN_BY_ID.get(list[index - 1].id as any)?.group !== group;

              return (
                <React.Fragment key={tab.id}>
                {startsGroup && group && (
                  isSidebarCollapsed
                    ? index > 0 && <div className="my-1 mx-2 border-t border-app-border/60" aria-hidden="true" />
                    : <div className={`px-3 pb-1 text-[10px] font-bold text-app-text-muted ${index > 0 ? 'pt-3' : ''}`}>{group}</div>
                )}
                <button
                  id={`sidebar-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all relative group cursor-pointer text-left ${
                    isActive
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-500 font-bold'
                      : 'hover:bg-app-bg text-app-text-muted'
                  }`}
                  title={isSidebarCollapsed ? `${tab.label}${goToLabel(tab.id as ScreenId) ? ` (${goToLabel(tab.id as ScreenId)})` : ''}` : undefined}
                >
                  {tab.id === 'profile' ? (
                    <img
                      src={
                        currentEmployee?.avatar ||
                        "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E"
                      }
                      alt="Profile"
                      className={`w-5 h-5 rounded-full object-cover shrink-0 transition-all ${
                        isActive
                          ? 'ring-2 ring-amber-500 shadow-xs'
                          : 'border border-app-border/70'
                      }`}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Icon
                      size={18}
                      className={isActive ? 'text-amber-500' : ''}
                    />
                  )}

                  {!isSidebarCollapsed ? (
                    <>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs block font-bold text-app-text">
                          {tab.label}
                        </span>
                        <span className="text-[11px] text-app-text-muted block font-medium mt-0.5 truncate">
                          {tab.desc}
                        </span>
                      </div>
                      {/* Its keyboard shortcut, greyed on the right: G then this letter */}
                      {GO_TO_KEYS[tab.id as ScreenId] &&
                        !(tab.id === 'pos' && cartItemsCount > 0) &&
                        !(tab.id === 'notifications' && unreadNotificationsCount > 0) && (
                        <kbd
                          className="shrink-0 font-mono text-[11px] font-semibold text-app-text-muted/70 tracking-wider"
                          title={`Press ${goToLabel(tab.id as ScreenId)}`}
                          aria-label={`Shortcut ${goToLabel(tab.id as ScreenId)}`}
                        >
                          G {GO_TO_KEYS[tab.id as ScreenId]!.toUpperCase()}
                        </kbd>
                      )}
                    </>
                  ) : (
                    /* Compact Hover Tooltip */
                    <div className="absolute left-16 bg-slate-950 text-white text-[10px] font-semibold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap shadow-xl border border-slate-800 z-50">
                      {tab.label}
                    </div>
                  )}

                  {tab.id === 'pos' && cartItemsCount > 0 && (
                    <span
                      className={`absolute bg-amber-500 text-slate-950 font-semibold rounded-full flex items-center justify-center shadow-xs ${
                        isSidebarCollapsed
                          ? 'top-1.5 right-1.5 w-4.5 h-4.5 text-[11px]'
                          : 'right-3.5 top-1/2 -translate-y-1/2 min-w-[20px] h-5 px-1.5 text-[10px]'
                      }`}
                    >
                      {cartItemsCount}
                    </span>
                  )}

                  {tab.id === 'unclaimed-payments' && unclaimedCount > 0 && (
                    <span
                      className={`absolute bg-amber-500 text-slate-950 font-bold rounded-full flex items-center justify-center shadow-xs ${
                        isSidebarCollapsed
                          ? 'top-1.5 right-1.5 w-4 h-4 text-[10px]'
                          : 'right-4 top-1/2 -translate-y-1/2 min-w-[20px] h-5 px-1.5 text-[10px] z-20'
                      }`}
                    >
                      {unclaimedCount}
                    </span>
                  )}

                  {tab.id === 'notifications' &&
                    unreadNotificationsCount > 0 && (
                      <span
                        className={`absolute bg-amber-500 text-slate-950 font-semibold rounded-full flex items-center justify-center shadow-xs ${
                          isSidebarCollapsed
                            ? 'top-1.5 right-1.5 w-4.5 h-4.5 text-[11px]'
                            : 'right-3.5 top-1/2 -translate-y-1/2 min-w-[20px] h-5 px-1.5 text-[10px]'
                        }`}
                      >
                        {unreadNotificationsCount}
                      </span>
                    )}

                  {isActive && (
                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-amber-500 rounded-r" />
                  )}
                </button>
                </React.Fragment>
              );
            })}
        </nav>

        {/* Sidebar Sticky Controls Footer */}
        <div className="p-3 border-t border-app-border flex flex-col gap-2 shrink-0">
          {/* Interactive Tour Onboarding button */}
          <button
            id="restart-tour-button"
            onClick={() => {
              onStartTour();
              showToast(
                'Tour started',
                'Guided onboarding walkthrough started.',
                undefined,
                'success',
              );
            }}
            className="w-full flex items-center justify-center gap-2.5 p-2 bg-app-bg hover:bg-app-card border border-app-border text-app-text rounded-xl transition text-[11px] font-bold cursor-pointer"
            title="Interactive User Tour"
          >
            <HelpCircle size={13} className="text-amber-500" />
            {!isSidebarCollapsed && <span>Interactive Tour</span>}
          </button>

          {/* Dark Mode Theme toggle */}
          <button
            onClick={() =>
              setThemeMode(themeMode === 'light' ? 'dark' : 'light')
            }
            className="w-full flex items-center justify-center gap-2.5 p-2 bg-app-bg hover:bg-app-card border border-app-border text-app-text rounded-xl transition text-[11px] font-bold cursor-pointer"
          >
            {themeMode === 'light' ? (
              <Moon size={13} />
            ) : (
              <Sun size={13} />
            )}
            {!isSidebarCollapsed && (
              <span>
                {themeMode === 'light' ? 'Dark Theme' : 'Light Theme'}
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
