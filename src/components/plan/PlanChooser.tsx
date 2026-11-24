// src/components/plan/PlanChooser.tsx
// Choosing a plan, then the plan page: what is paid to us, what other companies charge
// (estimates), the terms, and the request. Used by the start screen (a new company) and by
// Business & branches (changing the plan of this company).
//
// Prices, set-up fees, add-on prices, VAT, payment details and the other companies' charges all
// come from the database (plans, plan_modules, platform_settings, provider_cost_estimates;
// 20261204003). Nothing here is a tariff.

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, Infinity as InfinityIcon, Sparkles } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { usePlanStore, type PlanRow, type PlanModule } from '../../stores/planStore';
import { formatMoney, roundMoney } from '../../utils/money';
import { toUserMessage } from '../../utils/userError';
import { Segmented } from '../shared/Choice';
import { Field, NumberInput, TextInput } from '../shared/Input';
import { estimateMonthly, type CostEstimate } from '../../utils/planCosts';

type Cycle = 'monthly' | 'annual';

interface PageSettings {
  vat_percent: number;
  payment_instructions: string | null;
  terms_url: string | null;
  contact_text: string | null;
  trial_enabled: boolean;
  trial_days: number;
}

export interface PlanChooserProps {
  mode: 'new' | 'change';
  /** Change mode: the open branch. */
  businessId?: string;
  currentPlanCode?: string;
  /** Change mode: add-ons the company has now (ticked to start with; the request replaces the list). */
  currentAddons?: string[];
  canStartTrial?: boolean;
  trialDays?: number;
  isPlatformAdmin?: boolean;
  onStartTrial?: () => void;
  /** Platform admin: create the company on this plan without payment. */
  onAdminCreate?: (planCode: string) => void;
  onSent: () => void;
  onBack?: () => void;
  /** Open this plan's summary at once (picked on the public plans page). */
  initialPlan?: string;
  initialCycle?: Cycle;
}

const num = (v: unknown) => Number(v) || 0;

function basisText(row: CostEstimate): string {
  const a = num(row.amount);
  switch (row.basis) {
    case 'percent_mpesa':
      return `${a}% of M-Pesa payments${row.max_amount != null ? `, up to ${formatMoney(row.max_amount)} each` : ''}`;
    case 'percent_card':
      return `${a}% of card payments${row.max_amount != null ? `, up to ${formatMoney(row.max_amount)} each` : ''}`;
    case 'per_sms':
      return `${formatMoney(a)} per SMS`;
    case 'per_month':
      return `${formatMoney(a)} a month`;
    case 'per_year':
      return `${formatMoney(a)} a year`;
    default:
      return 'Free';
  }
}

function priceOf(plan: PlanRow, cycle: Cycle): number | null {
  const v = cycle === 'annual' ? plan.annual_price : plan.monthly_price;
  return v == null ? null : num(v);
}

function addonPrice(m: PlanModule, cycle: Cycle): number | null {
  const v = cycle === 'annual' ? m.addon_annual_price : m.addon_monthly_price;
  return v == null ? null : num(v);
}

const per = (cycle: Cycle) => (cycle === 'annual' ? 'a year' : 'a month');

export default function PlanChooser(props: PlanChooserProps) {
  const { mode, currentPlanCode } = props;
  const catalogue = usePlanStore((s) => s.catalogue);
  const modules = usePlanStore((s) => s.modules);
  const [settings, setSettings] = useState<PageSettings | null>(null);
  const [costs, setCosts] = useState<CostEstimate[]>([]);
  const [cycle, setCycle] = useState<Cycle>(props.initialCycle ?? 'monthly');
  // The free trial isn't a plan to buy: its card shows on the list instead.
  const [chosen, setChosen] = useState<string | null>(
    props.initialPlan && props.initialPlan !== 'trial' ? props.initialPlan : null,
  );

  useEffect(() => {
    usePlanStore.getState().loadCatalogue().catch(() => {});
    const supabase = getSupabase();
    supabase.rpc('get_plan_page_settings').then(({ data }) => {
      if (data) setSettings(data as PageSettings);
    });
    supabase
      .from('provider_cost_estimates')
      .select('*')
      .eq('active', true)
      .order('sort')
      .then(({ data }) => {
        if (data) setCosts(data as CostEstimate[]);
      });
  }, []);

  const subscriptions = catalogue.filter((p) => p.active && p.is_public && p.kind === 'subscription');
  const perpetual = catalogue.find((p) => p.active && p.is_public && p.kind === 'perpetual');
  const plan = catalogue.find((p) => p.code === chosen) ?? null;

  if (plan) {
    return (
      <PlanSummary
        {...props}
        plan={plan}
        cycle={plan.kind === 'perpetual' ? 'monthly' : cycle}
        modules={modules}
        settings={settings}
        costs={costs}
        onBack={() => setChosen(null)}
      />
    );
  }

  const moduleNames = (keys: string[]) =>
    modules.filter((m) => keys.includes(m.key) && m.key !== 'own_domain').map((m) => m.name);

  return (
    <div className="flex flex-col gap-4 text-app-text">
      <div className="flex items-center gap-2">
        {props.onBack && (
          <button type="button" onClick={props.onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-app-bg" aria-label="Back">
            <ArrowLeft size={16} />
          </button>
        )}
        <h3 className="text-sm font-semibold">{mode === 'new' ? 'Choose a plan' : 'Change plan'}</h3>
      </div>

      {mode === 'new' && props.canStartTrial && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <Sparkles size={14} className="text-amber-600" aria-hidden /> Free trial, {props.trialDays ?? settings?.trial_days ?? 14} days
          </div>
          <p className="text-[11px] text-app-text-muted leading-relaxed">
            Everything, for one branch and two staff. No payment. When it ends you choose a plan; until then nothing is lost.
          </p>
          <button
            type="button"
            onClick={props.onStartTrial}
            className="self-start px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-semibold"
          >
            Start free trial
          </button>
        </div>
      )}

      <Segmented<Cycle>
        ariaLabel="How often to pay"
        value={cycle}
        onChange={setCycle}
        options={[
          { id: 'monthly', label: 'Monthly' },
          { id: 'annual', label: 'Yearly' },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {subscriptions.map((p) => {
          const price = priceOf(p, cycle);
          const current = p.code === currentPlanCode;
          return (
            <div key={p.code} className={`rounded-2xl border p-4 flex flex-col gap-2 bg-app-card ${current ? 'border-amber-500' : 'border-app-border'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold">{p.name}</span>
                {current && <span className="text-[10px] font-semibold text-amber-600">Your plan</span>}
              </div>
              <div className="text-sm font-bold">
                {price == null ? 'Ask us' : formatMoney(price)}
                {price != null && <span className="text-[11px] font-medium text-app-text-muted"> {per(cycle)}</span>}
              </div>
              {num(p.setup_fee) > 0 && (
                <span className="text-[11px] text-app-text-muted">+ {formatMoney(p.setup_fee)} set-up, once</span>
              )}
              {p.description && <p className="text-[11px] text-app-text-muted leading-relaxed">{p.description}</p>}
              <ul className="flex flex-col gap-1 text-[11px]">
                <li className="flex gap-1.5"><Check size={12} className="text-emerald-500 mt-0.5 shrink-0" aria-hidden />{p.max_branches === 1 ? '1 branch' : `Up to ${p.max_branches} branches`}, {p.max_staff} staff</li>
                {p.ai_daily_cap > 0 && (
                  <li className="flex gap-1.5"><Check size={12} className="text-emerald-500 mt-0.5 shrink-0" aria-hidden />AI assistant, {p.ai_daily_cap} questions a day</li>
                )}
                {moduleNames(p.modules).map((n) => (
                  <li key={n} className="flex gap-1.5"><Check size={12} className="text-emerald-500 mt-0.5 shrink-0" aria-hidden />{n}</li>
                ))}
                {p.modules.length === 0 && (
                  <li className="flex gap-1.5"><Check size={12} className="text-emerald-500 mt-0.5 shrink-0" aria-hidden />Selling, stock, customers, money, staff and KRA eTIMS</li>
                )}
                {p.addons_allowed && (
                  <li className="text-app-text-muted">You can add single Pro Plus modules.</li>
                )}
              </ul>
              <div className="mt-auto pt-2 flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={current && !p.addons_allowed}
                  onClick={() => setChosen(p.code)}
                  className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-app-bg disabled:text-app-text-muted text-slate-950 text-xs font-semibold"
                >
                  {current ? (p.addons_allowed ? 'Change add-ons' : 'Current plan') : `Choose ${p.name}`}
                </button>
                {mode === 'new' && props.isPlatformAdmin && props.onAdminCreate && (
                  <button
                    type="button"
                    onClick={() => props.onAdminCreate!(p.code)}
                    className="w-full py-2 rounded-xl border border-app-border text-[11px] font-semibold hover:bg-app-bg"
                  >
                    Create without payment
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {perpetual && (
        <div className="rounded-2xl border border-app-border bg-app-card p-4 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <InfinityIcon size={14} aria-hidden /> {perpetual.name}
          </div>
          <p className="text-[11px] text-app-text-muted leading-relaxed">
            Pay once instead of every month. Still runs on our servers, with a fixed storage allowance and paid top-ups. You bring your own AI key. Ask us for a price.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setChosen(perpetual.code)}
              className="px-4 py-2 rounded-xl border border-app-border text-xs font-semibold hover:bg-app-bg"
            >
              Ask us
            </button>
            {mode === 'new' && props.isPlatformAdmin && props.onAdminCreate && (
              <button
                type="button"
                onClick={() => props.onAdminCreate!(perpetual.code)}
                className="px-4 py-2 rounded-xl border border-app-border text-[11px] font-semibold hover:bg-app-bg"
              >
                Create without payment
              </button>
            )}
          </div>
        </div>
      )}

      {subscriptions.length === 0 && (
        <p className="text-[11px] text-app-text-muted">Loading plans...</p>
      )}
    </div>
  );
}

function PlanSummary({
  mode,
  businessId,
  currentPlanCode,
  currentAddons,
  plan,
  cycle,
  modules,
  settings,
  costs,
  onBack,
  onSent,
}: PlanChooserProps & {
  plan: PlanRow;
  cycle: Cycle;
  modules: PlanModule[];
  settings: PageSettings | null;
  costs: CostEstimate[];
  onBack: () => void;
}) {
  const perpetual = plan.kind === 'perpetual';
  const billing = perpetual ? 'one_time' : cycle;
  const [addons, setAddons] = useState<string[]>(() =>
    plan.code === currentPlanCode && plan.addons_allowed ? [...(currentAddons ?? [])] : [],
  );
  const [mpesa, setMpesa] = useState<number | null>(100000);
  const [card, setCard] = useState<number | null>(0);
  const [sms, setSms] = useState<number | null>(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const addable = plan.addons_allowed ? modules.filter((m) => m.addable && !plan.modules.includes(m.key)) : [];
  const vat = num(settings?.vat_percent);
  const planPrice = perpetual ? null : priceOf(plan, cycle);
  const addonLines = addable
    .filter((m) => addons.includes(m.key))
    .map((m) => ({ key: m.key, name: m.name, price: addonPrice(m, cycle) }));
  const unknownPrice = planPrice == null || addonLines.some((a) => a.price == null);
  const recurring = roundMoney(num(planPrice) + addonLines.reduce((t, a) => t + num(a.price), 0));
  const setup = num(plan.setup_fee);
  const vatOn = (n: number) => roundMoney((n * vat) / 100);
  const today = roundMoney(recurring + setup + vatOn(recurring + setup));
  const then = roundMoney(recurring + vatOn(recurring));

  const has = (key: string | null) => !key || plan.modules.includes(key) || addons.includes(key);
  const others = useMemo(
    () => costs.filter((c) => has(c.needs)).map((c) => ({ ...c, monthly: estimateMonthly(c, num(mpesa), num(card), num(sms)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [costs, plan.code, addons, mpesa, card, sms],
  );
  const othersTotal = roundMoney(others.reduce((t, c) => t + c.monthly, 0));

  const send = async () => {
    setError('');
    if (mode === 'new' && !name.trim()) {
      setError('Enter the business name.');
      return;
    }
    if (!agreed) {
      setError('Please read and accept the terms and conditions.');
      return;
    }
    setBusy(true);
    const supabase = getSupabase();
    const res =
      mode === 'new'
        ? await supabase.rpc('request_business_signup', {
            p_plan_code: plan.code,
            p_billing_cycle: billing,
            p_business_name: name.trim(),
            p_phone: phone.trim() || null,
            p_message: message.trim() || null,
            p_addons: addons,
            p_payment_reference: reference.trim() || null,
          })
        : await supabase.rpc('request_plan_change', {
            p_business_id: businessId,
            p_plan_code: plan.code,
            p_billing_cycle: billing,
            p_addons: addons,
            p_payment_reference: reference.trim() || null,
            p_message: message.trim() || null,
          });
    setBusy(false);
    if (res.error) {
      setError(toUserMessage(res.error, 'Could not send the request. Check your connection and try again.'));
      return;
    }
    onSent();
  };

  const Row = ({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) => (
    <div className={`flex items-baseline justify-between gap-3 text-[11px] ${strong ? 'font-bold text-app-text' : 'text-app-text'}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 text-app-text">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-app-bg" aria-label="Back to plans">
          <ArrowLeft size={16} />
        </button>
        <h3 className="text-sm font-semibold">
          {plan.name}
          {!perpetual && <span className="text-app-text-muted font-medium">, paid {cycle === 'annual' ? 'yearly' : 'monthly'}</span>}
        </h3>
      </div>

      {addable.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-bold">Add-ons</h4>
          {addable.map((m) => {
            const price = addonPrice(m, cycle);
            const on = addons.includes(m.key);
            return (
              <label key={m.key} className="flex items-center gap-2 text-[11px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setAddons(on ? addons.filter((a) => a !== m.key) : [...addons, m.key])}
                  className="accent-amber-500"
                />
                <span className="flex-1">{m.name}</span>
                <span className="text-app-text-muted">{price == null ? 'Ask us' : `${formatMoney(price)} ${per(cycle)}`}</span>
              </label>
            );
          })}
        </section>
      )}

      <section className="rounded-2xl border border-app-border bg-app-card p-4 flex flex-col gap-1.5">
        <h4 className="text-xs font-bold mb-1">Paid to us</h4>
        {perpetual ? (
          <Row label={`${plan.name}, paid once`} value={plan.one_time_price != null ? formatMoney(plan.one_time_price) : 'We send you a price'} />
        ) : (
          <Row label={`${plan.name}, ${per(cycle)}`} value={planPrice == null ? 'Ask us' : formatMoney(planPrice)} />
        )}
        {addonLines.map((a) => (
          <Row key={a.key} label={`${a.name} add-on, ${per(cycle)}`} value={a.price == null ? 'Ask us' : formatMoney(a.price)} />
        ))}
        {setup > 0 && <Row label="Set-up, once" value={formatMoney(setup)} />}
        {!perpetual && (
          <>
            {vat > 0 && <Row label={`VAT ${vat}%`} value={formatMoney(vatOn(recurring + setup))} />}
            <div className="border-t border-app-border my-1" />
            <Row strong label="Due now" value={unknownPrice ? 'We confirm it' : formatMoney(today)} />
            <Row label={`Then ${per(cycle)}`} value={unknownPrice ? 'We confirm it' : formatMoney(then)} />
            {vat === 0 && <span className="text-[11px] text-app-text-muted">No VAT is charged on our prices.</span>}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-app-border bg-app-card p-4 flex flex-col gap-3">
        <div>
          <h4 className="text-xs font-bold">Paid to others (estimates)</h4>
          <p className="text-[11px] text-app-text-muted leading-relaxed mt-0.5">
            These companies bill you directly, not through us, and set their own prices. Check with them before you rely on these figures.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label="M-Pesa sales a month">
            <NumberInput size="sm" prefix="KSh" decimals={2} value={mpesa} onChange={setMpesa} min={0} />
          </Field>
          <Field label="Card sales a month">
            <NumberInput size="sm" prefix="KSh" decimals={2} value={card} onChange={setCard} min={0} />
          </Field>
          <Field label="SMS a month">
            <NumberInput size="sm" decimals={0} value={sms} onChange={setSms} min={0} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          {others.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-3 text-[11px]">
              <div className="min-w-0">
                <span className="font-semibold">{c.provider}</span>: {c.item}
                <span className="block text-app-text-muted">
                  {basisText(c)}
                  {c.note ? `. ${c.note}` : ''}
                  {c.checked_on ? ` Checked ${new Date(c.checked_on).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}
                </span>
              </div>
              <span className="shrink-0 tabular-nums">{c.basis === 'free' ? 'Free' : `${formatMoney(c.monthly)} a month`}</span>
            </div>
          ))}
          {others.length === 0 && <span className="text-[11px] text-app-text-muted">No other charges listed.</span>}
          {others.length > 0 && (
            <>
              <div className="border-t border-app-border" />
              <Row strong label="About, a month" value={formatMoney(othersTotal)} />
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        {mode === 'new' && (
          <>
            <Field label="Business name *">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mama Njeri Shop" />
            </Field>
            <Field label="Phone">
              <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="So we can call you" />
            </Field>
          </>
        )}
        <div className="rounded-2xl border border-app-border bg-app-bg p-3 text-[11px] leading-relaxed">
          <span className="font-semibold block">How to pay</span>
          {settings?.payment_instructions ?? 'We send you the payment details when we answer your request.'}
          {settings?.contact_text && <span className="block mt-1 text-app-text-muted">{settings.contact_text}</span>}
        </div>
        <Field label="Payment code (if you have paid)" hint="The M-Pesa or bank reference, so we can find your payment.">
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} autoCapitalize="characters" />
        </Field>
        <Field label="Message (optional)">
          <TextInput value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
        </Field>
        <label className="flex items-start gap-2 text-[11px] cursor-pointer">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="accent-amber-500 mt-0.5" />
          <span>
            I have read and accept the{' '}
            {settings?.terms_url ? (
              <a href={settings.terms_url} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                Terms and conditions
              </a>
            ) : (
              <span className="underline font-semibold" title="The terms page is being prepared">
                Terms and conditions
              </span>
            )}
            .
          </span>
        </label>
        {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={send}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <CheckCircle2 size={14} aria-hidden />
          {busy ? 'Sending...' : perpetual ? 'Ask for a price' : 'Send request'}
        </button>
        <p className="text-[11px] text-app-text-muted leading-relaxed">
          {mode === 'new'
            ? 'We check your request and payment, then you set up your business here. Nothing is charged by the app itself.'
            : 'We check your request and payment, then the new plan starts. Nothing is deleted when a plan changes.'}
        </p>
      </section>
    </div>
  );
}
