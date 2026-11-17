// src/features/PromotionsView.tsx
// Promotions & Points: one place for loyalty points, promotion codes (till and website) and the referral
// programme. Overview shows how codes did; Promotions lists and edits codes; Referrals runs the
// programme, its review queue and costs. Every figure and rule comes from the database
// (services/promotions.ts); this screen never works out a discount itself.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  BadgePercent, Plus, RefreshCw, Search, Gift, AlertTriangle, Check, X, Archive, Power, Pencil,
  Ban, PauseCircle, PlayCircle, Sparkles,
} from 'lucide-react';
import { useBusinessStore } from '../stores/businessStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useCustomerStore } from '../stores/customerStore';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useUiStore } from '../stores/uiStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { FormSheet } from '../components/shared/FormSheet';
import { Switch } from '../components/shared/Switch';
import AreaAdvisor from '../components/assistant/AreaAdvisor';
import { PointsReport } from '../components/loyalty/PointsReport';
import { PointsSettings, canConfigurePoints } from '../components/loyalty/PointsSettings';
import { usePointsEnabled } from '../services/loyalty/pointValue';
import { listBranches, type Branch } from '../services/buying';
import {
  listPromotions, savePromotion, setPromotionStatus, generatePromoCode, listPromotionUses, promotionDashboard,
  referralDashboard, saveReferralCampaign, endReferralCampaign, decideReferral, setReferralCodeStatus,
  PROMO_TYPES, PROMO_STATUS_LABEL, REWARD_KINDS, REFERRAL_STATUS_LABEL, REFERRAL_FLAG_LABEL,
  type Promotion, type PromotionDraft, type PromotionUse, type PromotionDashboard, type ReferralDashboard,
  type ReferralCampaignDraft, type PromoType, type RewardKind, type ProductScope, type ReferralRow,
} from '../services/promotions';

type Tab = 'overview' | 'promotions' | 'referrals' | 'points';

// ─────────────────────────────────────────────── small helpers
const ksh = (n: number | null | undefined) => `KSh ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`;
const ksh2 = (n: number | null | undefined) =>
  `KSh ${(Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const dayTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** ISO time -> the value a datetime-local input shows (local time). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

const INPUT = 'h-10 w-full bg-app-bg border border-app-border rounded-xl px-3 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500';
const LABEL = 'text-[11px] font-semibold text-app-text-muted';
const BTN_PRIMARY = 'inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-sm rounded-xl px-4 py-2.5 cursor-pointer disabled:opacity-50';
const BTN_QUIET = 'inline-flex items-center gap-1.5 bg-app-bg ring-1 ring-app-border text-app-text font-medium text-sm rounded-xl px-3 py-2 cursor-pointer disabled:opacity-50';

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  rewarded: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  redeemed: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  scheduled: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  qualified: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  reserved: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  partially_refunded: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};
function Chip({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STATUS_TONE[status] ?? 'bg-app-bg text-app-text-muted ring-1 ring-app-border'}`}>
      {label ?? status.replace(/_/g, ' ')}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-app-bg p-3 min-w-0">
      <p className="text-[11px] text-app-text-muted truncate">{label}</p>
      <p className="text-lg font-bold text-app-text tabular-nums truncate">{value}</p>
      {sub != null && <p className="text-[11px] text-app-text-muted truncate">{sub}</p>}
    </div>
  );
}

const PERIODS = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'month', label: 'This month' },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];
function periodRange(p: PeriodId): { from: string; to: string } {
  const today = new Date();
  if (p === 'month') return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
  const from = new Date(today);
  from.setDate(from.getDate() - (Number(p) - 1));
  return { from: ymd(from), to: ymd(today) };
}
function PeriodPicker({ value, onChange }: { value: PeriodId; onChange: (p: PeriodId) => void }) {
  return (
    <div role="radiogroup" aria-label="Period" className="flex bg-app-bg rounded-xl p-1 ring-1 ring-app-border">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          role="radio"
          aria-checked={value === p.id}
          onClick={() => onChange(p.id)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer ${value === p.id ? 'bg-app-card text-app-text shadow-xs' : 'text-app-text-muted'}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Pick several items from a long list: search, tick, see the picks as chips. */
function MultiPicker({ label, options, value, onChange, placeholder }: {
  label: string;
  options: { id: string; name: string; sub?: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState('');
  const chosen = new Set(value);
  const shown = options
    .filter((o) => !q.trim() || `${o.name} ${o.sub ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40);
  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="space-y-1.5">
      <p className={LABEL}>{label}</p>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => (
            <button key={id} type="button" onClick={() => toggle(id)} className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-xs cursor-pointer">
              {options.find((o) => o.id === id)?.name ?? 'Removed'} <X size={11} />
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className={`${INPUT} pl-8`} />
      </div>
      <ul className="max-h-40 overflow-y-auto rounded-xl ring-1 ring-app-border divide-y divide-app-border/60">
        {shown.length === 0 && <li className="px-3 py-2 text-xs text-app-text-muted">Nothing matches.</li>}
        {shown.map((o) => (
          <li key={o.id}>
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-app-bg">
              <input type="checkbox" checked={chosen.has(o.id)} onChange={() => toggle(o.id)} className="accent-amber-500" />
              <span className="truncate text-app-text">{o.name}</span>
              {o.sub && <span className="ml-auto text-[11px] text-app-text-muted truncate">{o.sub}</span>}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="text-[11px] text-app-text-muted">{hint}</span>}
    </label>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-app-card rounded-2xl shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-app-text">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="px-4 pb-4 text-sm text-app-text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-app-text-muted text-left">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-1.5 font-medium whitespace-nowrap ${i > 0 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border/60">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2 ${j > 0 ? 'text-right tabular-nums whitespace-nowrap' : 'text-app-text'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────── points (moved here from Loyalty)
function PointsTab({ businessId, canConfigure }: { businessId: string; canConfigure: boolean }) {
  const on = usePointsEnabled(businessId);
  const customers = useCustomerStore((st) => st.customers);
  const [key, setKey] = useState(0);
  const openCustomer = (id: string) => {
    useUiStore.getState().setSelectedCustomerId(id);
    useUiStore.getState().setActiveTab('customers');
  };
  if (!on) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-app-text">Loyalty points are off</p>
        {canConfigure ? <PointsSettings businessId={businessId} /> : <p className="text-sm text-app-text-muted">Ask a manager to switch them on.</p>}
      </div>
    );
  }
  return (
    <PointsReport
      key={key}
      businessId={businessId}
      customers={customers}
      onOpenCustomer={openCustomer}
      settings={canConfigure ? <PointsSettings businessId={businessId} onSaved={() => setKey((k) => k + 1)} /> : undefined}
    />
  );
}

// ─────────────────────────────────────────────── the screen
export default function PromotionsView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const can = (p: Parameters<typeof hasRolePermission>[1]) => !!role && hasRolePermission(role, p);
  const seesPromos = can('promotions.view') || can('promotions.manage');
  const seesReferrals = can('referrals.view') || can('referrals.manage');
  const section = useUiStore((s) => s.screenSection);
  const seesPoints = can('loyalty.view') || can('loyalty.configure') || can('customers.loyalty') || can('customers.view');
  const [tab, setTab] = useState<Tab>(seesPromos ? 'overview' : seesReferrals ? 'referrals' : 'points');
  useEffect(() => {
    if (section === 'referrals' && seesReferrals) setTab('referrals');
    if (section === 'points' && seesPoints) setTab('points');
  }, [section, seesReferrals, seesPoints]);

  const tabs: { id: Tab; label: string; ok: boolean; shortcut?: string }[] = [
    { id: 'overview', label: 'Overview', ok: seesPromos },
    { id: 'promotions', label: 'Promotions', ok: seesPromos },
    { id: 'referrals', label: 'Referrals', ok: seesReferrals, shortcut: 'referrals' },
    { id: 'points', label: 'Points', ok: seesPoints, shortcut: 'points' },
  ];

  if (!businessId) return null;
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-4xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center size-9 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
            <BadgePercent size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-app-text truncate">Promotions & Points</h2>
            <p className="text-xs text-app-text-muted line-clamp-2">Points, codes and referrals in one place.</p>
          </div>
        </div>
        <AreaAdvisor area="rewards" />
        <div role="tablist" className="flex bg-app-card rounded-xl p-1 shadow-xs overflow-x-auto scrollbar-none">
          {tabs.filter((t) => t.ok).map(({ id, label, shortcut }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              data-shortcut={shortcut}
              onClick={() => setTab(id)}
              className={`flex-1 shrink-0 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap ${tab === id ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'overview' && <OverviewTab businessId={businessId} />}
        {tab === 'promotions' && <PromotionsTab businessId={businessId} canManage={can('promotions.manage')} />}
        {tab === 'referrals' && <ReferralsTab businessId={businessId} canManage={can('referrals.manage')} />}
        {tab === 'points' && <PointsTab businessId={businessId} canConfigure={canConfigurePoints(role)} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── overview
function OverviewTab({ businessId }: { businessId: string }) {
  const [period, setPeriod] = useState<PeriodId>('30');
  const [data, setData] = useState<PromotionDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const { from, to } = periodRange(period);
      setData(await promotionDashboard(businessId, from, to));
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the figures. Has the promotions database update been applied?'));
    }
  }, [businessId, period]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const t = data?.totals;
  const lift = data && data.withoutPromotion.avgNet > 0 && t && t.redemptions > 0 ? (t.avgNet / data.withoutPromotion.avgNet - 1) * 100 : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <PeriodPicker value={period} onChange={setPeriod} />
        <button onClick={() => void load()} className={BTN_QUIET} aria-label="Refresh"><RefreshCw size={14} /></button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-sm px-3 py-2">{error}</p>}
      {!data && !error && <p className="text-sm text-app-text-muted px-1">Loading…</p>}
      {data && t && (
        <>
          <section className="bg-app-card rounded-2xl p-3 shadow-xs space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Times used" value={t.redemptions} sub={`${t.customers} customers`} />
              <Stat label="Given in discounts" value={ksh(t.discount)} sub={t.grossSales > 0 ? `${((t.discount / t.grossSales) * 100).toFixed(1)}% of gross` : undefined} />
              <Stat label="Gross on those sales" value={ksh(t.grossSales)} sub="before any discount" />
              <Stat label="Net on those sales" value={ksh(t.netSales)} sub="after discounts, no VAT" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Active" value={data.counts.active} />
              <Stat label="Scheduled" value={data.counts.scheduled} />
              <Stat label="Ended or used up" value={data.counts.expired} />
              <Stat label="All promotions" value={data.counts.total} sub={`${data.counts.off} off · ${data.counts.archived} archived`} />
            </div>
            <p className="text-[11px] text-app-text-muted leading-snug px-1">
              These are sales where a code was used, not extra sales the code caused. Average sale with a code {ksh(t.avgNet)}
              {' '}vs {ksh(data.withoutPromotion.avgNet)} without ({data.withoutPromotion.sales} sales)
              {lift != null && <> · {lift >= 0 ? '+' : ''}{lift.toFixed(0)}%</>}.
              {data.refunds.count + data.refunds.partial > 0 && <> Refunds: {data.refunds.count} full, {data.refunds.partial} part ({ksh(data.refunds.amount)}), left out above.</>}
            </p>
          </section>

          <Section title="Most used codes">
            <Table
              head={['Code', 'Uses', 'Discount', 'Net sales', 'Net per KSh 1 off']}
              empty="No code was used in this period."
              rows={data.byPromotion.slice(0, 10).map((p) => [
                <span key="c"><span className="font-mono font-semibold">{p.code}</span> <span className="text-app-text-muted text-xs">{p.name}</span></span>,
                p.uses, ksh(p.discount), ksh(p.netSales), p.netPerShilling != null ? `KSh ${Number(p.netPerShilling).toFixed(1)}` : '–',
              ])}
            />
          </Section>
          <Section title="Best return on discount">
            <Table
              head={['Code', 'Net per KSh 1 off', 'Discount share', 'Uses']}
              empty="Nothing yet."
              rows={[...data.byPromotion].filter((p) => p.netPerShilling != null)
                .sort((a, b) => Number(b.netPerShilling) - Number(a.netPerShilling)).slice(0, 5)
                .map((p) => [<span key="c" className="font-mono font-semibold">{p.code}</span>, `KSh ${Number(p.netPerShilling).toFixed(1)}`, `${p.discountShare ?? 0}%`, p.uses])}
            />
          </Section>
          <Section title="By product (till sales)">
            <Table
              head={['Product', 'Qty', 'Sold for', 'Discount']}
              empty="No product had a code discount in this period."
              rows={data.byProduct.slice(0, 15).map((p) => [
                <span key="n">{p.name} <span className="text-app-text-muted text-xs">{p.category}</span></span>,
                Number(p.quantity).toLocaleString('en-KE'), ksh(p.net), ksh2(p.discount),
              ])}
            />
          </Section>
          <Section title="By day">
            <Table
              head={['Day', 'Uses', 'Discount', 'Net sales']}
              empty="Nothing in this period."
              rows={[...data.byDay].reverse().map((d) => [day(d.date), d.uses, ksh(d.discount), ksh(d.netSales)])}
            />
          </Section>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── promotions list
const FILTERS = [
  { id: 'live', label: 'Active & scheduled', match: (p: Promotion) => p.status === 'active' || p.status === 'scheduled' },
  { id: 'ended', label: 'Ended & off', match: (p: Promotion) => ['expired', 'used_up', 'off'].includes(p.status) },
  { id: 'archived', label: 'Archived', match: (p: Promotion) => p.status === 'archived' },
  { id: 'all', label: 'All', match: () => true },
] as const;

function PromotionsTab({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const [list, setList] = useState<Promotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('live');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [opened, setOpened] = useState<Promotion | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await listPromotions(businessId));
    } catch (e) {
      setError(toUserMessage(e, 'Could not load promotions. Has the promotions database update been applied?'));
    }
  }, [businessId]);
  useEffect(() => {
    void load();
  }, [load]);
  // A shortcut or search result can ask for a new one.
  const section = useUiStore((s) => s.screenSection);
  useEffect(() => {
    if (section === 'new' && canManage) setEditing('new');
  }, [section, canManage]);

  const f = FILTERS.find((x) => x.id === filter)!;
  const shown = (list ?? []).filter(f.match).filter((p) =>
    !q.trim() || `${p.code} ${p.name} ${p.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[10rem]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or name" className={`${INPUT} pl-8 bg-app-card`} />
        </div>
        {canManage && (
          <button data-shortcut="new" onClick={() => setEditing('new')} className={BTN_PRIMARY}>
            <Plus size={15} /> New promotion
          </button>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        {FILTERS.map((x) => (
          <button key={x.id} onClick={() => setFilter(x.id)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium cursor-pointer ${filter === x.id ? 'bg-app-text text-app-bg' : 'bg-app-card text-app-text-muted ring-1 ring-app-border'}`}>
            {x.label} ({(list ?? []).filter(x.match).length})
          </button>
        ))}
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-sm px-3 py-2">{error}</p>}
      <section className="bg-app-card rounded-2xl shadow-xs overflow-hidden">
        {!list && !error && <p className="p-4 text-sm text-app-text-muted">Loading…</p>}
        {list && shown.length === 0 && (
          <p className="p-4 text-sm text-app-text-muted">
            {list.length === 0 ? 'No promotions yet. Create one and give the code to customers.' : 'None here.'}
          </p>
        )}
        <ul className="divide-y divide-app-border/60">
          {shown.map((p) => (
            <li key={p.id}>
              <button onClick={() => setOpened(p)} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-app-bg cursor-pointer">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-app-text">{p.code}</span>
                    <Chip status={p.status} label={PROMO_STATUS_LABEL[p.status]} />
                    {!p.ownBranch && <Chip status="shared" label="From another branch" />}
                  </div>
                  <p className="text-sm text-app-text truncate">{p.name} <span className="text-app-text-muted">· {p.summary}</span></p>
                  <p className="text-[11px] text-app-text-muted">
                    {[p.usePos && 'Till', p.useOnline && 'Online'].filter(Boolean).join(' & ')}
                    {p.endsAt ? ` · until ${day(p.endsAt)}` : ''}
                    {p.startsAt && p.status === 'scheduled' ? ` · starts ${day(p.startsAt)}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-app-text tabular-nums">{p.uses}{p.maxUses ? ` / ${p.maxUses}` : ''}</p>
                  <p className="text-[11px] text-app-text-muted tabular-nums">{ksh(p.discountGiven)} off</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {editing && (
        <PromotionEditor
          businessId={businessId}
          promotion={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setOpened(null); void load(); }}
        />
      )}
      {opened && !editing && (
        <PromotionDetail
          promotion={opened}
          canManage={canManage && opened.ownBranch}
          onClose={() => setOpened(null)}
          onEdit={() => setEditing(opened)}
          onChanged={() => { setOpened(null); void load(); }}
        />
      )}
    </div>
  );
}

function PromotionDetail({ promotion: p, canManage, onClose, onEdit, onChanged }: {
  promotion: Promotion; canManage: boolean; onClose: () => void; onEdit: () => void; onChanged: () => void;
}) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [uses, setUses] = useState<PromotionUse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  useEffect(() => {
    listPromotionUses(p.id).then(setUses).catch(() => setUses([]));
  }, [p.id]);
  const act = async (action: 'activate' | 'deactivate' | 'archive' | 'restore', done: string) => {
    setBusy(true);
    try {
      await setPromotionStatus(p.id, action);
      showToast('Promotions', done, undefined, 'success');
      onChanged();
    } catch (e) {
      showToast('Promotions', toUserMessage(e, 'Could not change the promotion.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };
  const archived = p.status === 'archived';
  return (
    <FormSheet
      title={`${p.code} · ${p.name}`}
      subtitle={p.summary}
      onClose={onClose}
      wide
      footer={canManage ? (
        <div className="flex flex-wrap gap-2 justify-end">
          {archived ? (
            <button disabled={busy} onClick={() => void act('restore', 'Promotion restored (still off).')} className={BTN_QUIET}><Archive size={14} /> Restore</button>
          ) : confirmArchive ? (
            <>
              <span className="text-xs text-app-text-muted self-center">The code stops working; its history is kept.</span>
              <button onClick={() => setConfirmArchive(false)} className={BTN_QUIET}>Keep</button>
              <button disabled={busy} onClick={() => void act('archive', 'Promotion archived.')} className={`${BTN_QUIET} text-red-600`}>Archive</button>
            </>
          ) : (
            <>
              <button onClick={() => setConfirmArchive(true)} className={BTN_QUIET}><Archive size={14} /> Archive</button>
              {p.active ? (
                <button disabled={busy} onClick={() => void act('deactivate', 'Promotion switched off.')} className={BTN_QUIET}><Power size={14} /> Switch off</button>
              ) : (
                <button disabled={busy} onClick={() => void act('activate', 'Promotion switched on.')} className={BTN_QUIET}><Power size={14} /> Switch on</button>
              )}
              <button onClick={onEdit} className={BTN_PRIMARY}><Pencil size={14} /> Edit</button>
            </>
          )}
        </div>
      ) : undefined}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Used" value={`${p.uses}${p.maxUses ? ` / ${p.maxUses}` : ''}`} sub={p.held ? `${p.held} held at a till` : undefined} />
        <Stat label="Given" value={ksh(p.discountGiven)} />
        <Stat label="Status" value={PROMO_STATUS_LABEL[p.status]} />
        <Stat label="Where" value={[p.usePos && 'Till', p.useOnline && 'Online'].filter(Boolean).join(' & ')} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {p.description && (<><dt className="text-app-text-muted">About</dt><dd>{p.description}</dd></>)}
        <dt className="text-app-text-muted">When</dt>
        <dd>{p.startsAt ? day(p.startsAt) : 'Now'} – {p.endsAt ? day(p.endsAt) : 'no end'}</dd>
        {p.minOrder > 0 && (<><dt className="text-app-text-muted">Minimum</dt><dd>{ksh(p.minOrder)}</dd></>)}
        {p.maxDiscount != null && (<><dt className="text-app-text-muted">Most off</dt><dd>{ksh(p.maxDiscount)}</dd></>)}
        <dt className="text-app-text-muted">Who</dt>
        <dd>{p.audience === 'selected' ? `${p.customerIds.length} chosen customers` : p.audience === 'first_purchase' ? 'New customers, first purchase' : 'Everyone'}{p.oncePerCustomer ? ', once each' : ''}</dd>
        <dt className="text-app-text-muted">Covers</dt>
        <dd>{p.productScope === 'all' ? 'All products' : p.productScope === 'products' ? `${p.productIds.length} products` : p.categories.join(', ')}</dd>
        <dt className="text-app-text-muted">With other discounts</dt><dd>{p.stackable ? 'Allowed' : 'Not allowed'}</dd>
      </dl>
      <div>
        <p className="text-sm font-semibold mb-1">Uses</p>
        {!uses && <p className="text-sm text-app-text-muted">Loading…</p>}
        {uses && uses.length === 0 && <p className="text-sm text-app-text-muted">Not used yet.</p>}
        {uses && uses.length > 0 && (
          <ul className="divide-y divide-app-border/60 rounded-xl ring-1 ring-app-border">
            {uses.map((u) => (
              <li key={u.id} className="px-3 py-2 flex items-start gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{u.customer ?? 'Walk-in'} <span className="text-app-text-muted text-xs">· {u.receipt ?? (u.order ? `Order ${u.order}` : '')}</span></p>
                  <p className="text-[11px] text-app-text-muted">{dayTime(u.at)} · {u.channel === 'pos' ? `Till${u.staff ? `, ${u.staff}` : ''}` : 'Online'}{u.branch ? ` · ${u.branch}` : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="tabular-nums">−{ksh2(u.discount)}</p>
                  <Chip status={u.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormSheet>
  );
}

// ─────────────────────────────────────────────── editor
function blankDraft(): PromotionDraft {
  return {
    name: '', code: '', description: '', promoType: 'percentage', kind: 'percent', value: 10, maxDiscount: null,
    minOrder: 0, startsAt: null, endsAt: null, maxUses: null, oncePerCustomer: false, stackable: false,
    audience: 'everyone', productScope: 'all', productIds: [], categories: [], customerIds: [], branchIds: [],
    buyQty: null, rewardProductId: null, rewardQty: null, usePos: true, useOnline: false, showOnWebsite: false, active: true,
  };
}

function useCatalog(businessId: string) {
  const { products, categories } = useInventoryStore(useShallow((s) => ({ products: s.products, categories: s.categories })));
  const customers = useCustomerStore((s) => s.customers);
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    listBranches(businessId).then(setBranches).catch(() => setBranches([]));
  }, [businessId]);
  return {
    products: useMemo(() => products.filter((p) => p.businessId === businessId).map((p) => ({ id: p.id, name: p.name, sub: p.category })), [products, businessId]),
    categories: useMemo(() => categories.map((c) => ({ id: c, name: c })), [categories]),
    customers: useMemo(() => customers.filter((c) => c.businessId === businessId).map((c) => ({ id: c.id, name: c.name, sub: c.phone })), [customers, businessId]),
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
  };
}

function PromotionEditor({ businessId, promotion, onClose, onSaved }: {
  businessId: string; promotion: Promotion | null; onClose: () => void; onSaved: () => void;
}) {
  const showToast = useNotificationStore((s) => s.showToast);
  const cat = useCatalog(businessId);
  const [d, setD] = useState<PromotionDraft>(() => (promotion ? { ...blankDraft(), ...promotion } : blankDraft()));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<PromotionDraft>) => setD((x) => ({ ...x, ...patch }));
  const t = d.promoType;
  const freeItems = t === 'buy_x_get_y' || t === 'free_product';
  const choosesKind = t === 'min_spend' || t === 'customer' || t === 'first_purchase';
  const kind = freeItems ? 'free_items' : t === 'percentage' ? 'percent' : t === 'fixed' ? 'amount' : d.kind === 'free_items' ? 'percent' : d.kind;
  const audienceFixed = t === 'customer' || t === 'first_purchase';
  const audience = t === 'customer' ? 'selected' : t === 'first_purchase' ? 'first_purchase' : d.audience;
  const onlineOk = (kind === 'percent' || kind === 'amount') && audience === 'everyone' && d.productScope === 'all';

  const generate = async () => {
    try {
      set({ code: await generatePromoCode(businessId) });
    } catch (e) {
      setError(toUserMessage(e, 'Could not make a code.'));
    }
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await savePromotion(businessId, promotion?.id ?? null, {
        ...d, kind, audience, useOnline: d.useOnline && onlineOk, showOnWebsite: d.showOnWebsite && d.useOnline && onlineOk,
        code: d.code.trim().toUpperCase(),
      });
      showToast('Promotions', promotion ? 'Promotion saved.' : 'Promotion created.', undefined, 'success');
      onSaved();
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the promotion.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      title={promotion ? `Edit ${promotion.code}` : 'New promotion'}
      subtitle="The server checks these rules again at every sale."
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center gap-2 justify-end">
          {error && <p role="alert" className="mr-auto text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button onClick={onClose} className={BTN_QUIET}>Cancel</button>
          <button disabled={saving} onClick={() => void save()} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name"><input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Milk week" className={INPUT} maxLength={80} /></Field>
        <Field label="Code" hint="Letters, numbers, dashes. Customers can type it in any case.">
          <div className="flex gap-1.5">
            <input value={d.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="MILK10" className={`${INPUT} font-mono uppercase`} maxLength={24} />
            <button type="button" onClick={() => void generate()} className={BTN_QUIET} title="Make a random code"><Sparkles size={14} /></button>
          </div>
        </Field>
      </div>
      <Field label="Description (optional)"><input value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} className={INPUT} maxLength={500} /></Field>

      <div>
        <p className={`${LABEL} mb-1`}>Type</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {PROMO_TYPES.map((pt) => (
            <button key={pt.id} type="button" onClick={() => set({ promoType: pt.id as PromoType })}
              className={`text-left rounded-xl px-2.5 py-2 ring-1 cursor-pointer ${t === pt.id ? 'ring-amber-500 bg-amber-500/10' : 'ring-app-border bg-app-bg'}`}>
              <p className="text-xs font-semibold text-app-text">{pt.label}</p>
              <p className="text-[10px] text-app-text-muted leading-tight">{pt.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {choosesKind && (
          <Field label="Gives">
            <select value={kind} onChange={(e) => set({ kind: e.target.value as PromotionDraft['kind'] })} className={INPUT}>
              <option value="percent">Percentage off</option>
              <option value="amount">Amount off</option>
            </select>
          </Field>
        )}
        {!freeItems && (
          <Field label={kind === 'percent' ? 'Percent off' : 'KSh off'}>
            <input type="number" min="0" value={d.value || ''} onChange={(e) => set({ value: Number(e.target.value) })} className={INPUT} />
          </Field>
        )}
        {t === 'buy_x_get_y' && (
          <Field label="Customer buys" hint="of the covered items">
            <input type="number" min="1" value={d.buyQty ?? ''} onChange={(e) => set({ buyQty: numOrNull(e.target.value) })} className={INPUT} />
          </Field>
        )}
        {freeItems && (
          <>
            <Field label="Free product">
              <select value={d.rewardProductId ?? ''} onChange={(e) => set({ rewardProductId: e.target.value || null })} className={INPUT}>
                <option value="">Choose…</option>
                {cat.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="How many free">
              <input type="number" min="1" value={d.rewardQty ?? ''} onChange={(e) => set({ rewardQty: numOrNull(e.target.value) })} className={INPUT} />
            </Field>
          </>
        )}
        <Field label={t === 'min_spend' ? 'Spend at least (KSh)' : 'Minimum purchase (KSh)'}>
          <input type="number" min="0" value={d.minOrder || ''} onChange={(e) => set({ minOrder: Number(e.target.value) || 0 })} className={INPUT} />
        </Field>
        {kind === 'percent' && (
          <Field label="Most off (KSh)" hint="Optional cap">
            <input type="number" min="0" value={d.maxDiscount ?? ''} onChange={(e) => set({ maxDiscount: numOrNull(e.target.value) })} className={INPUT} />
          </Field>
        )}
      </div>
      {freeItems && <p className="text-[11px] text-app-text-muted">The free item goes in the cart like any item; the code takes its price off. The till says when to add it.</p>}

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Covers">
          <select value={d.productScope} onChange={(e) => set({ productScope: e.target.value as ProductScope })} className={INPUT}>
            <option value="all">All products</option>
            <option value="products">Chosen products</option>
            <option value="categories">Chosen categories</option>
          </select>
        </Field>
        {!audienceFixed && (
          <Field label="Who can use it">
            <select value={d.audience} onChange={(e) => set({ audience: e.target.value as PromotionDraft['audience'] })} className={INPUT}>
              <option value="everyone">Anyone with the code</option>
              <option value="selected">Chosen customers</option>
              <option value="first_purchase">New customers, first purchase</option>
            </select>
          </Field>
        )}
      </div>
      {d.productScope === 'products' && (
        <MultiPicker label={t === 'buy_x_get_y' ? 'Products to buy' : 'Products covered'} options={cat.products} value={d.productIds} onChange={(ids) => set({ productIds: ids })} placeholder="Search products" />
      )}
      {d.productScope === 'categories' && (
        <MultiPicker label="Categories covered" options={cat.categories} value={d.categories} onChange={(ids) => set({ categories: ids })} placeholder="Search categories" />
      )}
      {audience === 'selected' && (
        <MultiPicker label="Customers who can use it" options={cat.customers} value={d.customerIds} onChange={(ids) => set({ customerIds: ids })} placeholder="Search name or phone" />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Starts"><input type="datetime-local" value={toLocalInput(d.startsAt)} onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })} className={INPUT} /></Field>
        <Field label="Ends"><input type="datetime-local" value={toLocalInput(d.endsAt)} onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })} className={INPUT} /></Field>
        <Field label="Total uses" hint="Empty: no limit">
          <input type="number" min="1" value={d.maxUses ?? ''} onChange={(e) => set({ maxUses: numOrNull(e.target.value) })} className={INPUT} />
        </Field>
      </div>

      <div className="rounded-xl bg-app-bg p-3 space-y-2.5">
        <Switch checked={d.oncePerCustomer} onChange={(v) => set({ oncePerCustomer: v })} label="Once per customer" description="The cashier must choose the customer." />
        <Switch checked={d.stackable} onChange={(v) => set({ stackable: v })} label="Can be combined with other discounts" description="Item %, cart discount and points." />
        <Switch checked={d.usePos} onChange={(v) => set({ usePos: v })} label="Works at the till" />
        <Switch checked={d.useOnline && onlineOk} disabled={!onlineOk} onChange={(v) => set({ useOnline: v })} label="Works in the online shop"
          description={onlineOk ? undefined : 'Only percentage or amount codes for anyone, on all products.'} />
        {d.useOnline && onlineOk && <Switch checked={d.showOnWebsite} onChange={(v) => set({ showOnWebsite: v })} label="Show it on the website" />}
        {!promotion && <Switch checked={d.active} onChange={(v) => set({ active: v })} label="Switch on when saved" />}
      </div>
      {cat.branches.length > 0 && (
        <MultiPicker label="Also works at these branches" options={cat.branches} value={d.branchIds} onChange={(ids) => set({ branchIds: ids })} placeholder="Search branches" />
      )}
    </FormSheet>
  );
}

// ─────────────────────────────────────────────── referrals
function ReferralsTab({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [period, setPeriod] = useState<PeriodId>('30');
  const [data, setData] = useState<ReferralDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null);
  const [deciding, setDeciding] = useState<{ row: ReferralRow; approve: boolean } | null>(null);
  const [holding, setHolding] = useState<{ codeId: string; name: string; status: 'suspended' | 'revoked' } | null>(null);
  const [view, setView] = useState<'review' | 'all'>('review');
  const load = useCallback(async () => {
    setError(null);
    try {
      const { from, to } = periodRange(period);
      setData(await referralDashboard(businessId, from, to));
    } catch (e) {
      setError(toUserMessage(e, 'Could not load referrals. Has the referrals database update been applied?'));
    }
  }, [businessId, period]);
  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (codeId: string) => {
    try {
      await setReferralCodeStatus(codeId, 'active');
      showToast('Referrals', 'Code works again.', undefined, 'success');
      void load();
    } catch (e) {
      showToast('Referrals', toUserMessage(e, 'Could not change the code.'), undefined, 'error');
    }
  };
  const k = data?.campaign;
  const review = (data?.referrals ?? []).filter((r) => r.status === 'qualified' || r.status === 'pending' || r.flags.length > 0);
  const rows = view === 'review' ? review : data?.referrals ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <PeriodPicker value={period} onChange={setPeriod} />
        <button onClick={() => void load()} className={BTN_QUIET} aria-label="Refresh"><RefreshCw size={14} /></button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-sm px-3 py-2">{error}</p>}
      {!data && !error && <p className="text-sm text-app-text-muted px-1">Loading…</p>}
      {data && (
        <>
          <section className="bg-app-card rounded-2xl p-4 shadow-xs space-y-2">
            <div className="flex items-start gap-3 flex-wrap">
              <span className="grid place-items-center size-9 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0"><Gift size={18} /></span>
              <div className="min-w-0 flex-1">
                {k ? (
                  <>
                    <p className="text-sm font-semibold text-app-text">{k.name} <Chip status="active" label="Running" /></p>
                    <p className="text-xs text-app-text-muted">
                      Referrer gets <b className="text-app-text">{k.referrerText}</b> · new customer gets <b className="text-app-text">{k.welcomeText}</b>
                      {Number(k.welcome?.minPurchase) > 0 && <> on a first purchase of {ksh(k.welcome.minPurchase)} or more</>}
                      {' '}· rewards after {k.hold_days} day{k.hold_days === 1 ? '' : 's'}{k.review_flagged ? ', flagged ones checked by a manager' : ''}
                      {k.ends_at ? ` · ends ${day(k.ends_at)}` : ''}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-app-text">No referral programme running</p>
                    <p className="text-xs text-app-text-muted">Start one: every customer gets a code to share, and both sides get a reward after the new customer's first purchase.</p>
                  </>
                )}
              </div>
              {canManage && (
                <div className="flex gap-2">
                  {k && <button onClick={() => setEditing('edit')} className={BTN_QUIET}><Pencil size={14} /> Change</button>}
                  <button onClick={() => setEditing('new')} className={BTN_PRIMARY}><Plus size={15} /> {k ? 'New programme' : 'Start a programme'}</button>
                </div>
              )}
            </div>
          </section>

          <section className="bg-app-card rounded-2xl p-3 shadow-xs space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Referrals" value={data.counts.total} sub={`${data.counts.rewarded} rewarded`} />
              <Stat label="Waiting" value={data.counts.qualified + data.counts.pending} sub={data.counts.flagged ? `${data.counts.flagged} flagged` : 'none flagged'} />
              <Stat label="Rewards cost" value={ksh(data.costs.total)} sub={`${ksh(data.costs.wallet)} wallet · ${ksh(data.costs.welcomeDiscounts + data.costs.rewardCodesUsed)} discounts`} />
              <Stat label="Referred customers bought" value={ksh(data.referredSales)} sub={`first purchases ${ksh(data.counts.firstPurchases)}`} />
            </div>
            <p className="text-[11px] text-app-text-muted px-1">
              Wallet credit is booked as Referral rewards; discounts as Promotion discounts. {data.costs.points > 0 && <>{data.costs.points.toLocaleString('en-KE')} points given (they cost money only when spent). </>}
              {data.costs.rewardCodesOpen > 0 && <>{data.costs.rewardCodesOpen} reward codes not used yet. </>}
              {data.costs.takenBack > 0 && <>{ksh(data.costs.takenBack)} taken back after refunds. </>}
              {data.counts.cancelled + data.counts.rejected > 0 && <>{data.counts.cancelled} cancelled, {data.counts.rejected} refused.</>}
            </p>
          </section>

          <Section
            title="Referrals"
            action={
              <div className="flex bg-app-bg rounded-lg p-0.5 ring-1 ring-app-border">
                {([['review', `To check (${review.length})`], ['all', 'All']] as const).map(([id, l]) => (
                  <button key={id} onClick={() => setView(id)} className={`px-2 py-0.5 rounded-md text-xs cursor-pointer ${view === id ? 'bg-app-card text-app-text shadow-xs' : 'text-app-text-muted'}`}>{l}</button>
                ))}
              </div>
            }
          >
            {rows.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-app-text-muted">{view === 'review' ? 'Nothing to check.' : 'No referrals in this period.'}</p>
            ) : (
              <ul className="divide-y divide-app-border/60">
                {rows.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-app-text">
                        <b>{r.referrer}</b> <span className="text-app-text-muted">→</span> <b>{r.referred}</b>{' '}
                        <Chip status={r.status} label={REFERRAL_STATUS_LABEL[r.status]} />
                      </p>
                      <p className="text-[11px] text-app-text-muted">
                        {dayTime(r.at)} · <span className="font-mono">{r.code}</span>
                        {r.receipt ? ` · ${r.receipt}` : ''}{r.purchase != null ? ` · bought ${ksh(r.purchase)}` : ''}
                        {r.staff ? ` · ${r.staff}` : ''}
                        {r.status === 'qualified' && r.rewardDueAt ? ` · rewards ${new Date(r.rewardDueAt) > new Date() ? `on ${day(r.rewardDueAt)}` : 'due'}` : ''}
                        {r.endReason ? ` · ${r.endReason}` : ''}
                      </p>
                      {r.flags.length > 0 && (
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          {r.flags.map((f) => (
                            <span key={f} className="inline-flex items-center gap-1 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 px-1.5 py-0.5 text-[10px] font-semibold">
                              <AlertTriangle size={10} /> {REFERRAL_FLAG_LABEL[f] ?? f}
                            </span>
                          ))}
                        </p>
                      )}
                      {r.rewards.length > 0 && (
                        <p className="text-[11px] text-app-text-muted mt-0.5">{r.rewards.map((w) => `${w.side === 'referrer' ? 'Referrer' : 'New'}: ${w.what} (${w.status})`).join(' · ')}</p>
                      )}
                    </div>
                    {canManage && r.status === 'qualified' && (
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => setDeciding({ row: r, approve: false })} className={`${BTN_QUIET} px-2`} aria-label="Refuse rewards"><X size={14} /></button>
                        <button onClick={() => setDeciding({ row: r, approve: true })} className={`${BTN_PRIMARY} px-2.5 py-2`} aria-label="Give rewards now"><Check size={14} /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Top referrers">
            <Table
              head={['Customer', 'Referred', 'Rewarded', 'Flagged', 'Cost', '']}
              empty="No referrals in this period."
              rows={data.topReferrers.map((t) => [
                <span key="n">{t.name} <span className="font-mono text-xs text-app-text-muted">{t.code}</span> {t.codeStatus !== 'active' && <Chip status={t.codeStatus} />}</span>,
                t.referrals, t.rewarded, t.flagged || '', ksh(t.cost),
                canManage && t.codeId ? (
                  t.codeStatus === 'active' ? (
                    <span key="a" className="inline-flex gap-1">
                      <button onClick={() => setHolding({ codeId: t.codeId, name: t.name, status: 'suspended' })} className="p-1 rounded-lg hover:bg-app-bg cursor-pointer" title="Hold this code"><PauseCircle size={15} /></button>
                      <button onClick={() => setHolding({ codeId: t.codeId, name: t.name, status: 'revoked' })} className="p-1 rounded-lg hover:bg-app-bg cursor-pointer text-red-600" title="Revoke this code"><Ban size={15} /></button>
                    </span>
                  ) : t.codeStatus === 'suspended' ? (
                    <button key="r" onClick={() => void restore(t.codeId)} className="p-1 rounded-lg hover:bg-app-bg cursor-pointer" title="Let this code work again"><PlayCircle size={15} /></button>
                  ) : ''
                ) : '',
              ])}
            />
          </Section>
        </>
      )}
      {editing && data && (
        <CampaignEditor
          businessId={businessId}
          campaign={editing === 'edit' ? data.campaign : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
      {deciding && <DecideSheet {...deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); void load(); }} />}
      {holding && <HoldCodeSheet {...holding} onClose={() => setHolding(null)} onDone={() => { setHolding(null); void load(); }} />}
    </div>
  );
}

function DecideSheet({ row, approve, onClose, onDone }: { row: ReferralRow; approve: boolean; onClose: () => void; onDone: () => void }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await decideReferral(row.id, approve, reason);
      showToast('Referrals', approve ? 'Rewards given.' : 'Rewards refused.', undefined, 'success');
      onDone();
    } catch (e) {
      setError(toUserMessage(e, 'Could not do that.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormSheet
      title={approve ? 'Give the rewards now?' : 'Refuse the rewards?'}
      subtitle={`${row.referrer} → ${row.referred}`}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2 justify-end">
          {error && <p role="alert" className="mr-auto text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button onClick={onClose} className={BTN_QUIET}>Back</button>
          <button disabled={busy || (!approve && !reason.trim())} onClick={() => void go()} className={approve ? BTN_PRIMARY : `${BTN_QUIET} text-red-600`}>
            {approve ? 'Give rewards' : 'Refuse'}
          </button>
        </div>
      }
    >
      {row.flags.length > 0 && <p className="text-sm">Flagged: {row.flags.map((f) => REFERRAL_FLAG_LABEL[f] ?? f).join(', ')}.</p>}
      <p className="text-sm text-app-text-muted">
        {approve
          ? 'Both sides get their rewards now, without waiting. This is recorded with your name.'
          : 'Neither side gets a reward (a welcome discount already taken at the sale stays). Recorded with your name.'}
      </p>
      {!approve && <Field label="Why"><input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="e.g. Same household" /></Field>}
    </FormSheet>
  );
}

function HoldCodeSheet({ codeId, name, status, onClose, onDone }: { codeId: string; name: string; status: 'suspended' | 'revoked'; onClose: () => void; onDone: () => void }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    try {
      await setReferralCodeStatus(codeId, status, reason);
      showToast('Referrals', status === 'suspended' ? 'Code on hold.' : 'Code revoked.', undefined, 'success');
      onDone();
    } catch (e) {
      setError(toUserMessage(e, 'Could not change the code.'));
    }
  };
  return (
    <FormSheet
      title={status === 'suspended' ? `Hold ${name}'s code?` : `Revoke ${name}'s code?`}
      subtitle={status === 'suspended' ? 'No new referrals and no rewards paid until it works again.' : 'For good. The customer can be given a new code later.'}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2 justify-end">
          {error && <p role="alert" className="mr-auto text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button onClick={onClose} className={BTN_QUIET}>Back</button>
          <button disabled={!reason.trim()} onClick={() => void go()} className={`${BTN_QUIET} text-red-600`}>{status === 'suspended' ? 'Hold' : 'Revoke'}</button>
        </div>
      }
    >
      <Field label="Why"><input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="e.g. Looks like fake accounts" /></Field>
    </FormSheet>
  );
}

function RewardFields({ who, kind, value, productId, qty, onChange, products }: {
  who: string; kind: RewardKind; value: number | null; productId: string | null; qty: number | null;
  onChange: (patch: { kind?: RewardKind; value?: number | null; productId?: string | null; qty?: number | null }) => void;
  products: { id: string; name: string }[];
}) {
  return (
    <div className="rounded-xl bg-app-bg p-3 space-y-2">
      <p className="text-sm font-semibold text-app-text">{who}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Reward">
          <select value={kind} onChange={(e) => onChange({ kind: e.target.value as RewardKind })} className={INPUT}>
            {REWARD_KINDS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
        {kind === 'free_product' ? (
          <Field label="How many">
            <input type="number" min="1" value={qty ?? ''} onChange={(e) => onChange({ qty: numOrNull(e.target.value) })} className={INPUT} />
          </Field>
        ) : (
          <Field label={kind === 'percent' ? 'Percent' : kind === 'points' ? 'Points' : 'KSh'}>
            <input type="number" min="0" value={value ?? ''} onChange={(e) => onChange({ value: numOrNull(e.target.value) })} className={INPUT} />
          </Field>
        )}
      </div>
      {kind === 'free_product' && (
        <Field label="Free product">
          <select value={productId ?? ''} onChange={(e) => onChange({ productId: e.target.value || null })} className={INPUT}>
            <option value="">Choose…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

function CampaignEditor({ businessId, campaign, onClose, onSaved }: {
  businessId: string; campaign: ReferralDashboard['campaign']; onClose: () => void; onSaved: () => void;
}) {
  const showToast = useNotificationStore((s) => s.showToast);
  const cat = useCatalog(businessId);
  const [d, setD] = useState<ReferralCampaignDraft>(() => ({
    name: campaign?.name ?? 'Bring a friend',
    description: campaign?.description ?? null,
    active: true,
    startsAt: campaign?.starts_at ?? null,
    endsAt: campaign?.ends_at ?? null,
    referrerKind: campaign?.referrer_kind ?? 'wallet',
    referrerValue: campaign ? Number(campaign.referrer_value) || null : 100,
    referrerProductId: campaign?.referrer_product_id ?? null,
    referrerQty: campaign?.referrer_qty != null ? Number(campaign.referrer_qty) : null,
    welcomeKind: campaign?.welcome_kind ?? 'amount',
    welcomeValue: campaign ? Number(campaign.welcome_value) || null : 50,
    welcomeProductId: campaign?.welcome_product_id ?? null,
    welcomeQty: campaign?.welcome_qty != null ? Number(campaign.welcome_qty) : null,
    minPurchase: Number(campaign?.welcome?.minPurchase ?? 300),
    maxDiscount: campaign?.welcome?.maxDiscount != null ? Number(campaign.welcome.maxDiscount) : null,
    productScope: campaign?.welcome?.productScope ?? 'all',
    productIds: campaign?.welcome?.productIds ?? [],
    categories: campaign?.welcome?.categories ?? [],
    branchIds: campaign?.welcome?.branchIds ?? [],
    stackable: campaign?.welcome?.stackable ?? false,
    maxPerReferrer: campaign?.max_per_referrer ?? 10,
    maxTotal: campaign?.max_total ?? null,
    maxRewardsPerCustomer: campaign?.max_rewards_per_customer ?? null,
    rewardExpiryDays: campaign?.reward_expiry_days ?? 60,
    holdDays: campaign?.hold_days ?? 3,
    excludeExisting: campaign?.exclude_existing ?? true,
    newCustomerDays: campaign?.new_customer_days ?? 30,
    requirePhone: campaign?.require_phone ?? true,
    reviewFlagged: campaign?.review_flagged ?? true,
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const set = (patch: Partial<ReferralCampaignDraft>) => setD((x) => ({ ...x, ...patch }));
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveReferralCampaign(businessId, campaign?.id ?? null, d);
      showToast('Referrals', campaign ? 'Programme saved.' : 'Programme started. It replaces any other running here.', undefined, 'success');
      onSaved();
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the programme.'));
    } finally {
      setSaving(false);
    }
  };
  const end = async () => {
    if (!campaign) return;
    try {
      await endReferralCampaign(campaign.id);
      showToast('Referrals', 'Programme ended. Rewards already earned stay.', undefined, 'success');
      onSaved();
    } catch (e) {
      setError(toUserMessage(e, 'Could not end the programme.'));
    }
  };
  return (
    <FormSheet
      title={campaign ? `Change ${campaign.name}` : 'New referral programme'}
      subtitle="Starting a programme ends the one running at this branch."
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center gap-2 justify-end flex-wrap">
          {error && <p role="alert" className="mr-auto text-xs text-red-600 dark:text-red-400">{error}</p>}
          {campaign && (confirmEnd
            ? <button onClick={() => void end()} className={`${BTN_QUIET} text-red-600`}>Yes, end it</button>
            : <button onClick={() => setConfirmEnd(true)} className={BTN_QUIET}>End programme</button>)}
          <button onClick={onClose} className={BTN_QUIET}>Cancel</button>
          <button disabled={saving} onClick={() => void save()} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      }
    >
      <Field label="Name"><input value={d.name} onChange={(e) => set({ name: e.target.value })} className={INPUT} maxLength={80} /></Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <RewardFields who="The customer who refers" kind={d.referrerKind} value={d.referrerValue} productId={d.referrerProductId} qty={d.referrerQty} products={cat.products}
          onChange={(p) => set({ ...(p.kind ? { referrerKind: p.kind } : {}), ...('value' in p ? { referrerValue: p.value ?? null } : {}), ...('productId' in p ? { referrerProductId: p.productId ?? null } : {}), ...('qty' in p ? { referrerQty: p.qty ?? null } : {}) })} />
        <RewardFields who="The new customer" kind={d.welcomeKind} value={d.welcomeValue} productId={d.welcomeProductId} qty={d.welcomeQty} products={cat.products}
          onChange={(p) => set({ ...(p.kind ? { welcomeKind: p.kind } : {}), ...('value' in p ? { welcomeValue: p.value ?? null } : {}), ...('productId' in p ? { welcomeProductId: p.productId ?? null } : {}), ...('qty' in p ? { welcomeQty: p.qty ?? null } : {}) })} />
      </div>
      <p className="text-[11px] text-app-text-muted">
        Discounts and free products for the new customer come off the first sale. Wallet credit and points are given after the wait.
        The referrer's discount or free product becomes a personal code for their next visit.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="First purchase at least (KSh)"><input type="number" min="0" value={d.minPurchase || ''} onChange={(e) => set({ minPurchase: Number(e.target.value) || 0 })} className={INPUT} /></Field>
        <Field label="Wait before rewards (days)" hint="Guards against refunds"><input type="number" min="0" max="60" value={d.holdDays} onChange={(e) => set({ holdDays: Number(e.target.value) || 0 })} className={INPUT} /></Field>
        <Field label="Reward codes last (days)" hint="Empty: no end"><input type="number" min="1" value={d.rewardExpiryDays ?? ''} onChange={(e) => set({ rewardExpiryDays: numOrNull(e.target.value) })} className={INPUT} /></Field>
        <Field label="Most off (KSh)" hint="Welcome % cap"><input type="number" min="0" value={d.maxDiscount ?? ''} onChange={(e) => set({ maxDiscount: numOrNull(e.target.value) })} className={INPUT} /></Field>
        <Field label="Referrals per customer"><input type="number" min="1" value={d.maxPerReferrer ?? ''} onChange={(e) => set({ maxPerReferrer: numOrNull(e.target.value) })} className={INPUT} /></Field>
        <Field label="Referrals in total"><input type="number" min="1" value={d.maxTotal ?? ''} onChange={(e) => set({ maxTotal: numOrNull(e.target.value) })} className={INPUT} /></Field>
        <Field label="Rewards per customer, ever"><input type="number" min="1" value={d.maxRewardsPerCustomer ?? ''} onChange={(e) => set({ maxRewardsPerCustomer: numOrNull(e.target.value) })} className={INPUT} /></Field>
        <Field label="'New' means added within (days)"><input type="number" min="1" value={d.newCustomerDays} onChange={(e) => set({ newCustomerDays: Number(e.target.value) || 30 })} className={INPUT} /></Field>
        <Field label="Starts"><input type="datetime-local" value={toLocalInput(d.startsAt)} onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })} className={INPUT} /></Field>
        <Field label="Ends"><input type="datetime-local" value={toLocalInput(d.endsAt)} onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })} className={INPUT} /></Field>
        <Field label="First purchase must include">
          <select value={d.productScope} onChange={(e) => set({ productScope: e.target.value as ProductScope })} className={INPUT}>
            <option value="all">Anything</option>
            <option value="products">Chosen products</option>
            <option value="categories">Chosen categories</option>
          </select>
        </Field>
      </div>
      {d.productScope === 'products' && <MultiPicker label="Products" options={cat.products} value={d.productIds} onChange={(ids) => set({ productIds: ids })} placeholder="Search products" />}
      {d.productScope === 'categories' && <MultiPicker label="Categories" options={cat.categories} value={d.categories} onChange={(ids) => set({ categories: ids })} placeholder="Search categories" />}
      {cat.branches.length > 0 && <MultiPicker label="Codes also work at these branches" options={cat.branches} value={d.branchIds} onChange={(ids) => set({ branchIds: ids })} placeholder="Search branches" />}
      <div className="rounded-xl bg-app-bg p-3 space-y-2.5">
        <Switch checked={d.excludeExisting} onChange={(v) => set({ excludeExisting: v })} label="Only customers added recently" description="Customers who have bought are always left out." />
        <Switch checked={d.requirePhone} onChange={(v) => set({ requirePhone: v })} label="New customer needs a phone number" description="Checked against every other customer, so one person can't come twice." />
        <Switch checked={d.reviewFlagged} onChange={(v) => set({ reviewFlagged: v })} label="A manager checks flagged referrals" description="Signs of a fake referral hold the rewards until someone approves." />
        <Switch checked={d.stackable} onChange={(v) => set({ stackable: v })} label="Can be combined with other discounts" />
      </div>
    </FormSheet>
  );
}

