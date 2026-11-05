// src/components/TrackedReports.tsx
// Lets a business pick customers, products or customer groups to follow in reports.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pin, X } from 'lucide-react';
import {
  CUSTOMER_TYPE_LABELS,
  Customer,
  DELIVERY_FREQUENCY_LABELS,
  PAYMENT_TERMS_LABELS,
  Product,
  Transaction,
} from '../types';
import { getSupabase } from '../services/supabaseClient';
import { toUserMessage } from '../utils/userError';
import { useAppStore } from '../stores/appStore';

type ItemType = 'customer' | 'product' | 'customer_type' | 'payment_terms' | 'delivery_frequency';

interface TrackedItem {
  id: string;
  item_type: ItemType;
  item_key: string;
  label: string;
}

const TYPE_LABELS: Record<ItemType, string> = {
  customer: 'Customer',
  product: 'Product',
  customer_type: 'Customer type',
  payment_terms: 'Payment terms',
  delivery_frequency: 'Delivery schedule',
};

interface Props {
  businessId: string | null;
  transactions: Transaction[];
  customers: Customer[];
  products: Product[];
  formatCurrency: (amount: number) => string;
}

function summarize(item: TrackedItem, transactions: Transaction[], customers: Customer[]) {
  if (item.item_type === 'product') {
    let revenue = 0;
    let quantity = 0;
    transactions.forEach((t) =>
      t.items?.forEach((line) => {
        if (line.product?.id === item.item_key) {
          revenue += (line.product.price || 0) * line.quantity;
          quantity += line.quantity;
        }
      }),
    );
    return { revenue, detail: `${quantity} sold` };
  }

  const matches = (c: Customer) =>
    item.item_type === 'customer' ? c.id === item.item_key
    : item.item_type === 'customer_type' ? (c.customerType ?? 'individual') === item.item_key
    : item.item_type === 'payment_terms' ? (c.paymentTerms ?? 'pay_now') === item.item_key
    : (c.deliveryFrequency ?? 'none') === item.item_key;
  const ids = new Set(customers.filter(matches).map((c) => c.id));
  const sales = transactions.filter((t) => t.customerId && ids.has(t.customerId));
  return {
    revenue: sales.reduce((sum, t) => sum + (t.finalTotal || 0), 0),
    detail: `${sales.length} sale${sales.length === 1 ? '' : 's'}`,
  };
}

export default function TrackedReports({ businessId, transactions, customers, products, formatCurrency }: Props) {
  const { showToast } = useAppStore();
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [type, setType] = useState<ItemType>('customer');
  const [key, setKey] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await getSupabase()
      .from('report_tracked_items')
      .select('id, item_type, item_key, label')
      .eq('business_id', businessId)
      .order('created_at');
    if (!error) setItems((data ?? []) as TrackedItem[]);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const options = useMemo<[string, string][]>(() => {
    if (type === 'customer') return customers.map((c) => [c.id, c.name]);
    if (type === 'product') return products.map((p) => [p.id, p.name]);
    if (type === 'customer_type') return Object.entries(CUSTOMER_TYPE_LABELS);
    if (type === 'payment_terms') return Object.entries(PAYMENT_TERMS_LABELS);
    return Object.entries(DELIVERY_FREQUENCY_LABELS);
  }, [type, customers, products]);

  const handleAdd = async () => {
    const option = options.find(([value]) => value === key);
    if (!option || !businessId) return;
    const { error } = await getSupabase().from('report_tracked_items').insert({
      business_id: businessId,
      item_type: type,
      item_key: key,
      label: option[1],
    });
    if (error && error.code !== '23505') {
      showToast('Could Not Track', toUserMessage(error, 'Please try again.'), undefined, 'error');
      return;
    }
    setKey('');
    load();
  };

  const handleRemove = async (id: string) => {
    const { error } = await getSupabase().from('report_tracked_items').delete().eq('id', id);
    if (error) {
      showToast('Could Not Remove', toUserMessage(error, 'Please try again.'), undefined, 'error');
      return;
    }
    load();
  };

  return (
    <section className="bg-app-card border border-app-border rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Pin size={14} className="text-amber-500" />
        <h3 className="text-sm font-bold text-app-text">Tracked in this report</h3>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <select
          aria-label="What to track"
          value={type}
          onChange={(e) => { setType(e.target.value as ItemType); setKey(''); }}
          className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          aria-label="Item to track"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="flex-1 min-w-0 bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text"
        >
          <option value="">Choose…</option>
          {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!key}
          className="px-4 py-2 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs disabled:opacity-40"
        >
          Track
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-app-text-muted">Pick a customer, product or group to see its sales for the selected dates.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-app-border">
          {items.map((item) => {
            const summary = summarize(item, transactions, customers);
            return (
              <li key={item.id} className="flex items-center gap-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-app-text truncate">{item.label}</p>
                  <p className="text-xs text-app-text-muted">{TYPE_LABELS[item.item_type]} · {summary.detail}</p>
                </div>
                <span className="text-sm font-bold text-app-text">{formatCurrency(summary.revenue)}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  aria-label={`Stop tracking ${item.label}`}
                  className="p-2 text-app-text-muted"
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
