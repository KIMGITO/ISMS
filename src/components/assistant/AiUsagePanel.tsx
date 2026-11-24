// src/components/assistant/AiUsagePanel.tsx
// How much of today's AI allowance the company has used (Settings -> AI assistant).
// The platform runs the AI; the plan sets a fair daily limit (get_ai_usage, 20261204002).

import React, { useEffect, useState } from "react";
import { getSupabase } from "../../services/supabaseClient";

interface AiUsage {
  has_ai: boolean;
  own_key: boolean;
  cap: number;
  used: number;
  resets_at: string;
}

export default function AiUsagePanel({ businessId }: { businessId: string | null }) {
  const [usage, setUsage] = useState<AiUsage | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let live = true;
    getSupabase()
      .rpc("get_ai_usage", { p_business_id: businessId })
      .then(({ data, error }) => {
        if (live && !error && data) setUsage(data as AiUsage);
      });
    return () => {
      live = false;
    };
  }, [businessId]);

  if (!usage) return null;

  if (usage.own_key) {
    return (
      <div className="rounded-2xl border border-app-border bg-app-bg p-3 text-[11px] text-app-text-muted leading-relaxed">
        <span className="font-semibold text-app-text block">Your own AI key</span>
        Your plan uses your own AI provider, so there is no daily limit from us. Your provider bills you for what you use.
        {usage.used > 0 && <span className="block mt-1">Questions today: {usage.used}</span>}
      </div>
    );
  }

  const pct = usage.cap > 0 ? Math.min(100, Math.round((usage.used / usage.cap) * 100)) : 100;
  const full = usage.cap > 0 && usage.used >= usage.cap;
  return (
    <div className="rounded-2xl border border-app-border bg-app-bg p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-app-text text-[11px]">Used today</span>
        <span className={`text-[11px] font-bold ${full ? "text-red-500" : "text-app-text"}`}>
          {usage.used} of {usage.cap}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-app-border overflow-hidden" aria-hidden>
        <div className={`h-full ${full ? "bg-red-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-app-text-muted leading-relaxed">
        The assistant is run for you and included in your plan, with a fair limit of {usage.cap} questions a day for the whole business.
        {full ? " Today's are used up. " : " "}
        It starts again at midnight.
      </span>
    </div>
  );
}
