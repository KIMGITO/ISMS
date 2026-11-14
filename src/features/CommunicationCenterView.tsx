// Message customers: pick who gets it, write it (or have the assistant draft it), and send.
// Also exports ShiftRemindersPanel, the signed-in person's own shift reminders.
// Both sit inside the Feedback screen, which owns the page scroll and padding.
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Customer } from '../types';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import {
  Search,
  Send,
  Wand2,
  ShieldAlert,
  BellRing,
  Clock,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  X,
  MessageCircle,
} from 'lucide-react';
import { customerName, getFirstName, searchMatch } from '../utils/stringUtils';
import { ReceiptShareService } from '../services/receipt/ReceiptShareService';
import { SupabaseService } from '../services/supabaseService';
import { hasRolePermission } from '../utils/permissions';
import SearchableDropdown from '../components/SearchableDropdown';
import { Checkbox } from '../components/shared/Checkbox';

type SendMode = 'auto' | 'whatsapp' | 'sms' | 'email' | 'manual';
type Purpose = 'service' | 'promotion';

const PLACEHOLDERS = [
  { token: '{first_name}', label: 'First name' },
  { token: '{business_name}', label: 'Business name' },
];

const TIER_CHIP: Record<string, string> = {
  Gold: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  Silver: 'bg-slate-500/15 text-slate-500 dark:text-slate-300',
  Bronze: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
};

/** One SMS holds 160 plain characters; longer ones go as 153-character parts. */
const smsParts = (length: number) => (length <= 160 ? 1 : Math.ceil(length / 153));

const card = 'bg-app-card border border-app-border rounded-2xl shadow-xs';
const fieldLabel = 'block text-xs font-medium text-app-text-muted mb-1';

export default function CommunicationCenterView() {
  const { customers, currentEmployee, showToast, activeBusinessId, businesses } = useAppStore();
  const currentBusiness = businesses.find((b) => b.id === activeBusinessId);
  const aiName = import.meta.env?.VITE_AI_NAME || 'Kim';

  const canView = currentEmployee ? hasRolePermission(currentEmployee.role, 'communication.view') : false;
  const canSend = currentEmployee ? hasRolePermission(currentEmployee.role, 'communication.send') : false;
  const canUseAi = currentEmployee ? hasRolePermission(currentEmployee.role, 'ai.use') : false;

  const [searchQuery, setSearchQuery] = useState('');
  const [filterTier, setFilterTier] = useState('All');
  const [filterDebt, setFilterDebt] = useState('All');
  const [filterActive, setFilterActive] = useState('All');

  const [sendMode, setSendMode] = useState<SendMode>('auto');
  const [messagePurpose, setMessagePurpose] = useState<Purpose>('service');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [messageTemplate, setMessageTemplate] = useState('Hello {first_name}, from {business_name}. ');
  const [manualQueue, setManualQueue] = useState<Customer[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const isSending = progress !== null;

  const [showAi, setShowAi] = useState(false);
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiChatHistory, setAiChatHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // The customer's own choice decides, whichever way the message would be sent.
  const allowsMessage = (customer: Customer) =>
    messagePurpose === 'promotion' ? !!customer.notifyPromotions : customer.notifyService !== false;

  const filteredCustomers = useMemo(
    () =>
      customers.filter((c) => {
        if (searchQuery && !searchMatch(c.name, searchQuery) && !searchMatch(c.phone, searchQuery)) return false;
        if (filterTier !== 'All' && c.tier !== filterTier) return false;
        const owes = (c.debtBalance || 0) > 0;
        if (filterDebt === 'Has Debt' && !owes) return false;
        if (filterDebt === 'No Debt' && owes) return false;
        if (filterActive === 'Active' && !c.purchasesCount) return false;
        if (filterActive === 'Inactive' && c.purchasesCount > 0) return false;
        return true;
      }),
    [customers, searchQuery, filterTier, filterDebt, filterActive],
  );

  const selectedCustomers = useMemo(() => customers.filter((c) => selectedIds.has(c.id)), [customers, selectedIds]);
  const reachable = selectedCustomers.filter(allowsMessage);
  const visibleSelected = filteredCustomers.filter((c) => selectedIds.has(c.id)).length;
  const allVisibleSelected = filteredCustomers.length > 0 && visibleSelected === filteredCustomers.length;
  const filtersActive = !!searchQuery || filterTier !== 'All' || filterDebt !== 'All' || filterActive !== 'All';

  // Ticking the header box adds (or removes) everyone the filters show, keeping other picks.
  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredCustomers.forEach((c) => (allVisibleSelected ? next.delete(c.id) : next.add(c.id)));
      return next;
    });
  };

  const toggleCustomer = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const generateMessage = (customer: Pick<Customer, 'name'>) =>
    messageTemplate
      .replace(/{first_name}/g, getFirstName(customer.name) || 'Customer')
      .replace(/{business_name}/g, currentBusiness?.name || 'our shop');

  const insertPlaceholder = (token: string) => {
    const el = messageRef.current;
    if (!el) {
      setMessageTemplate((t) => t + token);
      return;
    }
    const start = el.selectionStart ?? messageTemplate.length;
    const end = el.selectionEnd ?? messageTemplate.length;
    setMessageTemplate(messageTemplate.slice(0, start) + token + messageTemplate.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleDraftWithAi = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || isAiDrafting) return;
    setIsAiDrafting(true);
    const history = [...aiChatHistory, { role: 'user' as const, content: prompt }];
    setAiChatHistory(history);
    setAiPrompt('');
    try {
      const data = await SupabaseService.callEdgeFunction('chat', {
        messages: [
          {
            role: 'system',
            content:
              'You are an SMS/WhatsApp drafting assistant. Keep it under 160 characters. Use placeholders {first_name} and {business_name}. Do not include quotes. Your work is drafting messages only, not doing actions. If the user prompt is unclear or lacks details, ask follow-up questions instead of drafting. If you are providing the final draft, you MUST prefix the message exactly with [DRAFT] so the system can parse it.',
          },
          ...history,
        ],
        activeRole: currentEmployee?.role,
        permissions: currentEmployee ? [currentEmployee.role] : [],
        employeeName: currentEmployee?.name,
        businessId: activeBusinessId || currentBusiness?.id,
      });
      if (data?.success) {
        const reply = String(data.reply || '').trim();
        if (reply.startsWith('[DRAFT]')) {
          setMessageTemplate(reply.replace('[DRAFT]', '').trim());
          setAiChatHistory([...history, { role: 'assistant', content: 'Done. The draft is in the message box; change anything you like.' }]);
        } else {
          setAiChatHistory([...history, { role: 'assistant', content: reply }]);
        }
      } else {
        showToast(aiName, data?.error || 'Could not draft the message.', undefined, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(aiName, `${aiName} could not be reached. Try again in a moment.`, undefined, 'error');
    } finally {
      setIsAiDrafting(false);
    }
  };

  const sendThrough = async (channel: 'whatsapp' | 'sms' | 'email', customer: Customer, body: string): Promise<boolean> => {
    if (channel === 'email') {
      if (!customer.email || customer.email === 'no-email@kaykays.com') return false;
      const result = await SupabaseService.callEdgeFunction('send-email', {
        to: customer.email,
        type: 'customer_message',
        variables: { body },
        businessId: activeBusinessId,
        purpose: messagePurpose,
      });
      return result?.success !== false;
    }
    if (!customer.phone) return false;
    const result = await SupabaseService.callEdgeFunction(channel === 'whatsapp' ? 'whatsapp-config' : 'sms-config', {
      action: 'send',
      businessId: activeBusinessId,
      to: customer.phone,
      body,
      purpose: messagePurpose,
    });
    return !!result?.success;
  };

  const handleSend = async () => {
    if (isSending || !canSend) return;
    if (selectedCustomers.length === 0) {
      showToast('Message customers', 'Pick at least one customer.', undefined, 'error');
      return;
    }
    if (!messageTemplate.trim()) {
      showToast('Message customers', 'Write a message first.', undefined, 'error');
      return;
    }
    const recipients = reachable;
    const skipped = selectedCustomers.length - recipients.length;
    if (skipped > 0) {
      showToast(
        'Some customers left out',
        `${skipped} ${skipped === 1 ? 'customer has' : 'customers have'} not agreed to this kind of message.`,
        undefined,
        'info',
      );
    }
    if (recipients.length === 0) return;

    if (sendMode === 'manual') {
      setManualQueue(recipients);
      setSelectedIds(new Set());
      return;
    }

    // Automatic tries WhatsApp then SMS. Whoever can't be reached goes to the by-hand list.
    const channels: ('whatsapp' | 'sms' | 'email')[] = sendMode === 'auto' ? ['whatsapp', 'sms'] : [sendMode];
    const unsent: Customer[] = [];
    let sent = 0;
    setProgress({ done: 0, total: recipients.length });
    try {
      for (const customer of recipients) {
        let delivered = false;
        for (const channel of channels) {
          try {
            delivered = await sendThrough(channel, customer, generateMessage(customer));
          } catch (err) {
            console.error(`Sending by ${channel} failed:`, err);
          }
          if (delivered) break;
        }
        if (delivered) sent++;
        else unsent.push(customer);
        setProgress({ done: sent + unsent.length, total: recipients.length });
      }
    } finally {
      setProgress(null);
    }

    setManualQueue(unsent);
    setSelectedIds(new Set());
    if (unsent.length === 0) {
      showToast('Messages sent', `Sent to ${sent} ${sent === 1 ? 'customer' : 'customers'}.`, undefined, 'success');
    } else {
      showToast(
        'Some need sending by hand',
        `Sent ${sent}. ${unsent.length} could not be reached and are listed to send yourself.`,
        undefined,
        'info',
      );
    }
  };

  const handleManualSend = async (customer: Customer) => {
    await ReceiptShareService.shareTextViaWhatsApp(customer.phone, generateMessage(customer));
    setManualQueue((queue) => queue.filter((c) => c.id !== customer.id));
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

  const previewCustomer = selectedCustomers[0] || { name: 'James Mwangi' };
  const preview = generateMessage(previewCustomer);
  const parts = smsParts(preview.length);
  const count = reachable.length;
  const sendLabel = isSending
    ? `Sending ${progress!.done} of ${progress!.total}…`
    : sendMode === 'manual'
    ? `List ${count} ${count === 1 ? 'customer' : 'customers'} to send by hand`
    : `Send to ${count} ${count === 1 ? 'customer' : 'customers'}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] items-start">
      {/* 1. Who gets it */}
      <section className={`${card} p-3 sm:p-4 flex flex-col min-w-0`}>
        <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <span className="grid place-items-center size-5 rounded-full bg-amber-500 text-slate-950 text-[11px] font-bold">1</span>
          Who gets it
        </h2>

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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <SearchableDropdown
              items={[
                { id: 'All', label: 'Any tier' },
                { id: 'Bronze', label: 'Bronze' },
                { id: 'Silver', label: 'Silver' },
                { id: 'Gold', label: 'Gold' },
              ]}
              selectedValue={filterTier}
              onChange={setFilterTier}
              placeholder="Tier"
            />
            <SearchableDropdown
              items={[
                { id: 'All', label: 'Owing or not' },
                { id: 'Has Debt', label: 'Owes money' },
                { id: 'No Debt', label: 'Owes nothing' },
              ]}
              selectedValue={filterDebt}
              onChange={setFilterDebt}
              placeholder="Debt"
            />
            <SearchableDropdown
              items={[
                { id: 'All', label: 'Bought or not' },
                { id: 'Active', label: 'Has bought before' },
                { id: 'Inactive', label: 'Never bought' },
              ]}
              selectedValue={filterActive}
              onChange={setFilterActive}
              placeholder="Activity"
            />
          </div>
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

        <div className="max-h-[55vh] lg:max-h-[calc(100dvh-22rem)] min-h-48 overflow-y-auto -mx-1 px-1">
          {filteredCustomers.length === 0 ? (
            <p className="p-8 text-center text-sm text-app-text-muted">
              {customers.length === 0 ? 'No customers yet.' : 'No customers match these filters.'}
            </p>
          ) : (
            <ul className="divide-y divide-app-border">
              {filteredCustomers.map((c) => {
                const picked = selectedIds.has(c.id);
                const agreed = allowsMessage(c);
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
                        </span>
                      </span>
                      {!agreed && (
                        <span
                          className="shrink-0 rounded-md bg-app-bg border border-app-border px-1.5 py-0.5 text-[11px] text-app-text-muted"
                          title="This customer has not agreed to this kind of message"
                        >
                          {messagePurpose === 'promotion' ? 'No offers' : 'No messages'}
                        </span>
                      )}
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
      </section>

      {/* 2. The message */}
      <section className={`${card} p-3 sm:p-4 space-y-4 min-w-0 lg:sticky lg:top-3`}>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span className="grid place-items-center size-5 rounded-full bg-amber-500 text-slate-950 text-[11px] font-bold">2</span>
          The message
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
          <div>
            <span className={fieldLabel}>What kind of message</span>
            <SearchableDropdown
              items={[
                { id: 'service', label: 'Order update or reminder' },
                { id: 'promotion', label: 'Offer or promotion' },
              ]}
              selectedValue={messagePurpose}
              onChange={(value) => setMessagePurpose(value as Purpose)}
              placeholder="Message type"
            />
          </div>
          <div>
            <span className={fieldLabel}>Send by</span>
            <SearchableDropdown
              items={[
                { id: 'auto', label: 'Automatic', sublabel: 'WhatsApp, then SMS if that fails' },
                { id: 'whatsapp', label: 'WhatsApp' },
                { id: 'sms', label: 'SMS' },
                { id: 'email', label: 'Email' },
                { id: 'manual', label: 'By hand', sublabel: 'Open each WhatsApp chat yourself' },
              ]}
              selectedValue={sendMode}
              onChange={(value) => setSendMode(value as SendMode)}
              placeholder="How to send"
            />
          </div>
        </div>

        {/* Drafting help */}
        {canUseAi && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5">
            <button
              type="button"
              onClick={() => setShowAi((v) => !v)}
              aria-expanded={showAi}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-violet-600 dark:text-violet-400"
            >
              <Wand2 size={14} />
              Ask {aiName} to write it
              <ChevronDown size={14} className={`ml-auto transition ${showAi ? 'rotate-180' : ''}`} />
            </button>
            {showAi && (
              <div className="px-3 pb-3 space-y-2">
                {aiChatHistory.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1.5">
                    {aiChatHistory.map((msg, idx) => (
                      <p
                        key={idx}
                        className={`text-xs leading-relaxed rounded-lg px-2.5 py-1.5 ${
                          msg.role === 'user' ? 'bg-app-card ml-6 text-app-text' : 'bg-violet-500/10 mr-6 text-app-text'
                        }`}
                      >
                        {msg.content}
                      </p>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    rows={2}
                    placeholder="e.g. Tell customers we have fresh milk at 10% off this weekend"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleDraftWithAi();
                      }
                    }}
                    className="flex-1 min-w-0 resize-none bg-app-card border border-app-border rounded-xl px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  <button
                    type="button"
                    onClick={handleDraftWithAi}
                    disabled={isAiDrafting || !aiPrompt.trim()}
                    aria-label="Ask"
                    className="h-9 shrink-0 inline-flex items-center rounded-xl bg-violet-600 px-3 text-white hover:bg-violet-500 disabled:opacity-40 transition"
                  >
                    {isAiDrafting ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className={fieldLabel + ' mb-0'}>Message</span>
            <div className="flex gap-1">
              {PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => insertPlaceholder(p.token)}
                  className="rounded-md border border-app-border bg-app-bg px-1.5 py-0.5 text-[11px] text-app-text-muted hover:text-app-text hover:border-amber-500/40"
                  title={`Insert ${p.token}`}
                >
                  + {p.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            ref={messageRef}
            rows={5}
            value={messageTemplate}
            onChange={(e) => setMessageTemplate(e.target.value)}
            placeholder="Type your message"
            className="w-full resize-y bg-app-bg border border-app-border rounded-xl p-3 text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <p className="mt-1 text-[11px] text-app-text-muted tabular-nums">
            {preview.length} characters
            {(sendMode === 'auto' || sendMode === 'sms') && ` · ${parts} SMS ${parts === 1 ? 'part' : 'parts'} each`}
          </p>
        </div>

        <div className="rounded-xl bg-app-bg border border-app-border p-3">
          <p className="text-[11px] font-medium text-app-text-muted mb-1">
            How {getFirstName(previewCustomer.name) || 'a customer'} will see it
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {preview.trim() || <span className="text-app-text-muted">Nothing written yet.</span>}
          </p>
        </div>

        {selectedIds.size > 0 && count < selectedIds.size && (
          <p className="text-xs text-app-text-muted">
            {selectedIds.size - count} of {selectedIds.size} picked{' '}
            {messagePurpose === 'promotion' ? "haven't agreed to offers" : 'turned off messages'} and will be left out.
          </p>
        )}

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend || isSending || count === 0 || !messageTemplate.trim()}
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {isSending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
          {sendLabel}
        </button>
        {!canSend && <p className="text-xs text-app-text-muted text-center">Your role can see this page but not send messages.</p>}

        {manualQueue.length > 0 && (
          <div className="space-y-2 border-t border-app-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">Send these yourself ({manualQueue.length} left)</p>
              <button
                type="button"
                onClick={() => setManualQueue([])}
                className="inline-flex items-center gap-1 text-xs text-app-text-muted hover:text-app-text"
              >
                <X size={12} /> Clear
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {manualQueue.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => handleManualSend(customer)}
                  disabled={!customer.phone}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-app-border bg-app-bg px-3 py-2 text-left text-sm disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">{customerName(customer.name)}</span>
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <MessageCircle size={13} /> {customer.phone ? 'Open WhatsApp' : 'No phone'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
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
