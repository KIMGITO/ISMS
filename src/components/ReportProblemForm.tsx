// src/components/ReportProblemForm.tsx
// About this app → Report a problem. Owners and admins only; the report goes to the
// developer's Telegram through the ops-alert function.

import { useState } from 'react';
import { Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { sendProblemReport, SEVERITY_LABEL, type ProblemSeverity } from '../services/problemReportService';

export function ReportProblemForm({ businessId }: { businessId: string }) {
  const [severity, setSeverity] = useState<ProblemSeverity>('broken');
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'sending' } | { kind: 'sent'; reference: string } | { kind: 'failed'; message: string }>({ kind: 'idle' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim() || state.kind === 'sending') return;
    setState({ kind: 'sending' });
    try {
      const reference = await sendProblemReport({ businessId, severity, summary, details });
      setState({ kind: 'sent', reference });
      setSummary('');
      setDetails('');
      setSeverity('broken');
    } catch (err) {
      setState({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (state.kind === 'sent') {
    return (
      <div className="px-3 py-4 text-sm flex flex-col gap-2">
        <p className="inline-flex items-center gap-1.5 font-semibold text-emerald-600">
          <CheckCircle2 size={15} aria-hidden="true" /> Sent to the developer
        </p>
        <p className="text-app-text-muted">
          {state.reference && <>Reference <span className="font-mono text-app-text">{state.reference}</span>. </>}
          Problems that stop work are looked at the same day.
        </p>
        <button type="button" onClick={() => setState({ kind: 'idle' })} className="self-start text-sm font-semibold text-emerald-600 cursor-pointer">
          Report another problem
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="px-3 py-3 flex flex-col gap-3 text-sm">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-semibold text-app-text-muted pb-1">How bad is it?</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SEVERITY_LABEL) as ProblemSeverity[]).map((key) => (
            <label
              key={key}
              className={`px-3 py-2 min-h-10 rounded-lg border cursor-pointer inline-flex items-center ${
                severity === key ? 'border-emerald-500 bg-emerald-500/10 text-app-text font-semibold' : 'border-app-border text-app-text-muted'
              }`}
            >
              <input type="radio" name="severity" value={key} checked={severity === key} onChange={() => setSeverity(key)} className="sr-only" />
              {SEVERITY_LABEL[key]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-app-text-muted">What went wrong?</span>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={200}
          required
          placeholder="e.g. M-Pesa payments are not showing"
          className="w-full px-3 py-2.5 rounded-lg bg-app-bg border border-app-border focus:border-emerald-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-app-text-muted">What were you doing when it happened? (optional)</span>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="Steps, the screen you were on, any message you saw"
          className="w-full px-3 py-2.5 rounded-lg bg-app-bg border border-app-border focus:border-emerald-500 focus:outline-none resize-y"
        />
      </label>

      {state.kind === 'failed' && (
        <p className="inline-flex items-start gap-1.5 text-red-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={!summary.trim() || state.kind === 'sending'}
        className="self-start px-4 py-2.5 min-h-11 rounded-lg bg-emerald-600 text-white font-semibold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
      >
        <Send size={15} aria-hidden="true" />
        {state.kind === 'sending' ? 'Sending…' : 'Send to developer'}
      </button>
    </form>
  );
}

export default ReportProblemForm;
