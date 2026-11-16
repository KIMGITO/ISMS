// Suppliers & Purchases: who you buy from, and what you ordered from them.
// A purchase goes Pending → Ordered → Received (or Cancelled). Receiving adds every line
// linked to a product to stock (a Restock in Stock History, numbered with the purchase),
// and can set the product's cost to what was paid.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Truck, Plus, Search, Phone, Mail, Pencil, Trash2, PackageCheck, Send, Ban, RotateCcw, ShoppingCart, X,
} from 'lucide-react';
import { useBusinessStore, onBranchChange } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { formatCurrency } from '../utils/helpers';
import { Tabs } from '../components/TabOptions';
import { SwipeRow } from '../components/shared/SwipeRow';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn, dangerBtn } from '../components/shared/FormSheet';
import SearchableDropdown from '../components/SearchableDropdown';
import { appDialog } from '../components/AppDialog';
import {
  listSuppliers, saveSupplier, removeSupplier, listPurchases, savePurchase, setPurchaseStatus, receivePurchase,
  deletePurchase, purchaseRef, lineTotal,
  type Supplier, type SupplierDraft, type PurchaseOrder, type PurchaseDraft, type PurchaseLine, type PurchaseStatus,
} from '../services/operations';

type Tab = 'suppliers' | 'purchases';
type StatusFilter = 'open' | 'received' | 'cancelled' | 'all';

const STATUS_STYLE: Record<PurchaseStatus, string> = {
  Pending: 'bg-slate-500/15 text-app-text-muted',
  Ordered: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  Received: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Cancelled: 'bg-red-500/15 text-red-700 dark:text-red-300',
};
const STATUS_WORD: Record<PurchaseStatus, string> = { Pending: 'Draft', Ordered: 'Ordered', Received: 'Received', Cancelled: 'Cancelled' };

const emptySupplier: SupplierDraft = { name: '', company: '', phone: '', email: '', productSupplied: '', notes: '' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const blankLine = (): PurchaseLine => ({ productId: null, name: '', quantity: 1, unit: 'pcs', price: 0 });

export default function SuppliersView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const employee = useAuthStore((s) => s.currentEmployee);
  const role = employee?.role || 'Guest';
  const staffName = employee?.name || 'Staff';
  const showToast = useNotificationStore((s) => s.showToast);
  const products = useInventoryStore((s) => s.products);
  const can = (code: string) => hasRolePermission(role, code as any);

  const seesSuppliers = can('suppliers.view');
  const seesPurchases = can('purchases.view');
  const canAddSupplier = can('suppliers.create');
  const canEditSupplier = can('suppliers.update');
  const canDeleteSupplier = can('suppliers.delete');
  const canCreatePurchase = can('purchases.create');
  const canEditPurchase = can('purchases.update');
  const canCancelPurchase = can('purchases.cancel');
  const canReceive = (can('purchases.update') || can('purchases.approve') || can('purchases.manage'))
    && (can('inventory.receive_stock') || can('inventory.adjust_stock'));

  const tabs = [
    { id: 'suppliers' as Tab, label: 'Suppliers', icon: <Truck size={14} />, shortcut: 'suppliers-tab', allowed: seesSuppliers },
    { id: 'purchases' as Tab, label: 'Purchases', icon: <ShoppingCart size={14} />, shortcut: 'purchases-tab', allowed: seesPurchases },
  ].filter((t) => t.allowed);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'suppliers');

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [s, p] = await Promise.all([
        seesSuppliers ? listSuppliers(businessId) : Promise.resolve([]),
        seesPurchases ? listPurchases(businessId) : Promise.resolve([]),
      ]);
      setSuppliers(s);
      setPurchases(p);
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load suppliers and purchases. Check your connection.'));
    } finally {
      setLoading(false);
    }
  }, [businessId, seesSuppliers, seesPurchases]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => onBranchChange(() => { setSuppliers([]); setPurchases([]); }), []);

  // Per supplier: how many purchases and how much was spent (received only).
  const spend = useMemo(() => {
    const m = new Map<string, { count: number; total: number; last?: string }>();
    for (const p of purchases) {
      const key = p.supplierId || `name:${p.supplierName.toLowerCase()}`;
      const cur = m.get(key) || { count: 0, total: 0 };
      cur.count += 1;
      if (p.status === 'Received') cur.total += p.total;
      if (!cur.last || p.date > cur.last) cur.last = p.date;
      m.set(key, cur);
    }
    return m;
  }, [purchases]);
  // Older purchases have no supplier link, only a name: the person's or the company's.
  const spendFor = (s: Supplier) => {
    const parts = [spend.get(s.id), spend.get(`name:${s.name.toLowerCase()}`), s.company ? spend.get(`name:${s.company.toLowerCase()}`) : undefined]
      .filter((x, i, a): x is { count: number; total: number; last?: string } => !!x && a.indexOf(x) === i);
    if (!parts.length) return undefined;
    return parts.reduce((acc, x) => ({ count: acc.count + x.count, total: acc.total + x.total }), { count: 0, total: 0 });
  };

  const q = query.trim().toLowerCase();
  const shownSuppliers = suppliers.filter((s) =>
    !q || [s.name, s.company, s.phone, s.email, s.productSupplied].some((v) => v.toLowerCase().includes(q)));
  const shownPurchases = purchases.filter((p) => {
    if (statusFilter === 'open' && !(p.status === 'Pending' || p.status === 'Ordered')) return false;
    if (statusFilter === 'received' && p.status !== 'Received') return false;
    if (statusFilter === 'cancelled' && p.status !== 'Cancelled') return false;
    return !q || [p.supplierName, purchaseRef(p), p.notes, ...p.lines.map((l) => l.name)].some((v) => v.toLowerCase().includes(q));
  });
  const openTotal = purchases.filter((p) => p.status === 'Ordered').reduce((s, p) => s + p.total, 0);

  // ---------------------------------------------------------------- supplier form
  const [editingSupplier, setEditingSupplier] = useState<{ id?: string; draft: SupplierDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submitSupplier = async () => {
    if (!editingSupplier || !businessId || busy) return;
    const d = editingSupplier.draft;
    if (!d.name.trim()) return setFormError('Enter the supplier\'s name.');
    if (!d.phone.trim()) return setFormError('Enter a phone number to reach them.');
    if (!d.productSupplied.trim()) return setFormError('Say what they supply, e.g. Milk, Packaging.');
    setFormError(null);
    setBusy(true);
    try {
      await saveSupplier(businessId, d, editingSupplier.id, staffName);
      showToast(editingSupplier.id ? 'Supplier saved' : 'Supplier added', d.name.trim(), undefined, 'success');
      setEditingSupplier(null);
      void load();
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the supplier.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemoveSupplier = async (s: Supplier) => {
    const ok = await appDialog.confirm({
      title: `Remove ${s.name}?`,
      message: 'Past purchases keep their name. They stop showing as a supplier.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeSupplier(s.id, staffName);
      setSuppliers((list) => list.filter((x) => x.id !== s.id));
      showToast('Supplier removed', s.name, undefined, 'success');
    } catch (err) {
      showToast('Not removed', toUserMessage(err, 'Could not remove the supplier.'), undefined, 'error');
    }
  };

  // ---------------------------------------------------------------- purchase form
  const [editingPurchase, setEditingPurchase] = useState<{ id?: string; draft: PurchaseDraft } | null>(null);
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null);
  const [updateCost, setUpdateCost] = useState(false);

  const newPurchase = (supplier?: Supplier) => {
    setFormError(null);
    setEditingPurchase({
      draft: {
        supplierId: supplier?.id ?? null,
        supplierName: supplier ? supplier.company || supplier.name : '',
        reference: '',
        date: today(),
        notes: '',
        status: 'Ordered',
        lines: [blankLine()],
      },
    });
  };

  const editPurchase = (p: PurchaseOrder) => {
    setFormError(null);
    setViewing(null);
    setEditingPurchase({
      id: p.id,
      draft: {
        supplierId: p.supplierId,
        supplierName: p.supplierName,
        reference: p.reference,
        date: p.date.slice(0, 10),
        notes: p.notes,
        status: p.status === 'Pending' ? 'Pending' : 'Ordered',
        lines: p.lines.length ? p.lines.map((l) => ({ ...l })) : [blankLine()],
      },
    });
  };

  const setDraft = (patch: Partial<PurchaseDraft>) =>
    setEditingPurchase((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const setLine = (i: number, patch: Partial<PurchaseLine>) =>
    setEditingPurchase((e) => (e ? { ...e, draft: { ...e.draft, lines: e.draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) } } : e));

  const submitPurchase = async (status: 'Pending' | 'Ordered') => {
    if (!editingPurchase || !businessId || busy) return;
    const d = { ...editingPurchase.draft, status };
    const lines = d.lines.filter((l) => l.name.trim() && Number(l.quantity) > 0);
    if (!d.supplierName.trim()) return setFormError('Choose or type who you are buying from.');
    if (!lines.length) return setFormError('Add at least one item with a quantity.');
    if (lines.some((l) => Number(l.price) < 0)) return setFormError('Prices can\'t be below zero.');
    setFormError(null);
    setBusy(true);
    try {
      await savePurchase(businessId, d, staffName, editingPurchase.id);
      showToast(editingPurchase.id ? 'Purchase saved' : 'Purchase recorded', `${d.supplierName} · ${formatCurrency(lineTotal(lines))}`, undefined, 'success');
      setEditingPurchase(null);
      setStatusFilter('open');
      void load();
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the purchase.'));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (p: PurchaseOrder, status: 'Ordered' | 'Cancelled') => {
    if (status === 'Cancelled') {
      const ok = await appDialog.confirm({
        title: `Cancel ${purchaseRef(p)}?`,
        message: 'Nothing is added to stock. It stays in the list as cancelled.',
        confirmLabel: 'Cancel purchase',
        cancelLabel: 'Keep it',
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await setPurchaseStatus(p.id, status);
      setViewing(null);
      void load();
    } catch (err) {
      showToast('Not changed', toUserMessage(err, 'Could not change the purchase.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const receive = async (p: PurchaseOrder) => {
    setBusy(true);
    try {
      const stocked = await receivePurchase(p.id, staffName, updateCost);
      const notLinked = p.lines.filter((l) => !l.productId).length;
      showToast(
        'Purchase received',
        `${stocked} ${stocked === 1 ? 'item' : 'items'} added to stock${notLinked ? `; ${notLinked} not linked to a product, so not stocked` : ''}.`,
        undefined,
        'success',
      );
      setViewing(null);
      setUpdateCost(false);
      void load();
    } catch (err) {
      showToast('Not received', toUserMessage(err, 'Could not receive the purchase.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const removePurchase = async (p: PurchaseOrder) => {
    const ok = await appDialog.confirm({
      title: `Delete ${purchaseRef(p)}?`,
      message: 'It is removed for good. Only drafts and cancelled purchases can be deleted.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deletePurchase(p.id);
      setViewing(null);
      setPurchases((list) => list.filter((x) => x.id !== p.id));
    } catch (err) {
      showToast('Not deleted', toUserMessage(err, 'Could not delete the purchase.'), undefined, 'error');
    }
  };

  const productItems = useMemo(
    () => products.map((p) => ({ id: p.id, label: p.name, sublabel: `${p.stock} ${p.unit} in stock · cost ${formatCurrency(p.cost)}` })),
    [products],
  );
  const supplierItems = suppliers.map((s) => ({ id: s.id, label: s.name, sublabel: [s.company, s.productSupplied].filter(Boolean).join(' · ') }));

  if (!tabs.length) {
    return <div className="h-full grid place-items-center p-6 text-sm text-app-text-muted">Your role can't see suppliers or purchases.</div>;
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-5xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {tabs.length > 1 && <Tabs<Tab> tabs={tabs} activeTab={tab} onChange={(t) => { setTab(t); setQuery(''); }} className="w-full sm:w-auto sm:flex-1 min-w-0 !pb-2" />}
          {tab === 'suppliers' && canAddSupplier && (
            <button data-shortcut="new" onClick={() => { setFormError(null); setEditingSupplier({ draft: { ...emptySupplier } }); }} className={`${primaryBtn} ml-auto`}>
              <Plus size={16} /> Add supplier
            </button>
          )}
          {tab === 'purchases' && canCreatePurchase && (
            <button data-shortcut="new" onClick={() => newPurchase()} className={`${primaryBtn} ml-auto`}>
              <Plus size={16} /> New purchase
            </button>
          )}
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'suppliers' ? 'Search suppliers by name, phone or what they supply' : 'Search by supplier, number or item'}
            className={`${fieldClass} pl-9 bg-app-card`}
          />
        </div>

        {tab === 'purchases' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-app-card rounded-xl p-1 ring-1 ring-app-border">
              {([['open', 'Open'], ['received', 'Received'], ['cancelled', 'Cancelled'], ['all', 'All']] as [StatusFilter, string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setStatusFilter(id)}
                  aria-pressed={statusFilter === id}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${statusFilter === id ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {openTotal > 0 && <span className="text-xs text-app-text-muted">On order: <b className="text-app-text tabular-nums">{formatCurrency(openTotal)}</b></span>}
          </div>
        )}

        {loading ? (
          <p className="p-6 text-sm text-app-text-muted text-center">Loading…</p>
        ) : loadError ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-sm text-app-text underline cursor-pointer">
              <RotateCcw size={14} /> Try again
            </button>
          </div>
        ) : tab === 'suppliers' ? (
          shownSuppliers.length === 0 ? (
            <p className="p-6 text-sm text-app-text-muted text-center">
              {suppliers.length ? 'No supplier matches that search.' : 'No suppliers yet. Add the people and companies you buy stock from.'}
            </p>
          ) : (
            <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
              {shownSuppliers.map((s) => {
                const stats = spendFor(s);
                return (
                  <SwipeRow
                    key={s.id}
                    as="li"
                    searchId={`sup-${s.id}`}
                    title={s.name}
                    subtitle={[s.company, s.phone].filter(Boolean).join(' · ')}
                    onClick={() => canEditSupplier && (setFormError(null), setEditingSupplier({ id: s.id, draft: { ...s } }))}
                    actions={[{ label: 'Remove', icon: <Trash2 size={18} />, tone: 'red', hidden: !canDeleteSupplier, onClick: () => void confirmRemoveSupplier(s) }]}
                    more={[
                      { label: 'Edit', icon: <Pencil size={16} />, hidden: !canEditSupplier, onClick: () => setEditingSupplier({ id: s.id, draft: { ...s } }) },
                      { label: 'New purchase', icon: <ShoppingCart size={16} />, hidden: !canCreatePurchase, onClick: () => { setTab('purchases'); newPurchase(s); } },
                      { label: 'Remove', icon: <Trash2 size={16} />, danger: true, hidden: !canDeleteSupplier, onClick: () => void confirmRemoveSupplier(s) },
                    ]}
                    contentClassName={`flex items-start gap-3 px-4 py-3 ${canEditSupplier ? 'cursor-pointer hover:bg-app-bg/50' : ''}`}
                  >
                    <span className="grid place-items-center size-9 shrink-0 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-sm font-semibold">
                      {s.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-app-text truncate">{s.name}{s.company && s.company !== s.name ? <span className="text-app-text-muted font-normal"> · {s.company}</span> : null}</p>
                      <p className="text-[11px] text-app-text-muted mt-0.5 break-words">
                        Supplies {s.productSupplied || '—'}
                        {stats ? ` · ${stats.count} ${stats.count === 1 ? 'purchase' : 'purchases'}${stats.total ? `, ${formatCurrency(stats.total)} received` : ''}` : ''}
                      </p>
                      {s.notes && <p className="text-[11px] text-app-text-muted mt-0.5 line-clamp-2">{s.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {s.phone && (
                        <a href={`tel:${s.phone}`} aria-label={`Call ${s.name}`} title={s.phone} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg">
                          <Phone size={15} />
                        </a>
                      )}
                      {s.email && (
                        <a href={`mailto:${s.email}`} aria-label={`Email ${s.name}`} title={s.email} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg hidden sm:block">
                          <Mail size={15} />
                        </a>
                      )}
                      {canCreatePurchase && seesPurchases && (
                        <button onClick={() => { setTab('purchases'); newPurchase(s); }} title="New purchase from this supplier" aria-label={`New purchase from ${s.name}`} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer">
                          <ShoppingCart size={15} />
                        </button>
                      )}
                    </div>
                  </SwipeRow>
                );
              })}
            </ul>
          )
        ) : shownPurchases.length === 0 ? (
          <p className="p-6 text-sm text-app-text-muted text-center">
            {purchases.length ? 'No purchase in this list matches.' : 'No purchases yet. Record what you order from suppliers, then receive it into stock when it arrives.'}
          </p>
        ) : (
          <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
            {shownPurchases.map((p) => (
              <SwipeRow
                key={p.id}
                as="li"
                searchId={`pur-${p.id}`}
                title={`${purchaseRef(p)} · ${p.supplierName}`}
                subtitle={`${formatCurrency(p.total)} · ${STATUS_WORD[p.status]}`}
                onClick={() => { setUpdateCost(false); setViewing(p); }}
                actions={[{
                  label: 'Delete', icon: <Trash2 size={18} />, tone: 'red',
                  hidden: !canCancelPurchase || !(p.status === 'Pending' || p.status === 'Cancelled'),
                  onClick: () => void removePurchase(p),
                }]}
                contentClassName="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-app-bg/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-app-text truncate">{p.supplierName}</p>
                  <p className="text-[11px] text-app-text-muted mt-0.5 truncate">
                    {purchaseRef(p)} · {shortDate(p.date)} · {p.lines.length} {p.lines.length === 1 ? 'item' : 'items'}
                    {p.lines.length ? `: ${p.lines.slice(0, 3).map((l) => l.name).join(', ')}${p.lines.length > 3 ? '…' : ''}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-app-text tabular-nums">{formatCurrency(p.total)}</p>
                  <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[p.status]}`}>{STATUS_WORD[p.status]}</span>
                </div>
              </SwipeRow>
            ))}
          </ul>
        )}
      </div>

      {/* Supplier form */}
      {editingSupplier && (
        <FormSheet
          title={editingSupplier.id ? 'Edit supplier' : 'Add supplier'}
          onClose={() => setEditingSupplier(null)}
          footer={
            <>
              {editingSupplier.id && canDeleteSupplier && (
                <button
                  className={`${secondaryBtn} mr-auto text-red-600`}
                  onClick={() => { const s = suppliers.find((x) => x.id === editingSupplier.id); setEditingSupplier(null); if (s) void confirmRemoveSupplier(s); }}
                >
                  <Trash2 size={15} /> Remove
                </button>
              )}
              <button className={secondaryBtn} onClick={() => setEditingSupplier(null)}>Cancel</button>
              <button className={primaryBtn} disabled={busy} onClick={() => void submitSupplier()}>{busy ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          {(['name', 'company', 'phone', 'email', 'productSupplied'] as const).map((k) => (
            <Field key={k} label={{ name: 'Name', company: 'Company (optional)', phone: 'Phone', email: 'Email (optional)', productSupplied: 'What they supply' }[k]}>
              <input
                autoFocus={k === 'name'}
                type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'}
                inputMode={k === 'phone' ? 'tel' : undefined}
                value={editingSupplier.draft[k]}
                onChange={(e) => setEditingSupplier({ ...editingSupplier, draft: { ...editingSupplier.draft, [k]: e.target.value } })}
                placeholder={k === 'productSupplied' ? 'e.g. Milk, Packaging, Sugar' : k === 'phone' ? 'e.g. 0712 345 678' : ''}
                maxLength={k === 'email' ? 120 : 80}
                className={fieldClass}
              />
            </Field>
          ))}
          <Field label="Notes (optional)">
            <textarea
              rows={2}
              value={editingSupplier.draft.notes}
              onChange={(e) => setEditingSupplier({ ...editingSupplier, draft: { ...editingSupplier.draft, notes: e.target.value } })}
              placeholder="Delivery days, payment terms, account number…"
              maxLength={500}
              className={fieldClass}
            />
          </Field>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
        </FormSheet>
      )}

      {/* Purchase form */}
      {editingPurchase && (
        <FormSheet
          wide
          title={editingPurchase.id ? `Edit ${purchaseRef({ id: editingPurchase.id, reference: editingPurchase.draft.reference })}` : 'New purchase'}
          subtitle="Link each item to a product so receiving it adds to stock."
          onClose={() => setEditingPurchase(null)}
          footer={
            <>
              <span className="mr-auto self-center text-sm">Total <b className="tabular-nums">{formatCurrency(lineTotal(editingPurchase.draft.lines))}</b></span>
              <button className={secondaryBtn} disabled={busy} onClick={() => void submitPurchase('Pending')}>
                Save as draft
              </button>
              <button className={primaryBtn} disabled={busy} onClick={() => void submitPurchase('Ordered')}>
                <Send size={15} /> {busy ? 'Saving…' : 'Save as ordered'}
              </button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier">
              {suppliers.length ? (
                <SearchableDropdown
                  items={supplierItems}
                  selectedValue={editingPurchase.draft.supplierId || ''}
                  onChange={(id) => {
                    const s = suppliers.find((x) => x.id === id);
                    if (s) setDraft({ supplierId: s.id, supplierName: s.company || s.name });
                  }}
                  placeholder={editingPurchase.draft.supplierName || 'Choose a supplier'}
                  searchPlaceholder="Search suppliers"
                />
              ) : (
                <input value={editingPurchase.draft.supplierName} onChange={(e) => setDraft({ supplierName: e.target.value, supplierId: null })} placeholder="Who you are buying from" className={fieldClass} />
              )}
            </Field>
            <Field label="Date">
              <input type="date" value={editingPurchase.draft.date} onChange={(e) => setDraft({ date: e.target.value })} className={fieldClass} />
            </Field>
            <Field label="Their invoice or order number (optional)">
              <input value={editingPurchase.draft.reference} onChange={(e) => setDraft({ reference: e.target.value })} maxLength={40} placeholder="Left empty, one is made for you" className={fieldClass} />
            </Field>
            <Field label="Notes (optional)">
              <input value={editingPurchase.draft.notes} onChange={(e) => setDraft({ notes: e.target.value })} maxLength={300} className={fieldClass} />
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-app-text-muted">Items</p>
            {editingPurchase.draft.lines.map((l, i) => (
              <div key={i} className="rounded-2xl ring-1 ring-app-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <SearchableDropdown
                      items={productItems}
                      selectedValue={l.productId || ''}
                      onChange={(id) => {
                        const p = products.find((x) => x.id === id);
                        if (p) setLine(i, { productId: p.id, name: p.name, unit: p.unit || l.unit, price: l.price || p.cost || 0 });
                      }}
                      placeholder={l.productId ? l.name : 'Link a product (adds to its stock)'}
                      searchPlaceholder="Search products"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft({ lines: editingPurchase.draft.lines.length > 1 ? editingPurchase.draft.lines.filter((_, j) => j !== i) : [blankLine()] })}
                    aria-label="Remove this item"
                    className="p-2 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-app-bg cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
                  <input
                    value={l.name}
                    onChange={(e) => setLine(i, { name: e.target.value })}
                    placeholder="Item name"
                    aria-label="Item name"
                    className={`${fieldClass} col-span-2 sm:col-span-1`}
                  />
                  <input type="number" inputMode="decimal" min="0" step="any" value={l.quantity || ''} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} placeholder="Qty" aria-label="Quantity" className={fieldClass} />
                  <input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} placeholder="Unit" aria-label="Unit" maxLength={16} className={fieldClass} />
                  <input type="number" inputMode="decimal" min="0" step="any" value={l.price || ''} onChange={(e) => setLine(i, { price: Number(e.target.value) })} placeholder="Price each" aria-label="Price per unit" className={`${fieldClass} col-span-2 sm:col-span-1`} />
                </div>
                <p className="text-[11px] text-app-text-muted text-right tabular-nums">
                  {!l.productId && l.name ? 'Not linked: not added to stock · ' : ''}
                  {formatCurrency((Number(l.quantity) || 0) * (Number(l.price) || 0))}
                </p>
              </div>
            ))}
            <button type="button" onClick={() => setDraft({ lines: [...editingPurchase.draft.lines, blankLine()] })} className={`${secondaryBtn} w-full`}>
              <Plus size={15} /> Add item
            </button>
          </div>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
        </FormSheet>
      )}

      {/* Purchase details */}
      {viewing && (
        <FormSheet
          wide
          title={`${purchaseRef(viewing)} · ${viewing.supplierName}`}
          subtitle={`${STATUS_WORD[viewing.status]} · ${shortDate(viewing.date)}${viewing.createdBy ? ` · by ${viewing.createdBy}` : ''}${viewing.receivedAt ? ` · received ${shortDate(viewing.receivedAt)} by ${viewing.receivedBy || 'staff'}` : ''}`}
          onClose={() => setViewing(null)}
          footer={
            viewing.status === 'Received' || viewing.status === 'Cancelled' ? (
              <>
                {viewing.status === 'Cancelled' && canCancelPurchase && (
                  <button className={`${secondaryBtn} mr-auto text-red-600`} onClick={() => void removePurchase(viewing)}><Trash2 size={15} /> Delete</button>
                )}
                <button className={secondaryBtn} onClick={() => setViewing(null)}>Close</button>
              </>
            ) : (
              <>
                {canCancelPurchase && <button className={`${secondaryBtn} mr-auto`} disabled={busy} onClick={() => void changeStatus(viewing, 'Cancelled')}><Ban size={15} /> Cancel</button>}
                {canEditPurchase && <button className={secondaryBtn} disabled={busy} onClick={() => editPurchase(viewing)}><Pencil size={15} /> Edit</button>}
                {viewing.status === 'Pending' && canEditPurchase && (
                  <button className={secondaryBtn} disabled={busy} onClick={() => void changeStatus(viewing, 'Ordered')}><Send size={15} /> Mark ordered</button>
                )}
                {canReceive && (
                  <button className={primaryBtn} disabled={busy} onClick={() => void receive(viewing)}><PackageCheck size={15} /> {busy ? 'Receiving…' : 'Receive into stock'}</button>
                )}
              </>
            )
          }
        >
          <div className="rounded-2xl ring-1 ring-app-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-app-bg text-[11px] text-app-text-muted">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Item</th>
                  <th className="text-right font-medium px-3 py-2">Qty</th>
                  <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Each</th>
                  <th className="text-right font-medium px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/60">
                {viewing.lines.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-3 text-xs text-app-text-muted">No items listed. {canEditPurchase && viewing.status !== 'Received' && viewing.status !== 'Cancelled' ? 'Edit it to add what was ordered; receiving adds only listed items to stock.' : ''}</td></tr>
                )}
                {viewing.lines.map((l, i) => (
                  <tr key={l.id || i}>
                    <td className="px-3 py-2">
                      {l.name}
                      {!l.productId && viewing.status !== 'Received' && viewing.status !== 'Cancelled' && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400">Not linked to a product: not added to stock</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{l.quantity} {l.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">{formatCurrency(l.price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.quantity * l.price)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-app-bg font-semibold">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="hidden sm:table-cell" />
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(viewing.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {viewing.notes && <p className="text-sm text-app-text-muted">{viewing.notes}</p>}
          {canReceive && (viewing.status === 'Pending' || viewing.status === 'Ordered') && (
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="mt-0.5 accent-amber-500" />
              <span>
                Set each product's cost to the price paid here
                <span className="block text-[11px] text-app-text-muted">Profit on later sales uses the new cost.</span>
              </span>
            </label>
          )}
        </FormSheet>
      )}
    </div>
  );
}
