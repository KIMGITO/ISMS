// src/components/assistant/AreaAdvisor.tsx
// The AI helper card on Promotions & Points, Payments & Expenses and Finance & Accounting.
// It sends the question to the area-advisor function, which works out every figure itself;
// this card only shows the scorecard and the AI's plain explanation, and keeps a short chat.
// With `floating`, it is a draggable round button that opens the advisor in a sheet instead
// of a card in the page, so it stays out of the way on every tab.
import React, { useState } from 'react';
import { useModule } from "../../stores/planStore";
import { ArrowRight, ChevronDown, Send, Lightbulb } from 'lucide-react';
import { SupabaseService } from '../../services/supabaseService';
import { useBusinessStore } from '../../stores/businessStore';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { canOpenScreen } from '../../utils/screens';
import { Segmented } from '../shared/Choice';
import { TextInput } from '../shared/Input';
import { FloatingButton } from '../shared/FloatingButton';
import { FormSheet } from '../shared/FormSheet';

export type AdvisorArea = 'rewards' | 'money' | 'finance';

interface Advice {
  headline: string;
  health: 'good' | 'watch' | 'act';
  healthReason: string;
  answer: string;
  findings: string[];
  actions: { title: string; why: string; screen: string; amount: number }[];
  watchOuts: string[];
  scorecard: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }[];
}

const COPY: Record<AdvisorArea, { title: string; sub: string; ideas: string[] }> = {
  rewards: {
    title: 'Rewards advisor',
    sub: 'Ask about points, promotion codes and referrals.',
    ideas: ['Which code is worth keeping?', 'How much do unused points cost us?', 'Is the referral programme paying off?'],
  },
  money: {
    title: 'Payments & expenses advisor',
    sub: 'Ask about money in, voids and where spending goes.',
    ideas: ['Where is our spending growing?', 'How are customers paying?', 'Any voids I should worry about?'],
  },
  finance: {
    title: 'Finance advisor',
    sub: 'Ask about profit, cash, debts, bills and VAT.',
    ideas: ['Why did profit change?', 'What should I collect or pay first?', 'Can we cover bills due this week?'],
  },
};

const PERIODS = [
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TONE = {
  good: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  watch: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  act: 'bg-red-500/12 text-red-700 dark:text-red-300',
};

function AreaAdvisorInner({ area, floating = false }: { area: AdvisorArea; floating?: boolean }) {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const copy = COPY[area];
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [question, setQuestion] = useState('');
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ask = async (q: string) => {
    if (!businessId || busy) return;
    setBusy(true);
    setError('');
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    try {
      let res: any = await SupabaseService.callEdgeFunction('area-advisor', {
        businessId, area, question: q.trim() || null, history,
        period: { start: ymd(start), end: ymd(end) },
      });
      if (res && typeof res.json === 'function') res = await res.json();
      if (!res?.success || !res.advice?.headline) throw new Error(res?.error || 'No advice came back.');
      setAdvice(res.advice as Advice);
      if (q.trim()) setHistory((h) => [...h.slice(-2), { q: q.trim(), a: res.advice.answer || res.advice.headline }]);
      setQuestion('');
    } catch (e: any) {
      setError(e?.message && !/edge function|fetch|non-2xx/i.test(e.message) ? e.message : 'The advisor is not available right now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const go = (screen: string) => {
    if (role && canOpenScreen(role, screen)) useUiStore.getState().setActiveTab(screen as any);
  };

  if (!businessId) return null;

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Period"
          className="flex-1 min-w-[12rem]"
          options={PERIODS.map((p) => ({ id: String(p.id), label: p.label }))}
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
        />
        <button onClick={() => ask('')} disabled={busy}
          className="inline-flex items-center gap-1.5 h-11 sm:h-10 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-sm rounded-xl px-3 cursor-pointer disabled:opacity-50">
          {advice ? 'Refresh advice' : 'Get advice'}
        </button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask(question); }} className="flex gap-2 min-w-0">
        <TextInput
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="Ask a question…"
          aria-label="Ask the advisor"
          className="flex-1"
        />
        <button type="submit" disabled={busy || !question.trim()} aria-label="Ask"
          className="grid place-items-center size-11 sm:size-10 shrink-0 rounded-xl bg-amber-500 text-slate-950 cursor-pointer disabled:opacity-50">
          <Send size={16} />
        </button>
      </form>

      {!advice && !busy && (
        <div className="flex flex-wrap gap-1.5">
          {copy.ideas.map((i) => (
            <button key={i} onClick={() => ask(i)} className="text-xs rounded-full px-3 py-1.5 bg-app-bg ring-1 ring-app-border text-app-text-muted hover:text-app-text cursor-pointer text-left">
              {i}
            </button>
          ))}
        </div>
      )}

      {busy && <p className="text-sm text-app-text-muted animate-pulse">Reading your figures…</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}

      {advice && !busy && (
        <div className="space-y-3 min-w-0">
          <div className="flex items-start gap-2 min-w-0">
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${TONE[advice.health]}`}>
              {advice.health === 'good' ? 'On track' : advice.health === 'watch' ? 'Keep an eye' : 'Act now'}
            </span>
            <p className="text-sm font-semibold text-app-text break-words min-w-0">{advice.headline}</p>
          </div>
          {advice.answer && (
            <p className="text-sm text-app-text rounded-xl bg-amber-500/10 p-3 break-words whitespace-pre-line">{advice.answer}</p>
          )}
          {advice.scorecard.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {advice.scorecard.map((r) => (
                <div key={r.label} className="rounded-xl bg-app-bg p-2.5 min-w-0">
                  <p className="text-[11px] text-app-text-muted truncate">{r.label}</p>
                  <p className={`text-sm font-bold tabular-nums truncate ${r.tone === 'bad' ? 'text-red-600 dark:text-red-400' : r.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-app-text'}`}>{r.value}</p>
                  {r.note && <p className="text-[11px] text-app-text-muted truncate">{r.note}</p>}
                </div>
              ))}
            </div>
          )}
          {advice.findings.length > 0 && (
            <ul className="space-y-1.5 text-sm text-app-text-muted list-disc pl-4">
              {advice.findings.map((f, i) => <li key={i} className="break-words">{f}</li>)}
            </ul>
          )}
          {advice.actions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-app-text-muted">What to do</p>
              {advice.actions.map((a, i) => (
                <button key={i} onClick={() => go(a.screen)} className="w-full flex items-start gap-2 rounded-xl bg-app-bg p-2.5 text-left cursor-pointer min-w-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-app-text break-words">{a.title}</span>
                    <span className="block text-xs text-app-text-muted break-words">{a.why}</span>
                  </span>
                  <ArrowRight size={14} className="shrink-0 mt-1 text-app-text-muted" />
                </button>
              ))}
            </div>
          )}
          {advice.watchOuts.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300 list-disc pl-4">
              {advice.watchOuts.map((w, i) => <li key={i} className="break-words">{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </>
  );

  if (floating) {
    return (
      <>
        <FloatingButton
          id={`advisor-${area}`}
          icon={<Lightbulb />}
          label={copy.title}
          onClick={() => setOpen(true)}
          className="bg-amber-500 text-slate-950 hover:bg-amber-600"
        />
        {open && (
          <FormSheet title={copy.title} subtitle={copy.sub} onClose={() => setOpen(false)}>
            {body}
          </FormSheet>
        )}
      </>
    );
  }

  return (
    <div className="rounded-2xl bg-app-card shadow-xs min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 p-3 text-left cursor-pointer"
      >
        <span className="grid place-items-center size-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0"><Lightbulb size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-app-text truncate">{copy.title}</span>
          <span className="block text-xs text-app-text-muted line-clamp-2">{copy.sub}</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-app-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && <div className="px-3 pb-3 space-y-3 min-w-0">{body}</div>}
    </div>
  );
}

/** Shown only when the plan includes AI and insights. */
export default function AreaAdvisor(props: { area: AdvisorArea; floating?: boolean }) {
  const ai = useModule("ai");
  return ai ? <AreaAdvisorInner {...props} /> : null;
}
