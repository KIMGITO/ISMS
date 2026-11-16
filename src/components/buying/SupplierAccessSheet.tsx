// src/components/buying/SupplierAccessSheet.tsx
// Workers → Suppliers → a supplier: who there can sign in, invitations not used yet, and
// taking access back. Inviting uses the same form as staff (onInvite fills it in).
// What suppliers see is set in Roles → Supplier.
import React, { useCallback, useEffect, useState } from 'react';
import { Copy, MessageCircle, Send, Trash2, UserCheck } from 'lucide-react';
import { FormSheet, primaryBtn, secondaryBtn } from '../shared/FormSheet';
import { appDialog } from '../AppDialog';
import { toUserMessage } from '../../utils/userError';
import { loadSupplierAccess, removeSupplierAccess, type SupplierAccess } from '../../services/supplierPortal';
import type { Supplier } from '../../services/operations';

const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '');

export function SupplierAccessSheet({ supplier, businessName, canManage, onClose, onInvite, onChanged }: {
  supplier: Supplier; businessName: string; canManage: boolean; onClose: () => void;
  /** Opens the Workers invite form for this supplier. */
  onInvite: () => void;
  onChanged?: () => void;
}) {
  const [access, setAccess] = useState<SupplierAccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setAccess(await loadSupplierAccess(supplier.id)); }
    catch (e) { setError(toUserMessage(e, 'Could not load app access.')); }
  }, [supplier.id]);
  useEffect(() => { void load(); }, [load]);

  const remove = async (ids: { accountId?: string; invitationId?: string }, who: string) => {
    const ok = await appDialog.confirm({
      title: ids.accountId ? `Remove ${who}'s access?` : 'Take back this invitation?',
      message: ids.accountId ? 'They can no longer sign in to see your orders, prices or payments. Their past orders stay.' : 'The code stops working.',
      confirmLabel: ids.accountId ? 'Remove access' : 'Take back',
      destructive: true,
    });
    if (!ok) return;
    try { await removeSupplierAccess(ids); await load(); onChanged?.(); }
    catch (e) { setError(toUserMessage(e, 'Could not remove. Try again.')); }
  };

  const shareText = (code: string) =>
    `${businessName} invites you to see your orders and payments in the KayKay's app. Sign up with your email, choose "Join team" and enter the code ${code}.`;

  return (
    <FormSheet title={`App access · ${supplier.company || supplier.name}`} subtitle="People at this supplier sign in to see only their own orders, price requests, deliveries and statement. Choose what they see in Roles → Supplier." onClose={onClose}>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!access ? <p className="text-sm text-app-text-muted">Loading…</p> : (
        <>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-app-text-muted">Can sign in</p>
            {access.accounts.length === 0 ? <p className="text-sm text-app-text-muted">Nobody yet.</p> : access.accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-xl ring-1 ring-app-border px-3 py-2">
                <UserCheck size={15} className="text-emerald-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{a.name}</p>
                  <p className="text-[11px] text-app-text-muted truncate">{a.email} · since {day(a.since)}{a.lastSeen ? ` · last in ${day(a.lastSeen)}` : ''}</p>
                </div>
                {canManage && <button onClick={() => void remove({ accountId: a.id }, a.name)} aria-label={`Remove ${a.name}`} className="p-2 rounded-lg text-red-600 hover:bg-red-500/10 cursor-pointer"><Trash2 size={15} /></button>}
              </div>
            ))}
          </div>
          {access.invitations.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-app-text-muted">Invited, not joined yet</p>
              {access.invitations.map((i) => (
                <div key={i.id} className="rounded-xl ring-1 ring-app-border px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{i.name} · <span className="font-mono">{i.code}</span></p>
                      <p className="text-[11px] text-app-text-muted truncate">{i.email} · until {day(i.expiresAt)}</p>
                    </div>
                    {canManage && <button onClick={() => void remove({ invitationId: i.id }, i.name)} aria-label="Take back" className="p-2 rounded-lg text-red-600 hover:bg-red-500/10 cursor-pointer"><Trash2 size={15} /></button>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} onClick={() => void navigator.clipboard?.writeText(shareText(i.code))}><Copy size={13} /> Copy</button>
                    {supplier.phone && (
                      <a className={`${secondaryBtn} !px-3 !py-1.5 text-xs`} target="_blank" rel="noreferrer"
                        href={`https://wa.me/${supplier.phone.replace(/\D/g, '').replace(/^0/, '254')}?text=${encodeURIComponent(shareText(i.code))}`}>
                        <MessageCircle size={13} /> WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {canManage ? (
            <div className="flex justify-end">
              <button className={primaryBtn} onClick={onInvite}><Send size={15} /> Invite someone at {supplier.company || supplier.name}</button>
            </div>
          ) : <p className="text-xs text-app-text-muted">Only the owner or an admin can give suppliers app access.</p>}
        </>
      )}
    </FormSheet>
  );
}
