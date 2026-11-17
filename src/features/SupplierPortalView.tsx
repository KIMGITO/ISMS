// src/features/SupplierPortalView.tsx
// What someone at a supplier sees when they sign in: the orders placed with them, price
// requests to answer, what was received, their statement and their own details. It is its own
// small app (no staff navigation). Everything comes from supplier_portal_* functions, which
// check their supplier account and what the business shares (Roles → Supplier).
// Stock requests ring on their phone (RingingAlerts below); Accept opens Requests.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing, CalendarCheck, CheckCircle2, ClipboardList, FileText, HelpCircle, LogOut, Moon, PackageCheck, RefreshCw, Search, Sun, Tag, Wallet, X,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { GroupedTabs, type TabGroup } from '../components/TabOptions';
import SearchableDropdown from '../components/SearchableDropdown';
import { Checkbox } from '../components/shared/Checkbox';
import { dangerBtn, Field, fieldClass, primaryBtn, secondaryBtn } from '../components/shared/FormSheet';
import { formatCurrency } from '../utils/helpers';
import { displayName, searchMatch } from '../utils/stringUtils';
import { toUserMessage } from '../utils/userError';
import RingingAlerts from '../components/RingingAlerts';
import {
  answerStockRequest, confirmOrder, loadPortalData, loadPortalStockRequests, loadSupplierAccounts, sendPrices, updateMyDetails,
  type PortalData, type PortalOrder, type PortalPriceRequest, type PortalStockRequest, type SupplierAccount,
} from '../services/supplierPortal';
import { NumberInput } from '../components/shared/Input';

type Tab = 'requests' | 'orders' | 'deliveries' | 'stock' | 'prices' | 'statement' | 'details';

const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const todayIso = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const qty = (n: number) => String(Math.round(n * 1000) / 1000);
const GUIDE_KEY = 'kkm_supplier_guide_seen_v1';

function Pill({ tone, children }: { tone: 'amber' | 'green' | 'red' | 'grey' | 'blue'; children: React.ReactNode }) {
  const cls = {
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    red: 'bg-red-500/15 text-red-700 dark:text-red-300',
    grey: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
    blue: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  }[tone];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`bg-app-card rounded-2xl ring-1 ring-app-border/70 p-4 min-w-0 ${className}`}>{children}</section>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-app-text-muted text-center py-10 px-4">{children}</p>;
}

export default function SupplierPortalView({ themeMode, onToggleTheme }: { themeMode: 'light' | 'dark'; onToggleTheme: () => void }) {
  const accountsInStore = useAuthStore((s) => s.supplierAccounts);
  const user = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const [accounts, setAccounts] = useState<SupplierAccount[]>(accountsInStore);
  const [accountId, setAccountId] = useState(accountsInStore[0]?.accountId ?? '');
  const account = accounts.find((a) => a.accountId === accountId) ?? accounts[0];

  const [data, setData] = useState<PortalData | null>(null);
  const [requests, setRequests] = useState<PortalStockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showGuide, setShowGuide] = useState(() => { try { return !localStorage.getItem(GUIDE_KEY); } catch { return true; } });
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const [list, d, reqs] = await Promise.all([
        loadSupplierAccounts(),
        loadPortalData(account.businessId),
        account.can.stockRequests ? loadPortalStockRequests(account.businessId).catch(() => null) : Promise.resolve([]),
      ]);
      setAccounts(list.length ? list : accounts);
      setData(d);
      if (reqs) setRequests(reqs);
    } catch (e) {
      setError(toUserMessage(e, 'Could not load. Check your connection.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.businessId]);
  useEffect(() => { void load(); }, [load]);

  const can = account?.can;
  const groups: TabGroup<Tab>[] = [
    { id: 'orders', label: 'Orders', tabs: [
      ...(can?.stockRequests ? [{ id: 'requests' as Tab, label: 'Requests', icon: <BellRing size={13} />, badge: requests.filter((r) => r.status === 'sent' || r.status === 'seen').length }] : []),
      ...(can?.orders ? [{ id: 'orders' as Tab, label: 'Orders', icon: <ClipboardList size={13} />, badge: data?.orders.filter((o) => !o.confirmedAt && (o.status === 'Ordered' || o.status === 'Part received')).length || 0 }] : []),
      ...(can?.deliveries ? [{ id: 'deliveries' as Tab, label: 'Received', icon: <PackageCheck size={13} /> }] : []),
      ...(can?.stock ? [{ id: 'stock' as Tab, label: 'Their stock', icon: <Tag size={13} /> }] : []),
    ] },
    { id: 'prices', label: 'Prices', tabs: can?.priceRequests ? [{ id: 'prices', label: 'Price requests', badge: data?.priceRequests.filter((q) => q.open && q.status === 'asked').length || 0 }] : [] },
    { id: 'account', label: 'Account', tabs: [
      ...(can?.statement ? [{ id: 'statement' as Tab, label: 'Statement', icon: <Wallet size={13} /> }] : []),
      { id: 'details' as Tab, label: 'My details', icon: <FileText size={13} /> },
    ] },
  ];
  const allTabs = groups.flatMap((g) => g.tabs.map((t) => t.id));
  const [tab, setTab] = useState<Tab>('orders');
  useEffect(() => { if (!allTabs.includes(tab)) setTab(allTabs[0] ?? 'details'); }, [allTabs.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opening the app with a request waiting goes straight to it (once per business).
  const jumped = useRef('');
  useEffect(() => {
    if (!account || jumped.current === account.businessId) return;
    if (requests.some((r) => r.status === 'sent' || r.status === 'seen')) { jumped.current = account.businessId; setTab('requests'); }
  }, [requests, account?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys: / search, [ and ] change part, R refresh, ? the guide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === '[' || e.key === ']') {
        const i = allTabs.indexOf(tab);
        const next = allTabs[(i + (e.key === ']' ? 1 : allTabs.length - 1)) % allTabs.length];
        if (next) setTab(next);
      } else if (e.key === 'r' || e.key === 'R') void load();
      else if (e.key === '?') setShowGuide(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allTabs, tab, load]);

  const match = (parts: (string | null | undefined)[]) => !query.trim() || searchMatch(parts.filter(Boolean).join(' '), query.trim());

  if (!account) {
    return (
      <div className="min-h-dvh grid place-items-center bg-app-bg p-6 text-center">
        <div className="space-y-3 max-w-sm">
          <p className="text-sm text-app-text">Your supplier access was removed. Ask the business to invite you again.</p>
          <button className={secondaryBtn} onClick={() => void logout()}><LogOut size={15} /> Sign out</button>
        </div>
      </div>
    );
  }

  const openOrders = data?.orders.filter((o) => o.status === 'Ordered' || o.status === 'Part received') ?? [];
  const waitingPrices = data?.priceRequests.filter((q) => q.open && q.status === 'asked') ?? [];
  const openRequests = requests.filter((r) => r.status === 'sent' || r.status === 'seen');

  return (
    <div className="min-h-dvh bg-app-bg text-app-text flex flex-col">
      <RingingAlerts businessId={account.businessId} onOpen={() => { setTab('requests'); void load(); }} />
      {/* Top bar */}
      <header className="sticky z-20 bg-app-card/95 backdrop-blur border-b border-app-border px-4 py-2.5" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          {account.businessLogo
            ? <img src={account.businessLogo} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
            : <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 grid place-items-center font-bold shrink-0">{account.businessName.slice(0, 1)}</div>}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{account.businessName}</p>
            <p className="text-[11px] text-app-text-muted truncate">Supplier: {account.supplierName}{user?.name ? ` · ${user.name}` : ''}</p>
          </div>
          <button onClick={() => setShowGuide(true)} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer" aria-label="How this works" title="How this works (?)"><HelpCircle size={18} /></button>
          <button onClick={onToggleTheme} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer" aria-label="Light or dark">{themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button onClick={() => void logout()} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer" aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-3 space-y-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
        {accounts.length > 1 && (
          <SearchableDropdown
            items={accounts.map((a) => ({ id: a.accountId, label: a.businessName, sublabel: `as ${a.supplierName}` }))}
            selectedValue={account.accountId}
            onChange={(id) => { setAccountId(id); setData(null); }}
            placeholder="Choose a business"
          />
        )}

        {showGuide && (
          <Card className="!bg-amber-500/10 !ring-amber-500/30">
            <div className="flex items-start gap-2">
              <HelpCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 text-sm space-y-1.5">
                <p className="font-semibold">How this works</p>
                <ul className="list-disc pl-4 space-y-1 text-[13px]">
                  {can?.stockRequests && <li><b>Requests</b>: when {account.businessName} runs low, they ask you here and your phone rings. <b>Accept</b> with the day you will deliver, or <b>Decline</b> and say why.</li>}
                  {can?.orders && <li><b>Orders</b>: what {account.businessName} ordered from you. Tap <b>Confirm</b> and pick the day you will deliver.</li>}
                  {can?.priceRequests && <li><b>Prices</b>: requests for your prices. Type a price for each item (untick what you can't supply) and send.</li>}
                  {can?.deliveries && <li><b>Received</b>: what arrived at their shop, and anything damaged.</li>}
                  {can?.statement && <li><b>Statement</b>: your bills, what they paid and what they still owe you.</li>}
                  <li><b>My details</b>: your phone, email, KRA PIN and how you want to be paid.</li>
                </ul>
                <p className="text-[12px] text-app-text-muted">You only see your own business with them. Keys: <b>/</b> search, <b>[</b> <b>]</b> change part, <b>R</b> refresh, <b>?</b> this help.</p>
              </div>
              <button onClick={() => { setShowGuide(false); try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* fine */ } }} aria-label="Close" className="p-1 rounded-lg text-app-text-muted hover:bg-app-bg cursor-pointer"><X size={16} /></button>
            </div>
          </Card>
        )}

        {/* At a glance */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Requests to answer', value: String(openRequests.length), go: 'requests' as Tab, on: can?.stockRequests },
            { label: 'Orders to confirm', value: String(openOrders.filter((o) => !o.confirmedAt).length), go: 'orders' as Tab, on: can?.orders },
            { label: 'Prices to send', value: String(waitingPrices.length), go: 'prices' as Tab, on: can?.priceRequests },
            { label: 'Owed to you', value: data ? formatCurrency(data.owed) : '…', go: 'statement' as Tab, on: can?.statement },
          ].filter((t) => t.on).slice(0, 3).map((t) => (
            <button key={t.label} onClick={() => setTab(t.go)} className="bg-app-card rounded-2xl ring-1 ring-app-border/70 p-3 text-left cursor-pointer min-w-0">
              <span className="block text-[11px] text-app-text-muted leading-tight">{t.label}</span>
              <span className="block text-base font-semibold tabular-nums mt-0.5 break-words">{t.value}</span>
            </button>
          ))}
        </div>

        <GroupedTabs<Tab> groups={groups} activeTab={tab} onChange={setTab} />

        {tab !== 'details' && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
              <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by number or item" className={`${fieldClass} pl-9 bg-app-card`} />
            </div>
            <button onClick={() => void load()} className="p-2.5 rounded-xl text-app-text-muted hover:bg-app-card cursor-pointer" aria-label="Refresh" title="Refresh (R)">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {error && (
          <Card><p className="text-sm text-red-600 dark:text-red-400">{error} <button className="underline cursor-pointer" onClick={() => void load()}>Try again</button></p></Card>
        )}
        {!data && loading && <Empty>Loading…</Empty>}

        {data && tab === 'requests' && (
          requests.filter((r) => match([r.productName, r.note])).length === 0
            ? <Empty>No requests yet. When {account.businessName} needs stock from you, it rings on your phone and shows here.</Empty>
            : <div className="space-y-2">{requests.filter((r) => match([r.productName, r.note])).map((r) => <RequestCard key={r.id} request={r} businessName={account.businessName} onDone={load} />)}</div>
        )}

        {data && tab === 'orders' && (
          data.orders.filter((o) => match([o.number, ...o.lines.map((l) => l.name)])).length === 0
            ? <Empty>No orders yet. When {account.businessName} orders from you, it shows here.</Empty>
            : <div className="space-y-2">{data.orders.filter((o) => match([o.number, ...o.lines.map((l) => l.name)])).map((o) => <OrderCard key={o.id} order={o} onDone={load} />)}</div>
        )}

        {data && tab === 'prices' && (
          data.priceRequests.length === 0
            ? <Empty>No price requests yet.</Empty>
            : <div className="space-y-2">{data.priceRequests.filter((q) => match(q.lines.map((l) => l.name))).map((q) => <PriceCard key={q.id} request={q} onDone={load} />)}</div>
        )}

        {data && tab === 'deliveries' && (
          data.deliveries.length === 0 ? <Empty>Nothing received from you yet.</Empty> : (
            <div className="space-y-2">
              {data.deliveries.filter((r) => match([r.number, r.orderNumber, ...r.lines.map((l) => l.name)])).map((r) => (
                <Card key={r.id}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{r.number}</p>
                      <p className="text-[11px] text-app-text-muted">{day(r.receivedAt)} · order {r.orderNumber}{r.receivedBy ? ` · by ${r.receivedBy}` : ''}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatCurrency(r.value)}</span>
                  </div>
                  <ul className="mt-2 text-sm divide-y divide-app-border/60">
                    {r.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2 py-1.5">
                        <span className="min-w-0 break-words">{displayName(l.name)}</span>
                        <span className="shrink-0 tabular-nums text-right">{qty(l.received)} {l.unit}{l.damaged > 0 && <span className="block text-[11px] text-red-600 dark:text-red-400">{qty(l.damaged)} damaged</span>}</span>
                      </li>
                    ))}
                  </ul>
                  {r.note && <p className="mt-2 text-[12px] text-app-text-muted break-words">{r.note}</p>}
                </Card>
              ))}
            </div>
          )
        )}

        {data && tab === 'stock' && (
          data.stock.length === 0 ? <Empty>No products are set to come from you.</Empty> : (
            <Card>
              <ul className="divide-y divide-app-border/60 text-sm">
                {data.stock.filter((s) => match([s.name])).map((s, i) => (
                  <li key={i} className="flex justify-between gap-2 py-2">
                    <span className="min-w-0 break-words">{displayName(s.name)}</span>
                    <span className={`shrink-0 tabular-nums ${s.reorderLevel != null && s.stock <= s.reorderLevel ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>
                      {qty(s.stock)} {s.unit}{s.reorderLevel != null && s.stock <= s.reorderLevel ? ' · running low' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )
        )}

        {data && tab === 'statement' && <Statement data={data} match={match} />}
        {data && tab === 'details' && <Details account={account} data={data} onDone={load} />}
      </main>
    </div>
  );
}

function requestStatus(r: PortalStockRequest) {
  switch (r.status) {
    case 'accepted': return <Pill tone="green">You accepted</Pill>;
    case 'declined': return <Pill tone="red">You declined</Pill>;
    case 'cancelled': return <Pill tone="grey">Cancelled by them</Pill>;
    default: return <Pill tone="amber">To answer</Pill>;
  }
}

function RequestCard({ request: r, businessName, onDone }: { request: PortalStockRequest; businessName: string; onDone: () => void }) {
  const open = r.status === 'sent' || r.status === 'seen';
  const [mode, setMode] = useState<'accept' | 'decline' | null>(null);
  const [date, setDate] = useState(r.deliveryDate || (r.neededBy && r.neededBy >= todayIso() ? r.neededBy : todayIso()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const answer = async () => {
    if (mode === 'decline' && !note.trim()) { setErr('Say why you can\'t, so they can find it elsewhere.'); return; }
    setBusy(true); setErr(null);
    try { await answerStockRequest(r.id, mode === 'accept', mode === 'accept' ? date : null, note); setMode(null); onDone(); }
    catch (e) { setErr(toUserMessage(e, 'Could not send your answer. Try again.')); }
    finally { setBusy(false); }
  };
  return (
    <Card className={open ? '!ring-amber-500/50' : ''}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold break-words">{qty(r.quantity)} {r.unit || ''} {displayName(r.productName)}</p>
          <p className="text-[11px] text-app-text-muted">
            Asked {day(r.askedAt)}{r.askedBy ? ` by ${r.askedBy}` : ''}{r.neededBy ? ` · needed by ${day(r.neededBy)}` : ''}
          </p>
        </div>
        {requestStatus(r)}
      </div>
      {r.note && <p className="mt-2 text-[13px] rounded-xl bg-app-bg px-3 py-2 break-words">“{r.note}”</p>}
      {r.status === 'accepted' && r.deliveryDate && <p className="mt-2 text-[12px] text-app-text-muted">You deliver {day(r.deliveryDate)}{r.responseNote ? `: ${r.responseNote}` : ''}</p>}
      {r.status === 'declined' && r.responseNote && <p className="mt-2 text-[12px] text-app-text-muted break-words">Your reason: {r.responseNote}</p>}

      {open && !mode && (
        <div className="mt-3 flex gap-2 justify-end flex-wrap">
          <button className={secondaryBtn} onClick={() => { setMode('decline'); setNote(''); setErr(null); }}><X size={15} /> Decline</button>
          <button className={primaryBtn} onClick={() => { setMode('accept'); setNote(''); setErr(null); }}><CheckCircle2 size={15} /> Accept</button>
        </div>
      )}
      {r.status === 'accepted' && !mode && (
        <div className="mt-3 flex justify-end">
          <button className={secondaryBtn} onClick={() => { setMode('accept'); setNote(r.responseNote || ''); }}><CalendarCheck size={15} /> Change day</button>
        </div>
      )}
      {mode && (
        <div className="mt-3 space-y-2 rounded-xl bg-app-bg p-3">
          {mode === 'accept' && (
            <Field label="Day you will deliver"><input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} /></Field>
          )}
          <Field label={mode === 'accept' ? 'Note (optional)' : 'Why you can\'t'}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} autoFocus={mode === 'decline'}
              placeholder={mode === 'accept' ? 'e.g. Coming at 7 am, only 150 L' : 'e.g. No milk until Friday'} className={`${fieldClass} resize-none`} />
          </Field>
          {err && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}
          <div className="flex gap-2 justify-end flex-wrap">
            <button className={secondaryBtn} onClick={() => setMode(null)}>Back</button>
            <button className={mode === 'accept' ? primaryBtn : dangerBtn}
              disabled={busy || (mode === 'accept' && !date)} onClick={() => void answer()}>
              {busy ? 'Sending…' : mode === 'accept' ? `Tell ${businessName} yes` : 'Decline'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function orderStatus(o: PortalOrder) {
  if (o.status === 'Cancelled') return <Pill tone="grey">Cancelled</Pill>;
  if (o.status === 'Received') return <Pill tone="green">Received</Pill>;
  if (o.status === 'Part received') return <Pill tone="blue">Part received</Pill>;
  return o.confirmedAt ? <Pill tone="green">Confirmed</Pill> : <Pill tone="amber">To confirm</Pill>;
}

function OrderCard({ order: o, onDone }: { order: PortalOrder; onDone: () => void }) {
  const open = o.status === 'Ordered' || o.status === 'Part received';
  const [confirming, setConfirming] = useState(false);
  const [date, setDate] = useState(o.expectedDate || todayIso());
  const [note, setNote] = useState(o.supplierNote || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await confirmOrder(o.id, date, note.trim()); setConfirming(false); onDone(); }
    catch (e) { setErr(toUserMessage(e, 'Could not confirm. Try again.')); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{o.number}</p>
          <p className="text-[11px] text-app-text-muted">Ordered {day(o.orderedAt)}{o.expectedDate ? ` · you deliver ${day(o.expectedDate)}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">{orderStatus(o)}<span className="text-sm font-semibold tabular-nums">{formatCurrency(o.total)}</span></div>
      </div>
      <ul className="mt-2 text-sm divide-y divide-app-border/60">
        {o.lines.map((l, i) => {
          const left = Math.max(0, l.quantity - l.received);
          return (
            <li key={i} className="flex justify-between gap-2 py-1.5">
              <span className="min-w-0 break-words">{displayName(l.name)}<span className="block text-[11px] text-app-text-muted">{formatCurrency(l.price)} each</span></span>
              <span className="shrink-0 tabular-nums text-right">
                {qty(l.quantity)} {l.unit}
                {(l.received > 0 || l.damaged > 0) && <span className="block text-[11px] text-app-text-muted">{qty(l.received)} came{l.damaged ? `, ${qty(l.damaged)} damaged` : ''}{open && left > 0 ? `, ${qty(left)} to come` : ''}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {o.notes && <p className="mt-2 text-[12px] text-app-text-muted break-words">Note from the business: {o.notes}</p>}
      {o.supplierNote && !confirming && <p className="mt-1 text-[12px] text-app-text-muted break-words">Your note: {o.supplierNote}</p>}
      {open && !confirming && (
        <div className="mt-3 flex justify-end">
          <button className={o.confirmedAt ? secondaryBtn : primaryBtn} onClick={() => setConfirming(true)}>
            <CalendarCheck size={15} /> {o.confirmedAt ? 'Change delivery day' : 'Confirm'}
          </button>
        </div>
      )}
      {confirming && (
        <div className="mt-3 space-y-2 rounded-xl bg-app-bg p-3">
          <Field label="Day you will deliver"><input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} /></Field>
          <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Morning, before 10" className={fieldClass} /></Field>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          <div className="flex gap-2 justify-end flex-wrap">
            <button className={secondaryBtn} onClick={() => setConfirming(false)}>Cancel</button>
            <button className={primaryBtn} disabled={busy || !date} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm order'}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function PriceCard({ request: q, onDone }: { request: PortalPriceRequest; onDone: () => void }) {
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(q.lines.map((l) => [l.itemId, l.price != null && q.status !== 'asked' ? String(l.price) : ''])));
  const [avail, setAvail] = useState<Record<string, boolean>>(() => Object.fromEntries(q.lines.map((l) => [l.itemId, l.available])));
  const [days, setDays] = useState(q.deliveryDays != null ? String(q.deliveryDays) : '');
  const [note, setNote] = useState(q.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = useMemo(() => q.lines.reduce((s, l) => s + (avail[l.itemId] ? (Number(prices[l.itemId]) || 0) * l.quantity : 0), 0), [q.lines, prices, avail]);
  const ready = q.lines.some((l) => avail[l.itemId]) && q.lines.every((l) => !avail[l.itemId] || Number(prices[l.itemId]) > 0);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      await sendPrices(q.id, q.lines.map((l) => ({ itemId: l.itemId, price: avail[l.itemId] ? Number(prices[l.itemId]) || 0 : 0, available: !!avail[l.itemId] })), days === '' ? null : Number(days), note.trim());
      onDone();
    } catch (e) { setErr(toUserMessage(e, 'Could not send your prices. Try again.')); }
    finally { setBusy(false); }
  };
  const tone = q.status === 'won' ? <Pill tone="green">You won it</Pill> : q.status === 'lost' ? <Pill tone="grey">Went to another supplier</Pill> : q.status === 'priced' ? <Pill tone="blue">Prices sent</Pill> : <Pill tone="amber">Waiting for your prices</Pill>;
  return (
    <Card>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Asked {day(q.askedAt)}</p>
          {q.pricedAt && <p className="text-[11px] text-app-text-muted">You sent prices {day(q.pricedAt)} · {formatCurrency(q.total)}</p>}
        </div>
        {tone}
      </div>
      {q.purchaseNotes && <p className="mt-1 text-[12px] text-app-text-muted break-words">{q.purchaseNotes}</p>}
      <ul className="mt-2 space-y-2">
        {q.lines.map((l) => (
          <li key={l.itemId} className="rounded-xl bg-app-bg p-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm min-w-0 break-words">{displayName(l.name)}<span className="block text-[11px] text-app-text-muted">{qty(l.quantity)} {l.unit}</span></span>
              {q.open ? (
                <Checkbox checked={!!avail[l.itemId]} onChange={(on) => setAvail((a) => ({ ...a, [l.itemId]: on }))} label="I have it" />
              ) : (
                <span className="shrink-0 text-sm tabular-nums">{l.available ? `${formatCurrency(l.price || 0)} each` : 'Not supplied'}</span>
              )}
            </div>
            {q.open && avail[l.itemId] && (
              <NumberInput min={0} value={prices[l.itemId]}
                onChange={(v) => setPrices((p) => ({ ...p, [l.itemId]: (v == null ? '' : String(v)) }))}
                placeholder="Your price each (KSh)" aria-label={`Your price for ${displayName(l.name)}`} className="mt-2"
              />
            )}
          </li>
        ))}
      </ul>
      {q.open && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Days to deliver (optional)"><NumberInput decimals={0} min={0} max={365} value={days} onChange={(v) => setDays((v == null ? '' : String(v)))} /></Field>
            <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Price holds for 7 days" className={fieldClass} /></Field>
          </div>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm">Total <b className="tabular-nums">{formatCurrency(total)}</b></span>
            <button className={primaryBtn} disabled={busy || !ready} onClick={() => void send()}><CheckCircle2 size={15} /> {busy ? 'Sending…' : q.status === 'priced' ? 'Send new prices' : 'Send prices'}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Statement({ data, match }: { data: PortalData; match: (p: (string | null | undefined)[]) => boolean }) {
  const paid = data.payments.reduce((s, p) => s + p.amount, 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Card><p className="text-[11px] text-app-text-muted">Owed to you</p><p className="text-lg font-semibold tabular-nums break-words">{formatCurrency(data.owed)}</p></Card>
        <Card><p className="text-[11px] text-app-text-muted">Paid to you</p><p className="text-lg font-semibold tabular-nums break-words">{formatCurrency(paid)}</p></Card>
      </div>
      <Card>
        <p className="text-sm font-semibold mb-1">Bills</p>
        {data.bills.length === 0 ? <p className="text-[13px] text-app-text-muted">No bills yet. Once they enter your invoice it shows here.</p> : (
          <ul className="divide-y divide-app-border/60">
            {data.bills.filter((b) => match([b.number, b.theirInvoice])).map((b) => (
              <li key={b.id} className="py-2 flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm">{b.theirInvoice ? `Your invoice ${b.theirInvoice}` : b.number}</span>
                  <span className="block text-[11px] text-app-text-muted">{day(b.date)}{b.dueDate ? ` · due ${day(b.dueDate)}` : ''} · {b.number}</span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  {formatCurrency(b.total)}
                  <span className={`block text-[11px] ${b.balance > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{b.balance > 0 ? `${formatCurrency(b.balance)} to pay` : 'Paid'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <p className="text-sm font-semibold mb-1">Payments</p>
        {data.payments.length === 0 ? <p className="text-[13px] text-app-text-muted">No payments yet.</p> : (
          <ul className="divide-y divide-app-border/60">
            {data.payments.filter((p) => match([p.reference, p.bill, p.method])).map((p) => (
              <li key={p.id} className="py-2 flex items-start justify-between gap-2">
                <span className="min-w-0"><span className="block text-sm">{p.method}{p.reference ? ` · ${p.reference}` : ''}</span><span className="block text-[11px] text-app-text-muted">{day(p.paidAt)}{p.bill ? ` · for ${p.bill}` : ''}</span></span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.returns.length > 0 && (
        <Card>
          <p className="text-sm font-semibold mb-1">Goods sent back to you</p>
          <ul className="divide-y divide-app-border/60">
            {data.returns.filter((r) => match([r.number, ...r.lines.map((l) => l.name)])).map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex justify-between gap-2"><span className="text-sm">{r.number} · {day(r.date)}</span><span className="text-sm tabular-nums">{formatCurrency(r.total)}</span></div>
                <p className="text-[11px] text-app-text-muted break-words">{r.lines.map((l) => `${qty(l.quantity)} ${l.unit} ${displayName(l.name)}`).join(', ')}{r.reason ? ` · ${r.reason}` : ''}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Details({ account, data, onDone }: { account: SupplierAccount; data: PortalData; onDone: () => void }) {
  const s = data.supplier;
  const [f, setF] = useState({
    phone: s.phone || '', email: s.email || '', kraPin: s.kraPin || '', mpesaPaybill: s.mpesaPaybill || '', mpesaAccount: s.mpesaAccount || '',
    mpesaTill: s.mpesaTill || '', bankName: s.bankName || '', bankAccount: s.bankAccount || '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ro = !account.can.updateDetails;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await updateMyDetails(account.businessId, f); setMsg({ ok: true, text: `Saved. ${account.businessName} is told you changed them.` }); onDone(); }
    catch (e) { setMsg({ ok: false, text: toUserMessage(e, 'Could not save. Try again.') }); }
    finally { setBusy(false); }
  };
  const input = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label}><input value={f[k]} onChange={set(k)} disabled={ro} maxLength={80} className={fieldClass} {...props} /></Field>
  );
  return (
    <Card className="space-y-3">
      <div>
        <p className="text-sm font-semibold">{s.company || s.name}</p>
        <p className="text-[12px] text-app-text-muted">{ro ? `Only ${account.businessName} can change these.` : `Kept by you; ${account.businessName} uses them to reach and pay you.`}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {input('phone', 'Phone', { type: 'tel', inputMode: 'tel' })}
        {input('email', 'Email (optional)', { type: 'email', inputMode: 'email' })}
        {input('kraPin', 'KRA PIN (optional)', { placeholder: 'e.g. A123456789Z' })}
        {input('mpesaTill', 'M-Pesa till (optional)', { inputMode: 'numeric' })}
        {input('mpesaPaybill', 'M-Pesa paybill (optional)', { inputMode: 'numeric' })}
        {input('mpesaAccount', 'Paybill account number (optional)')}
        {input('bankName', 'Bank (optional)', { placeholder: 'e.g. KCB, Moi Avenue' })}
        {input('bankAccount', 'Bank account number (optional)', { inputMode: 'numeric' })}
      </div>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{msg.text}</p>}
      {!ro && <div className="flex justify-end"><button className={primaryBtn} disabled={busy || !f.phone.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save my details'}</button></div>}
    </Card>
  );
}
