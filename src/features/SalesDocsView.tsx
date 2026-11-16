// Quotes & Invoices: selling to businesses and big customers the way they buy.
// Quote → (accepted) sales order → deliveries (stock goes out) and invoices (money owed)
// → payments, and credit notes when something comes back. The database numbers every
// document, keeps the totals and statuses, moves stock and posts to the books.
import { useUiStore } from '../stores/uiStore';
import { Checkbox } from '../components/shared/Checkbox';
import { displayName } from '../utils/stringUtils';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, ClipboardList, Receipt, Undo2, Clock, Plus, Search, RotateCcw, Pencil, Trash2, Send, Check, X, Ban,
  PackageCheck, Wallet, Share2, MessageCircle, ArrowRight,
} from 'lucide-react';
import { useBusinessStore, onBranchChange } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useCustomerStore } from '../stores/customerStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { formatCurrency } from '../utils/helpers';
import { Tabs } from '../components/TabOptions';
import { SwipeRow } from '../components/shared/SwipeRow';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn } from '../components/shared/FormSheet';
import SearchableDropdown from '../components/SearchableDropdown';
import { appDialog } from '../components/AppDialog';
import { ReceiptService } from '../services/receipt/ReceiptService';
import { getInvoiceTexts, invoiceAccent, receiptClosing } from '../services/invoice/invoiceSettings';
import { InvoiceShareService } from '../services/invoice/InvoiceShareService';
import {
  loadSalesDocs, loadAgeing, loadUnmatchedPayments, saveQuote, setQuoteStatus, deleteQuote, quoteToOrder, saveOrder, cancelOrder,
  deliverOrder, cancelDelivery, invoiceOrder, voidInvoice, recordInvoicePayment, voidInvoicePayment, setCustomerTerms,
  createCreditNote, draftTotals, lineAmounts, checkLines, creditPreview, toInvoiceDocument, quoteState, invoiceState, termsSetting,
  termsDaysOf, QUOTE_WORD, ORDER_WORD, INVOICE_WORD, SETTLEMENT_WORD, TERMS_CHOICES, MONEY_METHODS, VAT_RATES,
  type SalesDocs, type Quote, type SalesOrder, type SalesInvoice, type CreditNote, type AgeingRow, type UnmatchedPayment,
  type DocDraft, type DraftLine, type DocLine, type MoneyMethod, type Settlement,
} from '../services/salesDocs';

type Tab = 'quotes' | 'orders' | 'invoices' | 'credits' | 'owed';
type Filter = 'open' | 'all';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const plusDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T12:00:00`);
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};
const shortDate = (iso: string) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));

const TONE = {
  muted: 'bg-slate-500/15 text-app-text-muted',
  sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
};
const QUOTE_TONE: Record<string, string> = { draft: TONE.muted, sent: TONE.sky, accepted: TONE.green, declined: TONE.red, expired: TONE.amber };
const ORDER_TONE: Record<string, string> = { confirmed: TONE.sky, part_delivered: TONE.amber, delivered: TONE.violet, invoiced: TONE.amber, paid: TONE.green, cancelled: TONE.red };
const INVOICE_TONE: Record<string, string> = { unpaid: TONE.sky, part_paid: TONE.amber, paid: TONE.green, credited: TONE.muted, void: TONE.red, overdue: TONE.red };

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${tone}`}>{children}</span>;
}

/** A line's name as shown: product names in title case, typed items as they were written. */
const itemName = (l: { name: string; productId?: string | null }) => (l.productId ? displayName(l.name) : l.name);

const blankLine = (vat: number): DraftLine => ({ productId: null, name: '', unit: '', quantity: 1, unitPrice: 0, discountPct: 0, vatRate: vat });

export default function SalesDocsView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const business = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId));
  const role = useAuthStore((s) => s.currentEmployee?.role) || 'Guest';
  const showToast = useNotificationStore((s) => s.showToast);
  const products = useInventoryStore((s) => s.products);
  const customers = useCustomerStore((s) => s.customers);
  const can = (code: string) => hasRolePermission(role, code as any);

  const seesQuotes = can('quotes.view') || can('quotes.manage');
  const seesOrders = can('sales_orders.view') || can('sales_orders.manage');
  const seesInvoices = can('invoices.view') || can('invoices.manage');
  const manageQuotes = can('quotes.manage');
  const manageOrders = can('sales_orders.manage');
  const manageInvoices = can('invoices.manage');

  // VAT a new line starts with: the branch's rate when it charges VAT (only 16% or 8% are allowed).
  const defaultVat = business?.isTaxEnabled === false ? 0 : (VAT_RATES as readonly number[]).includes(Number(business?.taxPercentage)) ? Number(business?.taxPercentage) : business?.isTaxEnabled ? 16 : 0;

  const tabs = [
    { id: 'quotes' as Tab, label: 'Quotes', icon: <FileText size={14} />, shortcut: 'quotes-tab', allowed: seesQuotes },
    { id: 'orders' as Tab, label: 'Orders', icon: <ClipboardList size={14} />, shortcut: 'orders-tab', allowed: seesOrders },
    { id: 'invoices' as Tab, label: 'Invoices', icon: <Receipt size={14} />, shortcut: 'invoices-tab', allowed: seesInvoices },
    { id: 'credits' as Tab, label: 'Credit notes', icon: <Undo2 size={14} />, shortcut: 'credit-notes-tab', allowed: seesInvoices },
    { id: 'owed' as Tab, label: 'Who owes', icon: <Clock size={14} />, shortcut: 'invoice-ageing', allowed: seesInvoices },
  ].filter((t) => t.allowed);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'quotes');
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');

  const [docs, setDocs] = useState<SalesDocs>({ quotes: [], orders: [], invoices: [], creditNotes: [] });
  const [ageing, setAgeing] = useState<AgeingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [d, a] = await Promise.all([loadSalesDocs(businessId), seesInvoices ? loadAgeing(businessId) : Promise.resolve([])]);
      setDocs(d);
      setAgeing(a);
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load quotes and invoices. Check your connection.'));
    } finally {
      setLoading(false);
    }
  }, [businessId, seesInvoices]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => onBranchChange(() => { setDocs({ quotes: [], orders: [], invoices: [], creditNotes: [] }); setAgeing([]); }), []);

  // Open sheets; they follow the freshly loaded copy of the document.
  const [openId, setOpenId] = useState<{ kind: 'quote' | 'order' | 'invoice' | 'credit'; id: string } | null>(null);
  const opened = useMemo(() => {
    if (!openId) return null;
    const list = openId.kind === 'quote' ? docs.quotes : openId.kind === 'order' ? docs.orders : openId.kind === 'invoice' ? docs.invoices : docs.creditNotes;
    return (list as { id: string }[]).find((x) => x.id === openId.id) || null;
  }, [openId, docs]);
  const [editing, setEditing] = useState<{ kind: 'quote' | 'order'; id?: string; draft: DocDraft } | null>(null);
  const [qtySheet, setQtySheet] = useState<{ kind: 'deliver' | 'invoice'; order: SalesOrder } | null>(null);
  const [paying, setPaying] = useState<SalesInvoice | null>(null);
  const [crediting, setCrediting] = useState<SalesInvoice | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      if (done) showToast(done, '', undefined, 'success');
      await load();
      return true;
    } catch (err) {
      showToast(`Not ${label}`, toUserMessage(err, `Could not ${label}.`), undefined, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- sharing
  const shareable = (d: { kind: 'quote' | 'invoice' | 'credit'; doc: Quote | SalesInvoice | CreditNote }) => {
    const shop = ReceiptService.getSettings(businessId || '');
    const texts = getInvoiceTexts(businessId);
    const common = {
      from: { name: shop.businessName || business?.name || '', address: shop.address, phone: shop.phone, email: shop.email, extra: shop.pinNumber ? `PIN: ${shop.pinNumber}` : undefined },
      to: { name: d.doc.customerName, phone: (d.doc as any).customerPhone || undefined },
      texts,
      currency: shop.currencyFormat || 'KSh',
      accent: invoiceAccent(business),
      logoUrl: business?.logoUrl,
      ...receiptClosing(shop),
    };
    if (d.kind === 'quote') {
      const q = d.doc as Quote;
      return toInvoiceDocument({ kind: 'quote', number: q.number, issueDate: q.issueDate, validUntil: q.validUntil, lines: q.lines, subtotal: q.subtotal, vat: q.vat, deliveryFee: q.deliveryFee, paid: 0, balance: q.total, ...common });
    }
    if (d.kind === 'invoice') {
      const i = d.doc as SalesInvoice;
      return toInvoiceDocument({ kind: 'invoice', number: i.number, issueDate: i.issueDate, dueDate: i.dueDate, lines: i.lines, subtotal: i.subtotal, vat: i.vat, deliveryFee: i.deliveryFee, paid: Math.max(0, i.total - i.balance), balance: i.balance, ...common });
    }
    const c = d.doc as CreditNote;
    return toInvoiceDocument({ kind: 'credit', number: c.number, issueDate: c.issueDate, lines: c.lines, subtotal: c.subtotal, vat: c.vat, deliveryFee: 0, paid: 0, balance: c.total, ...common });
  };
  const sharePdf = async (d: Parameters<typeof shareable>[0]) => {
    try {
      const r = await InvoiceShareService.sharePdf(shareable(d));
      if (r === 'downloaded') showToast('PDF saved', `${d.doc.number}.pdf`, undefined, 'success');
    } catch (err) {
      showToast('Not shared', toUserMessage(err, 'Could not make the PDF.'), undefined, 'error');
    }
  };
  const shareWhatsApp = async (d: Parameters<typeof shareable>[0]) => {
    const phone = (d.doc as any).customerPhone || customers.find((c) => c.id === d.doc.customerId)?.phone || '';
    if (!phone) return showToast('No phone number', 'Add the customer\'s phone to send it on WhatsApp.', undefined, 'error');
    const ok = await InvoiceShareService.whatsapp(shareable(d), phone);
    if (!ok) showToast('WhatsApp did not open', 'Share the PDF instead.', undefined, 'error');
  };
  const ShareButtons = ({ d }: { d: Parameters<typeof shareable>[0] }) => (
    <div className="flex gap-2 flex-wrap">
      <button className={secondaryBtn} onClick={() => void sharePdf(d)}><Share2 size={15} /> PDF</button>
      <button className={secondaryBtn} onClick={() => void shareWhatsApp(d)}><MessageCircle size={15} /> WhatsApp</button>
    </div>
  );

  // ---------------------------------------------------------------- forms
  const newDoc = (kind: 'quote' | 'order', from?: Partial<DocDraft>) =>
    setEditing({
      kind,
      draft: {
        customerId: null, customerName: '', customerPhone: '', date: today(), untilDate: kind === 'quote' ? plusDays(today(), 14) : '',
        notes: '', terms: '', deliveryFee: 0, lines: [blankLine(defaultVat)], ...from,
      },
    });
  // A quote started on another screen (Loyalty customer, POS cart).
  const quoteDraft = useUiStore((st) => st.quoteDraft);
  useEffect(() => {
    if (!quoteDraft || !manageQuotes) return;
    useUiStore.getState().clearQuoteDraft();
    setTab('quotes');
    newDoc('quote', {
      customerId: quoteDraft.customerId ?? null,
      customerName: quoteDraft.customerName ?? '',
      customerPhone: quoteDraft.customerPhone ?? '',
      ...(quoteDraft.lines?.length
        ? { lines: quoteDraft.lines.map((l) => ({ ...blankLine(defaultVat), ...l, discountPct: l.discountPct ?? 0 })) }
        : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteDraft]);
  const editQuote = (q: Quote) =>
    setEditing({ kind: 'quote', id: q.id, draft: { customerId: q.customerId, customerName: q.customerName, customerPhone: q.customerPhone, date: q.issueDate, untilDate: q.validUntil, notes: q.notes, terms: q.terms, deliveryFee: q.deliveryFee, lines: q.lines.map(toDraftLine) } });
  const editOrder = (o: SalesOrder) =>
    setEditing({ kind: 'order', id: o.id, draft: { customerId: o.customerId, customerName: o.customerName, customerPhone: o.customerPhone, date: o.orderDate, untilDate: o.expectedDate || '', notes: o.notes, terms: o.terms, deliveryFee: o.deliveryFee, lines: o.lines.map(toDraftLine) } });

  const submitDoc = async () => {
    if (!editing || !businessId || busy) return;
    const d = editing.draft;
    if (!d.customerName.trim()) return showToast('Who is it for?', 'Choose or type the customer.', undefined, 'error');
    const problem = checkLines(d.lines);
    if (problem) return showToast('Check the items', problem, undefined, 'error');
    setBusy(true);
    try {
      const id = editing.kind === 'quote' ? await saveQuote(businessId, d, editing.id) : await saveOrder(businessId, d, editing.id);
      showToast(editing.id ? 'Saved' : editing.kind === 'quote' ? 'Quote made' : 'Order made', d.customerName, undefined, 'success');
      setEditing(null);
      setTab(editing.kind === 'quote' ? 'quotes' : 'orders');
      setFilter('open');
      await load();
      setOpenId({ kind: editing.kind, id });
    } catch (err) {
      showToast('Not saved', toUserMessage(err, 'Could not save.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  // A short "why" before undoing something. Resolves null when cancelled.
  const [reasonAsk, setReasonAsk] = useState<{ title: string; message: string; label: string; text: string; resolve: (v: string | null) => void } | null>(null);
  const askReason = (title: string, message: string, label: string) =>
    new Promise<string | null>((resolve) => setReasonAsk({ title, message, label, text: '', resolve }));
  const answerReason = (v: string | null) => {
    reasonAsk?.resolve(v);
    setReasonAsk(null);
  };

  // ---------------------------------------------------------------- lists
  const q = query.trim().toLowerCase();
  const match = (...v: (string | null | undefined)[]) => !q || v.some((x) => (x || '').toLowerCase().includes(q));
  const quotes = docs.quotes.filter((x) => (filter === 'all' || ['draft', 'sent'].includes(x.status)) && match(x.number, x.customerName, ...x.lines.map((l) => l.name)));
  const orders = docs.orders.filter((x) => (filter === 'all' || !['paid', 'cancelled'].includes(x.status)) && match(x.number, x.customerName, x.quoteNumber, ...x.lines.map((l) => l.name)));
  const invoices = docs.invoices.filter((x) => (filter === 'all' || ['unpaid', 'part_paid'].includes(x.status)) && match(x.number, x.customerName, x.orderNumber));
  const credits = docs.creditNotes.filter((x) => match(x.number, x.customerName, x.invoiceNumber, x.receiptNumber, x.reason));
  const owedTotal = docs.invoices.filter((i) => ['unpaid', 'part_paid'].includes(i.status)).reduce((s, i) => s + i.balance, 0);
  const overdueTotal = docs.invoices.filter((i) => i.overdue).reduce((s, i) => s + i.balance, 0);

  if (!tabs.length) {
    return <div className="h-full grid place-items-center p-6 text-sm text-app-text-muted">Your role can't see quotes, orders or invoices.</div>;
  }

  const empty = (text: string) => <p className="p-6 text-sm text-app-text-muted text-center">{text}</p>;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-5xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs<Tab> tabs={tabs} activeTab={tab} onChange={(t) => { setTab(t); setQuery(''); }} className="w-full sm:w-auto sm:flex-1 min-w-0 !pb-2" />
          {(tab === 'quotes' && manageQuotes) && (
            <button data-shortcut="new" onClick={() => newDoc('quote')} className={`${primaryBtn} ml-auto`}><Plus size={16} /> New quote</button>
          )}
          {(tab === 'orders' && manageOrders) && (
            <button data-shortcut="new" onClick={() => newDoc('order')} className={`${primaryBtn} ml-auto`}><Plus size={16} /> New order</button>
          )}
        </div>

        {tab !== 'owed' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[12rem]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by number, customer or item" className={`${fieldClass} pl-9 bg-app-card`} />
            </div>
            {tab !== 'credits' && (
              <div className="flex bg-app-card rounded-xl p-1 ring-1 ring-app-border">
                {([['open', tab === 'invoices' ? 'Unpaid' : 'Open'], ['all', 'All']] as [Filter, string][]).map(([id, label]) => (
                  <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${filter === id ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'invoices' && owedTotal > 0 && (
          <p className="text-xs text-app-text-muted">
            Customers owe <b className="text-app-text tabular-nums">{formatCurrency(owedTotal)}</b> on invoices
            {overdueTotal > 0 && <>, <b className="text-red-600 dark:text-red-400 tabular-nums">{formatCurrency(overdueTotal)}</b> of it late</>}.
          </p>
        )}

        {loading ? empty('Loading…') : loadError ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-sm text-app-text underline cursor-pointer"><RotateCcw size={14} /> Try again</button>
          </div>
        ) : tab === 'quotes' ? (
          quotes.length === 0 ? empty(docs.quotes.length ? 'No quote in this list matches.' : 'No quotes yet. Make one for a customer who wants prices before buying.') : (
            <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
              {quotes.map((x) => (
                <SwipeRow key={x.id} as="li" searchId={`quote-${x.id}`} title={`${x.number} · ${x.customerName}`} subtitle={formatCurrency(x.total)}
                  onClick={() => setOpenId({ kind: 'quote', id: x.id })}
                  actions={[{ label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !manageQuotes || x.status === 'accepted', onClick: async () => {
                    if (await appDialog.confirm({ title: `Delete ${x.number}?`, message: 'It is removed for good.', confirmLabel: 'Delete', destructive: true })) {
                      void run('deleted', () => deleteQuote(x.id), 'Quote deleted');
                    }
                  } }]}
                  contentClassName="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-app-bg/50">
                  <Row title={x.customerName} sub={`${x.number} · ${shortDate(x.issueDate)} · valid until ${shortDate(x.validUntil)}`} amount={x.total}
                    pill={<Pill tone={QUOTE_TONE[quoteState(x)]}>{QUOTE_WORD[quoteState(x)]}</Pill>} />
                </SwipeRow>
              ))}
            </ul>
          )
        ) : tab === 'orders' ? (
          orders.length === 0 ? empty(docs.orders.length ? 'No order in this list matches.' : 'No orders yet. Accept a quote, or make an order straight away.') : (
            <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
              {orders.map((x) => (
                <SwipeRow key={x.id} as="li" searchId={`order-${x.id}`} title={`${x.number} · ${x.customerName}`} subtitle={formatCurrency(x.total)}
                  onClick={() => setOpenId({ kind: 'order', id: x.id })} contentClassName="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-app-bg/50">
                  <Row title={x.customerName} sub={`${x.number} · ${shortDate(x.orderDate)}${x.quoteNumber ? ` · from ${x.quoteNumber}` : ''} · ${x.lines.length} ${x.lines.length === 1 ? 'item' : 'items'}`} amount={x.total}
                    pill={<Pill tone={ORDER_TONE[x.status]}>{ORDER_WORD[x.status]}</Pill>} />
                </SwipeRow>
              ))}
            </ul>
          )
        ) : tab === 'invoices' ? (
          invoices.length === 0 ? empty(docs.invoices.length ? 'No invoice in this list matches.' : 'No invoices yet. Invoice an order from the Orders tab.') : (
            <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
              {invoices.map((x) => (
                <SwipeRow key={x.id} as="li" searchId={`invoice-${x.id}`} title={`${x.number} · ${x.customerName}`} subtitle={`${formatCurrency(x.balance)} owed`}
                  onClick={() => setOpenId({ kind: 'invoice', id: x.id })} contentClassName="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-app-bg/50">
                  <Row title={x.customerName}
                    sub={`${x.number} · due ${shortDate(x.dueDate)}${x.overdue ? ` · ${x.daysLate} ${x.daysLate === 1 ? 'day' : 'days'} late` : ''}`}
                    amount={x.status === 'void' ? x.total : x.balance} amountHint={x.status === 'void' || x.balance === x.total ? undefined : `of ${formatCurrency(x.total)}`}
                    pill={<Pill tone={INVOICE_TONE[invoiceState(x)]}>{INVOICE_WORD[invoiceState(x)]}</Pill>} />
                </SwipeRow>
              ))}
            </ul>
          )
        ) : tab === 'credits' ? (
          credits.length === 0 ? empty(docs.creditNotes.length ? 'No credit note matches.' : 'No credit notes yet. They are made when an invoice or a till sale is refunded.') : (
            <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
              {credits.map((x) => (
                <SwipeRow key={x.id} as="li" searchId={`cn-${x.id}`} title={`${x.number} · ${x.customerName}`} subtitle={formatCurrency(x.total)}
                  onClick={() => setOpenId({ kind: 'credit', id: x.id })} contentClassName="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-app-bg/50">
                  <Row title={x.customerName} sub={`${x.number} · ${shortDate(x.issueDate)} · ${x.invoiceNumber ? `invoice ${x.invoiceNumber}` : `sale ${x.receiptNumber}`} · ${x.reason}`}
                    amount={x.total} pill={<Pill tone={TONE.muted}>{SETTLEMENT_WORD[x.settlement]}</Pill>} />
                </SwipeRow>
              ))}
            </ul>
          )
        ) : (
          <AgeingTable rows={ageing} onOpen={(r) => { setTab('invoices'); setFilter('open'); setQuery(r.name); }} />
        )}
      </div>

      {reasonAsk && (
        <FormSheet title={reasonAsk.title} subtitle={reasonAsk.message} onClose={() => answerReason(null)}
          footer={
            <>
              <button className={secondaryBtn} onClick={() => answerReason(null)}>Keep it</button>
              <button className={`${primaryBtn} !bg-red-600 !text-white`} disabled={!reasonAsk.text.trim()} onClick={() => answerReason(reasonAsk.text.trim())}>{reasonAsk.label}</button>
            </>
          }>
          <Field label="Why">
            <input autoFocus value={reasonAsk.text} maxLength={300} onChange={(e) => setReasonAsk({ ...reasonAsk, text: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && reasonAsk.text.trim()) answerReason(reasonAsk.text.trim()); }}
              placeholder="e.g. typed by mistake" className={fieldClass} />
          </Field>
        </FormSheet>
      )}

      {/* ---------------------------------------------------------------- quote / order form */}
      {editing && (
        <DocForm
          kind={editing.kind}
          id={editing.id}
          draft={editing.draft}
          setDraft={(draft) => setEditing((e) => (e ? { ...e, draft } : e))}
          busy={busy}
          onSubmit={() => void submitDoc()}
          onClose={() => setEditing(null)}
          defaultVat={defaultVat}
        />
      )}

      {/* ---------------------------------------------------------------- quote */}
      {openId?.kind === 'quote' && opened && (() => {
        const x = opened as Quote;
        const state = quoteState(x);
        const open = x.status === 'draft' || x.status === 'sent';
        return (
          <FormSheet wide title={`${x.number} · ${x.customerName}`} subtitle={`${QUOTE_WORD[state]} · ${shortDate(x.issueDate)} · valid until ${shortDate(x.validUntil)}${x.createdBy ? ` · by ${x.createdBy}` : ''}`}
            onClose={() => setOpenId(null)}
            footer={
              <>
                {manageQuotes && open && <button className={`${secondaryBtn} mr-auto`} disabled={busy} onClick={() => void run('changed', () => setQuoteStatus(x.id, 'declined'), 'Marked declined')}><X size={15} /> Declined</button>}
                {manageQuotes && x.status === 'declined' && <button className={`${secondaryBtn} mr-auto`} disabled={busy} onClick={() => void run('changed', () => setQuoteStatus(x.id, 'draft'))}><RotateCcw size={15} /> Back to draft</button>}
                {manageQuotes && open && <button className={secondaryBtn} disabled={busy} onClick={() => { setOpenId(null); editQuote(x); }}><Pencil size={15} /> Edit</button>}
                {manageQuotes && x.status === 'draft' && <button className={secondaryBtn} disabled={busy} onClick={() => void run('changed', () => setQuoteStatus(x.id, 'sent'), 'Marked sent')}><Send size={15} /> Mark sent</button>}
                {manageQuotes && manageOrders && open && (
                  <button className={primaryBtn} disabled={busy} onClick={() => void run('accepted', async () => { const id = await quoteToOrder(x.id); setTab('orders'); setOpenId({ kind: 'order', id }); }, 'Order made from the quote')}>
                    <Check size={15} /> Accepted: make order
                  </button>
                )}
                {x.orderId && <button className={primaryBtn} onClick={() => { setTab('orders'); setOpenId({ kind: 'order', id: x.orderId! }); }}>Open {x.orderNumber} <ArrowRight size={15} /></button>}
              </>
            }>
            {state === 'expired' && <p className="text-xs rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3">Past its "valid until" date. Edit it to give a new date, or accept it anyway.</p>}
            <LinesTable lines={x.lines} />
            <Totals net={x.subtotal} vat={x.vat} fee={x.deliveryFee} total={x.total} />
            {x.notes && <p className="text-sm text-app-text-muted whitespace-pre-line">{x.notes}</p>}
            {x.terms && <p className="text-xs text-app-text-muted whitespace-pre-line">Terms: {x.terms}</p>}
            <ShareButtons d={{ kind: 'quote', doc: x }} />
          </FormSheet>
        );
      })()}

      {/* ---------------------------------------------------------------- order */}
      {openId?.kind === 'order' && opened && (() => {
        const x = opened as SalesOrder;
        const live = x.status !== 'cancelled';
        const toDeliver = x.lines.some((l) => l.delivered < l.quantity);
        const toInvoice = x.lines.some((l) => l.invoiced < l.quantity);
        const untouched = x.lines.every((l) => l.delivered === 0 && l.invoiced === 0);
        return (
          <FormSheet wide title={`${x.number} · ${x.customerName}`} subtitle={`${ORDER_WORD[x.status]} · ${shortDate(x.orderDate)}${x.quoteNumber ? ` · from ${x.quoteNumber}` : ''}${x.createdBy ? ` · by ${x.createdBy}` : ''}`}
            onClose={() => setOpenId(null)}
            footer={live ? (
              <>
                {manageOrders && untouched && (
                  <button className={`${secondaryBtn} mr-auto`} disabled={busy} onClick={async () => {
                    const reason = await askReason(`Cancel ${x.number}?`, 'Nothing was delivered or invoiced. It stays in the list as cancelled.', 'Cancel order');
                    if (reason !== null) void run('cancelled', () => cancelOrder(x.id, reason), 'Order cancelled');
                  }}><Ban size={15} /> Cancel</button>
                )}
                {manageOrders && untouched && <button className={secondaryBtn} disabled={busy} onClick={() => { setOpenId(null); editOrder(x); }}><Pencil size={15} /> Edit</button>}
                {manageOrders && toDeliver && <button className={secondaryBtn} disabled={busy} onClick={() => setQtySheet({ kind: 'deliver', order: x })}><PackageCheck size={15} /> Deliver</button>}
                {manageInvoices && toInvoice && <button className={primaryBtn} disabled={busy} onClick={() => setQtySheet({ kind: 'invoice', order: x })}><Receipt size={15} /> Invoice</button>}
              </>
            ) : undefined}>
            {x.status === 'cancelled' && <p className="text-xs rounded-xl bg-red-500/10 text-red-700 dark:text-red-300 p-3">Cancelled.</p>}
            <div className="rounded-2xl ring-1 ring-app-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-app-bg text-[11px] text-app-text-muted">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Item</th>
                    <th className="text-right font-medium px-3 py-2">Ordered</th>
                    <th className="text-right font-medium px-3 py-2">Delivered</th>
                    <th className="text-right font-medium px-3 py-2">Invoiced</th>
                    <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border/60">
                  {x.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2">{itemName(l)}{!l.productId && <span className="block text-[10px] text-app-text-muted">Not a stock item</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{qtyText(l.quantity)} {l.unit}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${l.delivered >= l.quantity ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{qtyText(l.delivered)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${l.invoiced >= l.quantity ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{qtyText(l.invoiced)}</td>
                      <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">{formatCurrency(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Totals net={x.subtotal} vat={x.vat} fee={x.deliveryFee} total={x.total} />
            {x.notes && <p className="text-sm text-app-text-muted whitespace-pre-line">{x.notes}</p>}
            {x.deliveries.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-app-text-muted">Deliveries</p>
                {x.deliveries.map((d) => (
                  <div key={d.id} className={`flex items-center gap-2 rounded-xl ring-1 ring-app-border px-3 py-2 text-sm ${d.cancelled ? 'opacity-60' : ''}`}>
                    <PackageCheck size={15} className="shrink-0 text-app-text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className={d.cancelled ? 'line-through' : ''}>{d.number} · {shortDate(d.at)}{d.by ? ` · ${d.by}` : ''}</p>
                      <p className="text-[11px] text-app-text-muted truncate">{d.lines.map((l) => `${qtyText(l.quantity)} ${itemName(l)}`).join(', ')}{d.note ? ` · ${d.note}` : ''}</p>
                    </div>
                    {d.cancelled ? <Pill tone={TONE.red}>Undone</Pill> : manageOrders && (
                      <button className="text-xs underline text-app-text-muted cursor-pointer" disabled={busy} onClick={async () => {
                        const reason = await askReason(`Undo ${d.number}?`, 'The items go back into stock and the delivery leaves the books.', 'Undo delivery');
                        if (reason !== null) void run('undone', () => cancelDelivery(d.id, reason), 'Delivery undone');
                      }}>Undo</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {x.invoices.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-app-text-muted">Invoices</p>
                {x.invoices.map((i) => (
                  <button key={i.id} onClick={() => { setTab('invoices'); setOpenId({ kind: 'invoice', id: i.id }); }}
                    className="w-full flex items-center gap-2 rounded-xl ring-1 ring-app-border px-3 py-2 text-sm text-left cursor-pointer hover:bg-app-bg/50">
                    <Receipt size={15} className="shrink-0 text-app-text-muted" />
                    <span className="flex-1">{i.number}</span>
                    <span className="tabular-nums">{formatCurrency(i.total)}</span>
                    <Pill tone={INVOICE_TONE[i.status]}>{INVOICE_WORD[i.status]}</Pill>
                  </button>
                ))}
              </div>
            )}
          </FormSheet>
        );
      })()}

      {qtySheet && (
        <QtySheet
          kind={qtySheet.kind}
          order={qtySheet.order}
          busy={busy}
          customerTerms={termsDaysOf(customers.find((c) => c.id === qtySheet.order.customerId)?.paymentTerms)}
          onClose={() => setQtySheet(null)}
          onSubmit={async (lines, opts) => {
            const o = qtySheet.order;
            const ok = await run(qtySheet.kind === 'deliver' ? 'delivered' : 'invoiced', async () => {
              if (qtySheet.kind === 'deliver') {
                await deliverOrder(o.id, lines, opts.note);
              } else {
                const id = await invoiceOrder(o.id, lines, { termsDays: opts.termsDays, notes: opts.note });
                if (opts.rememberTerms && o.customerId && opts.termsDays !== undefined) {
                  const setting = termsSetting(opts.termsDays);
                  if (setting) await setCustomerTerms(o.customerId, setting).catch(() => undefined);
                }
                setTab('invoices');
                setOpenId({ kind: 'invoice', id });
              }
            }, qtySheet.kind === 'deliver' ? 'Delivered: stock taken out' : 'Invoice made');
            if (ok) setQtySheet(null);
          }}
        />
      )}

      {/* ---------------------------------------------------------------- invoice */}
      {openId?.kind === 'invoice' && opened && (() => {
        const x = opened as SalesInvoice;
        const live = x.status !== 'void';
        const creditable = x.lines.some((l) => l.credited < l.quantity);
        return (
          <FormSheet wide title={`${x.number} · ${x.customerName}`}
            subtitle={`${INVOICE_WORD[invoiceState(x)]} · ${shortDate(x.issueDate)} · due ${shortDate(x.dueDate)}${x.orderNumber ? ` · order ${x.orderNumber}` : ''}`}
            onClose={() => setOpenId(null)}
            footer={live && manageInvoices ? (
              <>
                {x.payments.every((p) => p.voided) && x.creditNotes.length === 0 && (
                  <button className={`${secondaryBtn} mr-auto`} disabled={busy} onClick={async () => {
                    const reason = await askReason(`Void ${x.number}?`, 'Its number stays, marked void. The order can be invoiced again.', 'Void invoice');
                    if (reason) void run('voided', () => voidInvoice(x.id, reason), 'Invoice voided');
                  }}><Ban size={15} /> Void</button>
                )}
                {creditable && <button className={secondaryBtn} disabled={busy} onClick={() => setCrediting(x)}><Undo2 size={15} /> Credit note</button>}
                {x.balance > 0 && <button className={primaryBtn} disabled={busy} onClick={() => setPaying(x)}><Wallet size={15} /> Record payment</button>}
              </>
            ) : undefined}>
            {x.status === 'void' && <p className="text-xs rounded-xl bg-red-500/10 text-red-700 dark:text-red-300 p-3">Void: {x.voidReason}</p>}
            {x.overdue && <p className="text-xs rounded-xl bg-red-500/10 text-red-700 dark:text-red-300 p-3">{x.daysLate} {x.daysLate === 1 ? 'day' : 'days'} late.</p>}
            <LinesTable lines={x.lines} credited={Object.fromEntries(x.lines.map((l) => [l.id, l.credited]))} />
            <Totals net={x.subtotal} vat={x.vat} fee={x.deliveryFee} total={x.total}
              extra={[
                ...(x.paid ? [['Paid', -x.paid] as [string, number]] : []),
                ...(x.credited ? [['Credit notes', -x.credited] as [string, number]] : []),
                ...(x.refunded ? [['Given back', x.refunded] as [string, number]] : []),
              ]}
              balance={x.status === 'void' ? undefined : x.balance} />
            {x.payments.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-app-text-muted">Payments</p>
                {x.payments.map((p) => (
                  <div key={p.id} className={`flex items-center gap-2 rounded-xl ring-1 ring-app-border px-3 py-2 text-sm ${p.voided ? 'opacity-60' : ''}`}>
                    <Wallet size={15} className="shrink-0 text-app-text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className={p.voided ? 'line-through' : ''}>{formatCurrency(p.amount)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</p>
                      <p className="text-[11px] text-app-text-muted">{shortDate(p.at)}{p.by ? ` · ${p.by}` : ''}</p>
                    </div>
                    {p.voided ? <Pill tone={TONE.red}>Taken off</Pill> : manageInvoices && (
                      <button className="text-xs underline text-app-text-muted cursor-pointer" disabled={busy} onClick={async () => {
                        const reason = await askReason('Take this payment off the invoice?', 'The money stays in Payments as not matched to a sale; void it there if it never came in.', 'Take off');
                        if (reason !== null) void run('changed', () => voidInvoicePayment(p.id, reason), 'Payment taken off');
                      }}>Take off</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {x.creditNotes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-app-text-muted">Credit notes</p>
                {x.creditNotes.map((c) => (
                  <button key={c.id} onClick={() => setOpenId({ kind: 'credit', id: c.id })} className="w-full flex items-center gap-2 rounded-xl ring-1 ring-app-border px-3 py-2 text-sm text-left cursor-pointer hover:bg-app-bg/50">
                    <Undo2 size={15} className="shrink-0 text-app-text-muted" />
                    <span className="flex-1">{c.number} · {SETTLEMENT_WORD[c.settlement]}</span>
                    <span className="tabular-nums">{formatCurrency(c.total)}</span>
                  </button>
                ))}
              </div>
            )}
            {x.notes && <p className="text-sm text-app-text-muted whitespace-pre-line">{x.notes}</p>}
            {live && <ShareButtons d={{ kind: 'invoice', doc: x }} />}
          </FormSheet>
        );
      })()}

      {paying && (
        <PaymentSheet invoice={paying} businessId={businessId || ''} busy={busy} onClose={() => setPaying(null)}
          onSubmit={async (p) => { if (await run('recorded', () => recordInvoicePayment(paying.id, p), 'Payment recorded')) setPaying(null); }} />
      )}
      {crediting && (
        <CreditSheet invoice={crediting} busy={busy} onClose={() => setCrediting(null)}
          onSubmit={async (d) => {
            if (!businessId) return;
            if (await run('saved', async () => { const id = await createCreditNote(businessId, { invoiceId: crediting.id, ...d }); setOpenId({ kind: 'credit', id }); }, 'Credit note made')) setCrediting(null);
          }} />
      )}

      {/* ---------------------------------------------------------------- credit note */}
      {openId?.kind === 'credit' && opened && (() => {
        const x = opened as CreditNote;
        return (
          <FormSheet wide title={`${x.number} · ${x.customerName}`} subtitle={`${shortDate(x.issueDate)} · ${x.invoiceNumber ? `invoice ${x.invoiceNumber}` : `sale ${x.receiptNumber}`}${x.createdBy ? ` · by ${x.createdBy}` : ''}`}
            onClose={() => setOpenId(null)}
            footer={x.invoiceId ? <button className={secondaryBtn} onClick={() => { setTab('invoices'); setOpenId({ kind: 'invoice', id: x.invoiceId! }); }}>Open {x.invoiceNumber} <ArrowRight size={15} /></button> : undefined}>
            <p className="text-sm">{x.reason}</p>
            <p className="text-xs text-app-text-muted">{SETTLEMENT_WORD[x.settlement]}{x.method ? ` by ${x.method}` : ''}{x.returnStock ? ' · items put back in stock' : ''}</p>
            <div className="rounded-2xl ring-1 ring-app-border divide-y divide-app-border/60">
              {x.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-2 px-3 py-2 text-sm"><span>{qtyText(l.quantity)} × {itemName(l)}</span><span className="tabular-nums">{formatCurrency(l.total)}</span></div>
              ))}
            </div>
            <Totals net={x.subtotal} vat={x.vat} fee={0} total={x.total} />
            <ShareButtons d={{ kind: 'credit', doc: x }} />
          </FormSheet>
        );
      })()}
    </div>
  );
}

const toDraftLine = (l: DocLine): DraftLine => ({ productId: l.productId, name: l.name, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.vatRate });

function Row({ title, sub, amount, amountHint, pill }: { title: string; sub: string; amount: number; amountHint?: string; pill: React.ReactNode }) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-app-text truncate">{title}</p>
        <p className="text-[11px] text-app-text-muted mt-0.5 truncate">{sub}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-app-text tabular-nums">{formatCurrency(amount)}</p>
        {amountHint && <p className="text-[10px] text-app-text-muted tabular-nums">{amountHint}</p>}
        <div className="mt-0.5">{pill}</div>
      </div>
    </>
  );
}

function LinesTable({ lines, credited }: { lines: DocLine[]; credited?: Record<string, number> }) {
  return (
    <div className="rounded-2xl ring-1 ring-app-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-app-bg text-[11px] text-app-text-muted">
          <tr>
            <th className="text-left font-medium px-3 py-2">Item</th>
            <th className="text-right font-medium px-3 py-2">Qty</th>
            <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Each</th>
            <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">VAT</th>
            <th className="text-right font-medium px-3 py-2">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border/60">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2">
                {itemName(l)}
                {l.discountPct > 0 && <span className="block text-[10px] text-app-text-muted">{l.discountPct}% off</span>}
                {credited && credited[l.id] > 0 && <span className="block text-[10px] text-amber-600 dark:text-amber-400">{qtyText(credited[l.id])} credited</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{qtyText(l.quantity)} {l.unit}</td>
              <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">{formatCurrency(l.unitPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">{l.vatRate ? `${l.vatRate}%` : '-'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ net, vat, fee, total, extra = [], balance }: { net: number; vat: number; fee: number; total: number; extra?: [string, number][]; balance?: number }) {
  const row = (label: string, v: number, strong = false) => (
    <div key={label} className={`flex justify-between gap-4 ${strong ? 'font-semibold text-app-text' : 'text-app-text-muted'}`}>
      <span>{label}</span><span className="tabular-nums">{v < 0 ? `− ${formatCurrency(-v)}` : formatCurrency(v)}</span>
    </div>
  );
  return (
    <div className="ml-auto w-full sm:w-72 space-y-1 text-sm">
      {row('Before VAT', net)}
      {vat > 0 && row('VAT', vat)}
      {fee > 0 && row('Delivery', fee)}
      {row('Total', total, true)}
      {extra.map(([l, v]) => row(l, v))}
      {balance !== undefined && row('Still owed', balance, true)}
    </div>
  );
}

function AgeingTable({ rows, onOpen }: { rows: AgeingRow[]; onOpen: (r: AgeingRow) => void }) {
  if (!rows.length) return <p className="p-6 text-sm text-app-text-muted text-center">No customer owes anything on invoices.</p>;
  const sum = (k: keyof AgeingRow) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const cols: [keyof AgeingRow, string, string][] = [
    ['notDue', 'Not yet due', ''], ['d1_30', '1–30 days late', 'text-amber-700 dark:text-amber-300'], ['d31_60', '31–60', 'text-orange-700 dark:text-orange-300'],
    ['d61_90', '61–90', 'text-red-700 dark:text-red-300'], ['d90', 'Over 90', 'text-red-700 dark:text-red-300 font-semibold'],
  ];
  return (
    <div className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-x-auto">
      <table className="w-full text-sm min-w-[40rem]">
        <thead className="bg-app-bg text-[11px] text-app-text-muted">
          <tr>
            <th className="text-left font-medium px-3 py-2">Customer</th>
            {cols.map(([, label]) => <th key={label} className="text-right font-medium px-3 py-2">{label}</th>)}
            <th className="text-right font-medium px-3 py-2">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border/60">
          {rows.map((r) => (
            <tr key={(r.customerId || '') + r.name} className="cursor-pointer hover:bg-app-bg/50" onClick={() => onOpen(r)}>
              <td className="px-3 py-2">{r.name}<span className="block text-[10px] text-app-text-muted">{r.invoices} {r.invoices === 1 ? 'invoice' : 'invoices'}</span></td>
              {cols.map(([k, label, tone]) => <td key={label} className={`px-3 py-2 text-right tabular-nums ${r[k] ? tone : 'text-app-text-muted'}`}>{r[k] ? formatCurrency(Number(r[k])) : '-'}</td>)}
              <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-app-bg font-semibold">
            <td className="px-3 py-2">All customers</td>
            {cols.map(([k, label]) => <td key={label} className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum(k))}</td>)}
            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(sum('total'))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- quote / order form
function DocForm({ kind, id, draft, setDraft, busy, onSubmit, onClose, defaultVat }: {
  kind: 'quote' | 'order'; id?: string; draft: DocDraft; setDraft: (d: DocDraft) => void; busy: boolean; onSubmit: () => void; onClose: () => void; defaultVat: number;
}) {
  const products = useInventoryStore((s) => s.products);
  const customers = useCustomerStore((s) => s.customers);
  const set = (patch: Partial<DocDraft>) => setDraft({ ...draft, ...patch });
  const setLine = (i: number, patch: Partial<DraftLine>) => set({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const totals = draftTotals(draft.lines, draft.deliveryFee);
  const productItems = useMemo(
    () => products.filter((p) => !(p as any).deletedAt).map((p) => ({ id: p.id, label: displayName(p.name), sublabel: `${formatCurrency(p.price)} · ${p.stock} ${p.unit} in stock` })),
    [products],
  );
  const customerItems = useMemo(
    () => customers.filter((c) => !(c as any).mergedIntoId).map((c) => ({ id: c.id, label: c.name, sublabel: c.phone || undefined })),
    [customers],
  );
  const word = kind === 'quote' ? 'quote' : 'order';

  return (
    <FormSheet wide title={id ? `Edit ${word}` : `New ${word}`}
      subtitle={kind === 'quote' ? 'Prices are kept when the customer accepts, even if product prices change.' : 'Stock goes out when you deliver; money is owed when you invoice.'}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm">Total <b className="tabular-nums">{formatCurrency(totals.total)}</b></span>
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={busy} onClick={onSubmit}>{busy ? 'Saving…' : id ? 'Save' : kind === 'quote' ? 'Make quote' : 'Make order'}</button>
        </>
      }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer">
          <SearchableDropdown
            items={customerItems}
            selectedValue={draft.customerId || ''}
            onChange={(cid) => {
              const c = customers.find((x) => x.id === cid);
              if (c) set({ customerId: c.id, customerName: c.name, customerPhone: c.phone || '' });
            }}
            placeholder={draft.customerName || 'Choose a customer'}
            searchPlaceholder="Search customers"
          />
        </Field>
        <Field label={draft.customerId ? 'Name on the document' : 'Or type a name'}>
          <input value={draft.customerName} onChange={(e) => set({ customerName: e.target.value, ...(draft.customerId && !e.target.value ? { customerId: null } : {}) })} maxLength={120} placeholder="e.g. Green Valley Hotel" className={fieldClass} />
        </Field>
        <Field label="Phone (optional)">
          <input type="tel" inputMode="tel" value={draft.customerPhone} onChange={(e) => set({ customerPhone: e.target.value })} maxLength={30} placeholder="For WhatsApp" className={fieldClass} />
        </Field>
        <Field label="Delivery fee (optional)">
          <input type="number" inputMode="decimal" min="0" step="any" value={draft.deliveryFee || ''} onChange={(e) => set({ deliveryFee: Math.max(0, Number(e.target.value) || 0) })} placeholder="0" className={fieldClass} />
        </Field>
        <Field label={kind === 'quote' ? 'Quote date' : 'Order date'}>
          <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} className={fieldClass} />
        </Field>
        <Field label={kind === 'quote' ? 'Valid until' : 'Deliver by (optional)'}>
          <input type="date" value={draft.untilDate} min={draft.date} onChange={(e) => set({ untilDate: e.target.value })} className={fieldClass} />
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-app-text-muted">Items <span className="font-normal">(prices before VAT)</span></p>
        {draft.lines.map((l, i) => {
          const a = lineAmounts(l);
          return (
            <div key={i} className="rounded-2xl ring-1 ring-app-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SearchableDropdown
                    items={productItems}
                    selectedValue={l.productId || ''}
                    onChange={(pid) => {
                      const p = products.find((x) => x.id === pid);
                      if (p) setLine(i, { productId: p.id, name: displayName(p.name), unit: p.unit || '', unitPrice: p.price || 0 });
                    }}
                    placeholder={l.productId ? l.name : 'Choose a product (or type a service below)'}
                    searchPlaceholder="Search products"
                  />
                </div>
                <button type="button" aria-label="Remove this item" className="p-2 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-app-bg cursor-pointer"
                  onClick={() => set({ lines: draft.lines.length > 1 ? draft.lines.filter((_, j) => j !== i) : [blankLine(defaultVat)] })}>
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] gap-2">
                <input value={l.name} onChange={(e) => setLine(i, { name: e.target.value, ...(l.productId ? {} : {}) })} placeholder="Item or service" aria-label="Item name" className={`${fieldClass} col-span-2 sm:col-span-1`} />
                <input type="number" inputMode="decimal" min="0" step="any" value={l.quantity || ''} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} placeholder="Qty" aria-label="Quantity" className={fieldClass} />
                <input type="number" inputMode="decimal" min="0" step="any" value={l.unitPrice || ''} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} placeholder="Price each" aria-label="Price each before VAT" className={fieldClass} />
                <input type="number" inputMode="decimal" min="0" max="100" step="any" value={l.discountPct || ''} onChange={(e) => setLine(i, { discountPct: Number(e.target.value) })} placeholder="% off" aria-label="Discount percent" className={fieldClass} />
                <SearchableDropdown
                  items={VAT_RATES.map((r) => ({ id: String(r), label: r ? `VAT ${r}%` : 'No VAT' }))}
                  selectedValue={String(l.vatRate)}
                  onChange={(v) => setLine(i, { vatRate: Number(v) })}
                  placeholder="VAT"
                />
              </div>
              <p className="text-[11px] text-app-text-muted text-right tabular-nums">
                {!l.productId && l.name ? 'Not a stock item · ' : ''}{formatCurrency(a.net)}{a.vat ? ` + VAT ${formatCurrency(a.vat)}` : ''} = <b className="text-app-text">{formatCurrency(a.total)}</b>
              </p>
            </div>
          );
        })}
        <button type="button" onClick={() => set({ lines: [...draft.lines, blankLine(defaultVat)] })} className={`${secondaryBtn} w-full`}><Plus size={15} /> Add item</button>
      </div>

      <Field label="Notes (optional)">
        <textarea rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} placeholder="Shown on the document" className={fieldClass} />
      </Field>
      {kind === 'quote' && (
        <Field label="Terms (optional)">
          <textarea rows={2} value={draft.terms} onChange={(e) => set({ terms: e.target.value })} maxLength={1000} placeholder="e.g. 50% deposit on order, balance on delivery" className={fieldClass} />
        </Field>
      )}
      <div className="ml-auto w-full sm:w-72 text-sm space-y-1">
        <div className="flex justify-between text-app-text-muted"><span>Before VAT</span><span className="tabular-nums">{formatCurrency(totals.net)}</span></div>
        {totals.vat > 0 && <div className="flex justify-between text-app-text-muted"><span>VAT</span><span className="tabular-nums">{formatCurrency(totals.vat)}</span></div>}
        {draft.deliveryFee > 0 && <div className="flex justify-between text-app-text-muted"><span>Delivery</span><span className="tabular-nums">{formatCurrency(draft.deliveryFee)}</span></div>}
        <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(totals.total)}</span></div>
      </div>
    </FormSheet>
  );
}

// ---------------------------------------------------------------- deliver / invoice part of an order
function QtySheet({ kind, order, busy, customerTerms, onClose, onSubmit }: {
  kind: 'deliver' | 'invoice'; order: SalesOrder; busy: boolean; customerTerms: number; onClose: () => void;
  onSubmit: (lines: { lineId: string; quantity: number }[], opts: { note?: string; termsDays?: number; rememberTerms?: boolean }) => void;
}) {
  const left = (l: SalesOrder['lines'][number]) => Math.max(0, l.quantity - (kind === 'deliver' ? l.delivered : l.invoiced));
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(order.lines.map((l) => [l.id, left(l)])));
  const [note, setNote] = useState('');
  const [terms, setTerms] = useState(customerTerms);
  const [remember, setRemember] = useState(false);
  const total = order.lines.reduce((s, l) => s + (l.quantity ? (l.total * Math.min(qty[l.id] || 0, left(l))) / l.quantity : 0), 0);
  const nothing = order.lines.every((l) => !(qty[l.id] > 0));
  const deliveredOnly = () => setQty(Object.fromEntries(order.lines.map((l) => [l.id, Math.max(0, Math.min(l.delivered - l.invoiced, left(l)))])));

  return (
    <FormSheet wide title={kind === 'deliver' ? `Deliver ${order.number}` : `Invoice ${order.number}`}
      subtitle={kind === 'deliver' ? 'Stock goes out now, at today\'s cost.' : 'The customer owes this from the invoice date; the due date follows the payment terms.'}
      onClose={onClose}
      footer={
        <>
          {kind === 'invoice' && <span className="mr-auto self-center text-sm">About <b className="tabular-nums">{formatCurrency(total + (order.invoices.some((i) => i.status !== 'void') ? 0 : order.deliveryFee))}</b></span>}
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={busy || nothing} onClick={() => onSubmit(order.lines.map((l) => ({ lineId: l.id, quantity: Math.min(qty[l.id] || 0, left(l)) })), { note, termsDays: kind === 'invoice' ? terms : undefined, rememberTerms: remember })}>
            {kind === 'deliver' ? <><PackageCheck size={15} /> {busy ? 'Saving…' : 'Delivered'}</> : <><Receipt size={15} /> {busy ? 'Saving…' : 'Make invoice'}</>}
          </button>
        </>
      }>
      <div className="rounded-2xl ring-1 ring-app-border divide-y divide-app-border/60">
        {order.lines.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">{itemName(l)}</p>
              <p className="text-[11px] text-app-text-muted">{qtyText(left(l))} {l.unit} left of {qtyText(l.quantity)}{kind === 'invoice' ? ` · ${qtyText(l.delivered)} delivered` : ''}</p>
            </div>
            <input type="number" inputMode="decimal" min="0" max={left(l)} step="any" disabled={left(l) <= 0} aria-label={`How many ${l.name}`}
              value={qty[l.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.id]: Math.max(0, Math.min(left(l), Number(e.target.value) || 0)) }))}
              className={`${fieldClass} w-24 text-right`} />
          </div>
        ))}
      </div>
      {kind === 'invoice' && order.lines.some((l) => l.delivered > l.invoiced) && order.lines.some((l) => l.delivered < l.quantity) && (
        <button type="button" className="text-xs underline text-app-text-muted cursor-pointer" onClick={deliveredOnly}>Only what was delivered</button>
      )}
      {kind === 'invoice' && (
        <>
          <Field label="Payment terms">
            <div className="flex flex-wrap gap-2">
              {TERMS_CHOICES.map((t) => (
                <button key={t.days} type="button" aria-pressed={terms === t.days} onClick={() => setTerms(t.days)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ring-1 cursor-pointer ${terms === t.days ? 'ring-amber-500 bg-amber-500/10' : 'ring-app-border'}`}>{t.label}</button>
              ))}
            </div>
          </Field>
          {order.customerId && terms !== customerTerms && termsSetting(terms) && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={remember} onChange={(on) => setRemember(on)} />
              Use these terms for {order.customerName} from now on
            </label>
          )}
        </>
      )}
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={kind === 'deliver' ? 'e.g. Rider, vehicle, who received it' : 'Shown on the invoice'} className={fieldClass} />
      </Field>
    </FormSheet>
  );
}

// ---------------------------------------------------------------- record a payment
function PaymentSheet({ invoice, businessId, busy, onClose, onSubmit }: {
  invoice: SalesInvoice; businessId: string; busy: boolean; onClose: () => void;
  onSubmit: (p: { amount: number; method: MoneyMethod; reference?: string; paidAt?: string; paymentId?: string | null }) => void;
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [amount, setAmount] = useState(invoice.balance);
  const [method, setMethod] = useState<MoneyMethod>('M-Pesa');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [list, setList] = useState<UnmatchedPayment[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'existing' || list) return;
    loadUnmatchedPayments(businessId).then(setList).catch((err) => setError(toUserMessage(err, 'Could not load payments.')));
  }, [mode, list, businessId]);

  const submit = () => {
    setError(null);
    if (mode === 'existing') {
      if (!picked) return setError('Choose the payment.');
      return onSubmit({ amount: 0, method: 'Cash', paymentId: picked });
    }
    if (!(amount > 0)) return setError('Enter an amount above zero.');
    if (amount > invoice.balance + 0.001) return setError(`Only ${formatCurrency(invoice.balance)} is owed.`);
    const paidAt = date === today() ? undefined : new Date(`${date}T12:00:00+03:00`).toISOString();
    onSubmit({ amount, method, reference: reference.trim() || undefined, paidAt });
  };

  return (
    <FormSheet title={`Payment for ${invoice.number}`} subtitle={`${formatCurrency(invoice.balance)} still owed by ${invoice.customerName}`} onClose={onClose}
      footer={<><button className={secondaryBtn} onClick={onClose}>Cancel</button><button className={primaryBtn} disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Record payment'}</button></>}>
      <div className="flex bg-app-bg rounded-xl p-1 ring-1 ring-app-border">
        {([['new', 'Money received'], ['existing', 'Already in Payments']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} aria-pressed={mode === id}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${mode === id ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}>{label}</button>
        ))}
      </div>
      {mode === 'new' ? (
        <>
          <Field label="Amount">
            <input type="number" inputMode="decimal" min="0" step="any" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} className={fieldClass} />
          </Field>
          <Field label="Paid by">
            <SearchableDropdown items={MONEY_METHODS.map((m) => ({ id: m, label: m }))} selectedValue={method} onChange={(v) => setMethod(v as MoneyMethod)} placeholder="Choose how" />
          </Field>
          <Field label={method === 'M-Pesa' || method === 'Airtel Money' ? 'Transaction code' : 'Reference (optional)'} hint={method === 'M-Pesa' ? 'A code already in Payments is used, not counted twice.' : undefined}>
            <input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} maxLength={40} placeholder={method === 'M-Pesa' ? 'e.g. SKL4ABC123' : ''} className={fieldClass} />
          </Field>
          <Field label="Date paid">
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
          </Field>
        </>
      ) : !list ? (
        <p className="text-sm text-app-text-muted text-center py-3">{error ? '' : 'Loading…'}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-app-text-muted text-center py-3">No payment in the last 120 days is waiting to be matched.</p>
      ) : (
        <div className="rounded-2xl ring-1 ring-app-border divide-y divide-app-border/60 max-h-72 overflow-y-auto">
          {list.map((p) => (
            <label key={p.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${picked === p.id ? 'bg-amber-500/10' : ''}`}>
              <input type="radio" name="pay" checked={picked === p.id} onChange={() => setPicked(p.id)} className="accent-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{p.name || 'Unknown'} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</p>
                <p className="text-[11px] text-app-text-muted">{shortDate(p.date)}{p.free < p.amount ? ` · ${formatCurrency(p.free)} of ${formatCurrency(p.amount)} free` : ''}</p>
              </div>
              <span className="text-sm tabular-nums">{formatCurrency(Math.min(p.free, invoice.balance))}</span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- credit note for an invoice
function CreditSheet({ invoice, busy, onClose, onSubmit }: {
  invoice: SalesInvoice; busy: boolean; onClose: () => void;
  onSubmit: (d: { quantities: Record<string, number>; reason: string; settlement: Settlement; method?: MoneyMethod; returnStock: boolean }) => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState<Settlement>(invoice.balance > 0 ? 'reduce' : 'refund');
  const [method, setMethod] = useState<MoneyMethod>('M-Pesa');
  const [returnStock, setReturnStock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const total = creditPreview(invoice.lines, qty);
  const canGiveBack = invoice.paid - invoice.refunded;

  const submit = () => {
    setError(null);
    if (total <= 0) return setError('Tick at least one item with a quantity.');
    if (!reason.trim()) return setError('Say why (e.g. returned, damaged, wrong price).');
    if (settlement === 'reduce' && total > invoice.balance + 0.01) return setError(`Only ${formatCurrency(invoice.balance)} is still owed. Credit the rest as money back.`);
    if (settlement === 'refund' && total > canGiveBack + 0.01) return setError(`Only ${formatCurrency(canGiveBack)} was paid and not yet given back.`);
    onSubmit({ quantities: qty, reason, settlement, method, returnStock });
  };

  return (
    <FormSheet wide title={`Credit note for ${invoice.number}`} subtitle="Some or all lines back. The invoice keeps its number; the credit note gets its own." onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm">Credit <b className="tabular-nums">{formatCurrency(total)}</b></span>
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} disabled={busy} onClick={submit}><Undo2 size={15} /> {busy ? 'Saving…' : 'Make credit note'}</button>
        </>
      }>
      <div className="rounded-2xl ring-1 ring-app-border divide-y divide-app-border/60">
        {invoice.lines.map((l) => {
          const left = l.quantity - l.credited;
          return (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2">
              <Checkbox checked={(qty[l.id] || 0) > 0} onChange={(on) => setQty((q) => ({ ...q, [l.id]: on ? left : 0 }))} disabled={left <= 0} ariaLabel={`Credit ${l.name}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{itemName(l)}</p>
                <p className="text-[11px] text-app-text-muted">{qtyText(left)} of {qtyText(l.quantity)} left · {formatCurrency(l.quantity ? l.total / l.quantity : 0)} each</p>
              </div>
              <input type="number" inputMode="decimal" min="0" max={left} step="any" disabled={left <= 0} aria-label={`How many ${l.name}`}
                value={qty[l.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.id]: Math.max(0, Math.min(left, Number(e.target.value) || 0)) }))}
                className={`${fieldClass} w-20 text-right`} />
            </div>
          );
        })}
      </div>
      <Field label="Why">
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. 2 crates came back damaged" className={fieldClass} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        {([
          ['reduce', 'Less owed', `${formatCurrency(invoice.balance)} still owed`, invoice.balance > 0],
          ['refund', 'Give money back', `${formatCurrency(canGiveBack)} paid so far`, canGiveBack > 0],
        ] as [Settlement, string, string, boolean][]).filter(([, , , ok]) => ok).map(([id, label, hint]) => (
          <button key={id} type="button" aria-pressed={settlement === id} onClick={() => setSettlement(id)}
            className={`text-left rounded-xl px-3 py-2 ring-1 cursor-pointer ${settlement === id ? 'ring-amber-500 bg-amber-500/10' : 'ring-app-border'}`}>
            <span className="block text-sm font-medium">{label}</span>
            <span className="block text-[11px] text-app-text-muted">{hint}</span>
          </button>
        ))}
      </div>
      {settlement === 'refund' && (
        <Field label="Paid back by">
          <SearchableDropdown items={MONEY_METHODS.map((m) => ({ id: m, label: m }))} selectedValue={method} onChange={(v) => setMethod(v as MoneyMethod)} placeholder="Choose how" />
        </Field>
      )}
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox checked={returnStock} onChange={(on) => setReturnStock(on)} />
        <span>Put the items back in stock<span className="block text-[11px] text-app-text-muted">Leave it off for a price correction or goods thrown away.</span></span>
      </label>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </FormSheet>
  );
}
