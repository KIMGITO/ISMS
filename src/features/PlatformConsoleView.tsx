// src/features/PlatformConsoleView.tsx
// The platform console (SaaS step 7), inside the main app. Only platform admins open it, and
// while it is open no business screen shows. Everything here goes through platform_* database
// functions that refuse anyone else (20261204001, 003, 005).
//
// What the console shows about a company is counts only (branches, staff, number of sales,
// AI use): never sales amounts, customers or products. Support access is a later step.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, Bot, Building2, CheckCircle2, ClipboardList, Coins, ExternalLink, Home, LayoutGrid,
  LifeBuoy, LogOut, Moon, Plus, Receipt, Settings2, Sun, Tags, Wallet, XCircle,
} from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { formatMoney } from '../utils/money';
import { SectionNav, NavSection } from '../components/shared/SectionNav';
import { DateTimeInput, Field, NumberInput, SearchInput, TextInput } from '../components/shared/Input';
import { Segmented } from '../components/shared/Choice';
import { Switch } from '../components/shared/Switch';
import { Checkbox } from '../components/shared/Checkbox';
import { FormSheet } from '../components/shared/FormSheet';
import type { PlanModule, PlanRow } from '../stores/planStore';
import { setConsoleOpen } from '../utils/platformConsole';
import { openAsSupport } from '../utils/supportAccess';
import { CYCLE_TEXT, StatusPill, btnMain, btnQuiet, btnDanger, card, day, num, useCall, when } from './console/common';
import ConsoleHome from './console/ConsoleHome';
import ConsoleMoney, { CompanyPayments, RecordPaymentSheet, RunningCostsSection } from './console/ConsoleMoney';

type Section = 'home' | 'requests' | 'companies' | 'money' | 'support' | 'plans' | 'costs' | 'running_costs' | 'settings' | 'ai' | 'activity';

const SECTIONS: NavSection<Section>[] = [
  { id: 'home', group: 'Platform', label: 'Home', description: 'Money, growth, break-even, use', icon: Home, keywords: 'overview charts statistics' },
  { id: 'requests', group: 'Platform', label: 'Requests', description: 'Sign-ups and plan changes to approve', icon: ClipboardList, keywords: 'approve signup payment' },
  { id: 'companies', group: 'Platform', label: 'Companies', description: 'Plans, add-ons, limits, trials', icon: Building2, keywords: 'tenant business suspend' },
  { id: 'money', group: 'Platform', label: 'Money', description: 'Payments received and who owes', icon: Wallet, keywords: 'payment billing paid owe mpesa cash' },
  { id: 'support', group: 'Platform', label: 'Support', description: 'Branches whose owner let you in', icon: LifeBuoy, keywords: 'help access open branch' },
  { id: 'plans', group: 'Prices', label: 'Plans and prices', description: 'Plan and add-on prices', icon: Tags },
  { id: 'running_costs', group: 'Prices', label: 'Our running costs', description: 'What the platform costs us; break-even', icon: Receipt, keywords: 'expenses break even supabase' },
  { id: 'costs', group: 'Prices', label: 'Costs paid to others', description: 'Estimates the plan page shows', icon: Coins, keywords: 'safaricom sms card domain' },
  { id: 'settings', group: 'Setup', label: 'Platform settings', description: 'Name, domain, trial, VAT, terms', icon: Settings2, keywords: 'domain trial vat terms app url' },
  { id: 'ai', group: 'Setup', label: 'AI', description: 'Provider and model for every company', icon: Bot },
  { id: 'activity', group: 'Setup', label: 'Activity', description: 'What platform admins changed', icon: Activity, keywords: 'audit log' },
];

/** The phone's bottom bar: the busiest sections, then everything else. */
const BAR: Array<{ id: Section | 'more'; label: string; icon: React.ElementType }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'requests', label: 'Requests', icon: ClipboardList },
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'money', label: 'Money', icon: Wallet },
  { id: 'more', label: 'More', icon: LayoutGrid },
];

// ============================================================================================
// Requests
// ============================================================================================
interface RequestRow {
  id: string;
  kind: 'new' | 'change';
  status: string;
  email: string | null;
  phone: string | null;
  person: string | null;
  business_name: string;
  plan_name: string;
  current_plan: string | null;
  billing_cycle: string;
  addons: string[];
  payment_reference: string | null;
  message: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

function RequestsSection() {
  const { call, busy } = useCall();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [all, setAll] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [paying, setPaying] = useState<RequestRow | null>(null);
  const load = useCallback(async () => {
    const d = (await call<RequestRow[]>('platform_requests', { p_include_decided: all })) ?? [];
    setRows(d);
    const ids = d.map((r) => r.id);
    if (!ids.length) return setPaid({});
    const { data } = await getSupabase().from('platform_payments').select('request_id, amount').in('request_id', ids).is('voided_at', null);
    const sums: Record<string, number> = {};
    for (const x of (data as Array<{ request_id: string; amount: number }>) ?? []) sums[x.request_id] = (sums[x.request_id] ?? 0) + num(x.amount);
    setPaid(sums);
  }, [call, all]);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (r: RequestRow, approve: boolean) => {
    const done = await call('platform_decide_signup', { p_request_id: r.id, p_approve: approve, p_note: notes[r.id]?.trim() || null },
      approve ? (r.kind === 'change' ? 'Plan changed.' : 'Approved. They can set up their business now.') : 'Turned down.');
    if (done) load();
  };

  return (
    <div className="space-y-3">
      <Segmented
        size="sm"
        ariaLabel="Which requests"
        value={all ? 'all' : 'waiting'}
        onChange={(v) => setAll(v === 'all')}
        options={[{ id: 'waiting', label: 'Waiting' }, { id: 'all', label: 'Last 90 days' }]}
      />
      {rows === null && <p className="text-sm text-app-text-muted">Loading...</p>}
      {rows?.length === 0 && <p className="text-sm text-app-text-muted">Nothing waiting.</p>}
      {rows?.map((r) => (
        <div key={r.id} className={`${card} space-y-2 text-sm`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{r.business_name}</span>
            <span className="rounded-full bg-app-bg px-2 py-0.5 text-[11px] font-semibold text-app-text-muted">
              {r.kind === 'change' ? `Change from ${r.current_plan ?? '?'}` : 'New company'}
            </span>
            {r.status !== 'pending' && <span className="text-[11px] font-semibold text-app-text-muted">{r.status}</span>}
            <span className="ml-auto text-[11px] text-app-text-muted">{when(r.created_at)}</span>
          </div>
          <p className="text-xs text-app-text-muted">
            {r.person ?? 'Someone'} · {r.email ?? 'no email'}{r.phone ? ` · ${r.phone}` : ''}
          </p>
          <p className="text-xs">
            <b>{r.plan_name}</b>, {CYCLE_TEXT[r.billing_cycle] ?? r.billing_cycle}
            {r.addons.length > 0 && ` + ${r.addons.join(', ')}`}
            {' · '}
            {r.payment_reference ? <>they gave code <span className="font-mono font-semibold">{r.payment_reference}</span></> : 'no payment code given'}
          </p>
          <p className={`text-xs font-semibold ${paid[r.id] ? 'text-emerald-600' : 'text-amber-600'}`}>
            {paid[r.id] ? `Payment recorded: ${formatMoney(paid[r.id])}` : 'No payment recorded yet'}
          </p>
          {r.message && <p className="text-xs italic text-app-text-muted">"{r.message}"</p>}
          {r.decision_note && <p className="text-xs text-app-text-muted">Note: {r.decision_note}</p>}
          {r.status === 'pending' && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <TextInput
                size="sm"
                className="flex-1 min-w-[12rem]"
                placeholder="Note (they see it if turned down)"
                value={notes[r.id] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              />
              <button type="button" disabled={busy} className={btnQuiet} onClick={() => decide(r, false)}><XCircle size={14} /> Turn down</button>
              <button type="button" disabled={busy} className={btnQuiet} onClick={() => setPaying(r)}><Plus size={14} /> Record payment</button>
              <button type="button" disabled={busy || !paid[r.id]} className={btnMain} onClick={() => decide(r, true)}
                title={paid[r.id] ? undefined : 'Record their payment first'}><CheckCircle2 size={14} /> Approve</button>
            </div>
          )}
        </div>
      ))}
      <p className="text-[11px] text-app-text-muted">
        Check the money arrived, record it, then approve. The days they get come from the payment. Turning a request down voids its payment on record, for a refund.
      </p>
      {paying && (
        <RecordPaymentSheet
          requestId={paying.id}
          title={`${paying.business_name} · ${paying.plan_name}, ${CYCLE_TEXT[paying.billing_cycle] ?? paying.billing_cycle}`}
          suggestedReference={paying.payment_reference}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); load(); }}
        />
      )}
    </div>
  );
}

// ============================================================================================
// Companies
// ============================================================================================
interface TenantRow {
  tenant_id: string;
  name: string;
  owner_name: string | null;
  owner_email: string | null;
  plan: string;
  plan_name: string;
  status: string;
  trial_ends_at: string | null;
  period_end: string | null;
  addons: string[] | null;
  branches: number;
  max_branches: number;
  staff: number;
  max_staff: number;
  created_at: string;
  last_sale_at: string | null;
}

function CompaniesSection({ plans, modules, openId, onOpened }: { plans: PlanRow[]; modules: PlanModule[]; openId?: string | null; onOpened?: () => void }) {
  const { call } = useCall();
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<TenantRow | null>(null);
  const load = useCallback(() => call<TenantRow[]>('platform_tenants').then((d) => setRows(d ?? [])), [call]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!openId || !rows) return;
    const r = rows.find((x) => x.tenant_id === openId);
    if (r) setOpen(r);
    onOpened?.();
  }, [openId, rows, onOpened]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !t || `${r.name} ${r.owner_name ?? ''} ${r.owner_email ?? ''} ${r.plan_name}`.toLowerCase().includes(t));
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search companies, owners, plans" />
      {rows === null && <p className="text-sm text-app-text-muted">Loading...</p>}
      {rows && shown.length === 0 && <p className="text-sm text-app-text-muted">No companies.</p>}
      <div className="space-y-2">
        {shown.map((r) => (
          <button
            key={r.tenant_id}
            type="button"
            onClick={() => setOpen(r)}
            className={`${card} w-full text-left hover:ring-amber-500/40 cursor-pointer`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-sm">{r.name}</span>
              <StatusPill status={r.status} />
              <span className="text-xs text-app-text-muted">{r.plan_name}</span>
            </div>
            <p className="mt-1 text-xs text-app-text-muted">
              {r.owner_name ?? 'No owner'}{r.owner_email ? ` · ${r.owner_email}` : ''} · {r.branches}/{r.max_branches} branches · {r.staff}/{r.max_staff} staff
              {r.status === 'trial' && r.trial_ends_at ? ` · trial ends ${day(r.trial_ends_at)}` : ''}
              {r.period_end ? ` · paid to ${day(r.period_end)}` : ''}
              {` · last sale ${r.last_sale_at ? day(r.last_sale_at) : 'never'}`}
            </p>
          </button>
        ))}
      </div>
      {open && (
        <CompanySheet
          row={open}
          plans={plans}
          modules={modules}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

interface TenantDetail {
  plan: { status: string; own_ai_key: boolean } | null;
  subscription: {
    plan_code: string;
    status: 'trial' | 'active' | 'suspended';
    billing_cycle: string;
    trial_ends_at: string | null;
    period_end: string | null;
    addons: string[];
    custom_limits: Record<string, unknown>;
    note: string | null;
  };
  branches: Array<{ id: string; name: string; website_slug: string | null; website_home: string | null; staff: number; sales_30_days: number; last_sale_at: string | null }>;
  ai_today: { calls: number; refused: number } | null;
  ai_30_days: number;
  history: Array<{ action: string; details: Record<string, unknown>; at: string }>;
}

const LIMITS: Array<[string, string]> = [
  ['max_branches', 'Branches'],
  ['max_staff', 'Staff'],
  ['storage_mb', 'Storage (MB)'],
  ['ai_daily_cap', 'AI questions a day'],
];

function CompanySheet({ row, plans, modules, onClose, onChanged }: {
  row: TenantRow; plans: PlanRow[]; modules: PlanModule[]; onClose: () => void; onChanged: () => void;
}) {
  const { call, busy } = useCall();
  const [d, setD] = useState<TenantDetail | null>(null);
  const [plan, setPlan] = useState(row.plan);
  const [cycle, setCycle] = useState('monthly');
  const [agreed, setAgreed] = useState<number | null>(null);
  const [agreedNote, setAgreedNote] = useState('');
  const [useAgreed, setUseAgreed] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [payKey, setPayKey] = useState(0);
  const [addons, setAddons] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, number | null>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [days, setDays] = useState<number | null>(7);

  const load = useCallback(async () => {
    const r = await call<TenantDetail>('platform_tenant_detail', { p_tenant_id: row.tenant_id });
    if (!r) return;
    setD(r);
    const s = r.subscription;
    setPlan(s.plan_code);
    setCycle(s.billing_cycle === 'trial' ? 'monthly' : s.billing_cycle);
    const { data: sub } = await getSupabase().from('tenant_subscriptions').select('agreed_price, agreed_note').eq('tenant_id', row.tenant_id).maybeSingle();
    setAgreed(sub?.agreed_price ?? null);
    setUseAgreed(sub?.agreed_price != null);
    setAgreedNote(sub?.agreed_note ?? '');
    setAddons(s.addons ?? []);
    const c = s.custom_limits ?? {};
    setLimits(Object.fromEntries(LIMITS.map(([k]) => [k, typeof c[k] === 'number' ? (c[k] as number) : null])));
    setExtra(Array.isArray(c.modules) ? (c.modules as string[]) : []);
  }, [call, row.tenant_id]);
  useEffect(() => {
    load();
  }, [load]);

  const chosen = plans.find((p) => p.code === plan);
  const after = async (res: unknown, warn = true) => {
    if (!res) return;
    const w = (res as { warnings?: string[] }).warnings;
    if (warn && w?.length) useNotificationStore.getState().showToast('Over the new plan', w.join(' '), undefined, 'info');
    onChanged();
    load();
  };

  const kind = chosen?.kind ?? 'subscription';
  const effCycle = kind === 'trial' ? 'trial' : kind === 'perpetual' ? 'one_time' : cycle;
  const listPrice = kind === 'perpetual' ? chosen?.one_time_price : effCycle === 'annual' ? chosen?.annual_price : chosen?.monthly_price;
  const needsAgreed = (effCycle === 'monthly' || effCycle === 'annual' || effCycle === 'one_time') && listPrice == null;
  const savePlan = async () =>
    after(await call('platform_change_plan', {
      p_tenant_id: row.tenant_id, p_plan_code: plan, p_cycle: effCycle,
      p_agreed_price: (useAgreed || needsAgreed) && effCycle !== 'manual' ? agreed : null,
      p_agreed_note: agreedNote.trim() || null,
    }, effCycle === 'manual' ? 'Saved. Free, no end date.' : effCycle === 'trial' ? 'Saved. On a trial.' : 'Saved. The paid-up date comes from their payments.'));
  const setSuspended = async (on: boolean) => {
    const r = await call('platform_set_suspended', { p_tenant_id: row.tenant_id, p_suspended: on, p_reason: suspendReason.trim() || null },
      on ? 'Company suspended.' : 'Company let back in.');
    if (r) {
      setSuspending(false);
      setSuspendReason('');
      after(r, false);
    }
  };

  const saveAddons = async () => after(await call('platform_set_addons', { p_tenant_id: row.tenant_id, p_addons: addons }, 'Add-ons saved.'), false);
  const saveLimits = async () => {
    const body: Record<string, unknown> = {};
    for (const [k] of LIMITS) if (limits[k] != null) body[k] = limits[k];
    if (extra.length) body.modules = extra;
    after(await call('platform_set_custom_limits', { p_tenant_id: row.tenant_id, p_limits: body }, 'Limits saved.'), false);
  };
  const extendTrial = async () => after(await call('platform_extend_trial', { p_tenant_id: row.tenant_id, p_days: days }, 'Trial extended.'), false);

  const sellable = plans.filter((p) => p.active);
  const addable = modules.filter((m) => m.addable);

  return (
    <FormSheet title={row.name} subtitle={`${row.owner_name ?? 'No owner'}${row.owner_email ? ` · ${row.owner_email}` : ''}`} onClose={onClose} wide>
      {!d ? (
        <p className="text-sm text-app-text-muted">Loading...</p>
      ) : (
        <div className="space-y-5 text-sm">
          <section className="space-y-3">
            <h4 className="font-semibold">Plan</h4>
            <Field label="Plan" group>
              <div className="flex flex-wrap gap-1.5">
                {sellable.map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => setPlan(p.code)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold ring-1 ${plan === p.code ? 'bg-amber-500 text-slate-950 ring-amber-500' : 'bg-app-bg ring-app-border'}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </Field>
            {kind === 'subscription' && (
              <Field label="How they pay" group>
                <Segmented
                  size="sm"
                  value={cycle}
                  onChange={setCycle}
                  options={[{ id: 'monthly', label: 'Monthly' }, { id: 'annual', label: 'Yearly' }, { id: 'manual', label: 'Free' }]}
                />
              </Field>
            )}
            {effCycle !== 'trial' && effCycle !== 'manual' && (
              <div className="rounded-xl bg-app-bg p-3 space-y-3">
                <p className="text-xs">
                  <span className="text-app-text-muted">List price: </span>
                  <span className="font-semibold tabular-nums">
                    {listPrice == null ? 'none (ask us)' : `${formatMoney(num(listPrice))} ${effCycle === 'annual' ? 'a year' : effCycle === 'one_time' ? 'once' : 'a month'}`}
                  </span>
                  {chosen?.addons_allowed && addons.length > 0 && <span className="text-app-text-muted"> plus add-ons</span>}
                </p>
                {!needsAgreed && (
                  <Switch checked={useAgreed} onChange={setUseAgreed} label="Agreed a different price"
                    description="Only when you negotiated it. Their days are worked out from this price." />
                )}
                {(useAgreed || needsAgreed) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={effCycle === 'one_time' ? 'Agreed price, whole licence (KSh)' : 'Agreed price a month (KSh)'}
                      hint={effCycle === 'annual' ? 'A year costs 12 times this' : undefined}>
                      <NumberInput value={agreed} onChange={setAgreed} min={0} />
                    </Field>
                    <Field label="What was agreed" hint="Their owner can see this"><TextInput value={agreedNote} onChange={(e) => setAgreedNote(e.target.value)} placeholder="e.g. launch price for 6 months" /></Field>
                  </div>
                )}
                {(useAgreed || needsAgreed) && agreed != null && listPrice != null && effCycle !== 'one_time' && (
                  <p className="text-[11px] text-app-text-muted">
                    {formatMoney(Math.max(0, num(effCycle === 'annual' ? num(listPrice) / 12 : listPrice) - agreed))} a month below the list price.
                  </p>
                )}
              </div>
            )}
            {effCycle === 'manual' && <p className="text-xs text-app-text-muted">Free: no payments, no end date. Use it for your own test companies or partners.</p>}
            <button type="button" disabled={busy || ((useAgreed || needsAgreed) && effCycle !== 'manual' && effCycle !== 'trial' && agreed == null)} className={btnMain} onClick={savePlan}>Save plan</button>

            {d.subscription.status === 'trial' && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Make the trial longer by (days)">
                  <NumberInput value={days} onChange={setDays} decimals={0} min={1} max={90} className="w-28" />
                </Field>
                <button type="button" disabled={busy || !days} className={btnQuiet} onClick={extendTrial}>Extend trial</button>
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-app-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">Payments</h4>
              <StatusPill status={(d.plan as any)?.status ?? d.subscription.status} />
              <span className="text-xs text-app-text-muted">
                {d.subscription.billing_cycle === 'one_time'
                  ? (d.subscription.period_end ? 'Licence not fully paid' : 'Licence paid')
                  : d.subscription.billing_cycle === 'monthly' || d.subscription.billing_cycle === 'annual'
                    ? `Paid up to ${d.subscription.period_end ? day(d.subscription.period_end) : 'not paid yet'}`
                    : ''}
              </span>
            </div>
            <CompanyPayments tenantId={row.tenant_id} name={row.name} cycle={d.subscription.billing_cycle} reloadKey={payKey} onChanged={() => { setPayKey((k) => k + 1); onChanged(); load(); }} />
            <div className="pt-1">
              {d.subscription.status === 'suspended' ? (
                <button type="button" disabled={busy} className={btnQuiet} onClick={() => setSuspended(false)}>Let them back in</button>
              ) : (
                <button type="button" disabled={busy} className="text-xs font-semibold text-red-600 cursor-pointer" onClick={() => setSuspending(true)}>Suspend this company</button>
              )}
            </div>
          </section>

          {d.plan?.own_ai_key && <CompanyAi tenantId={row.tenant_id} />}

          {chosen?.addons_allowed && d.subscription.plan_code === plan && (
            <section className="space-y-2 border-t border-app-border pt-4">
              <h4 className="font-semibold">Add-ons</h4>
              {addable.map((m) => (
                <Checkbox
                  key={m.key}
                  checked={addons.includes(m.key)}
                  onChange={(on) => setAddons((a) => (on ? [...a, m.key] : a.filter((x) => x !== m.key)))}
                  label={m.name}
                  description={m.addon_monthly_price != null ? `${formatMoney(num(m.addon_monthly_price))} a month` : undefined}
                />
              ))}
              <button type="button" disabled={busy} className={btnQuiet} onClick={saveAddons}>Save add-ons</button>
            </section>
          )}

          <section className="space-y-3 border-t border-app-border pt-4">
            <h4 className="font-semibold">Own limits</h4>
            <p className="text-xs text-app-text-muted">Only for this company. Empty = the plan's limit.</p>
            <div className="grid grid-cols-2 gap-3">
              {LIMITS.map(([k, label]) => (
                <Field key={k} label={label}>
                  <NumberInput value={limits[k]} onChange={(v) => setLimits((l) => ({ ...l, [k]: v }))} decimals={0} min={k === 'max_branches' ? 1 : 0} />
                </Field>
              ))}
            </div>
            <Field label="Extra modules" group>
              <div className="grid gap-1 sm:grid-cols-2">
                {modules.map((m) => (
                  <Checkbox
                    key={m.key}
                    checked={extra.includes(m.key)}
                    onChange={(on) => setExtra((x) => (on ? [...x, m.key] : x.filter((y) => y !== m.key)))}
                    label={m.name}
                  />
                ))}
              </div>
            </Field>
            <button type="button" disabled={busy} className={btnQuiet} onClick={saveLimits}>Save limits</button>
          </section>

          <section className="space-y-2 border-t border-app-border pt-4">
            <h4 className="font-semibold">Branches</h4>
            {d.branches.map((b) => (
              <div key={b.id} className="rounded-xl bg-app-bg p-3 text-xs">
                <span className="font-semibold text-sm">{b.name}</span>
                <p className="text-app-text-muted mt-0.5">
                  {b.staff} staff · {b.sales_30_days} sales in 30 days · last sale {b.last_sale_at ? day(b.last_sale_at) : 'never'}
                </p>
                {b.website_home && (
                  <a href={`https://${b.website_home}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 font-semibold text-amber-600">
                    {b.website_home} <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </div>
            ))}
            <p className="text-xs text-app-text-muted">
              AI: {d.ai_today?.calls ?? 0} questions today{d.ai_today?.refused ? ` (${d.ai_today.refused} over the cap)` : ''}, {d.ai_30_days} in 30 days.
            </p>
          </section>

          <section className="space-y-1 border-t border-app-border pt-4">
            <h4 className="font-semibold">History</h4>
            {d.history.length === 0 && <p className="text-xs text-app-text-muted">Nothing changed yet.</p>}
            {d.history.map((h, i) => (
              <p key={i} className="text-xs"><span className="text-app-text-muted">{when(h.at)}</span> {actionText(h.action, h.details)}</p>
            ))}
          </section>
        </div>
      )}
      {suspending && d && (
        <FormSheet
          title={`Suspend ${row.name}?`}
          onClose={() => setSuspending(false)}
          footer={
            <div className="flex gap-2 justify-end">
              <button type="button" className={btnQuiet} onClick={() => setSuspending(false)}>Keep them open</button>
              <button type="button" className={btnDanger} disabled={busy || suspendReason.trim().length < 3} onClick={() => setSuspended(true)}>Suspend</button>
            </div>
          }
        >
          <div className="space-y-3 text-sm">
            <ul className="rounded-xl bg-app-bg p-3 text-xs space-y-1 list-disc pl-5">
              <li>All {d.branches.length} {d.branches.length === 1 ? 'branch stops' : 'branches stop'} at once: {d.branches.reduce((n, b) => n + b.staff, 0)} staff can't sell or change anything.</li>
              <li>Their {d.branches.filter((b) => b.website_home).length ? 'online shop closes' : 'records stay as they are'}; nothing is deleted.</li>
              <li>{d.branches.reduce((n, b) => n + b.sales_30_days, 0)} sales were made in the last 30 days.</li>
              <li>Letting them back in later does not add paid days.</li>
            </ul>
            <Field label="Why"><TextInput value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="e.g. not paid after reminders" autoFocus /></Field>
          </div>
        </FormSheet>
      )}
    </FormSheet>
  );
}

/** Own-key plans (Perpetual): the platform sets the company's provider, model and key. */
const AI_PROVIDER_IDS = ['huggingface', 'gemini', 'openai', 'anthropic', 'deepseek', 'groq', 'openrouter'] as const;
function CompanyAi({ tenantId }: { tenantId: string }) {
  const { call, busy } = useCall();
  const [cur, setCur] = useState<{ provider: string; model: string; has_key: boolean; key_end: string | null } | null>(null);
  const [provider, setProvider] = useState('huggingface');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const load = useCallback(async () => {
    const r = await call<typeof cur>('platform_company_ai', { p_tenant_id: tenantId });
    setCur(r && typeof r === 'object' ? r : null);
    if (r && typeof r === 'object') {
      setProvider(r.provider);
      setModel(r.model);
    }
  }, [call, tenantId]);
  useEffect(() => {
    load();
  }, [load]);
  const save = async () => {
    if (await call('platform_set_company_ai', { p_tenant_id: tenantId, p_provider: provider, p_model: model.trim(), p_api_key: key.trim() || null }, 'AI set up for this company.')) {
      setKey('');
      load();
    }
  };
  return (
    <section className="space-y-3 border-t border-app-border pt-4">
      <h4 className="font-semibold">Their own AI account</h4>
      <p className="text-xs text-app-text-muted">This plan uses the company's own AI account. You set it up here; the company only switches uses on or off.</p>
      <Field label="Provider" group>
        <div className="flex flex-wrap gap-1.5">
          {AI_PROVIDER_IDS.map((id) => (
            <button key={id} type="button" onClick={() => setProvider(id)}
              className={`rounded-xl px-2.5 py-1 text-[11px] font-semibold ring-1 ${provider === id ? 'bg-amber-500 text-slate-950 ring-amber-500' : 'bg-app-bg ring-app-border'}`}>
              {id}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Model"><TextInput value={model} onChange={(e) => setModel(e.target.value)} /></Field>
        <Field label="Their key" hint={cur?.has_key ? `A key ending ${cur.key_end ?? '...'} is saved; leave empty to keep it` : 'No key saved yet'}>
          <TextInput type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
      </div>
      <button type="button" disabled={busy || !model.trim()} className={btnQuiet} onClick={save}>Save AI set-up</button>
    </section>
  );
}

const ACTION_TEXT: Record<string, string> = {
  plan_set: 'Plan set',
  payment_recorded: 'Payment recorded',
  payment_voided: 'Payment voided',
  suspended: 'Suspended',
  unsuspended: 'Let back in',
  company_ai: 'Their AI set up',
  running_cost: 'Running cost saved',
  running_cost_deleted: 'Running cost removed',
  addons_set: 'Add-ons set',
  custom_limits_set: 'Own limits set',
  trial_extended: 'Trial extended',
  signup_requested: 'Sign-up requested',
  signup_approved: 'Request approved',
  signup_rejected: 'Request turned down',
  plan_change_requested: 'Plan change requested',
  settings_changed: 'Platform settings changed',
  plan_prices: 'Plan prices changed',
  addon_prices: 'Add-on prices changed',
  cost_estimate_saved: 'Cost estimate saved',
  ai_settings: 'AI settings changed',
  support_allowed: 'Owner allowed support',
  support_opened: 'Support opened a branch',
  support_ended: 'Support ended',
};

function actionText(action: string, details: Record<string, unknown>): string {
  const bits = Object.entries(details ?? {})
    .filter(([k, v]) => v != null && v !== '' && k !== 'request' && k !== 'id')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') || 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return `${ACTION_TEXT[action] ?? action}${bits.length ? ` (${bits.join('; ')})` : ''}`;
}

// ============================================================================================
// Plans and prices
// ============================================================================================
function PlansSection({ plans, modules, reload }: { plans: PlanRow[]; modules: PlanModule[]; reload: () => void }) {
  const { call, busy } = useCall();
  const [edit, setEdit] = useState<Record<string, Record<string, number | null>>>({});
  const val = (p: PlanRow, k: keyof PlanRow) => (edit[p.code]?.[k as string] !== undefined ? edit[p.code][k as string] : (p[k] as number | null));
  const set = (code: string, k: string, v: number | null) => setEdit((e) => ({ ...e, [code]: { ...e[code], [k]: v } }));
  const [addonEdit, setAddonEdit] = useState<Record<string, { m: number | null; a: number | null }>>({});

  const savePlan = async (p: PlanRow) => {
    const done = await call('platform_update_plan_prices', {
      p_plan_code: p.code,
      p_monthly: val(p, 'monthly_price'),
      p_annual: val(p, 'annual_price'),
      p_one_time: val(p, 'one_time_price'),
      p_setup_fee: val(p, 'setup_fee') ?? 0,
    }, `${p.name} prices saved.`);
    if (done) reload();
  };
  const saveAddon = async (m: PlanModule) => {
    const e = addonEdit[m.key] ?? { m: m.addon_monthly_price ?? null, a: m.addon_annual_price ?? null };
    const done = await call('platform_update_addon_prices', { p_module: m.key, p_monthly: e.m, p_annual: e.a }, `${m.name} prices saved.`);
    if (done) reload();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-app-text-muted">The plans page and the in-app plan chooser read these. Empty = "ask us".</p>
      {plans.filter((p) => p.kind !== 'trial').map((p) => (
        <div key={p.code} className={`${card} space-y-3`}>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{p.name}</span>
            {!p.is_public && <span className="text-[11px] text-app-text-muted">hidden</span>}
            <span className="ml-auto text-[11px] text-app-text-muted">{p.max_branches} branches · {p.max_staff} staff</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {p.kind === 'perpetual' ? (
              <Field label="One payment">
                <NumberInput prefix="KSh" value={val(p, 'one_time_price')} onChange={(v) => set(p.code, 'one_time_price', v)} min={0} />
              </Field>
            ) : (
              <>
                <Field label="A month">
                  <NumberInput prefix="KSh" value={val(p, 'monthly_price')} onChange={(v) => set(p.code, 'monthly_price', v)} min={0} />
                </Field>
                <Field label="A year">
                  <NumberInput prefix="KSh" value={val(p, 'annual_price')} onChange={(v) => set(p.code, 'annual_price', v)} min={0} />
                </Field>
              </>
            )}
            <Field label="Set-up fee">
              <NumberInput prefix="KSh" value={val(p, 'setup_fee')} onChange={(v) => set(p.code, 'setup_fee', v)} min={0} />
            </Field>
          </div>
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => savePlan(p)}>Save {p.name}</button>
        </div>
      ))}
      <div className={`${card} space-y-3`}>
        <span className="font-semibold text-sm">Add-ons (Pro only)</span>
        {modules.filter((m) => m.addable).map((m) => {
          const e = addonEdit[m.key] ?? { m: m.addon_monthly_price ?? null, a: m.addon_annual_price ?? null };
          return (
            <div key={m.key} className="flex flex-wrap items-end gap-3">
              <span className="w-full sm:w-44 text-sm">{m.name}</span>
              <Field label="A month" className="w-36">
                <NumberInput prefix="KSh" value={e.m} onChange={(v) => setAddonEdit((x) => ({ ...x, [m.key]: { ...e, m: v } }))} min={0} />
              </Field>
              <Field label="A year" className="w-36">
                <NumberInput prefix="KSh" value={e.a} onChange={(v) => setAddonEdit((x) => ({ ...x, [m.key]: { ...e, a: v } }))} min={0} />
              </Field>
              <button type="button" disabled={busy} className={btnQuiet} onClick={() => saveAddon(m)}>Save</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================================
// Costs paid to others
// ============================================================================================
interface CostRow {
  id?: string;
  provider: string;
  item: string;
  basis: string;
  amount: number | null;
  max_amount: number | null;
  needs: string | null;
  note: string | null;
  checked_on: string | null;
  active: boolean;
  sort: number;
}
const BASIS: Array<[string, string]> = [
  ['percent_mpesa', '% of M-Pesa sales'],
  ['percent_card', '% of card sales'],
  ['per_sms', 'Per SMS'],
  ['per_month', 'Each month'],
  ['per_year', 'Each year'],
  ['free', 'Free'],
];

function CostsSection({ modules }: { modules: PlanModule[] }) {
  const { call, busy } = useCall();
  const [rows, setRows] = useState<CostRow[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from('provider_cost_estimates').select('*').order('sort');
    setRows((data as CostRow[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const patch = (i: number, p: Partial<CostRow>) => setRows((r) => r && r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async (r: CostRow) => {
    const done = await call('platform_save_cost_estimate', { p_row: r }, 'Saved.');
    if (done) load();
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <p className="text-xs text-app-text-muted">
        What a business pays others (Safaricom, card company, SMS, domain). Shown as estimates on the plan page. Set "checked on" when you have checked a figure.
      </p>
      {rows?.map((r, i) => (
        <div key={r.id ?? `new-${i}`} className={`${card} space-y-3`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who charges it"><TextInput value={r.provider} onChange={(e) => patch(i, { provider: e.target.value })} /></Field>
            <Field label="What for"><TextInput value={r.item} onChange={(e) => patch(i, { item: e.target.value })} /></Field>
          </div>
          <Field label="Charged" group>
            <div className="flex flex-wrap gap-1.5">
              {BASIS.map(([id, label]) => (
                <button key={id} type="button" onClick={() => patch(i, { basis: id })}
                  className={`rounded-xl px-2.5 py-1 text-[11px] font-semibold ring-1 ${r.basis === id ? 'bg-amber-500 text-slate-950 ring-amber-500' : 'bg-app-bg ring-app-border'}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label={r.basis.startsWith('percent') ? 'Percent' : 'Amount (KSh)'}>
              <NumberInput value={r.amount} onChange={(v) => patch(i, { amount: v })} min={0} />
            </Field>
            {r.basis.startsWith('percent') && (
              <Field label="Most per payment (KSh)">
                <NumberInput value={r.max_amount} onChange={(v) => patch(i, { max_amount: v })} min={0} />
              </Field>
            )}
            <Field label="Checked on">
              <DateTimeInput withTime={false} value={r.checked_on} onChange={(v) => patch(i, { checked_on: v ? v.slice(0, 10) : null })} />
            </Field>
          </div>
          <Field label="Only with module" group>
            <div className="flex flex-wrap gap-1.5">
              {[{ key: '', name: 'Every business' }, ...modules].map((m) => (
                <button key={m.key} type="button" onClick={() => patch(i, { needs: m.key || null })}
                  className={`rounded-xl px-2.5 py-1 text-[11px] font-semibold ring-1 ${(r.needs ?? '') === m.key ? 'bg-amber-500 text-slate-950 ring-amber-500' : 'bg-app-bg ring-app-border'}`}>
                  {m.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Note"><TextInput value={r.note ?? ''} onChange={(e) => patch(i, { note: e.target.value })} /></Field>
          <div className="flex flex-wrap items-center gap-3">
            <Switch checked={r.active} onChange={(v) => patch(i, { active: v })} label="Shown" />
            <button type="button" disabled={busy || !r.provider.trim() || !r.item.trim()} className={btnQuiet} onClick={() => save(r)}>Save</button>
            {!r.checked_on && <span className="text-[11px] text-amber-600">Not checked yet</span>}
          </div>
        </div>
      ))}
      <button
        type="button"
        className={btnQuiet}
        onClick={() => setRows((r) => [...(r ?? []), { provider: '', item: '', basis: 'per_month', amount: 0, max_amount: null, needs: null, note: null, checked_on: today, active: true, sort: ((r?.length ?? 0) + 1) * 10 }])}
      >
        Add a cost
      </button>
    </div>
  );
}

// ============================================================================================
// Platform settings
// ============================================================================================
interface PlatformSettings {
  platform_name: string | null;
  platform_domain: string | null;
  app_url: string | null;
  custom_domain_target: string | null;
  trial_enabled: boolean;
  trial_days: number;
  grace_days: number;
  read_only_days: number;
  vat_percent: number;
  payment_instructions: string | null;
  terms_url: string | null;
  contact_text: string | null;
}

function SettingsSection() {
  const { call, busy } = useCall();
  const [s, setS] = useState<PlatformSettings | null>(null);
  useEffect(() => {
    getSupabase().from('platform_settings').select('*').maybeSingle().then(({ data }) => setS(data as PlatformSettings));
  }, []);
  if (!s) return <p className="text-sm text-app-text-muted">Loading...</p>;
  const put = (p: Partial<PlatformSettings>) => setS({ ...s, ...p });
  const text = (k: keyof PlatformSettings) => ({ value: (s[k] as string | null) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => put({ [k]: e.target.value } as Partial<PlatformSettings>) });

  const save = async () => {
    const r = await call<PlatformSettings>('platform_update_settings', {
      p_settings: {
        platform_name: s.platform_name ?? '', platform_domain: s.platform_domain ?? '', app_url: s.app_url ?? '',
        custom_domain_target: s.custom_domain_target ?? '', trial_enabled: s.trial_enabled, trial_days: s.trial_days,
        grace_days: s.grace_days, read_only_days: s.read_only_days, vat_percent: s.vat_percent,
        payment_instructions: s.payment_instructions ?? '', terms_url: s.terms_url ?? '', contact_text: s.contact_text ?? '',
      },
    }, 'Settings saved.');
    if (r) setS(r);
  };

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3`}>
        <h4 className="font-semibold text-sm">Name and addresses</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Platform name" hint='In "Powered by" and on the plans page'><TextInput {...text('platform_name')} /></Field>
          <Field label="Platform domain" hint="Shops are at name.<domain>; the plans page is at the domain itself"><TextInput {...text('platform_domain')} placeholder="example.com" /></Field>
          <Field label="App address" hint="Where the plans page sends people to sign up"><TextInput {...text('app_url')} placeholder="https://app.example.com" /></Field>
          <Field label="Own-domain target" hint="The CNAME shops point their own domain to"><TextInput {...text('custom_domain_target')} placeholder="customers.example.com" /></Field>
        </div>
        {s.platform_domain && (
          <a href={`https://${s.platform_domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
            Open the plans page <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </div>
      <div className={`${card} space-y-3`}>
        <h4 className="font-semibold text-sm">Trial and unpaid companies</h4>
        <Switch checked={s.trial_enabled} onChange={(v) => put({ trial_enabled: v })} label="Free trial open" description="Off: new companies must pay, or ask and wait for your approval." />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Trial days"><NumberInput value={s.trial_days} onChange={(v) => put({ trial_days: v ?? 14 })} decimals={0} min={1} max={90} /></Field>
          <Field label="Grace days" hint="Unpaid, still working"><NumberInput value={s.grace_days} onChange={(v) => put({ grace_days: v ?? 0 })} decimals={0} min={0} max={60} /></Field>
          <Field label="Read-only days" hint="Then suspended"><NumberInput value={s.read_only_days} onChange={(v) => put({ read_only_days: v ?? 0 })} decimals={0} min={0} max={365} /></Field>
        </div>
      </div>
      <div className={`${card} space-y-3`}>
        <h4 className="font-semibold text-sm">Paying</h4>
        <Field label="VAT on our prices (%)" className="max-w-[10rem]"><NumberInput value={s.vat_percent} onChange={(v) => put({ vat_percent: v ?? 0 })} min={0} max={50} /></Field>
        <Field label="How to pay us" hint="Shown when someone picks a plan, e.g. the till number">
          <textarea
            value={s.payment_instructions ?? ''}
            onChange={(e) => put({ payment_instructions: e.target.value })}
            maxLength={1000}
            rows={3}
            className="w-full rounded-xl border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Terms and conditions link"><TextInput {...text('terms_url')} placeholder="https://..." /></Field>
          <Field label="Contact us text"><TextInput {...text('contact_text')} placeholder="Call 07..." /></Field>
        </div>
      </div>
      <button type="button" disabled={busy} className={btnMain} onClick={save}>Save settings</button>
    </div>
  );
}

// ============================================================================================
// AI
// ============================================================================================
interface AiSettings {
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  top_k: number;
  enabled: boolean;
}

function AiSection() {
  const { call, busy } = useCall();
  const [s, setS] = useState<AiSettings | null>(null);
  useEffect(() => {
    getSupabase().from('platform_ai_settings').select('*').maybeSingle().then(({ data }) => setS(data as AiSettings));
  }, []);
  if (!s) return <p className="text-sm text-app-text-muted">Loading...</p>;
  const put = (p: Partial<AiSettings>) => setS({ ...s, ...p });
  const save = async () => {
    const r = await call<AiSettings>('platform_update_ai_settings', { p_settings: s }, 'AI settings saved.');
    if (r) setS(r);
  };
  return (
    <div className={`${card} space-y-3`}>
      <Switch checked={s.enabled} onChange={(v) => put({ enabled: v })} label="AI on for every company" description="Off stops the assistant and insights everywhere (own-key plans too)." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider"><TextInput value={s.provider} onChange={(e) => put({ provider: e.target.value })} /></Field>
        <Field label="Model"><TextInput value={s.model} onChange={(e) => put({ model: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Temperature"><NumberInput value={s.temperature} onChange={(v) => put({ temperature: v ?? 0.7 })} min={0} max={2} /></Field>
        <Field label="Longest answer (tokens)"><NumberInput value={s.max_tokens} onChange={(v) => put({ max_tokens: v ?? 2048 })} decimals={0} min={64} max={32768} /></Field>
        <Field label="Top p"><NumberInput value={s.top_p} onChange={(v) => put({ top_p: v ?? 0.95 })} min={0.01} max={1} /></Field>
        <Field label="Top k"><NumberInput value={s.top_k} onChange={(v) => put({ top_k: v ?? 40 })} decimals={0} min={0} /></Field>
      </div>
      <p className="text-[11px] text-app-text-muted">The keys stay as server secrets; they are never typed here. Daily caps are set per plan, or per company under Companies.</p>
      <button type="button" disabled={busy} className={btnMain} onClick={save}>Save AI settings</button>
    </div>
  );
}

// ============================================================================================
// Activity
// ============================================================================================
// ============================================================================================
// Support: only branches whose Owner allowed it, only until the time they chose
// ============================================================================================
interface SupportRow {
  business_id: string;
  branch: string;
  company: string;
  until: string;
  reason: string | null;
  allowed_by: string;
  allowed_at: string;
}

function SupportSection() {
  const { call, busy } = useCall();
  const [rows, setRows] = useState<SupportRow[] | null>(null);
  useEffect(() => {
    call<SupportRow[]>('platform_support_list').then((d) => setRows(d ?? []));
  }, [call]);

  const open = async (r: SupportRow) => {
    const done = await call('platform_support_open', { p_business_id: r.business_id });
    if (!done) return;
    await openAsSupport(r.business_id);
    setConsoleOpen(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-app-text-muted">
        You can open a branch only while its owner allows it (Business and branches, Platform support). Inside, you can set up
        products, stock, customers, suppliers and settings. You can't sell, take payments, or change the plan or staff, and
        everything you change shows in their activity log as platform support.
      </p>
      {!rows ? (
        <p className="text-sm text-app-text-muted">Loading...</p>
      ) : !rows.length ? (
        <p className={`${card} text-sm text-app-text-muted`}>No owner has allowed support right now.</p>
      ) : (
        rows.map((r) => (
          <div key={r.business_id} className={`${card} flex flex-wrap items-center gap-3`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{r.company} · {r.branch}</p>
              <p className="text-[11px] text-app-text-muted">
                Allowed by {r.allowed_by} until {when(r.until)}{r.reason ? ` · "${r.reason}"` : ''}
              </p>
            </div>
            <button type="button" disabled={busy} onClick={() => open(r)} className={btnMain}>
              Open branch
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function ActivitySection() {
  const [rows, setRows] = useState<Array<{ id: number; action: string; details: Record<string, unknown>; created_at: string; tenant_id: string | null }> | null>(null);
  useEffect(() => {
    getSupabase().from('platform_audit').select('*').order('created_at', { ascending: false }).limit(150)
      .then(({ data }) => setRows((data as any[]) ?? []));
  }, []);
  if (!rows) return <p className="text-sm text-app-text-muted">Loading...</p>;
  if (!rows.length) return <p className="text-sm text-app-text-muted">Nothing yet.</p>;
  return (
    <div className={`${card} space-y-1.5`}>
      {rows.map((r) => (
        <p key={r.id} className="text-xs"><span className="text-app-text-muted">{when(r.created_at)}</span> {actionText(r.action, r.details)}</p>
      ))}
    </div>
  );
}

// ============================================================================================
// The console
// ============================================================================================
export default function PlatformConsoleView({ themeMode, onToggleTheme, onClose }: {
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  /** Back to the business (or the branch chooser / start screen). */
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>('home');
  // Phones: the open section shows instead of the list; Home is open at the start.
  const [phoneOpen, setPhoneOpen] = useState(true);
  const [companyOpenId, setCompanyOpenId] = useState<string | null>(null);
  const go = (id: Section) => {
    setSection(id);
    setPhoneOpen(true);
  };
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [modules, setModules] = useState<PlanModule[]>([]);
  const user = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);

  const loadCatalogue = useCallback(async () => {
    const supabase = getSupabase();
    const [p, m] = await Promise.all([
      supabase.from('plans').select('*').order('sort'),
      supabase.from('plan_modules').select('*').order('sort'),
    ]);
    if (p.data) setPlans(p.data as PlanRow[]);
    if (m.data) setModules(m.data as PlanModule[]);
  }, []);
  useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue]);

  const body = (() => {
    switch (section) {
      case 'home': return <ConsoleHome onOpen={go} />;
      case 'requests': return <RequestsSection />;
      case 'companies': return <CompaniesSection plans={plans} modules={modules} openId={companyOpenId} onOpened={() => setCompanyOpenId(null)} />;
      case 'money': return <ConsoleMoney onOpenCompany={(id) => { setCompanyOpenId(id); go('companies'); }} />;
      case 'running_costs': return <RunningCostsSection />;
      case 'support': return <SupportSection />;
      case 'plans': return <PlansSection plans={plans} modules={modules} reload={loadCatalogue} />;
      case 'costs': return <CostsSection modules={modules} />;
      case 'settings': return <SettingsSection />;
      case 'ai': return <AiSection />;
      case 'activity': return <ActivitySection />;
    }
  })();

  return (
    <div className="min-h-full bg-app-bg text-app-text flex flex-col">
      <header className="sticky top-0 z-20 bg-app-card/95 backdrop-blur border-b border-app-border px-4 pb-2.5" style={{ paddingTop: 'calc(0.625rem + var(--inset-top))' }}>
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button type="button" onClick={onClose} className="p-2 -ml-2 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer" aria-label="Leave the console" title="Leave the console">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">Platform console</p>
            <p className="text-[11px] text-app-text-muted truncate">{user?.name ?? ''} · platform admin</p>
          </div>
          <button type="button" onClick={onToggleTheme} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer" aria-label="Light or dark">{themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button type="button" onClick={() => void logout()} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer" aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </div>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 pt-4 pb-[calc(var(--mobile-nav-room)+0.5rem)] md:pb-[calc(var(--inset-bottom)+24px)]">
        <SectionNav<Section>
          sections={SECTIONS}
          active={section}
          onSelect={setSection}
          phoneOpen={phoneOpen}
          onPhoneOpenChange={setPhoneOpen}
          searchPlaceholder="Search the console"
          collapseKey="kkm_console_nav_collapsed"
        >
          {body}
        </SectionNav>
      </main>
      {/* Phones: the same floating bottom bar as the business screens. */}
      <nav
        aria-label="Console"
        style={{
          bottom: 'calc(var(--mobile-nav-gap) + var(--inset-bottom))',
          left: 'calc(var(--mobile-edge) + var(--inset-left))',
          right: 'calc(var(--mobile-edge) + var(--inset-right))',
          height: 'var(--mobile-nav-height)',
        }}
        className="fixed mx-auto max-w-lg md:hidden bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur-md border border-slate-800/80 dark:border-white/70 flex items-center justify-around z-30 shadow-xl rounded-2xl select-none px-1 min-[380px]:px-2 gap-0.5"
      >
        {BAR.map((t) => {
          const Icon = t.icon;
          const onBar = BAR.some((b) => b.id === section);
          const active = t.id === 'more' ? !phoneOpen || !onBar : phoneOpen && section === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => (t.id === 'more' ? setPhoneOpen(false) : go(t.id))}
              className={`relative flex flex-col items-center justify-center flex-1 min-w-0 h-full cursor-pointer transition-colors ${
                active ? 'text-amber-400 dark:text-amber-600 font-bold' : 'text-slate-400 hover:text-slate-200 dark:text-slate-500 dark:hover:text-slate-800'
              }`}
            >
              <Icon size={18} />
              <span className="nav-label text-[11px] mt-0.5 tracking-tight truncate max-w-full">{t.label}</span>
              {active && <span className="absolute bottom-1 w-6 h-0.5 bg-amber-500 rounded-full" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
