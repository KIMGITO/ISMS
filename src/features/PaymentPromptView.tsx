// src/features/PaymentPromptView.tsx
// Payment Prompts: send an M-Pesa or Airtel Money prompt to a customer's phone in a few taps,
// then follow it live until it is paid or fails. Recent prompts from both networks sit beside
// it, and tapping one follows it again.
//
// A paid prompt is recorded as a payment by itself (a customer's pays their debt first, then
// tops up their wallet). It isn't a sale: ring the sale up as M-Pesa / Airtel Money at the till,
// or use the prompt for debts and deposits.

import { useEffect, useMemo, useRef, useState } from 'react';
import { NumberInput } from '../components/shared/Input';
import {
  CheckCircle2, Clock, Loader2, RefreshCw, RotateCcw, Send, Smartphone, XCircle, Plus, AlertTriangle, Settings2,
} from 'lucide-react';
import { create } from 'zustand';
import type { PaymentPrompt, PromptProvider } from '../types';
import { PromptRepository } from '../services/repositories';
import { useAppStore } from '../stores/appStore';
import { useBusinessStore } from '../stores/businessStore';
import { useCustomerStore } from '../stores/customerStore';
import { useUiStore } from '../stores/uiStore';
import { usePaymentMethods } from '../hooks/usePaymentMethods';
import { hasRolePermission } from '../utils/permissions';
import { formatCurrency } from '../utils/helpers';
import { toUserMessage } from '../utils/userError';
import { networkOf } from '../../supabase/functions/airtel-payments/phone';
import SearchableDropdown from '../components/SearchableDropdown';

const WALK_IN = '__walk_in__';
const LAST_PROVIDER_KEY = 'kkm_prompt_provider_v1';

export const PROVIDERS: Record<PromptProvider, { name: string; method: 'M-Pesa' | 'Airtel Money'; permission: 'payments.mpesa' | 'payments.airtel'; shortcut: string; on: string; ring: string; text: string; example: string }> = {
  mpesa: { name: 'M-Pesa', shortcut: 'prompt-mpesa', method: 'M-Pesa', permission: 'payments.mpesa', on: 'bg-emerald-600 text-white', ring: 'border-emerald-600', text: 'text-emerald-600', example: '0712 345 678' },
  airtel: { name: 'Airtel Money', shortcut: 'prompt-airtel', method: 'Airtel Money', permission: 'payments.airtel', on: 'bg-red-600 text-white', ring: 'border-red-600', text: 'text-red-600', example: '0733 123 456' },
};

/** Opens this screen with the form filled in, from anywhere in the app. */
interface PromptPrefill { customerId?: string; phone?: string; amount?: number; note?: string; provider?: PromptProvider }
const usePromptPrefill = create<{ prefill: PromptPrefill | null; set: (p: PromptPrefill | null) => void }>((set) => ({
  prefill: null,
  set: (prefill) => set({ prefill }),
}));
export function openPaymentPrompt(prefill: PromptPrefill = {}) {
  usePromptPrefill.getState().set(prefill);
  useUiStore.getState().setActiveTab('prompt');
}

/** Which networks this person may prompt with right now. */
export function usePromptProviders(): PromptProvider[] {
  const { currentEmployee } = useAppStore();
  const role = currentEmployee?.role || 'Guest';
  const methods = usePaymentMethods();
  return (Object.keys(PROVIDERS) as PromptProvider[]).filter(
    (p) => methods.includes(PROVIDERS[p].method) && hasRolePermission(role, PROVIDERS[p].permission),
  );
}

function readLastProvider(): PromptProvider | null {
  try {
    const v = localStorage.getItem(LAST_PROVIDER_KEY);
    return v === 'mpesa' || v === 'airtel' ? v : null;
  } catch { return null; }
}
function saveLastProvider(p: PromptProvider) {
  try { localStorage.setItem(LAST_PROVIDER_KEY, p); } catch { /* private window */ }
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function prettyPhone(msisdn: string): string {
  const local = msisdn.replace(/^254/, '0');
  return local.length === 10 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function StatusPill({ p }: { p: PaymentPrompt }) {
  if (p.status === 'Completed') return <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold"><CheckCircle2 size={13} /> Paid</span>;
  if (p.status === 'Failed') return <span className="inline-flex items-center gap-1 text-red-500 text-xs font-bold"><XCircle size={13} /> Not paid</span>;
  return <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-bold"><Clock size={13} /> Waiting</span>;
}

function ProviderBadge({ provider }: { provider: PromptProvider }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${provider === 'airtel' ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-700'}`}>
      {provider === 'airtel' ? 'Airtel' : 'M-Pesa'}
    </span>
  );
}

/** One step of the live tracker. */
function Step({ state, title, detail }: { state: 'done' | 'active' | 'failed' | 'waiting'; title: string; detail?: React.ReactNode }) {
  const icon = {
    done: <CheckCircle2 size={20} className="text-emerald-600" />,
    active: <Loader2 size={20} className="text-amber-500 animate-spin" />,
    failed: <XCircle size={20} className="text-red-500" />,
    waiting: <span className="w-5 h-5 rounded-full border-2 border-app-border block" />,
  }[state];
  return (
    <li className="flex gap-3">
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className={`text-sm font-semibold ${state === 'waiting' ? 'text-app-text-muted' : 'text-app-text'}`}>{title}</div>
        {detail && <div className="text-xs text-app-text-muted mt-0.5">{detail}</div>}
      </div>
    </li>
  );
}

function Tracker({ prompt, customerName, onAgain, onNew }: {
  prompt: PaymentPrompt;
  customerName: string;
  onAgain: () => void;
  onNew: () => void;
}) {
  const { showToast } = useAppStore();
  const pending = prompt.status === 'Pending';
  const now = useNow(pending);
  const elapsed = (now - new Date(prompt.createdAt).getTime()) / 1000;
  const [checking, setChecking] = useState(false);
  const autoChecks = useRef(0);

  const check = async (quiet = false) => {
    setChecking(true);
    try {
      const r = await PromptRepository.check(prompt);
      if (!quiet && r.status === 'Pending') {
        showToast(
          'Still waiting',
          r.paid ? 'Safaricom says it is paid. The receipt will show in a moment.' : 'No answer from the customer yet.',
          undefined,
          'info',
        );
      }
    } catch (err) {
      if (!quiet) showToast('Check', toUserMessage(err, "Couldn't check. Please try again."), undefined, 'error');
    } finally {
      setChecking(false);
    }
  };

  // If the network's callback is slow, ask it a few times by itself: at about 25 s, 50 s and 90 s.
  useEffect(() => { autoChecks.current = 0; }, [prompt.id]);
  useEffect(() => {
    if (!pending) return;
    const due = [25, 50, 90][autoChecks.current];
    if (due !== undefined && elapsed >= due) {
      autoChecks.current += 1;
      void check(true);
    }
  }, [pending, Math.floor(elapsed)]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = PROVIDERS[prompt.provider];
  const paid = prompt.status === 'Completed';
  const failed = prompt.status === 'Failed';
  const notSent = failed && (prompt.resultMessage || '').startsWith('Not sent');

  return (
    <section className={`bg-app-card border-2 rounded-2xl p-4 sm:p-5 shadow-sm ${paid ? 'border-emerald-500/60' : failed ? 'border-red-500/50' : 'border-amber-500/50'}`} aria-live="polite">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1"><ProviderBadge provider={prompt.provider} /><span className="text-xs text-app-text-muted">{when(prompt.createdAt)}</span></div>
          <div className="text-2xl font-bold text-app-text tabular-nums">{formatCurrency(prompt.amount)}</div>
          <div className="text-sm text-app-text truncate">{customerName} · {prettyPhone(prompt.phone)}</div>
          {prompt.description && <div className="text-xs text-app-text-muted truncate">{prompt.description}</div>}
        </div>
        {pending && <span className="text-sm font-mono font-bold text-amber-600 tabular-nums shrink-0">{clock(elapsed)}</span>}
      </div>

      <ol className="flex flex-col gap-3">
        <Step state={notSent ? 'failed' : 'done'} title={notSent ? 'Prompt not sent' : 'Prompt sent'} detail={notSent ? prompt.resultMessage : `To ${prettyPhone(prompt.phone)} on ${p.name}${prompt.requestedBy ? ` by ${prompt.requestedBy}` : ''}`} />
        {!notSent && (
          <Step
            state={pending ? 'active' : paid ? 'done' : 'failed'}
            title={pending ? 'Waiting for the customer to enter their PIN' : paid ? 'Customer approved' : 'Not paid'}
            detail={
              pending
                ? (elapsed > 75
                  ? 'Taking long. Prompts usually expire after about a minute: check now, or send it again.'
                  : 'They should see the request on their phone now.')
                : failed ? (prompt.resultMessage || 'The customer didn’t complete it.') : undefined
            }
          />
        )}
        {!notSent && (
          <Step
            state={paid ? 'done' : 'waiting'}
            title={paid ? 'Recorded' : 'Recorded as a payment'}
            detail={paid ? (
              <>
                Receipt <span className="font-mono font-semibold text-app-text">{prompt.receiptNumber}</span>
                {prompt.customerId ? ` · added to ${customerName}'s account (debt first, then wallet)` : ' · walk-in payment'}
              </>
            ) : undefined}
          />
        )}
      </ol>

      <div className="flex flex-wrap gap-2 mt-5">
        {pending && (
          <button type="button" onClick={() => void check()} disabled={checking} className="min-h-11 px-4 border border-app-border rounded-xl text-sm font-semibold text-app-text flex items-center gap-2 cursor-pointer disabled:opacity-50">
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> Check now
          </button>
        )}
        {(failed || (pending && elapsed > 60)) && (
          <button type="button" onClick={onAgain} data-shortcut="prompt-again" className={`min-h-11 px-4 rounded-xl text-sm font-bold flex items-center gap-2 cursor-pointer ${p.on}`}>
            <RotateCcw size={14} /> Send again
          </button>
        )}
        <button type="button" onClick={onNew} data-shortcut="prompt-new" className="min-h-11 px-4 bg-amber-500 text-slate-950 rounded-xl text-sm font-bold flex items-center gap-2 cursor-pointer">
          <Plus size={14} /> New prompt
        </button>
      </div>
    </section>
  );
}

export default function PaymentPromptView() {
  const { showToast, currentEmployee } = useAppStore();
  const role = currentEmployee?.role || 'Guest';
  const activeBusinessId = useBusinessStore((s) => s.activeBusinessId);
  const customers = useCustomerStore((s) => s.customers);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const providers = usePromptProviders();
  const canSetUp = hasRolePermission(role, 'payments.configure') || hasRolePermission(role, 'settings.integrations');
  const mayMpesa = hasRolePermission(role, 'payments.mpesa');
  const mayAirtel = hasRolePermission(role, 'payments.airtel');

  const [provider, setProvider] = useState<PromptProvider>(() => readLastProvider() || 'mpesa');
  const [payer, setPayer] = useState(WALK_IN);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [followId, setFollowId] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PaymentPrompt[]>([]);
  const [filter, setFilter] = useState<'all' | 'Pending' | 'Completed' | 'Failed'>('all');
  const phoneRef = useRef<HTMLInputElement>(null);

  // Stay on a provider this person may use.
  useEffect(() => {
    if (providers.length > 0 && !providers.includes(provider)) setProvider(providers[0]);
  }, [providers.join(','), provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filled in from elsewhere (a customer's page).
  const prefill = usePromptPrefill((s) => s.prefill);
  useEffect(() => {
    if (!prefill) return;
    setFollowId(null);
    setPayer(prefill.customerId || WALK_IN);
    setPhone(prefill.phone || customers.find((c) => c.id === prefill.customerId)?.phone || '');
    setAmount(prefill.amount ? String(Math.ceil(prefill.amount)) : '');
    setNote(prefill.note || '');
    if (prefill.provider) setProvider(prefill.provider);
    usePromptPrefill.getState().set(null);
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPrompts([]);
    setFollowId(null);
    if (!mayMpesa && !mayAirtel) return;
    return PromptRepository.subscribe({ mpesa: mayMpesa, airtel: mayAirtel }, setPrompts);
  }, [activeBusinessId, mayMpesa, mayAirtel]);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const customerItems = useMemo(
    () => [
      { id: WALK_IN, label: 'Walk-in customer', sublabel: 'No account' },
      ...customers.map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: [c.accountNumber && `Acc ${c.accountNumber}`, c.phone, Number(c.debtBalance || 0) > 0 && `owes ${formatCurrency(Number(c.debtBalance))}`].filter(Boolean).join(' · '),
      })),
    ],
    [customers],
  );
  const nameOf = (p: PaymentPrompt) => (p.customerId ? customerById.get(p.customerId)?.name || 'Customer' : 'Walk-in');

  const chooseProvider = (p: PromptProvider) => {
    setProvider(p);
    saveLastProvider(p);
  };

  const choosePayer = (id: string) => {
    setPayer(id);
    const customer = customerById.get(id);
    if (customer?.phone) setPhone(customer.phone);
    if (customer && !amount && Number(customer.debtBalance || 0) > 0) setAmount(String(Math.ceil(Number(customer.debtBalance))));
  };

  const network = networkOf(phone);
  const suggested: PromptProvider | null = network === 'airtel' ? 'airtel' : network === 'safaricom' ? 'mpesa' : null;
  const customer = payer !== WALK_IN ? customerById.get(payer) : undefined;
  const debt = Number(customer?.debtBalance || 0);
  const amountNum = Number(amount);
  const canSend = providers.includes(provider) && phone.trim().length >= 9 && Number.isInteger(amountNum) && amountNum >= 1 && !sending;

  const send = async (override?: { provider: PromptProvider; phone: string; amount: number; customerId?: string; description?: string }) => {
    const req = override || {
      provider,
      phone,
      amount: amountNum,
      customerId: payer === WALK_IN ? undefined : payer,
      description: note.trim() || undefined,
    };
    setSending(true);
    try {
      const id = await PromptRepository.send(req.provider, req);
      setFollowId(id);
      setAmount('');
      setNote('');
      // The new row arrives by realtime; fetch now so the tracker opens at once.
      PromptRepository.getRecent({ mpesa: mayMpesa, airtel: mayAirtel }).then(setPrompts).catch(() => {});
    } catch (err) {
      showToast(PROVIDERS[req.provider].name, toUserMessage(err, "Couldn't send the prompt. Please try again."), undefined, 'error');
    } finally {
      setSending(false);
    }
  };

  const followed = followId ? prompts.find((p) => p.id === followId) : undefined;
  const newPrompt = () => {
    setFollowId(null);
    setPayer(WALK_IN);
    setPhone('');
    setTimeout(() => phoneRef.current?.focus(), 50);
  };

  const today = new Date().toDateString();
  const todays = prompts.filter((p) => new Date(p.createdAt).toDateString() === today);
  const paidToday = todays.filter((p) => p.status === 'Completed').reduce((s, p) => s + p.amount, 0);
  const waiting = prompts.filter((p) => p.status === 'Pending' && Date.now() - new Date(p.createdAt).getTime() < 10 * 60_000).length;
  const listed = prompts.filter((p) => filter === 'all' || p.status === filter).slice(0, 40);

  // Nobody can be prompted: say why and where to fix it.
  if (providers.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-8">
          <section className="bg-app-card border border-app-border rounded-2xl p-5 text-center">
            <Smartphone size={28} className="mx-auto text-app-text-muted mb-2" />
            <h2 className="text-base font-bold text-app-text mb-1">No payment prompts available</h2>
            <p className="text-sm text-app-text-muted mb-4">
              {mayMpesa || mayAirtel
                ? 'M-Pesa and Airtel Money are switched off for this business, or not set up yet.'
                : "Your role can't send payment prompts. Ask the admin to allow M-Pesa or Airtel Money prompts under Roles."}
            </p>
            {canSetUp && (
              <button type="button" onClick={() => setActiveTab('money')} className="min-h-10 px-4 bg-amber-500 text-slate-950 font-bold rounded-xl text-sm inline-flex items-center gap-2 cursor-pointer">
                <Settings2 size={14} /> Open payment settings
              </button>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex flex-col gap-4 min-w-0">
          {/* Provider switch */}
          <div className="grid grid-cols-2 gap-1 bg-app-bg p-1 rounded-2xl border border-app-border" role="radiogroup" aria-label="Network">
            {(Object.keys(PROVIDERS) as PromptProvider[]).map((p) => {
              const available = providers.includes(p);
              const on = provider === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!available}
                  data-shortcut={PROVIDERS[p].shortcut}
                  onClick={() => chooseProvider(p)}
                  className={`min-h-12 rounded-xl text-sm font-semibold transition flex flex-col items-center justify-center cursor-pointer disabled:cursor-not-allowed ${on ? PROVIDERS[p].on + ' shadow' : 'text-app-text hover:bg-app-card'} ${!available ? 'opacity-40' : ''}`}
                >
                  <span>{PROVIDERS[p].name}</span>
                  {!available && <span className="text-[10px] font-semibold">Off or not set up</span>}
                </button>
              );
            })}
          </div>

          {followed ? (
            <Tracker
              prompt={followed}
              customerName={nameOf(followed)}
              onNew={newPrompt}
              onAgain={() => void send({
                provider: providers.includes(followed.provider) ? followed.provider : provider,
                phone: followed.phone,
                amount: followed.amount,
                customerId: followed.customerId,
                description: followed.description,
              })}
            />
          ) : followId ? (
            <section className="bg-app-card border border-app-border rounded-2xl p-5 flex items-center gap-3 text-sm text-app-text-muted">
              <Loader2 size={18} className="animate-spin text-amber-500" /> Opening the prompt…
            </section>
          ) : (
            <form
              className={`bg-app-card border-2 ${PROVIDERS[provider].ring} rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col gap-3`}
              onSubmit={(e) => { e.preventDefault(); if (canSend) void send(); }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-app-text-muted">Who is paying? (optional)</span>
                <SearchableDropdown
                  items={customerItems}
                  selectedValue={payer}
                  onChange={choosePayer}
                  placeholder="Walk-in customer"
                  searchPlaceholder="Name, phone or account number"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-app-text-muted">{PROVIDERS[provider].name} number</span>
                <input
                  ref={phoneRef}
                  type="tel"
                  inputMode="tel"
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={PROVIDERS[provider].example}
                  className="w-full bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-3 text-lg font-semibold tracking-wide focus:outline-none focus:border-amber-500"
                />
                {suggested && suggested !== provider && providers.includes(suggested) && (
                  <button type="button" onClick={() => chooseProvider(suggested)} className={`self-start text-xs font-semibold ${PROVIDERS[suggested].text} hover:underline cursor-pointer`}>
                    This looks like {suggested === 'airtel' ? 'an Airtel' : 'a Safaricom'} number. Use {PROVIDERS[suggested].name} →
                  </button>
                )}
                {network === 'telkom' && (
                  <span className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> This looks like a Telkom number; it may not get the prompt.</span>
                )}
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-app-text-muted">Amount (KSh, whole shillings)</span>
                <NumberInput
                  value={amount}
                  onChange={(n) => setAmount(n == null ? '' : String(n))}
                  min={0}
                  decimals={0}
                  placeholder="500"
                  className="!h-14"
                  inputClassName="!text-2xl font-bold tabular-nums"
                />
                {debt > 0 && (
                  <button type="button" onClick={() => setAmount(String(Math.ceil(debt)))} className="self-start text-xs font-semibold text-amber-600 hover:underline cursor-pointer">
                    Whole debt: {formatCurrency(debt)}
                  </button>
                )}
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-app-text-muted">Note (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October balance" className="w-full bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
              </label>

              <button
                type="submit"
                disabled={!canSend}
                className={`min-h-12 rounded-xl text-base font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 ${PROVIDERS[provider].on}`}
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                {sending ? 'Sending…' : `Send ${PROVIDERS[provider].name} prompt${amountNum > 0 ? ` · ${formatCurrency(amountNum)}` : ''}`}
              </button>
              <p className="text-[11px] text-app-text-muted">
                Recorded as a payment once they approve: a customer's pays their debt first, then tops up their wallet.
                It isn't a sale; ring sales up at the till.
              </p>
            </form>
          )}
        </div>

        {/* Recent prompts */}
        <aside className="flex flex-col gap-3 min-w-0">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-app-card border border-app-border rounded-2xl p-3">
              <div className="text-[10px] font-bold text-app-text-muted">Paid today</div>
              <div className="text-lg font-bold text-app-text tabular-nums">{formatCurrency(paidToday)}</div>
            </div>
            <div className="bg-app-card border border-app-border rounded-2xl p-3">
              <div className="text-[10px] font-bold text-app-text-muted">Waiting now</div>
              <div className={`text-lg font-bold tabular-nums ${waiting > 0 ? 'text-amber-600' : 'text-app-text'}`}>{waiting}</div>
            </div>
          </div>

          <section className="bg-app-card border border-app-border rounded-2xl p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-bold text-app-text">Recent prompts</h3>
            </div>
            <div className="flex gap-1 mb-2 overflow-x-auto" role="tablist" aria-label="Show">
              {([['all', 'All'], ['Pending', 'Waiting'], ['Completed', 'Paid'], ['Failed', 'Not paid']] as const).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  onClick={() => setFilter(id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${filter === id ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted hover:bg-app-bg'}`}
                >
                  {text}
                </button>
              ))}
            </div>
            {listed.length === 0 ? (
              <p className="text-sm text-app-text-muted py-6 text-center">No prompts yet.</p>
            ) : (
              <ul className="divide-y divide-app-border/40">
                {listed.map((p) => (
                  <li key={`${p.provider}-${p.id}`}>
                    <button
                      type="button"
                      onClick={() => setFollowId(p.id)}
                      className={`w-full text-left py-2.5 px-1.5 rounded-lg flex items-center justify-between gap-2 cursor-pointer hover:bg-app-bg ${followId === p.id ? 'bg-amber-500/5' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <ProviderBadge provider={p.provider} />
                          <span className="text-sm font-bold text-app-text tabular-nums">{formatCurrency(p.amount)}</span>
                        </div>
                        <div className="text-xs text-app-text-muted truncate">{nameOf(p)} · {prettyPhone(p.phone)} · {when(p.createdAt)}</div>
                      </div>
                      <StatusPill p={p} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
