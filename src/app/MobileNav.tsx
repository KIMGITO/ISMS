// Phones: the floating bottom bar (hides on scroll or double-tap), its "More" sheet with
// every other screen grouped and searchable, and the edge handle on the Assistant page.
import { useAppStore } from '../stores/appStore';
import type { ActiveBusiness, ThemeMode } from './types';
import { useCartStore } from '../stores/cartStore';
import { useUnclaimedPaymentsStore } from '../stores/unclaimedPaymentsStore';
import { Search, X, Sun, Moon, ChevronRight, Menu } from 'lucide-react';
import { arrangeMobileNav, MORE_TAB_ID } from '../utils/mobileNav';
import { canOpenScreen, SCREEN_BY_ID, SCREEN_GROUPS, screenOrder } from '../utils/screens';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { MOBILE_TABS } from './navConfig';


export function MobileNav({
  activeBusiness,
  isNavVisible,
  isKeyboardVisible,
  isMoreOpen,
  setIsMoreOpen,
  moreQuery,
  setMoreQuery,
  themeMode,
  setThemeMode,
}: {
  activeBusiness: ActiveBusiness;
  /** Shown: the person's choice (showNav) and no keyboard open. */
  isNavVisible: boolean;
  isKeyboardVisible: boolean;
  isMoreOpen: boolean;
  setIsMoreOpen: (open: boolean) => void;
  moreQuery: string;
  setMoreQuery: (query: string) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}) {
  const { currentEmployee, activeTab, setActiveTab, showNav, setShowNav } = useAppStore();
  const cart = useCartStore((s) => s.cart);
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const unclaimedCount = useUnclaimedPaymentsStore((s) => s.unclaimedCount);
  const moreDragControls = useDragControls();
  return (
    <>
      {/* Edge handle that shows/hides the bottom nav: only on the AI page,
          where the nav can cover the chat box (mobile only) */}
      {currentEmployee && activeTab === 'ai' && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{
            opacity: isKeyboardVisible ? 0 : 1,
            pointerEvents: isKeyboardVisible ? 'none' : 'auto',
          }}
          onClick={() => setShowNav(!showNav)}
          style={{
            bottom: 'calc(var(--mobile-nav-height) + var(--mobile-nav-gap) * 2 + var(--inset-bottom))',
            right: 'var(--inset-right)',
          }}
          className="fixed z-40 md:hidden bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur-md text-amber-500 border-y border-l border-amber-500/20 w-3.5 h-12 rounded-l-md shadow-lg flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:bg-slate-900 transition-colors focus:outline-none"
          title={
            showNav ? 'Hide Navigation Menu' : 'Show Navigation Menu'
          }
        >
          <div className="w-[1.5px] h-3 bg-amber-500/80 rounded-full" />
          <div className="w-[1.5px] h-1 bg-amber-500/80 rounded-full" />
        </motion.button>
      )}

      {/* BOTTOM NAVIGATION BAR (MOBILE ONLY, SLIDES/FADES OUT ON SCROLL) */}
      {(() => {
        if (!currentEmployee) return null;
        const allowed = MOBILE_TABS.filter(
          (tab) => canOpenScreen(currentEmployee.role, tab.id),
        );
        const byId = new Map<string, (typeof allowed)[number]>(allowed.map((tab) => [tab.id, tab]));
        const { primary, overflow } = arrangeMobileNav(
          allowed.map((tab) => tab.id),
          currentEmployee.role,
        );
        const overflowTabs = overflow.map((id) => byId.get(id)!);
        const isOverflowActive = overflow.includes(activeTab as string);
        const avatarSrc =
          currentEmployee.avatar ||
          "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E";

        return (
          <>
            <motion.nav
              initial={{ y: 0, opacity: 1 }}
              animate={{
                // Hidden: slide past the bottom edge (and the phone's own bar), shrinking slightly
                y: isNavVisible ? 0 : '160%',
                scale: isNavVisible ? 1 : 0.94,
                opacity: isNavVisible ? 1 : 0,
                pointerEvents: isNavVisible ? 'auto' : 'none',
              }}
              // iOS-like: quick, settles without bouncing; fade runs a little ahead of the slide
              transition={{
                y: { type: 'spring', stiffness: 420, damping: 40, mass: 0.9 },
                scale: { type: 'spring', stiffness: 420, damping: 40, mass: 0.9 },
                opacity: { duration: isNavVisible ? 0.22 : 0.18, ease: [0.32, 0.72, 0, 1] },
              }}
              // Sits above the gesture/navigation bar and clear of side cutouts in landscape
              style={{
                bottom: 'calc(var(--mobile-nav-gap) + var(--inset-bottom))',
                left: 'calc(var(--mobile-edge) + var(--inset-left))',
                right: 'calc(var(--mobile-edge) + var(--inset-right))',
                height: 'var(--mobile-nav-height)',
              }}
              className="fixed mx-auto max-w-lg md:hidden bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur-md border border-slate-800/80 dark:border-white/70 flex items-center justify-around shrink-0 z-30 shadow-xl rounded-2xl select-none font-sans px-1 min-[380px]:px-2 gap-0.5"
            >
              {primary.map((id) => {
                const isMore = id === MORE_TAB_ID;
                const tab = isMore
                  ? { id, label: 'More', icon: Menu }
                  : byId.get(id)!;
                const Icon = tab.icon;
                const isActive = isMore ? isMoreOpen || isOverflowActive : activeTab === id;
                const isCenterSell = id === 'sell' && currentEmployee.role === 'Cashier';

                return (
                  <button
                    key={id}
                    id={`mobile-tab-${id}`}
                    onClick={() => {
                      if (isMore) {
                        setIsMoreOpen(!isMoreOpen);
                      } else {
                        setIsMoreOpen(false);
                        setActiveTab(id as any);
                      }
                    }}
                    aria-label={tab.label}
                    aria-expanded={isMore ? isMoreOpen : undefined}
                    className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full transition-all relative cursor-pointer ${
                      isActive
                        ? 'text-amber-400 dark:text-amber-600 font-bold'
                        : 'text-slate-400 hover:text-slate-200 dark:text-slate-500 dark:hover:text-slate-800'
                    }`}
                  >
                    <div
                      className={`relative flex items-center justify-center ${
                        isCenterSell
                          ? `w-11 h-11 -mt-5 rounded-full shadow-lg border-4 border-slate-900 dark:border-slate-100 ${
                              isActive ? 'bg-amber-500 text-slate-950' : 'bg-amber-500/90 text-slate-950'
                            }`
                          : ''
                      }`}
                    >
                      {id === 'profile' ? (
                        <img
                          src={avatarSrc}
                          alt=""
                          className={`w-5 h-5 rounded-full object-cover transition-all ${
                            isActive ? 'ring-2 ring-amber-500 shadow-xs' : 'border border-app-border/70'
                          }`}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <Icon size={isCenterSell ? 20 : 18} />
                      )}

                      {id === 'pos' && cartItemsCount > 0 && (
                        <span className="absolute -top-1.5 -right-2 bg-amber-500 text-slate-950 font-semibold rounded-full w-3.5 h-3.5 text-[11px] flex items-center justify-center shadow-xs ">
                          {cartItemsCount}
                        </span>
                      )}
                      {id === 'unclaimed-payments' && unclaimedCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-amber-500 text-slate-950 font-bold rounded-full w-4 h-4 text-[10px] flex items-center justify-center shadow-xs z-20">
                          {unclaimedCount}
                        </span>
                      )}
                    </div>
                    <span className="nav-label text-[11px] mt-0.5 tracking-tight truncate max-w-full">
                      {tab.label}
                    </span>
                    {isActive && !isCenterSell && (
                      <motion.div
                        layoutId="activeTabIndicator"
                        className="absolute bottom-1 w-6 h-0.5 bg-amber-500 rounded-full"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </motion.nav>

            {/* "More" sheet: every screen that doesn't fit on the bar, grouped, with search */}
            <AnimatePresence>
              {isMoreOpen && overflowTabs.length > 0 && (() => {
                const query = moreQuery.trim().toLowerCase();
                const rows = [...overflowTabs]
                  .sort((a, b) => screenOrder(a.id) - screenOrder(b.id))
                  .map((tab) => ({ tab, screen: SCREEN_BY_ID.get(tab.id as any) }))
                  .filter(({ tab, screen }) =>
                    !query ||
                    [tab.label, screen?.title, screen?.description, ...(screen?.keywords ?? [])]
                      .some((text) => text?.toLowerCase().includes(query)),
                  );
                const open = (id: string) => {
                  setIsMoreOpen(false);
                  setMoreQuery('');
                  setActiveTab(id as any);
                };
                return (
                  <>
                    <motion.div
                      key="more-backdrop"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.55 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsMoreOpen(false)}
                      className="fixed inset-0 bg-black z-40 md:hidden"
                    />
                    <motion.div
                      key="more-sheet"
                      role="dialog"
                      aria-modal="true"
                      aria-label="All screens"
                      initial={{ y: '100%' }}
                      animate={{ y: 0 }}
                      exit={{ y: '100%' }}
                      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                      drag="y"
                      dragConstraints={{ top: 0, bottom: 0 }}
                      dragElastic={{ top: 0, bottom: 0.6 }}
                      dragListener={false}
                      dragControls={moreDragControls}
                      onDragEnd={(_, info) => {
                        if (info.offset.y > 90 || info.velocity.y > 500) setIsMoreOpen(false);
                      }}
                      className="fixed inset-x-0 bottom-0 z-50 md:hidden bg-app-card border-t border-app-border rounded-t-3xl shadow-2xl flex flex-col max-h-[85dvh]"
                      style={{ paddingBottom: 'var(--inset-bottom)' }}
                    >
                      {/* Drag handle and header: swipe down here to close */}
                      <div
                        className="shrink-0 px-4 pt-2 pb-3 touch-none cursor-grab active:cursor-grabbing"
                        onPointerDown={(e) => moreDragControls.start(e)}
                      >
                        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-app-border" aria-hidden="true" />
                        <div className="flex items-center gap-2">
                          {/* Profile and theme live here on phones, not in the top bar */}
                          <button
                            type="button"
                            onClick={() => open('profile')}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="min-w-0 flex-1 flex items-center gap-3 rounded-2xl p-1 -m-1 text-left hover:bg-app-bg cursor-pointer"
                            aria-label="My profile"
                          >
                            <img
                              src={avatarSrc}
                              alt=""
                              className="w-10 h-10 rounded-full object-cover border border-app-border shrink-0"
                              referrerPolicy="no-referrer"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold text-app-text truncate">{currentEmployee.name}</span>
                              <span className="block text-xs text-app-text-muted truncate">
                                {currentEmployee.role}
                                {activeBusiness?.name ? ` · ${activeBusiness.name}` : ''}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
                            onPointerDown={(e) => e.stopPropagation()}
                            aria-label={themeMode === 'light' ? 'Dark theme' : 'Light theme'}
                            title={themeMode === 'light' ? 'Dark theme' : 'Light theme'}
                            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-app-text-muted hover:bg-app-bg cursor-pointer"
                          >
                            {themeMode === 'light' ? <Moon size={19} /> : <Sun size={19} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsMoreOpen(false)}
                            aria-label="Close"
                            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-app-text-muted hover:bg-app-bg cursor-pointer"
                          >
                            <X size={20} />
                          </button>
                        </div>
                        <div className="relative mt-3">
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted pointer-events-none" />
                          <input
                            type="search"
                            enterKeyHint="go"
                            value={moreQuery}
                            onChange={(e) => setMoreQuery(e.target.value)}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && rows.length > 0) open(rows[0].tab.id);
                            }}
                            placeholder="Find a screen"
                            aria-label="Find a screen"
                            className="w-full bg-app-bg border border-app-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-app-text placeholder-app-text-muted focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
                        {rows.length === 0 && (
                          <p className="py-8 text-center text-sm text-app-text-muted">No screen matches “{moreQuery}”.</p>
                        )}
                        {SCREEN_GROUPS.map((group) => {
                          const inGroup = rows.filter(({ screen }) => (screen?.group ?? 'You & the app') === group);
                          if (inGroup.length === 0) return null;
                          return (
                            <section key={group} className="mb-3">
                              <h3 className="px-2 pt-2 pb-1 text-[11px] font-bold text-app-text-muted">
                                {group}
                              </h3>
                              <ul className="bg-app-bg/60 border border-app-border/60 rounded-2xl overflow-hidden divide-y divide-app-border/50">
                                {inGroup.map(({ tab, screen }) => {
                                  const Icon = tab.icon;
                                  const isActive = activeTab === tab.id;
                                  return (
                                    <li key={tab.id}>
                                      <button
                                        id={`mobile-more-${tab.id}`}
                                        type="button"
                                        onClick={() => open(tab.id)}
                                        aria-current={isActive ? 'page' : undefined}
                                        className={`w-full min-h-14 flex items-center gap-3 px-3 py-2.5 text-left transition cursor-pointer ${
                                          isActive ? 'bg-amber-500/10' : 'active:bg-app-card hover:bg-app-card'
                                        }`}
                                      >
                                        <span
                                          className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${
                                            isActive ? 'bg-amber-500 text-slate-950' : 'bg-amber-500/10 text-amber-600'
                                          }`}
                                        >
                                          {tab.id === 'profile' ? (
                                            <img src={avatarSrc} alt="" className="w-6 h-6 rounded-full object-cover" referrerPolicy="no-referrer" />
                                          ) : (
                                            <Icon size={20} />
                                          )}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className={`block text-sm font-semibold truncate ${isActive ? 'text-amber-600' : 'text-app-text'}`}>
                                            {screen?.title ?? tab.label}
                                          </span>
                                          {screen?.description && (
                                            <span className="block text-xs text-app-text-muted truncate">{screen.description}</span>
                                          )}
                                        </span>
                                        <ChevronRight size={16} className="shrink-0 text-app-text-muted" aria-hidden="true" />
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </section>
                          );
                        })}
                      </div>
                    </motion.div>
                  </>
                );
              })()}
            </AnimatePresence>
          </>
        );
      })()}
    </>
  );
}
