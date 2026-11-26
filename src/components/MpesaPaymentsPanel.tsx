// src/components/MpesaPaymentsPanel.tsx
// M-Pesa (Daraja) for the till: connection status, payment prompts sent from the
// app, and money sent straight to the till waiting for staff to say what it was.
// A till payment carries no account number, so it can't be matched automatically.

import { useEffect, useState } from 'react';
import { onBranchChange } from '../stores/businessStore';
import { Settings2 } from 'lucide-react';
import { MpesaRepository, type MpesaStatus } from '../services/repositories';
import { useAppStore } from '../stores/appStore';
import { useUiStore } from '../stores/uiStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import SearchableDropdown from './SearchableDropdown';
import { TextInput } from './shared/Input';

const card = 'bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 shadow-sm';
const label = 'text-xs font-semibold text-app-text-muted';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MpesaPaymentsPanel() {
  const { showToast, currentEmployee } = useAppStore();
  const role = currentEmployee?.role || 'Guest';
  const canConfigure = hasRolePermission(role, 'settings.integrations');
  const canRequest = hasRolePermission(role, 'payments.mpesa');

  const [status, setStatus] = useState<MpesaStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [tillInput, setTillInput] = useState('');
  const [keysOpen, setKeysOpen] = useState(false);
  const [env, setEnv] = useState<'sandbox' | 'production'>('sandbox');
  const [txType, setTxType] = useState<'CustomerBuyGoodsOnline' | 'CustomerPayBillOnline'>('CustomerBuyGoodsOnline');
  const [shortcode, setShortcode] = useState('');
  const [partyB, setPartyB] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [passkey, setPasskey] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadStatus = () => {
    MpesaRepository.status()
      .then((s) => {
        setStatus(s);
        setTillInput(s.tillNumber || '');
        setEnv(s.environment);
        setTxType(s.transactionType);
        setShortcode(s.shortcode || '');
        setPartyB(s.partyB || '');
        setConsumerKey('');
        setConsumerSecret('');
        setPasskey('');
        setStatusError('');
      })
      .catch((err) => setStatusError(toUserMessage(err, "Couldn't reach the M-Pesa service.")));
  };

  // Each branch has its own keys, till and payments: reload and resubscribe on a branch change.
  const [branchKey, setBranchKey] = useState('');
  useEffect(() => onBranchChange((id) => setBranchKey(id)), []);

  useEffect(() => {
    loadStatus();
  }, [branchKey]);

  const run = async (key: string, fn: () => Promise<void>, success?: [string, string]) => {
    setBusy(key);
    try {
      await fn();
      if (success) showToast(success[0], success[1], undefined, 'success');
    } catch (err) {
      showToast('M-Pesa', toUserMessage(err, 'Something went wrong. Please try again.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-200">
      {/* Connection */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-app-text flex items-center gap-2">
            <Settings2 size={16} className="text-amber-500" /> M-Pesa connection
          </h3>
          {status && (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${status.configured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/15 text-amber-700'}`}>
              {status.configured ? `Connected (${status.environment})` : 'Not set up yet'}
            </span>
          )}
        </div>

        {statusError && <p className="text-sm text-red-500">{statusError}</p>}

        {status && !status.configured && (
          <p className="text-sm text-app-text-muted mb-3">
            Connect this business's own Daraja app so payments go to its own till.
          </p>
        )}

        {canConfigure && status && (!status.configured || keysOpen) && (
          <div className="flex flex-col gap-3 mb-4">
            <p className="text-xs text-app-text-muted">
              From developer.safaricom.co.ke: Consumer Key and Secret are on your app; the Passkey comes by email after Go Live. For a till, Safaricom needs two numbers: the Store Number (Business Short Code) and the Till Number customers pay (PartyB). Empty secret boxes keep the saved ones.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className={label}>Environment</span>
                <SearchableDropdown
                  items={[{ id: 'sandbox', label: 'Sandbox (testing)' }, { id: 'production', label: 'Production (real money)' }]}
                  selectedValue={env}
                  onChange={(v) => setEnv(v as 'sandbox' | 'production')}
                  placeholder="Choose environment"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Account type</span>
                <SearchableDropdown
                  items={[{ id: 'CustomerBuyGoodsOnline', label: 'Till (Buy Goods)' }, { id: 'CustomerPayBillOnline', label: 'Paybill' }]}
                  selectedValue={txType}
                  onChange={(v) => setTxType(v as 'CustomerBuyGoodsOnline' | 'CustomerPayBillOnline')}
                  placeholder="Choose account type"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>{txType === 'CustomerBuyGoodsOnline' ? 'Business Short Code (Store Number / H.O.)' : 'Business Short Code (Paybill)'}</span>
                <TextInput inputMode="numeric" value={shortcode} onChange={(e) => setShortcode(e.target.value.replace(/\D/g, ''))} />
              </label>
              {txType === 'CustomerBuyGoodsOnline' && (
                <label className="flex flex-col gap-1">
                  <span className={label}>PartyB (Till Number)</span>
                  <TextInput inputMode="numeric" value={partyB} onChange={(e) => setPartyB(e.target.value.replace(/\D/g, ''))} placeholder="Empty = same as Store Number" />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className={label}>Consumer Key</span>
                <TextInput type="password" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} placeholder={status.configured ? 'Saved' : ''} autoComplete="new-password" />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Consumer Secret</span>
                <TextInput type="password" value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} placeholder={status.configured ? 'Saved' : ''} autoComplete="new-password" />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={label}>Passkey (Lipa Na M-Pesa Online)</span>
                <TextInput type="password" value={passkey} onChange={(e) => setPasskey(e.target.value)} placeholder={status.configured ? 'Saved' : ''} autoComplete="new-password" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy === 'keys' || !shortcode || (!status.configured && (!consumerKey.trim() || !consumerSecret.trim() || !passkey.trim()))}
                onClick={() => run('keys', async () => {
                  await MpesaRepository.saveKeys({ environment: env, transactionType: txType, shortcode, partyB, consumerKey, consumerSecret, passkey });
                  setKeysOpen(false);
                  loadStatus();
                }, ['M-Pesa connected', 'Safaricom accepted the keys. Now register the till.'])}
                className="min-h-10 px-4 bg-amber-500 text-slate-950 font-bold rounded-xl text-sm disabled:opacity-40 cursor-pointer"
              >
                {busy === 'keys' ? 'Checking…' : status.configured ? 'Save changes' : 'Connect M-Pesa'}
              </button>
              {status.configured && (
                <button type="button" onClick={() => setKeysOpen(false)} className="min-h-10 px-4 border border-app-border rounded-xl text-sm font-semibold text-app-text cursor-pointer">
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {canConfigure && status?.configured && !keysOpen && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs text-app-text-muted">
              {status.transactionType === 'CustomerBuyGoodsOnline' ? 'Till' : 'Paybill'} keys saved, short code {status.shortcode}.
            </span>
            <button type="button" onClick={() => setKeysOpen(true)} className="min-h-9 px-3 border border-app-border rounded-xl text-xs font-semibold text-app-text cursor-pointer">
              Change keys
            </button>
            {!confirmRemove ? (
              <button type="button" onClick={() => setConfirmRemove(true)} className="min-h-9 px-3 text-xs font-semibold text-red-500 cursor-pointer">
                Disconnect
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-xs text-app-text-muted">Disconnect M-Pesa?</span>
                <button
                  type="button"
                  disabled={busy === 'remove'}
                  onClick={() => run('remove', async () => { await MpesaRepository.removeKeys(); setConfirmRemove(false); loadStatus(); }, ['M-Pesa disconnected', 'Prompts are off until it is connected again.'])}
                  className="min-h-9 px-3 bg-red-500 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  {busy === 'remove' ? 'Removing…' : 'Yes, disconnect'}
                </button>
                <button type="button" onClick={() => setConfirmRemove(false)} className="min-h-9 px-3 text-xs cursor-pointer">No</button>
              </span>
            )}
          </div>
        )}

        {canConfigure && status?.configured && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
              <label className="flex flex-col gap-1">
                <span className={label}>Till number for this business</span>
                <TextInput
                  inputMode="numeric"
                  value={tillInput}
                  onChange={(e) => setTillInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 5544332"
                />
              </label>
              <button
                type="button"
                disabled={busy === 'till' || tillInput === (status.tillNumber || '')}
                onClick={() => run('till', async () => { await MpesaRepository.saveTill(tillInput); loadStatus(); }, ['Till Saved', 'Payments to this till will show up here.'])}
                className="min-h-10 px-4 bg-amber-500 text-slate-950 font-bold rounded-xl text-sm disabled:opacity-40 cursor-pointer"
              >
                Save till
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!status.configured || !status.tillNumber || busy === 'register'}
                onClick={() => run('register', async () => { await MpesaRepository.registerTill(); loadStatus(); }, ['Till Registered', 'Safaricom will now send till payments to the app.'])}
                className="min-h-10 px-4 border border-app-border rounded-xl text-sm font-semibold text-app-text disabled:opacity-40 cursor-pointer"
              >
                {busy === 'register' ? 'Registering…' : status.registeredAt ? 'Register again' : 'Register till with Safaricom'}
              </button>
              <span className="text-xs text-app-text-muted">
                {status.registeredAt ? `Registered ${when(status.registeredAt)}` : 'Not registered: payments sent straight to the till won’t appear yet.'}
              </span>
              {status.environment === 'sandbox' && (
                <button
                  type="button"
                  disabled={!status.tillNumber || busy === 'test'}
                  onClick={() => run('test', async () => { await MpesaRepository.testTill(); loadStatus(); }, ['Test payment sent', 'KSh 1.00 should show under Payments → Paid to the till within a minute.'])}
                  className="min-h-10 px-4 border border-app-border rounded-xl text-sm font-semibold text-app-text disabled:opacity-40 cursor-pointer"
                >
                  {busy === 'test' ? 'Sending…' : 'Send a test KSh 1'}
                </button>
              )}
            </div>
            {status.environment === 'sandbox' && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!status.tillNumber || busy === 'test'}
                  onClick={() => run('test', async () => { await MpesaRepository.testTill(); loadStatus(); }, ['Test Payment Sent', 'KSh 1.00 from the sandbox test number should show under Payments in a few seconds.'])}
                  className="min-h-10 px-4 border border-app-border rounded-xl text-sm font-semibold text-app-text disabled:opacity-40 cursor-pointer"
                >
                  {busy === 'test' ? 'Sending…' : 'Send a test KSh 1 to the till'}
                </button>
                <span className="text-xs text-app-text-muted">
                  Sandbox till numbers are shared with other developers, so the app registers again every few minutes.
                </span>
              </div>
            )}
          </div>
        )}

        {status && !canConfigure && (
          <p className="text-sm text-app-text-muted">Till: {status.tillNumber || 'not set'}</p>
        )}
      </section>

      <section className={card}>
        <p className="text-sm text-app-text-muted">
          Money paid straight to the till shows on the <span className="font-semibold text-app-text">Payments</span> tab to be sorted.
          {canRequest && (
            <>{' '}To ask a customer to pay, use{' '}
              <button type="button" onClick={() => useUiStore.getState().setActiveTab('prompt')} className="font-semibold text-emerald-600 hover:underline cursor-pointer">Payment Prompts</button> (G then M).</>
          )}
        </p>
      </section>
    </div>
  );
}
