// Message customers: pick who gets it (by group or one by one), write it once with
// variables, or have the assistant write it, and send. The two steps are tabs, so
// neither needs the other scrolled past. The composer is shared with the
// Customers screen. Also exports ShiftRemindersPanel, the signed-in person's own shift reminders.
// Both sit inside the Feedback screen, which owns the page scroll and padding.
import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { Search, ShieldAlert, BellRing, Clock, ChevronRight, Users, PenLine } from 'lucide-react';
import { Segmented } from '../components/shared/Choice';
import { customerName, searchMatch } from '../utils/stringUtils';
import { hasRolePermission } from '../utils/permissions';
import { Checkbox } from '../components/shared/Checkbox';
import { GroupPicker } from '../components/messaging/GroupPicker';
import { BulkMessageComposer } from '../components/messaging/BulkMessageComposer';
import { groupMatcher, describeGroups } from '../services/messaging/customerGroups';
import { useMessageContext } from '../hooks/useMessageContext';
import { moneyNumber } from '../utils/money';

const TIER_CHIP: Record<string, string> = {
  Gold: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  Silver: 'bg-slate-500/15 text-slate-500 dark:text-slate-300',
  Bronze: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
};

const card = 'bg-app-card border border-app-border rounded-2xl shadow-xs';

export default function CommunicationCenterView() {
  const { customers, currentEmployee, activeBusinessId } = useAppStore();
  const canView = currentEmployee ? hasRolePermission(currentEmployee.role, 'communication.view') : false;
  const { ctx, setCustom } = useMessageContext(activeBusinessId);

  const [searchQuery, setSearchQuery] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<'who' | 'message'>('who');

  const inGroups = useMemo(() => groupMatcher(groups, ctx), [groups, ctx]);
  const filteredCustomers = useMemo(
    () => customers.filter((c) => inGroups(c) && (!searchQuery || searchMatch(c.name, searchQuery) || searchMatch(c.phone, searchQuery))),
    [customers, inGroups, searchQuery],
  );
  const selectedCustomers = useMemo(() => customers.filter((c) => selectedIds.has(c.id)), [customers, selectedIds]);
  const visibleSelected = filteredCustomers.filter((c) => selectedIds.has(c.id)).length;
  const allVisibleSelected = filteredCustomers.length > 0 && visibleSelected === filteredCustomers.length;
  const filtersActive = !!searchQuery || groups.length > 0;

  // Ticking the header box adds (or removes) everyone the filters show, keeping other picks.
  const toggleAllVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredCustomers.forEach((c) => (allVisibleSelected ? next.delete(c.id) : next.add(c.id)));
      return next;
    });
  const toggleCustomer = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The assistant chose groups: show them and pick everyone in them.
  const pickGroups = (ids: string[]) => {
    setGroups(ids);
    const match = groupMatcher(ids, ctx);
    setSelectedIds(new Set(customers.filter(match).map((c) => c.id)));
  };

  if (!canView) {
    return (
      <div className={`${card} p-8 flex flex-col items-center gap-2 text-center`}>
        <ShieldAlert size={28} className="text-red-500" />
        <p className="text-sm font-semibold">No access</p>
        <p className="text-xs text-app-text-muted max-w-xs">Your role can't message customers. Ask an admin to allow it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Segmented<'who' | 'message'>
        ariaLabel="Step"
        value={step}
        onChange={setStep}
        options={[
          { id: 'who', label: 'Who gets it', icon: <Users />, count: selectedIds.size },
          { id: 'message', label: 'The message', icon: <PenLine /> },
        ]}
      />

      {/* 1. Who gets it */}
      <section hidden={step !== 'who'} className={`${card} p-3 sm:p-4 flex flex-col min-w-0`}>

        <div className="space-y-2 mb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
            <input
              type="search"
              placeholder="Search by name or phone"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 bg-app-bg border border-app-border rounded-xl pl-9 pr-3 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <GroupPicker customers={customers} value={groups} onChange={setGroups} ctx={ctx} />
        </div>

        <div className="flex items-center gap-2 border-b border-app-border pb-2 mb-1">
          <Checkbox
            checked={allVisibleSelected}
            indeterminate={visibleSelected > 0 && !allVisibleSelected}
            onChange={toggleAllVisible}
            disabled={filteredCustomers.length === 0}
            label={
              <span className="text-xs font-medium">
                {filtersActive ? `All ${filteredCustomers.length} shown` : `Everyone (${filteredCustomers.length})`}
              </span>
            }
          />
          <span className="ml-auto text-xs text-app-text-muted tabular-nums">{selectedIds.size} picked</span>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="max-h-[calc(100dvh-26rem)] min-h-48 overflow-y-auto -mx-1 px-1">
          {filteredCustomers.length === 0 ? (
            <p className="p-8 text-center text-sm text-app-text-muted">
              {customers.length === 0 ? 'No customers yet.' : 'No customers match these groups.'}
            </p>
          ) : (
            <ul className="divide-y divide-app-border">
              {filteredCustomers.map((c) => {
                const picked = selectedIds.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={picked}
                      onClick={() => toggleCustomer(c.id)}
                      className={`w-full flex items-center gap-3 px-2 py-2.5 text-left rounded-lg transition ${
                        picked ? 'bg-amber-500/10' : 'hover:bg-app-bg'
                      }`}
                    >
                      <span
                        className={`size-5 shrink-0 rounded-md border-2 grid place-items-center text-[11px] font-bold ${
                          picked ? 'bg-amber-500 border-amber-500 text-slate-950' : 'border-app-border bg-app-bg text-transparent'
                        }`}
                        aria-hidden
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{customerName(c.name)}</span>
                        <span className="block text-xs text-app-text-muted tabular-nums truncate">
                          {c.phone || 'No phone number'}
                          {(c.debtBalance || 0) > 0 ? ` · owes ${ctx.currency} ${moneyNumber(c.debtBalance || 0)}` : ''}
                        </span>
                      </span>
                      {c.tier && (
                        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TIER_CHIP[c.tier] || TIER_CHIP.Bronze}`}>
                          {c.tier}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => setStep('message')}
            className="mt-3 h-10 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 transition"
          >
            Write the message to {selectedIds.size} <ChevronRight size={15} />
          </button>
        )}
      </section>

      {/* 2. The message */}
      <section hidden={step !== 'message'} className={`${card} p-3 sm:p-4 space-y-4 min-w-0`}>
        <BulkMessageComposer
          recipients={selectedCustomers}
          ctx={ctx}
          onCustomChange={setCustom}
          audience={describeGroups(groups)}
          onPickGroups={pickGroups}
          onSent={() => setSelectedIds(new Set())}
        />
      </section>
    </div>
  );
}

/** The signed-in person's shift reminders, newest first. */
export function ShiftRemindersPanel() {
  const { setActiveTab } = useAppStore();
  const scheduleReminders = useNotificationStore((s) => s.scheduleReminders);
  const markReminderAsRead = useNotificationStore((s) => s.markReminderAsRead);

  // Fresh data and live updates whenever the panel opens.
  useEffect(() => {
    useNotificationStore.getState().initScheduleReminders();
  }, []);

  const formatShift = (date?: string, time?: string) => {
    if (!date && !time) return '';
    const d = date ? new Date(`${date}T00:00:00`) : null;
    const day =
      d && !isNaN(d.getTime())
        ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        : date || '';
    return [day, time ? `at ${time.slice(0, 5)}` : ''].filter(Boolean).join(' ');
  };

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-app-border">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <BellRing size={15} className="text-amber-500" /> My shift reminders
        </h2>
        <span className="text-xs text-app-text-muted tabular-nums">{scheduleReminders.length}</span>
      </div>
      {scheduleReminders.length === 0 ? (
        <div className="p-10 text-center flex flex-col items-center gap-2">
          <BellRing size={22} className="text-app-text-muted/50" />
          <p className="text-sm font-medium">No reminders yet</p>
          <p className="text-xs text-app-text-muted max-w-xs">When you're given a shift, a reminder shows up here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-app-border">
          {scheduleReminders.map((rem) => {
            let payload: any = {};
            try {
              payload = typeof rem.payload === 'string' ? JSON.parse(rem.payload) : rem.payload || {};
            } catch {
              payload = {};
            }
            const isUnread = !rem.read_at;
            const when = formatShift(payload?.shift_date, payload?.start_time);
            return (
              <li key={rem.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (isUnread) markReminderAsRead(rem.id);
                    setActiveTab('dashboard');
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition hover:bg-app-bg ${
                    isUnread ? 'bg-amber-500/5' : ''
                  }`}
                >
                  <span
                    className={`size-9 shrink-0 rounded-xl grid place-items-center ${
                      isUnread ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-app-bg text-app-text-muted'
                    }`}
                  >
                    <Clock size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`text-sm truncate ${isUnread ? 'font-semibold' : 'text-app-text-muted'}`}>{rem.title}</span>
                      {isUnread && <span className="size-2 shrink-0 rounded-full bg-red-500" aria-label="Unread" />}
                    </span>
                    {rem.message && <span className="block text-xs text-app-text-muted mt-0.5">{rem.message}</span>}
                    {when && <span className="block text-xs text-amber-600 dark:text-amber-400 mt-0.5">{when}</span>}
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-app-text-muted" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
