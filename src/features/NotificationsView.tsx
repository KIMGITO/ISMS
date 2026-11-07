// src/features/NotificationsView.tsx
// Notification centre. Swiping a notification stops on its actions (archive, delete,
// read/unread) so nothing happens until you choose one. Long-press selects.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, PanInfo, animate, useMotionValue } from "motion/react";
import { AppNotification } from "../types";
import { NotificationRepository, SQLiteRow } from "../services/notifications/notificationRepository";
import { NotificationService } from "../services/notifications/notificationService";
import NotificationSettingsPanel from "../components/NotificationSettingsPanel";
import { NotificationToneService, NotificationToneId } from "../services/notifications/notificationTone";
import { SheetLayer } from "../components/shared/SheetLayer";
import { useBusinessStore } from "../stores/businessStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useOverlay } from "../hooks/useOverlay";
import { formatNotificationNumber } from "../utils/idUtils";

import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronLeft,
  X,
  Archive,
  ArchiveRestore,
  Trash2,
  Search,
  MoreHorizontal,
  Settings2,
  ShieldCheck,
  PackageSearch,
  CircleDollarSign,
  Bike,
  Brain,
  CalendarClock,
  AlertTriangle,
  Info,
  CheckCircle2,
  Wallet,
  UserPlus,
  Megaphone,
  RefreshCw,
  ArrowRight,
  Sparkles,
  Mail,
  ListChecks,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types and lookups
// ---------------------------------------------------------------------------

type TabId = "all" | "unread" | "system" | "transactions" | "activity" | "mentions";
type ViewMode = "feed" | "archived";
type Delay = ReturnType<typeof setTimeout>;
type Row = SQLiteRow<AppNotification>;
/** Which side's actions a row is showing: "start" = swiped right, "end" = swiped left. */
type OpenSide = "start" | "end";

interface NotifVisual {
  icon: React.ReactNode;
  cls: string;
  category: TabId | "inventory" | "security" | "schedule";
}

const TYPE_VISUALS: Record<string, NotifVisual> = {
  "Out Of Stock": { icon: <AlertTriangle size={17} />, cls: "bg-red-500/12 text-red-500", category: "inventory" },
  "Stock Almost Finished": { icon: <PackageSearch size={17} />, cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", category: "inventory" },
  "AI Business Insight": { icon: <Brain size={17} />, cls: "bg-indigo-500/12 text-indigo-500", category: "activity" },
  "AI Recommendation": { icon: <Sparkles size={17} />, cls: "bg-fuchsia-500/12 text-fuchsia-500", category: "activity" },
  "AI Risk Alert": { icon: <ShieldCheck size={17} />, cls: "bg-rose-500/12 text-rose-500", category: "security" },
  "Sales Summary": { icon: <Wallet size={17} />, cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", category: "transactions" },
  "Daily Report": { icon: <Wallet size={17} />, cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", category: "transactions" },
  "Weekly Report": { icon: <Wallet size={17} />, cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", category: "transactions" },
  "Monthly Report": { icon: <Wallet size={17} />, cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", category: "transactions" },
  "Debt Due Reminder": { icon: <CircleDollarSign size={17} />, cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", category: "transactions" },
  "Delivery Assigned": { icon: <Bike size={17} />, cls: "bg-sky-500/12 text-sky-500", category: "activity" },
  "Delivery Completed": { icon: <Bike size={17} />, cls: "bg-sky-500/12 text-sky-500", category: "activity" },
  "Payment Received": { icon: <CircleDollarSign size={17} />, cls: "bg-teal-500/12 text-teal-500", category: "transactions" },
  "Payment Failed": { icon: <AlertTriangle size={17} />, cls: "bg-red-500/12 text-red-500", category: "transactions" },
  "Schedule Reminder": { icon: <CalendarClock size={17} />, cls: "bg-violet-500/12 text-violet-500", category: "schedule" },
  "Scheduled Reminder": { icon: <CalendarClock size={17} />, cls: "bg-violet-500/12 text-violet-500", category: "schedule" },
  "Role Invitation": { icon: <UserPlus size={17} />, cls: "bg-cyan-500/12 text-cyan-500", category: "activity" },
  "Account Activity": { icon: <ShieldCheck size={17} />, cls: "bg-orange-500/12 text-orange-500", category: "security" },
  "System Update": { icon: <RefreshCw size={17} />, cls: "bg-blue-500/12 text-blue-500", category: "system" },
  "Business Announcement": { icon: <Megaphone size={17} />, cls: "bg-pink-500/12 text-pink-500", category: "activity" },
  "Low Cash Balance": { icon: <CircleDollarSign size={17} />, cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", category: "transactions" },
  "Custom Notification": { icon: <Bell size={17} />, cls: "bg-slate-500/12 text-slate-500", category: "system" },
};

const getVisual = (type: string | undefined): NotifVisual =>
  TYPE_VISUALS[type || ""] || { icon: <Info size={17} />, cls: "bg-slate-500/12 text-slate-500", category: "system" };

const TAB_DEFS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "transactions", label: "Money" },
  { id: "activity", label: "Activity" },
  { id: "system", label: "System" },
  { id: "mentions", label: "Mentions" },
];

const mentions = (n: Row) => (n.message + " " + (n.title || "")).toLowerCase().includes("@");

function inTab(n: Row, tab: TabId): boolean {
  const cat = getVisual(n.type).category;
  switch (tab) {
    case "unread": return !n.read_at;
    case "mentions": return mentions(n);
    case "system": return cat === "system" || cat === "security" || cat === "inventory";
    case "transactions": return cat === "transactions";
    case "activity": return cat === "activity" || cat === "schedule";
    default: return true;
  }
}

const whenOf = (n: Row) => n.created_at || n.sent_at || new Date().toISOString();

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function groupOf(iso: string): string {
  const t = new Date(iso).getTime();
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startToday) return "Today";
  if (t >= startToday - 86400000) return "Yesterday";
  if (t >= startToday - 6 * 86400000) return "This week";
  return "Earlier";
}
const GROUP_ORDER = ["Today", "Yesterday", "This week", "Earlier"];

function formatDetailDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Width of one action button behind a row.
const ACTION_W = 76;

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function NotificationsView() {
  const { activeBusinessId } = useBusinessStore();

  const [items, setItems] = useState<Row[]>([]);
  const [archived, setArchived] = useState<Row[]>([]);
  const [tab, setTab] = useState<TabId>("all");
  const [view, setView] = useState<ViewMode>("feed");
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<{ id: string; side: OpenSide } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind?: "success" | "danger" } | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[]; title: string } | null>(null);
  const [liveToast, setLiveToast] = useState<Row | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const liveToastTimer = useRef<Delay | null>(null);
  const toastTimer = useRef<Delay | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  // Archived rows are recomputed in the same subscriber so archive/restore shows at once.
  useEffect(() => {
    const unsub = NotificationRepository.subscribe((rows) => {
      setItems(rows);
      setArchived(NotificationRepository.getArchived());
    });
    if (activeBusinessId) {
      NotificationRepository.loadFromSupabase(activeBusinessId).catch(console.error);
      useNotificationStore.getState().initScheduleReminders();
    }
    return () => unsub();
  }, [activeBusinessId]);

  // Banner for a notification that arrived in the last few seconds.
  useEffect(() => {
    if (items.length === 0) return;
    const latest = items[0];
    const age = Date.now() - new Date(latest.created_at).getTime();
    if (age < 8000 && !latest.read_at) {
      setLiveToast(latest);
      if (liveToastTimer.current) clearTimeout(liveToastTimer.current);
      liveToastTimer.current = setTimeout(() => setLiveToast(null), 3500);
    }
  }, [items]);

  useEffect(() => () => {
    if (liveToastTimer.current) clearTimeout(liveToastTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (isSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 60);
  }, [isSearchOpen]);

  const showToast = useCallback((msg: string, kind?: "success" | "danger") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ---- Lists ----
  const feed = useMemo(() => [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [items]);

  const filtered = useMemo(() => {
    let list = (view === "archived" ? archived : feed).filter((n) => inTab(n, tab));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (n) =>
          (n.title || "").toLowerCase().includes(q) ||
          (n.message || "").toLowerCase().includes(q) ||
          (n.created_by || "").toLowerCase().includes(q) ||
          formatNotificationNumber(n.id).toLowerCase().includes(q)
      );
    }
    return list;
  }, [feed, archived, view, tab, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const n of filtered) {
      const key = groupOf(whenOf(n));
      map.set(key, [...(map.get(key) || []), n]);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((label) => ({ label, list: map.get(label)! }));
  }, [filtered]);

  const unreadCount = feed.filter((n) => !n.read_at).length;
  const tabCount = (t: TabId) => feed.filter((n) => inTab(n, t)).length;

  // ---- Actions ----
  const forget = (id: string) => {
    setSelected((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    setExpandedId((e) => (e === id ? null : e));
    setOpenRow((o) => (o?.id === id ? null : o));
  };

  const markRead = (id: string) => {
    NotificationService.markAsRead(id);
    setOpenRow(null);
  };
  const markUnread = (id: string) => {
    NotificationService.markAsUnread(id);
    setOpenRow(null);
  };
  const archive = (id: string) => {
    NotificationService.archive(id);
    forget(id);
    showToast("Archived");
  };
  const restore = (id: string) => {
    NotificationService.unarchive(id);
    forget(id);
    showToast("Moved back to notifications");
  };
  const askDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    const one = ids.length === 1 ? [...feed, ...archived].find((n) => n.id === ids[0]) : undefined;
    setConfirm({ ids, title: one?.title || `${ids.length} notifications` });
  };
  const doDelete = (ids: string[]) => {
    ids.forEach((id) => {
      NotificationService.delete(id);
      forget(id);
    });
    showToast(ids.length === 1 ? "Deleted" : `${ids.length} deleted`, "danger");
  };
  const markAllRead = () => {
    NotificationService.markAllRead();
    showToast("All marked as read");
  };

  // ---- Selection ----
  const endSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const startSelection = (id?: string) => {
    setOpenRow(null);
    setExpandedId(null);
    setSelecting(true);
    setSelected(new Set(id ? [id] : []));
  };
  const allVisibleSelected = filtered.length > 0 && filtered.every((n) => selected.has(n.id));
  const bulk = (fn: (id: string) => void, done: string) => {
    selected.forEach((id) => fn(id));
    showToast(`${selected.size} ${done}`);
    endSelection();
  };

  const openDetail = (n: Row) => {
    if (openRow) {
      // A tap anywhere first closes the open actions.
      setOpenRow(null);
      return;
    }
    if (selecting) {
      toggleSelect(n.id);
      return;
    }
    if (!n.read_at) NotificationService.markAsRead(n.id);
    setExpandedId((e) => (e === n.id ? null : n.id));
  };

  const openMenuAt = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenRow(null);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.type === "contextmenu" ? e.clientX : rect.right;
    const y = e.type === "contextmenu" ? e.clientY : rect.bottom + 4;
    setMenu({ id, x, y });
  };

  // Back button / Escape: close the innermost thing first.
  useOverlay(selecting, endSelection, "other");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openRow) setOpenRow(null);
      else if (isSearchOpen) {
        setIsSearchOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openRow, isSearchOpen]);

  const menuRow = menu && menu.id !== "__page__" ? [...feed, ...archived].find((x) => x.id === menu.id) : undefined;
  const closeMenu = () => setMenu(null);

  return (
    <div className="h-full flex flex-col bg-app-bg text-app-text font-sans overflow-hidden">
      {/* New notification banner */}
      <SheetLayer>
        <AnimatePresence>
          {liveToast && (
            <motion.div
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
              style={{ top: "calc(var(--inset-top) + 0.75rem)" }}
              className="absolute left-1/2 -translate-x-1/2 w-[92%] max-w-sm"
            >
              <div className="bg-app-card/95 backdrop-blur-md ring-1 ring-app-border rounded-2xl px-3.5 py-3 shadow-xl flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${getVisual(liveToast.type).cls}`}>{getVisual(liveToast.type).icon}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold truncate">{liveToast.title}</p>
                  <p className="text-xs text-app-text-muted truncate">{liveToast.message}</p>
                </div>
                <button onClick={() => setLiveToast(null)} aria-label="Dismiss" className="p-1.5 rounded-full hover:bg-app-bg text-app-text-muted shrink-0 cursor-pointer">
                  <X size={15} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action result */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
              role="status"
              className={`absolute bottom-(--mobile-nav-space) md:bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-full shadow-xl text-[13px] font-medium flex items-center gap-2 whitespace-nowrap ${
                toast.kind === "danger" ? "bg-red-600 text-white" : "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
              }`}
            >
              {toast.kind === "danger" ? <Trash2 size={14} /> : <CheckCircle2 size={14} />}
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </SheetLayer>

      {/* Header */}
      <div className="shrink-0 px-4 md:px-8 pt-4 pb-2 max-w-[860px] w-full mx-auto">
        {selecting ? (
          <div className="flex items-center gap-2 h-11">
            <button onClick={endSelection} aria-label="Stop selecting" className="p-2 -ml-2 rounded-full hover:bg-app-card cursor-pointer">
              <X size={20} />
            </button>
            <span className="text-[15px] font-semibold">{selected.size} selected</span>
            <button
              onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((n) => n.id)))}
              className="ml-auto text-[13px] font-medium text-amber-600 dark:text-amber-400 px-2 py-1 rounded-lg hover:bg-amber-500/10 cursor-pointer"
            >
              {allVisibleSelected ? "Select none" : "Select all"}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 h-11">
            {view === "archived" && (
              <button onClick={() => { setView("feed"); setTab("all"); }} aria-label="Back to notifications" className="p-2 -ml-2 rounded-full hover:bg-app-card cursor-pointer">
                <ChevronLeft size={22} />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-[22px] leading-tight font-bold tracking-tight truncate">{view === "archived" ? "Archived" : "Notifications"}</h1>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <IconButton label="Search" active={isSearchOpen} onClick={() => { setIsSearchOpen((v) => !v); if (isSearchOpen) setQuery(""); }}>
                <Search size={18} />
              </IconButton>
              <IconButton
                label="More options"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenu({ id: "__page__", x: rect.right, y: rect.bottom + 4 });
                }}
              >
                <MoreHorizontal size={18} />
              </IconButton>
              <IconButton label="Notification settings" onClick={() => setPrefsOpen(true)}>
                <Settings2 size={18} />
              </IconButton>
            </div>
          </div>
        )}

        {view === "feed" && !selecting && (
          <p className="text-[13px] text-app-text-muted -mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </p>
        )}

        <AnimatePresence initial={false}>
          {isSearchOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.15 }}
              className="overflow-hidden"
            >
              <div className="relative pt-3">
                <Search size={15} className="absolute left-3 top-[calc(50%+0.375rem)] -translate-y-1/2 text-app-text-muted" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search notifications"
                  className="w-full bg-app-card ring-1 ring-app-border focus:ring-2 focus:ring-amber-500 focus:outline-none rounded-xl py-2.5 pl-9 pr-9 text-sm"
                />
                {query && (
                  <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2.5 top-[calc(50%+0.375rem)] -translate-y-1/2 p-1 text-app-text-muted cursor-pointer">
                    <X size={14} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pt-3 -mx-4 px-4 md:mx-0 md:px-0" role="tablist" aria-label="Filter notifications">
          {TAB_DEFS.map((t) => {
            const count = view === "feed" ? tabCount(t.id) : 0;
            if (view === "feed" && t.id === "mentions" && count === 0 && tab !== "mentions") return null;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition cursor-pointer ${
                  active ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-app-card text-app-text ring-1 ring-app-border hover:bg-app-border/40"
                }`}
              >
                {t.label}
                {view === "feed" && t.id !== "all" && count > 0 && <span className={`ml-1.5 text-xs ${active ? "opacity-70" : "text-app-text-muted"}`}>{count > 99 ? "99+" : count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 md:px-8 pb-nav" onScroll={() => openRow && setOpenRow(null)}>
        <div className="max-w-[860px] mx-auto">
          {view === "feed" && unreadCount > 0 && !selecting && tab !== "unread" && (
            <div className="flex justify-end pt-1">
              <button onClick={markAllRead} className="text-[13px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-amber-500/10 cursor-pointer">
                <CheckCheck size={15} /> Mark all as read
              </button>
            </div>
          )}

          {groups.length === 0 ? (
            <EmptyState view={view} tab={tab} hasQuery={!!query.trim()} onReset={() => setQuery("")} />
          ) : (
            groups.map((group) => (
              <section key={group.label} className="mt-3">
                <h2 className="px-3 pb-1.5 text-xs font-semibold text-app-text-muted">{group.label}</h2>
                <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
                  {group.list.map((n) => (
                    <NotificationRow
                      key={n.id}
                      notif={n}
                      archivedView={view === "archived"}
                      selected={selected.has(n.id)}
                      selecting={selecting}
                      expanded={expandedId === n.id}
                      open={openRow?.id === n.id ? openRow.side : null}
                      reducedMotion={reducedMotion}
                      onOpenChange={(side) => setOpenRow(side ? { id: n.id, side } : null)}
                      onTap={() => openDetail(n)}
                      onLongPress={() => startSelection(n.id)}
                      onMenu={(e) => openMenuAt(e, n.id)}
                      onToggleRead={() => (n.read_at ? markUnread(n.id) : markRead(n.id))}
                      onArchive={() => (view === "archived" ? restore(n.id) : archive(n.id))}
                      onDelete={() => askDelete([n.id])}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}

          {groups.length > 0 && !selecting && (
            <p className="text-center text-xs text-app-text-muted/80 py-5">
              <span className="md:hidden">Swipe a notification for actions · hold to select</span>
              <span className="hidden md:inline">Drag a notification sideways or right-click it for actions</span>
            </p>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      <SheetLayer>
        <AnimatePresence>
          {selecting && (
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
              // Same place and size as the mobile nav, which it covers while selecting.
              style={{ bottom: "calc(var(--mobile-nav-gap) + var(--inset-bottom))", minHeight: "var(--mobile-nav-height)" }}
              className="absolute left-1/2 -translate-x-1/2 w-[calc(100%-4px-var(--inset-left)-var(--inset-right))] max-w-lg bg-app-card ring-1 ring-app-border rounded-2xl shadow-2xl p-1.5 grid grid-cols-3 gap-1"
            >
              <BulkButton disabled={selected.size === 0} onClick={() => bulk((id) => NotificationService.markAsRead(id), "marked as read")} icon={<Check size={18} />} label="Read" />
              {view === "archived" ? (
                <BulkButton disabled={selected.size === 0} onClick={() => bulk((id) => NotificationService.unarchive(id), "restored")} icon={<ArchiveRestore size={18} />} label="Restore" />
              ) : (
                <BulkButton disabled={selected.size === 0} onClick={() => bulk((id) => NotificationService.archive(id), "archived")} icon={<Archive size={18} />} label="Archive" />
              )}
              <BulkButton disabled={selected.size === 0} danger onClick={() => askDelete([...selected])} icon={<Trash2 size={18} />} label="Delete" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Menus */}
        <AnimatePresence>
          {menu?.id === "__page__" && (
            <MenuOverlay
              x={menu.x}
              y={menu.y}
              onClose={closeMenu}
              items={[
                view === "feed"
                  ? { label: "Archived", icon: <Archive size={16} />, onClick: () => { setTab("all"); setView("archived"); } }
                  : { label: "Back to notifications", icon: <Bell size={16} />, onClick: () => { setTab("all"); setView("feed"); } },
                { label: "Select", icon: <ListChecks size={16} />, onClick: () => startSelection(), disabled: filtered.length === 0 },
                { label: "Mark all as read", icon: <CheckCheck size={16} />, onClick: markAllRead, disabled: unreadCount === 0 },
                { label: "Notification tone", icon: <BellRing size={16} />, onClick: () => setToneOpen(true) },
              ]}
            />
          )}
          {menuRow && menu && (
            <MenuOverlay
              x={menu.x}
              y={menu.y}
              onClose={closeMenu}
              items={[
                menuRow.read_at
                  ? { label: "Mark as unread", icon: <Mail size={16} />, onClick: () => markUnread(menuRow.id) }
                  : { label: "Mark as read", icon: <Check size={16} />, onClick: () => markRead(menuRow.id) },
                menuRow.archived_at
                  ? { label: "Restore", icon: <ArchiveRestore size={16} />, onClick: () => restore(menuRow.id) }
                  : { label: "Archive", icon: <Archive size={16} />, onClick: () => archive(menuRow.id) },
                { label: "Select", icon: <ListChecks size={16} />, onClick: () => startSelection(menuRow.id) },
                { label: "Delete", icon: <Trash2 size={16} />, danger: true, onClick: () => askDelete([menuRow.id]) },
              ]}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>{prefsOpen && <NotificationPrefsSheet onClose={() => setPrefsOpen(false)} />}</AnimatePresence>
        <AnimatePresence>{toneOpen && <NotificationToneSheet onClose={() => setToneOpen(false)} reducedMotion={reducedMotion} />}</AnimatePresence>

        {/* Delete confirmation */}
        <AnimatePresence>
          {confirm && (
            <ConfirmDelete
              title={confirm.title}
              count={confirm.ids.length}
              reducedMotion={reducedMotion}
              onCancel={() => setConfirm(null)}
              onConfirm={() => {
                doDelete(confirm.ids);
                setConfirm(null);
                if (selecting) endSelection();
              }}
            />
          )}
        </AnimatePresence>
      </SheetLayer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function IconButton({ label, onClick, active, children }: { label: string; onClick: (e: React.MouseEvent) => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition cursor-pointer ${active ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-app-card ring-1 ring-app-border hover:bg-app-border/40"}`}
    >
      {children}
    </button>
  );
}

function BulkButton({ icon, label, onClick, disabled, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 py-2 rounded-xl text-xs font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? "text-red-600 dark:text-red-400 hover:bg-red-500/10" : "text-app-text hover:bg-app-bg"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ConfirmDelete({ title, count, reducedMotion, onCancel, onConfirm }: { title: string; count: number; reducedMotion: boolean; onCancel: () => void; onConfirm: () => void }) {
  useOverlay(true, onCancel, "dialog");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-3 pb-[calc(0.75rem+var(--inset-bottom))]"
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.16 }}
        role="alertdialog"
        aria-modal="true"
        aria-label="Delete notification"
        className="bg-app-card rounded-3xl shadow-2xl w-full max-w-sm p-5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-3">
          <Trash2 size={20} />
        </div>
        <h3 className="text-base font-semibold">{count === 1 ? "Delete this notification?" : `Delete ${count} notifications?`}</h3>
        <p className="text-[13px] text-app-text-muted mt-1 leading-relaxed">
          {count === 1 ? `"${title}" will be removed for good.` : "They will be removed for good."} Archive instead if you may need {count === 1 ? "it" : "them"} later.
        </p>
        <div className="grid grid-cols-2 gap-2 mt-5">
          <button autoFocus onClick={onCancel} className="py-2.5 rounded-xl bg-app-bg hover:bg-app-border/50 text-sm font-medium cursor-pointer">
            Cancel
          </button>
          <button onClick={onConfirm} className="py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold cursor-pointer">
            Delete
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** A small menu anchored at (x, y): its right edge sits at x, kept inside the window. */
function MenuOverlay({ x, y, onClose, items }: { x: number; y: number; onClose: () => void; items: MenuItem[] }) {
  useOverlay(true, onClose, "dropdown");
  const width = 200;
  const height = items.length * 44 + 12;
  const left = Math.max(8, Math.min(x - width, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));
  return (
    <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.12 }}
        style={{ top, left, width }}
        role="menu"
        className="fixed bg-app-card ring-1 ring-app-border rounded-2xl shadow-2xl p-1.5 origin-top-right"
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick();
            }}
            className={`w-full flex items-center gap-3 px-3 h-11 rounded-xl text-sm transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              it.danger ? "text-red-600 dark:text-red-400 hover:bg-red-500/10" : "text-app-text hover:bg-app-bg"
            }`}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Notification row
// ---------------------------------------------------------------------------

interface RowProps {
  notif: Row;
  archivedView: boolean;
  selected: boolean;
  selecting: boolean;
  expanded: boolean;
  open: OpenSide | null;
  reducedMotion: boolean;
  onOpenChange: (side: OpenSide | null) => void;
  onTap: () => void;
  onLongPress: () => void;
  onMenu: (e: React.MouseEvent) => void;
  onToggleRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/**
 * Drag sideways and let go: the row stays open on its actions until one is tapped, the
 * row is tapped, or it is dragged back. Nothing is archived or deleted by the swipe alone.
 */
function NotificationRow({
  notif, archivedView, selected, selecting, expanded, open, reducedMotion,
  onOpenChange, onTap, onLongPress, onMenu, onToggleRead, onArchive, onDelete,
}: RowProps) {
  const isUnread = !notif.read_at;
  const visual = getVisual(notif.type);
  const startW = ACTION_W;
  const endW = ACTION_W * 2;
  const target = open === "start" ? startW : open === "end" ? -endW : 0;

  const x = useMotionValue(0);
  const settle = (to: number) =>
    animate(x, to, reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 });
  const shown = selecting ? 0 : target;
  useEffect(() => {
    settle(shown);
  }, [shown]);

  const dragged = useRef(false);
  const touchPointer = useRef(false);
  const pressTimer = useRef<Delay | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  useEffect(() => cancelPress, []);

  const onPointerDown = (e: React.PointerEvent) => {
    longPressed.current = false;
    touchPointer.current = e.pointerType !== "mouse";
    if (e.pointerType === "mouse" || selecting) return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      if (navigator.vibrate) navigator.vibrate(12);
      onLongPress();
    }, 480);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = pressStart.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) cancelPress();
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const at = x.get();
    const v = info.velocity.x;
    let next: OpenSide | null = null;
    if (at < -ACTION_W * 0.6 || (v < -500 && at < 0)) next = "end";
    else if (at > ACTION_W * 0.6 || (v > 500 && at > 0)) next = "start";
    onOpenChange(next);
    // Snap even when the open side did not change.
    settle(next === "start" ? startW : next === "end" ? -endW : 0);
    // Let the click that ends the drag pass without opening the notification.
    setTimeout(() => (dragged.current = false), 60);
  };

  let payload: Record<string, any> = {};
  if (notif.payload) {
    try {
      payload = typeof notif.payload === "string" ? JSON.parse(notif.payload) : notif.payload;
    } catch {
      /* plain text payload */
    }
  }

  const trayButton = "h-full flex flex-col items-center justify-center gap-1 text-white text-xs font-medium cursor-pointer";
  const hidden = open === null;

  return (
    // Long-press is watched here: the draggable row below takes its own pointer events.
    <li
      className="relative overflow-hidden group"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
    >
      {/* Actions behind the row */}
      {!selecting && (
        <>
          <div className="absolute inset-y-0 left-0 flex" style={{ width: startW }} aria-hidden={open !== "start"}>
            <button tabIndex={open === "start" ? 0 : -1} onClick={onToggleRead} className={`${trayButton} w-full bg-amber-500`}>
              {isUnread ? <Check size={19} /> : <Mail size={19} />}
              {isUnread ? "Read" : "Unread"}
            </button>
          </div>
          <div className="absolute inset-y-0 right-0 flex" style={{ width: endW }} aria-hidden={open !== "end"}>
            <button tabIndex={open === "end" ? 0 : -1} onClick={onArchive} className={`${trayButton} flex-1 bg-sky-600`}>
              {archivedView ? <ArchiveRestore size={19} /> : <Archive size={19} />}
              {archivedView ? "Restore" : "Archive"}
            </button>
            <button tabIndex={open === "end" ? 0 : -1} onClick={onDelete} className={`${trayButton} flex-1 bg-red-600`}>
              <Trash2 size={19} />
              Delete
            </button>
          </div>
        </>
      )}

      <motion.div
        drag={selecting ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: -endW, right: startW }}
        dragElastic={0.12}
        dragMomentum={false}
        style={{ x }}
        onDragStart={() => {
          dragged.current = true;
          cancelPress();
        }}
        onDragEnd={onDragEnd}
        onClick={() => {
          if (dragged.current || longPressed.current) return;
          onTap();
        }}
        onContextMenu={(e) => {
          // A long press on a phone selects instead (handled above).
          if (selecting || touchPointer.current) e.preventDefault();
          else onMenu(e);
        }}
        className={`relative flex items-start gap-3 px-3.5 py-3 cursor-pointer select-none bg-app-card touch-pan-y ${selected ? "!bg-amber-50 dark:!bg-amber-500/15" : ""}`}
        role={selecting ? "checkbox" : "button"}
        aria-checked={selecting ? selected : undefined}
        aria-expanded={selecting ? undefined : expanded}
        aria-label={`${notif.title}. ${isUnread ? "Unread" : "Read"}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTap();
          }
        }}
      >
        {selecting && (
          <span
            className={`w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 mt-2.5 transition-colors ${
              selected ? "bg-amber-500 border-amber-500 text-white" : "border-app-text-muted/40"
            }`}
          >
            {selected && <Check size={13} strokeWidth={3} />}
          </span>
        )}

        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${visual.cls}`}>{visual.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className={`text-[14px] leading-snug flex-1 min-w-0 truncate ${isUnread ? "font-semibold" : "font-medium text-app-text/85"}`}>{notif.title}</h3>
            <span className={`shrink-0 text-xs ${isUnread ? "text-amber-600 dark:text-amber-400 font-medium" : "text-app-text-muted"}`}>{formatTime(whenOf(notif))}</span>
          </div>
          <div className="flex items-start gap-2 mt-0.5">
            <p className={`flex-1 min-w-0 text-[13px] leading-relaxed text-app-text-muted ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{notif.message}</p>
            {isUnread && <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" aria-hidden />}
          </div>

          {(notif.priority === "high" || notif.priority === "critical") && (
            <span
              className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                notif.priority === "critical" ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              <AlertTriangle size={11} />
              {notif.priority === "critical" ? "Urgent" : "Important"}
            </span>
          )}

          <AnimatePresence initial={false}>
            {expanded && !selecting && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.16 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                  {notif.action_target && notif.action_target !== "none" && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent("navigate-tab", { detail: { tab: notif.action_target } }))}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[13px] font-medium rounded-full transition cursor-pointer"
                    >
                      Open {labelForTarget(notif.action_target)}
                      <ArrowRight size={14} />
                    </button>
                  )}

                  {payload.reportText && (
                    <div className="bg-slate-950 rounded-2xl p-3.5 max-h-80 overflow-y-auto">
                      <div className="text-[11px] font-semibold text-amber-400 mb-1.5 flex items-center justify-between border-b border-slate-800 pb-1.5">
                        <span>Shift summary</span>
                        {payload.employeeName && <span className="text-slate-400 font-normal">{payload.employeeName}</span>}
                      </div>
                      <MarkdownBlock text={String(payload.reportText)} />
                    </div>
                  )}

                  {payload.customMessage && !payload.reportText && (
                    <div className="bg-app-bg rounded-xl p-3">
                      <div className="text-[11px] font-semibold text-app-text-muted mb-0.5">Note</div>
                      <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{payload.customMessage}</div>
                    </div>
                  )}

                  {payload.shift_date && (
                    <div className="inline-flex items-center gap-2 text-[13px] bg-app-bg rounded-xl px-3 py-2">
                      <CalendarClock size={14} className="text-violet-500" />
                      <span>{payload.shift_date}</span>
                      {payload.start_time && <span className="text-app-text-muted">at {payload.start_time}</span>}
                    </div>
                  )}

                  {payload.confidenceScore && (
                    <div className="bg-indigo-500/5 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between text-indigo-500 font-medium text-xs">
                        <span className="flex items-center gap-1"><Sparkles size={12} /> AI confidence</span>
                        <span>{payload.confidenceScore}%</span>
                      </div>
                      {payload.recommendedAction && <p className="text-[13px] leading-relaxed mt-1">{payload.recommendedAction}</p>}
                    </div>
                  )}

                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-app-text-muted">
                    <dt>Received</dt>
                    <dd className="text-app-text">{formatDetailDate(whenOf(notif))}</dd>
                    <dt>Reference</dt>
                    <dd className="text-app-text font-mono">{formatNotificationNumber(notif.id)}</dd>
                  </dl>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mouse users: a menu button on hover */}
        {!selecting && (
          <button
            aria-label="Actions"
            tabIndex={hidden ? 0 : -1}
            onClick={(e) => onMenu(e)}
            onPointerDown={(e) => e.stopPropagation()}
            className="hidden md:flex shrink-0 -mr-1 w-8 h-8 items-center justify-center rounded-full text-app-text-muted hover:bg-app-bg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </motion.div>
    </li>
  );
}

function labelForTarget(target: string): string {
  switch (target) {
    case "inventory": return "product";
    case "sales": return "transaction";
    case "delivery": return "delivery";
    case "customer_debt": return "customer";
    case "ai_insight": return "insight";
    default: return "details";
  }
}

// ---------------------------------------------------------------------------
// Lightweight safe Markdown renderer (no external deps)
// Supports the markdown-ish summaries produced by EndShiftModal / reports:
//   *SECTION HEADER*     → bold amber section header
//   - item               → bullet list
//   item1 | item2        → split columns
//   **bold**             → inline bold
//   everything else      → plain pre-wrap paragraph
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text: string): React.ReactNode[] {
  // Parse **bold** into rich segments
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.*?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(escapeHtml(text.slice(last, m.index)));
    parts.push(<strong key={key++} className="font-extrabold">{escapeHtml(m[1])}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(escapeHtml(text.slice(last)));
  return parts;
}

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length > 0) {
      blocks.push(
        <ul key={key++} className="space-y-1 mt-1 mb-1">
          {list.map((item, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-relaxed">
              <span className="text-amber-400 shrink-0">•</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  const flushCodeBlock = () => {
    if (codeLines.length > 0) {
      blocks.push(
        <pre key={key++} className="bg-slate-900/50 p-2 rounded-lg border border-slate-700 font-mono text-[10px] text-emerald-400 overflow-x-auto my-2 whitespace-pre">
          {codeLines.join('\n')}
        </pre>
      );
      codeLines = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine); // keep original indentation if any
      continue;
    }
    if (!line) {
      flushList();
      continue;
    }
    // *SECTION HEADER*
    if (line.startsWith("*") && line.endsWith("*") && line.length > 2) {
      flushList();
      const header = line.slice(1, -1).trim();
      blocks.push(
        <div key={key++} className="text-[10px] font-black uppercase tracking-widest text-amber-400 mt-2.5 first:mt-0">
          {renderInline(header)}
        </div>
      );
      continue;
    }
    // - bullet
    if (line.startsWith("- ") || line.startsWith("• ")) {
      list.push(line.replace(/^[-•]\s*/, ""));
      continue;
    }
    flushList();
    // a | b | c columns
    if (line.includes("|")) {
      const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 2) {
        blocks.push(
          <div key={key++} className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-relaxed">
            {cols.map((c, i) => (
              <span key={i} className={i === 0 ? "font-bold text-slate-100" : "text-slate-300"}>
                {renderInline(c)}
              </span>
            ))}
          </div>
        );
        continue;
      }
    }
    // plain paragraph
    blocks.push(
      <p key={key++} className="text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap">
        {renderInline(line)}
      </p>
    );
  }
  flushList();
  flushCodeBlock();

  return <>{blocks}</>;
}

// ---------------------------------------------------------------------------
// Settings and tone sheets
// ---------------------------------------------------------------------------

function Sheet({ title, subtitle, icon, onClose, children, footer, reducedMotion = false }: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  reducedMotion?: boolean;
}) {
  useOverlay(true, onClose, "bottom-sheet");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex items-end justify-center bg-black/40 backdrop-blur-[2px] md:items-center md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.18 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-app-card rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md max-h-[85dvh] flex flex-col pb-[var(--inset-bottom)] md:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-app-border mx-auto mt-2.5 md:hidden" />
        <div className="shrink-0 px-5 pt-3 pb-3 border-b border-app-border/60 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">{icon}</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold">{title}</h3>
            <p className="text-xs text-app-text-muted">{subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-app-bg flex items-center justify-center shrink-0 cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2">{children}</div>
        {footer}
      </motion.div>
    </motion.div>
  );
}

function NotificationPrefsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Notification settings" subtitle="These apply to your account on every device." icon={<Settings2 size={17} />} onClose={onClose}>
      <NotificationSettingsPanel />
    </Sheet>
  );
}

function NotificationToneSheet({ onClose, reducedMotion }: { onClose: () => void; reducedMotion: boolean }) {
  const [toneId, setToneId] = useState(NotificationToneService.getToneId());
  const choose = (id: NotificationToneId) => {
    NotificationToneService.setToneId(id);
    NotificationToneService.playWebTone(reducedMotion);
    setToneId(id);
  };
  return (
    <Sheet
      title="Notification tone"
      subtitle="Used on this device."
      icon={<BellRing size={17} />}
      onClose={onClose}
      reducedMotion={reducedMotion}
      footer={<p className="shrink-0 px-5 pb-4 pt-1 text-xs text-app-text-muted">Tap a tone to hear it. On the phone app it is used for new notifications.</p>}
    >
      <div role="radiogroup" aria-label="Notification tone">
        {NotificationToneService.getTones().map((tone) => {
          const active = toneId === tone.id;
          return (
            <button
              key={tone.id}
              onClick={() => choose(tone.id)}
              role="radio"
              aria-checked={active}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition text-left cursor-pointer ${active ? "bg-amber-500/10" : "hover:bg-app-bg"}`}
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${active ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-app-bg text-app-text-muted"}`}>
                <BellRing size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium block truncate">{tone.label}</span>
                <span className="text-xs text-app-text-muted block truncate">{tone.description}</span>
              </div>
              {active && (
                <span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ view, tab, hasQuery, onReset }: { view: ViewMode; tab: TabId; hasQuery: boolean; onReset: () => void }) {
  let icon = <BellRing size={26} />;
  let title = "You're all caught up";
  let sub = "New notifications will appear here.";
  if (hasQuery) {
    icon = <Search size={26} />;
    title = "Nothing matches";
    sub = "Try a different word.";
  } else if (view === "archived") {
    icon = <Archive size={26} />;
    title = "Nothing archived";
    sub = "Swipe a notification and tap Archive to keep it here.";
  } else if (tab === "unread") {
    icon = <CheckCheck size={26} />;
    title = "No unread notifications";
    sub = "You've read everything.";
  } else if (tab !== "all") {
    title = "Nothing here yet";
    sub = "New notifications of this kind will appear here.";
  }
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-app-card ring-1 ring-app-border flex items-center justify-center text-app-text-muted/60 mb-4">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-[13px] text-app-text-muted mt-1 max-w-xs leading-relaxed">{sub}</p>
      {hasQuery && (
        <button onClick={onReset} className="mt-4 px-4 py-2 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[13px] font-medium cursor-pointer">
          Clear search
        </button>
      )}
    </div>
  );
}
