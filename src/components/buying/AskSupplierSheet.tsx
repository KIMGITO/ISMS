// src/components/buying/AskSupplierSheet.tsx
// "Ask supplier": from a low-stock alert (or Buying → Reorder), send the product's supplier a
// request with how much, by when and a note ("We need milk tomorrow, 200 L"). It goes to ONE
// supplier, chosen here (the preferred one to start with), even when several sell the product.
// It rings on the phones of the people at that supplier who have the app; the answer comes back as a
// notification. A supplier without the app gets the same words by WhatsApp or SMS.
import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, MessageCircle, Send, Smartphone, XCircle } from 'lucide-react';
import FormSheet, { Field, fieldClass, primaryBtn, secondaryBtn } from '../shared/FormSheet';
import SearchableDropdown from '../SearchableDropdown';
import { formatCurrency } from '../../utils/helpers';
import { ReceiptShareService } from '../../services/receipt/ReceiptShareService';
import {
  askSupplierForStock, cancelStockRequest, kenyaToday, listStockRequestSuppliers, listStockRequests, shortDay, stockRequestLabel,
  type AskResult, type StockRequest, type StockRequestSupplier,
} from '../../services/supplierStockRequests';
import { displayName } from '../../utils/stringUtils';
import { toUserMessage } from '../../utils/userError';
import { NumberInput } from '../shared/Input';

export interface AskSupplierTarget {
  businessId: string;
  productId: string;
  productName: string;
  unit?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  /** Prefills "How much". */
  suggestedQty?: number | null;
  /** False when nobody at the supplier has the app: it goes by WhatsApp or SMS instead. */
  supplierInApp?: boolean | null;
}

const q3 = (n: number) => String(Math.round(n * 1000) / 1000);

export default function AskSupplierSheet({ target, onClose, onSent }: {
  target: AskSupplierTarget;
  onClose: () => void;
  onSent?: (r: AskResult) => void;
}) {
  const [qty, setQty] = useState(target.suggestedQty && target.suggestedQty > 0 ? q3(target.suggestedQty) : '');
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'date' | 'none'>('tomorrow');
  const [date, setDate] = useState(kenyaToday(2));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<AskResult | null>(null);
  const [recent, setRecent] = useState<StockRequest[]>([]);
  const [suppliers, setSuppliers] = useState<StockRequestSupplier[] | null>(null);
  const [supplierId, setSupplierId] = useState(target.supplierId || '');

  useEffect(() => {
    listStockRequestSuppliers(target.productId)
      .then((list) => {
        setSuppliers(list);
        setSupplierId((id) => (id && list.some((x) => x.id === id) ? id : list[0]?.id || ''));
      })
      .catch(() => setSuppliers([]));
  }, [target.productId]);

  useEffect(() => {
    listStockRequests(target.businessId, target.productId)
      .then((list) => setRecent(list.filter((r) => r.status !== 'cancelled').slice(0, 3)))
      .catch(() => undefined);
  }, [target.businessId, target.productId, sent?.id]);

  const neededBy = when === 'today' ? kenyaToday() : when === 'tomorrow' ? kenyaToday(1) : when === 'date' ? date : null;
  const chosen = suppliers?.find((x) => x.id === supplierId) ?? null;
  const supplier = chosen?.name || target.supplierName || 'a supplier';
  const inApp = chosen ? chosen.inApp : target.supplierInApp;
  const n = Number(qty);

  const send = async () => {
    if (!supplierId) { setErr('Choose which supplier to ask.'); return; }
    if (!(n > 0)) { setErr('Type how much you need.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await askSupplierForStock({ productId: target.productId, quantity: n, neededBy, note, supplierId });
      setSent(r);
      onSent?.(r);
    } catch (e) {
      setErr(toUserMessage(e, 'Could not send the request. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const takeBack = async (id: string) => {
    try {
      await cancelStockRequest(id);
      setRecent((list) => list.filter((r) => r.id !== id));
      if (sent?.id === id) onClose();
    } catch (e) {
      setErr(toUserMessage(e, 'Could not cancel the request.'));
    }
  };

  if (sent) {
    return (
      <FormSheet
        title={sent.inApp ? `Ringing at ${sent.supplierName}` : `Send it to ${sent.supplierName}`}
        onClose={onClose}
        footer={<button className={primaryBtn} onClick={onClose}>Done</button>}
      >
        {sent.inApp ? (
          <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/10 p-3">
            <BellRing size={20} className="text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-sm">
              It is ringing on {sent.people === 1 ? 'their phone' : `${sent.people} phones`} until they accept it.
              You will get a notification when they see it, and again when they accept or decline.
            </p>
          </div>
        ) : (
          <p className="text-sm text-app-text-muted">
            Nobody at {sent.supplierName} has the app yet, so it can't ring for them. The request is saved; send them the words below.
          </p>
        )}
        <div className="rounded-xl bg-app-bg p-3 text-[13px] whitespace-pre-wrap break-words">{sent.message}</div>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryBtn} onClick={() => void ReceiptShareService.shareTextViaWhatsApp(sent.phone || '', sent.message)}>
            <MessageCircle size={15} /> WhatsApp
          </button>
          <button className={secondaryBtn} onClick={() => void ReceiptShareService.openExternalUrl(`sms:${sent.phone || ''}?body=${encodeURIComponent(sent.message)}`)}>
            <Smartphone size={15} /> SMS
          </button>
        </div>
        {!sent.inApp && (
          <p className="text-[11px] text-app-text-muted">Invite them in Buying → Suppliers → App access.</p>
        )}
      </FormSheet>
    );
  }

  const chip = (id: typeof when, label: string) => (
    <button
      type="button"
      onClick={() => setWhen(id)}
      aria-pressed={when === id}
      className={`px-3 py-1.5 rounded-full text-[13px] font-medium ring-1 cursor-pointer ${when === id ? 'bg-amber-500 text-slate-950 ring-amber-500' : 'bg-app-bg ring-app-border text-app-text'}`}
    >
      {label}
    </button>
  );

  return (
    <FormSheet
      title={`Ask ${supplier}`}
      subtitle={`${displayName(target.productName)}${!supplierId ? '' : inApp === false ? ' · they don\'t have the app, so you\'ll send it by WhatsApp or SMS' : ' · rings on their phone only'}`}
      onClose={onClose}
      footer={
        <>
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={busy || !(n > 0) || !supplierId} onClick={() => void send()}>
            <Send size={15} /> {busy ? 'Sending…' : 'Send request'}
          </button>
        </>
      }
    >
      <Field label="Supplier to ask" hint="Only this supplier gets the request, even if others sell it too.">
        {suppliers && suppliers.length === 0 ? (
          <p className="text-sm text-app-text">No suppliers yet. Add one in Buying → Suppliers.</p>
        ) : (
          <SearchableDropdown
            items={(suppliers || []).map((x) => ({
              id: x.id,
              label: x.name,
              sublabel: [
                x.preferred ? 'Preferred' : null,
                x.times > 0 ? `delivered ${x.times}×${x.lastDate ? `, last ${shortDay(x.lastDate)}` : ''}${x.lastPrice != null ? ` at ${formatCurrency(x.lastPrice)}` : ''}` : 'not bought from yet',
                x.inApp ? 'rings on their phone' : 'no app: WhatsApp/SMS',
              ].filter(Boolean).join(' · '),
            }))}
            selectedValue={supplierId}
            onChange={setSupplierId}
            placeholder={suppliers ? 'Choose a supplier' : 'Loading suppliers…'}
            searchPlaceholder="Search suppliers"
            disabled={!suppliers}
          />
        )}
      </Field>
      <Field label={`How much${target.unit ? ` (${target.unit})` : ''}`}>
        <NumberInput min={0} autoFocus
          value={qty} onChange={(v) => setQty((v == null ? '' : String(v)))}
          placeholder="e.g. 200" inputClassName="tabular-nums"
        />
      </Field>
      <div>
        <p className="text-xs font-medium text-app-text-muted mb-1">Needed by</p>
        <div className="flex flex-wrap gap-2">
          {chip('today', 'Today')}
          {chip('tomorrow', 'Tomorrow')}
          {chip('date', 'Pick a day')}
          {chip('none', 'Any time')}
        </div>
        {when === 'date' && (
          <input type="date" min={kenyaToday()} value={date} onChange={(e) => setDate(e.target.value)} className={`${fieldClass} mt-2`} aria-label="Day you need it" />
        )}
      </div>
      <Field label="Note (optional)">
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3}
          placeholder="e.g. We need milk tomorrow, 200 L, before 8 am"
          className={`${fieldClass} resize-none`}
        />
      </Field>
      {err && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}

      {recent.length > 0 && (
        <div className="pt-1">
          <p className="text-xs font-medium text-app-text-muted mb-1">Asked before</p>
          <ul className="divide-y divide-app-border/60 text-[13px]">
            {recent.map((r) => (
              <li key={r.id} className="py-2 flex items-start gap-2">
                {r.status === 'accepted' ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                  : r.status === 'declined' ? <XCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  : <BellRing size={15} className="text-amber-500 shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <p className="break-words">
                    {q3(r.quantity)} {r.unit || ''} from {r.supplierName}{r.neededBy ? ` for ${shortDay(r.neededBy)}` : ''}
                    <span className="text-app-text-muted"> · {stockRequestLabel(r)}</span>
                  </p>
                  {r.responseNote && <p className="text-[12px] text-app-text-muted break-words">“{r.responseNote}”</p>}
                </div>
                {(r.status === 'sent' || r.status === 'seen') && (
                  <button className="text-[12px] text-red-600 dark:text-red-400 shrink-0 cursor-pointer" onClick={() => void takeBack(r.id)}>Cancel</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </FormSheet>
  );
}
