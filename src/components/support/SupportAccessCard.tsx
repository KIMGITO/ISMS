// src/components/support/SupportAccessCard.tsx
// Business & branches -> Platform support. Only the Owner sees it. The Owner lets platform
// support into this branch for a set time, or ends it. Support can set up products, stock,
// customers, suppliers and settings, never sell, take payments, or change the plan or staff.

import React, { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { getSupabase } from "../../services/supabaseClient";
import { useNotificationStore } from "../../stores/notificationStore";
import { toUserMessage } from "../../utils/userError";
import { Segmented } from "../shared/Choice";
import { TextInput, Field } from "../shared/Input";
import { supportChanged, untilText, useSupportStatus } from "../../utils/supportAccess";

type Hours = "2" | "24" | "72";
const HOURS: { id: Hours; label: string }[] = [
  { id: "2", label: "2 hours" },
  { id: "24", label: "1 day" },
  { id: "72", label: "3 days" },
];

export default function SupportAccessCard({ businessId }: { businessId: string }) {
  const [status] = useSupportStatus(businessId);
  const [hours, setHours] = useState<Hours>("2");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useNotificationStore((s) => s.showToast);

  if (!status) return null;

  const call = async (fn: "support_allow" | "support_end", args: Record<string, unknown>, done: string) => {
    setBusy(true);
    const { error } = await getSupabase().rpc(fn, { p_business_id: businessId, ...args });
    setBusy(false);
    if (error) {
      toast("Couldn't save", toUserMessage(error, "Please try again."), undefined, "error");
      return;
    }
    setReason("");
    supportChanged();
    toast(done, "", undefined, "success");
  };

  return (
    <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-3 shadow-sm">
      <div className="flex items-start gap-3">
        <LifeBuoy size={18} className="text-amber-500 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-app-text font-display">Platform support</h3>
          <p className="text-[11px] text-app-text-muted mt-0.5">
            Let our support team into this branch to help you set up products, stock, customers and settings. They can't
            sell, take payments, or change your plan or staff. Everything they change is in the activity log.
          </p>
        </div>
      </div>

      {status.open ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            Allowed until {untilText(status.until)}
            {status.in_use ? ". Support is in this branch now." : ". Support hasn't opened it yet."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => call("support_end", {}, "Support access ended")}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl bg-red-500 text-white disabled:opacity-50"
          >
            End now
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="For how long">
            <Segmented<Hours> options={HOURS} value={hours} onChange={setHours} size="sm" ariaLabel="For how long" />
          </Field>
          <Field label="What do you need help with? (optional)">
            <TextInput value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Add my products and opening stock" />
          </Field>
          <button
            type="button"
            disabled={busy}
            onClick={() => call("support_allow", { p_hours: Number(hours), p_reason: reason.trim() || null }, "Support can open this branch")}
            className="self-start text-[11px] font-bold px-4 py-2 rounded-xl bg-amber-500 text-slate-900 disabled:opacity-50"
          >
            Allow support
          </button>
        </div>
      )}
    </div>
  );
}
