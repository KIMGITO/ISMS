// Workers → Suppliers: the suppliers this business buys from and who at each can sign in.
// Suppliers are added and invited with the same form as staff (role "Supplier"); this list
// shows them, opens who has access, and starts an invitation for one that has nobody yet.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Truck, UserCheck, Clock, Send, Search } from 'lucide-react';
import { useBusinessStore, onBranchChange } from '../../stores/businessStore';
import { listSuppliers, type Supplier } from '../../services/operations';
import { loadSupplierAccess, type SupplierAccess } from '../../services/supplierPortal';
import { SwipeRow } from '../shared/SwipeRow';
import { SupplierAccessSheet } from './SupplierAccessSheet';

export function SuppliersTeamCard({ canManage, onInvite, refreshKey = 0 }: {
  canManage: boolean;
  /** Fills the invite form for this supplier. */
  onInvite: (supplier: Supplier) => void;
  /** Bumped after the form adds or invites a supplier, so the list reloads. */
  refreshKey?: number;
}) {
  const businessId = useBusinessStore((s) => s.activeBusinessId) || '';
  const businessName = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name) || 'Your business';
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [access, setAccess] = useState<Record<string, SupplierAccess>>({});
  const [open, setOpen] = useState<Supplier | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const list = await listSuppliers(businessId);
      setSuppliers(list);
      // Who can sign in at each; a supplier whose list fails just shows no one.
      const rows = await Promise.all(list.map((s) => loadSupplierAccess(s.id).then((a) => [s.id, a] as const).catch(() => null)));
      setAccess(Object.fromEntries(rows.filter(Boolean) as [string, SupplierAccess][]));
    } catch {
      setSuppliers([]);
    }
  }, [businessId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => onBranchChange(() => { setSuppliers(null); void load(); }), [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (suppliers || []).filter((s) => !q || [s.name, s.company, s.phone, s.productSupplied].some((v) => v.toLowerCase().includes(q)));
  }, [suppliers, query]);

  return (
    <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <div className="border-b border-app-border/40 pb-2.5 flex items-center gap-2">
        <h3 className="text-xs font-bold text-app-text flex items-center gap-1.5">
          <Truck size={14} className="text-amber-500" /> Suppliers ({suppliers?.length ?? '…'})
        </h3>
        <span className="ml-auto text-[10px] text-app-text-muted">Add one with the form: role Supplier</span>
      </div>
      {(suppliers?.length ?? 0) > 5 && (
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search suppliers"
            className="w-full bg-app-bg border border-app-border rounded-xl pl-8 pr-3 py-2 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
      )}
      <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
        {suppliers === null ? (
          <p className="p-4 text-center text-[11px] text-app-text-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-[11px] text-app-text-muted">
            {suppliers.length === 0 ? 'No suppliers yet. Choose the Supplier role in the form to add one.' : 'No supplier matches.'}
          </p>
        ) : (
          shown.map((s) => {
            const a = access[s.id];
            const signedIn = a?.accounts.length ?? 0;
            const invited = a?.invitations.length ?? 0;
            return (
              <SwipeRow
                key={s.id}
                onClick={() => setOpen(s)}
                title={s.company || s.name}
                subtitle={s.productSupplied}
                actions={[
                  { label: 'Invite', icon: <Send size={18} />, tone: 'amber', hidden: !canManage, onClick: () => onInvite(s) },
                ]}
                more={[
                  { label: 'Who can sign in', icon: <UserCheck size={16} />, onClick: () => setOpen(s) },
                  { label: 'Invite someone here', icon: <Send size={16} />, hidden: !canManage, onClick: () => onInvite(s) },
                ]}
                className="rounded-xl border border-app-border hover:border-amber-500/50 transition"
                contentClassName="p-3 flex items-center gap-3 cursor-pointer select-none"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-app-text truncate">{s.company || s.name}</p>
                  <p className="text-[10px] text-app-text-muted truncate">
                    {[s.company ? s.name : '', s.phone, s.productSupplied].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {signedIn > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      <UserCheck size={10} /> {signedIn} can sign in
                    </span>
                  )}
                  {invited > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                      <Clock size={10} /> {invited} invited
                    </span>
                  )}
                  {a && signedIn === 0 && invited === 0 && <span className="text-[11px] text-app-text-muted">No app access</span>}
                </div>
              </SwipeRow>
            );
          })
        )}
      </div>
      {open && (
        <SupplierAccessSheet
          supplier={open}
          businessName={businessName}
          canManage={canManage}
          onClose={() => setOpen(null)}
          onInvite={() => { const s = open; setOpen(null); onInvite(s); }}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

export default SuppliersTeamCard;
