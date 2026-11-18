// src/features/home/AiAdvisory.tsx
// Business advice for the chosen period. The bi-analyze function reads the books (profit,
// cash, who owes, bills due, VAT, stock) and these sales figures, works out the scorecard
// in code, and has the AI explain it and list what to do this week.
// The `metrics` keys are the ones that function reads; keep them as they are.

import React, { useState } from "react";
import { ArrowRight, CheckCircle, Square, Lightbulb } from "lucide-react";
import { SupabaseService } from "../../services/supabaseService";
import { useUiStore } from "../../stores/uiStore";
import { canOpenScreen } from "../../utils/screens";
import { useAuthStore } from "../../stores/authStore";
import { formatMoney } from '../../utils/money';

export interface AdviceAction { title: string; why: string; screen: string; amount: number }
export interface Advice {
  headline: string;
  health: "good" | "watch" | "act";
  healthReason: string;
  answer?: string;
  whatHappened: string[];
  cash: string;
  actions: AdviceAction[];
  watchOuts: string[];
  scorecard: { label: string; value: string; note?: string; tone?: "good" | "bad" }[];
  /** False when the role can't see the books; the advice used sales figures only. */
  fromBooks?: boolean;
}

const HEALTH = {
  good: { label: "On track", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  watch: { label: "Keep an eye", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  act: { label: "Act this week", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

const ksh = (v: number) => formatMoney(v);

export default function AiAdvisory({ businessId, metrics, period, fallback }: {
  businessId: string | null;
  metrics: Record<string, unknown>;
  /** The period on screen, as YYYY-MM-DD in Nairobi. */
  period: { start: string; end: string };
  fallback: () => Advice;
}) {
  const aiName = import.meta.env?.VITE_AI_NAME || "Kim";
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [question, setQuestion] = useState("");
  const [done, setDone] = useState<Record<string, boolean>>({});

  const analyse = async () => {
    setBusy(true);
    try {
      let res: any = await SupabaseService.callEdgeFunction("bi-analyze", { businessId, metrics, period, customQuestion: question.trim() || null });
      if (res && typeof res.json === "function") res = await res.json();
      if (!res?.success || !res.analysis?.headline) throw new Error(res?.error || "No advice returned");
      setAdvice(res.analysis as Advice);
      setOffline(false);
    } catch (err) {
      console.warn("bi-analyze unavailable, showing a summary built from local figures", err);
      setAdvice(fallback());
      setOffline(true);
    } finally {
      setBusy(false);
      setDone({});
    }
  };

  const go = (screen: string) => {
    if (role && canOpenScreen(role, screen)) useUiStore.getState().setActiveTab(screen as any);
  };
  const doneCount = advice ? advice.actions.filter((a) => done[a.title]).length : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500"><Lightbulb size={18} /></span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-app-text">{aiName}'s advice</h3>
            <p className="text-xs text-app-text-muted">Advice from this period's figures.</p>
          </div>
        </div>
      </div>

      <form
        className="mt-3 flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => { e.preventDefault(); if (!busy) void analyse(); }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          placeholder="Ask something (optional), e.g. Why did profit drop?"
          className="flex-1 min-w-0 rounded-full bg-app-bg px-4 py-2 text-sm text-app-text ring-1 ring-app-border focus:outline-none focus:ring-brand-500"
        />
        <button type="submit" disabled={busy} className="shrink-0 rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-slate-950 cursor-pointer disabled:opacity-50">
          {busy ? "Reading the books…" : advice ? "Ask again" : "Get advice"}
        </button>
      </form>

      {advice && (
        <div className={`mt-5 space-y-5 transition-opacity ${busy ? "opacity-50" : ""}`}>
          {offline && <p className="text-xs text-app-text-muted">{aiName} could not be reached. This summary is from the figures above.</p>}
          {!offline && advice.fromBooks === false && <p className="text-xs text-app-text-muted">From sales and stock only.</p>}

          {/* The verdict */}
          <div className="flex items-start gap-3">
            <span className={`shrink-0 mt-0.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${HEALTH[advice.health]?.cls || HEALTH.watch.cls}`}>
              {HEALTH[advice.health]?.label || HEALTH.watch.label}
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-snug text-app-text">{advice.headline}</p>
              {advice.healthReason && <p className="mt-0.5 text-xs text-app-text-muted">{advice.healthReason}</p>}
            </div>
          </div>

          {advice.answer && (
            <div className="rounded-xl bg-brand-500/5 ring-1 ring-brand-500/20 p-3">
              <h4 className="text-xs font-semibold text-app-text-muted">Your question</h4>
              <p className="mt-1 text-sm leading-relaxed text-app-text">{advice.answer}</p>
            </div>
          )}

          {/* The figures, worked out from the books, not by the AI */}
          {!!advice.scorecard?.length && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {advice.scorecard.map((s) => (
                <div key={s.label} className="rounded-xl bg-app-bg p-3 min-w-0">
                  <div className="text-[11px] text-app-text-muted truncate">{s.label}</div>
                  <div className={`text-sm font-semibold tabular-nums truncate ${s.tone === "bad" ? "text-red-600 dark:text-red-400" : s.tone === "good" ? "text-emerald-700 dark:text-emerald-400" : "text-app-text"}`}>{s.value}</div>
                  {s.note && <div className="text-[10px] text-app-text-muted truncate">{s.note}</div>}
                </div>
              ))}
            </div>
          )}

          {/* What to do, most valuable first */}
          {!!advice.actions.length && (
            <div>
              <h4 className="text-xs font-semibold text-app-text-muted">Do this week ({doneCount}/{advice.actions.length})</h4>
              <ul className="mt-2 space-y-1.5">
                {advice.actions.map((a) => (
                  <li key={a.title} className="flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-app-bg">
                    <button type="button" onClick={() => setDone((d) => ({ ...d, [a.title]: !d[a.title] }))} aria-label={done[a.title] ? "Mark not done" : "Mark done"} className="mt-0.5 shrink-0 cursor-pointer">
                      {done[a.title] ? <CheckCircle size={16} className="text-[var(--good)]" /> : <Square size={16} className="text-app-text-muted" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${done[a.title] ? "line-through text-app-text-muted" : "text-app-text"}`}>
                        {a.title}
                        {a.amount > 0 && <span className="ml-1.5 text-xs font-semibold text-brand-500 tabular-nums">{ksh(a.amount)}</span>}
                      </p>
                      {a.why && <p className="text-xs text-app-text-muted leading-snug">{a.why}</p>}
                    </div>
                    {a.screen && a.screen !== "home" && role && canOpenScreen(role, a.screen) && (
                      <button type="button" onClick={() => go(a.screen)} className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-app-text ring-1 ring-app-border hover:bg-app-card cursor-pointer">
                        Open <ArrowRight size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {!!advice.whatHappened.length && (
              <div>
                <h4 className="text-xs font-semibold text-app-text-muted">What happened</h4>
                <ul className="mt-2 space-y-1.5 text-sm text-app-text list-disc pl-4">
                  {advice.whatHappened.map((t, i) => <li key={i} className="leading-snug">{t}</li>)}
                </ul>
              </div>
            )}
            <div className="space-y-5">
              {advice.cash && (
                <div>
                  <h4 className="text-xs font-semibold text-app-text-muted">Cash</h4>
                  <p className="mt-2 text-sm leading-relaxed text-app-text">{advice.cash}</p>
                </div>
              )}
              {!!advice.watchOuts.length && (
                <div>
                  <h4 className="text-xs font-semibold text-app-text-muted">Watch out</h4>
                  <ul className="mt-2 space-y-1.5 text-sm text-app-text list-disc pl-4">
                    {advice.watchOuts.map((t, i) => <li key={i} className="leading-snug">{t}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
