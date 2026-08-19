// src/features/NotificationsView.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNotification } from "../types";
import { NotificationRepository, SQLiteRow } from "../services/notifications/notificationRepository";
import { NotificationService } from "../services/notifications/notificationService";
import { NotificationPreferences } from "../services/notifications/notificationPreferences";
import { NotificationToneService, NotificationToneId } from "../services/notifications/notificationTone";
import { useBusinessStore } from "../stores/businessStore";
import { useNotificationStore } from "../stores/notificationStore";
import { formatNotificationNumber } from "../utils/idUtils";
import { motion, AnimatePresence } from "motion/react";

// Lucide icons
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
  MoreVertical,
  Settings2,
  ShieldCheck,
  PackageSearch,
  CircleDollarSign,
  Bike,
  Brain,
  CalendarClock,
  AlertTriangle,
  Info,
  Inbox,
  CheckCircle2,
  Wallet,
  UserPlus,
  Megaphone,
  RefreshCw,
  ArrowRight,
  Sparkles,
  Mail,
  PenLine,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "all" | "unread" | "system" | "transactions" | "activity" | "mentions";
type ViewMode = "feed" | "archived";
type Delay = ReturnType<typeof setTimeout>;

// ---------------------------------------------------------------------------
// Notification → icon / meta mapping (reuses existing type taxonomy)
// ---------------------------------------------------------------------------

interface NotifVisual {
  icon: React.ReactNode;
  /** small circular avatar-style class */
  cls: string;
  /** category the notification belongs to */
  category: TabId | "inventory" | "security" | "schedule";
}

const TYPE_VISUALS: Record<string, NotifVisual> = {
  "Out Of Stock": { icon: <AlertTriangle size={15} />, cls: "bg-red-500/10 text-red-500", category: "inventory" },
  "Stock Almost Finished": { icon: <PackageSearch size={15} />, cls: "bg-amber-500/10 text-amber-500", category: "inventory" },
  "AI Business Insight": { icon: <Brain size={15} />, cls: "bg-indigo-500/10 text-indigo-500", category: "activity" },
  "AI Recommendation": { icon: <Sparkles size={15} />, cls: "bg-fuchsia-500/10 text-fuchsia-500", category: "activity" },
  "AI Risk Alert": { icon: <ShieldCheck size={15} />, cls: "bg-rose-500/10 text-rose-500", category: "security" },
  "Sales Summary": { icon: <Wallet size={15} />, cls: "bg-emerald-500/10 text-emerald-500", category: "transactions" },
  "Daily Report": { icon: <Wallet size={15} />, cls: "bg-emerald-500/10 text-emerald-500", category: "transactions" },
  "Weekly Report": { icon: <Wallet size={15} />, cls: "bg-emerald-500/10 text-emerald-500", category: "transactions" },
  "Monthly Report": { icon: <Wallet size={15} />, cls: "bg-emerald-500/10 text-emerald-500", category: "transactions" },
  "Debt Due Reminder": { icon: <CircleDollarSign size={15} />, cls: "bg-amber-500/10 text-amber-500", category: "transactions" },
  "Delivery Assigned": { icon: <Bike size={15} />, cls: "bg-sky-500/10 text-sky-500", category: "activity" },
  "Delivery Completed": { icon: <Bike size={15} />, cls: "bg-sky-500/10 text-sky-500", category: "activity" },
  "Payment Received": { icon: <CircleDollarSign size={15} />, cls: "bg-teal-500/10 text-teal-500", category: "transactions" },
  "Payment Failed": { icon: <AlertTriangle size={15} />, cls: "bg-red-500/10 text-red-500", category: "transactions" },
  "Schedule Reminder": { icon: <CalendarClock size={15} />, cls: "bg-violet-500/10 text-violet-500", category: "schedule" },
  "Scheduled Reminder": { icon: <CalendarClock size={15} />, cls: "bg-violet-500/10 text-violet-500", category: "schedule" },
  "Role Invitation": { icon: <UserPlus size={15} />, cls: "bg-cyan-500/10 text-cyan-500", category: "activity" },
  "Account Activity": { icon: <ShieldCheck size={15} />, cls: "bg-orange-500/10 text-orange-500", category: "security" },
  "System Update": { icon: <RefreshCw size={15} />, cls: "bg-blue-500/10 text-blue-500", category: "system" },
  "Business Announcement": { icon: <Megaphone size={15} />, cls: "bg-pink-500/10 text-pink-500", category: "activity" },
  "Low Cash Balance": { icon: <CircleDollarSign size={15} />, cls: "bg-amber-500/10 text-amber-500", category: "transactions" },
  "Custom Notification": { icon: <Bell size={15} />, cls: "bg-slate-500/10 text-slate-400", category: "system" },
};

const getVisual = (type: string | undefined): NotifVisual =>
  TYPE_VISUALS[type || ""] || { icon: <Info size={15} />, cls: "bg-slate-500/10 text-slate-400", category: "system" };

const PRIORITY_INFO: Record<string, { label: string; cls: string }> = {
  critical: { label: "Urgent", cls: "bg-red-500/10 text-red-500" },
  high: { label: "Important", cls: "bg-amber-500/10 text-amber-500" },
  medium: { label: "Normal", cls: "bg-slate-500/10 text-slate-400" },
  low: { label: "Normal", cls: "bg-slate-500/10 text-slate-400" },
};

const TAB_DEFS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mentions", label: "Mentions" },
  { id: "system", label: "System" },
  { id: "transactions", label: "Transactions" },
  { id: "activity", label: "Activity" },
];

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatGroupTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  const t = d.getTime();
  if (t >= startToday) return "Today";
  if (t >= startYesterday) return "Yesterday";
  return "Earlier";
}

function formatDetailDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function NotificationsView() {
  const { activeBusinessId } = useBusinessStore();
  const { unreadReminderCount, scheduleReminders } = useNotificationStore();

  // Core state
  const [items, setItems] = useState<SQLiteRow<AppNotification>[]>([]);
  const [archived, setArchived] = useState<SQLiteRow<AppNotification>[]>([]);
  const [tab, setTab] = useState<TabId>("all");
  const [view, setView] = useState<ViewMode>("feed");
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind?: "success" | "danger" } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SQLiteRow<AppNotification> | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [liveToast, setLiveToast] = useState<SQLiteRow<AppNotification> | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const liveToastTimer = useRef<Delay | null>(null);
  const toastTimer = useRef<Delay | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  // ---- Realtime subscription (preserve existing data flow) ----
  // IMPORTANT: recompute archived synchronously inside the same subscriber so
  // archiving/restoring always updates the archived list immediately.
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

  // Live toast for newly arrived (last 8s) unread items
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

  // Auto-focus search on open
  useEffect(() => {
    if (isSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 60);
  }, [isSearchOpen]);

  // Close menu on scroll / resize
  useEffect(() => {
    const close = () => { setMenuFor(null); setMenuPos(null); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  const showToast = useCallback((msg: string, kind?: "success" | "danger") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ---- Derived data (filter + group) ----
  const baseList = useMemo(
    () => [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [items]
  );

  const filtered = useMemo(() => {
    let list = baseList;
    if (view === "archived") {
      list = archived;
    }
    switch (tab) {
      case "unread":
        list = list.filter((n) => !n.read_at);
        break;
      case "mentions":
        list = list.filter((n) => (n.message + " " + (n.title || "")).toLowerCase().includes("@"));
        break;
      case "system":
        list = list.filter((n) => getVisual(n.type).category === "system" || getVisual(n.type).category === "security");
        break;
      case "transactions":
        list = list.filter((n) => getVisual(n.type).category === "transactions");
        break;
      case "activity":
        list = list.filter((n) => getVisual(n.type).category === "activity" || getVisual(n.type).category === "schedule");
        break;
      default:
        break;
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((n) =>
        (n.title || "").toLowerCase().includes(q) ||
        (n.message || "").toLowerCase().includes(q) ||
        (n.created_by || "").toLowerCase().includes(q) ||
        formatNotificationNumber(n.id).toLowerCase().includes(q)
      );
    }
    return list;
  }, [baseList, archived, view, tab, query]);

  const groups = useMemo(() => {
    const map: Record<string, SQLiteRow<AppNotification>[]> = {};
    for (const n of filtered) {
      const key = formatGroupTime(n.created_at || n.sent_at || n.created_at);
      (map[key] = map[key] || []).push(n);
    }
    return [{ label: "Today", list: map["Today"] || [] }, { label: "Yesterday", list: map["Yesterday"] || [] }, { label: "Earlier", list: map["Earlier"] || [] }].filter(
      (g) => g.list.length > 0
    );
  }, [filtered]);

  const unreadCount = baseList.filter((n) => !n.read_at).length;
  const tabCount = (t: TabId) => {
    switch (t) {
      case "unread": return unreadCount;
      case "mentions": return baseList.filter((n) => (n.message + " " + (n.title || "")).toLowerCase().includes("@")).length;
      case "system": return baseList.filter((n) => getVisual(n.type).category === "system" || getVisual(n.type).category === "security").length;
      case "transactions": return baseList.filter((n) => getVisual(n.type).category === "transactions").length;
      case "activity": return baseList.filter((n) => getVisual(n.type).category === "activity" || getVisual(n.type).category === "schedule").length;
      default: return baseList.length;
    }
  };

  // ---- Actions (these update underlying state + DB via NotificationService) ----
  const actMarkRead = useCallback((id: string) => {
    NotificationService.markAsRead(id);
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
  }, []);

  const actMarkUnread = useCallback((id: string) => {
    NotificationService.markAsUnread(id);
  }, []);

  const actArchive = useCallback((id: string) => {
    NotificationService.archive(id);
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    setExpandedId((e) => (e === id ? null : e));
  }, []);

  const actRestore = useCallback((id: string) => {
    NotificationService.unarchive(id);
    showToast("Restored to feed");
  }, [showToast]);

  const actDelete = useCallback((id: string) => {
    NotificationService.delete(id);
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
  }, []);

  const actMarkAllRead = useCallback(() => {
    NotificationService.markAllRead();
    showToast("All marked as read");
  }, [showToast]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(filtered.map((n) => n.id)));
  }, [filtered]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const bulkMarkRead = useCallback(() => {
    selected.forEach((id) => NotificationService.markAsRead(id));
    showToast(`${selected.size} marked as read`);
    setSelected(new Set());
  }, [selected, showToast]);

  const bulkArchive = useCallback(() => {
    selected.forEach((id) => NotificationService.archive(id));
    showToast(`${selected.size} archived`);
    setSelected(new Set());
  }, [selected, showToast]);

  const bulkDelete = useCallback(() => {
    selected.forEach((id) => NotificationService.delete(id));
    showToast(`${selected.size} deleted`, "danger");
    setSelected(new Set());
  }, [selected, showToast]);

  const handleOpenDetail = useCallback((n: SQLiteRow<AppNotification>) => {
    if (selected.size > 0) { toggleSelect(n.id); return; }
    if (!n.read_at) NotificationService.markAsRead(n.id);
    setExpandedId((e) => (e === n.id ? null : n.id));
  }, [selected.size, toggleSelect]);

  const handleDeepLink = useCallback((n: SQLiteRow<AppNotification>) => {
    const target = n.action_target;
    if (!target || target === "none") return;
    window.dispatchEvent(new CustomEvent("navigate-tab", { detail: { tab: target } }));
    setExpandedId(null);
  }, []);

  const openMenu = useCallback((e: React.MouseEvent | React.TouchEvent, id: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ x: rect.right - 160, y: rect.bottom + 6 });
    setMenuFor(id);
  }, []);

  // ---- Render helpers ----
  const shouldShowConfirmation = selected.size > 0;

  return (
    <div className="h-full flex flex-col bg-app-bg text-app-text font-sans overflow-hidden">
      {/* ===================== Live toast ===================== */}
      <AnimatePresence>
        {liveToast && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-sm"
          >
            <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/70 rounded-2xl px-4 py-3 shadow-2xl text-white flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${getVisual(liveToast.type).cls}`}>
                {getVisual(liveToast.type).icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-amber-400 font-black">New notification</p>
                <p className="text-[12px] font-bold truncate">{liveToast.title}</p>
                <p className="text-[11px] text-slate-300 truncate">{liveToast.message}</p>
              </div>
              <button
                onClick={() => setLiveToast(null)}
                aria-label="Dismiss"
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================== Action toast ===================== */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl shadow-2xl text-[12px] font-bold flex items-center gap-2 ${
              toast.kind === "danger" ? "bg-red-500/95 text-white" : "bg-slate-900/95 text-white"
            }`}
          >
            {toast.kind === "danger" ? <Trash2 size={14} /> : <CheckCircle2 size={14} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================== Header ===================== */}
      <div className="shrink-0 px-3 md:px-6 pt-3 pb-2">
        {!shouldShowConfirmation ? (
          <div className="flex items-center gap-2">
            {/* Back (only in archived view) */}
            {view === "archived" && (
              <button
                onClick={() => setView("feed")}
                aria-label="Back to notifications"
                className="p-2 rounded-full hover:bg-app-card -ml-1"
              >
                <ChevronLeft size={18} />
              </button>
            )}

            <h1 className="text-lg font-extrabold font-display tracking-tight truncate">
              {view === "archived" ? "Archived" : "Notifications"}
            </h1>

            {unreadCount > 0 && view === "feed" && (
              <span className="px-1.5 py-0.5 min-w-[20px] text-center bg-amber-500 text-slate-950 text-[10px] font-black rounded-full">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}

            <div className="ml-auto flex items-center gap-0.5">
              {view === "feed" && (
                <button
                  onClick={() => { setIsSearchOpen((v) => !v); if (isSearchOpen) setQuery(""); }}
                  aria-label="Search notifications"
                  className="p-2 rounded-full hover:bg-app-card transition"
                >
                  <Search size={17} />
                </button>
              )}

              {/* Three-dot / options */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenuPos({ x: rect.right - 160, y: rect.bottom + 6 });
                    setMenuFor("__page__");
                  }}
                  aria-label="More options"
                  className="p-2 rounded-full hover:bg-app-card transition"
                >
                  <MoreVertical size={17} />
                </button>
              </div>

              <button
                onClick={() => setPrefsOpen(true)}
                aria-label="Notification settings"
                className="p-2 rounded-full hover:bg-app-card transition"
              >
                <Settings2 size={17} />
              </button>
            </div>
          </div>
        ) : (
          /* ---------- Selection mode toolbar ---------- */
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              aria-label="Close selection"
              className="p-2 rounded-full hover:bg-app-card"
            >
              <X size={18} />
            </button>
            <span className="text-[13px] font-extrabold">{selected.size} selected</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={bulkMarkRead}
                aria-label="Mark selected read"
                className="px-2.5 py-2 rounded-xl bg-app-card hover:bg-app-bg border border-app-border text-[11px] font-bold flex items-center gap-1.5"
              >
                <Check size={14} className="text-emerald-500" />
                <span className="hidden xs:inline">Read</span>
              </button>
              <button
                onClick={bulkArchive}
                aria-label="Archive selected"
                className="px-2.5 py-2 rounded-xl bg-app-card hover:bg-app-bg border border-app-border text-[11px] font-bold flex items-center gap-1.5"
              >
                <Archive size={14} className="text-sky-500" />
                <span className="hidden xs:inline">Archive</span>
              </button>
              <button
                onClick={bulkDelete}
                aria-label="Delete selected"
                className="px-2.5 py-2 rounded-xl bg-app-card hover:bg-app-bg border border-app-border text-[11px] font-bold flex items-center gap-1.5"
              >
                <Trash2 size={14} className="text-red-500" />
                <span className="hidden xs:inline">Delete</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===================== Search bar ===================== */}
      <AnimatePresence>
        {isSearchOpen && view === "feed" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.15 }}
            className="overflow-hidden shrink-0 px-3 md:px-6"
          >
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-app-text-muted" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notifications..."
                className="w-full bg-app-card border border-app-border focus:border-amber-500/50 focus:outline-none rounded-2xl py-2.5 pl-10 pr-9 text-[12px] font-medium"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-app-text-muted"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================== Tabs ===================== */}
      {view === "feed" ? (
        <div className="shrink-0 px-3 md:px-6 pb-2">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {TAB_DEFS.map((t) => {
              const active = tab === t.id;
              const count = tabCount(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-pressed={active}
                  className={`relative shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-colors ${
                    active ? "text-amber-500" : "text-app-text-muted hover:text-app-text"
                  }`}
                >
                  {t.label}
                  {count > 0 && (
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                      active ? "bg-amber-500/15 text-amber-500" : "bg-app-card text-app-text-muted"
                    }`}>
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                  {active && (
                    <motion.div
                      layoutId="notif-tab-pill"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-[3px] w-6 rounded-full bg-amber-500"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ===================== Feed ===================== */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-2 md:px-10 md:py-3">
        <div className="max-w-[820px] mx-auto pb-10">
          {/* Mark all as read — subtle text action */}
          {view === "feed" && tab !== "unread" && unreadCount > 0 && (
            <div className="flex justify-end px-2 pt-1">
              <button
                onClick={actMarkAllRead}
                className="text-[11px] font-bold text-app-text-muted hover:text-amber-500 transition flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-app-card"
              >
                <CheckCheck size={13} />
                Mark all as read
              </button>
            </div>
          )}

          {groups.length === 0 ? (
            <EmptyState view={view} tab={tab} hasQuery={!!query.trim()} onReset={() => setQuery("")} />
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-app-text-muted/70 sticky top-0 bg-app-bg/90 backdrop-blur-sm z-[5]">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.list.map((n) => (
                    <NotificationRow
                      key={n.id}
                      notif={n}
                      selected={selected.has(n.id)}
                      isExpanded={expandedId === n.id}
                      isSelectionMode={selected.size > 0}
                      reducedMotion={reducedMotion}
                      onToggleSelect={() => toggleSelect(n.id)}
                      onOpen={handleOpenDetail}
                      onMarkRead={() => actMarkRead(n.id)}
                      onMarkUnread={() => actMarkUnread(n.id)}
                      onArchive={() => actArchive(n.id)}
                      onRestore={view === "archived" ? () => actRestore(n.id) : undefined}
                      onDelete={() => actDelete(n.id)}
                      onMenu={openMenu}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ===================== Page-level options menu ===================== */}
      <AnimatePresence>
        {menuFor === "__page__" && menuPos && (
          <MenuOverlay
            x={menuPos.x}
            y={menuPos.y}
            onClose={() => { setMenuFor(null); setMenuPos(null); }}
            items={[
              view === "feed"
                ? { label: "Archive", icon: <Archive size={15} />, onClick: () => { setTab("all"); setView("archived"); setMenuFor(null); setMenuPos(null); } }
                : { label: "Back to notifications", icon: <Bell size={15} />, onClick: () => { setTab("all"); setView("feed"); setMenuFor(null); setMenuPos(null); } },
              { label: "Mark all as read", icon: <CheckCheck size={15} />, onClick: () => { actMarkAllRead(); setMenuFor(null); setMenuPos(null); }, disabled: unreadCount === 0 },
              { label: "Search", icon: <Search size={15} />, onClick: () => { setMenuFor(null); setMenuPos(null); setIsSearchOpen(true); } },
              { label: "Notification tones", icon: <SoundIcon />, onClick: () => { setMenuFor(null); setMenuPos(null); setToneOpen(true); } },
            ]}
          />
        )}
      </AnimatePresence>

      {/* ===================== Per-item menu ===================== */}
      <AnimatePresence>
        {menuFor && menuFor !== "__page__" && menuPos && (() => {
          const n = baseList.find((x) => x.id === menuFor) || archived.find((x) => x.id === menuFor);
          if (!n) return null;
          const isRead = !!n.read_at;
          const isArchived = !!n.archived_at;
          return (
            <MenuOverlay
              x={menuPos.x}
              y={menuPos.y}
              onClose={() => { setMenuFor(null); setMenuPos(null); }}
              items={[
                isRead
                  ? { label: "Mark as unread", icon: <Mail size={15} />, onClick: () => { actMarkUnread(n.id); setMenuFor(null); setMenuPos(null); } }
                  : { label: "Mark as read", icon: <Check size={15} />, onClick: () => { actMarkRead(n.id); setMenuFor(null); setMenuPos(null); } },
                isArchived
                  ? { label: "Restore", icon: <ArchiveRestore size={15} />, onClick: () => { actRestore(n.id); setMenuFor(null); setMenuPos(null); } }
                  : { label: "Archive", icon: <Archive size={15} />, onClick: () => { actArchive(n.id); setMenuFor(null); setMenuPos(null); } },
                { label: "View details", icon: <ArrowRight size={15} />, onClick: () => { handleOpenDetail(n); setMenuFor(null); setMenuPos(null); } },
                { label: "Delete", icon: <Trash2 size={15} />, danger: true, onClick: () => { setConfirmDelete(n); setMenuFor(null); setMenuPos(null); } },
              ]}
            />
          );
        })()}
      </AnimatePresence>

      {/* ===================== Notification Preferences sheet ===================== */}
      <AnimatePresence>
        {prefsOpen && <NotificationPrefsSheet onClose={() => setPrefsOpen(false)} />}
      </AnimatePresence>

      {/* ===================== Notification Tone sheet ===================== */}
      <AnimatePresence>
        {toneOpen && (
          <NotificationToneSheet
            onClose={() => setToneOpen(false)}
            reducedMotion={reducedMotion}
          />
        )}
      </AnimatePresence>

      {/* ===================== Delete confirmation ===================== */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
            onClick={() => setConfirmDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
              className="bg-app-card border border-app-border rounded-3xl shadow-2xl max-w-sm w-full p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-11 h-11 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center mb-3">
                <Trash2 size={20} />
              </div>
              <h3 className="text-[14px] font-extrabold">Delete notification?</h3>
              <p className="text-[12px] text-app-text-muted mt-1 leading-relaxed">
                "{confirmDelete.title}" will be permanently removed. You can't undo this.
              </p>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 py-2.5 rounded-2xl bg-app-bg hover:bg-app-card border border-app-border text-[12px] font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { actDelete(confirmDelete.id); setConfirmDelete(null); }}
                  className="flex-1 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-[12px] font-black"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu overlay (shared for page + item menus)
// ---------------------------------------------------------------------------

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function MenuOverlay({ x, y, onClose, items }: { x: number; y: number; onClose: () => void; items: MenuItem[] }) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <motion.div className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -4 }}
        transition={{ duration: 0.12 }}
        style={{ top: Math.min(y, window.innerHeight - items.length * 46 - 12), left: Math.min(x, window.innerWidth - 190) }}
        className="fixed w-[186px] bg-app-card border border-app-border rounded-2xl shadow-2xl p-1.5 z-50"
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it, i) => (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => { if (!it.disabled) it.onClick(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition ${
              it.disabled
                ? "opacity-40 cursor-not-allowed"
                : it.danger
                ? "text-red-500 hover:bg-red-500/10"
                : "text-app-text hover:bg-app-bg"
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
// Notification Row (mobile-first + swipe gestures + selection + expandable)
// ---------------------------------------------------------------------------

interface RowProps {
  notif: SQLiteRow<AppNotification>;
  selected: boolean;
  isExpanded: boolean;
  isSelectionMode: boolean;
  reducedMotion: boolean;
  onToggleSelect: () => void;
  onOpen: (n: SQLiteRow<AppNotification>) => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onArchive: () => void;
  onRestore?: () => void;
  onDelete: () => void;
  onMenu: (e: React.MouseEvent | React.TouchEvent, id: string) => void;
}

function NotificationRow({
  notif, selected, isExpanded, isSelectionMode, reducedMotion,
  onToggleSelect, onOpen, onMarkRead, onMarkUnread, onArchive, onRestore, onDelete, onMenu,
}: RowProps) {
  const isUnread = !notif.read_at;
  const visual = getVisual(notif.type);
  const prio = PRIORITY_INFO[notif.priority || "medium"] || PRIORITY_INFO.medium;

  // Swipe state
  const [offset, setOffset] = useState(0);
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);
  const SWIPE_LIMIT = 76;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isSelectionMode) return;
    startX.current = e.touches[0].clientX;
    dragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startX.current === null || !dragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    // Only intercept horizontal gestures, avoid breaking vertical scroll
    if (Math.abs(dx) > 8) {
      setOffset(Math.max(-SWIPE_LIMIT * 2, Math.min(SWIPE_LIMIT, dx)));
    }
  };

  const handleTouchEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    startX.current = null;
    if (offset > SWIPE_LIMIT * 0.5) {
      // Swipe right → mark read
      if (isUnread && !isSelectionMode) onMarkRead();
      setOffset(0);
    } else if (offset < -SWIPE_LIMIT * 0.5) {
      // Swipe left → archive (or delete if already archived view)
      if (onRestore) onDelete(); else onArchive();
      setOffset(0);
    } else {
      setOffset(0);
    }
  };

  // Actions "peek" buttons for desktop hover / mobile swipe hint
  const showLeftReveal = offset > 8;
  const showRightReveal = offset < -8;

  let parsedPayload: Record<string, any> = {};
  if (notif.payload) {
    try { parsedPayload = typeof notif.payload === "string" ? JSON.parse(notif.payload) : notif.payload; } catch {}
  }

  return (
    <>
      {/* Swipe action backdrops */}
      <div className="relative">
        {showRightReveal && (
          <div className="absolute inset-0 rounded-2xl bg-red-500 flex items-center justify-end pr-5 gap-4">
            {onRestore ? (
              <>
                <button aria-label="Delete" onClick={onDelete} className="flex flex-col items-center gap-1 text-white text-[9px] font-bold"><Trash2 size={16} /></button>
                <button aria-label="Restore" onClick={onRestore} className="flex flex-col items-center gap-1 text-white text-[9px] font-bold"><ArchiveRestore size={16} /></button>
              </>
            ) : (
              <>
                <button aria-label="Archive" onClick={onArchive} className="flex flex-col items-center gap-1 text-white text-[9px] font-bold"><Archive size={16} /></button>
                <button aria-label="Delete" onClick={onDelete} className="flex flex-col items-center gap-1 text-white text-[9px] font-bold"><Trash2 size={16} /></button>
              </>
            )}
          </div>
        )}
        {showLeftReveal && (
          <div className="absolute inset-0 rounded-2xl bg-emerald-500 flex items-center justify-start pl-5">
            <button aria-label="Mark read" onClick={onMarkRead} className="flex flex-col items-center gap-1 text-white text-[9px] font-bold"><Check size={16} /></button>
          </div>
        )}

        <motion.div
          style={{ x: offset }}
          animate={!dragging.current ? { x: 0 } : undefined}
          transition={{ duration: reducedMotion || dragging.current ? 0 : 0.15 }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={() => (isSelectionMode ? onToggleSelect() : onOpen(notif))}
          onContextMenu={(e) => { e.preventDefault(); onMenu(e, notif.id); }}
          className={`relative flex items-start gap-3 px-3 py-3 rounded-2xl cursor-pointer select-none transition-colors ${
            selected ? "bg-amber-500/10" : isUnread ? "bg-app-card/70" : "hover:bg-app-card/50"
          }`}
          aria-selected={selected}
          role={isSelectionMode ? "checkbox" : "button"}
          aria-checked={selected}
          aria-label={`${notif.title}. ${isUnread ? "Unread" : "Read"} notification`}
        >
          {/* Selection checkbox in selection mode */}
          {isSelectionMode && (
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-2 transition-colors ${
              selected ? "bg-amber-500 border-amber-500" : "border-app-text-muted/40"
            }`}>
              {selected && <Check size={12} className="text-slate-950" />}
            </div>
          )}

          {/* Avatar / icon */}
          <div className="relative shrink-0">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${visual.cls}`}>
              {visual.icon}
            </div>
            {isUnread && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-500 rounded-full ring-2 ring-app-bg" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-start gap-2">
              <h4 className={`text-[13px] leading-snug flex-1 min-w-0 ${isUnread ? "font-extrabold text-app-text" : "font-semibold text-app-text/90"}`}>
                {notif.title}
              </h4>
              <span className="shrink-0 text-[10px] font-medium text-app-text-muted mt-0.5">
                {formatTime(notif.created_at || notif.sent_at || new Date().toISOString())}
              </span>
            </div>

            <p className={`text-[12px] leading-relaxed text-app-text-muted mt-0.5 ${isExpanded ? "" : "line-clamp-2"}`}>
              {notif.message}
            </p>

            {/* Meta row: priority badge (only for meaningful statuses) */}
            {(notif.priority === "high" || notif.priority === "critical") && (
              <span className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${prio.cls}`}>
                {notif.priority === "critical" ? <AlertTriangle size={9} /> : <Info size={9} />}
                {prio.label}
              </span>
            )}

            {/* Expanded detail */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.16 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 pl-0.5 space-y-2.5 border-t border-app-border/40 pt-2.5">
                    {/* Key action */}
                    {notif.action_target && notif.action_target !== "none" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("navigate-tab", { detail: { tab: notif.action_target } })); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 text-[11px] font-extrabold rounded-xl transition border border-amber-500/20"
                      >
                        View {labelForTarget(notif.action_target)}
                        <ArrowRight size={11} />
                      </button>
                    )}

                    {/* Rich Markdown content (e.g. End Shift Summary report) */}
                    {parsedPayload.reportText && (
                      <div className="bg-slate-950/80 border border-slate-700/60 rounded-2xl p-3.5 max-h-80 overflow-y-auto">
                        <div className="text-[9.5px] font-black uppercase text-amber-400 tracking-wider mb-1 flex items-center justify-between border-b border-slate-800 pb-1.5">
                          <span>📋 Shift Summary Report</span>
                          {parsedPayload.employeeName && <span className="text-slate-400">Staff: {parsedPayload.employeeName}</span>}
                        </div>
                        <MarkdownBlock text={String(parsedPayload.reportText)} />
                      </div>
                    )}

                    {/* Custom notes (from EndShiftModal or custom notifications) */}
                    {parsedPayload.customMessage && !parsedPayload.reportText && (
                      <div className="bg-app-bg border border-app-border rounded-xl p-3.5">
                        <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">Note</div>
                        <div className="text-[12px] text-app-text leading-relaxed whitespace-pre-wrap">{parsedPayload.customMessage}</div>
                      </div>
                    )}

                    {/* Schedule details */}
                    {parsedPayload.shift_date && (
                      <div className="flex items-center gap-2 text-[11px] text-app-text-muted font-medium bg-app-bg border border-app-border rounded-xl px-3 py-2 font-mono">
                        <CalendarClock size={12} className="text-violet-400" />
                        <span>{parsedPayload.shift_date}</span>
                        {parsedPayload.start_time && <span>at {parsedPayload.start_time}</span>}
                      </div>
                    )}

                    {/* AI confidence */}
                    {parsedPayload.confidenceScore && (
                      <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-xl px-3 py-2.5">
                        <div className="flex items-center justify-between text-indigo-400 font-extrabold text-[10px] uppercase tracking-wide">
                          <span className="flex items-center gap-1"><Sparkles size={10} /> AI Confidence</span>
                          <span>{parsedPayload.confidenceScore}%</span>
                        </div>
                        {parsedPayload.recommendedAction && (
                          <p className="text-app-text text-[11px] font-medium leading-relaxed mt-1">
                            <span className="font-extrabold text-indigo-400">Recommendation:</span> {parsedPayload.recommendedAction}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Transaction ref */}
                    <div className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                      ID <span className="font-mono text-app-text font-black">{formatNotificationNumber(notif.id)}</span>
                    </div>
                    <div className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                      Received <span className="text-app-text font-black">{formatDetailDate(notif.created_at || notif.sent_at || new Date().toISOString())}</span>
                    </div>
                    {notif.status && (
                      <div className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider">
                        Delivery <span className={`font-black ${notif.status === "sent" ? "text-emerald-500" : notif.status === "delivered" ? "text-sky-500" : "text-amber-500"}`}>{notif.status}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop hover actions */}
          <div className="shrink-0 flex items-center gap-0.5 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            {isUnread ? (
              <button
                aria-label="Mark as read"
                onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
                className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-app-text-muted hover:text-emerald-500"
              >
                <Check size={14} />
              </button>
            ) : null}
            <button
              aria-label="More actions"
              onClick={(e) => onMenu(e, notif.id)}
              className="p-1.5 rounded-lg hover:bg-app-bg text-app-text-muted"
            >
              <MoreVertical size={14} />
            </button>
          </div>
        </motion.div>
      </div>
    </>
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

  for (const rawLine of lines) {
    const line = rawLine.trim();
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

  return <>{blocks}</>;
}

// ---------------------------------------------------------------------------
// Notification Preferences sheet (functional replacement for dead settings button)
// ---------------------------------------------------------------------------

const PREF_CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Stock Alerts": <PackageSearch size={15} />,
  "AI Insights": <Sparkles size={15} />,
  "Sales Reports": <Wallet size={15} />,
  "Debt Reminders": <CircleDollarSign size={15} />,
  "Delivery Notifications": <Bike size={15} />,
  "Payment Notifications": <CircleDollarSign size={15} />,
  "Scheduled Reminders": <CalendarClock size={15} />,
  "Announcements": <Megaphone size={15} />,
  "System Notifications": <Settings2 size={15} />,
};

function NotificationPrefsSheet({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState(NotificationPreferences.getUserPreferences());

  const toggle = (category: string) => {
    const next = prefs.map((p) => (p.category === category ? { ...p, enabled: !p.enabled } : p));
    setPrefs(next);
    NotificationPreferences.saveUserPreferences(next);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="bg-app-card border border-app-border rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-app-border/40 flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <Settings2 size={17} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-extrabold">Notification Preferences</h3>
            <p className="text-[11px] text-app-text-muted">Choose which categories you receive.</p>
          </div>
          <button onClick={onClose} aria-label="Close preferences" className="p-2 rounded-full hover:bg-app-bg shrink-0">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-2">
          {prefs.map((p) => {
            const enabled = p.enabled;
            return (
              <button
                key={p.category}
                onClick={() => toggle(p.category)}
                role="switch"
                aria-checked={enabled}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-app-bg transition text-left"
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  enabled ? "bg-amber-500/10 text-amber-500" : "bg-app-bg text-app-text-muted"
                }`}>
                  {PREF_CATEGORY_ICONS[p.category] || <Bell size={15} />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-bold block truncate">{p.category}</span>
                  <span className="text-[10px] text-app-text-muted">{enabled ? "Enabled" : "Muted"}</span>
                </div>
                <div className={`w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 ${
                  enabled ? "bg-amber-500" : "bg-app-border"
                }`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    enabled ? "translate-x-4" : "translate-x-0"
                  }`} />
                </div>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Notification Tone picker sheet (per-device, web + native)
// ---------------------------------------------------------------------------

function SoundIcon() {
  return <BellRing size={15} />;
}

function NotificationToneSheet({
  onClose,
  reducedMotion,
}: {
  onClose: () => void;
  reducedMotion: boolean;
}) {
  const [toneId, setToneId] = useState(NotificationToneService.getToneId());

  const previewTone = (id: NotificationToneId) => {
    NotificationToneService.setToneId(id);
    NotificationToneService.playWebTone(reducedMotion);
    setToneId(id);
  };

  const tones = NotificationToneService.getTones();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.18 }}
        className="bg-app-card border border-app-border rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-app-border/40 flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <SoundIcon />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-extrabold">Notification Tone</h3>
            <p className="text-[11px] text-app-text-muted">Applied to this device (web + mobile).</p>
          </div>
          <button onClick={onClose} aria-label="Close tone settings" className="p-2 rounded-full hover:bg-app-bg shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-2">
          {tones.map((tone) => {
            const active = toneId === tone.id;
            const isSilent = tone.id === "none";
            return (
              <button
                key={tone.id}
                onClick={() => previewTone(tone.id)}
                role="radio"
                aria-checked={active}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition text-left ${
                  active ? "bg-amber-500/10" : "hover:bg-app-bg"
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  isSilent
                    ? "bg-app-bg text-app-text-muted"
                    : active
                    ? "bg-amber-500/15 text-amber-500"
                    : "bg-app-bg text-app-text-muted"
                }`}>
                  {isSilent ? <X size={15} /> : <BellRing size={15} />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-bold block truncate">{tone.label}</span>
                  <span className="text-[10px] text-app-text-muted block truncate">{tone.description}</span>
                </div>
                {active && (
                  <span className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shrink-0">
                    <Check size={12} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="shrink-0 px-4 pb-4 pt-1">
          <p className="text-[10px] text-app-text-muted leading-relaxed">
            Web plays the tone via Web Audio. On the mobile app, the selected tone is
            requested for the native notification channel (audio asset must be bundled).
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ view, tab, hasQuery, onReset }: { view: ViewMode; tab: TabId; hasQuery: boolean; onReset: () => void }) {
  let icon = <BellRing size={26} />;
  let title = "You're all caught up";
  let sub = "New notifications will appear here.";
  let showReset = false;

  if (view === "archived") {
    icon = <Archive size={26} />;
    title = "No archived notifications";
    sub = "Archived notifications will appear here.";
  } else if (tab === "unread") {
    icon = <CheckCheck size={26} />;
    title = "No unread notifications";
    sub = "You've read everything.";
  } else if (hasQuery) {
    icon = <Search size={26} />;
    title = "No notifications found";
    sub = "Try a different search term.";
    showReset = true;
  } else if (tab !== "all") {
    title = "No notifications here";
    sub = "New items in this category will appear here.";
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-app-card border border-app-border flex items-center justify-center text-app-text-muted/40 mb-4">
        {icon}
      </div>
      <h3 className="text-[15px] font-extrabold text-app-text">{title}</h3>
      <p className="text-[12px] text-app-text-muted mt-1 max-w-xs leading-relaxed">{sub}</p>
      {showReset && (
        <button onClick={onReset} className="mt-4 px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 text-[11px] font-bold border border-amber-500/20">
          Clear search
        </button>
      )}
    </div>
  );
}