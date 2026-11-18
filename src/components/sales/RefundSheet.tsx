// Refund some or all of a till sale. The sale stays in the Sales Log; a credit note is made
// and the customer gets the money back (cash, M-Pesa, …), into their wallet, or off the debt
// this sale left. Ticking "Put back in stock" returns the items to stock.
import SearchableDropdown from '../SearchableDropdown';
import { Checkbox } from '../shared/Checkbox';
import { displayName } from '../../utils/stringUtils';
import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Undo2, Pencil } from 'lucide-react';
import { useCartStore } from '../../stores/cartStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useCustomerStore } from '../../stores/customerStore';
import { useUiStore } from '../../stores/uiStore';
import type { CartItem } from '../../types';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn } from '../shared/FormSheet';
import { useNotificationStore } from '../../stores/notificationStore';
import { useBusinessStore } from '../../stores/businessStore';
import { toUserMessage } from '../../utils/userError';
import { formatCurrency } from '../../utils/helpers';
import {
  createCreditNote, loadSaleRefund, REFUND_EVENT, EDIT_REFUND_REASON, refundPreview, MONEY_METHODS,
  type MoneyMethod, type SaleRefundInfo, type Settlement,
} from '../../services/salesDocs';
import { NumberInput } from '../shared/Input';

interface Props {
  transactionId: string;
  onClose: () => void;
  onDone?: (creditNoteId: string) => void;
  /** 'edit': take the whole sale back, then open its items in the till to fix and charge again. */
  mode?: 'refund' | 'edit';
}

const EDIT_REASON = EDIT_REFUND_REASON;

const REASONS = ['Returned', 'Damaged or spoilt', 'Wrong item', 'Wrong price', 'Customer changed their mind'];

export function RefundSheet({ transactionId, onClose, onDone, mode = 'refund' }: Props) {
  const editing = mode === 'edit';
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const showToast = useNotificationStore((s) => s.showToast);
  const [info, setInfo] = useState<SaleRefundInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState(editing ? EDIT_REASON : REASONS[0]);
  const [settlement, setSettlement] = useState<Settlement>('refund');
  const [method, setMethod] = useState<MoneyMethod>('Cash');
  const [returnStock, setReturnStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadSaleRefund(transactionId)
      .then((r) => {
        if (!live) return;
        setInfo(r);
        // Everything still refundable is ticked to start with.
        setQty(Object.fromEntries(r.lines.filter((l) => l.left > 0).map((l) => [l.id, l.left])));
        const paid = r.paymentMethod as MoneyMethod;
        if (MONEY_METHODS.includes(paid)) setMethod(paid);
        if (r.owedOnSale > 0) setSettlement('debt');
      })
      .catch((err) => live && setLoadError(toUserMessage(err, 'Could not load this sale.')));
    return () => { live = false; };
  }, [transactionId]);

  const preview = useMemo(() => (info ? refundPreview(info.lines, qty) : { net: 0, vat: 0, total: 0 }), [info, qty]);
  const blocked = info && !info.fullAccess && !info.today;
  const nothingLeft = info && info.lines.every((l) => l.left <= 0);

  const submit = async () => {
    if (!info || !businessId || busy) return;
    if (preview.total <= 0) return setError('Choose at least one item and how many came back.');
    if (!reason.trim()) return setError('Say why.');
    if (settlement === 'debt' && preview.total > info.owedOnSale + 0.01) {
      return setError(`Only ${formatCurrency(info.owedOnSale)} is still owed on this sale. Give the rest back as money or into the wallet.`);
    }
    setError(null);
    setBusy(true);
    try {
      const id = await createCreditNote(businessId, {
        transactionId, quantities: qty, reason, settlement, method, returnStock: editing ? true : returnStock,
      });
      window.dispatchEvent(new Event(REFUND_EVENT));
      onDone?.(id);
      if (editing) openInTill(info);
      else showToast('Refund recorded', `${info.receipt} · ${formatCurrency(preview.total)}`, undefined, 'success');
      onClose();
    } catch (err) {
      setError(toUserMessage(err, 'Could not record the refund.'));
    } finally {
      setBusy(false);
    }
  };

  // After the sale is taken back: its items go into the till at the prices they sold for,
  // for the same customer, so the person fixes what was wrong and charges again.
  const openInTill = (sale: SaleRefundInfo) => {
    const products = useInventoryStore.getState().products;
    const items: CartItem[] = [];
    const skipped: string[] = [];
    for (const l of sale.lines) {
      const n = qty[l.id] || 0;
      if (n <= 0) continue;
      const product = l.productId ? products.find((p) => p.id === l.productId) : undefined;
      if (!product) { skipped.push(displayName(l.name)); continue; }
      items.push({ product: { ...product, price: Math.round(l.unitNet * 100) / 100 }, quantity: n, discountPercentage: 0 });
    }
    const customer = sale.customerId ? useCustomerStore.getState().customers.find((c) => c.id === sale.customerId) ?? null : null;
    useCartStore.setState({ cart: items, selectedCustomer: customer, quote: null });
    useUiStore.getState().setActiveTab('pos');
    showToast(
      'Sale taken back',
      skipped.length ? `Fix it in the till and charge again. Not found: ${skipped.join(', ')}` : 'Fix it in the till and charge again.',
      undefined,
      skipped.length ? 'info' : 'success',
    );
  };

  const choices: { id: Settlement; label: string; hint: string; hidden?: boolean }[] = [
    { id: 'refund', label: 'Give money back', hint: 'Takes it out of the money you hold' },
    { id: 'wallet', label: 'Into their wallet', hint: 'They spend it next time', hidden: !info?.customerId },
    { id: 'debt', label: 'Off their debt', hint: info ? `${formatCurrency(info.owedOnSale)} still owed on this sale` : '', hidden: !info || info.owedOnSale <= 0 },
  ];

  return (
    <FormSheet
      wide
      title={info ? `${editing ? 'Edit' : 'Refund'} ${info.receipt}` : editing ? 'Edit sale' : 'Refund'}
      subtitle={info ? `${info.customerName || 'Walk-in'} · paid ${formatCurrency(info.finalTotal)}${info.refunded ? ` · ${formatCurrency(info.refunded)} refunded before` : ''}` : undefined}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm">Back to customer <b className="tabular-nums">{formatCurrency(preview.total)}</b></span>
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={busy || !info || !!blocked || !!nothingLeft} onClick={() => void submit()}>
            {editing ? <Pencil size={15} /> : <Undo2 size={15} />} {busy ? 'Saving…' : editing ? 'Take back and fix in till' : 'Refund'}
          </button>
        </>
      }
    >
      {loadError ? (
        <div className="text-center space-y-2 py-4">
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 text-sm underline cursor-pointer"><RotateCcw size={14} /> Close</button>
        </div>
      ) : !info ? (
        <p className="text-sm text-app-text-muted text-center py-4">Loading…</p>
      ) : (
        <>
          {blocked && <p className="text-xs rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3">You can refund only today's sales. Ask a manager to refund this one.</p>}
          {nothingLeft && <p className="text-xs rounded-xl bg-app-bg p-3 text-app-text-muted">Everything on this sale was already refunded.</p>}
          <p className="text-[11px] text-app-text-muted">
            {editing
              ? 'The whole sale comes back (a credit note is made and stock returns), then its items open in the till so you fix them and charge again. Anything already in the till is replaced.'
              : 'A credit note is made.'}
          </p>

          <div className="rounded-2xl ring-1 ring-app-border divide-y divide-app-border/60">
            {info.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2">
                {!editing && <Checkbox checked={(qty[l.id] || 0) > 0} onChange={(on) => setQty((q) => ({ ...q, [l.id]: on ? l.left : 0 }))} disabled={l.left <= 0} ariaLabel={`Refund ${displayName(l.name)}`} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{displayName(l.name)}</p>
                  <p className="text-[11px] text-app-text-muted">
                    {l.left < l.quantity ? `${l.left} of ${l.quantity} left` : `${l.quantity} sold`} · {formatCurrency(l.unitNet * (1 + l.vatRate / 100))} each
                  </p>
                </div>
                {editing ? (
                  <span className="text-sm tabular-nums">× {l.left}</span>
                ) : <NumberInput
                  min={0}
                  max={l.left}
                  aria-label={`How many ${l.name} came back`}
                  value={qty[l.id] ?? ''}
                  disabled={l.left <= 0}
                  onChange={(v) => setQty((q) => ({ ...q, [l.id]: Math.max(0, Math.min(l.left, (v ?? 0) || 0)) }))} className="w-20" inputClassName="text-right"
                />}
              </div>
            ))}
          </div>

          {!editing && <Field label="Why">
            <SearchableDropdown
              items={[...REASONS.map((r) => ({ id: r, label: r })), { id: '__other', label: 'Something else…' }]}
              selectedValue={REASONS.includes(reason) ? reason : '__other'}
              onChange={(v) => setReason(v === '__other' ? '' : v)}
              placeholder="Choose why"
            />
            {!REASONS.includes(reason) && (
              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Say why" className={`${fieldClass} mt-2`} />
            )}
          </Field>}

          <div className="space-y-2">
            <p className="text-xs font-medium text-app-text-muted">How they get it back</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {choices.filter((c) => !c.hidden).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={settlement === c.id}
                  onClick={() => setSettlement(c.id)}
                  className={`text-left rounded-xl px-3 py-2 ring-1 cursor-pointer ${settlement === c.id ? 'ring-amber-500 bg-amber-500/10' : 'ring-app-border'}`}
                >
                  <span className="block text-sm font-medium">{c.label}</span>
                  <span className="block text-[11px] text-app-text-muted">{c.hint}</span>
                </button>
              ))}
            </div>
            {settlement === 'refund' && (
              <Field label="Paid back by">
                <SearchableDropdown items={MONEY_METHODS.map((m) => ({ id: m, label: m }))} selectedValue={method} onChange={(v) => setMethod(v as MoneyMethod)} placeholder="Choose how" />
              </Field>
            )}
          </div>

          {!editing && <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={returnStock} onChange={(on) => setReturnStock(on)} />
            <span>
              Put the items back in stock
              <span className="block text-[11px] text-app-text-muted">Leave it off for spoilt goods that are thrown away.</span>
            </span>
          </label>}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </FormSheet>
  );
}

export default RefundSheet;
