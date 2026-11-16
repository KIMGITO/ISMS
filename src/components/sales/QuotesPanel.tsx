// Sales Log → Quotes: every quote made from the POS cart. Sell in POS fills the cart at the
// quoted prices; the sale then marks the quote sold. Share again, decline or delete from here.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, MessageCircle, Search, Share2, ShoppingCart, Trash2, X } from 'lucide-react';
import { useBusinessStore, onBranchChange } from '../../stores/businessStore';
import { useAuthStore } from '../../stores/authStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useCustomerStore } from '../../stores/customerStore';
import { useCartStore } from '../../stores/cartStore';
import { useUiStore } from '../../stores/uiStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { hasRolePermission } from '../../utils/permissions';
import { formatCurrency } from '../../utils/helpers';
import { toUserMessage } from '../../utils/userError';
import { displayName } from '../../utils/stringUtils';
import { SwipeRow } from '../shared/SwipeRow';
import { appDialog } from '../AppDialog';
import { deleteQuote, loadSalesDocs, quoteState, setQuoteStatus, QUOTE_WORD, type Quote } from '../../services/salesDocs';
import { shareQuotePdf, shareQuoteWhatsApp } from '../../services/quoteShare';
import type { CartItem } from '../../types';

const TONE: Record<string, string> = {
  draft: 'bg-slate-500/15 text-app-text-muted',
  sent: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  accepted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  declined: 'bg-red-500/15 text-red-700 dark:text-red-300',
  expired: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};
const shortDate = (iso: string) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '');

export function QuotesPanel() {
  const businessId = useBusinessStore((s) => s.activeBusinessId) || '';
  const business = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId));
  const role = useAuthStore((s) => s.currentEmployee?.role) || 'Guest';
  const products = useInventoryStore((s) => s.products);
  const customers = useCustomerStore((s) => s.customers);
  const showToast = useNotificationStore((s) => s.showToast);
  const manages = hasRolePermission(role, 'quotes.manage' as any);
  const sells = hasRolePermission(role, 'pos.create_sale' as any);

  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    if (!businessId) return;
    loadSalesDocs(businessId)
      .then((d) => setQuotes(d.quotes))
      .catch(() => setQuotes([]));
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onBranchChange(() => { setQuotes(null); load(); }), [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (quotes || [])
      .filter((x) => showAll || ['draft', 'sent'].includes(quoteState(x)))
      .filter((x) => !q || x.number.toLowerCase().includes(q) || x.customerName.toLowerCase().includes(q) || x.customerPhone.includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [quotes, showAll, query]);

  const sellInPos = (q: Quote) => {
    const items: CartItem[] = [];
    const skipped: string[] = [];
    for (const line of q.lines) {
      const product = line.productId ? products.find((p) => p.id === line.productId) : undefined;
      if (!product || product.stock <= 0) {
        skipped.push(displayName(line.name));
        continue;
      }
      const quantity = Math.min(line.quantity, product.stock);
      if (quantity < line.quantity) skipped.push(`${displayName(line.name)} (only ${product.stock} in stock)`);
      // The quoted price is honoured even if the shelf price has changed since.
      items.push({ product: { ...product, price: line.unitPrice }, quantity, discountPercentage: line.discountPct || 0 });
    }
    if (items.length === 0) {
      showToast('Nothing to sell', 'None of the quoted items are in stock here.', undefined, 'error');
      return;
    }
    const customer = q.customerId ? customers.find((c) => c.id === q.customerId) ?? null : null;
    useCartStore.getState().loadQuote({ id: q.id, number: q.number }, items, customer);
    useUiStore.getState().setActiveTab('pos');
    if (skipped.length) showToast('Some items left out', skipped.join(', '), undefined, 'info');
  };

  const pdf = async (q: Quote) => {
    try {
      const r = await shareQuotePdf(q, business, businessId);
      if (r === 'downloaded') showToast('PDF saved', `${q.number}.pdf`, undefined, 'success');
      if (q.status === 'draft' && manages) await setQuoteStatus(q.id, 'sent').then(load).catch(() => undefined);
    } catch (err) {
      showToast('Not shared', toUserMessage(err, 'Could not make the PDF.'), undefined, 'error');
    }
  };
  const whatsapp = async (q: Quote) => {
    const phone = q.customerPhone || customers.find((c) => c.id === q.customerId)?.phone || '';
    if (!phone) return showToast('No phone number', 'Share the PDF instead.', undefined, 'error');
    const ok = await shareQuoteWhatsApp(q, phone, business, businessId);
    if (!ok) return showToast('WhatsApp did not open', 'Share the PDF instead.', undefined, 'error');
    if (q.status === 'draft' && manages) await setQuoteStatus(q.id, 'sent').then(load).catch(() => undefined);
  };
  const decline = async (q: Quote) => {
    try {
      await setQuoteStatus(q.id, 'declined');
      load();
    } catch (err) {
      showToast('Not changed', toUserMessage(err, 'Could not update the quote.'), undefined, 'error');
    }
  };
  const remove = async (q: Quote) => {
    const ok = await appDialog.confirm({ title: `Delete quote ${q.number}?`, message: `${q.customerName} · ${formatCurrency(q.total)}. This can't be undone.`, confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await deleteQuote(q.id);
      load();
    } catch (err) {
      showToast('Not deleted', toUserMessage(err, 'Could not delete the quote.'), undefined, 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search quotes by number, name or phone"
            className="w-full bg-app-card border border-app-border rounded-xl pl-8 pr-3 py-2 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="shrink-0 rounded-xl px-3 py-2 text-xs ring-1 ring-app-border bg-app-card text-app-text cursor-pointer"
        >
          {showAll ? 'Open only' : 'Show all'}
        </button>
      </div>
      <p className="text-[11px] text-app-text-muted">
        Make a quote in POS: fill the cart, then tap Quote (Alt+Q). When the customer comes back, tap Sell in POS.
      </p>

      {quotes === null ? (
        <p className="text-xs text-app-text-muted p-6 text-center">Loading quotes…</p>
      ) : shown.length === 0 ? (
        <div className="p-10 bg-app-card rounded-2xl border border-dashed border-app-border text-center text-xs text-app-text-muted flex flex-col items-center gap-2">
          <FileText size={22} />
          {showAll ? 'No quotes yet.' : 'No open quotes.'}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((q) => {
            const state = quoteState(q);
            const open = state === 'draft' || state === 'sent';
            return (
              <SwipeRow
                key={q.id}
                onClick={() => (open && sells ? sellInPos(q) : void pdf(q))}
                title={`${q.number} · ${formatCurrency(q.total)}`}
                subtitle={`${q.customerName} · valid until ${shortDate(q.validUntil)}`}
                details={
                  <ul className="space-y-1">
                    {q.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{l.quantity} × {displayName(l.name)}</span>
                        <span className="tabular-nums text-app-text-muted shrink-0">{formatCurrency(l.total)}</span>
                      </li>
                    ))}
                  </ul>
                }
                actions={[
                  { label: 'Sell', icon: <ShoppingCart size={18} />, tone: 'emerald', hidden: !open || !sells, onClick: () => sellInPos(q) },
                  { label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !manages || state === 'accepted', onClick: () => void remove(q) },
                ]}
                more={[
                  { label: 'Sell in POS', icon: <ShoppingCart size={16} />, hidden: !open || !sells, onClick: () => sellInPos(q) },
                  { label: 'Share PDF', icon: <Share2 size={16} />, onClick: () => void pdf(q) },
                  { label: 'Send on WhatsApp', icon: <MessageCircle size={16} />, onClick: () => void whatsapp(q) },
                  { label: 'Customer said no', icon: <X size={16} />, hidden: !open || !manages, onClick: () => void decline(q) },
                  { label: 'Delete quote', icon: <Trash2 size={16} />, tone: 'red', hidden: !manages || state === 'accepted', onClick: () => void remove(q) },
                ]}
                className="rounded-2xl border border-app-border hover:border-amber-500 transition"
                contentClassName="p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono font-bold text-app-text-muted">{q.number}</span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${TONE[state]}`}>{state === 'accepted' ? 'Sold' : QUOTE_WORD[state]}</span>
                  </div>
                  <div className="text-xs font-semibold text-app-text mt-1 truncate">{q.customerName}</div>
                  <div className="text-[10px] text-app-text-muted mt-0.5">
                    {q.lines.length} {q.lines.length === 1 ? 'item' : 'items'} · made {shortDate(q.issueDate)} · valid until {shortDate(q.validUntil)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-xs font-black text-amber-500 tabular-nums">{formatCurrency(q.total)}</span>
                  {open && sells && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); sellInPos(q); }}
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                    >
                      <ShoppingCart size={12} /> Sell in POS
                    </button>
                  )}
                </div>
              </SwipeRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default QuotesPanel;
