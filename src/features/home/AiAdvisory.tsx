// src/features/home/AiAdvisory.tsx
// Sends the period's figures to the bi-analyze function and shows its advice.
// The payload keys are the ones that function reads; keep them as they are.

import React, { useState } from "react";
import { Brain, CheckCircle, Square } from "lucide-react";
import { SupabaseService } from "../../services/supabaseService";

interface Report {
  executiveSummary: string;
  keyInsights?: string[];
  risks?: string[];
  opportunities?: string[];
  recommendations?: string[];
  suggestedActions?: string[];
}

export default function AiAdvisory({ businessId, metrics, fallback }: { businessId: string | null; metrics: Record<string, unknown>; fallback: () => Report }) {
  const aiName = import.meta.env?.VITE_AI_NAME || "Kim";
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const analyse = async () => {
    setBusy(true);
    try {
      let res: any = await SupabaseService.callEdgeFunction("bi-analyze", { businessId, metrics, customQuestion: null });
      if (res && typeof res.json === "function") res = await res.json();
      if (!res?.success || !res.analysis) throw new Error(res?.error || "No analysis returned");
      const a = res.analysis;
      setReport({ ...a, executiveSummary: a.executiveSummary || a.summary || "", suggestedActions: a.suggestedActions || a.actionable_steps || [] });
      setOffline(false);
    } catch (err) {
      console.warn("bi-analyze unavailable, showing a summary built from local figures", err);
      setReport(fallback());
      setOffline(true);
    } finally {
      setBusy(false);
      setDone({});
    }
  };

  const lists: [string, string[] | undefined][] = report
    ? [["What stands out", report.keyInsights], ["Risks", report.risks], ["Opportunities", report.opportunities], ["Recommendations", report.recommendations]]
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500"><Brain size={18} /></span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-app-text">{aiName}'s advice</h3>
            <p className="text-xs text-app-text-muted">A written read of this period's figures, with suggested next steps.</p>
          </div>
        </div>
        <button type="button" onClick={analyse} disabled={busy} className="rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-slate-950 cursor-pointer disabled:opacity-50">
          {busy ? "Reading the figures…" : report ? "Ask again" : "Get advice"}
        </button>
      </div>

      {report && (
        <div className={`mt-5 space-y-5 transition-opacity ${busy ? "opacity-50" : ""}`}>
          {offline && <p className="text-xs text-app-text-muted">{aiName} could not be reached, so this summary was made on this device from the figures above.</p>}
          <p className="text-sm leading-relaxed text-app-text">{report.executiveSummary}</p>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {lists.filter(([, items]) => items?.length).map(([title, items]) => (
              <div key={title}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-app-text-muted">{title}</h4>
                <ul className="mt-2 space-y-1.5 text-sm text-app-text">
                  {items!.map((t, i) => <li key={i} className="leading-snug">{t}</li>)}
                </ul>
              </div>
            ))}
          </div>
          {!!report.suggestedActions?.length && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-app-text-muted">To do ({Object.values(done).filter(Boolean).length}/{report.suggestedActions.length})</h4>
              <ul className="mt-2 space-y-1">
                {report.suggestedActions.map((a) => (
                  <li key={a}>
                    <button type="button" onClick={() => setDone((d) => ({ ...d, [a]: !d[a] }))} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-app-bg cursor-pointer">
                      {done[a] ? <CheckCircle size={16} className="mt-0.5 shrink-0 text-[var(--good)]" /> : <Square size={16} className="mt-0.5 shrink-0 text-app-text-muted" />}
                      <span className={done[a] ? "line-through text-app-text-muted" : "text-app-text"}>{a}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
