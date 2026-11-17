// A task the assistant prepared, shown inside the chat. The person checks the details,
// changes any of them with normal fields (no JSON) and taps Confirm. The same checks as
// before run on every change: their own role's permission, stock, amounts, names.

import React, { useState } from 'react';
import {
  CheckCircle2, AlertTriangle, Ban, Play, Loader2, ShoppingBag, UserPlus, UserCog, Wallet,
  HandCoins, PackagePlus, Package, ArrowRightLeft, Receipt, CalendarClock, Clock, Sparkles,
  Plus, Trash2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { usePendingActionStore } from '../../stores/pendingActionStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useCustomerStore } from '../../stores/customerStore';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { usePaymentMethods } from '../../hooks/usePaymentMethods';
import { methodLabel } from '../../utils/paymentMethods';
import SearchableDropdown from '../SearchableDropdown';
import type { PendingAction, PendingActionType } from '../../types';
import { NumberInput } from '../shared/Input';

type FieldKind = 'text' | 'number' | 'tel' | 'email' | 'date' | 'time' | 'textarea' | 'customer' | 'product' | 'employee' | 'method' | 'radio';

interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  /** For radio: [value, label] pairs. */
  options?: [string, string][];
  /** Other keys holding the same thing, cleared when this one changes (e.g. customerId). */
  aliases?: string[];
  placeholder?: string;
}

const FIELDS: Partial<Record<PendingActionType, Field[]>> = {
  create_customer: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'phone', label: 'Phone', kind: 'tel', placeholder: '07…' },
    { key: 'email', label: 'Email', kind: 'email' },
  ],
  update_customer: [
    { key: 'customerName', label: 'Customer', kind: 'customer', aliases: ['customerId', 'name'] },
    { key: 'newName', label: 'New name', kind: 'text', placeholder: 'Leave empty to keep' },
    { key: 'phone', label: 'Phone', kind: 'tel' },
    { key: 'email', label: 'Email', kind: 'email' },
  ],
  settle_debt: [
    { key: 'customerName', label: 'Customer', kind: 'customer', aliases: ['customerId', 'name'] },
    { key: 'amount', label: 'Amount paid', kind: 'number' },
    { key: 'method', label: 'Paid by', kind: 'method', aliases: ['paymentMethod'] },
    { key: 'note', label: 'Note', kind: 'text', placeholder: 'Optional' },
  ],
  adjust_wallet: [
    { key: 'customerName', label: 'Customer', kind: 'customer', aliases: ['customerId', 'name'] },
    { key: 'amount', label: 'Amount to add', kind: 'number' },
    { key: 'note', label: 'Note', kind: 'text', placeholder: 'Optional' },
  ],
  create_product: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'price', label: 'Selling price', kind: 'number' },
    { key: 'cost', label: 'Cost', kind: 'number' },
    { key: 'stock', label: 'Stock now', kind: 'number' },
    { key: 'unit', label: 'Unit', kind: 'text', placeholder: 'Litre, Packet…' },
    { key: 'category', label: 'Category', kind: 'text' },
  ],
  update_product: [
    { key: 'productName', label: 'Product', kind: 'product', aliases: ['productId', 'name'] },
    { key: 'price', label: 'Selling price', kind: 'number' },
    { key: 'cost', label: 'Cost', kind: 'number' },
    { key: 'minStock', label: 'Warn when stock is below', kind: 'number' },
    { key: 'category', label: 'Category', kind: 'text' },
    { key: 'unit', label: 'Unit', kind: 'text' },
  ],
  adjust_stock: [
    { key: 'productName', label: 'Product', kind: 'product', aliases: ['productId'] },
    { key: 'type', label: 'What happened', kind: 'radio', options: [['restock', 'Stock came in'], ['damage', 'Damaged / lost']] },
    { key: 'quantity', label: 'How many', kind: 'number' },
    { key: 'reason', label: 'Reason', kind: 'text', placeholder: 'Optional' },
  ],
  create_expense: [
    { key: 'amount', label: 'Amount', kind: 'number' },
    { key: 'category', label: 'Category', kind: 'text', placeholder: 'Fuel, Supplies…' },
    { key: 'description', label: 'What for', kind: 'text' },
  ],
  create_shift: [
    { key: 'workerName', label: 'Worker', kind: 'employee', aliases: ['workerId', 'employeeId', 'employeeName'] },
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'startTime', label: 'Starts', kind: 'time' },
    { key: 'endTime', label: 'Ends', kind: 'time' },
    { key: 'notes', label: 'Notes', kind: 'text', placeholder: 'Optional' },
  ],
  create_feedback_reply: [{ key: 'message', label: 'Reply', kind: 'textarea' }],
  clock_in: [],
  clock_out: [],
};

const ICONS: Partial<Record<PendingActionType, React.ComponentType<{ size?: number; className?: string }>>> = {
  create_checkout: ShoppingBag, create_customer: UserPlus, update_customer: UserCog, settle_debt: HandCoins,
  adjust_wallet: Wallet, create_product: PackagePlus, update_product: Package, adjust_stock: ArrowRightLeft,
  create_expense: Receipt, create_shift: CalendarClock, clock_in: Clock, clock_out: Clock,
};

const inputCls =
  'w-full min-h-10 bg-app-bg border border-app-border rounded-lg px-3 text-xs text-app-text focus:outline-none focus:border-amber-500 disabled:opacity-60';

/** Plain text fields for anything the assistant sent that has no field of its own. */
function fallbackFields(params: Record<string, any>): Field[] {
  return Object.entries(params)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([key, v]) => ({
      key,
      label: key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      kind: typeof v === 'number' ? 'number' : 'text',
    }));
}

export default function ActionCard({ action }: { action: PendingAction }) {
  const { updatePendingParams, executePendingAction, rejectPendingAction } = usePendingActionStore();
  const products = useInventoryStore((s) => s.products);
  const customers = useCustomerStore((s) => s.customers);
  const employees = useAuthStore((s) => s.employees);
  const methods = usePaymentMethods();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);

  const isOpen = action.status === 'pending_review' || action.status === 'verified';
  const isDone = action.status === 'executed';
  const params = action.params || {};
  const fields = FIELDS[action.type] ?? fallbackFields(params);
  const Icon = ICONS[action.type] ?? Sparkles;
  const { validation } = action;

  const setParam = (field: Field, value: any) => {
    const next = { ...params, [field.key]: value };
    for (const alias of field.aliases || []) delete next[alias];
    setError(null);
    updatePendingParams(action.id, next);
  };

  const handleConfirm = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await executePendingAction(action.id);
      if (!result.success) {
        setError(result.error || 'That didn’t go through. Please try again.');
        useNotificationStore.getState().showToast("Couldn't do that", result.error || 'Please try again.', undefined, 'error');
      }
    } finally {
      setRunning(false);
    }
  };

  const valueOf = (f: Field) => {
    const v = params[f.key] ?? (f.aliases || []).map((a) => params[a]).find((x) => x != null && x !== '');
    return v == null ? '' : String(v);
  };

  /** Finds the picked entity's id from what the AI wrote (an id or a name). */
  const pickedId = (list: { id: string; name: string }[], f: Field) => {
    const v = valueOf(f).trim().toLowerCase();
    if (!v) return '';
    return (list.find((x) => x.id.toLowerCase() === v) || list.find((x) => x.name.trim().toLowerCase() === v))?.id || '';
  };

  const renderField = (f: Field) => {
    const disabled = !isOpen || running;
    const id = `${action.id}-${f.key}`;
    const label = (
      <label htmlFor={id} className="block text-[10px] font-bold text-app-text-muted mb-1">{f.label}</label>
    );
    switch (f.kind) {
      case 'customer':
      case 'product':
      case 'employee': {
        const list: { id: string; name: string; sub?: string }[] =
          f.kind === 'customer'
            ? customers.map((c) => ({ id: c.id, name: c.name, sub: [c.phone, Number(c.debtBalance) > 0 ? `owes ${Number(c.debtBalance).toLocaleString()}` : ''].filter(Boolean).join(' · ') }))
            : f.kind === 'product'
            ? products.map((p) => ({ id: p.id, name: p.name, sub: `${p.stock} ${p.unit || ''} in stock` }))
            : employees.map((e) => ({ id: e.id, name: e.name, sub: e.role }));
        return (
          <div key={f.key}>
            {label}
            <SearchableDropdown
              items={list.map((x) => ({ id: x.id, label: x.name, sublabel: x.sub }))}
              selectedValue={pickedId(list, f)}
              onChange={(pid) => setParam(f, list.find((x) => x.id === pid)?.name || '')}
              placeholder={valueOf(f) ? `${valueOf(f)} (not found, pick one)` : `Pick ${f.label.toLowerCase()}`}
              searchPlaceholder="Search…"
              disabled={disabled}
            />
          </div>
        );
      }
      case 'method':
      case 'radio': {
        const options: [string, string][] =
          f.kind === 'method' ? methods.map((m) => [m, methodLabel(m)]) : f.options || [];
        const current = valueOf(f).toLowerCase();
        const fallback = f.kind === 'method' ? (current.includes('airtel') ? 'Airtel Money' : current.includes('pesa') ? 'M-Pesa' : 'Cash') : options[0]?.[0];
        const selected = options.find(([v]) => v.toLowerCase() === current)?.[0] ?? fallback;
        return (
          <fieldset key={f.key} disabled={disabled}>
            <legend className="block text-[10px] font-bold text-app-text-muted mb-1">{f.label}</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {options.map(([value, text]) => (
                <label
                  key={value}
                  className={`min-h-9 px-3 flex items-center gap-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition ${
                    selected === value ? 'bg-amber-500/15 border-amber-500 text-app-text' : 'bg-app-bg border-app-border text-app-text-muted hover:border-amber-500/50'
                  }`}
                >
                  <input
                    type="radio"
                    name={id}
                    value={value}
                    checked={selected === value}
                    onChange={() => setParam(f, value)}
                    className="accent-amber-500"
                  />
                  {text}
                </label>
              ))}
            </div>
          </fieldset>
        );
      }
      case 'textarea':
        return (
          <div key={f.key} className="sm:col-span-2">
            {label}
            <textarea id={id} rows={3} value={valueOf(f)} disabled={disabled} onChange={(e) => setParam(f, e.target.value)} className={`${inputCls} py-2`} />
          </div>
        );
      default:
        return (
          <div key={f.key}>
            {label}
            <input
              id={id}
              type={f.kind}
              inputMode={f.kind === 'number' ? 'decimal' : undefined}
              value={valueOf(f)}
              placeholder={f.placeholder}
              disabled={disabled}
              onChange={(e) => setParam(f, f.kind === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)}
              className={inputCls}
            />
          </div>
        );
    }
  };

  // A sale's items: one row per product with its quantity.
  const renderItems = () => {
    const items: any[] = Array.isArray(params.items) ? params.items : [];
    const disabled = !isOpen || running;
    const setItems = (next: any[]) => { setError(null); updatePendingParams(action.id, { ...params, items: next }); };
    const productItems = products.map((p) => ({ id: p.id, label: p.name, sublabel: `KSh ${Number(p.price).toLocaleString()} · ${p.stock} left` }));
    return (
      <div className="space-y-2">
        {items.map((item, i) => {
          const prod = products.find((p) => p.id === item.productId) ||
            products.find((p) => p.name.trim().toLowerCase() === String(item.productName || '').trim().toLowerCase());
          return (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                {i === 0 && <span className="block text-[10px] font-bold text-app-text-muted mb-1">Product</span>}
                <SearchableDropdown
                  items={productItems}
                  selectedValue={prod?.id || ''}
                  onChange={(pid) => {
                    const p = products.find((x) => x.id === pid);
                    setItems(items.map((it, j) => (j === i ? { ...it, productId: pid, productName: p?.name } : it)));
                  }}
                  placeholder={item.productName ? `${item.productName} (not found, pick one)` : 'Pick a product'}
                  disabled={disabled}
                />
              </div>
              <div className="w-20 shrink-0">
                {i === 0 && <span className="block text-[10px] font-bold text-app-text-muted mb-1">Qty</span>}
                <NumberInput
                  min={0}
                  value={item.quantity ?? 1}
                  disabled={disabled}
                  aria-label="Quantity"
                  onChange={(v) => setItems(items.map((it, j) => (j === i ? { ...it, quantity: (v == null ? '' : String(v)) === '' ? '' : (v ?? 0) } : it)))}
                />
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                aria-label="Remove item"
                className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 disabled:opacity-40 cursor-pointer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        {isOpen && (
          <button
            type="button"
            disabled={running}
            onClick={() => setItems([...items, { productName: '', quantity: 1 }])}
            className="min-h-9 px-3 flex items-center gap-1.5 rounded-lg border border-dashed border-app-border text-xs font-semibold text-app-text-muted hover:border-amber-500 hover:text-app-text cursor-pointer"
          >
            <Plus size={13} /> Add item
          </button>
        )}
      </div>
    );
  };

  const hasFields = action.type === 'create_checkout' || fields.length > 0;

  return (
    <div
      className={`w-full rounded-xl border bg-app-card shadow-xs overflow-hidden ${
        isDone ? 'border-emerald-500/40' : action.status === 'rejected' ? 'border-app-border opacity-60' : 'border-amber-500/40'
      }`}
    >
      <div className="flex items-start gap-2.5 p-3">
        <div className={`p-2 rounded-lg shrink-0 ${isDone ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-xs font-bold text-app-text">{action.title}</h4>
            {isDone && (
              <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 size={10} /> Done
              </span>
            )}
            {action.status === 'rejected' && (
              <span className="text-[9px] font-black text-app-text-muted bg-app-bg px-2 py-0.5 rounded-full">Discarded</span>
            )}
          </div>
          {action.summary && <p className="text-[11px] text-app-text-muted mt-0.5 break-words">{action.summary}</p>}
          {isDone && action.resultMessage && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">{action.resultMessage}</p>}
        </div>
        {isOpen && hasFields && (
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-label={showDetails ? 'Hide details' : 'Show details'}
            aria-expanded={showDetails}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer"
          >
            {showDetails ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}
      </div>

      {isOpen && showDetails && hasFields && (
        <div className="px-3 pb-3">
          {action.type === 'create_checkout' ? (
            renderItems()
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{fields.map(renderField)}</div>
          )}
        </div>
      )}

      {isOpen && (validation.errors.length > 0 || validation.warnings.length > 0 || error) && (
        <div className="px-3 pb-3 space-y-1">
          {[...validation.errors, ...(error ? [error] : [])].map((msg, i) => (
            <p key={`e${i}`} className="text-[11px] text-red-600 dark:text-red-400 font-medium flex gap-1.5 break-words">
              <Ban size={12} className="shrink-0 mt-0.5" /> {msg}
            </p>
          ))}
          {validation.warnings.map((msg, i) => (
            <p key={`w${i}`} className="text-[11px] text-amber-600 dark:text-amber-400 font-medium flex gap-1.5 break-words">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {msg}
            </p>
          ))}
        </div>
      )}

      {isOpen && (
        <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-app-border/70 bg-app-bg/40">
          <button
            type="button"
            disabled={running}
            onClick={() => rejectPendingAction(action.id)}
            className="min-h-10 px-4 rounded-lg text-xs font-semibold text-app-text-muted hover:bg-red-500/10 hover:text-red-600 transition cursor-pointer disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={!validation.isValid || running}
            onClick={handleConfirm}
            className="min-h-10 px-5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-app-border disabled:text-app-text-muted text-slate-950 text-xs font-bold transition cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}
