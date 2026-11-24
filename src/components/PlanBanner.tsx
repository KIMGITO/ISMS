// src/components/PlanBanner.tsx
// One line above every screen when the plan needs attention: trial ending, payment overdue,
// read-only or suspended. Everyone sees it (so a refused save makes sense); people who can
// open Business Management get a link to the plan.

import React from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { usePlan } from "../stores/planStore";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { canOpenScreen } from "../utils/screens";

const DAY = 24 * 60 * 60 * 1000;

export function planNotice(plan: ReturnType<typeof usePlan>): { tone: "warn" | "stop"; text: string } | null {
  if (!plan || plan.legacy) return null;
  switch (plan.status) {
    case "trial": {
      if (!plan.trial_ends_at) return null;
      const days = Math.ceil((new Date(plan.trial_ends_at).getTime() - Date.now()) / DAY);
      if (days > 5) return null;
      return {
        tone: "warn",
        text: days <= 1
          ? "Your free trial ends today. Choose a plan to keep making changes."
          : `Your free trial ends in ${days} days. Choose a plan to keep making changes.`,
      };
    }
    case "grace":
      return { tone: "warn", text: "Payment for your plan is overdue. Pay soon to keep making changes." };
    case "read_only":
      return { tone: "stop", text: "Your plan has ended. You can see everything, but nothing can be changed until it is renewed." };
    case "suspended":
      return { tone: "stop", text: "This business is suspended. Contact us to open it again." };
    default:
      return null;
  }
}

export default function PlanBanner() {
  const plan = usePlan();
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const notice = planNotice(plan);
  if (!notice) return null;
  const canSeePlan = !!role && canOpenScreen(role, "business-management");
  const stop = notice.tone === "stop";
  return (
    <div
      role="status"
      className={`shrink-0 px-4 py-2 text-[11px] font-semibold flex items-center gap-2 border-b ${
        stop
          ? "bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400"
          : "bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-400"
      }`}
    >
      {stop ? <AlertTriangle size={13} className="shrink-0" aria-hidden /> : <Clock size={13} className="shrink-0" aria-hidden />}
      <span className="flex-1 min-w-0">{notice.text}</span>
      {canSeePlan && (
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.setItem("kkm_business_section", "plan");
            } catch {
              /* opens on the default section */
            }
            useUiStore.getState().setActiveTab("business-management" as any);
          }}
          className="shrink-0 underline font-bold"
        >
          See plan
        </button>
      )}
    </div>
  );
}
