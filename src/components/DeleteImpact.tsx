// src/components/DeleteImpact.tsx
// Deleting a customer, product, supplier, expense, removing a worker or closing a branch is never just a swipe: this sheet first shows what
// the delete would touch (from delete_impact, 20261205002), then the person decides.
// Anything that would break the money rules (money still owed, wallet money, stock still held,
// open orders) is listed as "Do this first" and the Delete button stays off; the database refuses
// those deletes too.
//
//   if (await confirmDelete({ kind: 'customer', id: c.id, name: c.name })) await deleteCustomer(c.id);
//
// Render <DeleteImpactHost /> once near the root of the app.

import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { AlertTriangle, Info } from 'lucide-react';
import { FormSheet } from './shared/FormSheet';
import { getSupabase } from '../services/supabaseClient';
import { toUserMessage } from '../utils/userError';

export type DeleteKind = 'customer' | 'product' | 'supplier' | 'worker' | 'branch' | 'expense';

interface Request {
  kind: DeleteKind;
  id: string;
  name: string;
  /** For a worker: the branch they are removed from (id is then the person). */
  businessId?: string;
  /** The button's word: "Delete" (default), "Remove" or "Close". */
  verb?: string;
  resolve: (ok: boolean) => void;
}

interface Impact {
  name: string;
  blockers: string[];
  effects: string[];
}

const useDeleteStore = create<{ current: Request | null }>(() => ({ current: null }));

/** Shows what deleting would touch and resolves true only if the person confirms. */
export function confirmDelete(options: Omit<Request, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = useDeleteStore.getState().current;
    prev?.resolve(false);
    useDeleteStore.setState({ current: { ...options, resolve } });
  });
}


export function DeleteImpactHost() {
  const current = useDeleteStore((s) => s.current);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setImpact(null);
    setError(null);
    if (!current) return;
    let live = true;
    getSupabase()
      .rpc('delete_impact', { p_kind: current.kind, p_id: current.id, p_business_id: current.businessId ?? null })
      .then(({ data, error: err }) => {
        if (!live) return;
        if (err) setError(toUserMessage(err, 'Could not check what this would affect.'));
        else setImpact(data as Impact);
      });
    return () => {
      live = false;
    };
  }, [current]);

  if (!current) return null;
  const close = (ok: boolean) => {
    current.resolve(ok);
    useDeleteStore.setState({ current: null });
  };
  const verb = current.verb ?? 'Delete';
  const blocked = !!impact?.blockers.length;

  return (
    <FormSheet
      title={`${verb} ${current.name}?`}
      subtitle="What this affects"
      onClose={() => close(false)}
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => close(false)}
            className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-xs font-semibold border border-app-border bg-app-card hover:bg-app-bg text-app-text cursor-pointer">
            {blocked ? 'Close' : 'Keep it'}
          </button>
          <button type="button" disabled={!impact || blocked} onClick={() => close(true)}
            className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
            {verb}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {!impact && !error && <p className="text-app-text-muted">Checking what this would affect...</p>}
        {error && <p className="text-red-600">{error}</p>}
        {impact && blocked && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
              <AlertTriangle size={14} aria-hidden /> Do this first
            </p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-app-text list-disc pl-5">
              {impact.blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}
        {impact && (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-app-text-muted">
              <Info size={14} aria-hidden /> {blocked ? `When you can ${verb.toLowerCase()} it` : `If you ${verb.toLowerCase()} it`}
            </p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-app-text list-disc pl-5">
              {impact.effects.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>
    </FormSheet>
  );
}

export default DeleteImpactHost;
