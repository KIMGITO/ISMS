// src/features/PromotionsView.tsx
// Promotions & Points: one place for loyalty points, promotion codes (till and website) and the referral
// programme. Overview shows how codes did; Codes lists and edits codes; Referrals runs the
// programme, its review queue and costs. Every figure and rule comes from the database
// (services/promotions.ts); this screen never works out a discount itself.
// Built from the shared parts (Input, Choice, StatTile, FormSheet, GroupedTabs) so it matches the
// rest of the app; lists instead of tables so nothing scrolls sideways on a phone.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  BadgePercent, Plus, RefreshCw, Gift, AlertTriangle, Check, X, Archive, Power, Pencil, Ban, PauseCircle,
  PlayCircle, Sparkles, Percent, Banknote, ShoppingCart, PackagePlus, Users, UserPlus, Ticket, TrendingUp,
  Receipt, Coins, Wallet, LayoutGrid, Store, Globe, CalendarDays, Hourglass, ShieldCheck, Package, Tags,
  UserRound, ArrowRight, Infinity as InfinityIcon, Layers, Clock, Info, Undo2,
} from 'lucide-react';
import { useBusinessStore } from '../stores/businessStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useCustomerStore } from '../stores/customerStore';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useUiStore } from '../stores/uiStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { FormSheet, primaryBtn, secondaryBtn } from '../components/shared/FormSheet';
import { Switch } from '../components/shared/Switch';
import { Checkbox } from '../components/shared/Checkbox';
import { Field, TextInput, NumberInput, SearchInput, DateTimeInput } from '../components/shared/Input';
import { Segmented, ChoiceGrid, FilterChips, type ChoiceOption } from '../components/shared/Choice';
import { StatTile, StatGrid } from '../components/shared/StatTile';
import { GroupedTabs, type TabGroup } from '../components/TabOptions';
import SearchableDropdown from '../components/SearchableDropdown';
import AreaAdvisor from '../components/assistant/AreaAdvisor';
import { PointsReport } from '../components/loyalty/PointsReport';
import { PointsSettings, canConfigurePoints } from '../components/loyalty/PointsSettings';
import { usePointsEnabled } from '../services/loyalty/pointValue';
import { listBranches, type Branch } from '../services/buying';
import {
  listPromotions, savePromotion, setPromotionStatus, generatePromoCode, listPromotionUses, promotionDashboard,
  referralDashboard, saveReferralCampaign, endReferralCampaign, decideReferral, setReferralCodeStatus,
  PROMO_TYPES, PROMO_STATUS_LABEL, REFERRAL_STATUS_LABEL, REFERRAL_FLAG_LABEL,
  type Promotion, type PromotionDraft, type PromotionUse, type PromotionDashboard, type ReferralDashboard,
  type ReferralCampaignDraft, type PromoType, type RewardKind, type ProductScope, type ReferralRow,
} from '../services/promotions';

type Tab = 'overview' | 'promotions' | 'referrals' | 'points';

// ─────────────────────────────────────────────── small helpers
const ksh = (n: number | null | undefined) => `KSh ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`;
const ksh2 = (n: number | null | undefined) =>
  `KSh ${(Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const num = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('en-KE');
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const dayShort = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '';
const dayTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Colour = meaning, the same everywhere on this screen.
const TONE = {
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  sky: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  slate: 'bg-app-bg text-app-text-muted ring-1 ring-app-border',
};

/** One picture and colour per kind of promotion, used in the list, the detail and the editor. */
const TYPE_LOOK: Record<PromoType, { icon: React.ReactNode; tone: string; short: string }> = {
  percentage: { icon: <Percent />, tone: TONE.amber, short: '% off' },
  fixed: { icon: <Banknote />, tone: TONE.emerald, short: 'KSh off' },
  min_spend: { icon: <ShoppingCart />, tone: TONE.sky, short: 'Spend & save' },
  buy_x_get_y: { icon: <PackagePlus />, tone: TONE.violet, short: 'Buy X get Y' },
  free_product: { icon: <Gift />, tone: TONE.rose, short: 'Free item' },
  customer: { icon: <Users />, tone: TONE.sky, short: 'Chosen people' },
  first_purchase: { icon: <UserPlus />, tone: TONE.emerald, short: 'First buy' },
};

const REWARD_LOOK: ChoiceOption<RewardKind>[] = [
  { id: 'amount', label: 'KSh off', icon: <Banknote />, tone: TONE.emerald },
  { id: 'percent', label: '% off', icon: <Percent />, tone: TONE.amber },
  { id: 'wallet', label: 'Wallet', icon: <Wallet />, tone: TONE.sky },
  { id: 'free_product', label: 'Free item', icon: <Gift />, tone: TONE.rose },
  { id: 'points', label: 'Points', icon: <Coins />, tone: TONE.violet },
];

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  rewarded: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  redeemed: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  scheduled: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  qualified: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  reserved: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  partially_refunded: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  suspended: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  revoked: 'bg-red-500/12 text-red-700 dark:text-red-300',
  rejected: 'bg-red-500/12 text-red-700 dark:text-red-300',
};
function Chip({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STATUS_TONE[status] ?? 'bg-app-bg text-app-text-muted ring-1 ring-app-border'}`}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label ?? status.replace(/_/g, ' ')}
    </span>
  );
}

/** A small round icon in a colour. */
function Dot({ icon, tone, size = 'md' }: { icon: React.ReactNode; tone: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`grid place-items-center shrink-0 rounded-xl ${size === 'sm' ? 'size-8 [&>svg]:size-4' : 'size-10 [&>svg]:size-[18px]'} ${tone}`}>{icon}</span>
  );
}

/** A small grey fact with an icon: "Min KSh 300", "3-day wait". */
function Fact({ icon, children, tone }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium whitespace-nowrap [&>svg]:size-3 ${tone === 'warn' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-app-bg text-app-text-muted'}`}>
      {icon}
      {children}
    </span>
  );
}

const PERIODS: ChoiceOption<'7' | '30' | '90' | 'month'>[] = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'month', label: 'Month' },
];
type PeriodId = '7' | '30' | '90' | 'month';
function periodRange(p: PeriodId): { from: string; to: string } {
  const today = new Date();
  if (p === 'month') return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
  const from = new Date(today);
  from.setDate(from.getDate() - (Number(p) - 1));
  return { from: ymd(from), to: ymd(today) };
}

/** Period choice and a refresh button: the first row of Overview and Referrals. */
function PeriodBar({ value, onChange, onRefresh, loading }: { value: PeriodId; onChange: (p: PeriodId) => void; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Segmented options={PERIODS} value={value} onChange={onChange} ariaLabel="Period" className="flex-1 bg-app-card" />
      <button type="button" onClick={onRefresh} aria-label="Refresh" className="grid place-items-center size-11 sm:size-10 shrink-0 rounded-xl bg-app-card ring-1 ring-app-border text-app-text-muted hover:text-app-text cursor-pointer">
        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

/** A white card with a title row. */
function Card({ title, icon, action, children, className = '' }: { title?: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-app-card rounded-2xl shadow-xs min-w-0 overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2 min-w-0">
          {icon && <span className="shrink-0 text-app-text-muted [&>svg]:size-4">{icon}</span>}
          {title && <h3 className="text-sm font-semibold text-app-text truncate flex-1">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** One line of a ranked list: name on the left, the figure on the right, an optional share bar. */
function MetricRow({ lead, title, sub, value, valueSub, share, onClick }: {
  lead?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; value: React.ReactNode; valueSub?: React.ReactNode;
  /** 0–1: how big this row is next to the biggest. */
  share?: number; onClick?: () => void;
}) {
  const Comp: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={`w-full text-left flex items-center gap-3 px-4 py-2.5 min-w-0 ${onClick ? 'hover:bg-app-bg cursor-pointer' : ''}`}>
      {lead}
      <div className="min-w-0 flex-1">
        <div className="text-sm text-app-text truncate">{title}</div>
        {sub && <div className="text-[11px] text-app-text-muted truncate">{sub}</div>}
        {share != null && (
          <div className="mt-1.5 h-1 rounded-full bg-app-bg overflow-hidden">
            <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${Math.max(3, Math.min(100, share * 100))}%` }} />
          </div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold text-app-text tabular-nums">{value}</div>
        {valueSub && <div className="text-[11px] text-app-text-muted tabular-nums">{valueSub}</div>}
      </div>
    </Comp>
  );
}

function Empty({ icon, text, children }: { icon: React.ReactNode; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-4 py-6">
      <span className="grid place-items-center size-11 rounded-full bg-app-bg text-app-text-muted [&>svg]:size-5">{icon}</span>
      <p className="text-sm text-app-text-muted max-w-xs">{text}</p>
      {children}
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-sm px-3 py-2.5">
      <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {text}
    </p>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-label="Loading">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[92px] rounded-2xl bg-app-card" />)}
      </div>
      <div className="h-40 rounded-2xl bg-app-card" />
    </div>
  );
}

/** A heading inside a form sheet that splits it into short steps. */
function Group({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 min-w-0 pt-1">
      <legend className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-app-text-muted mb-2 [&>svg]:size-3.5">
        {icon} {title}
      </legend>
      {children}
    </fieldset>
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
    <Field label={<>{label}{value.length > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">· {value.length}</span>}</>} group>
      <div className="space-y-2">
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.map((id) => (
              <button key={id} type="button" onClick={() => toggle(id)} className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-200 pl-2.5 pr-1.5 py-1 text-xs font-medium cursor-pointer">
                {options.find((o) => o.id === id)?.name ?? 'Removed'} <X size={12} />
              </button>
            ))}
          </div>
        )}
        <SearchInput value={q} onChange={setQ} placeholder={placeholder} />
        <ul className="max-h-48 overflow-y-auto overscroll-contain rounded-xl ring-1 ring-app-border divide-y divide-app-border/60">
          {shown.length === 0 && <li className="px-3 py-3 text-xs text-app-text-muted">Nothing matches.</li>}
          {shown.map((o) => (
            <li key={o.id} className="px-3 py-2.5 flex items-center gap-2 hover:bg-app-bg">
              <Checkbox checked={chosen.has(o.id)} onChange={() => toggle(o.id)} label={o.name} className="flex-1 min-w-0" />
              {o.sub && <span className="text-[11px] text-app-text-muted truncate max-w-[40%]">{o.sub}</span>}
            </li>
          ))}
        </ul>
      </div>
    </Field>
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
        {canConfigure ? <PointsSettings businessId={businessId} /> : (
          <Card><Empty icon={<Coins />} text="Loyalty points are off. Ask a manager to switch them on." /></Card>
        )}
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

  // One tab per group: the app's segmented top row, equal parts that fit a 360px phone.
  const groups: TabGroup<Tab>[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutGrid size={14} />, tabs: seesPromos ? [{ id: 'overview', label: 'Overview' }] : [] },
    { id: 'promotions', label: 'Codes', icon: <Ticket size={14} />, tabs: seesPromos ? [{ id: 'promotions', label: 'Codes' }] : [] },
    { id: 'referrals', label: 'Referrals', icon: <Users size={14} />, shortcut: 'referrals', tabs: seesReferrals ? [{ id: 'referrals', label: 'Referrals' }] : [] },
    { id: 'points', label: 'Points', icon: <Coins size={14} />, shortcut: 'points', tabs: seesPoints ? [{ id: 'points', label: 'Points' }] : [] },
  ];

  if (!businessId) return null;
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-4xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <Dot icon={<BadgePercent />} tone={TONE.amber} size="sm" />
          <h2 className="text-base font-semibold text-app-text truncate">Promotions & Points</h2>
        </div>
        <GroupedTabs<Tab> groups={groups} activeTab={tab} onChange={setTab} />
        <AreaAdvisor area="rewards" />
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { from, to } = periodRange(period);
      setData(await promotionDashboard(businessId, from, to));
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the figures. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [businessId, period]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const t = data?.totals;
  const lift = data && data.withoutPromotion.avgNet > 0 && t && t.redemptions > 0 ? (t.avgNet / data.withoutPromotion.avgNet - 1) * 100 : null;
  const topUses = Math.max(1, ...(data?.byPromotion ?? []).map((p) => p.uses));
  const topDay = Math.max(1, ...(data?.byDay ?? []).map((d) => d.netSales));
  const best = useMemo(
    () => [...(data?.byPromotion ?? [])].filter((p) => p.netPerShilling != null).sort((a, b) => Number(b.netPerShilling) - Number(a.netPerShilling)).slice(0, 5),
    [data],
  );

  return (
    <div className="space-y-3">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={() => void load()} loading={loading} />
      {error && <ErrorNote text={error} />}
      {!data && !error && <Skeleton />}
      {data && t && (
        <>
          <StatGrid>
            <StatTile icon={<Ticket />} tone="amber" label="Codes used" value={num(t.redemptions)} note={`${num(t.customers)} customers`} />
            <StatTile icon={<BadgePercent />} tone="rose" label="Given off" value={ksh(t.discount)} note={t.grossSales > 0 ? `${((t.discount / t.grossSales) * 100).toFixed(1)}% of gross` : undefined} />
            <StatTile icon={<TrendingUp />} tone="emerald" label="Net sales" value={ksh(t.netSales)} note={`${ksh(t.grossSales)} gross`} />
            <StatTile
              icon={<Receipt />}
              tone="sky"
              label="Avg sale with code"
              value={ksh(t.avgNet)}
              note={lift != null ? `${lift >= 0 ? '+' : ''}${lift.toFixed(0)}% vs ${ksh(data.withoutPromotion.avgNet)}` : `${ksh(data.withoutPromotion.avgNet)} without`}
              trend={lift == null ? undefined : lift >= 0 ? 'up' : 'down'}
            />
          </StatGrid>

          <div className="flex flex-wrap gap-1.5">
            <Fact icon={<PlayCircle />}><b className="text-emerald-600 dark:text-emerald-400">{data.counts.active}</b> active</Fact>
            <Fact icon={<Clock />}><b className="text-sky-600 dark:text-sky-400">{data.counts.scheduled}</b> scheduled</Fact>
            <Fact icon={<Hourglass />}><b className="text-app-text">{data.counts.expired}</b> ended</Fact>
            <Fact icon={<Power />}><b className="text-app-text">{data.counts.off}</b> off</Fact>
            {data.refunds.count + data.refunds.partial > 0 && (
              <Fact icon={<Undo2 />} tone="warn">{data.refunds.count + data.refunds.partial} refunded · {ksh(data.refunds.amount)}</Fact>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Most used" icon={<Ticket />}>
              {data.byPromotion.length === 0 ? <Empty icon={<Ticket />} text="No code used in this period." /> : (
                <div className="divide-y divide-app-border/60 pb-1">
                  {data.byPromotion.slice(0, 10).map((p) => (
                    <MetricRow
                      key={p.promotionId ?? p.code}
                      title={<><span className="font-mono font-semibold">{p.code}</span> <span className="text-app-text-muted text-xs">{p.name}</span></>}
                      sub={`${num(p.uses)} uses · ${ksh(p.discount)} off`}
                      share={p.uses / topUses}
                      value={ksh(p.netSales)}
                    />
                  ))}
                </div>
              )}
            </Card>

            <Card title="Best return" icon={<TrendingUp />} action={<span className="text-[11px] text-app-text-muted">sales per KSh 1 off</span>}>
              {best.length === 0 ? <Empty icon={<TrendingUp />} text="Nothing yet." /> : (
                <div className="divide-y divide-app-border/60 pb-1">
                  {best.map((p, i) => (
                    <MetricRow
                      key={p.promotionId ?? p.code}
                      lead={<span className={`grid place-items-center size-7 shrink-0 rounded-full text-xs font-bold ${i === 0 ? TONE.emerald : TONE.slate}`}>{i + 1}</span>}
                      title={<span className="font-mono font-semibold">{p.code}</span>}
                      sub={`${num(p.uses)} uses · ${p.discountShare ?? 0}% of discounts`}
                      value={<span className="text-emerald-600 dark:text-emerald-400">KSh {Number(p.netPerShilling).toFixed(1)}</span>}
                    />
                  ))}
                </div>
              )}
            </Card>

            <Card title="By product" icon={<Package />} action={<span className="text-[11px] text-app-text-muted">till</span>}>
              {data.byProduct.length === 0 ? <Empty icon={<Package />} text="No product had a code discount." /> : (
                <div className="divide-y divide-app-border/60 pb-1">
                  {data.byProduct.slice(0, 15).map((p) => (
                    <MetricRow
                      key={p.productId ?? p.name}
                      title={p.name}
                      sub={`${num(p.quantity)} sold${p.category ? ` · ${p.category}` : ''}`}
                      value={ksh(p.net)}
                      valueSub={<span className="text-rose-600 dark:text-rose-400">−{ksh2(p.discount)}</span>}
                    />
                  ))}
                </div>
              )}
            </Card>

            <Card title="By day" icon={<CalendarDays />}>
              {data.byDay.length === 0 ? <Empty icon={<CalendarDays />} text="Nothing in this period." /> : (
                <div className="divide-y divide-app-border/60 pb-1 max-h-96 overflow-y-auto">
                  {[...data.byDay].reverse().map((d) => (
                    <MetricRow
                      key={d.date}
                      title={day(d.date)}
                      sub={`${num(d.uses)} uses · ${ksh(d.discount)} off`}
                      share={d.netSales / topDay}
                      value={ksh(d.netSales)}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-app-text-muted px-1">
            <Info size={12} className="shrink-0 mt-px" /> Sales that used a code, not extra sales it caused. Refunds left out.
          </p>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── codes list
type FilterId = 'live' | 'ended' | 'archived' | 'all';
const FILTERS: { id: FilterId; label: string; match: (p: Promotion) => boolean }[] = [
  { id: 'live', label: 'Live', match: (p) => p.status === 'active' || p.status === 'scheduled' },
  { id: 'ended', label: 'Ended & off', match: (p) => ['expired', 'used_up', 'off'].includes(p.status) },
  { id: 'archived', label: 'Archived', match: (p) => p.status === 'archived' },
  { id: 'all', label: 'All', match: () => true },
];

function PromotionsTab({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const [list, setList] = useState<Promotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>('live');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [opened, setOpened] = useState<Promotion | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await listPromotions(businessId));
    } catch (e) {
      setError(toUserMessage(e, 'Could not load promotions. Try again.'));
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
      <div className="flex items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search codes" className="flex-1 bg-app-card" />
        {canManage && (
          <button data-shortcut="new" onClick={() => setEditing('new')} className={`${primaryBtn} h-11 sm:h-10 shrink-0`} aria-label="New promotion">
            <Plus size={16} /> <span>New</span>
          </button>
        )}
      </div>
      <FilterChips<FilterId>
        ariaLabel="Show"
        options={FILTERS.map((x) => ({ id: x.id, label: x.label, count: (list ?? []).filter(x.match).length }))}
        value={filter}
        onChange={setFilter}
      />
      {error && <ErrorNote text={error} />}
      {!list && !error && <div className="h-48 rounded-2xl bg-app-card animate-pulse" />}
      {list && (
        <Card>
          {shown.length === 0 ? (
            <Empty icon={<Ticket />} text={list.length === 0 ? 'No promotions yet. Make a code and give it to customers.' : 'None here.'}>
              {list.length === 0 && canManage && <button onClick={() => setEditing('new')} className={primaryBtn}><Plus size={15} /> New promotion</button>}
            </Empty>
          ) : (
            <ul className="divide-y divide-app-border/60">
              {shown.map((p) => <PromotionRow key={p.id} p={p} onOpen={() => setOpened(p)} />)}
            </ul>
          )}
        </Card>
      )}
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

function PromotionRow({ p, onOpen }: { p: Promotion; onOpen: () => void }) {
  const look = TYPE_LOOK[p.promoType] ?? TYPE_LOOK.percentage;
  const usedShare = p.maxUses ? Math.min(1, p.uses / p.maxUses) : null;
  return (
    <li>
      <button onClick={onOpen} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-app-bg cursor-pointer min-w-0">
        <Dot icon={look.icon} tone={look.tone} />
        <div className="min-w-0 flex-1">
          <p className="font-mono font-bold text-app-text truncate">{p.code}</p>
          <p className="text-[13px] text-app-text-muted truncate">{p.summary || p.name}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-app-text-muted whitespace-nowrap overflow-hidden [&>span]:shrink-0">
            <Chip status={p.status} label={PROMO_STATUS_LABEL[p.status]} />
            {p.usePos && <span className="inline-flex items-center gap-1"><Store size={11} /> Till</span>}
            {p.useOnline && <span className="inline-flex items-center gap-1"><Globe size={11} /> Online</span>}
            {p.status === 'scheduled' && p.startsAt ? (
              <span className="inline-flex items-center gap-1"><Clock size={11} /> {dayShort(p.startsAt)}</span>
            ) : p.endsAt ? (
              <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> {dayShort(p.endsAt)}</span>
            ) : null}
            {!p.ownBranch && <span className="inline-flex items-center" title="From another branch"><Layers size={11} /></span>}
          </div>
        </div>
        <div className="text-right shrink-0 w-20">
          <p className="text-sm font-semibold text-app-text tabular-nums">
            {num(p.uses)}<span className="text-app-text-muted font-normal">{p.maxUses ? `/${num(p.maxUses)}` : ''}</span>
          </p>
          {usedShare != null && (
            <div className="mt-1 h-1 rounded-full bg-app-bg overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${Math.max(4, usedShare * 100)}%` }} /></div>
          )}
          <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400 tabular-nums">−{ksh(p.discountGiven)}</p>
        </div>
      </button>
    </li>
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
  const look = TYPE_LOOK[p.promoType] ?? TYPE_LOOK.percentage;
  const facts: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <CalendarDays />, label: 'When', value: `${p.startsAt ? day(p.startsAt) : 'Now'} – ${p.endsAt ? day(p.endsAt) : 'no end'}` },
    { icon: <Users />, label: 'Who', value: `${p.audience === 'selected' ? `${p.customerIds.length} chosen customers` : p.audience === 'first_purchase' ? 'New customers' : 'Everyone'}${p.oncePerCustomer ? ', once each' : ''}` },
    { icon: <Package />, label: 'Covers', value: p.productScope === 'all' ? 'All products' : p.productScope === 'products' ? `${p.productIds.length} products` : p.categories.join(', ') },
    ...(p.minOrder > 0 ? [{ icon: <ShoppingCart />, label: 'Minimum', value: ksh(p.minOrder) }] : []),
    ...(p.maxDiscount != null ? [{ icon: <BadgePercent />, label: 'Most off', value: ksh(p.maxDiscount) }] : []),
    { icon: <Layers />, label: 'With other discounts', value: p.stackable ? 'Yes' : 'No' },
  ];
  return (
    <FormSheet
      title={p.code}
      subtitle={p.name}
      onClose={onClose}
      wide
      footer={canManage ? (
        archived ? (
          <button disabled={busy} onClick={() => void act('restore', 'Promotion restored (still off).')} className={`${secondaryBtn} flex-1 sm:flex-none`}><Archive size={15} /> Restore</button>
        ) : confirmArchive ? (
          <>
            <p className="w-full text-xs text-app-text-muted">The code stops working; its history is kept.</p>
            <button onClick={() => setConfirmArchive(false)} className={`${secondaryBtn} flex-1 sm:flex-none`}>Keep</button>
            <button disabled={busy} onClick={() => void act('archive', 'Promotion archived.')} className={`${secondaryBtn} flex-1 sm:flex-none text-red-600 dark:text-red-400`}><Archive size={15} /> Archive</button>
          </>
        ) : (
          <>
            <button onClick={() => setConfirmArchive(true)} className={secondaryBtn} aria-label="Archive"><Archive size={15} /></button>
            <button disabled={busy} onClick={() => void act(p.active ? 'deactivate' : 'activate', p.active ? 'Promotion switched off.' : 'Promotion switched on.')} className={`${secondaryBtn} flex-1 sm:flex-none whitespace-nowrap`}>
              <Power size={15} /> {p.active ? 'Switch off' : 'Switch on'}
            </button>
            <button onClick={onEdit} className={`${primaryBtn} flex-1 sm:flex-none`}><Pencil size={15} /> Edit</button>
          </>
        )
      ) : undefined}
    >
      <div className="flex items-center gap-3">
        <Dot icon={look.icon} tone={look.tone} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-app-text">{p.summary}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip status={p.status} label={PROMO_STATUS_LABEL[p.status]} />
            {p.usePos && <Fact icon={<Store />}>Till</Fact>}
            {p.useOnline && <Fact icon={<Globe />}>Online</Fact>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatTile inset icon={<Ticket />} tone="amber" label="Used" value={`${num(p.uses)}${p.maxUses ? ` / ${num(p.maxUses)}` : ''}`} note={p.held ? `${p.held} held at a till` : undefined} />
        <StatTile inset icon={<BadgePercent />} tone="rose" label="Given off" value={ksh(p.discountGiven)} />
      </div>
      {p.description && <p className="text-sm text-app-text-muted">{p.description}</p>}
      <ul className="rounded-xl ring-1 ring-app-border divide-y divide-app-border/60">
        {facts.map((f) => (
          <li key={f.label} className="flex items-center gap-3 px-3 py-2.5 text-sm min-w-0">
            <span className="shrink-0 text-app-text-muted [&>svg]:size-4">{f.icon}</span>
            <span className="text-app-text-muted shrink-0">{f.label}</span>
            <span className="ml-auto text-right text-app-text font-medium truncate">{f.value}</span>
          </li>
        ))}
      </ul>
      <div>
        <p className="text-xs font-semibold text-app-text-muted mb-1.5">Uses</p>
        {!uses && <div className="h-16 rounded-xl bg-app-bg animate-pulse" />}
        {uses && uses.length === 0 && <p className="text-sm text-app-text-muted rounded-xl bg-app-bg px-3 py-3">Not used yet.</p>}
        {uses && uses.length > 0 && (
          <ul className="divide-y divide-app-border/60 rounded-xl ring-1 ring-app-border">
            {uses.map((u) => (
              <li key={u.id} className="px-3 py-2.5 flex items-center gap-3 text-sm min-w-0">
                <Dot size="sm" icon={u.channel === 'pos' ? <Store /> : <Globe />} tone={u.channel === 'pos' ? TONE.amber : TONE.sky} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-app-text">{u.customer ?? 'Walk-in'}</p>
                  <p className="text-[11px] text-app-text-muted truncate">
                    {dayTime(u.at)}{u.staff ? ` · ${u.staff}` : ''}{u.receipt ? ` · ${u.receipt}` : u.order ? ` · Order ${u.order}` : ''}{u.branch ? ` · ${u.branch}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="tabular-nums font-semibold text-rose-600 dark:text-rose-400">−{ksh2(u.discount)}</p>
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

const SCOPE_OPTIONS = (allLabel: string): ChoiceOption<ProductScope>[] => [
  { id: 'all', label: allLabel, icon: <LayoutGrid /> },
  { id: 'products', label: 'Items', icon: <Package /> },
  { id: 'categories', label: 'Groups', icon: <Tags /> },
];
const AUDIENCE_OPTIONS: ChoiceOption<'everyone' | 'selected' | 'first_purchase'>[] = [
  { id: 'everyone', label: 'Anyone', icon: <Globe /> },
  { id: 'selected', label: 'Chosen', icon: <Users /> },
  { id: 'first_purchase', label: 'New', icon: <UserPlus /> },
];

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
  const typeHint = PROMO_TYPES.find((x) => x.id === t)?.hint;

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
      onClose={onClose}
      wide
      footer={
        <>
          {error && <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button onClick={onClose} className={`${secondaryBtn} flex-1 sm:flex-none`}>Cancel</button>
          <button disabled={saving} onClick={() => void save()} className={`${primaryBtn} flex-1 sm:flex-none`}><Check size={15} /> {saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <Group title="Type" icon={<BadgePercent />}>
        <ChoiceGrid
          ariaLabel="Type"
          columns="grid-cols-2 sm:grid-cols-4"
          options={PROMO_TYPES.map((pt) => ({ id: pt.id, label: TYPE_LOOK[pt.id].short, icon: TYPE_LOOK[pt.id].icon, tone: TYPE_LOOK[pt.id].tone }))}
          value={t}
          onChange={(v) => set({ promoType: v })}
        />
        {typeHint && <p className="flex items-center gap-1.5 text-[11px] text-app-text-muted"><Info size={12} /> {typeHint}</p>}
      </Group>

      <Group title="Code" icon={<Ticket />}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <TextInput
              value={d.code}
              onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s/g, '') })}
              placeholder="MILK10"
              maxLength={24}
              inputClassName="font-mono uppercase font-semibold tracking-wide"
              suffix={
                <button type="button" onClick={() => void generate()} aria-label="Make a random code" title="Make a random code" className="grid place-items-center size-7 -mr-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer">
                  <Sparkles size={15} />
                </button>
              }
            />
          </Field>
          <Field label="Name"><TextInput value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Milk week" maxLength={80} /></Field>
        </div>
        <Field label="Note (optional)"><TextInput value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} maxLength={500} placeholder="Shown with the code" /></Field>
      </Group>

      <Group title="Discount" icon={<Percent />}>
        {choosesKind && (
          <Segmented
            ariaLabel="Gives"
            options={[{ id: 'percent', label: '% off', icon: <Percent /> }, { id: 'amount', label: 'KSh off', icon: <Banknote /> }]}
            value={kind === 'amount' ? 'amount' : 'percent'}
            onChange={(v) => set({ kind: v })}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          {!freeItems && (
            <Field label="Discount">
              {kind === 'percent'
                ? <NumberInput suffix="%" min={0} max={100} value={d.value || null} onChange={(v) => set({ value: v ?? 0 })} placeholder="10" />
                : <NumberInput prefix="KSh" min={0} value={d.value || null} onChange={(v) => set({ value: v ?? 0 })} placeholder="100" />}
            </Field>
          )}
          {t === 'buy_x_get_y' && (
            <Field label="Buys">
              <NumberInput suffix="items" min={1} decimals={0} value={d.buyQty} onChange={(v) => set({ buyQty: v })} placeholder="2" />
            </Field>
          )}
          {freeItems && (
            <Field label="Gets free">
              <NumberInput suffix="free" min={1} decimals={0} value={d.rewardQty} onChange={(v) => set({ rewardQty: v })} placeholder="1" />
            </Field>
          )}
          <Field label={t === 'min_spend' ? 'Spend at least' : 'Min. purchase'}>
            <NumberInput prefix="KSh" min={0} value={d.minOrder || null} onChange={(v) => set({ minOrder: v ?? 0 })} placeholder="0" />
          </Field>
          {kind === 'percent' && (
            <Field label="Cap (optional)">
              <NumberInput prefix="KSh" min={0} value={d.maxDiscount} onChange={(v) => set({ maxDiscount: v })} placeholder="No cap" />
            </Field>
          )}
        </div>
        {freeItems && (
          <Field label="Free product" group hint="Add it to the cart; the code takes its price off.">
            <SearchableDropdown
              items={cat.products.map((p) => ({ id: p.id, label: p.name, sublabel: p.sub }))}
              selectedValue={d.rewardProductId ?? ''}
              onChange={(v) => set({ rewardProductId: v || null })}
              placeholder="Choose a product"
              searchPlaceholder="Search products"
            />
          </Field>
        )}
      </Group>

      <Group title="Who & what" icon={<Users />}>
        <Field label="Covers" group>
          <Segmented ariaLabel="Covers" options={SCOPE_OPTIONS('All')} value={d.productScope} onChange={(v) => set({ productScope: v })} />
        </Field>
        {d.productScope === 'products' && (
          <MultiPicker label={t === 'buy_x_get_y' ? 'Products to buy' : 'Products'} options={cat.products} value={d.productIds} onChange={(ids) => set({ productIds: ids })} placeholder="Search products" />
        )}
        {d.productScope === 'categories' && (
          <MultiPicker label="Categories" options={cat.categories} value={d.categories} onChange={(ids) => set({ categories: ids })} placeholder="Search categories" />
        )}
        {!audienceFixed && (
          <Field label="Who can use it" group>
            <Segmented ariaLabel="Who can use it" options={AUDIENCE_OPTIONS} value={d.audience} onChange={(v) => set({ audience: v })} />
          </Field>
        )}
        {audience === 'selected' && (
          <MultiPicker label="Customers" options={cat.customers} value={d.customerIds} onChange={(ids) => set({ customerIds: ids })} placeholder="Search name or phone" />
        )}
      </Group>

      <Group title="When" icon={<CalendarDays />}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Starts"><DateTimeInput value={d.startsAt} onChange={(v) => set({ startsAt: v })} /></Field>
          <Field label="Ends"><DateTimeInput value={d.endsAt} onChange={(v) => set({ endsAt: v })} /></Field>
          <Field label="Total uses">
            <NumberInput min={1} decimals={0} value={d.maxUses} onChange={(v) => set({ maxUses: v })} placeholder="No limit" suffix={d.maxUses ? 'uses' : <InfinityIcon size={14} />} />
          </Field>
        </div>
      </Group>

      <Group title="Rules" icon={<ShieldCheck />}>
        <div className="rounded-xl bg-app-bg p-3 space-y-3">
          <Switch checked={d.usePos} onChange={(v) => set({ usePos: v })} label={<span className="inline-flex items-center gap-1.5"><Store size={13} /> At the till</span>} />
          <Switch checked={d.useOnline && onlineOk} disabled={!onlineOk} onChange={(v) => set({ useOnline: v })} label={<span className="inline-flex items-center gap-1.5"><Globe size={13} /> Online shop</span>}
            description={onlineOk ? undefined : 'Only % or KSh off, for anyone, on all products.'} />
          {d.useOnline && onlineOk && <Switch checked={d.showOnWebsite} onChange={(v) => set({ showOnWebsite: v })} label="Show on the website" />}
          <Switch checked={d.oncePerCustomer} onChange={(v) => set({ oncePerCustomer: v })} label="Once per customer" description="Cashier picks the customer." />
          <Switch checked={d.stackable} onChange={(v) => set({ stackable: v })} label="Combine with other discounts" />
          {!promotion && <Switch checked={d.active} onChange={(v) => set({ active: v })} label="Switch on when saved" />}
        </div>
        {cat.branches.length > 0 && (
          <MultiPicker label="Also at branches" options={cat.branches} value={d.branchIds} onChange={(ids) => set({ branchIds: ids })} placeholder="Search branches" />
        )}
      </Group>
    </FormSheet>
  );
}

// ─────────────────────────────────────────────── referrals
function ReferralsTab({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [period, setPeriod] = useState<PeriodId>('30');
  const [data, setData] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null);
  const [deciding, setDeciding] = useState<{ row: ReferralRow; approve: boolean } | null>(null);
  const [holding, setHolding] = useState<{ codeId: string; name: string; status: 'suspended' | 'revoked' } | null>(null);
  const [view, setView] = useState<'review' | 'all'>('review');
  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { from, to } = periodRange(period);
      setData(await referralDashboard(businessId, from, to));
    } catch (e) {
      setError(toUserMessage(e, 'Could not load referrals. Try again.'));
    } finally {
      setLoading(false);
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
      {error && <ErrorNote text={error} />}
      {!data && !error && <Skeleton />}
      {data && (
        <>
          <ProgrammeCard campaign={k} canManage={canManage} onEdit={() => setEditing('edit')} onNew={() => setEditing('new')} />

          <PeriodBar value={period} onChange={setPeriod} onRefresh={() => void load()} loading={loading} />

          <StatGrid>
            <StatTile icon={<Users />} tone="sky" label="Referrals" value={num(data.counts.total)} note={`${num(data.counts.rewarded)} rewarded`} />
            <StatTile
              icon={<Hourglass />}
              tone={data.counts.flagged ? 'red' : 'amber'}
              label="Waiting"
              value={num(data.counts.qualified + data.counts.pending)}
              note={data.counts.flagged ? `${data.counts.flagged} flagged` : 'none flagged'}
              trend={data.counts.flagged ? 'down' : undefined}
            />
            <StatTile icon={<Wallet />} tone="rose" label="Rewards cost" value={ksh(data.costs.total)} note={`${ksh(data.costs.wallet)} wallet`} />
            <StatTile icon={<TrendingUp />} tone="emerald" label="New customers bought" value={ksh(data.referredSales)} note={`${ksh(data.counts.firstPurchases)} first buys`} />
          </StatGrid>

          {(data.costs.points > 0 || data.costs.rewardCodesOpen > 0 || data.costs.takenBack > 0 || data.counts.cancelled + data.counts.rejected > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {data.costs.points > 0 && <Fact icon={<Coins />}>{num(data.costs.points)} pts given</Fact>}
              {data.costs.rewardCodesOpen > 0 && <Fact icon={<Ticket />}>{data.costs.rewardCodesOpen} codes unused</Fact>}
              {data.costs.takenBack > 0 && <Fact icon={<Undo2 />}>{ksh(data.costs.takenBack)} taken back</Fact>}
              {data.counts.cancelled + data.counts.rejected > 0 && <Fact icon={<Ban />} tone="warn">{data.counts.cancelled} cancelled · {data.counts.rejected} refused</Fact>}
            </div>
          )}

          <Card
            title="Referrals"
            icon={<Users />}
            action={
              <Segmented<'review' | 'all'>
                size="sm"
                ariaLabel="Show"
                className="w-44 shrink-0"
                options={[{ id: 'review', label: 'To check', count: review.length }, { id: 'all', label: 'All' }]}
                value={view}
                onChange={setView}
              />
            }
          >
            {rows.length === 0 ? (
              <Empty icon={view === 'review' ? <Check /> : <Users />} text={view === 'review' ? 'Nothing to check.' : 'No referrals in this period.'} />
            ) : (
              <ul className="divide-y divide-app-border/60">
                {rows.map((r) => (
                  <ReferralItem key={r.id} r={r} canManage={canManage} onDecide={(approve) => setDeciding({ row: r, approve })} />
                ))}
              </ul>
            )}
          </Card>

          <Card title="Top referrers" icon={<TrendingUp />}>
            {data.topReferrers.length === 0 ? <Empty icon={<UserRound />} text="No referrals in this period." /> : (
              <ul className="divide-y divide-app-border/60">
                {data.topReferrers.map((t, i) => (
                  <li key={t.codeId ?? t.customerId} className="flex items-center gap-3 px-4 py-2.5 min-w-0">
                    <span className={`grid place-items-center size-8 shrink-0 rounded-full text-xs font-bold ${i === 0 ? TONE.amber : TONE.slate}`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm text-app-text min-w-0">
                        <span className="truncate font-medium">{t.name}</span>
                        {t.codeStatus !== 'active' && <Chip status={t.codeStatus} />}
                        <span className="ml-auto pl-2 shrink-0 font-semibold tabular-nums">{ksh(t.cost)}</span>
                      </p>
                      <p className="text-[11px] text-app-text-muted truncate">
                        <span className="font-mono">{t.code}</span> · {t.referrals} in · {t.rewarded} paid
                        {t.flagged ? <span className="text-red-600 dark:text-red-400"> · {t.flagged} flagged</span> : ''}
                      </p>
                    </div>
                    {canManage && t.codeId && (
                      t.codeStatus === 'active' ? (
                        <span className="inline-flex shrink-0 -mr-2">
                          <button onClick={() => setHolding({ codeId: t.codeId, name: t.name, status: 'suspended' })} className="grid place-items-center size-9 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer" title="Hold this code" aria-label={`Hold ${t.name}'s code`}><PauseCircle size={17} /></button>
                          <button onClick={() => setHolding({ codeId: t.codeId, name: t.name, status: 'revoked' })} className="grid place-items-center size-9 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer" title="Revoke this code" aria-label={`Revoke ${t.name}'s code`}><Ban size={17} /></button>
                        </span>
                      ) : t.codeStatus === 'suspended' ? (
                        <button onClick={() => void restore(t.codeId)} className="grid place-items-center size-9 -mr-2 shrink-0 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer" title="Let this code work again" aria-label={`Let ${t.name}'s code work again`}><PlayCircle size={17} /></button>
                      ) : null
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
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

/** The running programme at a glance: who gets what, and its rules as small facts. */
function ProgrammeCard({ campaign: k, canManage, onEdit, onNew }: {
  campaign: ReferralDashboard['campaign']; canManage: boolean; onEdit: () => void; onNew: () => void;
}) {
  if (!k) {
    return (
      <Card>
        <Empty icon={<Gift />} text="No referral programme. Customers share a code; both sides get a reward after the first purchase.">
          {canManage && <button onClick={onNew} className={`${primaryBtn} mt-1`}><Plus size={15} /> Start a programme</button>}
        </Empty>
      </Card>
    );
  }
  const minBuy = Number(k.welcome?.minPurchase) || 0;
  return (
    <Card>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <Dot icon={<Gift />} tone={TONE.emerald} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-app-text truncate">{k.name}</p>
            <Chip status="active" label="Running" />
          </div>
          {canManage && (
            <div className="flex gap-1.5 shrink-0">
              <button onClick={onEdit} className={`${secondaryBtn} px-3`} aria-label="Change programme"><Pencil size={15} /><span className="hidden sm:inline">Change</span></button>
              <button onClick={onNew} className={`${secondaryBtn} px-3`} aria-label="New programme"><Plus size={15} /><span className="hidden sm:inline">New</span></button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <div className="rounded-xl bg-amber-500/10 p-3 min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"><UserRound size={12} /> Referrer gets</p>
            <p className="mt-1 text-sm font-bold text-app-text break-words">{k.referrerText}</p>
          </div>
          <span className="self-center text-app-text-muted"><ArrowRight size={16} /></span>
          <div className="rounded-xl bg-emerald-500/10 p-3 min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"><UserPlus size={12} /> New customer gets</p>
            <p className="mt-1 text-sm font-bold text-app-text break-words">{k.welcomeText}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {minBuy > 0 && <Fact icon={<ShoppingCart />}>First buy {ksh(minBuy)}+</Fact>}
          <Fact icon={<Hourglass />}>{k.hold_days}-day wait</Fact>
          {k.review_flagged && <Fact icon={<ShieldCheck />}>Flagged checked</Fact>}
          {k.ends_at && <Fact icon={<CalendarDays />}>Ends {dayShort(k.ends_at)}</Fact>}
        </div>
      </div>
    </Card>
  );
}

function ReferralItem({ r, canManage, onDecide }: { r: ReferralRow; canManage: boolean; onDecide: (approve: boolean) => void }) {
  const due = r.status === 'qualified' && r.rewardDueAt ? (new Date(r.rewardDueAt) > new Date() ? `Rewards ${dayShort(r.rewardDueAt)}` : 'Rewards due') : null;
  return (
    <li className="px-4 py-3 space-y-1.5 min-w-0">
      <div className="flex items-start gap-2 min-w-0">
        <p className="min-w-0 flex-1 flex items-center gap-1.5 text-sm text-app-text">
          <span className="truncate font-semibold">{r.referrer}</span>
          <ArrowRight size={13} className="shrink-0 text-app-text-muted" />
          <span className="truncate font-semibold">{r.referred}</span>
        </p>
        <Chip status={r.status} label={REFERRAL_STATUS_LABEL[r.status]} />
      </div>
      <p className="text-[11px] text-app-text-muted truncate">
        {dayTime(r.at)} · <span className="font-mono">{r.code}</span>
        {r.purchase != null ? ` · bought ${ksh(r.purchase)}` : ''}{r.receipt ? ` · ${r.receipt}` : ''}{r.staff ? ` · ${r.staff}` : ''}
        {r.endReason ? ` · ${r.endReason}` : ''}
      </p>
      {(r.flags.length > 0 || due || r.rewards.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {r.flags.map((f) => <Fact key={f} icon={<AlertTriangle />} tone="warn">{REFERRAL_FLAG_LABEL[f] ?? f}</Fact>)}
          {due && <Fact icon={<Clock />}>{due}</Fact>}
          {r.rewards.map((w, i) => (
            <Fact key={i} icon={w.side === 'referrer' ? <UserRound /> : <UserPlus />}>{w.what} · {w.status}</Fact>
          ))}
        </div>
      )}
      {canManage && r.status === 'qualified' && (
        <div className="flex gap-2 pt-1">
          <button onClick={() => onDecide(false)} className={`${secondaryBtn} flex-1 sm:flex-none py-2 text-red-600 dark:text-red-400`}><X size={15} /> Refuse</button>
          <button onClick={() => onDecide(true)} className={`${primaryBtn} flex-1 sm:flex-none py-2`}><Check size={15} /> Give rewards</button>
        </div>
      )}
    </li>
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
        <>
          {error && <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button onClick={onClose} className={`${secondaryBtn} flex-1 sm:flex-none`}>Back</button>
          <button disabled={busy || (!approve && !reason.trim())} onClick={() => void go()} className={`${approve ? primaryBtn : `${secondaryBtn} text-red-600 dark:text-red-400`} flex-1 sm:flex-none`}>
            {approve ? <><Check size={15} /> Give rewards</> : <><X size={15} /> Refuse</>}
          </button>
        </>
      }
    >
      {row.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{row.flags.map((f) => <Fact key={f} icon={<AlertTriangle />} tone="warn">{REFERRAL_FLAG_LABEL[f] ?? f}</Fact>)}</div>
      )}
      <p className="text-sm text-app-text-muted">
        {approve ? 'Both sides get their rewards now. Recorded with your name.' : 'Neither side gets a reward. A welcome discount already taken stays. Recorded with your name.'}
      </p>
      {!approve && <Field label="Why"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Same household" autoFocus /></Field>}
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
      subtitle={status === 'suspended' ? 'No referrals or rewards until it works again.' : 'For good. A new code can be given later.'}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button onClick={onClose} className={`${secondaryBtn} flex-1 sm:flex-none`}>Back</button>
          <button disabled={!reason.trim()} onClick={() => void go()} className={`${secondaryBtn} flex-1 sm:flex-none text-red-600 dark:text-red-400`}>
            {status === 'suspended' ? <><PauseCircle size={15} /> Hold</> : <><Ban size={15} /> Revoke</>}
          </button>
        </>
      }
    >
      <Field label="Why"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Looks like fake accounts" autoFocus /></Field>
    </FormSheet>
  );
}

function RewardFields({ who, icon, tone, kind, value, productId, qty, onChange, products }: {
  who: string; icon: React.ReactNode; tone: string; kind: RewardKind; value: number | null; productId: string | null; qty: number | null;
  onChange: (patch: { kind?: RewardKind; value?: number | null; productId?: string | null; qty?: number | null }) => void;
  products: { id: string; name: string; sub?: string }[];
}) {
  return (
    <div className="rounded-2xl ring-1 ring-app-border p-3 space-y-3 min-w-0">
      <p className="flex items-center gap-2 text-sm font-semibold text-app-text">
        <span className={`grid place-items-center size-7 rounded-lg [&>svg]:size-4 ${tone}`}>{icon}</span> {who}
      </p>
      <ChoiceGrid ariaLabel={`${who}: reward`} compact columns="grid-cols-5" options={REWARD_LOOK} value={kind} onChange={(k) => onChange({ kind: k })} />
      {kind === 'free_product' ? (
        <div className="grid grid-cols-[1fr_6.5rem] gap-2">
          <Field label="Product" group>
            <SearchableDropdown
              items={products.map((p) => ({ id: p.id, label: p.name, sublabel: p.sub }))}
              selectedValue={productId ?? ''}
              onChange={(v) => onChange({ productId: v || null })}
              placeholder="Choose"
              searchPlaceholder="Search products"
            />
          </Field>
          <Field label="How many"><NumberInput min={1} decimals={0} value={qty} onChange={(v) => onChange({ qty: v })} placeholder="1" /></Field>
        </div>
      ) : (
        <Field label={kind === 'wallet' ? 'Wallet credit' : kind === 'points' ? 'Points' : 'Off'}>
          {kind === 'percent'
            ? <NumberInput suffix="%" min={0} max={100} value={value} onChange={(v) => onChange({ value: v })} placeholder="10" />
            : kind === 'points'
              ? <NumberInput suffix="pts" min={0} decimals={0} value={value} onChange={(v) => onChange({ value: v })} placeholder="500" />
              : <NumberInput prefix="KSh" min={0} value={value} onChange={(v) => onChange({ value: v })} placeholder="100" />}
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
  const welcomePercent = d.welcomeKind === 'percent';
  return (
    <FormSheet
      title={campaign ? `Change ${campaign.name}` : 'New referral programme'}
      subtitle={campaign ? undefined : 'Replaces the one running at this branch.'}
      onClose={onClose}
      wide
      footer={
        <>
          {error && <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}
          {campaign && (confirmEnd
            ? <button onClick={() => void end()} className={`${secondaryBtn} w-full sm:w-auto sm:mr-auto text-red-600 dark:text-red-400`}><Ban size={15} /> Yes, end it</button>
            : <button onClick={() => setConfirmEnd(true)} className={`${secondaryBtn} w-full sm:w-auto sm:mr-auto text-red-600 dark:text-red-400`}><Ban size={15} /> End programme</button>)}
          <button onClick={onClose} className={`${secondaryBtn} flex-1 sm:flex-none`}>Cancel</button>
          <button disabled={saving} onClick={() => void save()} className={`${primaryBtn} flex-1 sm:flex-none`}><Check size={15} /> {saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <Field label="Name"><TextInput value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} /></Field>

      <Group title="Rewards" icon={<Gift />}>
        <div className="grid sm:grid-cols-2 gap-3">
          <RewardFields who="Referrer gets" icon={<UserRound />} tone={TONE.amber} kind={d.referrerKind} value={d.referrerValue} productId={d.referrerProductId} qty={d.referrerQty} products={cat.products}
            onChange={(p) => set({ ...(p.kind ? { referrerKind: p.kind } : {}), ...('value' in p ? { referrerValue: p.value ?? null } : {}), ...('productId' in p ? { referrerProductId: p.productId ?? null } : {}), ...('qty' in p ? { referrerQty: p.qty ?? null } : {}) })} />
          <RewardFields who="New customer gets" icon={<UserPlus />} tone={TONE.emerald} kind={d.welcomeKind} value={d.welcomeValue} productId={d.welcomeProductId} qty={d.welcomeQty} products={cat.products}
            onChange={(p) => set({ ...(p.kind ? { welcomeKind: p.kind } : {}), ...('value' in p ? { welcomeValue: p.value ?? null } : {}), ...('productId' in p ? { welcomeProductId: p.productId ?? null } : {}), ...('qty' in p ? { welcomeQty: p.qty ?? null } : {}) })} />
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-app-text-muted">
          <Info size={12} className="shrink-0 mt-px" /> New customer's discount comes off the first sale. Wallet and points arrive after the wait. The referrer's discount becomes a code for next time.
        </p>
      </Group>

      <Group title="First purchase" icon={<ShoppingCart />}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="At least"><NumberInput prefix="KSh" min={0} value={d.minPurchase || null} onChange={(v) => set({ minPurchase: v ?? 0 })} placeholder="0" /></Field>
          {welcomePercent && <Field label="Cap"><NumberInput prefix="KSh" min={0} value={d.maxDiscount} onChange={(v) => set({ maxDiscount: v })} placeholder="No cap" /></Field>}
        </div>
        <Field label="Must include" group>
          <Segmented ariaLabel="Must include" options={SCOPE_OPTIONS('Anything')} value={d.productScope} onChange={(v) => set({ productScope: v })} />
        </Field>
        {d.productScope === 'products' && <MultiPicker label="Products" options={cat.products} value={d.productIds} onChange={(ids) => set({ productIds: ids })} placeholder="Search products" />}
        {d.productScope === 'categories' && <MultiPicker label="Categories" options={cat.categories} value={d.categories} onChange={(ids) => set({ categories: ids })} placeholder="Search categories" />}
      </Group>

      <Group title="Timing" icon={<Clock />}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Wait before rewards" hint="Covers refunds"><NumberInput suffix="days" min={0} max={60} decimals={0} value={d.holdDays} onChange={(v) => set({ holdDays: v ?? 0 })} /></Field>
          <Field label="Reward codes last"><NumberInput suffix={d.rewardExpiryDays ? 'days' : <InfinityIcon size={14} />} min={1} decimals={0} value={d.rewardExpiryDays} onChange={(v) => set({ rewardExpiryDays: v })} placeholder="No end" /></Field>
          <Field label="Starts"><DateTimeInput value={d.startsAt} onChange={(v) => set({ startsAt: v })} /></Field>
          <Field label="Ends"><DateTimeInput value={d.endsAt} onChange={(v) => set({ endsAt: v })} /></Field>
        </div>
      </Group>

      <Group title="Limits" icon={<ShieldCheck />}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Per referrer"><NumberInput min={1} decimals={0} value={d.maxPerReferrer} onChange={(v) => set({ maxPerReferrer: v })} placeholder="No limit" suffix="people" /></Field>
          <Field label="In total"><NumberInput min={1} decimals={0} value={d.maxTotal} onChange={(v) => set({ maxTotal: v })} placeholder="No limit" /></Field>
          <Field label="Rewards per customer"><NumberInput min={1} decimals={0} value={d.maxRewardsPerCustomer} onChange={(v) => set({ maxRewardsPerCustomer: v })} placeholder="No limit" /></Field>
          <Field label="'New' = added within"><NumberInput suffix="days" min={1} decimals={0} value={d.newCustomerDays} onChange={(v) => set({ newCustomerDays: v ?? 30 })} /></Field>
        </div>
        {cat.branches.length > 0 && <MultiPicker label="Codes also work at" options={cat.branches} value={d.branchIds} onChange={(ids) => set({ branchIds: ids })} placeholder="Search branches" />}
        <div className="rounded-xl bg-app-bg p-3 space-y-3">
          <Switch checked={d.excludeExisting} onChange={(v) => set({ excludeExisting: v })} label="Only recently added customers" description="Anyone who has bought is left out." />
          <Switch checked={d.requirePhone} onChange={(v) => set({ requirePhone: v })} label="Phone number needed" description="Stops one person joining twice." />
          <Switch checked={d.reviewFlagged} onChange={(v) => set({ reviewFlagged: v })} label="Manager checks flagged ones" />
          <Switch checked={d.stackable} onChange={(v) => set({ stackable: v })} label="Combine with other discounts" />
        </div>
      </Group>
    </FormSheet>
  );
}
