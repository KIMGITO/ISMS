// src/components/loyalty/CustomerReferralCard.tsx
// A customer's referral code on their Loyalty page: share it by WhatsApp or SMS, and see how
// it is doing. Friends show by first name and initial only. The code is made by the database
// the first time it's needed while a referral programme is running.
import React, { useEffect, useState } from 'react';
import { Copy, Gift, MessageCircle, MessageSquareText } from 'lucide-react';
import type { Customer } from '../../types';
import { customerReferral, referralShareText, REFERRAL_STATUS_LABEL, type CustomerReferral } from '../../services/promotions';
import { ReceiptShareService } from '../../services/receipt/ReceiptShareService';
import { nativeUiService } from '../../core/native/NativeUiService';
import { useBusinessStore } from '../../stores/businessStore';
import { useNotificationStore } from '../../stores/notificationStore';

export default function CustomerReferralCard({ customer }: { customer: Customer }) {
  const [r, setR] = useState<CustomerReferral | null>(null);
  const showToast = useNotificationStore((s) => s.showToast);
  const businessName = useBusinessStore((s) => s.businesses.find((b) => b.id === customer.businessId)?.name ?? 'our shop');

  useEffect(() => {
    let live = true;
    setR(null);
    // Quietly nothing when the programme or its database update isn't there.
    customerReferral(customer.id).then((x) => live && setR(x)).catch(() => live && setR(null));
    return () => {
      live = false;
    };
  }, [customer.id]);

  if (!r || !r.code || (!r.campaign && r.invited === 0)) return null;
  const text = referralShareText(businessName, r);
  const onHold = r.codeStatus !== 'active';

  const copy = async () => {
    const ok = await nativeUiService.copyToClipboard(text, 'Referral message');
    showToast('Referral', ok ? 'Message copied.' : 'Could not copy.', undefined, ok ? 'success' : 'error');
  };
  const whatsapp = () => void ReceiptShareService.shareTextViaWhatsApp(customer.phone || '', text);
  const sms = () => void ReceiptShareService.openExternalUrl(`sms:${(customer.phone || '').replace(/\s/g, '')}?body=${encodeURIComponent(text)}`);

  return (
    <section className="mt-2 rounded-2xl bg-app-card ring-1 ring-app-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Gift size={15} className="text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm font-semibold text-app-text">Referral code</p>
        <span className="ml-auto font-mono font-bold text-app-text tracking-wide">{r.code}</span>
      </div>
      {onHold && <p className="text-xs text-red-600 dark:text-red-400">This code is {r.codeStatus === 'suspended' ? 'on hold' : 'revoked'}{r.codeReason ? `: ${r.codeReason}` : ''}.</p>}
      {r.campaign && !onHold && (
        <p className="text-xs text-app-text-muted">
          A new customer who gives this code gets {r.campaign.friendGets}; You, {customer.name.split(' ')[0]} gets {r.campaign.youGet} after their first purchase of at least {r.campaign.minPurchase} Ksh by the end of {r.campaign.endsAt}.
        </p>
      )}
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[
          ['Invited', r.invited],
          ['Successful', r.successful],
          ['Waiting', r.pending],
          ['Rewards', r.rewardsEarned],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-app-bg py-1.5">
            <p className="text-sm font-bold tabular-nums text-app-text">{v}</p>
            <p className="text-[10px] text-app-text-muted">{l}</p>
          </div>
        ))}
      </div>
      {r.rewardsAvailable.length > 0 && (
        <ul className="text-xs space-y-0.5">
          {r.rewardsAvailable.map((w, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-app-text">{w.what}</span>
              <span className="font-mono text-app-text-muted">{w.code}{w.expiresAt ? ` · until ${new Date(w.expiresAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {r.friends.length > 0 && (
        <p className="text-[11px] text-app-text-muted">
          {r.friends.slice(0, 5).map((f) => `${f.name} (${REFERRAL_STATUS_LABEL[f.status].toLowerCase()})`).join(', ')}
        </p>
      )}
      {r.campaign && !onHold && (
        <div className="flex gap-1.5">
          <button onClick={whatsapp} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold py-2 cursor-pointer">
            <MessageCircle size={14} /> WhatsApp Code
          </button>
          <button onClick={sms} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-app-bg ring-1 ring-app-border text-app-text text-xs font-semibold py-2 cursor-pointer">
            <MessageSquareText size={14} /> SMS Code
          </button>
          <button onClick={() => void copy()} aria-label="Copy the message" className="inline-flex items-center justify-center rounded-xl bg-app-bg ring-1 ring-app-border text-app-text px-3 cursor-pointer">
            <Copy size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
