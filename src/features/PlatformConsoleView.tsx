// src/features/PlatformConsoleView.tsx
// The platform console (SaaS step 7), inside the main app. Only platform admins open it, and
// while it is open no business screen shows. Everything here goes through platform_* database
// functions that refuse anyone else (20261204001, 003, 005).
//
// What the console shows about a company is counts only (branches, staff, number of sales,
// AI use): never sales amounts, customers or products. Support access is a later step.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, Bot, Building2, CheckCircle2, ClipboardList, Coins, ExternalLink, Gauge,
  LifeBuoy, LogOut, Moon, Settings2, Sun, Tags, XCircle,
} from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { toUserMessage } from '../utils/userError';
import { formatMoney } from '../utils/money';
import { SectionNav, NavSection } from '../components/shared/SectionNav';
import { StatGrid, StatTile } from '../components/shared/StatTile';
import { DateTimeInput, Field, NumberInput, SearchInput, TextInput } from '../components/shared/Input';
import { Segmented } from '../components/shared/Choice';
import { Switch } from '../components/shared/Switch';
import { Checkbox } from '../components/shared/Checkbox';
import { FormSheet } from '../components/shared/FormSheet';
import type { PlanModule, PlanRow } from '../stores/planStore';
import { setConsoleOpen } from '../utils/platformConsole';
import { openAsSupport } from '../utils/supportAccess';

type Section = 'overview' | 'requests' | 'companies' | 'support' | 'plans' | 'costs' | 'settings' | 'ai' | 'activity';

const SECTIONS: NavSection<Section>[] = [
  { id: 'overview', group: 'Platform', label: 'Overview', description: 'Companies, trials and use', icon: Gauge },
  { id: 'requests', group: 'Platform', label: 'Requests', description: 'Sign-ups and plan changes to approve', icon: ClipboardList, keywords: 'approve signup payment' },
  { id: 'companies', group: 'Platform', label: 'Companies', description: 'Plans, add-ons, limits, trials', icon: Building2, keywords: 'tenant business suspend' },
  { id: 'support', group: 'Platform', label: 'Support', description: 'Branches whose owner let you in', icon: LifeBuoy, keywords: 'help access open branch' },
  { id: 'plans', group: 'Prices', label: 'Plans and prices', description: 'Plan and add-on prices', icon: Tags },
  { id: 'costs', group: 'Prices', label: 'Costs paid to others', description: 'Estimates the plan page shows', icon: Coins, keywords: 'safaricom sms card domain' },
  { id: 'settings', group: 'Setup', label: 'Platform settings', description: 'Name, domain, trial, VAT, terms', icon: Settings2, keywords: 'domain trial vat terms app url' },
  { id: 'ai', group: 'Setup', label: 'AI', description: 'Provider and model for every company', icon: Bot },
  { id: 'activity', group: 'Setup', label: 'Activity', description: 'What platform admins changed', icon: Activity, keywords: 'audit log' },
];

const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:opacity-60 cursor-pointer';
const btnMain = `${btn} bg-amber-500 hover:bg-amber-600 text-slate-950`;
const btnQuiet = `${btn} border border-app-border bg-app-card hover:bg-app-bg text-app-text`;
const card = 'rounded-2xl bg-app-card ring-1 ring-app-border p-4';

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const num = (v: unknown) => Number(v) || 0;

const STATUS_TONE: Record<string, string> = {
  trial: 'bg-sky-500/15 text-sky-600',
  active: 'bg-emerald-500/15 text-emerald-600',
  grace: 'bg-amber-500/15 text-amber-600',
  read_only: 'bg-red-500/15 text-red-600',
  suspended: 'bg-red-500/15 text-red-600',
};
const STATUS_TEXT: Record<string, string> = {
  trial: 'Trial', active: 'Active', grace: 'Unpaid (grace)', read_only: 'Read-only', suspended: 'Suspended',
};
function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] ?? 'bg-app-bg text-app-text-muted'}`}>
      {STATUS_TEXT[status] ?? status}
    </span>
  );
}

/** A database call with the console's error and success messages. */
function useCall() {
  const toast = useNotificationStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const call = useCallback(
    async <T,>(fn: string, args: Record<string, unknown> = {}, ok?: string): Promise<T | null> => {
      setBusy(true);
      const { data, error } = await getSupabase().rpc(fn, args);
      setBusy(false);
      if (error) {
        toast('Platform', toUserMessage(error, 'That did not work. Please try again.'), undefined, 'error');
        return null;
      }
      if (ok) toast('Platform', ok, undefined, 'success');
      return (data ?? true) as T;
    },
    [toast],
  );
  return { call, busy };
}

// ============================================================================================
// Overview
// ============================================================================================
interface Overview {
  companies: number;
  by_status: Record<string, number>;
  by_plan: Record<string, number>;
  trials_ending_7_days: number;
  requests_waiting: number;
  ai_calls_today: number;
  ai_refused_today: number;
  branches: number;
  active_7_days: number;
}

function OverviewSection({ go }: { go: (s: Section) => void }) {
  const { call } = useCall();
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    call<Overview>('platform_overview').then(setO);
  }, [call]);
  if (!o) return <p className="text-sm text-app-text-muted">Loading...</p>;
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatTile icon={<Building2 />} tone="sky" label="Companies" value={o.companies} note={`${o.branches} branches`} onClick={() => go('companies')} />
        <StatTile icon={<Activity />} tone="emerald" label="Selling this week" value={o.active_7_days} note="companies with a sale" />
        <StatTile icon={<ClipboardList />} tone={o.requests_waiting ? 'red' : 'slate'} label="Requests waiting" value={o.requests_waiting} onClick={() => go('requests')} />
        <StatTile icon={<Gauge />} tone={o.trials_ending_7_days ? 'amber' : 'slate'} label="Trials ending" value={o.trials_ending_7_days} note="in the next 7 days" />
        <StatTile icon={<Bot />} tone="violet" label="AI questions today" value={o.ai_calls_today} note={o.ai_refused_today ? `${o.ai_refused_today} over the cap` : undefined} />
      </StatGrid>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={card}>
          <h4 className="text-xs font-semibold text-app-text-muted mb-2">By state</h4>
          {Object.entries(o.by_status).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1 text-sm"><StatusPill status={k} /><span className="tabular-nums font-semibold">{v}</span></div>
          ))}
        </div>
        <div className={card}>
          <h4 className="text-xs font-semibold text-app-text-muted mb-2">By plan</h4>
          {Object.entries(o.by_plan).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1 text-sm"><span>{k}</span><span className="tabular-nums font-semibold">{v}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

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

const CYCLE_TEXT: Record<string, string> = { monthly: 'Monthly', annual: 'Yearly', one_time: 'One payment', manual: 'Set by hand', trial: 'Trial' };

function RequestsSection() {
  const { call, busy } = useCall();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [all, setAll] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(() => call<RequestRow[]>('platform_requests', { p_include_decided: all }).then((d) => setRows(d ?? [])), [call, all]);
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
            {r.payment_reference ? <>payment code <span className="font-mono font-semibold">{r.payment_reference}</span></> : 'no payment code'}
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
              <button type="button" disabled={busy} className={btnMain} onClick={() => decide(r, true)}><CheckCircle2 size={14} /> Approve</button>
            </div>
          )}
        </div>
      ))}
      <p className="text-[11px] text-app-text-muted">
        Check the payment code against what you received before approving. A plan change applies at once; a new company then sets itself up.
      </p>
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

function CompaniesSection({ plans, modules }: { plans: PlanRow[]; modules: PlanModule[] }) {
  const { call } = useCall();
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<TenantRow | null>(null);
  const load = useCallback(() => call<TenantRow[]>('platform_tenants').then((d) => setRows(d ?? [])), [call]);
  useEffect(() => {
    load();
  }, [load]);
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
  const [status, setStatus] = useState<'trial' | 'active' | 'suspended'>('active');
  const [cycle, setCycle] = useState('manual');
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [note, setNote] = useState('');
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
    setStatus(s.status);
    setCycle(s.billing_cycle === 'trial' ? 'manual' : s.billing_cycle);
    setPeriodEnd(s.period_end);
    setNote(s.note ?? '');
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

  const savePlan = async () =>
    after(await call('platform_set_plan', {
      p_tenant_id: row.tenant_id, p_plan_code: plan, p_status: status,
      p_billing_cycle: status === 'trial' ? 'trial' : cycle, p_period_end: status === 'trial' ? null : periodEnd,
      p_note: note.trim() || null,
    }, 'Plan saved. No payment needed.'));

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
            <Field label="State" group>
              <Segmented<"trial" | "active" | "suspended">
                size="sm"
                value={status}
                onChange={setStatus}
                options={[{ id: 'trial', label: 'Trial' }, { id: 'active', label: 'Active' }, { id: 'suspended', label: 'Suspended' }]}
              />
            </Field>
            {status !== 'trial' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Paid" group>
                  <Segmented
                    size="sm"
                    value={cycle}
                    onChange={setCycle}
                    options={[{ id: 'manual', label: 'By hand' }, { id: 'monthly', label: 'Monthly' }, { id: 'annual', label: 'Yearly' }, { id: 'one_time', label: 'Once' }]}
                  />
                </Field>
                <Field label="Paid up to" hint="Empty = no end date">
                  <DateTimeInput withTime={false} value={periodEnd} onChange={setPeriodEnd} />
                </Field>
              </div>
            )}
            <Field label="Note (only you see it)">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid M-Pesa QWE123, or free for testing" />
            </Field>
            <button type="button" disabled={busy} className={btnMain} onClick={savePlan}>Save plan</button>
            {d.subscription.status === 'trial' && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Make the trial longer by (days)">
                  <NumberInput value={days} onChange={setDays} decimals={0} min={1} max={90} className="w-28" />
                </Field>
                <button type="button" disabled={busy || !days} className={btnQuiet} onClick={extendTrial}>Extend trial</button>
              </div>
            )}
          </section>

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
    </FormSheet>
  );
}

const ACTION_TEXT: Record<string, string> = {
  plan_set: 'Plan set',
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
  const [section, setSection] = useState<Section>('overview');
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
      case 'overview': return <OverviewSection go={setSection} />;
      case 'requests': return <RequestsSection />;
      case 'companies': return <CompaniesSection plans={plans} modules={modules} />;
      case 'support': return <SupportSection />;
      case 'plans': return <PlansSection plans={plans} modules={modules} reload={loadCatalogue} />;
      case 'costs': return <CostsSection modules={modules} />;
      case 'settings': return <SettingsSection />;
      case 'ai': return <AiSection />;
      case 'activity': return <ActivitySection />;
    }
  })();

  return (
    <div className="min-h-dvh bg-app-bg text-app-text flex flex-col">
      <header className="sticky z-20 bg-app-card/95 backdrop-blur border-b border-app-border px-4 py-2.5" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
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
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 pt-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
        <SectionNav<Section> sections={SECTIONS} active={section} onSelect={setSection} searchPlaceholder="Search the console" collapseKey="kkm_console_nav_collapsed">
          {body}
        </SectionNav>
      </main>
    </div>
  );
}
