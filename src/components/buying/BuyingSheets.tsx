// Sheets shared by the Buying screen and Suppliers & Purchases: a reason box, receiving a
// purchase in parts, entering and paying a supplier bill, and returning goods.
import { Checkbox } from '../shared/Checkbox';
import { displayName } from '../../utils/stringUtils';
import React, { useEffect, useMemo, useState } from 'react';
import { PackageCheck, Plus, Trash2 } from 'lucide-react';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn, dangerBtn } from '../shared/FormSheet';
import SearchableDropdown from '../SearchableDropdown';
import { formatCurrency } from '../../utils/helpers';
import { toUserMessage } from '../../utils/userError';
import {
  createSupplierBill, createSupplierReturn, receivePurchaseLines, recordBillPayment,
  type ReceiveResult, type SupplierBill,
} from '../../services/buying';
import type { PurchaseOrder, Supplier } from '../../services/operations';
import type { Product } from '../../types';
import { NumberInput } from '../shared/Input';

const METHODS = ['Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00+03:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
};
const q3 = (n: number) => String(Math.round(n * 1000) / 1000);

// ---------------------------------------------------------------- reason

export function ReasonSheet({
  title, message, placeholder, confirmLabel, destructive, onClose, onConfirm,
}: {
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save. Check your connection and try again.'));
      setBusy(false);
    }
  };
  return (
    <FormSheet
      title={title}
      subtitle={message}
      onClose={onClose}
      footer={
        <>
          <button className={secondaryBtn} onClick={onClose}>Back</button>
          <button className={destructive ? dangerBtn : primaryBtn} disabled={!reason.trim() || busy} onClick={() => void go()}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </>
      }
    >
      <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={placeholder || 'Why?'} className={fieldClass} />
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- receive in parts

export function ReceiveSheet({
  purchase, onClose, onDone,
}: {
  purchase: PurchaseOrder;
  onClose: () => void;
  onDone: (r: ReceiveResult) => void;
}) {
  const open = purchase.lines.filter((l) => l.id && l.quantity - (l.received || 0) > 0);
  const [got, setGot] = useState<Record<string, { good: string; damaged: string }>>(() =>
    Object.fromEntries(open.map((l) => [l.id!, { good: q3(l.quantity - (l.received || 0)), damaged: '' }])),
  );
  const [note, setNote] = useState('');
  const [updateCost, setUpdateCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = open.map((l) => {
    const left = l.quantity - (l.received || 0);
    const g = Number(got[l.id!]?.good || 0);
    const d = Number(got[l.id!]?.damaged || 0);
    const problem = !Number.isFinite(g) || !Number.isFinite(d) || g < 0 || d < 0
      ? 'Enter numbers, 0 or more'
      : g + d > left ? `Only ${q3(left)} ${l.unit} still to come` : null;
    return { l, left, g, d, problem };
  });
  const value = rows.reduce((s, r) => s + (r.problem ? 0 : r.g * r.l.price), 0);
  const short = rows.some((r) => !r.problem && r.g < r.left);
  const nothing = rows.every((r) => r.g === 0 && r.d === 0);
  const ready = !busy && !nothing && rows.every((r) => !r.problem);

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await receivePurchaseLines(
        purchase.id,
        rows.filter((x) => x.g > 0 || x.d > 0).map((x) => ({ itemId: x.l.id!, received: x.g, damaged: x.d })),
        note.trim(),
        updateCost,
      );
      onDone(r);
    } catch (e) {
      setErr(toUserMessage(e, 'Could not receive. Check your connection and try again.'));
      setBusy(false);
    }
  };

  return (
    <FormSheet
      wide
      title={`Receive ${purchase.reference || 'purchase'} · ${purchase.supplierName}`}
      subtitle="Count what came. Damaged goods stay owed."
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm">Into stock <b className="tabular-nums">{formatCurrency(value)}</b></span>
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={!ready} onClick={() => void save()}>
            <PackageCheck size={15} /> {busy ? 'Saving…' : 'Save goods received'}
          </button>
        </>
      }
    >
      {rows.length === 0 && <p className="text-sm text-app-text-muted">Everything on this purchase has arrived.</p>}
      <ul className="space-y-2">
        {rows.map(({ l, left, problem }) => (
          <li key={l.id} className="rounded-2xl ring-1 ring-app-border p-3">
            <p className="text-sm font-medium break-words">{displayName(l.name)}</p>
            <p className="text-[11px] text-app-text-muted">
              Ordered {q3(l.quantity)} {l.unit}
              {(l.received || 0) > 0 ? ` · ${q3(l.received || 0)} already in` : ''}
              {(l.damaged || 0) > 0 ? ` · ${q3(l.damaged || 0)} came damaged` : ''} · {q3(left)} to come · {formatCurrency(l.price)} each
              {!l.productId ? ' · not linked to a product, so not added to stock' : ''}
              {l.forBranchName ? ` · for ${l.forBranchName}` : ''}
            </p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field label="Good, into stock">
                <NumberInput min={0}
                  value={got[l.id!]?.good ?? ''}
                  onChange={(v) => setGot((m) => ({ ...m, [l.id!]: { ...m[l.id!], good: (v == null ? '' : String(v)) } }))}
                />
              </Field>
              <Field label="Damaged">
                <NumberInput min={0}
                  value={got[l.id!]?.damaged ?? ''}
                  placeholder="0"
                  onChange={(v) => setGot((m) => ({ ...m, [l.id!]: { ...m[l.id!], damaged: (v == null ? '' : String(v)) } }))}
                />
              </Field>
            </div>
            {problem && <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">{problem}</p>}
          </li>
        ))}
      </ul>
      {short && !nothing && <p className="text-[11px] text-app-text-muted">Some items are short. The purchase stays open.</p>}
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Driver Otieno, delivery note 4471" className={fieldClass} />
      </Field>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox checked={updateCost} onChange={(on) => setUpdateCost(on)} />
        <span>
          Set each product's cost to the price paid here
          <span className="block text-[11px] text-app-text-muted">Profit on later sales uses the new cost.</span>
        </span>
      </label>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- enter a bill

export function BillSheet({
  businessId, purchaseId, purchaseRef, supplier, receipts, tolerancePct, onClose, onDone,
}: {
  businessId: string;
  purchaseId: string;
  purchaseRef: string;
  supplier: string;
  receipts: { id: string; number: string; receivedAt: string; value: number }[];
  tolerancePct: number;
  onClose: () => void;
  onDone: (r: { number: string; status: string; difference: number }) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(receipts.map((r) => r.id)));
  const goods = receipts.filter((r) => picked.has(r.id)).reduce((s, r) => s + r.value, 0);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState(addDays(today(), 30));
  const [subtotal, setSubtotal] = useState(String(Math.round(goods * 100) / 100));
  const [vat, setVat] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sub = Number(subtotal);
  const v = Number(vat);
  const diff = Number.isFinite(sub) ? Math.round((sub - goods) * 100) / 100 : 0;
  const allowed = Math.max(Math.round(goods * tolerancePct) / 100, 1);
  const flagged = Math.abs(diff) > allowed;
  const ready = !busy && picked.size > 0 && Number.isFinite(sub) && sub >= 0 && Number.isFinite(v) && v >= 0 && dueDate >= billDate;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await createSupplierBill(businessId, {
        purchaseId, receiptIds: [...picked], supplierInvoiceNo: invoiceNo.trim(), billDate, dueDate,
        subtotal: sub, vatTotal: v, note: note.trim(),
      });
      onDone(r);
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the bill.'));
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={`Bill from ${supplier}`}
      subtitle={`For ${purchaseRef}. Type what their invoice says.`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm">Total <b className="tabular-nums">{formatCurrency((Number.isFinite(sub) ? sub : 0) + (Number.isFinite(v) ? v : 0))}</b></span>
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={!ready} onClick={() => void save()}>{busy ? 'Saving…' : 'Save bill'}</button>
        </>
      }
    >
      <div className="space-y-1">
        <p className="text-xs font-medium text-app-text-muted">Deliveries on this bill</p>
        {receipts.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={picked.has(r.id)} onChange={(on) => setPicked((s) => { const x = new Set(s); if (on) x.add(r.id); else x.delete(r.id); return x; })} />
            <span className="flex-1">{r.number} · {new Date(r.receivedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</span>
            <span className="tabular-nums text-app-text-muted">{formatCurrency(r.value)}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Their invoice number (optional)">
          <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={40} className={fieldClass} />
        </Field>
        <Field label="Bill date">
          <input type="date" value={billDate} max={today()} onChange={(e) => setBillDate(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Amount before VAT (KSh)" hint={`Goods received at the order price: ${formatCurrency(goods)}`}>
          <NumberInput min={0} value={subtotal} onChange={(v) => setSubtotal((v == null ? '' : String(v)))} />
        </Field>
        <Field label="VAT on the bill (KSh)" hint="Claimed back from KRA; shown on the VAT page">
          <NumberInput min={0} value={vat} onChange={(v) => setVat((v == null ? '' : String(v)))} />
        </Field>
        <Field label="Pay by">
          <input type="date" value={dueDate} min={billDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={fieldClass} />
        </Field>
      </div>
      {diff !== 0 && (
        <p className={`text-xs rounded-xl p-3 ${flagged ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'bg-app-bg text-app-text-muted'}`}>
          The bill is {formatCurrency(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than the goods received.
          {flagged
            ? ` That is above the ${tolerancePct}% allowed, so someone who approves purchases has to check it before it counts or can be paid.`
            : ' That is within what is allowed; stock value is adjusted by the difference.'}
        </p>
      )}
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- pay a bill

export function PayBillSheet({ bill, onClose, onDone }: { bill: SupplierBill; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(String(bill.balance));
  const [method, setMethod] = useState('M-Pesa');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = Number(value);
  const ready = !busy && Number.isFinite(amount) && amount > 0 && amount <= bill.balance + 0.001;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      await recordBillPayment(bill.id, {
        amount, method, reference: reference.trim(),
        paidAt: date === today() ? null : new Date(`${date}T12:00:00+03:00`).toISOString(),
      });
      onDone();
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the payment.'));
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={`Pay ${bill.supplier}`}
      subtitle={`${bill.number}${bill.supplierInvoiceNo ? ` (their ${bill.supplierInvoiceNo})` : ''} · owing ${formatCurrency(bill.balance)}`}
      onClose={onClose}
      footer={<button className={primaryBtn} disabled={!ready} onClick={() => void save()}>{busy ? 'Saving…' : 'Record payment'}</button>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (KSh)">
          <NumberInput min={0} value={value} onChange={(v) => setValue((v == null ? '' : String(v)))} />
        </Field>
        <Field label="Paid from">
          <SearchableDropdown items={METHODS.map((m) => ({ id: m, label: m }))} selectedValue={method} onChange={setMethod} placeholder="Choose how" />
        </Field>
        <Field label="Date">
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Reference (optional)">
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="M-Pesa code, cheque no." maxLength={60} className={fieldClass} />
        </Field>
      </div>
      <p className="text-[11px] text-app-text-muted">The {method} balance on the Payments screen goes down by this amount.</p>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- return goods

export function ReturnSheet({
  businessId, suppliers, purchases, products, initialPurchaseId, onClose, onDone,
}: {
  businessId: string;
  suppliers: Supplier[];
  purchases: PurchaseOrder[];
  products: Product[];
  initialPurchaseId?: string | null;
  onClose: () => void;
  onDone: (r: { number: string; total: number }) => void;
}) {
  const initial = purchases.find((p) => p.id === initialPurchaseId) || null;
  const [supplierId, setSupplierId] = useState<string | null>(initial?.supplierId ?? null);
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? '');
  const [purchaseId, setPurchaseId] = useState<string | null>(initial?.id ?? null);
  const [lines, setLines] = useState<{ productId: string; qty: string }[]>(() =>
    initial ? initial.lines.filter((l) => l.productId && (l.received || 0) > 0).map((l) => ({ productId: l.productId!, qty: '' })) : [],
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const purchase = purchases.find((p) => p.id === purchaseId) || null;
  const priceOf = (productId: string) => purchase?.lines.find((l) => l.productId === productId)?.price ?? byId.get(productId)?.cost ?? 0;
  const receivedFrom = purchases.filter(
    (p) => (p.status === 'Received' || p.status === 'Part received') && (!supplierId || p.supplierId === supplierId || (!p.supplierId && p.supplierName === supplierName)),
  );

  useEffect(() => {
    if (purchase && !supplierId) {
      setSupplierId(purchase.supplierId);
      setSupplierName(purchase.supplierName);
    }
  }, [purchase, supplierId]);

  const rows = lines.map((l) => {
    const p = byId.get(l.productId);
    const n = Number(l.qty);
    const problem = !p ? 'Not in this branch' : !Number.isFinite(n) || n <= 0 ? 'Enter how much' : n > (p.stock || 0) ? `Only ${q3(p.stock || 0)} ${p.unit} in stock` : null;
    return { ...l, p, n, problem };
  });
  const total = rows.reduce((s, r) => s + (r.problem ? 0 : r.n * priceOf(r.productId)), 0);
  const ready = !busy && supplierName.trim() && reason.trim() && rows.length > 0 && rows.every((r) => !r.problem);

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await createSupplierReturn(businessId, {
        supplierId, supplierName: supplierName.trim(), purchaseId, reason: reason.trim(),
        lines: rows.map((x) => ({ productId: x.productId, quantity: x.n })),
      });
      onDone(r);
    } catch (e) {
      setErr(toUserMessage(e, 'Could not save the return.'));
      setBusy(false);
    }
  };

  const productItems = products
    .filter((p) => !lines.some((l) => l.productId === p.id) && (p.stock || 0) > 0)
    .map((p) => ({ id: p.id, label: displayName(p.name), sublabel: `${q3(p.stock || 0)} ${p.unit} in stock` }));

  return (
    <FormSheet
      wide
      title="Return goods to a supplier"
      subtitle="Stock and what you owe both go down."
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm">Credit <b className="tabular-nums">{formatCurrency(total)}</b></span>
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={!ready} onClick={() => void save()}>{busy ? 'Saving…' : 'Return goods'}</button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier">
          {suppliers.length ? (
            <SearchableDropdown
              items={suppliers.map((s) => ({ id: s.id, label: s.name, sublabel: s.company }))}
              selectedValue={supplierId || ''}
              onChange={(id) => {
                const s = suppliers.find((x) => x.id === id);
                if (s) { setSupplierId(s.id); setSupplierName(s.company || s.name); setPurchaseId(null); }
              }}
              placeholder={supplierName || 'Choose a supplier'}
              searchPlaceholder="Search suppliers"
            />
          ) : (
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={fieldClass} />
          )}
        </Field>
        <Field label="From purchase (optional)" hint="Its prices are used for the credit">
          <SearchableDropdown
            items={[{ id: '', label: 'Not one purchase' }, ...receivedFrom.map((p) => ({ id: p.id, label: `${p.reference || p.id.slice(0, 8)} · ${p.supplierName}`, sublabel: new Date(p.date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) }))]}
            selectedValue={purchaseId || ''}
            onChange={(v) => setPurchaseId(v || null)}
            placeholder="Not one purchase"
          />
        </Field>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.productId} className="rounded-2xl ring-1 ring-app-border p-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-words">{r.p?.name || 'Product'}</p>
              <p className="text-[11px] text-app-text-muted">{q3(r.p?.stock || 0)} {r.p?.unit} in stock · {formatCurrency(priceOf(r.productId))} each</p>
              {r.problem && <p className="text-[11px] text-red-600 dark:text-red-400">{r.problem}</p>}
            </div>
            <NumberInput min={0} value={r.qty}
              onChange={(v) => setLines((ls) => ls.map((l) => (l.productId === r.productId ? { ...l, qty: (v == null ? '' : String(v)) } : l)))}
              aria-label="How much goes back"
              size="sm" className="w-24" inputClassName="text-right tabular-nums"
            />
            <button onClick={() => setLines((ls) => ls.filter((l) => l.productId !== r.productId))} aria-label="Remove" className="p-1.5 rounded-lg text-app-text-muted hover:text-red-500 cursor-pointer">
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      <SearchableDropdown
        items={productItems}
        selectedValue=""
        onChange={(id) => setLines((ls) => [...ls, { productId: id, qty: '' }])}
        placeholder="Add a product"
        searchPlaceholder="Search products"
      />
      {!rows.length && <p className="text-[11px] text-app-text-muted flex items-center gap-1"><Plus size={12} /> Add what is going back.</p>}
      <Field label="Why are they going back?">
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Mouldy, wrong size, expired" className={fieldClass} />
      </Field>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </FormSheet>
  );
}
