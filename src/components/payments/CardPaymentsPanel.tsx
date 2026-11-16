// src/components/payments/CardPaymentsPanel.tsx
// Money → Cards: the Paystack connection and every card payment taken through it.
// Card machine (PDQ) payments aren't here; they are ordinary Card payments and sales.

import { Checkbox } from '../shared/Checkbox';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Copy, CreditCard, Loader2, Nfc, Globe, Settings2, XCircle } from 'lucide-react';
import { CardRepository, type CardPayment, type CardStatus } from '../../services/repositories';
import { useAppStore } from '../../stores/appStore';
import { hasRolePermission } from '../../utils/permissions';
import { formatCurrency } from '../../utils/helpers';
import { toUserMessage } from '../../utils/userError';
import { describeCard, forgetCardStatus, loadCardStatus } from './CardChargeSheet';

const card = 'bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 shadow-sm';
const input = 'w-full bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500';
const label = 'block text-xs font-semibold text-app-text-muted';

function when(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const PURPOSE: Record<CardPayment['purpose'], string> = {
  sale: 'Till sale',
  payment: 'Payment',
  online_order: 'Website order',
};

function StatusBadge({ p }: { p: CardPayment }) {
  if (p.status === 'success') return <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-semibold"><CheckCircle2 size={14} /> Paid</span>;
  if (p.status === 'pending') return <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-semibold"><Clock size={14} /> Waiting</span>;
  if (p.status === 'cancelled') return <span className="inline-flex items-center gap-1 text-app-text-muted text-xs font-semibold"><XCircle size={14} /> Stopped</span>;
  return <span className="inline-flex items-center gap-1 text-red-500 text-xs font-semibold"><XCircle size={14} /> Not paid</span>;
}

export default function CardPaymentsPanel() {
  const { showToast, currentEmployee } = useAppStore();
  const role = currentEmployee?.role || 'Guest';
  const canConfigure = hasRolePermission(role, 'settings.integrations');

  const [status, setStatus] = useState<CardStatus | null | undefined>(undefined);
  const [rows, setRows] = useState<CardPayment[]>([]);
  const [editing, setEditing] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [onlineEnabled, setOnlineEnabled] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const loadStatus = async () => {
    const s = await loadCardStatus(true);
    setStatus(s);
    setTerminalId(s?.terminalId || '');
    setOnlineEnabled(s ? s.onlineEnabled || !s.connected : true);
    setEditing(!s?.connected);
  };

  useEffect(() => {
    void loadStatus();
    return CardRepository.subscribe(setRows);
  }, []);

  const save = async () => {
    setBusy('save');
    try {
      await CardRepository.saveSettings({ secretKey: secretKey.trim() || undefined, terminalId: terminalId.trim(), onlineEnabled });
      setSecretKey('');
      forgetCardStatus();
      await loadStatus();
      showToast('Cards connected', 'Paystack accepted the key. Card payments are ready.', undefined, 'success');
    } catch (err) {
      showToast('Not saved', toUserMessage(err, "Couldn't save the card settings."), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await CardRepository.remove();
      forgetCardStatus();
      setConfirmRemove(false);
      await loadStatus();
      showToast('Cards disconnected', 'Paystack was removed. The card machine option still works.', undefined, 'success');
    } catch (err) {
      showToast('Not removed', toUserMessage(err), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const recheck = async (p: CardPayment) => {
    setBusy(p.reference);
    try {
      const next = await CardRepository.check(p.reference);
      showToast(next.status === 'success' ? 'Paid' : 'Checked', next.status === 'success' ? `${p.reference} is paid.` : `Paystack says it isn't paid yet.`, undefined, next.status === 'success' ? 'success' : 'info');
    } catch (err) {
      showToast('Check failed', toUserMessage(err), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied', 'Webhook link copied.', undefined, 'success');
    } catch {
      showToast('Copy failed', 'Select the link and copy it by hand.', undefined, 'error');
    }
  };

  // A till sale paid by card but never saved as a sale (the app closed in between, say).
  const unattached = rows.filter((r) => r.purpose === 'sale' && r.status === 'success' && !r.transactionId);
  const paidTotal = rows.filter((r) => r.status === 'success').reduce((s, r) => s + (r.amountPaid ?? r.amount), 0);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <section className={card}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0"><CreditCard size={16} className="text-blue-500" /></div>
            <div>
              <h3 className="text-sm font-semibold">Card payments</h3>
              <p className="text-xs text-app-text-muted">
                {status === undefined ? 'Checking…'
                  : status?.connected ? `Paystack connected${status.environment === 'test' ? ' in test mode (no real money)' : ''}`
                  : 'Card machine only. Connect Paystack to charge cards online or on a card reader.'}
              </p>
            </div>
          </div>
          {status?.connected && canConfigure && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer">
              <Settings2 size={14} /> Change
            </button>
          )}
        </div>

        {status?.connected && !editing && (
          <div className="grid sm:grid-cols-3 gap-2 mt-4 text-sm">
            <div className="rounded-xl bg-app-bg p-3"><Globe size={14} className="inline mr-1 text-app-text-muted" />Online / link: <b>{status.onlineEnabled ? 'On' : 'Off'}</b></div>
            <div className="rounded-xl bg-app-bg p-3"><Nfc size={14} className="inline mr-1 text-app-text-muted" />Card reader: <b>{status.terminalName || status.terminalId || 'None'}</b></div>
            <div className="rounded-xl bg-app-bg p-3">Paid by card here: <b>{formatCurrency(paidTotal)}</b></div>
          </div>
        )}

        {status?.lastError && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400 flex items-start gap-1"><AlertTriangle size={14} className="shrink-0" />Last problem: {status.lastError}</p>
        )}

        {editing && canConfigure && (
          <div className="mt-4 space-y-3">
            <ol className="text-xs text-app-text-muted list-decimal pl-4 space-y-1">
              <li>Open a Paystack account for the business (paystack.com). It takes cards in KES.</li>
              <li>In Paystack, Settings → API Keys &amp; Webhooks: copy the <b>secret key</b> here.</li>
              <li>Paste the webhook link below into the same page, so payments confirm even if the app is closed.</li>
            </ol>
            <label className={label}>
              Paystack secret key {status?.connected && '(leave empty to keep the saved one)'}
              <input type="password" autoComplete="off" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="sk_live_… or sk_test_…" className={`${input} mt-1 font-mono`} />
            </label>
            <label className={label}>
              Paystack card reader ID (optional)
              <input value={terminalId} onChange={(e) => setTerminalId(e.target.value)} placeholder="From Paystack → Terminals" className={`${input} mt-1 font-mono`} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={onlineEnabled} onChange={(on) => setOnlineEnabled(on)} />
              Online card payments (payment page, link and QR, and the website checkout)
            </label>
            {status?.webhookUrl && (
              <div className={label}>
                Webhook link for Paystack
                <div className="mt-1 flex gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-xl bg-app-bg px-3 py-2 text-xs">{status.webhookUrl}</code>
                  <button type="button" onClick={() => void copy(status.webhookUrl)} className="px-3 rounded-xl ring-1 ring-app-border cursor-pointer" aria-label="Copy webhook link"><Copy size={14} /></button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-end">
              {status?.connected && (
                <>
                  <button type="button" onClick={() => setConfirmRemove(true)} className="px-4 py-2 rounded-xl text-sm text-red-600 ring-1 ring-red-500/40 cursor-pointer">Disconnect</button>
                  <button type="button" onClick={() => { setEditing(false); setSecretKey(''); }} className="px-4 py-2 rounded-xl text-sm bg-app-bg cursor-pointer">Cancel</button>
                </>
              )}
              <button type="button" disabled={busy === 'save' || (!status?.connected && !secretKey.trim())} onClick={() => void save()} className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer">
                {busy === 'save' && <Loader2 size={14} className="animate-spin" />} <span className="whitespace-nowrap" title="Check the key with Paystack, then save">Verify & save</span>
              </button>
            </div>
            {confirmRemove && (
              <div className="rounded-xl ring-1 ring-red-500/40 p-3 space-y-2">
                <p className="text-sm">Disconnect Paystack? Online and card reader payments stop. Payments already taken stay recorded.</p>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setConfirmRemove(false)} className="px-3 py-2 rounded-lg text-sm bg-app-bg cursor-pointer">Keep</button>
                  <button type="button" disabled={busy === 'remove'} onClick={() => void remove()} className="px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white cursor-pointer">Disconnect</button>
                </div>
              </div>
            )}
          </div>
        )}
        {editing && !canConfigure && (
          <p className="mt-3 text-sm text-app-text-muted">Ask an owner or admin to connect Paystack.</p>
        )}
      </section>

      {unattached.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><AlertTriangle size={15} className="text-amber-600" /> Paid by card, but no sale was saved</h3>
          <p className="text-xs text-app-text-muted mt-1">The money came in, but the till didn't save the sale (the app may have closed). Make the sale again and choose Card → Card machine with the reference below, or refund it in Paystack.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {unattached.map((r) => <li key={r.id}>{formatCurrency(r.amountPaid ?? r.amount)} · {when(r.paidAt)} · <span className="font-mono">{r.reference}</span></li>)}
          </ul>
        </section>
      )}

      <section className={card}>
        <h3 className="text-sm font-semibold mb-3">Recent card payments</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-app-text-muted">No card payments through Paystack yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-app-text-muted">
                  <th className="px-1 py-1.5 font-medium">When</th>
                  <th className="px-1 py-1.5 font-medium">For</th>
                  <th className="px-1 py-1.5 font-medium text-right">Amount</th>
                  <th className="px-1 py-1.5 font-medium">Card</th>
                  <th className="px-1 py-1.5 font-medium">Status</th>
                  <th className="px-1 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-app-border/60 align-top">
                    <td className="px-1 py-2 whitespace-nowrap text-xs">{when(r.createdAt)}</td>
                    <td className="px-1 py-2">
                      <div>{PURPOSE[r.purpose]}{r.payerName ? ` · ${r.payerName}` : ''}</div>
                      <div className="text-[11px] text-app-text-muted font-mono">{r.reference} · {r.channel === 'terminal' ? 'reader' : 'online'}</div>
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.amountPaid ?? r.amount)}</td>
                    <td className="px-1 py-2 text-xs whitespace-nowrap">{describeCard(r.cardBrand, r.cardLast4)}</td>
                    <td className="px-1 py-2"><StatusBadge p={r} />{r.status === 'failed' && r.failureReason && <div className="text-[11px] text-app-text-muted">{r.failureReason}</div>}</td>
                    <td className="px-1 py-2 text-right">
                      {r.status === 'pending' && (
                        <button type="button" disabled={busy === r.reference} onClick={() => void recheck(r)} className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer">
                          {busy === r.reference ? 'Checking…' : 'Check'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
