import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { fetchPointSettings, pointsPerShilling } from '../services/loyalty/pointValue';
import { useOverlay } from '../hooks/useOverlay';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Package,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  Star,
} from 'lucide-react';
import SearchableDropdown from '../components/SearchableDropdown';
import { Tabs } from '../components/TabOptions';
import { getSupabase } from '../services/supabaseClient';
import { useAuthStore } from '../stores/authStore';
import { useBusinessStore } from '../stores/businessStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { STARTER_GUIDES } from './onlineStoreStarterGuides';
// The website's own page list and default text, so the editor shows exactly what customers see.
import { defaultInfoPageText, INFO_PAGES, InfoPageId } from '../../website/src/infoPages';
import type { Storefront } from '../../website/src/api';
import { Switch } from '../components/shared/Switch';
import DeliveryZonesEditor from '../components/DeliveryZonesEditor';

type TabId = 'orders' | 'messages' | 'feedback' | 'reviews' | 'promotions' | 'guides' | 'pages' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'orders', label: 'Orders' },
  { id: 'messages', label: 'Messages' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'guides', label: 'Guides' },
  { id: 'pages', label: 'Pages' },
  { id: 'settings', label: 'Website' },
];

const REFRESH_MS = 20000;

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Waiting for payment',
  payment_failed: 'Payment failed',
  paid: 'Paid: new',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const inputClass =
  'w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none focus:border-brand-500';
const primaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand-600 disabled:opacity-50';
const secondaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-app-border px-4 py-2 text-sm font-semibold text-app-text transition hover:bg-app-bg disabled:opacity-50';
const cardClass = 'rounded-xl border border-app-border bg-app-card p-4';

function nextOrderStatus(order: StaffOrder): { status: string; label: string } | null {
  switch (order.status) {
    case 'paid':
      return { status: 'preparing', label: 'Start preparing' };
    case 'preparing':
      return order.fulfilment === 'delivery'
        ? { status: 'out_for_delivery', label: 'Send out for delivery' }
        : { status: 'ready_for_pickup', label: 'Mark ready for pickup' };
    case 'out_for_delivery':
    case 'ready_for_pickup':
      return { status: 'completed', label: 'Mark completed' };
    default:
      return null;
  }
}

interface StaffOrder {
  id: string;
  order_number: number;
  status: string;
  fulfilment: 'delivery' | 'pickup';
  customer_name: string;
  customer_phone: string;
  delivery_address: string | null;
  notes: string | null;
  total: number;
  mpesa_receipt: string | null;
  needs_attention: boolean;
  attention_reason: string | null;
  created_at: string;
  rider_id: string | null;
  points_used: number;
  points_value: number;
  online_order_items: { id: string; product_name: string; unit: string; quantity: number }[];
}

interface StaffMessage {
  id: string;
  account_id: string;
  sender: 'customer' | 'staff' | 'system';
  staff_name: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
  customer_accounts: { name: string; phone: string } | null;
}

interface WebsiteFeedback {
  id: string;
  customer_name: string;
  rating: number;
  comment: string;
  feedback_type: string;
  resolved: boolean;
  created_at: string;
}

interface Guide {
  id: string | null;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  published: boolean;
}

const slugify = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const formatQuantity = (quantity: number, unit: string) =>
  `${Number(quantity)} ${Number(quantity) === 1 ? unit.replace(/s$/i, '') : unit}`;

const formatWhen = (value: string) =>
  new Date(value).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function useReportError() {
  const showToast = useNotificationStore((s) => s.showToast);
  return useCallback(
    (err: unknown, fallback: string) => {
      console.error(err);
      showToast('Online Store', toUserMessage(err, fallback), undefined, 'error');
    },
    [showToast],
  );
}

function OrdersTab({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const riders = useAuthStore((s) => s.employees).filter((e) => e.role === 'Rider');
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const canAssignRider = role ? hasRolePermission(role, 'orders.assign_rider') : false;
  const [orders, setOrders] = useState<StaffOrder[] | null>(null);
  const [filter, setFilter] = useState<'active' | 'unpaid' | 'all'>('active');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('online_orders')
      .select('*, online_order_items(id, product_name, unit, quantity)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    setOrders(data as StaffOrder[]);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => reportError(err, 'Could not load online orders.'));
    const timer = setInterval(() => load().catch(() => undefined), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, reportError]);

  const visible = useMemo(() => {
    const active = ['paid', 'preparing', 'out_for_delivery', 'ready_for_pickup'];
    const unpaid = ['pending_payment', 'payment_failed'];
    return (orders ?? []).filter((o) =>
      filter === 'all' ? true : filter === 'active' ? o.needs_attention || active.includes(o.status) : unpaid.includes(o.status),
    );
  }, [orders, filter]);

  const runAction = async (id: string, action: () => PromiseLike<{ error: unknown }>) => {
    setBusyId(id);
    try {
      const { error } = await action();
      if (error) throw error;
      await load();
    } catch (err) {
      reportError(err, 'Could not update the order.');
    } finally {
      setBusyId(null);
    }
  };

  if (!orders) return <p className="text-sm text-app-text-muted">Loading orders…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {([['active', 'To do'], ['unpaid', 'Unpaid'], ['all', 'All']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={filter === id ? primaryClass : secondaryClass}>
            {label}
          </button>
        ))}
      </div>
      {visible.length === 0 && <p className="py-8 text-center text-sm text-app-text-muted">No orders here.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((order) => {
          const next = nextOrderStatus(order);
          const unpaid = order.status === 'pending_payment' || order.status === 'payment_failed';
          return (
            <article key={order.id} className={cardClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-app-text">Order #{order.order_number}</h3>
                <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600">
                  {STATUS_LABELS[order.status] ?? order.status}
                </span>
              </div>
              {order.fulfilment === 'delivery' && ['paid', 'preparing', 'out_for_delivery'].includes(order.status) && (
                <div className="mt-2 flex items-center gap-2 text-sm text-app-text">
                  Rider
                  <SearchableDropdown
                    items={[{ id: '', label: 'Not assigned' }, ...riders.map((rider) => ({ id: rider.id, label: rider.name }))]}
                    selectedValue={order.rider_id ?? ''}
                    disabled={!canAssignRider || busyId === order.id}
                    onChange={(value) =>
                      runAction(order.id, () =>
                        getSupabase().rpc('staff_assign_rider', { p_order_id: order.id, p_rider_id: value || null }),
                      )
                    }
                    placeholder="Not assigned"
                  />
                </div>
              )}
              {order.points_used > 0 && (
                <p className="mt-2 text-sm text-app-text-muted">Paid {order.points_used} points (Ksh {order.points_value}) towards this order.</p>
              )}
              <p className="mt-1 text-xs text-app-text-muted">{formatWhen(order.created_at)}</p>
              <p className="mt-2 text-sm text-app-text">
                {order.customer_name} · <a className="underline" href={`tel:${order.customer_phone}`}>{order.customer_phone}</a>
              </p>
              <ul className="mt-2 text-sm text-app-text">
                {order.online_order_items.map((item) => (
                  <li key={item.id}>{formatQuantity(item.quantity, item.unit)} {item.product_name}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-app-text-muted">
                {order.fulfilment === 'delivery' ? `Deliver to: ${order.delivery_address}` : 'Pickup'}
              </p>
              {order.notes && <p className="mt-1 text-sm text-app-text-muted">Note: {order.notes}</p>}
              <p className="mt-2 text-sm font-bold text-app-text">
                Ksh {Number(order.total).toLocaleString()}
                {order.mpesa_receipt && <span className="font-normal text-app-text-muted"> · M-Pesa {order.mpesa_receipt}</span>}
              </p>
              {order.needs_attention && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
                  <p className="flex items-start gap-2 font-medium">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {order.attention_reason}
                  </p>
                  <button
                    disabled={busyId === order.id}
                    onClick={() => runAction(order.id, () => getSupabase().rpc('staff_clear_order_attention', { p_order_id: order.id }))}
                    className={`${secondaryClass} mt-2`}
                  >
                    Mark as handled
                  </button>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {next && (
                  <button
                    disabled={busyId === order.id}
                    onClick={() =>
                      runAction(order.id, () => getSupabase().rpc('staff_update_online_order', { p_order_id: order.id, p_status: next.status }))
                    }
                    className={primaryClass}
                  >
                    {next.label}
                  </button>
                )}
                {unpaid && (
                  <button
                    disabled={busyId === order.id}
                    onClick={() =>
                      runAction(order.id, () => getSupabase().rpc('staff_update_online_order', { p_order_id: order.id, p_status: 'cancelled' }))
                    }
                    className={secondaryClass}
                  >
                    Cancel order
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function MessagesTab({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const staffName = useAuthStore((s) => s.currentEmployee?.name ?? 'Staff');
  const [messages, setMessages] = useState<StaffMessage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useOverlay(selected !== null, () => setSelected(null), 'screen');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('customer_messages')
      .select('id, account_id, sender, staff_name, body, read_at, created_at, customer_accounts(name, phone)')
      .eq('business_id', businessId)
      .order('created_at')
      .limit(1000);
    if (error) throw error;
    setMessages(data as unknown as StaffMessage[]);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => reportError(err, 'Could not load messages.'));
    const timer = setInterval(() => load().catch(() => undefined), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, reportError]);

  const threads = useMemo(() => {
    const byAccount = new Map<string, StaffMessage[]>();
    (messages ?? []).forEach((m) => byAccount.set(m.account_id, [...(byAccount.get(m.account_id) ?? []), m]));
    return Array.from(byAccount.entries())
      .map(([accountId, items]) => ({
        accountId,
        items,
        name: items[0].customer_accounts?.name ?? 'Customer',
        phone: items[0].customer_accounts?.phone ?? '',
        unread: items.filter((m) => m.sender === 'customer' && !m.read_at).length,
        last: items[items.length - 1],
      }))
      .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  }, [messages]);

  const thread = threads.find((t) => t.accountId === selected);

  const openThread = async (accountId: string) => {
    setSelected(accountId);
    const { error } = await getSupabase().rpc('staff_mark_customer_messages_read', { p_account_id: accountId });
    if (error) reportError(error, 'Could not mark the messages as read.');
    else load().catch(() => undefined);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSending(true);
    try {
      const { error } = await getSupabase().rpc('staff_send_customer_message', {
        p_account_id: selected,
        p_body: reply,
        p_staff_name: staffName,
      });
      if (error) throw error;
      setReply('');
      await load();
    } catch (err) {
      reportError(err, 'Could not send your reply.');
    } finally {
      setSending(false);
    }
  };

  if (!messages) return <p className="text-sm text-app-text-muted">Loading messages…</p>;
  if (threads.length === 0) return <p className="py-8 text-center text-sm text-app-text-muted">No customer messages yet.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
      <ul className={`space-y-2 ${thread ? 'hidden md:block' : ''}`}>
        {threads.map((t) => (
          <li key={t.accountId}>
            <button
              onClick={() => openThread(t.accountId)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                selected === t.accountId ? 'border-brand-500 bg-amber-500/10' : 'border-app-border bg-app-card'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-app-text">{t.name}</span>
                {t.unread > 0 && (
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-500 text-xs font-bold text-slate-950">{t.unread}</span>
                )}
              </span>
              <span className="mt-1 block truncate text-xs text-app-text-muted">{t.last.body}</span>
            </button>
          </li>
        ))}
      </ul>
      {thread ? (
        <section className={`${cardClass} flex min-w-0 flex-col`}>
          <button onClick={() => setSelected(null)} className="mb-2 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-app-text-muted md:hidden">
            <ArrowLeft size={16} /> All messages
          </button>
          <h3 className="font-bold text-app-text">{thread.name}</h3>
          <a href={`tel:${thread.phone}`} className="text-xs text-app-text-muted underline">{thread.phone}</a>
          <div className="mt-3 max-h-96 flex-1 space-y-2 overflow-y-auto">
            {thread.items.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.sender === 'customer' ? 'items-start' : 'items-end'}`}>
                <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  m.sender === 'customer' ? 'bg-app-bg text-app-text' : 'bg-amber-500/15 text-app-text'
                }`}>
                  {m.body}
                </p>
                <span className="mt-0.5 text-[11px] text-app-text-muted">
                  {m.sender === 'system' ? 'Automatic' : m.sender === 'staff' ? m.staff_name : thread.name} · {formatWhen(m.created_at)}
                </span>
              </div>
            ))}
          </div>
          <form onSubmit={handleSend} className="mt-3 flex gap-2">
            <input
              required
              maxLength={1000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Write a reply"
              aria-label="Reply"
              className={inputClass}
            />
            <button type="submit" disabled={sending} aria-label="Send reply" className={primaryClass}>
              <Send size={16} />
            </button>
          </form>
        </section>
      ) : (
        <p className="hidden py-8 text-center text-sm text-app-text-muted md:block">Choose a customer to read their messages.</p>
      )}
    </div>
  );
}

function FeedbackTab({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const [items, setItems] = useState<WebsiteFeedback[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('complaints')
      .select('id, customer_name, rating, comment, feedback_type, resolved, created_at')
      .eq('business_id', businessId)
      .eq('last_modified_by', 'website')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    setItems(data as WebsiteFeedback[]);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => reportError(err, 'Could not load website feedback.'));
  }, [load, reportError]);

  const toggleResolved = async (item: WebsiteFeedback) => {
    const { error } = await getSupabase().from('complaints').update({ resolved: !item.resolved }).eq('id', item.id);
    if (error) reportError(error, 'Could not update the feedback.');
    else load().catch(() => undefined);
  };

  if (!items) return <p className="text-sm text-app-text-muted">Loading feedback…</p>;
  if (items.length === 0) return <p className="py-8 text-center text-sm text-app-text-muted">No website feedback yet.</p>;

  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => (
        <li key={item.id} className={`${cardClass} ${item.resolved ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-app-text">{item.customer_name}</span>
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold capitalize text-amber-600">{item.feedback_type}</span>
          </div>
          {item.feedback_type !== 'suggestion' && (
            <p className="mt-1 flex" aria-label={`${item.rating} out of 5 stars`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} size={14} className={n <= item.rating ? 'fill-amber-500 text-amber-500' : 'text-app-border'} />
              ))}
            </p>
          )}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-app-text">{item.comment}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-app-text-muted">{formatWhen(item.created_at)}</span>
            <button onClick={() => toggleResolved(item)} className={secondaryClass}>
              <CheckCircle2 size={16} /> {item.resolved ? 'Reopen' : 'Mark resolved'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GuidesTab({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [editing, setEditing] = useState<Guide | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('website_articles')
      .select('id, slug, title, summary, body, category, published')
      .eq('business_id', businessId)
      .order('created_at');
    if (error) throw error;
    setGuides(data as Guide[]);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => reportError(err, 'Could not load guides.'));
  }, [load, reportError]);

  const addStarters = async () => {
    setBusy(true);
    try {
      const { error } = await getSupabase()
        .from('website_articles')
        .upsert(
          STARTER_GUIDES.map((guide) => ({ ...guide, business_id: businessId, published: false })),
          { onConflict: 'business_id,slug', ignoreDuplicates: true },
        );
      if (error) throw error;
      await load();
    } catch (err) {
      reportError(err, 'Could not add the starter guides.');
    } finally {
      setBusy(false);
    }
  };

  const save = async (guide: Guide) => {
    setBusy(true);
    try {
      const fields = {
        business_id: businessId,
        title: guide.title.trim(),
        slug: guide.slug || slugify(guide.title),
        summary: guide.summary.trim(),
        body: guide.body.trim(),
        category: guide.category.trim() || 'Milk care',
        published: guide.published,
        published_at: guide.published ? new Date().toISOString() : null,
      };
      const { error } = guide.id
        ? await getSupabase().from('website_articles').update(fields).eq('id', guide.id)
        : await getSupabase().from('website_articles').insert(fields);
      if (error) throw error;
      setEditing(null);
      await load();
    } catch (err) {
      reportError(err, 'Could not save the guide.');
    } finally {
      setBusy(false);
    }
  };

  if (!guides) return <p className="text-sm text-app-text-muted">Loading guides…</p>;

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(editing);
        }}
        className={`${cardClass} max-w-3xl space-y-3`}
      >
        <label className="block text-sm font-medium text-app-text">
          Title
          <input required value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Category
          <input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Short summary
          <textarea rows={2} value={editing.summary} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Guide text
          <span className="block font-normal text-app-text-muted">Start a line with ## for a heading, or - for a list item.</span>
          <textarea required rows={14} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <Switch
          className="min-h-10"
          checked={editing.published}
          onChange={(published) => setEditing({ ...editing, published })}
          label={<span className="text-sm font-medium">Published on the website</span>}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryClass}><Save size={16} /> Save</button>
          <button type="button" onClick={() => setEditing(null)} className={secondaryClass}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEditing({ id: null, slug: '', title: '', summary: '', body: '', category: 'Milk care', published: false })}
          className={primaryClass}
        >
          <Plus size={16} /> New guide
        </button>
        <button onClick={addStarters} disabled={busy} className={secondaryClass}>
          <BookOpen size={16} /> Add starter guides as drafts
        </button>
      </div>
      {guides.length === 0 && (
        <p className="py-8 text-center text-sm text-app-text-muted">No guides yet. Add the starter guides, check them, then publish.</p>
      )}
      <ul className="grid gap-3 lg:grid-cols-2">
        {guides.map((guide) => (
          <li key={guide.id} className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-app-text">{guide.title}</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${guide.published ? 'bg-emerald-500/10 text-emerald-600' : 'bg-app-bg text-app-text-muted'}`}>
                {guide.published ? 'Published' : 'Draft'}
              </span>
            </div>
            <p className="mt-1 text-sm text-app-text-muted">{guide.summary}</p>
            <button onClick={() => setEditing(guide)} className={`${secondaryClass} mt-3`}>Edit</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PointsSettingsCard({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const showToast = useNotificationStore((s) => s.showToast);
  // Entered as "points for KSh 1" per tier; stored as the KSh value of one point.
  const [perKsh, setPerKsh] = useState({ bronze: '50', silver: '100', gold: '200' });
  const [minRedeem, setMinRedeem] = useState('100');

  useEffect(() => {
    fetchPointSettings(businessId).then((s) => {
      setPerKsh({ bronze: String(pointsPerShilling(s.bronze)), silver: String(pointsPerShilling(s.silver)), gold: String(pointsPerShilling(s.gold)) });
      setMinRedeem(String(s.minRedeem));
    });
  }, [businessId]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const v = (n: string) => Math.round((1 / Math.max(1, Number(n) || 1)) * 10000) / 10000;
    try {
      const { error } = await getSupabase().from('loyalty_settings').upsert({
        business_id: businessId,
        value_bronze: v(perKsh.bronze),
        value_silver: v(perKsh.silver),
        value_gold: v(perKsh.gold),
        // Older app versions read this single value.
        point_value: Math.max(0.01, Math.round(v(perKsh.silver) * 100) / 100),
        min_redeem_points: Number(minRedeem),
      });
      if (error) throw error;
      showToast('Points Saved', 'Your points settings are saved.', undefined, 'success');
    } catch (err) {
      reportError(err, 'Could not save points settings.');
    }
  };

  const row = (tier: 'bronze' | 'silver' | 'gold', label: string) => {
    const n = Number(perKsh[tier]) || 0;
    return (
      <label className="block text-sm font-medium text-app-text">
        {label}: points for Ksh 1
        <input required type="number" min="1" step="1" value={perKsh[tier]} onChange={(e) => setPerKsh((p) => ({ ...p, [tier]: e.target.value }))} className={inputClass} />
        <span className="block mt-1 text-xs font-normal text-app-text-muted">{n > 0 ? `${Math.round((2 / n) * 1000) / 10}% back on what they pay` : ''}</span>
      </label>
    );
  };

  return (
    <form onSubmit={handleSave} className={`${cardClass} space-y-3`}>
      <div>
        <h3 className="text-sm font-semibold text-app-text">Loyalty points</h3>
        <p className="text-xs text-app-text-muted">
          Customers earn 2 points for every Ksh 1 they pay for. Credit sales earn when paid: 1 point for every Ksh 1 paid towards the debt.
          Points are worth less in higher tiers, so small customers feel the reward and big spenders cost less. Points are not cash: they come off a purchase or pay off debt.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {row('bronze', 'Bronze')}
        {row('silver', 'Silver')}
        {row('gold', 'Gold')}
      </div>
      <label className="block text-sm font-medium text-app-text">
        Fewest points that can be used
        <input required type="number" min="1" value={minRedeem} onChange={(e) => setMinRedeem(e.target.value)} className={inputClass} />
      </label>
      <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950">Save</button>
    </form>
  );
}

function SettingsTab({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const showToast = useNotificationStore((s) => s.showToast);
  const [slug, setSlug] = useState('');
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [minOrder, setMinOrder] = useState('0');
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const [products, setProducts] = useState<{ id: string; name: string; price: number; show_on_website: boolean }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [business, settings, productRows] = await Promise.all([
      supabase.from('businesses').select('website_slug').eq('id', businessId).single(),
      supabase.from('website_settings').select('*').eq('business_id', businessId).maybeSingle(),
      supabase.from('products').select('id, name, price, show_on_website').eq('business_id', businessId).is('deleted_at', null).order('name'),
    ]);
    if (business.error) throw business.error;
    if (settings.error) throw settings.error;
    if (productRows.error) throw productRows.error;
    setSlug(business.data.website_slug ?? '');
    if (settings.data) {
      setDeliveryEnabled(settings.data.delivery_enabled);
      setDeliveryFee(String(settings.data.delivery_fee));
      setMinOrder(String(settings.data.min_order));
      setAssistantEnabled(settings.data.assistant_enabled);
    }
    setProducts(productRows.data as typeof products);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => reportError(err, 'Could not load website settings.'));
  }, [load, reportError]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const supabase = getSupabase();
      const cleanSlug = slugify(slug);
      const { error: slugError } = await supabase
        .from('businesses')
        .update({ website_slug: cleanSlug || null })
        .eq('id', businessId);
      if (slugError) throw slugError;
      const { error } = await supabase.from('website_settings').upsert({
        business_id: businessId,
        delivery_enabled: deliveryEnabled,
        delivery_fee: Number(deliveryFee) || 0,
        min_order: Number(minOrder) || 0,
        assistant_enabled: assistantEnabled,
      });
      if (error) throw error;
      setSlug(cleanSlug);
      showToast('Online Store', 'Website settings saved.', undefined, 'success');
    } catch (err) {
      reportError(err, 'Could not save website settings.');
    } finally {
      setSaving(false);
    }
  };

  const toggleProduct = async (id: string, show: boolean) => {
    setProducts((rows) => rows.map((p) => (p.id === id ? { ...p, show_on_website: show } : p)));
    const { error } = await getSupabase().from('products').update({ show_on_website: show }).eq('id', id);
    if (error) {
      reportError(error, 'Could not update the product.');
      load().catch(() => undefined);
    }
  };

  if (!loaded) return <p className="text-sm text-app-text-muted">Loading settings…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <DeliveryZonesEditor businessId={businessId} />
      <PointsSettingsCard businessId={businessId} />
      <form onSubmit={save} className={`${cardClass} space-y-3`}>
        <h3 className="flex items-center gap-2 font-bold text-app-text"><Settings size={16} /> Website</h3>
        <label className="block text-sm font-medium text-app-text">
          Website name
          <span className="block font-normal text-app-text-muted">Your website stays hidden while this is empty. It must match the name the website was built with.</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="kaykays" className={`${inputClass} mt-1`} />
        </label>
        <Switch
          className="min-h-10"
          checked={deliveryEnabled}
          onChange={setDeliveryEnabled}
          label={<span className="text-sm font-medium">Offer delivery</span>}
        />
        <label className="block text-sm font-medium text-app-text">
          Delivery fee (Ksh)
          <input type="number" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Minimum order (Ksh)
          <input type="number" min="0" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <Switch
          className="min-h-10"
          checked={assistantEnabled}
          onChange={setAssistantEnabled}
          label={<span className="text-sm font-medium">Show the AI assistant</span>}
        />
        <button type="submit" disabled={saving} className={primaryClass}><Save size={16} /> {saving ? 'Saving…' : 'Save'}</button>
      </form>

      <section className={cardClass}>
        <h3 className="flex items-center gap-2 font-bold text-app-text"><ExternalLink size={16} /> Products on the website</h3>
        <p className="mt-1 text-sm text-app-text-muted">Products priced at 0 are never shown.</p>
        <ul className="mt-3 divide-y divide-app-border">
          {products.map((product) => (
            <li key={product.id}>
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-app-text">
                <span className="min-w-0 truncate">{product.name}</span>
                <Switch
                  ariaLabel={`Show ${product.name} on the website`}
                  checked={product.show_on_website}
                  onChange={(on) => toggleProduct(product.id, on)}
                />
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface WebsiteReview {
  id: string;
  product_id: string | null;
  rating: number;
  title: string | null;
  body: string;
  display_name: string;
  verified: boolean;
  status: 'pending' | 'approved' | 'hidden';
  featured: boolean;
  staff_reply: string | null;
  created_at: string;
  products: { name: string } | null;
}

/** Customer reviews wait here until staff approve them. Only approved reviews show on the website. */
function ReviewsTab({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const showToast = useNotificationStore((s) => s.showToast);
  const staffName = useAuthStore((s) => s.currentEmployee?.name ?? 'Staff');
  const [filter, setFilter] = useState<WebsiteReview['status']>('pending');
  const [items, setItems] = useState<WebsiteReview[] | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('website_reviews')
      .select('id, product_id, rating, title, body, display_name, verified, status, featured, staff_reply, created_at, products(name)')
      .eq('business_id', businessId)
      .eq('status', filter)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    setItems(data as unknown as WebsiteReview[]);
  }, [businessId, filter]);

  useEffect(() => {
    setItems(null);
    load().catch((err) => reportError(err, 'Could not load reviews. Has the reviews database update been applied?'));
  }, [load, reportError]);

  const update = async (id: string, fields: Partial<WebsiteReview> & { replied_by?: string; replied_at?: string }, done: string) => {
    const { error } = await getSupabase().from('website_reviews').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      reportError(error, 'Could not update the review.');
      return;
    }
    showToast('Reviews', done, undefined, 'success');
    load().catch(() => undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['pending', 'approved', 'hidden'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold ${filter === status ? 'bg-brand-500 text-slate-950' : 'border border-app-border text-app-text'}`}
          >
            {status === 'pending' ? 'Waiting for approval' : status === 'approved' ? 'On the website' : 'Hidden'}
          </button>
        ))}
      </div>
      {!items ? (
        <p className="text-sm text-app-text-muted">Loading reviews…</p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-app-text-muted">
          {filter === 'pending' ? 'No reviews waiting. New reviews from the website appear here.' : 'No reviews here.'}
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className={cardClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-app-text">
                  {item.display_name}
                  {item.verified && <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600">Verified buyer</span>}
                </span>
                <span className="text-xs text-app-text-muted">{item.products?.name ?? 'Shop review'} · {formatWhen(item.created_at)}</span>
              </div>
              <p className="mt-1 flex" aria-label={`${item.rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={15} className={n <= item.rating ? 'fill-amber-500 text-amber-500' : 'text-app-border'} />
                ))}
              </p>
              {item.title && <p className="mt-2 font-semibold text-app-text">{item.title}</p>}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-app-text">{item.body}</p>
              <label className="mt-3 block text-xs font-medium text-app-text-muted">
                Public reply (optional)
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={replies[item.id] ?? item.staff_reply ?? ''}
                  onChange={(e) => setReplies({ ...replies, [item.id]: e.target.value })}
                  placeholder="Thank the customer, or explain what you will do"
                  className={`${inputClass} mt-1`}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.status !== 'approved' && (
                  <button className={primaryClass} onClick={() => update(item.id, { status: 'approved' }, 'Review approved. It shows on the website now.')}>
                    <CheckCircle2 size={16} /> Approve
                  </button>
                )}
                {item.status !== 'hidden' && (
                  <button className={secondaryClass} onClick={() => update(item.id, { status: 'hidden', featured: false }, 'Review hidden.')}>Hide</button>
                )}
                {item.status === 'approved' && (
                  <button className={secondaryClass} onClick={() => update(item.id, { featured: !item.featured }, item.featured ? 'No longer featured.' : 'Featured on the home page.')}>
                    <Star size={16} /> {item.featured ? 'Unfeature' : 'Feature on home page'}
                  </button>
                )}
                {replies[item.id] !== undefined && replies[item.id] !== (item.staff_reply ?? '') && (
                  <button
                    className={secondaryClass}
                    onClick={() => update(item.id, {
                      staff_reply: replies[item.id].trim() || null,
                      replied_by: staffName,
                      replied_at: new Date().toISOString(),
                    }, 'Reply saved.')}
                  >
                    <Send size={16} /> Save reply
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  kind: 'percent' | 'amount';
  value: number;
  min_order: number;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  once_per_customer: boolean;
  show_on_website: boolean;
  active: boolean;
}

const EMPTY_PROMO = {
  code: '', description: '', kind: 'percent' as PromoCode['kind'], value: '10', min_order: '0',
  ends_at: '', max_uses: '', once_per_customer: true, show_on_website: false,
};

/** Promo codes customers type at checkout. The server applies them, so the website can't be talked into a bigger discount. */
function PromotionsTab({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const showToast = useNotificationStore((s) => s.showToast);
  const staffName = useAuthStore((s) => s.currentEmployee?.name ?? 'Staff');
  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [uses, setUses] = useState<Record<string, number>>({});
  const [form, setForm] = useState(EMPTY_PROMO);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [list, orders] = await Promise.all([
      supabase.from('website_promo_codes').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
      supabase.from('online_orders').select('promo_code_id').eq('business_id', businessId).not('promo_code_id', 'is', null).neq('status', 'cancelled').limit(5000),
    ]);
    if (list.error) throw list.error;
    setCodes(list.data as PromoCode[]);
    const counts: Record<string, number> = {};
    for (const row of (orders.data ?? []) as { promo_code_id: string }[]) counts[row.promo_code_id] = (counts[row.promo_code_id] ?? 0) + 1;
    setUses(counts);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => reportError(err, 'Could not load promo codes. Has the promotions database update been applied?'));
  }, [load, reportError]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await getSupabase().from('website_promo_codes').insert({
        business_id: businessId,
        code: form.code.trim().toUpperCase().replace(/\s+/g, ''),
        description: form.description.trim() || null,
        kind: form.kind,
        value: Number(form.value),
        min_order: Number(form.min_order) || 0,
        ends_at: form.ends_at ? new Date(`${form.ends_at}T23:59:59`).toISOString() : null,
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        once_per_customer: form.once_per_customer,
        show_on_website: form.show_on_website,
        created_by: staffName,
      });
      if (error) throw error;
      setForm(EMPTY_PROMO);
      showToast('Promotions', 'Promo code created.', undefined, 'success');
      await load();
    } catch (err) {
      reportError(err, 'Could not create the code. Codes are 3 to 24 letters, numbers or dashes, must be new, and percent codes go up to 90%.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (promo: PromoCode, field: 'active' | 'show_on_website') => {
    const { error } = await getSupabase().from('website_promo_codes').update({ [field]: !promo[field], updated_at: new Date().toISOString() }).eq('id', promo.id);
    if (error) reportError(error, 'Could not update the code.');
    else load().catch(() => undefined);
  };

  const set = (changes: Partial<typeof EMPTY_PROMO>) => setForm({ ...form, ...changes });
  const expired = (promo: PromoCode) => Boolean(promo.ends_at && new Date(promo.ends_at) < new Date());

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <form onSubmit={create} className={`${cardClass} space-y-3`}>
        <h3 className="flex items-center gap-2 font-bold text-app-text"><Plus size={16} /> New promo code</h3>
        <label className="block text-sm font-medium text-app-text">
          Code
          <input required value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="FRESH10" maxLength={24} className={`${inputClass} mt-1 font-mono uppercase`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Description customers see
          <input value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={200} placeholder="10% off your first online order" className={`${inputClass} mt-1`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-app-text">
            Type
            <select value={form.kind} onChange={(e) => set({ kind: e.target.value as PromoCode['kind'] })} className={`${inputClass} mt-1`}>
              <option value="percent">Percent off</option>
              <option value="amount">Ksh off</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-app-text">
            {form.kind === 'percent' ? 'Percent' : 'Amount (Ksh)'}
            <input required type="number" min="1" max={form.kind === 'percent' ? 90 : undefined} value={form.value} onChange={(e) => set({ value: e.target.value })} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-sm font-medium text-app-text">
            Minimum order (Ksh)
            <input type="number" min="0" value={form.min_order} onChange={(e) => set({ min_order: e.target.value })} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-sm font-medium text-app-text">
            Total uses
            <input type="number" min="1" value={form.max_uses} onChange={(e) => set({ max_uses: e.target.value })} placeholder="No limit" className={`${inputClass} mt-1`} />
          </label>
        </div>
        <label className="block text-sm font-medium text-app-text">
          Last day
          <input type="date" value={form.ends_at} onChange={(e) => set({ ends_at: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <Switch className="min-h-10" checked={form.once_per_customer} onChange={(on) => set({ once_per_customer: on })} label={<span className="text-sm font-medium">Once per customer</span>} />
        <Switch className="min-h-10" checked={form.show_on_website} onChange={(on) => set({ show_on_website: on })} label={<span className="text-sm font-medium">Advertise on the website home page</span>} />
        <p className="text-xs text-app-text-muted">The saving comes off products only, never delivery. A cancelled order gives its use back.</p>
        <button type="submit" disabled={saving} className={primaryClass}><Save size={16} /> {saving ? 'Saving…' : 'Create code'}</button>
      </form>

      <section className={cardClass}>
        <h3 className="font-bold text-app-text">Promo codes</h3>
        {!codes ? (
          <p className="mt-2 text-sm text-app-text-muted">Loading…</p>
        ) : codes.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-muted">No promo codes yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-app-border">
            {codes.map((promo) => (
              <li key={promo.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${!promo.active || expired(promo) ? 'opacity-60' : ''}`}>
                <div className="min-w-0">
                  <p className="font-mono font-bold text-app-text">{promo.code}</p>
                  <p className="text-sm text-app-text">
                    {promo.kind === 'percent' ? `${Number(promo.value)}% off` : `Ksh ${Number(promo.value).toLocaleString('en-KE')} off`}
                    {Number(promo.min_order) > 0 && ` · orders over Ksh ${Number(promo.min_order).toLocaleString('en-KE')}`}
                  </p>
                  <p className="text-xs text-app-text-muted">
                    Used {uses[promo.id] ?? 0}{promo.max_uses ? ` of ${promo.max_uses}` : ''} times
                    {promo.once_per_customer && ' · once per customer'}
                    {promo.ends_at && ` · ${expired(promo) ? 'ended' : 'ends'} ${new Date(promo.ends_at).toLocaleDateString('en-KE')}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Switch checked={promo.show_on_website} onChange={() => toggle(promo, 'show_on_website')} label={<span className="text-xs">On website</span>} />
                  <Switch checked={promo.active} onChange={() => toggle(promo, 'active')} label={<span className="text-xs">Active</span>} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The website's info and policy pages. An empty page shows the standard text, which the
 * website builds from live settings (delivery areas, minimum order, points rule), so it
 * stays correct as those change. Written text replaces it and does not update by itself.
 */
function PagesTab({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const showToast = useNotificationStore((s) => s.showToast);
  const [pages, setPages] = useState<Record<string, string>>({});
  const [openingHours, setOpeningHours] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [storefront, setStorefront] = useState<Storefront | null>(null);
  const [selected, setSelected] = useState<InfoPageId>('about');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [settings, business] = await Promise.all([
      supabase.from('website_settings').select('pages, opening_hours, whatsapp').eq('business_id', businessId).maybeSingle(),
      supabase.from('businesses').select('website_slug').eq('id', businessId).single(),
    ]);
    if (settings.error) throw settings.error;
    if (business.error) throw business.error;
    setPages((settings.data?.pages as Record<string, string>) ?? {});
    setOpeningHours(settings.data?.opening_hours ?? '');
    setWhatsapp(settings.data?.whatsapp ?? '');
    if (business.data.website_slug) {
      const { data } = await supabase.rpc('get_public_storefront', { p_slug: business.data.website_slug });
      setStorefront((data as Storefront | null) ?? null);
    }
    setLoaded(true);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => reportError(err, 'Could not load the website pages.'));
  }, [load, reportError]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleaned = Object.fromEntries(Object.entries(pages).filter(([, text]) => text.trim()));
      const { error } = await getSupabase().from('website_settings').upsert({
        business_id: businessId,
        pages: cleaned,
        opening_hours: openingHours.trim() || null,
        whatsapp: whatsapp.trim() || null,
      });
      if (error) throw error;
      setPages(cleaned);
      showToast('Online Store', 'Website pages saved. Customers see them straight away.', undefined, 'success');
    } catch (err) {
      reportError(err, 'Could not save the website pages. Check the WhatsApp number uses digits only.');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <p className="text-sm text-app-text-muted">Loading pages…</p>;

  const page = INFO_PAGES.find((p) => p.id === selected)!;
  const text = pages[selected] ?? '';
  const standard = storefront ? defaultInfoPageText(selected, storefront) : '';

  return (
    <form onSubmit={save} className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4">
        <section className={`${cardClass} space-y-3`}>
          <h3 className="font-bold text-app-text">Shop details</h3>
          <label className="block text-sm font-medium text-app-text">
            Opening hours
            <span className="block font-normal text-app-text-muted">Shown in the footer, contact and help pages.</span>
            <input value={openingHours} maxLength={500} onChange={(e) => setOpeningHours(e.target.value)} placeholder="Mon to Sat 7am to 8pm, Sun 8am to 1pm" className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-sm font-medium text-app-text">
            WhatsApp number
            <span className="block font-normal text-app-text-muted">Empty uses the business phone.</span>
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="254712345678" inputMode="tel" className={`${inputClass} mt-1`} />
          </label>
        </section>
        <nav className={`${cardClass} p-2`} aria-label="Website pages">
          {INFO_PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p.id)}
              className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium ${selected === p.id ? 'bg-brand-500/15 text-app-text' : 'text-app-text-muted hover:bg-app-bg'}`}
            >
              {p.label}
              <span className="text-xs">{pages[p.id]?.trim() ? 'Custom' : 'Standard'}</span>
            </button>
          ))}
        </nav>
      </div>

      <section className={`${cardClass} space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-app-text">{page.title}</h3>
            <p className="text-sm text-app-text-muted">
              Website address: {page.path}. {text.trim()
                ? 'Your text is shown. Clear it to go back to the standard text.'
                : 'The standard text is shown. It updates by itself when delivery areas, the minimum order or points change.'}
            </p>
          </div>
          {standard && (
            <button type="button" className={secondaryClass} onClick={() => setPages({ ...pages, [selected]: standard })}>
              <BookOpen size={16} /> Start from standard text
            </button>
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setPages({ ...pages, [selected]: e.target.value })}
          rows={22}
          placeholder={standard || 'Leave empty to use the standard text.'}
          className={`${inputClass} font-mono text-[13px] leading-relaxed`}
        />
        <p className="text-xs text-app-text-muted">
          Format: start a line with ## for a heading, - for a list item or 1. for a numbered step. **Bold** and [link text](/delivery) also work.
          {page.legal && ' Legal pages: have a lawyer check them before launch.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className={primaryClass}><Save size={16} /> {saving ? 'Saving…' : 'Save pages'}</button>
          {text.trim() && (
            <button type="button" className={secondaryClass} onClick={() => setPages({ ...pages, [selected]: '' })}>
              <RefreshCw size={16} /> Use standard text
            </button>
          )}
        </div>
      </section>
    </form>
  );
}

export default function OnlineStoreView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const canManageWebsite = role ? hasRolePermission(role, 'business.update') : false;
  const [tab, setTab] = useState<TabId>('orders');
  const tabs = canManageWebsite ? TABS : TABS.filter((t) => !['settings', 'guides', 'pages', 'reviews', 'promotions'].includes(t.id));

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 pb-nav">
      <header className="flex items-center gap-3">
        <Package className="text-brand-500" />
        <div>
          <h1 className="font-display text-xl font-bold text-app-text">Online Store</h1>
          <p className="text-sm text-app-text-muted">Website orders, customer messages, feedback and guides</p>
        </div>
      </header>
      <div className="mt-4 overflow-x-auto">
        <Tabs<TabId> tabs={tabs} activeTab={tab} onChange={setTab} className="w-max" />
      </div>
      <div className="mt-4">
        {!businessId ? (
          <p className="text-sm text-app-text-muted">Choose a business first.</p>
        ) : (
          <>
            {tab === 'orders' && <OrdersTab businessId={businessId} />}
            {tab === 'messages' && <MessagesTab businessId={businessId} />}
            {tab === 'feedback' && <FeedbackTab businessId={businessId} />}
            {tab === 'guides' && canManageWebsite && <GuidesTab businessId={businessId} />}
            {tab === 'pages' && canManageWebsite && <PagesTab businessId={businessId} />}
            {tab === 'reviews' && canManageWebsite && <ReviewsTab businessId={businessId} />}
            {tab === 'promotions' && canManageWebsite && <PromotionsTab businessId={businessId} />}
            {tab === 'settings' && canManageWebsite && <SettingsTab businessId={businessId} />}
          </>
        )}
      </div>
    </div>
  );
}
