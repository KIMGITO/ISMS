import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
import { Tabs } from '../components/TabOptions';
import { getSupabase } from '../services/supabaseClient';
import { useAuthStore } from '../stores/authStore';
import { useBusinessStore } from '../stores/businessStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { STARTER_GUIDES } from './onlineStoreStarterGuides';

type TabId = 'orders' | 'messages' | 'feedback' | 'guides' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'orders', label: 'Orders' },
  { id: 'messages', label: 'Messages' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'guides', label: 'Guides' },
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
                <label className="mt-2 flex items-center gap-2 text-sm text-app-text">
                  Rider
                  <select
                    value={order.rider_id ?? ''}
                    disabled={!canAssignRider || busyId === order.id}
                    onChange={(e) =>
                      runAction(order.id, () =>
                        getSupabase().rpc('staff_assign_rider', { p_order_id: order.id, p_rider_id: e.target.value || null }),
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">Not assigned</option>
                    {riders.map((rider) => <option key={rider.id} value={rider.id}>{rider.name}</option>)}
                  </select>
                </label>
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
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-app-text">
          <input type="checkbox" checked={editing.published} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} />
          Published on the website
        </label>
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

interface DeliveryZoneRow {
  id: string;
  name: string;
  fee: number;
}

function DeliveryZonesCard({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const [zones, setZones] = useState<DeliveryZoneRow[]>([]);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from('delivery_zones')
      .select('id, name, fee')
      .eq('business_id', businessId)
      .order('name');
    if (error) throw error;
    setZones(data as DeliveryZoneRow[]);
  }, [businessId]);

  useEffect(() => {
    load().catch((err) => reportError(err, 'Could not load delivery areas.'));
  }, [load, reportError]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await getSupabase()
        .from('delivery_zones')
        .insert({ business_id: businessId, name: name.trim(), fee: Number(fee) || 0 });
      if (error) throw error;
      setName('');
      setFee('');
      await load();
    } catch (err) {
      reportError(err, 'Could not add this delivery area.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await getSupabase().from('delivery_zones').delete().eq('id', id);
      if (error) throw error;
      await load();
    } catch (err) {
      reportError(err, 'Could not delete this delivery area.');
    }
  };

  return (
    <div className={`${cardClass} space-y-3`}>
      <div>
        <h3 className="text-sm font-semibold text-app-text">Delivery areas (optional)</h3>
        <p className="text-xs text-app-text-muted">
          With no areas, every delivery uses the delivery fee. Once you add one, customers must choose an area
          and pay its price. Past orders keep the price they were charged.
        </p>
      </div>
      {zones.length > 0 && (
        <ul className="divide-y divide-app-border">
          {zones.map((zone) => (
            <li key={zone.id} className="flex items-center justify-between gap-3 py-2 text-sm text-app-text">
              <span className="min-w-0 truncate">{zone.name}: Ksh {zone.fee}</span>
              <button type="button" onClick={() => handleDelete(zone.id)} className="text-xs font-medium text-red-500">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Area name" aria-label="Area name" className={inputClass} />
        <input required type="number" min="0" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="Price (Ksh)" aria-label="Price in Ksh" className={inputClass} />
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950">Add</button>
      </form>
    </div>
  );
}

function PointsSettingsCard({ businessId }: { businessId: string }) {
  const reportError = useReportError();
  const showToast = useNotificationStore((s) => s.showToast);
  const [pointValue, setPointValue] = useState('1');
  const [minRedeem, setMinRedeem] = useState('100');

  useEffect(() => {
    getSupabase()
      .from('loyalty_settings')
      .select('point_value, min_redeem_points')
      .eq('business_id', businessId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) reportError(error, 'Could not load points settings.');
        if (data) {
          setPointValue(String(data.point_value));
          setMinRedeem(String(data.min_redeem_points));
        }
      });
  }, [businessId, reportError]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await getSupabase().from('loyalty_settings').upsert({
        business_id: businessId,
        point_value: Number(pointValue),
        min_redeem_points: Number(minRedeem),
      });
      if (error) throw error;
      showToast('Points Saved', 'Your points settings are saved.', undefined, 'success');
    } catch (err) {
      reportError(err, 'Could not save points settings.');
    }
  };

  return (
    <form onSubmit={handleSave} className={`${cardClass} space-y-3`}>
      <div>
        <h3 className="text-sm font-semibold text-app-text">Loyalty points</h3>
        <p className="text-xs text-app-text-muted">Customers earn 1 point for every Ksh 100 they spend.</p>
      </div>
      <label className="block text-sm font-medium text-app-text">
        Value of one point (Ksh)
        <input required type="number" min="0.01" step="0.01" value={pointValue} onChange={(e) => setPointValue(e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium text-app-text">
        Fewest points that can be redeemed
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
      <DeliveryZonesCard businessId={businessId} />
      <PointsSettingsCard businessId={businessId} />
      <form onSubmit={save} className={`${cardClass} space-y-3`}>
        <h3 className="flex items-center gap-2 font-bold text-app-text"><Settings size={16} /> Website</h3>
        <label className="block text-sm font-medium text-app-text">
          Website name
          <span className="block font-normal text-app-text-muted">Your website stays hidden while this is empty. It must match the name the website was built with.</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="kaykays" className={`${inputClass} mt-1`} />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-app-text">
          <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} /> Offer delivery
        </label>
        <label className="block text-sm font-medium text-app-text">
          Delivery fee (Ksh)
          <input type="number" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-app-text">
          Minimum order (Ksh)
          <input type="number" min="0" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-app-text">
          <input type="checkbox" checked={assistantEnabled} onChange={(e) => setAssistantEnabled(e.target.checked)} /> Show the AI assistant
        </label>
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
                <input
                  type="checkbox"
                  aria-label={`Show ${product.name} on the website`}
                  checked={product.show_on_website}
                  onChange={(e) => toggleProduct(product.id, e.target.checked)}
                />
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function OnlineStoreView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const role = useAuthStore((s) => s.currentEmployee?.role);
  const canManageWebsite = role ? hasRolePermission(role, 'business.update') : false;
  const [tab, setTab] = useState<TabId>('orders');
  const tabs = canManageWebsite ? TABS : TABS.filter((t) => t.id !== 'settings' && t.id !== 'guides');

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
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
            {tab === 'settings' && canManageWebsite && <SettingsTab businessId={businessId} />}
          </>
        )}
      </div>
    </div>
  );
}
