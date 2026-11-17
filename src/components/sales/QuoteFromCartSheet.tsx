// POS → Quote: the customer wants prices before buying. Saves the cart as a numbered quote,
// then offers it as a PDF or on WhatsApp. Later, Sales Log → Quotes → Sell in POS puts it
// back in the cart at the quoted prices.
import React, { useState } from 'react';
import { Check, MessageCircle, Share2 } from 'lucide-react';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn } from '../shared/FormSheet';
import { useBusinessStore } from '../../stores/businessStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useCartStore } from '../../stores/cartStore';
import { formatCurrency } from '../../utils/helpers';
import { toUserMessage } from '../../utils/userError';
import { draftTotals, loadSalesDocs, saveQuote, VAT_RATES, type DraftLine, type Quote } from '../../services/salesDocs';
import { shareQuotePdf, shareQuoteWhatsApp } from '../../services/quoteShare';
import { useVatPercent } from '../../services/kra/kraService';

const VALID_FOR = [7, 14, 30];
const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
};

export function QuoteFromCartSheet({ deliveryFee, onClose }: { deliveryFee: number; onClose: () => void }) {
  const businessId = useBusinessStore((s) => s.activeBusinessId) || '';
  const business = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId));
  const showToast = useNotificationStore((s) => s.showToast);
  const cart = useCartStore((s) => s.cart);
  const customer = useCartStore((s) => s.selectedCustomer);
  const clearCart = useCartStore((s) => s.clearCart);

  const [name, setName] = useState(customer?.name || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [days, setDays] = useState(7);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Quote | null>(null);

  // Same prices and VAT as the till: VAT is added on top of the shelf price.
  // No VAT unless KRA eTIMS is connected.
  const taxPct = useVatPercent(business);
  const vatRate = taxPct === 0 ? 0 : (VAT_RATES as readonly number[]).includes(taxPct) ? taxPct : 16;
  const lines: DraftLine[] = cart.map((item) => ({
    productId: item.product.id,
    name: item.product.name,
    unit: item.product.unit || '',
    quantity: item.quantity,
    unitPrice: item.product.price,
    discountPct: item.discountPercentage || 0,
    vatRate,
  }));
  const totals = draftTotals(lines, deliveryFee);

  const save = async () => {
    if (!name.trim()) return showToast('Who is it for?', 'Type the customer\'s name.', undefined, 'error');
    setBusy(true);
    try {
      const id = await saveQuote(businessId, {
        customerId: customer?.id ?? null,
        customerName: name,
        customerPhone: phone,
        date: isoDay(),
        untilDate: isoDay(days),
        notes,
        terms: '',
        deliveryFee,
        lines,
      });
      const docs = await loadSalesDocs(businessId);
      const quote = docs.quotes.find((q) => q.id === id) || null;
      setSaved(quote);
      clearCart();
      showToast('Quote saved', quote ? `${quote.number} · ${formatCurrency(quote.total)}` : 'Find it in Sales Log → Quotes.', undefined, 'success');
      if (!quote) onClose();
    } catch (err) {
      showToast('Quote not saved', toUserMessage(err, 'Could not save the quote. Check your connection.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pdf = async () => {
    if (!saved) return;
    try {
      const r = await shareQuotePdf(saved, business, businessId);
      if (r === 'downloaded') showToast('PDF saved', `${saved.number}.pdf`, undefined, 'success');
    } catch (err) {
      showToast('Not shared', toUserMessage(err, 'Could not make the PDF.'), undefined, 'error');
    }
  };
  const whatsapp = async () => {
    if (!saved) return;
    if (!saved.customerPhone) return showToast('No phone number', 'Share the PDF instead.', undefined, 'error');
    const ok = await shareQuoteWhatsApp(saved, saved.customerPhone, business, businessId);
    if (!ok) showToast('WhatsApp did not open', 'Share the PDF instead.', undefined, 'error');
  };

  if (saved) {
    return (
      <FormSheet
        title={`Quote ${saved.number} saved`}
        subtitle={`${saved.customerName} · ${formatCurrency(saved.total)} · valid until ${saved.validUntil.split('-').reverse().join('/')}`}
        onClose={onClose}
        footer={<button type="button" className={primaryBtn} onClick={onClose}><Check size={15} /> Done</button>}
      >
        <p className="text-sm text-app-text-muted">
          To sell later: Sales Log → Quotes → Sell in POS.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button type="button" className={secondaryBtn} onClick={() => void pdf()}><Share2 size={15} /> PDF</button>
          <button type="button" className={secondaryBtn} onClick={() => void whatsapp()} disabled={!saved.customerPhone}><MessageCircle size={15} /> WhatsApp</button>
        </div>
      </FormSheet>
    );
  }

  return (
    <FormSheet
      title="Save as a quote"
      subtitle={`${cart.length} ${cart.length === 1 ? 'item' : 'items'} · ${formatCurrency(totals.total)}${totals.vat ? ` incl. VAT ${formatCurrency(totals.vat)}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={primaryBtn} onClick={() => void save()} disabled={busy || cart.length === 0}>
            {busy ? 'Saving…' : 'Save quote'}
          </button>
        </>
      }
    >
      <Field label="Customer">
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus={!name} />
      </Field>
      <Field label="Phone" hint="For sending it on WhatsApp">
        <input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07…" inputMode="tel" />
      </Field>
      <Field label="Valid for">
        <div className="flex gap-2">
          {VALID_FOR.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm ring-1 cursor-pointer ${days === d ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/40 font-semibold' : 'bg-app-bg text-app-text ring-app-border'}`}
            >
              {d} days
            </button>
          ))}
        </div>
      </Field>
      <Field label="Note on the quote (optional)">
        <textarea className={fieldClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Delivery included within town" />
      </Field>
      <ul className="divide-y divide-app-border/60 rounded-xl bg-app-bg px-3">
        {cart.map((item) => (
          <li key={item.product.id} className="flex justify-between gap-3 py-2 text-xs">
            <span className="min-w-0 truncate">{item.quantity} × {item.product.name}{item.discountPercentage ? ` (${item.discountPercentage}% off)` : ''}</span>
            <span className="tabular-nums shrink-0">{formatCurrency(item.product.price * item.quantity * (1 - (item.discountPercentage || 0) / 100))}</span>
          </li>
        ))}
        {deliveryFee > 0 && (
          <li className="flex justify-between gap-3 py-2 text-xs"><span>Delivery</span><span className="tabular-nums">{formatCurrency(deliveryFee)}</span></li>
        )}
      </ul>
    </FormSheet>
  );
}

export default QuoteFromCartSheet;
