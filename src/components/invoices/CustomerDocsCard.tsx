// src/components/invoices/CustomerDocsCard.tsx
// On a Loyalty customer's page: what they owe on invoices (apart from till debt), and a quick
// way to start a quote for them. Links the customer to Quotes & Invoices.
import React, { useEffect, useState } from 'react';
import { FilePlus2, FileText } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { hasRolePermission } from '../../utils/permissions';
import { formatCurrency } from '../../utils/helpers';

interface OpenInvoice {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  total: number;
  balance: number;
  status: string;
}

const day = (d: string) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

export default function CustomerDocsCard({ customer }: { customer: { id: string; name: string; phone?: string } }) {
  const role = useAuthStore((s) => s.currentEmployee?.role) || 'Guest';
  const can = (code: string) => hasRolePermission(role, code as any);
  const seesInvoices = can('invoices.view') || can('invoices.manage');
  const makesQuotes = can('quotes.manage');
  const [invoices, setInvoices] = useState<OpenInvoice[] | null>(null);

  useEffect(() => {
    if (!seesInvoices) return;
    let live = true;
    setInvoices(null);
    void getSupabase()
      .rpc('customer_open_invoices', { p_customer_id: customer.id })
      .then(({ data, error }) => {
        if (!live) return;
        // An older database without the function just shows nothing.
        setInvoices(error ? [] : ((data as any[]) || []).map((i) => ({ ...i, total: Number(i.total), balance: Number(i.balance) })));
      });
    return () => { live = false; };
  }, [customer.id, seesInvoices]);

  if (!seesInvoices && !makesQuotes) return null;
  const owed = (invoices || []).reduce((s, i) => s + i.balance, 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-2 rounded-xl bg-app-bg p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <FileText size={15} className="text-app-text-muted shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-app-text-muted">On invoices</div>
          <div className={`text-sm font-semibold tabular-nums ${owed > 0 ? 'text-red-600 dark:text-red-400' : 'text-app-text'}`}>
            {invoices === null && seesInvoices ? '…' : formatCurrency(owed)}
            {!!invoices?.length && <span className="ml-1 text-[11px] font-normal text-app-text-muted">· {invoices.length} open</span>}
          </div>
        </div>
        {makesQuotes && (
          <button
            type="button"
            onClick={() => useUiStore.getState().startQuote({ customerId: customer.id, customerName: customer.name, customerPhone: customer.phone || '' })}
            className="inline-flex items-center gap-1 rounded-lg bg-app-card px-2.5 py-1.5 text-[11px] font-medium text-app-text ring-1 ring-app-border cursor-pointer hover:bg-app-border/40"
          >
            <FilePlus2 size={13} /> New quote
          </button>
        )}
      </div>
      {!!invoices?.length && (
        <ul className="divide-y divide-app-border/60">
          {invoices.slice(0, 4).map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => useUiStore.getState().setActiveTab('invoicing')}
                className="w-full flex items-center justify-between gap-2 py-1.5 text-left cursor-pointer"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-app-text truncate">{i.number}</span>
                  <span className={`block text-[10px] ${i.dueDate < today ? 'text-red-600 dark:text-red-400' : 'text-app-text-muted'}`}>
                    {day(i.issueDate)} · {i.dueDate < today ? `overdue since ${day(i.dueDate)}` : `due ${day(i.dueDate)}`}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-app-text">{formatCurrency(i.balance)}</span>
              </button>
            </li>
          ))}
          {invoices.length > 4 && (
            <li className="pt-1.5 text-[11px] text-app-text-muted">and {invoices.length - 4} more in Quotes & Invoices</li>
          )}
        </ul>
      )}
    </div>
  );
}
