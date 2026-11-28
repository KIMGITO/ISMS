// Header indicator for till payments that still need sorting out. Visible on every screen
// (POS and Quick Sale included) to staff who can match payments. Opens a small list of the
// latest ones; never pops up by itself, so it can't interrupt a checkout.
import { useEffect, useRef, useState } from "react";
import { useOverlay } from "../../hooks/useOverlay";
import { Inbox } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { useUiStore } from "../../stores/uiStore";
import { useUnclaimedPaymentsStore } from "../../stores/unclaimedPaymentsStore";
import { hasRolePermission } from "../../utils/permissions";
import { formatMoney } from "../../utils/money";
import { OPEN_TILL_STATUSES } from "../../types";
import { TILL_STATUS } from "../../features/UnclaimedPaymentsView";

export const UNCLAIMED_PERMISSIONS = ["payments.verify", "payments.mpesa"] as const;

export default function UnclaimedPaymentsIndicator() {
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const allowed = !!role && UNCLAIMED_PERMISSIONS.some((p) => hasRolePermission(role, p as any));
  const payments = useUnclaimedPaymentsStore((s) => s.payments);
  const count = useUnclaimedPaymentsStore((s) => s.unclaimedCount);
  const setFocus = useUnclaimedPaymentsStore((s) => s.setFocus);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const [open, setOpen] = useState(false);
  useOverlay(open, () => setOpen(false), "dropdown");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (allowed) useUnclaimedPaymentsStore.getState().start();
  }, [allowed]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!allowed) return null;
  const latest = payments.filter((p) => OPEN_TILL_STATUSES.includes(p.status)).slice(0, 6);
  const go = (id: string | null) => {
    setFocus(id);
    setActiveTab("unclaimed-payments");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <button
        id="header-unclaimed-payments"
        onClick={() => setOpen((o) => !o)}
        className={`p-2 rounded-xl border transition cursor-pointer relative ${
          count > 0 ? "bg-amber-500/10 border-amber-500/30 text-amber-600" : "bg-app-bg border-app-border text-app-text"
        }`}
        title="Unclaimed till payments"
        aria-label={`Unclaimed payments: ${count}`}
        aria-expanded={open}
      >
        <Inbox size={16} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-amber-500 text-slate-950 font-semibold rounded-full min-w-3.5 h-3.5 px-0.5 text-[10px] flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[min(22rem,calc(100vw-2rem))] bg-app-card border border-app-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-app-border flex items-center justify-between">
            <span className="text-xs font-semibold text-app-text">Unclaimed payments</span>
            <span className="text-[11px] text-app-text-muted">{count} open</span>
          </div>
          {latest.length === 0 ? (
            <p className="px-3 py-4 text-xs text-app-text-muted">Every till payment is sorted.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-app-border/50">
              {latest.map((p) => (
                <li key={p.id}>
                  <button onClick={() => go(p.id)} className="w-full text-left px-3 py-2 hover:bg-app-bg cursor-pointer">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-app-text tabular-nums">
                        {formatMoney(p.amount - p.allocated)}
                        {p.allocated > 0 && <span className="text-[11px] font-normal text-app-text-muted"> left of {formatMoney(p.amount)}</span>}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${TILL_STATUS[p.status].cls}`}>{TILL_STATUS[p.status].label}</span>
                    </div>
                    <div className="text-[11px] text-app-text-muted truncate">
                      <span className="font-mono">{p.transId}</span> · {p.payerName || "Unknown sender"} · {p.msisdn || "no phone"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => go(null)} className="w-full px-3 py-2 border-t border-app-border text-xs font-semibold text-emerald-700 hover:bg-app-bg cursor-pointer">
            View all
          </button>
        </div>
      )}
    </div>
  );
}
