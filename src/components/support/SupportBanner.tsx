// src/components/support/SupportBanner.tsx
// One line above every screen while platform support may open this branch (20261204007), so
// nobody is surprised by it. The Owner can end it here; support can leave here.

import React, { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { getSupabase } from "../../services/supabaseClient";
import { useAuthStore } from "../../stores/authStore";
import { useBusinessStore } from "../../stores/businessStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { toUserMessage } from "../../utils/userError";
import { supportChanged, supportLeft, untilText, useSupportStatus } from "../../utils/supportAccess";

export default function SupportBanner() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const [status] = useSupportStatus(businessId);
  const [busy, setBusy] = useState(false);
  const toast = useNotificationStore((s) => s.showToast);

  // Support whose time ran out (or who was ended) leaves the branch.
  const isSupport = role === "Support";
  useEffect(() => {
    if (isSupport && status && !status.open) {
      void supportLeft();
    }
  }, [isSupport, status]);

  if (!businessId || !status?.open) return null;
  const isOwner = role === "Owner";
  const me = !!status.me;

  const end = async () => {
    setBusy(true);
    const { error } = await getSupabase().rpc("support_end", { p_business_id: businessId });
    setBusy(false);
    if (error) {
      toast("Couldn't end it", toUserMessage(error, "Please try again."), undefined, "error");
      return;
    }
    supportChanged();
    if (me) await supportLeft();
  };

  const text = me
    ? `You are in this branch as platform support until ${untilText(status.until)}. You can set up, not sell or take payments.`
    : status.in_use
      ? `Platform support is in this branch until ${untilText(status.until)}.`
      : `Platform support may open this branch until ${untilText(status.until)}.`;

  return (
    <div
      role="status"
      className="shrink-0 px-4 py-2 text-[11px] font-semibold flex items-center gap-2 border-b bg-sky-500/10 border-sky-500/25 text-sky-700 dark:text-sky-300"
    >
      <LifeBuoy size={13} className="shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">{text}</span>
      {(isOwner || me) && (
        <button type="button" disabled={busy} onClick={end} className="shrink-0 underline font-bold disabled:opacity-50">
          {me ? "Leave" : "End now"}
        </button>
      )}
    </div>
  );
}
