// Suppliers & Purchases: who you buy from, and what you ordered from them.
// A purchase goes Draft → (Asking prices) → (Needs approval) → Ordered → Part received →
// Received, or Cancelled. Placing an order above the person's approval limit waits for
// someone allowed that amount. Receiving counts what came in good order (into stock) and
// damaged (noted, still owed); each delivery is a GRN. Then the supplier's bill is entered
// against the deliveries, and goods can be sent back. The database enforces all of it
// (20261118001_smarter_buying.sql).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Truck, Plus, Search, Phone, Mail, Pencil, Trash2, PackageCheck, Send, Ban, RotateCcw, ShoppingCart, X,
  ShieldCheck, MessageCircle, MessageSquare, FileText, Undo2, Lock, Undo,
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
  listSuppliers, saveSupplier, removeSupplier, listPurchases, savePurchase, setPurchaseStatus,
  deletePurchase, purchaseRef, lineTotal, OPEN_PURCHASE,
  type Supplier, type SupplierDraft, type PurchaseOrder, type PurchaseDraft, type PurchaseLine, type PurchaseStatus,
} from '../services/operations';
import {
  approvePurchase, askSupplierPrices, chooseSupplierQuote, closePurchase, listBranches, loadBuyingOverview, loadPurchaseDetails,
  placePurchaseOrder, rejectPurchase, rfqMessage, saveSupplierQuote,
  type Branch, type PurchaseDetails, type SupplierQuote,
} from '../services/buying';
import { BillSheet, ReasonSheet, ReceiveSheet, ReturnSheet } from '../components/buying/BuyingSheets';
import { ReceiptShareService } from '../services/receipt/ReceiptShareService';

type Tab = 'suppliers' | 'purchases';
type StatusFilter = 'open' | 'received' | 'cancelled' | 'all';

const STATUS_STYLE: Record<PurchaseStatus, string> = {
  Pending: 'bg-slate-500/15 text-app-text-muted',
  RFQ: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'Awaiting approval': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  Ordered: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'Part received': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  Received: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Cancelled: 'bg-red-500/15 text-red-700 dark:text-red-300',
};
const STATUS_WORD: Record<PurchaseStatus, string> = {
  Pending: 'Draft', RFQ: 'Asking prices', 'Awaiting approval': 'Needs approval', Ordered: 'Ordered',
  'Part received': 'Part received', Received: 'Received', Cancelled: 'Cancelled',
};

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
  const canAskPrices = can('purchases.request_quote');
  const canApprove = can('purchases.approve');
  const canBill = can('supplier_bills.manage');
  const canReturn = (can('purchases.update') || can('purchases.manage') || can('purchases.approve'))
    && (can('inventory.adjust_stock') || can('inventory.receive_stock'));
  const businessName = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name) || 'We';

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
  useEffect(() => onBranchChange(() => { setSuppliers([]); setPurchases([]); setBranches([]); }), []);

  // Other branches, for buying on their behalf (central buying).
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tolerancePct, setTolerancePct] = useState(2);
  useEffect(() => {
    if (!businessId || !canCreatePurchase) return;
    let live = true;
    listBranches(businessId).then((b) => live && setBranches(b)).catch(() => live && setBranches([]));
    if (canBill) loadBuyingOverview(businessId).then((o) => live && setTolerancePct(o.settings.tolerancePct)).catch(() => undefined);
    return () => { live = false; };
  }, [businessId, canCreatePurchase, canBill]);
  const branchName = (id?: string | null) => (id ? branches.find((b) => b.id === id)?.name || 'another branch' : undefined);

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
    if (statusFilter === 'open' && !OPEN_PURCHASE.includes(p.status)) return false;
    if (statusFilter === 'received' && p.status !== 'Received') return false;
    if (statusFilter === 'cancelled' && p.status !== 'Cancelled') return false;
    return !q || [p.supplierName, purchaseRef(p), p.notes, ...p.lines.map((l) => l.name)].some((v) => v.toLowerCase().includes(q));
  });
  const openTotal = purchases
    .filter((p) => p.status === 'Ordered' || p.status === 'Part received')
    .reduce((s, p) => s + p.lines.reduce((t, l) => t + Math.max(l.quantity - (l.received || 0), 0) * l.price, 0), 0);

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
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = purchases.find((p) => p.id === viewingId) || null;
  const setViewing = (p: PurchaseOrder | null) => setViewingId(p?.id ?? null);
  const [details, setDetails] = useState<PurchaseDetails | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [billing, setBilling] = useState<PurchaseOrder | null>(null);
  const [returning, setReturning] = useState<PurchaseOrder | null>(null);
  const [asking, setAsking] = useState<PurchaseOrder | null>(null);
  const [pricing, setPricing] = useState<{ purchase: PurchaseOrder; quote: SupplierQuote } | null>(null);
  const [reasonFor, setReasonFor] = useState<{ kind: 'reject' | 'close'; purchase: PurchaseOrder } | null>(null);

  const reloadDetails = useCallback(async (id: string) => {
    try {
      setDetails(await loadPurchaseDetails(id));
    } catch {
      setDetails(null);
    }
  }, []);
  useEffect(() => {
    setDetails(null);
    if (viewingId) void reloadDetails(viewingId);
  }, [viewingId, reloadDetails]);


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
        status: p.status === 'Pending' || p.status === 'RFQ' ? 'Pending' : 'Ordered',
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
      const saved = await savePurchase(businessId, d, staffName, editingPurchase.id);
      if (saved.status === 'Awaiting approval') {
        showToast('Waiting for approval', `${d.supplierName} · ${formatCurrency(lineTotal(lines))} is above your limit. It is ordered once someone approves it.`, undefined, 'info');
      } else {
        showToast(editingPurchase.id ? 'Purchase saved' : 'Purchase recorded', `${d.supplierName} · ${formatCurrency(lineTotal(lines))}`, undefined, 'success');
      }
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
      if (status === 'Ordered') {
        const result = await placePurchaseOrder(p.id);
        showToast(
          result === 'Ordered' ? 'Order placed' : 'Waiting for approval',
          result === 'Ordered' ? `${purchaseRef(p)} to ${p.supplierName}.` : `${purchaseRef(p)} is above your limit. Someone who can approve ${formatCurrency(p.total)} has been told.`,
          undefined,
          result === 'Ordered' ? 'success' : 'info',
        );
      } else {
        await setPurchaseStatus(p.id, status);
        setViewing(null);
      }
      void load();
    } catch (err) {
      showToast('Not changed', toUserMessage(err, 'Could not change the purchase.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const receive = (p: PurchaseOrder) => setReceiving({ ...p, lines: p.lines.map((l) => ({ ...l, forBranchName: branchName(l.forBusinessId) })) });

  const approve = async (p: PurchaseOrder) => {
    setBusy(true);
    try {
      await approvePurchase(p.id);
      showToast('Approved', `${purchaseRef(p)} to ${p.supplierName} is ordered.`, undefined, 'success');
      void load();
      void reloadDetails(p.id);
    } catch (err) {
      showToast('Not approved', toUserMessage(err, 'Could not approve the purchase.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const backToDraft = async (p: PurchaseOrder) => {
    setBusy(true);
    try {
      await setPurchaseStatus(p.id, 'Pending');
      void load();
    } catch (err) {
      showToast('Not changed', toUserMessage(err, 'Could not change the purchase.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (p: PurchaseOrder, q: SupplierQuote) => {
    const ok = await appDialog.confirm({
      title: `Order from ${q.supplier}?`,
      message: `Their prices become the order (${formatCurrency(q.total)}). Items they can't supply are taken off. The other suppliers are marked as not chosen.`,
      confirmLabel: 'Order from them',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await chooseSupplierQuote(q.id);
      showToast(
        result === 'Ordered' ? 'Order placed' : 'Waiting for approval',
        result === 'Ordered' ? `${purchaseRef(p)} to ${q.supplier}.` : `${formatCurrency(q.total)} is above your limit; it is ordered once approved.`,
        undefined,
        result === 'Ordered' ? 'success' : 'info',
      );
      void load();
      void reloadDetails(p.id);
    } catch (err) {
      showToast('Not ordered', toUserMessage(err, 'Could not choose the supplier.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendRfq = (p: PurchaseOrder, q: SupplierQuote, via: 'whatsapp' | 'sms' | 'email') => {
    const text = rfqMessage(businessName, purchaseRef(p), p.lines, q.supplier);
    if (via === 'whatsapp') void ReceiptShareService.shareTextViaWhatsApp(q.phone || '', text);
    else if (via === 'sms') void ReceiptShareService.openExternalUrl(`sms:${q.phone || ''}?body=${encodeURIComponent(text)}`);
    else void ReceiptShareService.shareTextViaEmail(q.email || '', `Prices for ${purchaseRef(p)}`, text);
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

  const isOpenLike = (st: PurchaseStatus) => st === 'Pending' || st === 'RFQ' || st === 'Awaiting approval' || st === 'Ordered';

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
                onClick={() => setViewing(p)}
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
                {branches.length > 0 && l.productId && (
                  <label className="flex items-center gap-2 text-[11px] text-app-text-muted">
                    For
                    <select
                      value={l.forBusinessId || ''}
                      onChange={(e) => setLine(i, { forBusinessId: e.target.value || null })}
                      className="bg-app-bg border border-app-border rounded-lg px-2 py-1 text-xs text-app-text"
                    >
                      <option value="">This branch</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name} (sent on after it arrives)</option>)}
                    </select>
                  </label>
                )}
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
          subtitle={`${STATUS_WORD[viewing.status]} · ${shortDate(viewing.date)}${viewing.createdBy ? ` · by ${viewing.createdBy}` : ''}${viewing.approvedBy ? ` · approved by ${viewing.approvedBy}` : ''}${viewing.receivedAt ? ` · last received ${shortDate(viewing.receivedAt)} by ${viewing.receivedBy || 'staff'}` : ''}`}
          onClose={() => setViewing(null)}
          footer={
            <>
              {viewing.status === 'Cancelled' && canCancelPurchase && (
                <button className={`${secondaryBtn} mr-auto text-red-600`} onClick={() => void removePurchase(viewing)}><Trash2 size={15} /> Delete</button>
              )}
              {isOpenLike(viewing.status) && canCancelPurchase && (
                <button className={`${secondaryBtn} mr-auto`} disabled={busy} onClick={() => void changeStatus(viewing, 'Cancelled')}><Ban size={15} /> Cancel</button>
              )}
              {viewing.status === 'Part received' && canEditPurchase && (
                <button className={`${secondaryBtn} mr-auto`} disabled={busy} onClick={() => setReasonFor({ kind: 'close', purchase: viewing })}><Lock size={15} /> Close, rest not coming</button>
              )}
              {(viewing.status === 'Pending' || viewing.status === 'RFQ' || viewing.status === 'Ordered') && canEditPurchase && (
                <button className={secondaryBtn} disabled={busy} onClick={() => editPurchase(viewing)}><Pencil size={15} /> Edit</button>
              )}
              {viewing.status === 'RFQ' && canEditPurchase && (
                <button className={secondaryBtn} disabled={busy} onClick={() => void backToDraft(viewing)}><Undo size={15} /> Back to draft</button>
              )}
              {(viewing.status === 'Pending' || viewing.status === 'RFQ') && canAskPrices && suppliers.length > 0 && (
                <button className={secondaryBtn} disabled={busy} onClick={() => setAsking(viewing)}><MessageCircle size={15} /> Ask for prices</button>
              )}
              {viewing.status === 'Pending' && (canEditPurchase || canCreatePurchase) && (
                <button className={primaryBtn} disabled={busy} onClick={() => void changeStatus(viewing, 'Ordered')}><Send size={15} /> Place order</button>
              )}
              {viewing.status === 'Awaiting approval' && canApprove && (
                <>
                  <button className={secondaryBtn} disabled={busy} onClick={() => setReasonFor({ kind: 'reject', purchase: viewing })}><Undo2 size={15} /> Not approved</button>
                  <button className={primaryBtn} disabled={busy} onClick={() => void approve(viewing)}><ShieldCheck size={15} /> Approve</button>
                </>
              )}
              {(viewing.status === 'Part received' || viewing.status === 'Received') && canReturn && (
                <button className={secondaryBtn} onClick={() => setReturning(viewing)}><Undo2 size={15} /> Return goods</button>
              )}
              {details && details.unbilledValue > 0 && canBill && (
                <button className={secondaryBtn} onClick={() => setBilling(viewing)}><FileText size={15} /> Enter their bill</button>
              )}
              {(viewing.status === 'Ordered' || viewing.status === 'Part received') && canReceive && (
                <button className={primaryBtn} disabled={busy} onClick={() => receive(viewing)}><PackageCheck size={15} /> Receive</button>
              )}
              {(viewing.status === 'Received' || viewing.status === 'Cancelled') && <button className={secondaryBtn} onClick={() => setViewing(null)}>Close</button>}
            </>
          }
        >
          {viewing.status === 'Awaiting approval' && (
            <p className="text-xs rounded-xl bg-violet-500/10 text-violet-800 dark:text-violet-300 p-3">
              {formatCurrency(viewing.total)} is above the limit of the person who placed it. It is ordered once someone allowed that amount approves it.
              {!canApprove && ' You can still edit or cancel it.'}
            </p>
          )}
          {viewing.status === 'Pending' && viewing.rejectReason && (
            <p className="text-xs rounded-xl bg-red-500/10 text-red-800 dark:text-red-300 p-3">
              Not approved by {viewing.rejectedBy || 'a manager'}: {viewing.rejectReason}. Change it and place it again, or cancel it.
            </p>
          )}
          {viewing.closedNote && <p className="text-xs rounded-xl bg-app-bg text-app-text-muted p-3">Closed with the rest not coming: {viewing.closedNote}</p>}

          <div className="rounded-2xl ring-1 ring-app-border overflow-x-auto">
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
                  <tr><td colSpan={4} className="px-3 py-3 text-xs text-app-text-muted">No items listed. {canEditPurchase && isOpenLike(viewing.status) ? 'Edit it to add what was ordered; receiving adds only listed items to stock.' : ''}</td></tr>
                )}
                {viewing.lines.map((l, i) => (
                  <tr key={l.id || i}>
                    <td className="px-3 py-2">
                      {l.name}
                      {l.forBusinessId && <span className="block text-[10px] text-app-text-muted">For {branchName(l.forBusinessId)}</span>}
                      {!l.productId && isOpenLike(viewing.status) && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400">Not linked to a product: not added to stock</span>
                      )}
                      {((l.received || 0) > 0 || (l.damaged || 0) > 0) && (
                        <span className="block text-[10px] text-app-text-muted">
                          {l.received || 0} in{(l.damaged || 0) > 0 ? ` · ${l.damaged} damaged` : ''}
                          {l.quantity - (l.received || 0) > 0 && viewing.status !== 'Received' ? ` · ${Math.round((l.quantity - (l.received || 0)) * 1000) / 1000} to come` : ''}
                        </span>
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
          {viewing.notes && <p className="text-sm text-app-text-muted whitespace-pre-line">{viewing.notes}</p>}

          {details && details.quotes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-app-text-muted">Prices from suppliers</p>
              {details.quotes.map((q) => (
                <div key={q.id} className="rounded-2xl ring-1 ring-app-border p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{q.supplier}</p>
                      <p className="text-[11px] text-app-text-muted">
                        {q.status === 'asked' ? `Asked ${shortDate(q.askedAt)}${q.sentVia ? ` by ${q.sentVia}` : ''}, no prices yet`
                          : q.status === 'priced' ? `${formatCurrency(q.total)}${q.deliveryDays !== null ? ` · delivers in ${q.deliveryDays} days` : ''}${q.lines.some((l) => !l.available) ? ' · not everything' : ''}`
                          : q.status === 'won' ? `Chosen · ${formatCurrency(q.total)}` : `Not chosen · ${formatCurrency(q.total)}`}
                      </p>
                      {q.note && <p className="text-[11px] text-app-text-muted">{q.note}</p>}
                    </div>
                    {viewing.status === 'RFQ' && q.status === 'priced' && canAskPrices && (
                      <button className={`${primaryBtn} !px-3 !py-1.5 text-xs`} disabled={busy} onClick={() => void choose(viewing, q)}>Order from them</button>
                    )}
                  </div>
                  {viewing.status === 'RFQ' && (q.status === 'asked' || q.status === 'priced') && canAskPrices && (
                    <div className="flex flex-wrap gap-1.5">
                      {q.phone && <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => sendRfq(viewing, q, 'whatsapp')}><MessageCircle size={13} /> WhatsApp</button>}
                      {q.phone && <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => sendRfq(viewing, q, 'sms')}><MessageSquare size={13} /> SMS</button>}
                      {q.email && <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => sendRfq(viewing, q, 'email')}><Mail size={13} /> Email</button>}
                      <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => setPricing({ purchase: viewing, quote: q })}><Pencil size={13} /> {q.status === 'asked' ? 'Enter their prices' : 'Change prices'}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {details && details.receipts.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-app-text-muted">Goods received</p>
              {details.receipts.map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-[12px] rounded-xl bg-app-bg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-app-text">{r.number} · {shortDate(r.receivedAt)}{r.by ? ` · ${r.by}` : ''}</p>
                    <p className="text-[11px] text-app-text-muted">
                      {r.lines.map((l) => `${l.name} ${l.received}${l.damaged ? ` (+${l.damaged} damaged)` : ''}`).join(', ')}
                      {r.note ? ` · ${r.note}` : ''}
                    </p>
                  </div>
                  <span className="text-right shrink-0">
                    <span className="block tabular-nums">{formatCurrency(r.value)}</span>
                    <span className="block text-[10px] text-app-text-muted">{r.billNumber ? `Billed ${r.billNumber}` : 'Not billed'}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {details && (details.bills.length > 0 || details.returns.length > 0 || details.transfers.length > 0) && (
            <div className="text-[12px] text-app-text-muted space-y-0.5">
              {details.bills.map((b) => <p key={b.id}>Bill {b.number}: {formatCurrency(b.total)} · {b.status === 'needs_check' ? 'needs a check' : b.status === 'void' ? 'void' : b.balance > 0 ? `${formatCurrency(b.balance)} to pay` : 'paid'}</p>)}
              {details.returns.map((r) => <p key={r.id}>Returned {r.number}: {formatCurrency(r.total)}</p>)}
              {details.transfers.map((t) => <p key={t.id}>Transfer {t.reference} to {t.toName}: {t.status === 'draft' ? 'drafted, not sent' : t.status.replace('_', ' ')}</p>)}
            </div>
          )}
        </FormSheet>
      )}

      {receiving && (
        <ReceiveSheet
          purchase={receiving}
          onClose={() => setReceiving(null)}
          onDone={(r) => {
            setReceiving(null);
            showToast(
              r.complete ? 'Everything received' : 'Goods received',
              `${r.number}: ${formatCurrency(r.value)} into stock${r.damagedValue > 0 ? `, ${formatCurrency(r.damagedValue)} damaged` : ''}.${r.complete ? '' : ' The rest stays open.'}${r.transfersDrafted ? ` ${r.transfersDrafted} transfer${r.transfersDrafted === 1 ? '' : 's'} to other branches drafted on Stock Transfers.` : ''}`,
              undefined,
              'success',
            );
            void load();
            if (viewingId) void reloadDetails(viewingId);
          }}
        />
      )}

      {billing && details && businessId && (
        <BillSheet
          businessId={businessId}
          purchaseId={billing.id}
          purchaseRef={purchaseRef(billing)}
          supplier={billing.supplierName}
          receipts={details.receipts.filter((r) => !r.billId).map((r) => ({ id: r.id, number: r.number, receivedAt: r.receivedAt, value: r.value }))}
          tolerancePct={tolerancePct}
          onClose={() => setBilling(null)}
          onDone={(r) => {
            setBilling(null);
            showToast(
              r.status === 'needs_check' ? 'Bill saved, needs a check' : 'Bill saved',
              r.status === 'needs_check' ? `${r.number} differs from the goods received; someone who approves purchases checks it on Buying.` : `${r.number} is now owed to ${billing.supplierName}.`,
              undefined,
              r.status === 'needs_check' ? 'info' : 'success',
            );
            if (viewingId) void reloadDetails(viewingId);
          }}
        />
      )}

      {returning && businessId && (
        <ReturnSheet
          businessId={businessId}
          suppliers={suppliers}
          purchases={purchases}
          products={products}
          initialPurchaseId={returning.id}
          onClose={() => setReturning(null)}
          onDone={(r) => {
            setReturning(null);
            showToast('Goods returned', `${r.number}: you owe ${formatCurrency(r.total)} less.`, undefined, 'success');
            if (viewingId) void reloadDetails(viewingId);
          }}
        />
      )}

      {reasonFor && (
        <ReasonSheet
          title={reasonFor.kind === 'reject' ? `Don't approve ${purchaseRef(reasonFor.purchase)}?` : `Close ${purchaseRef(reasonFor.purchase)}?`}
          message={reasonFor.kind === 'reject' ? 'It goes back to a draft and the person who placed it is told why.' : 'What has arrived stays; the rest is no longer expected.'}
          placeholder={reasonFor.kind === 'reject' ? 'e.g. Buy half this week' : 'e.g. Supplier out of stock'}
          confirmLabel={reasonFor.kind === 'reject' ? 'Not approved' : 'Close purchase'}
          destructive={reasonFor.kind === 'reject'}
          onClose={() => setReasonFor(null)}
          onConfirm={async (reason) => {
            if (reasonFor.kind === 'reject') await rejectPurchase(reasonFor.purchase.id, reason);
            else await closePurchase(reasonFor.purchase.id, reason);
            setReasonFor(null);
            void load();
          }}
        />
      )}

      {asking && (
        <AskPricesSheet
          purchase={asking}
          suppliers={suppliers}
          already={new Set((details?.quotes || []).map((q) => q.supplierId || ''))}
          onClose={() => setAsking(null)}
          onDone={(n) => {
            setAsking(null);
            showToast('Suppliers added', `Send each of the ${n} the request below, then enter their prices when they reply.`, undefined, 'success');
            void load();
            if (viewingId) void reloadDetails(viewingId);
          }}
        />
      )}

      {pricing && (
        <QuotePricesSheet
          purchase={pricing.purchase}
          quote={pricing.quote}
          onClose={() => setPricing(null)}
          onDone={() => {
            setPricing(null);
            if (viewingId) void reloadDetails(viewingId);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- quotes from suppliers

function AskPricesSheet({ purchase, suppliers, already, onClose, onDone }: {
  purchase: PurchaseOrder; suppliers: Supplier[]; already: Set<string>; onClose: () => void; onDone: (n: number) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const n = await askSupplierPrices(purchase.id, [...picked], 'WhatsApp');
      onDone(n);
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save.'));
      setBusy(false);
    }
  };
  return (
    <FormSheet
      title={`Ask for prices · ${purchaseRef(purchase)}`}
      subtitle="Choose who to ask. You then send each one the list by WhatsApp, SMS or email from the purchase."
      onClose={onClose}
      footer={<button className={primaryBtn} disabled={!picked.size || busy} onClick={() => void save()}>{busy ? 'Saving…' : `Ask ${picked.size || ''} ${picked.size === 1 ? 'supplier' : 'suppliers'}`}</button>}
    >
      <ul className="divide-y divide-app-border/60 rounded-2xl ring-1 ring-app-border">
        {suppliers.map((s) => {
          const asked = already.has(s.id);
          return (
            <li key={s.id}>
              <label className={`flex items-center gap-3 px-3 py-2.5 ${asked ? 'opacity-60' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  className="accent-amber-500"
                  disabled={asked}
                  checked={asked || picked.has(s.id)}
                  onChange={(e) => setPicked((x) => { const y = new Set(x); if (e.target.checked) y.add(s.id); else y.delete(s.id); return y; })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{s.name}{s.company ? ` · ${s.company}` : ''}</span>
                  <span className="block text-[11px] text-app-text-muted">{asked ? 'Already asked' : [s.productSupplied, s.phone, s.email].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

function QuotePricesSheet({ purchase, quote, onClose, onDone }: {
  purchase: PurchaseOrder; quote: SupplierQuote; onClose: () => void; onDone: () => void;
}) {
  const [rows, setRows] = useState(() =>
    purchase.lines.filter((l) => l.id).map((l) => {
      const q = quote.lines.find((x) => x.itemId === l.id);
      return { line: l, price: q ? String(q.price) : '', available: q ? q.available : true };
    }),
  );
  const [days, setDays] = useState(quote.deliveryDays !== null ? String(quote.deliveryDays) : '');
  const [note, setNote] = useState(quote.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = rows.reduce((s, r) => s + (r.available ? (Number(r.price) || 0) * r.line.quantity : 0), 0);
  const ready = !busy && rows.some((r) => r.available) && rows.every((r) => !r.available || (r.price !== '' && Number(r.price) >= 0));
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      await saveSupplierQuote(quote.id, rows.map((r) => ({ itemId: r.line.id!, price: Number(r.price) || 0, available: r.available })), days === '' ? null : Number(days), note.trim());
      onDone();
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the prices.'));
      setBusy(false);
    }
  };
  return (
    <FormSheet
      wide
      title={`${quote.supplier}'s prices`}
      subtitle={`For ${purchaseRef(purchase)}. Untick anything they can't supply.`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm">Total <b className="tabular-nums">{formatCurrency(total)}</b></span>
          <button className={primaryBtn} disabled={!ready} onClick={() => void save()}>{busy ? 'Saving…' : 'Save prices'}</button>
        </>
      }
    >
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.line.id} className="rounded-2xl ring-1 ring-app-border p-3 flex items-center gap-3">
            <input
              type="checkbox"
              className="accent-amber-500"
              checked={r.available}
              aria-label={`They can supply ${r.line.name}`}
              onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, available: e.target.checked } : y)))}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm break-words">{r.line.name}</span>
              <span className="block text-[11px] text-app-text-muted">{r.line.quantity} {r.line.unit} · we paid {formatCurrency(r.line.price)} each</span>
            </span>
            <input
              type="number" inputMode="decimal" min="0" step="any" placeholder="Price each"
              disabled={!r.available}
              value={r.price}
              onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))}
              className="w-28 bg-app-bg border border-app-border rounded-lg px-2 py-1.5 text-sm text-right tabular-nums disabled:opacity-40"
            />
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Delivers in (days, optional)">
          <input type="number" inputMode="numeric" min="0" value={days} onChange={(e) => setDays(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Price holds until Friday" className={fieldClass} />
        </Field>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}
