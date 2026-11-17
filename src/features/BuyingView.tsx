// Buying: suppliers and purchases (SuppliersView, embedded), what to reorder (or ask a branch
// for), approvals waiting, supplier bills, returns to suppliers, and the approval limits per role.
// Everything is checked and done in the database (20261118001_smarter_buying.sql); this
// screen reads it and calls the functions.
import SearchableDropdown from '../components/SearchableDropdown';
import { Checkbox } from '../components/shared/Checkbox';
import { displayName } from '../utils/stringUtils';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRightLeft, BellRing, CalendarClock, ClipboardList, FileText, Hand, PackageSearch, RotateCcw, Search,
  Settings2, ShieldCheck, ShoppingCart, Truck, Undo2, Wallet,
} from 'lucide-react';
import { useBusinessStore, onBranchChange } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useUiStore } from '../stores/uiStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { formatCurrency } from '../utils/helpers';
import { GroupedTabs, type TabGroup } from '../components/TabOptions';
import SuppliersView from './SuppliersView';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn } from '../components/shared/FormSheet';
import { appDialog } from '../components/AppDialog';
import { BillSheet, PayBillSheet, ReasonSheet, ReturnSheet } from '../components/buying/BuyingSheets';
import AskSupplierSheet from '../components/buying/AskSupplierSheet';
import {
  approvePurchase, approveStockTransfer, approveSupplierBill, createSuggestedPurchases, loadBuyingOverview, loadReorder,
  rejectPurchase, requestStockTransfer, saveBuyingSettings, saveReorderSettings, voidSupplierBill, LIMIT_ROLES,
  type BuyingOverview, type ReorderRow, type SupplierBill, type ToBill,
} from '../services/buying';
import { listPurchases, listSuppliers, type PurchaseOrder, type Supplier } from '../services/operations';
import { getSupabase } from '../services/supabaseClient';

type Tab = 'suppliers' | 'purchases' | 'reorder' | 'approvals' | 'bills' | 'returns' | 'settings';

const q3 = (n: number) => String(Math.round(n * 1000) / 1000);
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00+03:00` : iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

const BILL_STATUS: Record<SupplierBill['status'], { label: string; cls: string }> = {
  needs_check: { label: 'Needs a check', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  open: { label: 'To pay', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  paid: { label: 'Paid', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  void: { label: 'Void', cls: 'bg-slate-500/15 text-app-text-muted' },
};

function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-app-card rounded-2xl ring-1 ring-app-border/70 p-4 space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-sm font-semibold text-app-text">{title}</h3>
          {subtitle && <p className="text-xs text-app-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function BuyingView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const employee = useAuthStore((s) => s.currentEmployee);
  const role = employee?.role || 'Guest';
  const showToast = useNotificationStore((s) => s.showToast);
  const products = useInventoryStore((s) => s.products);
  const can = (code: string) => hasRolePermission(role, code as any);

  const canSeePurchases = can('purchases.view') || can('purchases.create');
  const canCreate = can('purchases.create');
  const canApprove = can('purchases.approve');
  const canBill = can('supplier_bills.manage');
  const canPay = can('accounting.manage') || canApprove;
  const canAsk = can('inventory.request_transfer') || can('inventory.transfer_stock');
  const canSetLevels = can('products.update') || can('inventory.manage') || canCreate;
  const canReturn = (can('purchases.update') || can('purchases.manage') || canApprove) && (can('inventory.adjust_stock') || can('inventory.receive_stock'));

  const [overview, setOverview] = useState<BuyingOverview | null>(null);
  const [reorder, setReorder] = useState<ReorderRow[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  const waiting = overview ? overview.approvals.purchases.length + overview.approvals.transfers.length + overview.approvals.bills.length : 0;
  const seesSuppliers = can('suppliers.view');
  const tabs = [
    { id: 'suppliers' as Tab, label: 'Suppliers', icon: <Truck size={14} />, shortcut: 'suppliers-tab', allowed: seesSuppliers },
    { id: 'purchases' as Tab, label: 'Purchases', icon: <ShoppingCart size={14} />, shortcut: 'purchases-tab', allowed: can('purchases.view') },
    { id: 'reorder' as Tab, label: 'Reorder', icon: <PackageSearch size={14} />, shortcut: 'buying-reorder', allowed: canSeePurchases || canAsk },
    { id: 'approvals' as Tab, label: 'Approvals', icon: <ShieldCheck size={14} />, shortcut: 'buying-approvals', allowed: canApprove || canBill, badge: waiting },
    { id: 'bills' as Tab, label: 'Bills', icon: <FileText size={14} />, shortcut: 'buying-bills', allowed: canBill || canSeePurchases, badge: overview?.toBill.length || 0 },
    { id: 'returns' as Tab, label: 'Returns', icon: <Undo2 size={14} />, shortcut: 'buying-returns', allowed: canSeePurchases },
    { id: 'settings' as Tab, label: 'Settings', icon: <Settings2 size={14} />, shortcut: 'buying-settings', allowed: canSeePurchases || canApprove },
  ].filter((t) => t.allowed);
  const only = (...ids: Tab[]) => ids.flatMap((id) => tabs.filter((t) => t.id === id));
  // Grouped so the phone shows four tabs, in the order work happens:
  // who we buy from → what to order and approve → bills (and returns) → settings.
  const groups: TabGroup<Tab>[] = [
    { id: 'suppliers', label: 'Suppliers', tabs: only('suppliers') },
    { id: 'orders', label: 'Orders', tabs: only('reorder', 'purchases', 'approvals') },
    { id: 'bills', label: 'Bills', tabs: only('bills', 'returns') },
    { id: 'settings', label: 'Settings', tabs: only('settings') },
  ];
  const [tab, setTabState] = useState<Tab>(tabs.find((t) => t.id === 'reorder')?.id ?? tabs[0]?.id ?? 'reorder');
  const setTab = (t: Tab) => {
    setTabState(t);
    // Suppliers & Purchases save on their own; refresh the counts on the buying tabs.
    if (t !== 'suppliers' && t !== 'purchases') void load();
  };
  // Opened as "suppliers" (old screen id, search): start on that tab.
  const section = useUiStore((st) => st.screenSection);
  useEffect(() => {
    if (section !== 'suppliers' && section !== 'purchases') return;
    useUiStore.getState().setScreenSection(null);
    if (tabs.some((t) => t.id === section)) setTabState(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setError(null);
    try {
      const [o, r, s, p] = await Promise.all([
        canSeePurchases || canApprove || canBill ? loadBuyingOverview(businessId) : Promise.resolve(null),
        loadReorder(businessId),
        can('suppliers.view') ? listSuppliers(businessId) : Promise.resolve([]),
        canSeePurchases ? listPurchases(businessId) : Promise.resolve([]),
      ]);
      setOverview(o);
      setReorder(r.products);
      setSuppliers(s);
      setPurchases(p);
    } catch (e) {
      setError(toUserMessage(e, 'Could not load buying. Check your connection.'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, canSeePurchases, canApprove, canBill]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => onBranchChange(() => { setOverview(null); setReorder(null); setSuppliers([]); setPurchases([]); }), []);

  if (!tabs.length) {
    return <div className="h-full grid place-items-center p-6 text-sm text-app-text-muted">Your role can't see buying.</div>;
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-5xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        <GroupedTabs<Tab> groups={groups} activeTab={tab} onChange={setTab} />

        {(tab === 'suppliers' || tab === 'purchases') && <SuppliersView embedded tab={tab} onTab={setTabState} />}

        {overview && overview.dueSoon.length > 0 && (
          <div className="rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/30 p-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <CalendarClock size={16} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium">Supplier bills due this week</p>
              <p className="text-xs">
                {overview.dueSoon.map((d) => `${d.supplier} ${formatCurrency(d.balance)} (${d.dueDate < todayIso() ? 'overdue' : `by ${day(d.dueDate)}`})`).join(' · ')}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 text-center space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-sm underline cursor-pointer"><RotateCcw size={14} /> Try again</button>
          </div>
        )}

        {!error && !reorder && <p className="p-6 text-sm text-app-text-muted text-center">Loading…</p>}

        {reorder && tab === 'reorder' && businessId && (
          <ReorderTab
            businessId={businessId}
            rows={reorder}
            suppliers={suppliers}
            canCreate={canCreate}
            canAsk={canAsk}
            canSetLevels={canSetLevels}
            onChanged={() => void load()}
            onToast={showToast}
          />
        )}
        {overview && tab === 'approvals' && (
          <ApprovalsTab overview={overview} canApprove={canApprove} canBill={canBill} onChanged={() => void load()} onToast={showToast} />
        )}
        {overview && tab === 'bills' && businessId && (
          <BillsTab businessId={businessId} overview={overview} canBill={canBill} canPay={canPay} onChanged={() => void load()} onToast={showToast} />
        )}
        {overview && tab === 'returns' && businessId && (
          <ReturnsTab
            businessId={businessId}
            overview={overview}
            suppliers={suppliers}
            purchases={purchases}
            products={products}
            canReturn={canReturn}
            onChanged={() => void load()}
            onToast={showToast}
          />
        )}
        {overview && tab === 'settings' && businessId && (
          <SettingsTab businessId={businessId} overview={overview} onChanged={() => void load()} onToast={showToast} />
        )}
      </div>
    </div>
  );
}

type Toast = (title: string, message?: string, a?: any, kind?: any) => void;

// ---------------------------------------------------------------- Reorder

function ReorderTab({ businessId, rows, suppliers, canCreate, canAsk, canSetLevels, onChanged, onToast }: {
  businessId: string; rows: ReorderRow[]; suppliers: Supplier[]; canCreate: boolean; canAsk: boolean; canSetLevels: boolean;
  onChanged: () => void; onToast: Toast;
}) {
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ReorderRow | null>(null);
  const [asking, setAsking] = useState<ReorderRow | null>(null);
  const role = useAuthStore((s) => s.currentEmployee?.role) || 'Guest';
  const canAskSupplier = hasRolePermission(role, 'purchases.create') || hasRolePermission(role, 'purchases.request_quote');
  const [busy, setBusy] = useState(false);
  // Per product: ticked, how much, and where from (a branch id, or 'buy').
  const [plan, setPlan] = useState<Record<string, { on: boolean; qty: string; from: string }>>({});

  useEffect(() => {
    setPlan(Object.fromEntries(rows.filter((r) => r.need > 0).map((r) => [r.productId, {
      on: true, qty: q3(r.need), from: r.transferFrom && canAsk ? r.transferFrom.businessId : 'buy',
    }])));
  }, [rows, canAsk]);

  const low = rows.filter((r) => r.low);
  const q = query.trim().toLowerCase();
  const shown = (showAll ? rows : low).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.sku || '').toLowerCase().includes(q));
  const ticked = Object.entries(plan).filter(([, p]) => p.on && Number(p.qty) > 0);
  const toBuy = ticked.filter(([, p]) => p.from === 'buy');
  const toAsk = ticked.filter(([, p]) => p.from !== 'buy');
  const noLevels = rows.filter((r) => r.level === null).length;
  const withSuggestion = rows.filter((r) => r.suggestedLevel !== null && r.suggestedLevel > 0);

  const buy = async () => {
    if (!toBuy.length || busy) return;
    setBusy(true);
    try {
      const made = await createSuggestedPurchases(businessId, toBuy.map(([productId, p]) => ({ productId, quantity: Number(p.qty) })));
      onToast(
        made.length === 1 ? 'Draft purchase made' : `${made.length} draft purchases made`,
        `${made.map((m) => `${m.supplierName} ${formatCurrency(m.total)}`).join(' · ')}. Open them in Suppliers & Purchases to ask for prices or place the order.`,
        undefined,
        'success',
      );
      onChanged();
    } catch (e) {
      onToast('Not made', toUserMessage(e, 'Could not make the purchases.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!toAsk.length || busy) return;
    setBusy(true);
    try {
      const byBranch = new Map<string, { productId: string; quantity: number }[]>();
      for (const [productId, p] of toAsk) byBranch.set(p.from, [...(byBranch.get(p.from) || []), { productId, quantity: Number(p.qty) }]);
      const refs: string[] = [];
      for (const [branch, items] of byBranch) {
        const r = await requestStockTransfer(businessId, branch, items, 'Below the reorder level');
        refs.push(r.reference);
      }
      onToast('Stock asked for', `${refs.join(', ')}: the other ${byBranch.size === 1 ? 'branch is' : 'branches are'} told. Follow it on Stock Transfers.`, undefined, 'success');
      onChanged();
    } catch (e) {
      onToast('Not asked', toUserMessage(e, 'Could not ask the branch.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const useSuggested = async () => {
    const ok = await appDialog.confirm({
      title: `Set ${withSuggestion.length} reorder levels from sales?`,
      message: 'Each level becomes what sold per day over the last 30 days, times (lead time + safety days). Products that did not sell keep their level.',
      confirmLabel: 'Set levels',
    });
    if (!ok) return;
    try {
      await saveReorderSettings(businessId, withSuggestion.map((r) => ({
        productId: r.productId, level: r.suggestedLevel, qty: r.reorderQty, supplierId: r.supplierId, price: r.supplierPrice, leadDays: r.leadDays,
      })));
      onToast('Reorder levels set', `${withSuggestion.length} products.`, undefined, 'success');
      onChanged();
    } catch (e) {
      onToast('Not saved', toUserMessage(e, 'Could not save the levels.'), undefined, 'error');
    }
  };

  return (
    <div className="space-y-3">
      <Card
        title={low.length ? `${low.length} ${low.length === 1 ? 'product is' : 'products are'} at or below the reorder level` : 'Nothing is below its reorder level'}
        subtitle="The level is the reorder level, else the low-stock level. What is already ordered or on the way is taken off. A branch with plenty is suggested before buying."
        action={
          <div className="flex gap-2 flex-wrap">
            {canAsk && toAsk.length > 0 && (
              <button className={secondaryBtn} disabled={busy} onClick={() => void ask()}><Hand size={15} /> Ask branches ({toAsk.length})</button>
            )}
            {canCreate && (
              <button data-shortcut="new" className={primaryBtn} disabled={busy || !toBuy.length} onClick={() => void buy()}>
                <ShoppingCart size={15} /> Make draft purchases ({toBuy.length})
              </button>
            )}
          </div>
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[12rem]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" className={`${fieldClass} pl-9`} />
          </div>
          <label className="flex items-center gap-2 text-xs text-app-text-muted">
            <Checkbox checked={showAll} onChange={(on) => setShowAll(on)} /> All products
          </label>
          {canSetLevels && withSuggestion.length > 0 && (
            <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => void useSuggested()}>Set levels from sales</button>
          )}
        </div>
        {noLevels > 0 && !showAll && (
          <p className="text-[11px] text-app-text-muted">{noLevels} {noLevels === 1 ? 'product has' : 'products have'} no level yet, so {noLevels === 1 ? 'it is' : 'they are'} never suggested. Tick All products and tap one to set it.</p>
        )}
        {shown.length === 0 ? (
          <p className="text-sm text-app-text-muted text-center py-4">{showAll ? 'No products match.' : 'All stocked up.'}</p>
        ) : (
          <ul className="divide-y divide-app-border/60 -mx-1">
            {shown.map((r) => {
              const p = plan[r.productId];
              return (
                <li key={r.productId} className="py-2.5 px-1 flex items-start gap-3">
                  {p && (canCreate || canAsk) ? (
                    <Checkbox checked={p.on} onChange={(on) => setPlan((m) => ({ ...m, [r.productId]: { ...m[r.productId], on: on } }))} ariaLabel={`Order ${displayName(r.name)}`} />
                  ) : <span className="w-[13px]" />}
                  <button className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => canSetLevels && setEditing(r)}>
                    <p className="text-sm font-medium text-app-text break-words">{displayName(r.name)}</p>
                    <p className="text-[11px] text-app-text-muted">
                      {q3(r.stock)} {r.unit} in stock
                      {r.level !== null ? ` · level ${q3(r.level)}` : ' · no level'}
                      {r.sold30 > 0 ? ` · sells ${q3(r.avgDaily)}/day` : ''}
                      {r.onOrder > 0 ? ` · ${q3(r.onOrder)} on order` : ''}
                      {r.onTheWay > 0 ? ` · ${q3(r.onTheWay)} coming from a branch` : ''}
                    </p>
                    <p className="text-[11px] text-app-text-muted">
                      {r.supplierName ? `${r.supplierName}${r.supplierPrice !== null ? ` · ${formatCurrency(r.supplierPrice)}` : ''}${r.leadDays !== null ? ` · ${r.leadDays} days` : ''}` : 'No preferred supplier'}
                    </p>
                    {canAskSupplier && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setAsking(r); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setAsking(r); } }}
                        className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                      >
                        <BellRing size={12} /> {r.supplierName ? `Ask ${r.supplierName} to deliver` : 'Ask a supplier to deliver'}
                      </span>
                    )}
                    {r.low && r.need === 0 && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">Covered by what is on order or on the way</p>}
                  </button>
                  {p && (
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <input
                        type="number" inputMode="decimal" min="0" step="any"
                        value={p.qty}
                        aria-label={`How much ${displayName(r.name)}`}
                        onChange={(e) => setPlan((m) => ({ ...m, [r.productId]: { ...m[r.productId], qty: e.target.value } }))}
                        className="w-24 bg-app-bg border border-app-border rounded-lg px-2 py-1.5 text-sm text-right tabular-nums"
                      />
                      {r.transferFrom && canAsk && (
                        <div className="w-44 max-w-full">
                          <SearchableDropdown
                            items={[
                              { id: r.transferFrom.businessId, label: `Ask ${r.transferFrom.name}`, sublabel: `${q3(r.transferFrom.spare)} spare` },
                              { id: 'buy', label: 'Buy from a supplier' },
                            ]}
                            selectedValue={p.from}
                            onChange={(v) => setPlan((m) => ({ ...m, [r.productId]: { ...m[r.productId], from: v } }))}
                            placeholder="Ask or buy"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editing && (
        <ReorderSheet
          businessId={businessId}
          row={editing}
          suppliers={suppliers}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
      {asking && (
        <AskSupplierSheet
          target={{
            businessId, productId: asking.productId, productName: asking.name, unit: asking.unit,
            supplierId: asking.supplierId, supplierName: asking.supplierName,
            suggestedQty: asking.need > 0 ? asking.need : asking.reorderQty,
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}

function ReorderSheet({ businessId, row, suppliers, onClose, onSaved }: {
  businessId: string; row: ReorderRow; suppliers: Supplier[]; onClose: () => void; onSaved: () => void;
}) {
  const [level, setLevel] = useState(row.reorderLevel !== null ? String(row.reorderLevel) : '');
  const [qty, setQty] = useState(row.reorderQty !== null ? String(row.reorderQty) : '');
  const [supplierId, setSupplierId] = useState(row.supplierId || '');
  const [price, setPrice] = useState(row.supplierPrice !== null ? String(row.supplierPrice) : '');
  const [lead, setLead] = useState(row.leadDays !== null ? String(row.leadDays) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await saveReorderSettings(businessId, [{ productId: row.productId, level: num(level), qty: num(qty), supplierId: supplierId || null, price: num(price), leadDays: num(lead) }]);
      onSaved();
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save.'));
      setBusy(false);
    }
  };
  return (
    <FormSheet
      title={`Reorder ${row.name}`}
      subtitle={`${q3(row.stock)} ${row.unit} in stock · sold ${q3(row.sold30)} in 30 days${row.minStock ? ` · low-stock level ${q3(row.minStock)}` : ''}`}
      onClose={onClose}
      footer={<button className={primaryBtn} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Reorder when at or below (${row.unit})`} hint={row.suggestedLevel ? `From sales: ${q3(row.suggestedLevel)}` : 'Empty uses the low-stock level'}>
          <div className="flex gap-2">
            <input type="number" inputMode="decimal" min="0" step="any" value={level} onChange={(e) => setLevel(e.target.value)} className={fieldClass} />
            {row.suggestedLevel !== null && row.suggestedLevel > 0 && (
              <button type="button" className={`${secondaryBtn} !px-3`} onClick={() => setLevel(String(row.suggestedLevel))}>Use</button>
            )}
          </div>
        </Field>
        <Field label={`Order this much (${row.unit})`} hint="Empty orders up to twice the level">
          <input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Usual supplier">
          <SearchableDropdown
            items={[{ id: '', label: 'None' }, ...suppliers.map((s) => ({ id: s.id, label: s.name, sublabel: s.company || undefined }))]}
            selectedValue={supplierId}
            onChange={setSupplierId}
            placeholder="None"
            searchPlaceholder="Search suppliers"
          />
        </Field>
        <Field label="Their price each (KSh)" hint={`Cost now ${formatCurrency(row.cost)}`}>
          <input type="number" inputMode="decimal" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Days they take to deliver">
          <input type="number" inputMode="numeric" min="0" max="365" value={lead} onChange={(e) => setLead(e.target.value)} className={fieldClass} />
        </Field>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- Approvals

function ApprovalsTab({ overview, canApprove, canBill, onChanged, onToast }: {
  overview: BuyingOverview; canApprove: boolean; canBill: boolean; onChanged: () => void; onToast: Toast;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<{ kind: 'purchase' | 'transfer' | 'bill'; id: string; title: string } | null>(null);
  const { purchases, transfers, bills } = overview.approvals;

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    try {
      await fn();
      onToast(ok, undefined, undefined, 'success');
      onChanged();
    } catch (e) {
      onToast('Not done', toUserMessage(e, 'Could not save. Check your connection.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const limitText = overview.myLimit === null ? 'Your role has no limit.' : `Your role can approve up to ${formatCurrency(overview.myLimit)}.`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-app-text-muted px-1">{canApprove ? limitText : 'Only people who approve purchases can approve these.'}</p>
      <Card title="Purchases waiting" subtitle="Above the limit of the person who placed them.">
        {purchases.length === 0 ? <p className="text-sm text-app-text-muted">None.</p> : (
          <ul className="divide-y divide-app-border/60">
            {purchases.map((p) => (
              <li key={p.id} className="py-2.5 flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{p.supplier} · {formatCurrency(p.total)}</p>
                  <p className="text-[11px] text-app-text-muted">{p.ref} · {day(p.date)}{p.by ? ` · by ${p.by}` : ''}</p>
                  <p className="text-[11px] text-app-text-muted break-words">{p.items.map((i) => `${i.name} ${i.quantity} ${i.unit} @ ${formatCurrency(i.price)}`).join(' · ')}</p>
                </div>
                {canApprove && (
                  <div className="flex gap-2">
                    <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} disabled={!!busy} onClick={() => setReason({ kind: 'purchase', id: p.id, title: `Don't approve ${p.ref}?` })}>Not approved</button>
                    <button
                      className={`${primaryBtn} !px-3 !py-1.5 text-xs`}
                      disabled={!!busy || !p.canApprove}
                      title={!p.canApprove ? 'Above what your role can approve' : undefined}
                      onClick={() => void run(p.id, () => approvePurchase(p.id), `${p.ref} approved and ordered`)}
                    >
                      <ShieldCheck size={13} /> {p.canApprove ? 'Approve' : 'Above your limit'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Transfers waiting" subtitle="Stock to other branches above the sender's limit. Nothing has left yet.">
        {transfers.length === 0 ? <p className="text-sm text-app-text-muted">None.</p> : (
          <ul className="divide-y divide-app-border/60">
            {transfers.map((t) => (
              <li key={t.id} className="py-2.5 flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium flex items-center gap-1.5"><ArrowRightLeft size={13} /> To {t.toName} · {formatCurrency(t.value)} at cost</p>
                  <p className="text-[11px] text-app-text-muted">{t.reference}{t.by ? ` · by ${t.by}` : ''}</p>
                </div>
                {canApprove && (
                  <div className="flex gap-2">
                    <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} disabled={!!busy} onClick={() => setReason({ kind: 'transfer', id: t.id, title: `Don't send ${t.reference}?` })}>Not approved</button>
                    <button
                      className={`${primaryBtn} !px-3 !py-1.5 text-xs`}
                      disabled={!!busy || !t.canApprove}
                      onClick={() => void run(t.id, () => approveStockTransfer(t.id), `${t.reference} approved and sent`)}
                    >
                      <ShieldCheck size={13} /> {t.canApprove ? 'Approve and send' : 'Above your limit'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Supplier bills to check" subtitle="The bill differs from the goods received by more than allowed. It counts and can be paid once checked.">
        {bills.length === 0 ? <p className="text-sm text-app-text-muted">None.</p> : (
          <ul className="divide-y divide-app-border/60">
            {bills.map((b) => (
              <li key={b.id} className="py-2.5 flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <AlertTriangle size={13} className="text-amber-500" /> {b.supplier} · {b.number}
                  </p>
                  <p className="text-[11px] text-app-text-muted">
                    Bill {formatCurrency(b.subtotal)} before VAT · goods received {formatCurrency(b.receiptsValue)} · {b.difference > 0 ? 'more' : 'less'} by {formatCurrency(Math.abs(b.difference))}
                  </p>
                </div>
                {canApprove && canBill && (
                  <button className={`${primaryBtn} !px-3 !py-1.5 text-xs`} disabled={!!busy} onClick={() => setReason({ kind: 'bill', id: b.id, title: `Accept ${b.number} as it is?` })}>
                    <ShieldCheck size={13} /> It's right
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {reason && (
        <ReasonSheet
          title={reason.title}
          message={
            reason.kind === 'bill'
              ? 'Say why the difference is right. The price difference goes to stock value.'
              : reason.kind === 'purchase' ? 'It goes back to a draft and the person who placed it is told why.' : 'It is cancelled; nothing has left.'
          }
          placeholder={reason.kind === 'bill' ? 'e.g. Price went up from this month' : 'e.g. Buy half this week'}
          confirmLabel={reason.kind === 'bill' ? 'Accept bill' : 'Not approved'}
          destructive={reason.kind !== 'bill'}
          onClose={() => setReason(null)}
          onConfirm={async (text) => {
            if (reason.kind === 'purchase') await rejectPurchase(reason.id, text);
            else if (reason.kind === 'bill') await approveSupplierBill(reason.id, text);
            else {
              const { error } = await getSupabase().rpc('cancel_stock_transfer', { p_transfer_id: reason.id, p_reason: `Not approved: ${text}` });
              if (error) throw error;
            }
            setReason(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Bills

function BillsTab({ businessId, overview, canBill, canPay, onChanged, onToast }: {
  businessId: string; overview: BuyingOverview; canBill: boolean; canPay: boolean; onChanged: () => void; onToast: Toast;
}) {
  const [entering, setEntering] = useState<ToBill | null>(null);
  const [paying, setPaying] = useState<SupplierBill | null>(null);
  const [voiding, setVoiding] = useState<SupplierBill | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const bills = overview.bills.filter((b) => filter === 'all' || b.status === 'open' || b.status === 'needs_check');
  const owed = overview.bills.filter((b) => b.status === 'open').reduce((s, b) => s + b.balance, 0);
  const notBilled = overview.toBill.reduce((s, t) => s + t.value, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-app-card ring-1 ring-app-border/70 p-3">
          <p className="text-[11px] text-app-text-muted">Bills to pay</p>
          <p className="text-lg font-bold tabular-nums">{formatCurrency(owed)}</p>
        </div>
        <div className="rounded-2xl bg-app-card ring-1 ring-app-border/70 p-3">
          <p className="text-[11px] text-app-text-muted">Received, no bill yet</p>
          <p className="text-lg font-bold tabular-nums">{formatCurrency(notBilled)}</p>
        </div>
      </div>

      <Card title="Waiting for the supplier's bill" subtitle="Goods that arrived. Enter the bill when it comes; until then they sit in Goods received, not billed.">
        {overview.toBill.length === 0 ? <p className="text-sm text-app-text-muted">Nothing waiting.</p> : (
          <ul className="divide-y divide-app-border/60">
            {overview.toBill.map((t, i) => (
              <li key={t.purchaseId} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.supplier} · {formatCurrency(t.value)}</p>
                  <p className="text-[11px] text-app-text-muted">{t.ref} · {t.receipts.map((r) => r.number).join(', ')}</p>
                </div>
                {canBill && (
                  <button {...(i === 0 ? { 'data-shortcut': 'new' } : {})} className={`${primaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => setEntering(t)}>
                    <FileText size={13} /> Enter bill
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Supplier bills"
        action={
          <div className="flex bg-app-bg rounded-xl p-1 ring-1 ring-app-border">
            {(['open', 'all'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${filter === f ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}>
                {f === 'open' ? 'To pay' : 'All'}
              </button>
            ))}
          </div>
        }
      >
        {bills.length === 0 ? <p className="text-sm text-app-text-muted">{filter === 'open' ? 'No bills to pay.' : 'No bills yet.'}</p> : (
          <ul className="divide-y divide-app-border/60">
            {bills.map((b) => {
              const late = b.status === 'open' && b.dueDate < todayIso();
              return (
                <li key={b.id} className="py-2.5 flex items-start gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{b.supplier} · {b.number}{b.supplierInvoiceNo ? ` (their ${b.supplierInvoiceNo})` : ''}</p>
                    <p className="text-[11px] text-app-text-muted">
                      {day(b.billDate)} · {b.purchaseRef || 'purchase'} · {b.receipts.join(', ')} · {formatCurrency(b.subtotal)} + VAT {formatCurrency(b.vatTotal)}
                      {b.difference !== 0 ? ` · ${b.difference > 0 ? '+' : '−'}${formatCurrency(Math.abs(b.difference))} on goods` : ''}
                    </p>
                    <p className={`text-[11px] ${late ? 'text-red-600 dark:text-red-400' : 'text-app-text-muted'}`}>
                      {b.status === 'void' ? `Void: ${b.voidReason || ''}` : b.status === 'paid' ? `Paid ${formatCurrency(b.paid)}` : `${formatCurrency(b.balance)} to pay ${late ? 'was due' : 'by'} ${day(b.dueDate)}${b.paid > 0 ? ` · ${formatCurrency(b.paid)} paid` : ''}`}
                      {b.checkNote ? ` · checked: ${b.checkNote}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${BILL_STATUS[b.status].cls}`}>{BILL_STATUS[b.status].label}</span>
                  <div className="w-full sm:w-auto flex gap-2 justify-end">
                    {canBill && (b.status === 'open' || b.status === 'needs_check') && b.paid === 0 && (
                      <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => setVoiding(b)}>Void</button>
                    )}
                    {canPay && b.status === 'open' && b.balance > 0 && (
                      <button className={`${primaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => setPaying(b)}><Wallet size={13} /> Pay</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {entering && (
        <BillSheet
          businessId={businessId}
          purchaseId={entering.purchaseId}
          purchaseRef={entering.ref}
          supplier={entering.supplier}
          receipts={entering.receipts}
          tolerancePct={overview.settings.tolerancePct}
          onClose={() => setEntering(null)}
          onDone={(r) => {
            setEntering(null);
            onToast(r.status === 'needs_check' ? 'Bill saved, needs a check' : 'Bill saved', r.status === 'needs_check' ? `${r.number} is waiting in Approvals.` : `${r.number} is now owed.`, undefined, r.status === 'needs_check' ? 'info' : 'success');
            onChanged();
          }}
        />
      )}
      {paying && (
        <PayBillSheet
          bill={paying}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); onToast('Payment recorded', paying.number, undefined, 'success'); onChanged(); }}
        />
      )}
      {voiding && (
        <ReasonSheet
          title={`Void ${voiding.number}?`}
          message="Its deliveries go back to waiting for a bill. The books undo it."
          placeholder="e.g. Entered twice"
          confirmLabel="Void bill"
          destructive
          onClose={() => setVoiding(null)}
          onConfirm={async (text) => { await voidSupplierBill(voiding.id, text); setVoiding(null); onChanged(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Returns

function ReturnsTab({ businessId, overview, suppliers, purchases, products, canReturn, onChanged, onToast }: {
  businessId: string; overview: BuyingOverview; suppliers: Supplier[]; purchases: PurchaseOrder[]; products: any[];
  canReturn: boolean; onChanged: () => void; onToast: Toast;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Card
        title="Goods sent back to suppliers"
        subtitle="Stock goes down and you owe the supplier less, at what you paid."
        action={canReturn ? <button data-shortcut="new" className={primaryBtn} onClick={() => setOpen(true)}><Undo2 size={15} /> Return goods</button> : undefined}
      >
        {overview.returns.length === 0 ? <p className="text-sm text-app-text-muted">No returns yet.</p> : (
          <ul className="divide-y divide-app-border/60">
            {overview.returns.map((r) => (
              <li key={r.id} className="py-2.5 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.supplier} · {r.number}</p>
                  <p className="text-[11px] text-app-text-muted">{day(r.createdAt)}{r.by ? ` · ${r.by}` : ''} · {r.reason}</p>
                  <p className="text-[11px] text-app-text-muted break-words">{r.lines.map((l) => `${displayName(l.name)} ${l.quantity} ${l.unit || ''}`).join(' · ')}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0">{formatCurrency(r.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && (
        <ReturnSheet
          businessId={businessId}
          suppliers={suppliers}
          purchases={purchases}
          products={products}
          onClose={() => setOpen(false)}
          onDone={(r) => { setOpen(false); onToast('Goods returned', `${r.number}: you owe ${formatCurrency(r.total)} less.`, undefined, 'success'); onChanged(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Settings

function SettingsTab({ businessId, overview, onChanged, onToast }: {
  businessId: string; overview: BuyingOverview; onChanged: () => void; onToast: Toast;
}) {
  const s = overview.settings;
  const [tol, setTol] = useState(String(s.tolerancePct));
  const [safety, setSafety] = useState(String(s.safetyDays));
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(LIMIT_ROLES.map((r) => [r, s.limits.find((l) => l.role === r)?.max?.toString() ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const goTo = useUiStore((st) => st.setActiveTab);
  const ro = !s.canEdit;

  const save = async () => {
    setBusy(true);
    try {
      await saveBuyingSettings(businessId, Number(tol) || 0, Math.round(Number(safety) || 0),
        LIMIT_ROLES.map((role) => ({ role, max: limits[role].trim() === '' ? null : Number(limits[role]) })));
      onToast('Buying settings saved', undefined, undefined, 'success');
      onChanged();
    } catch (e) {
      onToast('Not saved', toUserMessage(e, 'Could not save the settings.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card
        title="Approval limits"
        subtitle="Per role. A purchase or transfer above the limit of the person who places it waits for someone whose limit covers it. Empty means no limit. The owner and admins never need approval."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {LIMIT_ROLES.map((role) => (
            <Field key={role} label={`${role} (KSh)`}>
              <input
                type="number" inputMode="numeric" min="0" step="100" disabled={ro} placeholder="No limit"
                value={limits[role]}
                onChange={(e) => setLimits((m) => ({ ...m, [role]: e.target.value }))}
                className={fieldClass}
              />
            </Field>
          ))}
        </div>
      </Card>
      <Card title="Bills and reorder">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Allowed bill difference (%)" hint="A bill differing from the goods received by more waits for a check">
            <input type="number" inputMode="decimal" min="0" max="50" step="0.5" disabled={ro} value={tol} onChange={(e) => setTol(e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Safety days" hint="Added to the lead time when suggesting reorder levels from sales">
            <input type="number" inputMode="numeric" min="0" max="90" disabled={ro} value={safety} onChange={(e) => setSafety(e.target.value)} className={fieldClass} />
          </Field>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {ro ? (
            <p className="text-xs text-app-text-muted">Only the owner or an admin can change these, so nobody raises their own limit.</p>
          ) : (
            <button className={primaryBtn} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
          )}
          {s.updatedBy && <span className="text-[11px] text-app-text-muted">Last changed by {s.updatedBy}{s.updatedAt ? ` on ${day(s.updatedAt)}` : ''}</span>}
          <button className={`${secondaryBtn} ml-auto !px-3 !py-1.5 text-xs`} onClick={() => goTo('suppliers')}><ClipboardList size={13} /> Suppliers</button>
        </div>
      </Card>
    </div>
  );
}
