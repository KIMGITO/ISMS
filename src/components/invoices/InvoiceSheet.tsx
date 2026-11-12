// Make an invoice for what a customer owes: check it, change descriptions and texts, then issue
// it with the next invoice number and share it. Also reopens an invoice issued earlier.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, RefreshCw, FileText, Share2, MessageCircle, Mail, Download, Eye, PenLine, Check, Save, AlertCircle } from 'lucide-react';
import { SheetLayer } from '../shared/SheetLayer';
import { Switch } from '../shared/Switch';
import { useOverlay } from '../../hooks/useOverlay';
import { useBusinessStore } from '../../stores/businessStore';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { NO_EMAIL_PLACEHOLDER } from '../../services/customerMerge';
import { ReceiptService } from '../../services/receipt/ReceiptService';
import type { Customer } from '../../types';
import { InvoiceDocument, InvoiceLine, InvoicePeriod, InvoicePeriodPreset, InvoiceTexts, OpenCredit } from '../../services/invoice/types';
import { addDays, buildInvoiceDocument, buildInvoiceLines, combineSameProducts, formatInvoiceMoney, PERIOD_LABELS, periodFor, todayIso } from '../../services/invoice/invoiceDraft';
import { getInvoiceTexts, invoiceAccent, receiptClosing, saveInvoiceTexts } from '../../services/invoice/invoiceSettings';
import { fetchOpenCredit, issueInvoice, nextInvoiceNumber } from '../../services/invoice/invoiceData';
import { InvoiceShareService } from '../../services/invoice/InvoiceShareService';
import { InvoicePaper } from './InvoicePaper';
import { InvoiceLookControls } from './InvoiceLookControls';

interface Props {
  /** Make a new invoice for this customer. */
  customer?: Customer | null;
  /** Or show an invoice issued earlier. */
  issued?: InvoiceDocument | null;
  onClose: () => void;
  onIssued?: (doc: InvoiceDocument) => void;
}

type Pane = 'edit' | 'preview';
type Busy = null | 'load' | 'issue' | 'pdf' | 'email' | 'whatsapp' | 'save';

const field = 'w-full bg-app-bg text-app-text px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500';
const labelCls = 'block text-xs font-medium text-app-text-muted mb-1';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-app-text-muted mt-1">{hint}</span>}
    </label>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="hidden md:inline-block ml-1.5 px-1.5 rounded border border-current/25 text-[10px] font-mono opacity-60">{children}</kbd>;
}

export function InvoiceSheet({ customer, issued, onClose, onIssued }: Props) {
  const open = !!customer || !!issued;
  const { showToast } = useNotificationStore();
  const activeBusinessId = useBusinessStore((s) => s.activeBusinessId);
  const business = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId));
  const employeeName = useAuthStore((s) => s.currentEmployee?.name);

  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [credits, setCredits] = useState<OpenCredit[]>([]);
  const [combine, setCombine] = useState(false);
  const [nextNo, setNextNo] = useState<number | null>(null);
  const [pane, setPane] = useState<Pane>('edit');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [textsDirty, setTextsDirty] = useState(false);
  // Which sales the invoice covers.
  const [preset, setPreset] = useState<InvoicePeriodPreset>('all');
  const [customFrom, setCustomFrom] = useState(() => addDays(todayIso(), -30));
  const [customTo, setCustomTo] = useState(todayIso);
  const [includeEarlier, setIncludeEarlier] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const issuing = useRef(false);

  const isIssued = !!doc?.invoiceNo;
  useOverlay(open, onClose, 'dialog');

  // Build the draft (or show the issued invoice).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setPane('edit');
    setTextsDirty(false);
    if (issued) {
      setDoc(issued);
      setPhone(issued.to.phone || '');
      setEmail(issued.to.email || '');
      return;
    }
    if (!customer || !activeBusinessId) return;
    let live = true;
    setDoc(null);
    setBusy('load');
    const realEmail = customer.email && customer.email !== NO_EMAIL_PLACEHOLDER ? customer.email : '';
    setPhone(customer.phone || '');
    setEmail(realEmail);
    const shop = ReceiptService.getSettings(activeBusinessId);
    const texts = getInvoiceTexts(activeBusinessId);
    setPreset(texts.defaultPeriod);
    setIncludeEarlier(true);
    const startPeriod: InvoicePeriod | undefined =
      texts.defaultPeriod === 'all' || texts.defaultPeriod === 'custom' ? undefined : { ...periodFor(texts.defaultPeriod), includeEarlier: true };
    Promise.all([fetchOpenCredit(customer.id), nextInvoiceNumber(activeBusinessId)])
      .then(([rows, next]) => {
        if (!live) return;
        setCredits(rows);
        setNextNo(next);
        setDoc(
          buildInvoiceDocument({
            credits: rows,
            owesNow: customer.debtBalance || 0,
            currency: shop.currencyFormat || 'KSh',
            accent: invoiceAccent(business),
            logoUrl: business?.logoUrl,
            ...receiptClosing(shop),
            period: startPeriod,
            texts,
            from: {
              name: shop.businessName || business?.name || '',
              address: shop.address,
              phone: shop.phone,
              email: shop.email,
              extra: shop.pinNumber ? `PIN: ${shop.pinNumber}` : undefined,
            },
            to: { name: customer.name, phone: customer.phone, email: realEmail || undefined, extra: customer.accountNumber ? `Account ${customer.accountNumber}` : undefined },
          }),
        );
      })
      .catch((err) => live && setError(toUserMessage(err, 'Could not load what this customer owes.')))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [open, customer?.id, issued, activeBusinessId]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => rootRef.current?.focus());
  }, [open]);

  const setTexts = (patch: Partial<InvoiceTexts>) => {
    setTextsDirty(true);
    setDoc((d) => {
      if (!d) return d;
      const texts = { ...d.texts, ...patch };
      const dueAt = patch.dueDays !== undefined ? addDays(d.issuedAt, Math.max(0, patch.dueDays)) : d.dueAt;
      return { ...d, texts, dueAt };
    });
  };
  const setLine = (id: string, description: string) =>
    setDoc((d) => (d ? { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, description } : l)) } : d));

  /** Rebuilds the lines for a period / grouping. Edited descriptions start over. */
  const rebuild = (next: { preset?: InvoicePeriodPreset; from?: string; to?: string; includeEarlier?: boolean; combine?: boolean }) => {
    const p = next.preset ?? preset;
    const from = next.from ?? customFrom;
    const to = next.to ?? customTo;
    const earlier = next.includeEarlier ?? includeEarlier;
    const comb = next.combine ?? combine;
    const period: InvoicePeriod | undefined =
      p === 'all' ? undefined : p === 'custom' ? { from: from <= to ? from : to, to: from <= to ? to : from, includeEarlier: earlier } : { ...periodFor(p), includeEarlier: earlier };
    const { lines, totals } = buildInvoiceLines(credits, customer?.debtBalance || 0, period);
    setDoc((d) => (d ? { ...d, period, totals, lines: comb ? combineSameProducts(lines) : lines } : d));
  };
  const toggleCombine = (on: boolean) => {
    setCombine(on);
    rebuild({ combine: on });
  };

  const canIssue = !!doc && !isIssued && doc.totals.balance > 0 && busy === null;

  const issue = useCallback(async () => {
    // A ref, not state: a double click or a held Ctrl+Enter fires again before the screen re-renders.
    if (!doc || !customer || !activeBusinessId || !canIssue || issuing.current) return;
    if (doc.lines.some((l) => !l.description.trim())) {
      setError('Every line needs a description.');
      setPane('edit');
      return;
    }
    issuing.current = true;
    setBusy('issue');
    setError(null);
    try {
      const done = await issueInvoice({ businessId: activeBusinessId, customerId: customer.id, doc, createdBy: employeeName });
      // Texts changed for this invoice become the starting point for the next one.
      if (textsDirty) {
        saveInvoiceTexts(done.texts).then(() => setTextsDirty(false)).catch(() => {});
      }
      setDoc(done);
      setPane('preview');
      onIssued?.(done);
      showToast('Invoice issued', `${done.invoiceNo} for ${formatInvoiceMoney(done.totals.balance, done.currency)}.`, undefined, 'success');
    } catch (err) {
      setError(toUserMessage(err, 'Could not issue the invoice.'));
    } finally {
      issuing.current = false;
      setBusy(null);
    }
  }, [doc, customer?.id, activeBusinessId, canIssue, employeeName, textsDirty]);

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      showToast('Invoice', toUserMessage(err, 'That did not work.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };
  const sharePdf = () => doc && run('pdf', async () => {
    const r = await InvoiceShareService.sharePdf(doc);
    if (r === 'downloaded') showToast('Saved', 'The invoice PDF was downloaded.', undefined, 'success');
  });
  const sendEmail = () => {
    if (!doc) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showToast('Email', 'Enter the customer’s email address first.', undefined, 'info');
      return;
    }
    run('email', async () => {
      const how = await InvoiceShareService.email(doc, email.trim());
      if (how === 'text_only') showToast('Email', 'The PDF was saved. Attach it to the email that opened.', undefined, 'info');
    });
  };
  const sendWhatsApp = () => doc && run('whatsapp', () => InvoiceShareService.whatsapp(doc, phone.trim()));
  const saveTexts = () => doc && run('save', async () => {
    await saveInvoiceTexts(doc.texts);
    setTextsDirty(false);
    showToast('Saved', 'New invoices will use these texts.', undefined, 'success');
  });

  // Keyboard: Ctrl+Enter issues; after issuing P shares the PDF, W WhatsApp, E email.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        issue();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || !isIssued) return;
      const k = e.key.toLowerCase();
      if (k === 'p') sharePdf();
      else if (k === 'w') sendWhatsApp();
      else if (k === 'e') sendEmail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const nextLabel = useMemo(() => {
    if (!doc) return '';
    if (doc.invoiceNo) return doc.invoiceNo;
    if (nextNo == null) return 'Numbered when issued';
    const prefix = doc.texts.prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return `${prefix ? `${prefix}-` : ''}${String(nextNo).padStart(4, '0')}`;
  }, [doc?.invoiceNo, doc?.texts.prefix, nextNo]);

  const btn = 'inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <SheetLayer>
      <AnimatePresence>
        {open && (
          <motion.div
            key="invoice-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 flex items-end md:items-center justify-center md:p-4"
            onClick={onClose}
          >
            <motion.div
              ref={rootRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Invoice"
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              onClick={(e) => e.stopPropagation()}
              className="outline-none w-full md:max-w-6xl bg-app-card text-app-text rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col h-[calc(100dvh-var(--inset-top)-0.5rem)] md:h-[min(92dvh,62rem)] pb-[var(--inset-bottom)] md:pb-0"
            >
              {/* Header */}
              <div className="shrink-0 flex items-center gap-3 px-4 pt-3 pb-2 border-b border-app-border/60">
                <div className="size-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold truncate">{isIssued ? `${doc?.texts.title} ${doc?.invoiceNo}` : `Invoice for ${customer?.name || ''}`}</h2>
                  <p className="text-xs text-app-text-muted truncate">
                    {doc ? `${nextLabel} · Balance due ${formatInvoiceMoney(doc.totals.balance, doc.currency)}` : 'Loading what is owed…'}
                  </p>
                </div>
                <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 rounded-full hover:bg-app-bg cursor-pointer">
                  <X size={18} />
                </button>
              </div>

              {/* Phone: one pane at a time, so neither is squeezed */}
              <div className="shrink-0 lg:hidden px-4 pt-2">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-app-bg" role="tablist">
                  {(['edit', 'preview'] as Pane[]).map((p) => (
                    <button
                      key={p}
                      role="tab"
                      aria-selected={pane === p}
                      onClick={() => setPane(p)}
                      className={`py-1.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer ${pane === p ? 'bg-app-card shadow-sm' : 'text-app-text-muted'}`}
                    >
                      {p === 'edit' ? <PenLine size={14} /> : <Eye size={14} />}
                      {p === 'edit' ? (isIssued ? 'Send' : 'Details') : 'Preview'}
                    </button>
                  ))}
                </div>
              </div>

              {busy === 'load' || (!doc && !error) ? (
                <div className="flex-1 grid place-items-center text-app-text-muted">
                  <RefreshCw size={20} className="animate-spin" />
                </div>
              ) : !doc ? (
                <div className="flex-1 grid place-items-center p-6 text-center">
                  <div>
                    <AlertCircle className="mx-auto text-red-500" />
                    <p className="mt-2 text-sm">{error}</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(20rem,26rem)_1fr]">
                  {/* Details / send */}
                  <div className={`min-h-0 overflow-y-auto overscroll-contain p-4 space-y-5 lg:border-r border-app-border/60 ${pane === 'edit' ? 'block' : 'hidden lg:block'}`}>
                    {error && (
                      <div className="p-3 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-sm flex gap-2">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        {error}
                      </div>
                    )}

                    {doc.totals.balance <= 0 && !isIssued && (
                      <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-sm">This customer owes nothing, so there is nothing to invoice.</div>
                    )}

                    {isIssued ? (
                      <section className="space-y-3">
                        <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-sm flex gap-2">
                          <Check size={16} className="shrink-0 mt-0.5" />
                          {doc.invoiceNo} is issued. Send it to the customer.
                        </div>
                        <button onClick={sharePdf} disabled={busy !== null} className={`${btn} w-full bg-amber-500 hover:bg-amber-600 text-white`}>
                          {busy === 'pdf' ? <RefreshCw size={16} className="animate-spin" /> : <Share2 size={16} />} Share PDF <Kbd>P</Kbd>
                        </button>
                        <Field label="WhatsApp number">
                          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={field} placeholder="0712 345 678" />
                        </Field>
                        <button onClick={sendWhatsApp} disabled={busy !== null} className={`${btn} w-full bg-[#25D366]/15 text-[#128C7E] dark:text-[#25D366] hover:bg-[#25D366]/25`}>
                          {busy === 'whatsapp' ? <RefreshCw size={16} className="animate-spin" /> : <MessageCircle size={16} />} Send on WhatsApp <Kbd>W</Kbd>
                        </button>
                        <Field label="Email">
                          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" className={field} placeholder="customer@example.com" />
                        </Field>
                        <button onClick={sendEmail} disabled={busy !== null} className={`${btn} w-full bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20`}>
                          {busy === 'email' ? <RefreshCw size={16} className="animate-spin" /> : <Mail size={16} />} Email with PDF <Kbd>E</Kbd>
                        </button>
                        <button onClick={() => run('pdf', () => InvoiceShareService.download(doc))} disabled={busy !== null} className={`${btn} w-full bg-app-bg hover:bg-app-border/50`}>
                          <Download size={16} /> Download PDF
                        </button>
                        <p className="text-xs text-app-text-muted">WhatsApp gets a message with the amount and how to pay. Use Share PDF to send the PDF itself.</p>
                      </section>
                    ) : (
                      <>
                        <section>
                          <h3 className="text-sm font-semibold mb-2">Which sales</h3>
                          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Invoice period">
                            {(Object.keys(PERIOD_LABELS) as InvoicePeriodPreset[]).map((p) => (
                              <button
                                key={p}
                                type="button"
                                role="radio"
                                aria-checked={preset === p}
                                onClick={() => {
                                  setPreset(p);
                                  rebuild({ preset: p });
                                }}
                                className={`px-3 py-1.5 rounded-full text-[13px] font-medium cursor-pointer ${preset === p ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-app-bg text-app-text hover:bg-app-border/50'}`}
                              >
                                {PERIOD_LABELS[p]}
                              </button>
                            ))}
                          </div>
                          {preset === 'custom' && (
                            <div className="grid grid-cols-2 gap-3 mt-3">
                              <Field label="From">
                                <input type="date" value={customFrom} max={customTo} onChange={(e) => { if (!e.target.value) return; setCustomFrom(e.target.value); rebuild({ from: e.target.value }); }} className={field} />
                              </Field>
                              <Field label="To">
                                <input type="date" value={customTo} min={customFrom} onChange={(e) => { if (!e.target.value) return; setCustomTo(e.target.value); rebuild({ to: e.target.value }); }} className={field} />
                              </Field>
                            </div>
                          )}
                          {preset !== 'all' && (
                            <Switch
                              checked={includeEarlier}
                              onChange={(on) => {
                                setIncludeEarlier(on);
                                rebuild({ includeEarlier: on });
                              }}
                              label="Add what is unpaid from before"
                              description="One line with the older unpaid balance, so the invoice shows everything owed."
                              className="mt-3"
                            />
                          )}
                          {doc.period && doc.totals.owedNow !== undefined && Math.abs(doc.totals.owedNow - doc.totals.balance) > 0.009 && (
                            <p className="mt-2 text-xs text-app-text-muted">
                              This invoice: {formatInvoiceMoney(doc.totals.balance, doc.currency)}. Owed on the whole account: {formatInvoiceMoney(doc.totals.owedNow, doc.currency)}.
                            </p>
                          )}
                        </section>

                        <section className="grid grid-cols-2 gap-3">
                          <Field label="Invoice date">
                            <input
                              type="date"
                              value={doc.issuedAt}
                              onChange={(e) => e.target.value && setDoc({ ...doc, issuedAt: e.target.value, dueAt: addDays(e.target.value, doc.texts.dueDays) })}
                              className={field}
                            />
                          </Field>
                          <Field label="Due date">
                            <input type="date" value={doc.dueAt} min={doc.issuedAt} onChange={(e) => setDoc({ ...doc, dueAt: e.target.value })} className={field} />
                          </Field>
                        </section>

                        <section>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <h3 className="text-sm font-semibold">What they owe for</h3>
                            <span className="text-xs text-app-text-muted">{doc.lines.length} {doc.lines.length === 1 ? 'line' : 'lines'}</span>
                          </div>
                          <Switch
                            checked={combine}
                            onChange={toggleCombine}
                            label="Combine the same product"
                            description="One line per product and price, and one per delivery fee. Totals stay the same. Resets edited descriptions."
                            className="mb-3"
                          />
                          {doc.lines.length === 0 && (
                            <p className="p-3 rounded-xl bg-app-bg text-sm text-app-text-muted">No unpaid sales in this period.</p>
                          )}
                          <ul className="space-y-2">
                            {doc.lines.map((l: InvoiceLine) => (
                              <li key={l.id} className="rounded-xl bg-app-bg p-2.5">
                                <input
                                  value={l.description}
                                  onChange={(e) => setLine(l.id, e.target.value)}
                                  aria-label="Description"
                                  className="w-full bg-transparent text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 rounded px-1 -mx-1"
                                />
                                <div className="flex items-center justify-between gap-2 text-xs text-app-text-muted mt-1">
                                  <span className="truncate">
                                    {l.kind === 'delivery' ? 'Delivery' : l.kind === 'charge' ? 'Balance' : `${l.quantity}${l.unit ? ` ${l.unit}` : ''} × ${formatInvoiceMoney(l.unitPrice, '')}`}
                                    {l.date ? ` · ${l.date.split('-').reverse().join('/')}` : ''}
                                  </span>
                                  <span className="font-semibold text-app-text tabular-nums shrink-0">{formatInvoiceMoney(l.amount, doc.currency)}</span>
                                </div>
                              </li>
                            ))}
                          </ul>
                          <dl className="mt-3 text-sm grid grid-cols-[1fr_auto] gap-y-1">
                            <dt className="text-app-text-muted">Subtotal</dt>
                            <dd className="tabular-nums text-right">{formatInvoiceMoney(doc.totals.subtotal, doc.currency)}</dd>
                            {doc.totals.tax > 0 && (<><dt className="text-app-text-muted">Tax</dt><dd className="tabular-nums text-right">{formatInvoiceMoney(doc.totals.tax, doc.currency)}</dd></>)}
                            {doc.totals.discount > 0 && (<><dt className="text-app-text-muted">Discount</dt><dd className="tabular-nums text-right">-{formatInvoiceMoney(doc.totals.discount, doc.currency)}</dd></>)}
                            {doc.totals.paid > 0 && (<><dt className="text-app-text-muted">Already paid</dt><dd className="tabular-nums text-right">-{formatInvoiceMoney(doc.totals.paid, doc.currency)}</dd></>)}
                            <dt className="font-semibold">Balance due</dt>
                            <dd className="font-semibold tabular-nums text-right text-blue-600 dark:text-blue-400">{formatInvoiceMoney(doc.totals.balance, doc.currency)}</dd>
                          </dl>
                          <p className="mt-2 text-xs text-app-text-muted">Amounts come from the sales and cannot be changed here.</p>
                        </section>

                        <section className="space-y-3">
                          <h3 className="text-sm font-semibold">Texts on the invoice</h3>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Title"><input className={field} value={doc.texts.title} onChange={(e) => setTexts({ title: e.target.value })} /></Field>
                            <Field label="Number prefix" hint={`Next: ${nextLabel}`}>
                              <input className={`${field} uppercase`} value={doc.texts.prefix} maxLength={8} onChange={(e) => setTexts({ prefix: e.target.value.toUpperCase() })} />
                            </Field>
                          </div>
                          <Field label="Note under the title"><input className={field} value={doc.texts.note} onChange={(e) => setTexts({ note: e.target.value })} /></Field>
                          <Switch
                            checked={doc.texts.showPaymentDetails}
                            onChange={(on) => setTexts({ showPaymentDetails: on })}
                            label="Show how to pay"
                            description="Payment methods and details on the invoice."
                          />
                          {doc.texts.showPaymentDetails && (
                            <Field label="How to pay" hint="For example: M-Pesa Till 123456, or bank details.">
                              <textarea rows={2} className={field} value={doc.texts.paymentInstructions} onChange={(e) => setTexts({ paymentInstructions: e.target.value })} />
                            </Field>
                          )}
                          <Switch
                            checked={doc.texts.showStamp}
                            onChange={(on) => setTexts({ showStamp: on })}
                            label="Business stamp"
                            description="Your stamp with the invoice date, beside the totals."
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Thank-you line" hint={doc.texts.closingFromReceipt !== false && doc.closing?.thankYou ? 'The receipt\'s is used while "Close like the receipt" is on.' : undefined}><input className={field} value={doc.texts.thankYou} onChange={(e) => setTexts({ thankYou: e.target.value })} /></Field>
                            <Field label="Days to pay">
                              <input type="number" min={0} max={365} className={field} value={doc.texts.dueDays} onChange={(e) => setTexts({ dueDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
                            </Field>
                          </div>
                          <InvoiceLookControls texts={doc.texts} set={setTexts} receipt={{ closing: doc.closing, qr: doc.qr }} hasLogo={!!doc.logoUrl} />
                          <p className="text-xs text-app-text-muted">Address, phone and email come from Business settings.</p>
                          <button onClick={saveTexts} disabled={!textsDirty || busy !== null} className={`${btn} w-full bg-app-bg hover:bg-app-border/50`}>
                            {busy === 'save' ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />} Use these texts for new invoices
                          </button>
                          <p className="text-xs text-app-text-muted">Labels, stamp wording and other defaults are in Settings → Invoices.</p>
                        </section>
                      </>
                    )}
                  </div>

                  {/* Preview */}
                  <div className={`min-h-0 overflow-y-auto overscroll-contain bg-app-bg p-3 sm:p-5 ${pane === 'preview' ? 'block' : 'hidden lg:block'}`}>
                    <InvoicePaper doc={doc} className="mx-auto max-w-[40rem]" onStampMove={isIssued ? undefined : (stampOffset) => setTexts({ stampOffset })} />
                  </div>
                </div>
              )}

              {/* Issue */}
              {doc && !isIssued && (
                <div className="shrink-0 border-t border-app-border/60 p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1 hidden sm:block text-sm">
                    <span className="text-app-text-muted">Will be </span>
                    <span className="font-semibold">{nextLabel}</span>
                  </div>
                  <button onClick={onClose} className={`${btn} bg-app-bg hover:bg-app-border/50`}>Cancel</button>
                  <button onClick={issue} disabled={!canIssue} className={`${btn} flex-1 sm:flex-none bg-amber-500 hover:bg-amber-600 text-white font-semibold`}>
                    {busy === 'issue' ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />} Issue invoice
                    <Kbd>Ctrl+Enter</Kbd>
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetLayer>
  );
}

export default InvoiceSheet;
