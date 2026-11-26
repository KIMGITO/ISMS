// src/components/payments/TillSaleLink.tsx
// Links a till (C2B) payment to the M-Pesa sale it paid for. The server lists only this
// business's M-Pesa sales with room left for the amount, nearest in time first, and searches
// by receipt number, customer or amount. Same-amount sales are flagged, never auto-picked.

import { useEffect, useMemo, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import type { TillPayment, TillSaleCandidate } from '../../types';
import { MpesaRepository } from '../../services/repositories';
import { useAppStore } from '../../stores/appStore';
import { formatCurrency } from '../../utils/helpers';
import { toUserMessage } from '../../utils/userError';
import { TextInput } from '../shared/Input';
import SearchableDropdown from '../SearchableDropdown';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function TillSaleLink({ payment, onDone }: { payment: TillPayment; onDone: () => void }) {
  const { showToast, currentEmployee } = useAppStore();
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState<TillSaleCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saleId, setSaleId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Debounced server search; a stale reply never overwrites a newer one.
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      MpesaRepository.tillSaleCandidates(payment.id, search)
        .then((rows) => { if (live) setSales(rows); })
        .catch((err) => { if (live) showToast('Till payment', toUserMessage(err, 'Could not load sales.'), undefined, 'error'); })
        .finally(() => { if (live) setLoading(false); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [payment.id, search, showToast]);

  const items = useMemo(() => sales.map((s) => ({
    id: s.saleId,
    label: `${s.reference} · ${formatCurrency(s.total)}`,
    sublabel: [s.customerName || 'Walk-in', when(s.createdAt), s.linked > 0 && `${formatCurrency(s.linked)} already linked`, s.sameAmount && 'same amount'].filter(Boolean).join(' · '),
  })), [sales]);
  const chosen = sales.find((s) => s.saleId === saleId);
  const sameAmountCount = sales.filter((s) => s.sameAmount).length;

  const link = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await MpesaRepository.linkTillPaymentToSale(payment.id, chosen.saleId, currentEmployee?.name || 'Staff');
      showToast('Till payment', `${formatCurrency(payment.amount)} linked to ${chosen.reference}.`, undefined, 'success');
      onDone();
    } catch (err) {
      showToast('Till payment', toUserMessage(err, 'Could not link. Please try again.'), undefined, 'error');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-app-text-muted">Paid for a sale already rung up as M-Pesa</span>
      <TextInput value={search} onChange={(e) => { setSearch(e.target.value); setSaleId(''); }} placeholder="Receipt number, customer or amount" />
      <SearchableDropdown items={items} selectedValue={saleId} onChange={(id) => { setSaleId(id); setConfirming(false); }}
        placeholder={loading ? 'Loading sales...' : sales.length ? 'Choose the sale' : 'No M-Pesa sale has room for this amount'} searchPlaceholder="Filter these sales" />
      {sameAmountCount > 1 && !saleId && (
        <p className="text-xs text-amber-600">{sameAmountCount} sales need exactly this amount. Check the receipt number with the customer.</p>
      )}
      {chosen && (
        <p className="text-xs text-app-text-muted tabular-nums">
          Sale {formatCurrency(chosen.total)} · linked {formatCurrency(chosen.linked)} · left {formatCurrency(chosen.remaining)} · after this {formatCurrency(chosen.remaining - payment.amount)}
        </p>
      )}
      {confirming && chosen ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-11 px-3 border border-app-border rounded-xl text-sm font-semibold cursor-pointer">Back</button>
          <button type="button" disabled={busy} onClick={() => void link()} className="min-h-11 px-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold cursor-pointer disabled:opacity-40">
            Link to {chosen.reference}
          </button>
        </div>
      ) : (
        <button type="button" disabled={!chosen || busy} onClick={() => setConfirming(true)}
          className="min-h-11 px-3 border border-app-border rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40">
          <ShoppingCart size={14} /> Link to this sale
        </button>
      )}
    </div>
  );
}
