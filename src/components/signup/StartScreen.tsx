// src/components/signup/StartScreen.tsx
// What someone signed in sees before they are in any business (SaaS step 5):
//   * invitations sent to their verified email: join with one tap;
//   * their join requests (waiting / turned away) and sign-up request (waiting / approved / not
//     approved);
//   * otherwise two choices: start a business (free trial, a plan, or "ask us") or join one
//     with the join code the business gave them.
// Businesses are never listed or searchable: only a code or an invitation leads to one.

import React, { useCallback, useEffect, useState } from 'react';
import { Building, Clock, KeyRound, LogOut, Mail, RefreshCw, Store, Users, XCircle } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { useAuthStore } from '../../stores/authStore';
import { usePlanStore } from '../../stores/planStore';
import { toUserMessage } from '../../utils/userError';
import { Field, TextInput } from '../shared/Input';
import PlanChooser from '../plan/PlanChooser';
import { clearWantedPlan, readWantedPlan } from '../../utils/wantedPlan';

interface SignupState {
  email_verified: boolean;
  owns_company: boolean;
  trial_enabled: boolean;
  trial_days: number;
  can_start_trial: boolean;
  is_platform_admin: boolean;
  request: {
    id: string;
    plan_code: string;
    billing_cycle: string;
    business_name: string;
    status: 'pending' | 'approved' | 'rejected';
    decision_note: string | null;
    payment_reference: string | null;
    created_at: string;
  } | null;
  invites: Array<{ id: string; business_name: string; role: string; expires_at: string; supplier: boolean }>;
  join_requests: Array<{ id: string; business_name: string; status: 'pending' | 'rejected'; created_at: string }>;
}

export interface StartScreenProps {
  /** Go to the "set up your business" form (trial, approved request, or admin with a plan). */
  onCreateBusiness: (adminPlanCode?: string) => void;
  /** Go to the 6-character invitation code form. */
  onEnterInviteCode: () => void;
  onSignOut: () => void;
  /** Platform admins: open the platform console. */
  onOpenConsole?: () => void;
}

type View = 'home' | 'start' | 'join';

/** sessionStorage: a join code from a link (?join=), filled in once they are signed in. */
export const JOIN_CODE_KEY = 'kkm_join_code';
function savedJoinCode(): string {
  try {
    return sessionStorage.getItem(JOIN_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

const btnMain =
  'w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 text-xs font-semibold transition cursor-pointer';
const btnQuiet =
  'w-full py-2.5 rounded-xl border border-app-border bg-app-card hover:bg-app-bg text-app-text text-xs font-semibold transition cursor-pointer';

export default function StartScreen({ onCreateBusiness, onEnterInviteCode, onSignOut, onOpenConsole }: StartScreenProps) {
  const [state, setState] = useState<SignupState | null>(null);
  const [loadError, setLoadError] = useState('');
  // A plan picked on the public plans page opens straight away (once).
  const [wanted] = useState(() => {
    const w = readWantedPlan();
    clearWantedPlan();
    return w;
  });
  const [view, setView] = useState<View>(() => (savedJoinCode() ? 'join' : wanted ? 'start' : 'home'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [code, setCode] = useState(savedJoinCode);
  const catalogue = usePlanStore((s) => s.catalogue);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc('my_signup_state');
    if (error) {
      setLoadError(toUserMessage(error, 'Could not load your account. Check your connection and try again.'));
      return;
    }
    setLoadError('');
    setState(data as SignupState);
  }, []);

  useEffect(() => {
    load();
    usePlanStore.getState().loadCatalogue().catch(() => {});
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  /** Reloads this screen and the account: an accepted request or invitation opens the app. */
  const checkAgain = async () => {
    setBusy(true);
    await Promise.all([load(), useAuthStore.getState().refreshSession()]);
    setBusy(false);
  };

  const run = async (fn: () => Promise<{ error: any; data?: any }>, ok: string, after?: (data: any) => void) => {
    setBusy(true);
    setMessage(null);
    const { error, data } = await fn();
    setBusy(false);
    if (error) {
      setMessage({ tone: 'err', text: toUserMessage(error, 'That did not work. Please try again.') });
      return;
    }
    if (ok) setMessage({ tone: 'ok', text: ok });
    after?.(data);
    await load();
  };

  /** The set-up form, after the account is reloaded (the server's "may create" answer may have changed). */
  const goCreate = async (adminPlanCode?: string) => {
    setBusy(true);
    await useAuthStore.getState().refreshSession();
    setBusy(false);
    onCreateBusiness(adminPlanCode);
  };

  const planName = (code: string) => catalogue.find((p) => p.code === code)?.name ?? code;

  if (!state) {
    return (
      <div className="flex flex-col gap-3 text-xs text-center py-6 text-app-text">
        {loadError ? (
          <>
            <p className="text-red-600 font-semibold">{loadError}</p>
            <button type="button" className={btnQuiet} onClick={load}>Try again</button>
            <button type="button" className="text-[11px] text-red-600 font-semibold" onClick={onSignOut}>Sign out</button>
          </>
        ) : (
          <p className="text-app-text-muted">Loading...</p>
        )}
      </div>
    );
  }

  const req = state.request;
  const waitingJoins = state.join_requests.filter((j) => j.status === 'pending');
  const refusedJoins = state.join_requests.filter((j) => j.status === 'rejected');

  const header = (
    <div className="text-center space-y-1">
      <div className="mx-auto w-12 h-12 bg-amber-500/10 border border-amber-500/25 rounded-2xl flex items-center justify-center text-amber-600">
        <Store size={22} aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-app-text">Welcome</h3>
      <p className="text-[11px] text-app-text-muted">Start your own business, or join one you work for.</p>
    </div>
  );

  const note = message && (
    <p className={`text-[11px] font-semibold ${message.tone === 'err' ? 'text-red-600' : 'text-emerald-700'}`}>{message.text}</p>
  );

  const footer = (
    <div className="flex flex-col gap-2 pt-1">
      {onOpenConsole && (
        <button type="button" className={btnQuiet} onClick={onOpenConsole}>
          Platform console
        </button>
      )}
      <button type="button" className={btnQuiet} disabled={busy} onClick={checkAgain}>
        <span className="inline-flex items-center gap-1.5"><RefreshCw size={13} aria-hidden /> Check again</span>
      </button>
      <button
        type="button"
        onClick={onSignOut}
        className="text-[11px] text-red-600 hover:text-red-700 font-semibold inline-flex items-center justify-center gap-1"
      >
        <LogOut size={12} aria-hidden /> Sign out
      </button>
    </div>
  );

  // ----- Start a business: plans
  if (view === 'start') {
    return (
      <div className="flex flex-col gap-4 text-xs">
        <PlanChooser
          mode="new"
          initialPlan={wanted?.plan}
          initialCycle={wanted?.cycle}
          canStartTrial={state.can_start_trial}
          trialDays={state.trial_days}
          isPlatformAdmin={state.is_platform_admin}
          onStartTrial={() => goCreate()}
          onAdminCreate={(planCode) => goCreate(planCode)}
          onSent={() => {
            setView('home');
            setMessage({ tone: 'ok', text: 'Request sent. We will let you know when it is approved.' });
            load();
          }}
          onBack={() => setView('home')}
        />
        {!state.can_start_trial && !state.is_platform_admin && (
          <p className="text-[11px] text-app-text-muted text-center">
            {state.trial_enabled ? 'This account has already used its free trial.' : 'Free trials are not open right now.'}
          </p>
        )}
      </div>
    );
  }

  // ----- Join a business: the join code
  if (view === 'join') {
    return (
      <div className="flex flex-col gap-4 text-xs text-app-text">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><KeyRound size={15} aria-hidden /> Join a business</h3>
          <p className="text-[11px] text-app-text-muted leading-relaxed">
            Ask the business for its join code (8 letters). They will see your name and email and choose what you can do.
          </p>
        </div>
        <Field label="Join code">
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EFGH"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={12}
          />
        </Field>
        {note}
        <button
          type="button"
          className={btnMain}
          disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length !== 8}
          onClick={() =>
            run(
              async () => {
                const res = await getSupabase().rpc('redeem_join_code', { p_code: code });
                // A wrong code is an answer, not an error (so guesses are counted).
                if (!res.error && res.data?.error) return { error: { message: res.data.error } };
                return res;
              },
              '',
              (data) => {
                setCode('');
                try {
                  sessionStorage.removeItem(JOIN_CODE_KEY);
                } catch {
                  /* nothing saved */
                }
                setView('home');
                setMessage({ tone: 'ok', text: `Request sent to ${data?.business_name ?? 'the business'}. You can open it once they let you in.` });
              },
            )
          }
        >
          {busy ? 'Checking...' : 'Ask to join'}
        </button>
        <button type="button" className={btnQuiet} onClick={onEnterInviteCode}>
          I have a 6-character invitation code
        </button>
        <button type="button" className="text-[11px] text-app-text-muted font-semibold" onClick={() => { setMessage(null); setView('home'); }}>
          Back
        </button>
      </div>
    );
  }

  // ----- Home: invitations, requests, the two choices
  return (
    <div className="flex flex-col gap-4 text-xs text-app-text">
      {header}
      {note}

      {state.invites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-bold flex items-center gap-1.5"><Mail size={13} aria-hidden /> You're invited</h4>
          {state.invites.map((inv) => (
            <div key={inv.id} className="rounded-2xl border border-app-border bg-app-card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <span className="font-semibold block truncate">{inv.business_name}</span>
                <span className="text-[11px] text-app-text-muted">{inv.supplier ? 'As their supplier' : `As ${inv.role}`}</span>
              </div>
              <button
                type="button"
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-semibold disabled:opacity-60"
                onClick={() =>
                  run(
                    async () => getSupabase().rpc('accept_my_invitation', { p_invite_id: inv.id }),
                    `You joined ${inv.business_name}.`,
                    () => useAuthStore.getState().refreshSession(),
                  )
                }
              >
                Join
              </button>
            </div>
          ))}
        </section>
      )}

      {waitingJoins.map((j) => (
        <div key={j.id} className="rounded-2xl border border-app-border bg-app-card p-3 flex items-center gap-3">
          <Clock size={16} className="text-amber-600 shrink-0" aria-hidden />
          <div className="flex-1 min-w-0 text-[11px]">
            <span className="font-semibold block">Waiting for {j.business_name}</span>
            <span className="text-app-text-muted">They will let you in and choose your role. Then tap Check again.</span>
          </div>
          <button
            type="button"
            disabled={busy}
            className="text-[11px] font-semibold text-red-600"
            onClick={() => run(async () => getSupabase().rpc('cancel_join_request', { p_request_id: j.id }), 'Request cancelled.')}
          >
            Cancel
          </button>
        </div>
      ))}
      {refusedJoins.map((j) => (
        <div key={j.id} className="rounded-2xl border border-app-border bg-app-card p-3 flex items-center gap-3 text-[11px]">
          <XCircle size={16} className="text-red-500 shrink-0" aria-hidden />
          <span className="flex-1 min-w-0">{j.business_name} did not let you in. Ask them if this is a mistake.</span>
        </div>
      ))}

      {req?.status === 'pending' && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 flex flex-col gap-2">
          <span className="font-semibold flex items-center gap-1.5"><Clock size={14} aria-hidden /> Your request is being checked</span>
          <span className="text-[11px] text-app-text-muted leading-relaxed">
            {req.business_name} on {planName(req.plan_code)}
            {req.payment_reference ? `, payment code ${req.payment_reference}` : ''}. We will approve it soon; then you set up your business here.
          </span>
          <button
            type="button"
            disabled={busy}
            className="self-start text-[11px] font-semibold text-red-600"
            onClick={() => run(async () => getSupabase().rpc('cancel_signup_request', { p_request_id: req.id }), 'Request cancelled.')}
          >
            Cancel request
          </button>
        </div>
      )}

      {req?.status === 'approved' && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 flex flex-col gap-2">
          <span className="font-semibold">Approved: {planName(req.plan_code)}</span>
          <span className="text-[11px] text-app-text-muted">Set up {req.business_name} now.</span>
          <button type="button" className={btnMain} disabled={busy} onClick={() => goCreate()}>
            <span className="inline-flex items-center gap-1.5"><Building size={14} aria-hidden /> Set up my business</span>
          </button>
        </div>
      )}

      {req?.status === 'rejected' && (
        <div className="rounded-2xl border border-app-border bg-app-card p-3 text-[11px] leading-relaxed">
          <span className="font-semibold block">Your request for {req.business_name} was not approved.</span>
          {req.decision_note && <span className="block text-app-text-muted">{req.decision_note}</span>}
          <span className="text-app-text-muted">You can choose a plan again.</span>
        </div>
      )}

      {req?.status !== 'pending' && req?.status !== 'approved' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { setMessage(null); setView('start'); }}
            className="rounded-2xl border border-app-border bg-app-card hover:border-amber-500 p-4 text-left flex flex-col gap-1 transition"
          >
            <Building size={18} className="text-amber-600" aria-hidden />
            <span className="font-semibold">Start a business</span>
            <span className="text-[11px] text-app-text-muted">
              {state.can_start_trial ? `Free for ${state.trial_days} days, or choose a plan.` : 'Choose a plan.'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setMessage(null); setView('join'); }}
            className="rounded-2xl border border-app-border bg-app-card hover:border-amber-500 p-4 text-left flex flex-col gap-1 transition"
          >
            <Users size={18} className="text-amber-600" aria-hidden />
            <span className="font-semibold">Join a business</span>
            <span className="text-[11px] text-app-text-muted">With the code the business gave you.</span>
          </button>
        </div>
      )}

      {footer}
    </div>
  );
}
