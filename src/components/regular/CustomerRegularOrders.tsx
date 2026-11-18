// The customer's regular orders as one small card beside their points (no extra tab):
// each product's week in a few words, today and tomorrow, and anything the customer asked for.
// Tap a line to change it; the full day-by-day work happens on the Regular Orders screen.
import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronRight, Plus } from 'lucide-react';
import { useBusinessStore } from '../../stores/businessStore';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { hasRolePermission } from '../../utils/permissions';
import type { Customer } from '../../types';
import { DecisionSheet, RegularOrderSheet, deliveryPlace } from './RegularOrderSheets';
import {
  addDays, kenyaToday, loadRegularOrders, needsDecision, qtyText, STATUS_LABEL, weekText,
  type RegularBoard, type RegularOrder,
} from '../../services/regularOrders';

export default function CustomerRegularOrders({ customer }: { customer: Customer }) {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role) || '';
  const canEdit = hasRolePermission(role, 'customers.schedules');
  const canApprove = hasRolePermission(role, 'customers.manage');
  const [board, setBoard] = useState<RegularBoard | null>(null);
  const [edit, setEdit] = useState<RegularOrder | null | 'new'>(null);
  const [decide, setDecide] = useState<RegularOrder | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const t = kenyaToday();
    try {
      setBoard(await loadRegularOrders(businessId, t, addDays(t, 1), customer.id));
    } catch {
      setBoard(null); // the card simply stays empty offline
    }
  }, [businessId, customer.id]);

  useEffect(() => { setBoard(null); load(); }, [load]);

  const orders = (board?.orders ?? []).filter((o) => o.status !== 'declined' && o.status !== 'ended');
  if (!board || (orders.length === 0 && !canEdit)) return null;

  const dayText = (day: string) => {
    const lines = board.lines.filter((l) => l.day === day);
    if (lines.length === 0) return 'nothing';
    return lines.map((l) => {
      const o = board.orders.find((x) => x.id === l.orderId);
      const what = `${o?.productName ?? ''} ${qtyText(l.state === 'skipped' ? l.planned : l.quantity)}`;
      return l.state === 'delivered' ? `${what} ✓` : l.state === 'skipped' ? `${what} skipped` : what;
    }).join(', ');
  };

  return (
    <div className="mt-2 rounded-2xl bg-app-card ring-1 ring-app-border p-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="text-app-text-muted" />
        <h3 className="text-sm font-semibold flex-1">Regular orders</h3>
        {canEdit && (
          <button onClick={() => setEdit('new')} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer">
            <Plus size={14} /> Add
          </button>
        )}
      </div>
      {orders.length === 0 ? (
        <p className="mt-1 text-xs text-app-text-muted">None. Add one if we supply them on fixed days.</p>
      ) : (
        <>
          <ul className="mt-1.5 divide-y divide-app-border/50">
            {orders.map((o) => (
              <li key={o.id}>
                <button
                  disabled={!canEdit}
                  onClick={() => (needsDecision(o) && canApprove ? setDecide(o) : setEdit(o))}
                  className="w-full flex items-center gap-2 py-1.5 text-left disabled:cursor-default cursor-pointer"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{o.productName}</span>
                    <span className="block text-xs text-app-text-muted truncate">{weekText(o.dayQty, o.unit)}</span>
                    {needsDecision(o) && (
                      <span className="block text-xs text-amber-700 dark:text-amber-400 truncate">
                        {o.status === 'requested' ? 'Asked for, waiting for approval' : `Asks to change: ${weekText(o.pendingDayQty!, o.unit)}`}
                      </span>
                    )}
                  </span>
                  {o.status !== 'active' && o.status !== 'requested' && <span className="text-[11px] text-app-text-muted">{STATUS_LABEL[o.status]}</span>}
                  {canEdit && <ChevronRight size={14} className="text-app-text-muted shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs"><span className="text-app-text-muted">Today:</span> {dayText(board.today)}</p>
          <p className="text-xs"><span className="text-app-text-muted">Tomorrow:</span> {dayText(addDays(board.today, 1))}</p>
          <button onClick={() => useUiStore.getState().setActiveTab('regular-orders')} className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer">
            Open Regular Orders
          </button>
        </>
      )}
      {edit && businessId && (
        <RegularOrderSheet businessId={businessId} customerId={customer.id} customerName={customer.name}
          defaultAddress={deliveryPlace(customer)} order={edit === 'new' ? null : edit} canApprove={canApprove}
          onClose={() => setEdit(null)} onSaved={load} />
      )}
      {decide && businessId && <DecisionSheet businessId={businessId} order={decide} onClose={() => setDecide(null)} onDone={load} />}
    </div>
  );
}
