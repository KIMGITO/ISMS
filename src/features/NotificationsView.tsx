// src/features/NotificationsView.tsx
import React, { useState, useEffect } from "react";
import { AppNotification } from "../types";
import { NotificationRepository, SQLiteRow } from "../services/notifications/notificationRepository";
import { NotificationService } from "../services/notifications/notificationService";
import { useBusinessStore } from "../stores/businessStore";
import { formatNotificationNumber } from "../utils/idUtils";

// Lucide Icons
import {
  Bell,
  Trash2,
  CheckCheck,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  ArrowRight,
  FileSpreadsheet,
  Coins,
  Bike,
  Award,
  Brain,
  Bolt
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function NotificationsView() {
  const { activeBusinessId } = useBusinessStore();

  // Core States
  const [notifications, setNotifications] = useState<SQLiteRow<AppNotification>[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>("All");
  const [visibleCount, setVisibleCount] = useState(15);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Subscribe to DB updates
  useEffect(() => {
    const unsubNotifications = NotificationRepository.subscribe((rows) => {
      setNotifications(rows);
    });

    return () => {
      unsubNotifications();
    };
  }, []);

  // Toast auto-dismiss
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleMarkAsRead = (id: string) => {
    NotificationService.markAsRead(id);
    setToastMessage("Notification marked as read");
  };

  const handleMarkAllRead = () => {
    NotificationService.markAllRead();
    setToastMessage("All notifications marked as read");
  };

  const handleDelete = (id: string) => {
    NotificationService.delete(id);
    setToastMessage("Notification deleted");
  };

  const handleClearRead = () => {
    const readNotifications = filteredNotifications.filter((n) => n.read_at);
    if (readNotifications.length === 0) {
      setToastMessage("No read notifications to clear");
      return;
    }
    readNotifications.forEach((n) => {
      NotificationService.delete(n.id);
    });
    setToastMessage(`Cleared ${readNotifications.length} read notifications`);
  };

  // Categories
  const categories = [
    "All",
    "Stock Alerts",
    "AI Insights",
    "Sales Reports",
    "Debt Reminders",
    "Delivery Notifications",
    "Payment Notifications"
  ];

  // Filtering Logic
  const filteredNotifications = notifications.filter((notif) => {
    // 1. Business Filter
    if (notif.business_id && notif.business_id !== "all" && notif.business_id !== activeBusinessId) {
      return false;
    }

    // 2. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matches = notif.title.toLowerCase().includes(q) || notif.message.toLowerCase().includes(q);
      if (!matches) return false;
    }

    // 3. Category Filter
    if (activeCategoryFilter !== "All") {
      const category = getCategoryForType(notif.type);
      if (category !== activeCategoryFilter) return false;
    }

    return true;
  });

  const showMore = () => {
    setVisibleCount((prev) => prev + 15);
  };

  const groupNotifications = (list: SQLiteRow<AppNotification>[]) => {
    const today: SQLiteRow<AppNotification>[] = [];
    const yesterday: SQLiteRow<AppNotification>[] = [];
    const earlier: SQLiteRow<AppNotification>[] = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 3600000 * 24;

    list.forEach((n) => {
      const t = new Date(n.created_at).getTime();
      if (t >= startOfToday) {
        today.push(n);
      } else if (t >= startOfYesterday) {
        yesterday.push(n);
      } else {
        earlier.push(n);
      }
    });

    return { today, yesterday, earlier };
  };

  const grouped = groupNotifications(filteredNotifications.slice(0, visibleCount));
  const unreadCount = filteredNotifications.filter((n) => !n.read_at).length;

  return (
    <div id="notifications-panel" className="h-full overflow-y-auto bg-app-bg text-app-text font-sans p-6 pb-24 space-y-6 max-w-4xl mx-auto">
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            className="fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-slate-900 border border-slate-700/80 text-white rounded-2xl py-3 px-6 shadow-xl flex items-center gap-3 z-50 text-xs font-semibold"
          >
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Title Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-app-border/40 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl shrink-0">
            <Bell size={22} className={unreadCount > 0 ? "" : ""} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-extrabold text-app-text uppercase tracking-wider font-display">Notifications</h2>
              {unreadCount > 0 && (
                <span className="px-2.5 py-0.5 bg-amber-500 text-slate-950 text-[9px] font-black rounded-full uppercase tracking-wider shadow-sm">
                  {unreadCount} New
                </span>
              )}
            </div>
            <p className="text-[11px] text-app-text-muted mt-0.5">
              Stay updated with real-time activities and alerts of your business.
            </p>
          </div>
        </div>

        {/* Bulk Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className="px-3.5 py-2 bg-app-card hover:bg-app-bg border border-app-border disabled:opacity-40 disabled:hover:bg-app-card text-app-text text-[10px] font-extrabold uppercase tracking-wider rounded-xl transition flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCheck size={13} className="text-amber-500" />
            <span>Mark all read</span>
          </button>
          <button
            onClick={handleClearRead}
            className="px-3.5 py-2 bg-app-card hover:bg-app-bg border border-app-border text-red-500 text-[10px] font-extrabold uppercase tracking-wider rounded-xl transition flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 size={13} />
            <span>Clear read</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-app-card border border-app-border rounded-3xl p-4 space-y-4 shadow-sm">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-app-text-muted" />
          <input
            type="text"
            placeholder="Search notifications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-app-bg text-[11px] font-semibold pl-10 pr-10 py-2.5 rounded-2xl border border-app-border focus:border-amber-500 focus:outline-none text-app-text transition"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-app-text-muted">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Categories Tab Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategoryFilter(cat)}
              className={`px-3 py-1 rounded-xl text-[10.5px] font-bold border transition shrink-0 cursor-pointer ${
                activeCategoryFilter === cat
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-500 font-extrabold"
                  : "bg-app-bg border-app-border text-app-text-muted hover:text-app-text"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Feed List */}
      <div className="space-y-6">
        {filteredNotifications.length === 0 ? (
          <div className="bg-app-card border border-app-border border-dashed rounded-3xl py-16 px-4 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-app-bg flex items-center justify-center border border-app-border text-app-text-muted/60">
              <Bell size={20} />
            </div>
            <div className="max-w-xs">
              <span className="font-extrabold text-xs block text-app-text">No Notifications Found</span>
              <span className="text-[10px] text-app-text-muted block mt-1 leading-relaxed">
                There are no notifications to display matching your filters.
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* Today Group */}
            {grouped.today.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[9px] font-black tracking-widest text-amber-500 uppercase">Today</span>
                  <div className="h-[1px] flex-1 bg-app-border/30" />
                </div>
                <div className="space-y-2.5">
                  {grouped.today.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      notif={notif}
                      onMarkRead={() => handleMarkAsRead(notif.id)}
                      onDelete={() => handleDelete(notif.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Yesterday Group */}
            {grouped.yesterday.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[9px] font-black tracking-widest text-app-text-muted uppercase">Yesterday</span>
                  <div className="h-[1px] flex-1 bg-app-border/30" />
                </div>
                <div className="space-y-2.5">
                  {grouped.yesterday.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      notif={notif}
                      onMarkRead={() => handleMarkAsRead(notif.id)}
                      onDelete={() => handleDelete(notif.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Earlier Group */}
            {grouped.earlier.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[9px] font-black tracking-widest text-app-text-muted uppercase">Earlier</span>
                  <div className="h-[1px] flex-1 bg-app-border/30" />
                </div>
                <div className="space-y-2.5">
                  {grouped.earlier.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      notif={notif}
                      onMarkRead={() => handleMarkAsRead(notif.id)}
                      onDelete={() => handleDelete(notif.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Load More */}
            {filteredNotifications.length > visibleCount && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={showMore}
                  className="px-4 py-2 bg-app-card hover:bg-app-bg border border-app-border hover:border-amber-500/20 text-app-text font-bold rounded-xl text-[10px] transition cursor-pointer uppercase tracking-wider"
                >
                  Load older notifications
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Component: NotificationItem
// -------------------------------------------------------------
interface NotificationItemProps {
  notif: SQLiteRow<AppNotification>;
  onMarkRead: () => void;
  onDelete: () => void;
}

function NotificationItem({ notif, onMarkRead, onDelete }: NotificationItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isUnread = !notif.read_at;

  const handleDeepLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (notif.action_target && notif.action_target !== "none") {
      window.dispatchEvent(new CustomEvent("navigate-tab", { detail: { tab: notif.action_target } }));
    }
  };

  const getIconAndColor = () => {
    const category = getCategoryForType(notif.type);
    switch (category) {
      case "Stock Alerts":
        return {
          icon: <AlertTriangle size={14} />,
          colorClass: "bg-red-500/10 text-red-500 border-red-500/20",
          leftBar: "bg-red-500"
        };
      case "AI Insights":
        return {
          icon: <Brain size={14} />,
          colorClass: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
          leftBar: "bg-indigo-500"
        };
      case "Sales Reports":
        return {
          icon: <FileSpreadsheet size={14} />,
          colorClass: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
          leftBar: "bg-emerald-500"
        };
      case "Debt Reminders":
        return {
          icon: <Coins size={14} />,
          colorClass: "bg-amber-500/10 text-amber-500 border-amber-500/20",
          leftBar: "bg-amber-500"
        };
      case "Delivery Notifications":
        return {
          icon: <Bike size={14} />,
          colorClass: "bg-sky-500/10 text-sky-500 border-sky-500/20",
          leftBar: "bg-sky-500"
        };
      case "Payment Notifications":
        return {
          icon: <CheckCircle2 size={14} />,
          colorClass: "bg-teal-500/10 text-teal-500 border-teal-500/20",
          leftBar: "bg-teal-500"
        };
      default:
        return {
          icon: <Info size={14} />,
          colorClass: "bg-slate-500/10 text-slate-500 border-slate-500/20",
          leftBar: "bg-slate-500"
        };
    }
  };

  const visual = getIconAndColor();

  let parsedPayload: Record<string, any> = {};
  if (notif.payload) {
    try {
      parsedPayload = typeof notif.payload === "string" ? JSON.parse(notif.payload) : notif.payload;
    } catch {}
  }

  return (
    <div
      onClick={() => setIsExpanded(!isExpanded)}
      className={`relative overflow-hidden rounded-2xl border border-app-border bg-app-card p-4 flex items-start gap-4 transition cursor-pointer select-none ${
        isUnread ? "bg-amber-500/[0.015] border-amber-500/15" : "opacity-90 hover:opacity-100"
      }`}
    >
      {/* Left indicator accent line */}
      <div className={`absolute top-0 bottom-0 left-0 w-1 ${visual.leftBar}`} />

      {/* Category Icon Badge */}
      <div className="shrink-0 relative">
        <div className={`p-2.5 rounded-xl border flex items-center justify-center ${visual.colorClass}`}>
          {visual.icon}
        </div>
        {isUnread && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-500 rounded-full ring-2 ring-app-card" />
        )}
      </div>

      {/* Core Notification Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap text-[9px] font-bold text-app-text-muted uppercase tracking-wider">
          <span>{getCategoryForType(notif.type)}</span>
          <span>·</span>
          <span>
            {new Date(notif.created_at || notif.sent_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {notif.priority === "critical" && (
            <span className="px-1.5 py-0.2 bg-red-500/15 text-red-500 font-black rounded-md uppercase text-[7px]">CRITICAL</span>
          )}
          {notif.priority === "high" && (
            <span className="px-1.5 py-0.2 bg-amber-500/15 text-amber-500 font-black rounded-md uppercase text-[7px]">HIGH</span>
          )}
        </div>

        <h4 className={`text-xs font-bold mt-1 ${isUnread ? "text-amber-500" : "text-app-text/90"}`}>
          {notif.title}
        </h4>

        <p className={`text-[10.5px] leading-relaxed mt-1 text-app-text-muted ${isExpanded ? "" : "line-clamp-1"}`}>
          {notif.message}
        </p>

        {/* Collapsible Details */}
        {isExpanded && (
          <div className="mt-3.5 space-y-3 pt-3 border-t border-app-border/40">
            {/* Deep link action */}
            {notif.action_target && notif.action_target !== "none" && (
              <button
                onClick={handleDeepLink}
                className="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 text-[9.5px] font-extrabold rounded-lg transition flex items-center gap-1 border-none cursor-pointer uppercase tracking-wider"
              >
                <span>Resolve Issue</span>
                <ArrowRight size={10} />
              </button>
            )}

            {/* Shift Closure Report Details */}
            {parsedPayload.reportText && (
              <div className="bg-slate-950/80 border border-slate-700/60 rounded-2xl p-3.5 space-y-2 font-mono text-[10.5px] text-slate-200 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                <div className="text-[9.5px] font-black uppercase text-amber-400 tracking-wider font-sans mb-1 flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span>📋 Shift Summary Report</span>
                  {parsedPayload.employeeName && <span className="text-slate-400">Staff: {parsedPayload.employeeName}</span>}
                </div>
                {parsedPayload.reportText}
              </div>
            )}

            {/* Custom Notes Details (if separate) */}
            {parsedPayload.customMessage && !parsedPayload.reportText && (
              <div className="bg-app-bg border border-app-border rounded-xl p-3 text-[11px] text-app-text font-medium leading-relaxed">
                <span className="font-bold text-amber-500 block text-[9.5px] uppercase tracking-wider mb-1">Note / Message:</span>
                {parsedPayload.customMessage}
              </div>
            )}

            {/* Confidence details if AI */}
            {parsedPayload.confidenceScore && (
              <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between text-indigo-400 font-extrabold text-[9.5px] uppercase tracking-wide">
                  <span className="flex items-center gap-1">
                    <Bolt size={10} />
                    <span>AI Confidence Score</span>
                  </span>
                  <span>{parsedPayload.confidenceScore}%</span>
                </div>
                {parsedPayload.recommendedAction && (
                  <p className="text-app-text text-[10px] font-medium leading-relaxed mt-0.5">
                    <span className="font-extrabold text-indigo-400">Recommendation:</span> {parsedPayload.recommendedAction}
                  </p>
                )}
              </div>
            )}

            {/* Metadata Info Footer */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[8.5px] text-app-text-muted font-bold uppercase tracking-wider">
              <div>
                <span>Ref:</span> <span className="text-app-text font-mono font-black">{formatNotificationNumber(notif.id)}</span>
              </div>
              <div>
                <span>Source:</span> <span className="text-app-text font-black">{notif.created_by || "System"}</span>
              </div>
              <div>
                <span>Sent At:</span> <span className="text-app-text font-black">{new Date(notif.created_at || notif.sent_at || Date.now()).toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Card Actions (Mark Read & Delete) */}
      <div className="shrink-0 self-center flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {isUnread && (
          <button
            onClick={onMarkRead}
            className="p-1.5 hover:bg-app-bg text-app-text-muted hover:text-amber-500 rounded-xl transition cursor-pointer border-none bg-transparent"
            title="Mark Read"
          >
            <CheckCheck size={14} className="text-app-text-muted/30 hover:text-amber-500" />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1.5 hover:bg-app-bg text-red-400 hover:text-red-500 rounded-xl transition cursor-pointer border-none bg-transparent"
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/** Helper to categorize notification types */
function getCategoryForType(type: string | undefined): string {
  if (!type) return "System Notifications";
  
  const t = type.toLowerCase();
  if (t.includes("stock") || t.includes("inventory")) return "Stock Alerts";
  if (t.includes("ai") || t.includes("insight") || t.includes("recommendation")) return "AI Insights";
  if (t.includes("sale") || t.includes("report") || t.includes("revenue")) return "Sales Reports";
  if (t.includes("debt") || t.includes("due")) return "Debt Reminders";
  if (t.includes("delivery") || t.includes("dispatch") || t.includes("rider")) return "Delivery Notifications";
  if (t.includes("payment") || t.includes("mpesa") || t.includes("cash")) return "Payment Notifications";
  
  return "System Notifications";
}
