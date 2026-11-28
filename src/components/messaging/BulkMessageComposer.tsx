// One message to many customers: write it once (or have the assistant write it) with
// variables such as {first_name} and {debt}, see how each person gets it, and send.
// Used on Customers (Message) and on the Message customers screen.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle, Plus, RefreshCw, Send, Trash2, X, AlertTriangle, PenLine } from 'lucide-react';
import type { Customer } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { SupabaseService } from '../../services/supabaseService';
import { ReceiptShareService } from '../../services/receipt/ReceiptShareService';
import SearchableDropdown from '../SearchableDropdown';
import { hasRolePermission } from '../../utils/permissions';
import { customerName, getFirstName } from '../../utils/stringUtils';
import { toUserMessage } from '../../utils/userError';
import { appDialog } from '../AppDialog';
import {
  allVariables,
  deleteCustomVariable,
  emptyFor,
  fillMessage,
  keyFromLabel,
  saveCustomVariable,
  unknownVariables,
  validCustomKey,
  type CustomVariable,
  type MessageContext,
  type VariableGroup,
} from '../../services/messaging/messageVariables';
import { visibleGroups, groupById } from '../../services/messaging/customerGroups';

type SendMode = 'email' | 'manual';
type Purpose = 'service' | 'promotion';
type ChatLine = { role: 'user' | 'assistant'; content: string };

const fieldLabel = 'block text-xs font-medium text-app-text-muted mb-1';
const GROUP_ORDER: VariableGroup[] = ['Customer', 'Money', 'Points', 'Buying', 'Shop'];

/** Ready-made starting points; the assistant can write anything else. */
const STARTERS: { label: string; text: string; purpose: Purpose }[] = [
  {
    label: 'Debt reminder',
    purpose: 'service',
    text: 'Hello {first_name}, this is a friendly reminder from {store_name} that your balance is {debt}. You can pay by M-Pesa using account {account_no}. Thank you!',
  },
  {
    label: 'Points reminder',
    purpose: 'promotion',
    text: 'Hi {first_name}, you have {points} points at {store_name}, worth {points_value} off your next purchase. See you soon!',
  },
  {
    label: 'We miss you',
    purpose: 'promotion',
    text: 'Hi {first_name}, we have not seen you at {store_name} since {last_purchase}. Pass by this week, we would love to serve you again!',
  },
];

interface Props {
  recipients: Customer[];
  ctx: MessageContext;
  onCustomChange: (vars: CustomVariable[]) => void;
  /** Who is picked, in words, for the assistant ("Owes money · Gold"). */
  audience?: string;
  /** The assistant suggested groups and nobody was picked yet. */
  onPickGroups?: (ids: string[]) => void;
  /** After sending: clear the picks. */
  onSent?: () => void;
  /** Open the assistant box straight away. */
  startWithAi?: boolean;
}

export function BulkMessageComposer({ recipients, ctx, onCustomChange, audience, onPickGroups, onSent, startWithAi }: Props) {
  const { currentEmployee, showToast, activeBusinessId } = useAppStore();
  const aiName = import.meta.env?.VITE_AI_NAME || 'Kim';
  const role = currentEmployee?.role;
  const canSend = role ? hasRolePermission(role, 'communication.send') : false;
  const canUseAi = role ? hasRolePermission(role, 'ai.use') : false;

  const [sendMode, setSendMode] = useState<SendMode>('manual');
  const [purpose, setPurpose] = useState<Purpose>('service');
  const [template, setTemplate] = useState('Hello {first_name}, ');
  const [manualQueue, setManualQueue] = useState<Customer[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const isSending = progress !== null;
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [previewIdx, setPreviewIdx] = useState(0);

  // Assistant
  const [showAi, setShowAi] = useState(!!startWithAi && canUseAi);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiChat, setAiChat] = useState<ChatLine[]>([]);
  useEffect(() => {
    if (startWithAi && canUseAi) setShowAi(true);
  }, [startWithAi, canUseAi]);

  // New variable
  const [newVar, setNewVar] = useState<{ label: string; value: string } | null>(null);
  const [showAllVars, setShowAllVars] = useState(false);
  const [savingVar, setSavingVar] = useState(false);

  const variables = useMemo(() => allVariables(ctx), [ctx]);
  const pointsOn = !!ctx.points && ctx.points.enabled !== false;
  const shownVariables = variables.filter((v) => pointsOn || v.group !== 'Points');

  // The customer's own choice decides, whichever way the message would be sent.
  const allows = (c: Customer) => (purpose === 'promotion' ? !!c.notifyPromotions : c.notifyService !== false);
  const reachable = recipients.filter(allows);
  const left = recipients.length - reachable.length;

  const sample: Customer = {
    id: 'sample', name: 'James Mwangi', phone: '0712 345678', email: '', loyaltyPoints: 1250, joinDate: new Date().toISOString(),
    tier: 'Bronze', purchasesCount: 4, debtBalance: 1200, walletBalance: 0, accountNumber: 'C1024',
  };
  const previewList = reachable.length ? reachable : recipients;
  const previewCustomer = previewList[Math.min(previewIdx, Math.max(0, previewList.length - 1))] ?? sample;
  useEffect(() => setPreviewIdx(0), [recipients.length]);
  const preview = fillMessage(template, previewCustomer, ctx);
  const unknown = unknownVariables(template, ctx);
  const blanks = emptyFor(template, reachable, ctx);

  const insert = (token: string) => {
    const el = messageRef.current;
    if (!el) return setTemplate((t) => t + token);
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const askAi = async (text?: string) => {
    const prompt = (text ?? aiPrompt).trim();
    if (!prompt || aiBusy || !activeBusinessId) return;
    const history: ChatLine[] = [...aiChat, { role: 'user', content: prompt }];
    setAiChat(history);
    setAiPrompt('');
    setAiBusy(true);
    try {
      const groups = visibleGroups(ctx).map((g) => ({ id: g.id, label: g.label, section: g.section }));
      const data = await SupabaseService.callEdgeFunction('chat', {
        mode: 'draft_message',
        businessId: activeBusinessId,
        messages: history,
        variables: shownVariables.map((v) => ({ token: `{${v.key}}`, describe: v.describe })),
        groups: onPickGroups && recipients.length === 0 ? groups : [],
        audience: recipients.length ? `${recipients.length} customers${audience ? ` (${audience})` : ''}` : '',
        channel: sendMode,
        purpose,
      });
      if (!data?.success) {
        setAiChat([...history, { role: 'assistant', content: data?.reply || data?.error || `${aiName} could not write it this time.` }]);
        return;
      }
      const reply = String(data.reply || '').trim();
      const groupLine = reply.match(/\[GROUPS:\s*([^\]]*)\]/i);
      const draftAt = reply.search(/\[DRAFT\]/i);
      const notes: string[] = [];
      if (groupLine && onPickGroups && recipients.length === 0) {
        const ids = groupLine[1].split(',').map((s) => s.trim()).filter((id) => groupById(id));
        if (ids.length) {
          onPickGroups(ids);
          notes.push(`Picked: ${ids.map((id) => groupById(id)!.label).join(', ')}.`);
        }
      }
      if (draftAt >= 0) {
        const draft = reply.slice(draftAt + 7).replace(/^["'\s]+|["'\s]+$/g, '');
        if (draft) {
          setTemplate(draft);
          notes.push('The message is in the box below. Change anything you like.');
        }
      }
      const said = reply.replace(/\[GROUPS:[^\]]*\]/i, '').split(/\[DRAFT\]/i)[0].trim();
      setAiChat([...history, { role: 'assistant', content: [said, ...notes].filter(Boolean).join(' ') || 'Done.' }]);
    } catch (err) {
      setAiChat([...history, { role: 'assistant', content: toUserMessage(err, `${aiName} could not be reached. Try again in a moment.`) }]);
    } finally {
      setAiBusy(false);
    }
  };

  const addVariable = async () => {
    if (!newVar || !activeBusinessId) return;
    const key = keyFromLabel(newVar.label);
    const problem = !newVar.label.trim() ? 'Give it a name.' : validCustomKey(key);
    if (problem) {
      showToast('New variable', problem, undefined, 'error');
      return;
    }
    setSavingVar(true);
    try {
      const saved = await saveCustomVariable(activeBusinessId, { key, label: newVar.label.trim(), value: newVar.value }, currentEmployee?.name);
      onCustomChange([...(ctx.custom ?? []).filter((v) => v.key !== saved.key), saved]);
      setNewVar(null);
      insert(`{${saved.key}}`);
    } catch (err) {
      showToast('New variable', toUserMessage(err, 'Could not save the variable.'), undefined, 'error');
    } finally {
      setSavingVar(false);
    }
  };

  const removeVariable = async (v: CustomVariable) => {
    if (!v.id) return;
    const ok = await appDialog.confirm({
      title: `Delete {${v.key}}?`,
      message: 'Messages that still use it will show it as written.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteCustomVariable(v.id);
      onCustomChange((ctx.custom ?? []).filter((x) => x.id !== v.id));
    } catch (err) {
      showToast('Variables', toUserMessage(err, 'Could not delete the variable.'), undefined, 'error');
    }
  };

  // Email is the only automatic channel. WhatsApp messages are sent by hand (each chat opens).
  const sendThrough = async (customer: Customer, body: string): Promise<boolean> => {
    if (!customer.email || customer.email === 'no-email@kaykays.com') return false;
    const result = await SupabaseService.callEdgeFunction('send-email', {
      to: customer.email,
      type: 'customer_message',
      variables: { body },
      businessId: activeBusinessId,
      purpose,
    });
    return result?.success !== false;
  };

  const send = async () => {
    if (isSending || !canSend || reachable.length === 0 || !template.trim()) return;
    if (unknown.length) {
      const ok = await appDialog.confirm({
        title: 'Some variables are not known',
        message: `${unknown.map((u) => `{${u}}`).join(', ')} will be sent as written. Send anyway?`,
        confirmLabel: 'Send anyway',
      });
      if (!ok) return;
    }
    if (sendMode === 'manual') {
      setManualQueue(reachable);
      onSent?.();
      return;
    }
    if (reachable.length > 1) {
      const ok = await appDialog.confirm({
        title: `Send to ${reachable.length} customers?`,
        message: 'Each gets their own copy by email.',
        confirmLabel: 'Send',
      });
      if (!ok) return;
    }
    // Whoever can't be reached by email goes to the by-hand list.
    const recipientsNow = reachable;
    const unsent: Customer[] = [];
    let sent = 0;
    setProgress({ done: 0, total: recipientsNow.length });
    try {
      for (const customer of recipientsNow) {
        let delivered = false;
        try {
          delivered = await sendThrough(customer, fillMessage(template, customer, ctx));
        } catch (err) {
          console.error('Sending by email failed:', err);
        }
        if (delivered) sent++;
        else unsent.push(customer);
        setProgress({ done: sent + unsent.length, total: recipientsNow.length });
      }
    } finally {
      setProgress(null);
    }
    setManualQueue(unsent);
    onSent?.();
    if (unsent.length === 0) {
      showToast('Messages sent', `Sent to ${sent} ${sent === 1 ? 'customer' : 'customers'}.`, undefined, 'success');
    } else {
      showToast('Some need sending by hand', `Sent ${sent}. ${unsent.length} could not be reached and are listed to send yourself.`, undefined, 'info');
    }
  };

  const sendByHand = async (customer: Customer) => {
    await ReceiptShareService.shareTextViaWhatsApp(customer.phone, fillMessage(template, customer, ctx));
    setManualQueue((q) => q.filter((c) => c.id !== customer.id));
  };

  const count = reachable.length;
  const sendLabel = isSending
    ? `Sending ${progress!.done} of ${progress!.total}…`
    : sendMode === 'manual'
    ? `List ${count} to send by hand`
    : `Send to ${count} ${count === 1 ? 'customer' : 'customers'}`;

  const chip = 'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-app-border bg-app-bg text-app-text hover:ring-amber-500/50 cursor-pointer';
  const quickKeys = ['first_name', 'debt', ...(pointsOn ? ['points'] : []), 'store_name'];
  const quickVars = quickKeys.map((k) => shownVariables.find((v) => v.key === k)).filter(Boolean) as typeof shownVariables;

  return (
    <div className="space-y-4">
      {/* 1. The message: start from a ready one or Kim, then edit */}
      <section className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {canUseAi && (
            <button
              type="button"
              onClick={() => setShowAi((v) => !v)}
              aria-expanded={showAi}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                showAi ? 'bg-violet-600 text-white' : 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/25'
              }`}
            >
              <PenLine size={12} /> Ask {aiName}
            </button>
          )}
          {STARTERS.filter((st) => pointsOn || !st.text.includes('{points')).map((st) => (
            <button
              key={st.label}
              type="button"
              onClick={() => {
                setTemplate(st.text);
                setPurpose(st.purpose);
              }}
              className={chip}
            >
              {st.label}
            </button>
          ))}
        </div>

        {canUseAi && showAi && (
          <div className="rounded-xl ring-1 ring-violet-500/25 bg-violet-500/5 p-2.5 space-y-2">
            {aiChat.length === 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Remind those who owe to pay',
                  pointsOn ? 'Tell them to use their points' : 'Thank Gold customers',
                  'Invite quiet customers back',
                ].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => askAi(t)}
                    disabled={aiBusy}
                    className="rounded-full bg-app-card ring-1 ring-app-border px-2.5 py-1 text-xs text-app-text hover:ring-violet-500/50 cursor-pointer disabled:opacity-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1.5">
                {aiChat.map((m, i) => (
                  <p
                    key={i}
                    className={`text-xs leading-relaxed rounded-lg px-2.5 py-1.5 whitespace-pre-wrap ${
                      m.role === 'user' ? 'bg-app-card ml-6' : 'bg-violet-500/10 mr-6'
                    }`}
                  >
                    {m.content}
                  </p>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                placeholder={onPickGroups && recipients.length === 0 ? 'What is it for, and who gets it?' : 'What is the message for?'}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    askAi();
                  }
                }}
                className="flex-1 min-w-0 resize-none bg-app-card ring-1 ring-app-border rounded-xl px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-violet-500"
              />
              <button
                type="button"
                onClick={() => askAi()}
                disabled={aiBusy || !aiPrompt.trim()}
                aria-label={`Ask ${aiName}`}
                className="h-9 shrink-0 inline-flex items-center rounded-xl bg-violet-600 px-3 text-white hover:bg-violet-500 disabled:opacity-40 cursor-pointer"
              >
                {aiBusy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </div>
        )}

        <textarea
          ref={messageRef}
          rows={5}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          aria-label="Message"
          placeholder="Type your message"
          className="w-full resize-y bg-app-bg ring-1 ring-app-border rounded-xl p-3 text-sm text-app-text focus:outline-none focus:ring-amber-500"
        />

        {/* Details that change per customer */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-app-text-muted">Add:</span>
          {quickVars.map((v) => (
            <button key={v.key} type="button" onClick={() => insert(`{${v.key}}`)} title={v.describe} className={chip}>
              + {v.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowAllVars((v) => !v)}
            aria-expanded={showAllVars}
            className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer inline-flex items-center gap-0.5"
          >
            {showAllVars ? 'Less' : 'More'} <ChevronRight size={12} className={`transition ${showAllVars ? '-rotate-90' : 'rotate-90'}`} />
          </button>
          <span className="ml-auto text-[11px] text-app-text-muted tabular-nums">
            {preview.length} chars
          </span>
        </div>

        {showAllVars && (
          <div className="rounded-xl ring-1 ring-app-border p-2.5 space-y-2">
            {GROUP_ORDER.map((group) => {
              const list = shownVariables.filter((v) => v.group === group);
              if (!list.length) return null;
              return (
                <div key={group}>
                  <p className="text-[11px] text-app-text-muted mb-1">{group === 'Shop' ? 'Shop & yours' : group}</p>
                  <div className="flex flex-wrap gap-1">
                    {list.map((v) => {
                      const custom = (ctx.custom ?? []).find((c) => c.key === v.key);
                      return (
                        <span key={v.key} className="inline-flex items-center rounded-full ring-1 ring-app-border bg-app-bg">
                          <button
                            type="button"
                            onClick={() => insert(`{${v.key}}`)}
                            title={`{${v.key}}: ${v.describe}`}
                            className="px-2.5 py-1 text-xs text-app-text hover:text-amber-700 dark:hover:text-amber-400 cursor-pointer"
                          >
                            + {v.label}
                          </button>
                          {custom && canSend && (
                            <button type="button" onClick={() => removeVariable(custom)} aria-label={`Delete ${v.label}`} className="pr-2 text-app-text-muted hover:text-red-500 cursor-pointer">
                              <X size={11} />
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {canSend &&
              (newVar ? (
                <div className="rounded-xl bg-app-bg p-2.5 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-xs text-app-text-muted">
                      Name
                      <input
                        autoFocus
                        value={newVar.label}
                        maxLength={60}
                        onChange={(e) => setNewVar({ ...newVar, label: e.target.value })}
                        placeholder="e.g. Offer ends"
                        className="mt-1 w-full bg-app-card ring-1 ring-app-border rounded-lg px-2.5 py-1.5 text-sm text-app-text focus:outline-none focus:ring-amber-500"
                      />
                    </label>
                    <label className="text-xs text-app-text-muted">
                      Same for everyone
                      <input
                        value={newVar.value}
                        maxLength={300}
                        onChange={(e) => setNewVar({ ...newVar, value: e.target.value })}
                        placeholder="e.g. Sunday 23 Nov"
                        className="mt-1 w-full bg-app-card ring-1 ring-app-border rounded-lg px-2.5 py-1.5 text-sm text-app-text focus:outline-none focus:ring-amber-500"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-app-text-muted truncate">{newVar.label.trim() ? `{${keyFromLabel(newVar.label)}}` : ''}</span>
                    <button type="button" onClick={() => setNewVar(null)} className="ml-auto px-2.5 py-1.5 rounded-lg text-xs text-app-text-muted hover:text-app-text cursor-pointer">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={addVariable}
                      disabled={savingVar}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {savingVar ? 'Saving…' : 'Save and add'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setNewVar({ label: '', value: '' })}
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                >
                  <Plus size={13} /> Your own detail
                </button>
              ))}
          </div>
        )}
      </section>

      {/* 2. How one customer gets it */}
      <section className="rounded-xl bg-app-bg ring-1 ring-app-border p-3">
        <div className="flex items-center gap-1 mb-1">
          <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-app-text-muted">
            {previewList.length ? `${customerName(previewCustomer.name)} gets` : `Example: ${getFirstName(sample.name)} gets`}
          </p>
          {previewList.length > 1 && (
            <>
              <button type="button" onClick={() => setPreviewIdx((i) => (i - 1 + previewList.length) % previewList.length)} aria-label="Previous customer" className="p-1 rounded-md hover:bg-app-card cursor-pointer">
                <ChevronLeft size={14} />
              </button>
              <span className="text-[11px] tabular-nums text-app-text-muted">
                {Math.min(previewIdx, previewList.length - 1) + 1}/{previewList.length}
              </span>
              <button type="button" onClick={() => setPreviewIdx((i) => (i + 1) % previewList.length)} aria-label="Next customer" className="p-1 rounded-md hover:bg-app-card cursor-pointer">
                <ChevronRight size={14} />
              </button>
            </>
          )}
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {preview.trim() || <span className="text-app-text-muted">Nothing written yet.</span>}
        </p>
      </section>

      {/* 3. Kind and channel, right above Send */}
      <section className="grid grid-cols-2 gap-2">
        <div>
          <span className={fieldLabel}>Kind</span>
          <div className="h-10 grid grid-cols-2 gap-1 rounded-xl bg-app-bg ring-1 ring-app-border p-1" role="radiogroup" aria-label="Kind of message">
            {([
              ['service', 'Reminder'],
              ['promotion', 'Offer'],
            ] as [Purpose, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={purpose === id}
                onClick={() => setPurpose(id)}
                className={`rounded-lg text-xs font-medium cursor-pointer ${purpose === id ? 'bg-app-card shadow-sm text-app-text ring-1 ring-app-border' : 'text-app-text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={fieldLabel}>Send by</span>
          <SearchableDropdown
            items={[
              { id: 'manual', label: 'WhatsApp by hand', sublabel: 'You open each chat' },
              { id: 'email', label: 'Email' },
            ]}
            selectedValue={sendMode}
            onChange={(v) => setSendMode(v as SendMode)}
            placeholder="How to send"
          />
        </div>
      </section>

      {(unknown.length > 0 || blanks.length > 0) && (
        <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-app-text space-y-0.5">
          {unknown.length > 0 && (
            <p className="flex gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
              <span>
                {unknown.map((u) => `{${u}}`).join(', ')} is not a known detail; it goes out as written.
              </span>
            </p>
          )}
          {blanks.map((b) => (
            <p key={b.label} className="flex gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
              <span>
                {b.label} is empty for {b.count} of {reachable.length}.
              </span>
            </p>
          ))}
        </div>
      )}

      {left > 0 && (
        <p className="text-xs text-app-text-muted">
          {left} of {recipients.length} left out: {purpose === 'promotion' ? "they haven't agreed to offers" : 'they turned messages off'}.
        </p>
      )}

      <button
        type="button"
        onClick={send}
        disabled={!canSend || isSending || count === 0 || !template.trim()}
        className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        {isSending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
        {recipients.length === 0 ? 'Pick customers first' : sendLabel}
      </button>
      {!canSend && <p className="text-xs text-app-text-muted text-center">Your role can't send messages to customers.</p>}

      {manualQueue.length > 0 && (
        <div className="space-y-2 border-t border-app-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Send yourself ({manualQueue.length} left)</p>
            <button type="button" onClick={() => setManualQueue([])} className="inline-flex items-center gap-1 text-xs text-app-text-muted hover:text-app-text cursor-pointer">
              <Trash2 size={12} /> Clear
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1.5">
            {manualQueue.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => sendByHand(c)}
                disabled={!c.phone}
                className="w-full flex items-center justify-between gap-3 rounded-xl ring-1 ring-app-border bg-app-bg px-3 py-2 text-left text-sm disabled:opacity-50 cursor-pointer"
              >
                <span className="min-w-0 truncate">{customerName(c.name)}</span>
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <MessageCircle size={13} /> {c.phone ? 'Open WhatsApp' : 'No phone'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
