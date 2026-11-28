// src/features/UnclaimedPaymentsView.tsx
// Unclaimed Payments: money that reached the till (C2B) and still needs to be tied to a sale or a
// customer, plus paid M-Pesa prompts that missed their sale (STK exceptions).
// Every rule is in the database (20261213001): allocations are locked, never over a payment's
// amount or a sale's balance, and every step is written to an append-only history.
// Desktop: table + right-side drawer. Tablet/phone: compact rows + full-screen details.
import { useEffect, useMemo, useState } from "react";
import { useOverlay } from "../hooks/useOverlay";
import { X, SlidersHorizontal, History, Flag, Link2, User, Undo2, AlertTriangle } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { useUnclaimedPaymentsStore } from "../stores/unclaimedPaymentsStore";
import { useCustomerStore } from "../stores/customerStore";
import { MpesaRepository } from "../services/repositories";
import {
  OPEN_TILL_STATUSES,
  type StkException,
  type TillAllocation,
  type TillPayment,
  type TillPaymentEvent,
  type TillPaymentStatus,
  type TillSaleCandidate,
} from "../types";
import { formatMoney, roundMoney } from "../utils/money";
import { toUserMessage } from "../utils/userError";
import { StatTile } from "../components/shared/StatTile";
import { SearchInput, DateTimeInput, NumberInput, TextInput } from "../components/shared/Input";
import { Segmented } from "../components/shared/Choice";
import { SheetLayer } from "../components/shared/SheetLayer";
import SearchableDropdown from "../components/SearchableDropdown";

export const TILL_STATUS: Record<TillPaymentStatus, { label: string; cls: string }> = {
  unclaimed: { label: "Unclaimed", cls: "bg-amber-500 text-slate-950" },
  under_review: { label: "Under review", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  partial: { label: "Partly claimed", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  disputed: { label: "Disputed", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  matched_sale: { label: "Claimed", cls: "bg-emerald-600 text-white" },
  recorded: { label: "Claimed (account)", cls: "bg-emerald-600 text-white" },
  ignored: { label: "Ignored", cls: "bg-app-border text-app-text-muted" },
  reversed: { label: "Reversed", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const left = (p: TillPayment) => roundMoney(p.amount - p.allocated);
const channelOf = (p: TillPayment) => (/pay\s*bill/i.test(p.transType || "") ? "paybill" : "till");
const ageText = (iso?: string) => {
  if (!iso) return "None";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} days`;
};

type StatusFilter = "open" | TillPaymentStatus | "all";
type Sort = "newest" | "oldest" | "amount";

export default function UnclaimedPaymentsView() {
  const payments = useUnclaimedPaymentsStore((s) => s.payments);
  const focusId = useUnclaimedPaymentsStore((s) => s.focusId);
  const setFocus = useUnclaimedPaymentsStore((s) => s.setFocus);
  useEffect(() => { useUnclaimedPaymentsStore.getState().start(); }, []);

  const [tab, setTab] = useState<"payments" | "exceptions">("payments");
  const [search, setSearch] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [sort, setSort] = useState<Sort>("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exceptions, setExceptions] = useState<StkException[]>([]);

  // Opened from the header list.
  useEffect(() => {
    if (focusId) { setSelectedId(focusId); setTab("payments"); setFocus(null); }
  }, [focusId]);

  const loadExceptions = () => MpesaRepository.stkExceptions().then(setExceptions).catch(() => setExceptions([]));
  useEffect(() => { void loadExceptions(); }, [payments]);

  const open = payments.filter((p) => OPEN_TILL_STATUSES.includes(p.status));
  const stats = {
    amount: roundMoney(open.reduce((s, p) => s + left(p), 0)),
    count: open.length,
    review: open.filter((p) => p.status === "under_review" || p.status === "disputed").length,
    partial: open.filter((p) => p.status === "partial").length,
    oldest: open.length ? open.reduce((a, p) => (p.transTime < a ? p.transTime : a), open[0].transTime) : undefined,
  };

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    const cq = customerQ.toLowerCase().trim();
    const list = payments.filter((p) => {
      if (status === "open" ? !OPEN_TILL_STATUSES.includes(p.status) : status !== "all" && p.status !== status) return false;
      if (channel !== "all" && channelOf(p) !== channel) return false;
      if (from && p.transTime < from) return false;
      if (to && p.transTime > new Date(new Date(to).getTime() + 86400000).toISOString()) return false;
      if (q && ![p.transId, p.billRef, String(p.amount), p.note].some((v) => (v || "").toLowerCase().includes(q))) return false;
      if (cq && ![p.payerName, p.msisdn].some((v) => (v || "").toLowerCase().includes(cq))) return false;
      return true;
    });
    return list.sort((a, b) =>
      sort === "amount" ? b.amount - a.amount : sort === "oldest" ? a.transTime.localeCompare(b.transTime) : b.transTime.localeCompare(a.transTime),
    );
  }, [payments, search, customerQ, from, to, channel, status, sort]);

  // Best suggested sale for the first visible open rows, so a likely match shows in the list.
  const [hints, setHints] = useState<Record<string, TillSaleCandidate | null>>({});
  useEffect(() => {
    const todo = rows.filter((p) => OPEN_TILL_STATUSES.includes(p.status) && !(p.id + p.allocated in hints)).slice(0, 20);
    if (!todo.length) return;
    let live = true;
    Promise.all(todo.map((p) => MpesaRepository.tillSaleCandidates(p.id).then((c) => [p.id + p.allocated, c[0]?.score >= 10 ? c[0] : null] as const).catch(() => [p.id + p.allocated, null] as const)))
      .then((pairs) => { if (live) setHints((h) => ({ ...h, ...Object.fromEntries(pairs) })); });
    return () => { live = false; };
  }, [rows]);

  const selected = selectedId ? payments.find((p) => p.id === selectedId) : undefined;
  const filterCount = [from, to, channel !== "all", status !== "open", customerQ].filter(Boolean).length;

  const filters = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
      <SearchInput value={customerQ} onChange={setCustomerQ} placeholder="Sender name or phone" size="sm" />
      <DateTimeInput value={from} onChange={setFrom} withTime={false} size="sm" aria-label="From date" />
      <DateTimeInput value={to} onChange={setTo} withTime={false} size="sm" aria-label="To date" />
      <SearchableDropdown
        items={[{ id: "all", label: "All channels" }, { id: "till", label: "Till (Buy Goods)" }, { id: "paybill", label: "Paybill" }]}
        selectedValue={channel} onChange={setChannel} placeholder="Channel"
      />
      <SearchableDropdown
        items={[
          { id: "open", label: "Needs action" },
          { id: "all", label: "All statuses" },
          ...(Object.keys(TILL_STATUS) as TillPaymentStatus[]).map((s) => ({ id: s, label: TILL_STATUS[s].label })),
        ]}
        selectedValue={status} onChange={(v) => setStatus(v as StatusFilter)} placeholder="Status"
      />
      <SearchableDropdown
        items={[{ id: "newest", label: "Newest first" }, { id: "oldest", label: "Oldest first" }, { id: "amount", label: "Highest amount" }]}
        selectedValue={sort} onChange={(v) => setSort(v as Sort)} placeholder="Sort"
      />
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold text-app-text">Unclaimed Payments</h1>
            <p className="text-xs text-app-text-muted">Money paid to the till that is not yet tied to a sale or a customer.</p>
          </div>
          <Segmented
            size="sm"
            value={tab}
            onChange={(v) => setTab(v as "payments" | "exceptions")}
            options={[{ id: "payments", label: "Till payments" }, { id: "exceptions", label: "Prompt exceptions", count: exceptions.length }]}
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <StatTile label="Unclaimed amount" value={formatMoney(stats.amount)} tone="amber" />
          <StatTile label="Open payments" value={stats.count} />
          <StatTile label="Under review" value={stats.review} tone={stats.review ? "red" : "slate"} />
          <StatTile label="Partly claimed" value={stats.partial} tone="emerald" />
          <StatTile label="Oldest open" value={ageText(stats.oldest)} className="col-span-2 lg:col-span-1" />
        </div>

        {tab === "exceptions" ? (
          <ExceptionList rows={exceptions} onChanged={loadExceptions} />
        ) : (
          <>
            <div className="flex gap-2">
              <SearchInput value={search} onChange={setSearch} placeholder="M-Pesa code, amount or account reference" className="flex-1" size="sm" />
              <button
                onClick={() => setFiltersOpen((o) => !o)}
                className="lg:hidden px-3 rounded-lg border border-app-border text-xs font-semibold text-app-text inline-flex items-center gap-1.5 cursor-pointer"
                aria-expanded={filtersOpen}
              >
                <SlidersHorizontal size={14} /> Filters{filterCount ? ` (${filterCount})` : ""}
              </button>
            </div>
            <div className={filtersOpen ? "" : "hidden lg:block"}>{filters}</div>

            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-app-text-muted">
                {status === "open" && !search && !customerQ ? "Nothing to sort out. Every till payment is tied to a sale or customer." : "No payments match."}
              </p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden lg:block border border-app-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-app-bg text-[11px] text-app-text-muted text-left">
                      <tr>
                        <th className="px-3 py-2 font-semibold text-right">Amount</th>
                        <th className="px-3 py-2 font-semibold">M-Pesa code</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold">Sender</th>
                        <th className="px-3 py-2 font-semibold">Phone</th>
                        <th className="px-3 py-2 font-semibold">Received</th>
                        <th className="px-3 py-2 font-semibold">Possible sale</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-app-border/60">
                      {rows.map((p) => {
                        const h = hints[p.id + p.allocated];
                        return (
                          <tr key={p.id} onClick={() => setSelectedId(p.id)}
                            className={`cursor-pointer hover:bg-app-bg ${selectedId === p.id ? "bg-amber-500/5" : ""}`}>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-app-text whitespace-nowrap">
                              {formatMoney(p.amount)}
                              {p.allocated > 0 && p.status !== "matched_sale" && <div className="text-[11px] font-normal text-app-text-muted">{formatMoney(left(p))} left</div>}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{p.transId}</td>
                            <td className="px-3 py-2"><StatusBadge s={p.status} /></td>
                            <td className="px-3 py-2 truncate max-w-[10rem]">{p.payerName || "Unknown"}</td>
                            <td className="px-3 py-2 text-xs tabular-nums">{p.msisdn || "None"}</td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">{when(p.transTime)}</td>
                            <td className="px-3 py-2 text-xs">{h ? <span title={h.reasons.join(", ")}>{h.reference} · {formatMoney(h.remaining)} due</span> : <span className="text-app-text-muted">{p.billRef ? `Ref ${p.billRef}` : "None found"}</span>}</td>
                            <td className="px-3 py-2 text-right">
                              <span className="text-xs font-semibold text-emerald-700">{OPEN_TILL_STATUSES.includes(p.status) ? "Match" : "View"}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Tablet and phone rows */}
                <ul className="lg:hidden divide-y divide-app-border/60 border border-app-border rounded-lg">
                  {rows.map((p) => {
                    const h = hints[p.id + p.allocated];
                    return (
                      <li key={p.id}>
                        <button onClick={() => setSelectedId(p.id)} className="w-full text-left px-3 py-2.5 cursor-pointer">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-base font-semibold tabular-nums text-app-text">{formatMoney(p.amount)}</div>
                              <div className="font-mono text-xs text-app-text">{p.transId}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <StatusBadge s={p.status} />
                              {p.allocated > 0 && p.status !== "matched_sale" && <div className="text-[11px] text-app-text-muted mt-0.5">{formatMoney(left(p))} left</div>}
                            </div>
                          </div>
                          <div className="text-xs text-app-text mt-1 truncate">{p.payerName || "Unknown sender"} · {p.msisdn || "no phone"}</div>
                          <div className="text-[11px] text-app-text-muted flex flex-wrap gap-x-2">
                            <span>{when(p.transTime)}</span>
                            {h && <span className="text-emerald-700">Possible: {h.reference}</span>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {selected && <PaymentDetails key={selected.id} p={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function StatusBadge({ s }: { s: TillPaymentStatus }) {
  return <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${TILL_STATUS[s].cls}`}>{TILL_STATUS[s].label}</span>;
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <span className="text-app-text-muted">{k}</span>
      <span className={`text-app-text text-right ${mono ? "font-mono" : ""}`}>{v}</span>
    </div>
  );
}

const btn = "min-h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40";

function PaymentDetails({ p, onClose }: { p: TillPayment; onClose: () => void }) {
  const { showToast, currentEmployee } = useAppStore();
  const by = currentEmployee?.name || "Staff";
  const customers = useCustomerStore((s) => s.customers);
  const isOpen = OPEN_TILL_STATUSES.includes(p.status);
  const canAllocate = ["unclaimed", "under_review", "partial"].includes(p.status);
  const remainingHere = left(p);

  const [mode, setMode] = useState<"match" | "customer" | "flag" | "history">(canAllocate ? "match" : "history");
  const [q, setQ] = useState("");
  const [cands, setCands] = useState<TillSaleCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<TillSaleCandidate | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [flagTo, setFlagTo] = useState<"under_review" | "disputed" | "reversed" | "unclaimed">(
    p.status === "under_review" || p.status === "disputed" ? "unclaimed" : "under_review",
  );
  const [customerId, setCustomerId] = useState("");
  const [hist, setHist] = useState<{ events: TillPaymentEvent[]; allocations: TillAllocation[] } | null>(null);

  useOverlay(true, onClose, "bottom-sheet");

  useEffect(() => {
    if (!canAllocate || mode !== "match") return;
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      MpesaRepository.tillSaleCandidates(p.id, q)
        .then((c) => live && setCands(c))
        .catch(() => live && setCands([]))
        .finally(() => live && setLoading(false));
    }, q ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, mode, p.allocated, p.status]);

  useEffect(() => {
    MpesaRepository.tillPaymentHistory(p.id).then(setHist).catch(() => setHist(null));
  }, [p.status, p.allocated]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      showToast("Unclaimed payments", done, undefined, "success");
      setPick(null); setConfirming(false); setNote(""); setAmount(null);
    } catch (err) {
      showToast("Unclaimed payments", toUserMessage(err, "Could not save. Please try again."), undefined, "error");
    } finally {
      setBusy(false);
    }
  };

  const choose = (c: TillSaleCandidate) => {
    setPick(c);
    setAmount(roundMoney(Math.min(remainingHere, c.remaining)));
    setConfirming(false);
  };

  const custItems = useMemo(() => customers.map((c) => ({
    id: c.id, label: c.name,
    sublabel: [c.accountNumber && `Acc ${c.accountNumber}`, c.phone, Number(c.debtBalance || 0) > 0 && `owes ${formatMoney(Number(c.debtBalance))}`].filter(Boolean).join(" · "),
  })), [customers]);
  const cust = customers.find((c) => c.id === customerId);
  const debt = Number(cust?.debtBalance || 0);

  return (
    <SheetLayer>
      <div className="fixed inset-0 z-[9000] bg-black/30 lg:bg-black/10" onClick={onClose} />
      <aside
        role="dialog" aria-label={`Payment ${p.transId}`}
        className="fixed z-[9001] inset-0 lg:left-auto lg:w-[30rem] bg-app-card lg:border-l border-app-border flex flex-col pt-[var(--inset-top)]"
      >
        <div className="px-4 py-3 border-b border-app-border flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xl font-semibold tabular-nums text-app-text">{formatMoney(p.amount)}</div>
            <div className="font-mono text-sm text-app-text">{p.transId}</div>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge s={p.status} />
              {p.allocated > 0 && <span className="text-[11px] text-app-text-muted">{formatMoney(p.allocated)} given, {formatMoney(remainingHere)} left</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="size-9 grid place-items-center rounded-lg hover:bg-app-bg cursor-pointer"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <div className="divide-y divide-app-border/50">
            <Row k="Sender" v={p.payerName || "Unknown"} />
            <Row k="Phone" v={p.msisdn || "None"} />
            <Row k="Received" v={new Date(p.transTime).toLocaleString()} />
            <Row k="Channel" v={channelOf(p) === "paybill" ? "Paybill" : "Till (Buy Goods)"} />
            <Row k="Till / short code" v={p.shortCode || "None"} mono />
            <Row k="Account reference" v={p.billRef || "None"} mono />
            {p.handledBy && <Row k="Last handled by" v={`${p.handledBy}${p.handledAt ? `, ${when(p.handledAt)}` : ""}`} />}
            {p.note && <Row k="Note" v={p.note} />}
          </div>

          <Segmented
            size="sm"
            value={mode}
            onChange={(m) => { setMode(m); setConfirming(false); }}
            options={[
              { id: "match", label: "Sale", disabled: !canAllocate },
              { id: "customer", label: "Account", disabled: !canAllocate },
              { id: "flag", label: "Flag", disabled: !isOpen },
              { id: "history", label: "History" },
            ]}
          />

          {mode === "match" && canAllocate && (
            <div className="space-y-2">
              <SearchInput value={q} onChange={setQ} placeholder="Find a sale: receipt no., customer, phone, total" size="sm" />
              <p className="text-[11px] text-app-text-muted">
                {q ? "Search results" : "Suggested M-Pesa sales near this time"}. Nothing is linked until you confirm.
              </p>
              {loading ? (
                <p className="text-xs text-app-text-muted py-3">Looking for sales...</p>
              ) : cands.length === 0 ? (
                <p className="text-xs text-app-text-muted py-3">No M-Pesa sale with a balance found. Search by receipt number, or record it on a customer's account.</p>
              ) : (
                <ul className="border border-app-border rounded-lg divide-y divide-app-border/60">
                  {cands.map((c) => (
                    <li key={c.saleId}>
                      <button onClick={() => choose(c)}
                        className={`w-full text-left px-3 py-2 cursor-pointer ${pick?.saleId === c.saleId ? "bg-emerald-500/10" : "hover:bg-app-bg"}`}>
                        <div className="flex justify-between gap-2 text-xs">
                          <span className="font-semibold text-app-text">{c.reference}</span>
                          <span className="font-semibold tabular-nums text-app-text">{formatMoney(c.remaining)} due</span>
                        </div>
                        <div className="text-[11px] text-app-text-muted">
                          {c.customerName || "Walk-in"} · {when(c.createdAt)} · total {formatMoney(c.total)} · paid by till {formatMoney(c.linked)}
                        </div>
                        {c.reasons.length > 0 && <div className="text-[11px] text-emerald-700 mt-0.5">{c.reasons.join(" · ")}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {pick && (
                <div className="border border-app-border rounded-lg p-3 space-y-2">
                  <Row k="Left on this payment" v={formatMoney(remainingHere)} />
                  <Row k={`Due on ${pick.reference}`} v={formatMoney(pick.remaining)} />
                  <label className="block text-xs text-app-text-muted">Amount to give this sale</label>
                  <NumberInput value={amount} onChange={(v) => { setAmount(v); setConfirming(false); }} decimals={2} min={0} max={Math.min(remainingHere, pick.remaining)} size="sm" />
                  {!confirming ? (
                    <button disabled={!amount || amount <= 0 || amount > Math.min(remainingHere, pick.remaining)} onClick={() => setConfirming(true)}
                      className={`${btn} w-full bg-emerald-600 text-white`}>
                      <Link2 size={14} /> Give {formatMoney(amount || 0)} to {pick.reference}
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs text-app-text">
                        Confirm: {formatMoney(amount || 0)} of {p.transId} pays sale {pick.reference}.
                        {roundMoney(remainingHere - (amount || 0)) > 0 ? ` ${formatMoney(remainingHere - (amount || 0))} stays unclaimed.` : " The payment will be fully claimed."}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setConfirming(false)} className={`${btn} border border-app-border text-app-text`}>Back</button>
                        <button disabled={busy}
                          onClick={() => run(() => MpesaRepository.allocateTillPayment(p.id, pick.saleId, amount || 0, by), `${formatMoney(amount || 0)} given to ${pick.reference}.`)}
                          className={`${btn} bg-emerald-600 text-white`}>Confirm</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === "customer" && canAllocate && (
            <div className="space-y-2">
              <p className="text-[11px] text-app-text-muted">
                Records the {formatMoney(remainingHere)} left as the customer's payment: pays their debt first, then their wallet. This moves money and posts to the books.
              </p>
              <SearchableDropdown items={custItems} selectedValue={customerId} onChange={setCustomerId} placeholder="Choose the customer" searchPlaceholder="Name, phone or account number" />
              {cust && (
                <p className={`text-xs ${debt > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                  {debt > 0
                    ? `Pays ${formatMoney(Math.min(debt, remainingHere))} of their ${formatMoney(debt)} debt${remainingHere > debt ? `, ${formatMoney(remainingHere - debt)} to their wallet` : ""}.`
                    : `All ${formatMoney(remainingHere)} to their wallet.`}
                </p>
              )}
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" size="sm" />
              {!confirming ? (
                <button disabled={!customerId} onClick={() => setConfirming(true)} className={`${btn} w-full bg-emerald-600 text-white`}><User size={14} /> Record for {cust?.name || "customer"}</button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setConfirming(false)} className={`${btn} border border-app-border text-app-text`}>Back</button>
                  <button disabled={busy}
                    onClick={() => run(() => MpesaRepository.handleTillPayment(p.id, "customer", { customerId, note: note.trim() || undefined, handledBy: by }), `${formatMoney(remainingHere)} recorded for ${cust?.name}.`)}
                    className={`${btn} bg-emerald-600 text-white`}>Confirm</button>
                </div>
              )}
            </div>
          )}

          {mode === "flag" && isOpen && (
            <div className="space-y-2">
              <SearchableDropdown
                items={[
                  ...(p.status === "under_review" || p.status === "disputed" ? [{ id: "unclaimed", label: "Clear the flag", sublabel: "Back to normal matching" }] : []),
                  { id: "under_review", label: "Under review", sublabel: "Being checked; held out of matching" },
                  { id: "disputed", label: "Disputed", sublabel: "Payer or staff dispute it" },
                  { id: "reversed", label: "Reversed by Safaricom", sublabel: "Money went back; any sale links are undone" },
                ]}
                selectedValue={flagTo} onChange={(v) => setFlagTo(v as typeof flagTo)} placeholder="Status"
              />
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required)" size="sm" />
              <button disabled={busy || !note.trim()}
                onClick={() => run(() => MpesaRepository.flagTillPayment(p.id, flagTo, note.trim(), by), "Status saved.")}
                className={`${btn} w-full ${flagTo === "reversed" || flagTo === "disputed" ? "bg-red-600 text-white" : "bg-amber-500 text-slate-950"}`}>
                <Flag size={14} /> Save
              </button>
              {(p.status === "partial") && (
                <button disabled={busy || !note.trim()}
                  onClick={() => run(() => MpesaRepository.handleTillPayment(p.id, "reopen", { note: note.trim(), handledBy: by }), "Sale links undone; payment is unclaimed again.")}
                  className={`${btn} w-full border border-app-border text-app-text`}>
                  <Undo2 size={14} /> Undo its sale links (reassign)
                </button>
              )}
            </div>
          )}

          {mode === "history" && (
            <div className="space-y-3">
              {(p.status === "matched_sale" || p.status === "ignored") && (
                <button disabled={busy}
                  onClick={() => run(() => MpesaRepository.handleTillPayment(p.id, "reopen", { note: "Reassigning", handledBy: by }), "Payment is unclaimed again.")}
                  className={`${btn} w-full border border-app-border text-app-text`}>
                  <Undo2 size={14} /> Send back to unclaimed (reassign)
                </button>
              )}
              {p.status === "recorded" && (
                <p className="text-[11px] text-app-text-muted">Recorded on a customer's account. To change it, void that payment on the Payments screen; this one then returns here.</p>
              )}
              <div>
                <h3 className="text-xs font-semibold text-app-text mb-1">Sale links</h3>
                {!hist?.allocations.length ? <p className="text-[11px] text-app-text-muted">None.</p> : (
                  <ul className="text-xs divide-y divide-app-border/50">
                    {hist.allocations.map((a) => (
                      <li key={a.id} className={`py-1 flex justify-between gap-2 ${a.reversedAt ? "text-app-text-muted line-through" : ""}`}>
                        <span>{a.saleReference || a.saleId.slice(0, 8)} · {a.allocatedBy} · {when(a.allocatedAt)}</span>
                        <span className="tabular-nums">{formatMoney(a.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="text-xs font-semibold text-app-text mb-1 flex items-center gap-1"><History size={12} /> History</h3>
                {!hist?.events.length ? <p className="text-[11px] text-app-text-muted">No history yet.</p> : (
                  <ol className="text-xs space-y-1.5">
                    {hist.events.map((e) => (
                      <li key={e.id} className="border-l-2 border-amber-500/50 pl-2">
                        <div className="text-app-text">
                          {e.action === "received" ? "Received from M-Pesa" : e.action === "allocated" ? `Gave ${formatMoney(e.amount)}${e.note ? ` to ${e.note.replace(/^Sale /, "")}` : ""}` :
                            `${e.previousStatus ? TILL_STATUS[e.previousStatus as TillPaymentStatus]?.label ?? e.previousStatus : ""} to ${TILL_STATUS[e.newStatus as TillPaymentStatus]?.label ?? e.newStatus}`}
                        </div>
                        <div className="text-[11px] text-app-text-muted">
                          {e.staffName || "System"} · {when(e.createdAt)}{e.note && e.action !== "allocated" ? ` · ${e.note}` : ""}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </SheetLayer>
  );
}

function ExceptionList({ rows, onChanged }: { rows: StkException[]; onChanged: () => void }) {
  const { showToast, currentEmployee } = useAppStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-app-text-muted">No prompt exceptions. Every paid prompt reached its sale.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-app-text-muted flex items-start gap-1.5">
        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
        These prompts were paid, but their sale was removed or already covered. The money was recorded as a walk-in or customer payment, so nothing is lost. Check each one and say how it was sorted.
      </p>
      <ul className="border border-app-border rounded-lg divide-y divide-app-border/60">
        {rows.map((x) => (
          <li key={x.id} className="px-3 py-2.5">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <div className="font-semibold tabular-nums text-app-text">{formatMoney(x.amount)}</div>
                <div className="font-mono text-xs">{x.receiptNumber}</div>
                <div className="text-[11px] text-app-text-muted">{x.phone} · {when(x.paidAt)} · meant for sale {x.saleReference || "removed"} · sent by {x.requestedBy || "staff"}</div>
              </div>
              <button onClick={() => { setOpenId(openId === x.id ? null : x.id); setNote(""); }} className={`${btn} border border-app-border text-app-text self-start`}>Mark sorted</button>
            </div>
            {openId === x.id && (
              <div className="mt-2 flex gap-2">
                <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="How it was sorted (required)" size="sm" className="flex-1" />
                <button disabled={!note.trim()} className={`${btn} bg-emerald-600 text-white`}
                  onClick={async () => {
                    try {
                      await MpesaRepository.resolveStkException(x.id, note.trim(), currentEmployee?.name || "Staff");
                      setOpenId(null); onChanged();
                    } catch (err) {
                      showToast("Prompt exceptions", toUserMessage(err, "Could not save."), undefined, "error");
                    }
                  }}>Save</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
