// src/components/payments/AirtelPaymentsPanel.tsx
// Payments → Airtel Money: connect this business's Airtel Africa developer app, so staff can
// send Airtel Money prompts. The client secret goes to the server and never comes back.
//
// Customers who pay the Airtel merchant code themselves: Airtel's open API doesn't announce
// those, so they're recorded on the Payments tab with the Airtel transaction ID.

import SearchableDropdown from '../SearchableDropdown';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Send, Settings2, Smartphone } from 'lucide-react';
import { AirtelRepository, type AirtelStatus } from '../../services/repositories';
import { useAppStore } from '../../stores/appStore';
import { useUiStore } from '../../stores/uiStore';
import { hasRolePermission } from '../../utils/permissions';
import { toUserMessage } from '../../utils/userError';
import { canOpenScreen } from '../../utils/screens';

const card = 'bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 shadow-sm';
const input = 'w-full bg-app-bg text-app-text border border-app-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500';
const label = 'block text-xs font-semibold text-app-text-muted mb-1';

export default function AirtelPaymentsPanel() {
  const { showToast, currentEmployee } = useAppStore();
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const role = currentEmployee?.role || 'Guest';
  const canConfigure = hasRolePermission(role, 'settings.integrations');

  const [status, setStatus] = useState<AirtelStatus | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [environment, setEnvironment] = useState<'staging' | 'production'>('staging');
  const [merchantCode, setMerchantCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = async () => {
    try {
      const s = await AirtelRepository.status();
      setStatus(s);
      setEnvironment(s.environment);
      setMerchantCode(s.merchantCode || '');
      setEditing(!s.configured);
      setLoadError('');
    } catch (err) {
      setStatus(null);
      setLoadError(toUserMessage(err, "Couldn't reach the Airtel Money service."));
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setBusy('save');
    try {
      await AirtelRepository.saveSettings({
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
        environment,
        merchantCode: merchantCode.trim() || undefined,
      });
      setClientId('');
      setClientSecret('');
      await load();
      showToast('Airtel Money connected', 'Airtel accepted the keys. Paste the callback URL into your Airtel app.', undefined, 'success');
    } catch (err) {
      showToast('Airtel Money', toUserMessage(err, "Couldn't save. Please try again."), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await AirtelRepository.remove();
      setConfirmRemove(false);
      await load();
      showToast('Airtel Money disconnected', 'Prompts are off until it is set up again.', undefined, 'success');
    } catch (err) {
      showToast('Airtel Money', toUserMessage(err, "Couldn't remove it. Please try again."), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied', 'Callback URL copied.', undefined, 'success');
    } catch {
      showToast('Copy', 'Select the URL and copy it by hand.', undefined, 'info');
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-200">
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-app-text flex items-center gap-2">
            <Settings2 size={16} className="text-red-500" /> Airtel Money connection
          </h3>
          {status && (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${status.configured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/15 text-amber-700'}`}>
              {status.configured ? `Connected (${status.environment === 'production' ? 'live' : 'test'})` : 'Not set up yet'}
            </span>
          )}
        </div>

        {status === undefined && <p className="text-sm text-app-text-muted">Checking…</p>}
        {loadError && <p className="text-sm text-red-500">{loadError}</p>}

        {status && !status.enabled && (
          <p className="text-xs rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-2.5 mb-3 flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            Airtel Money is off. Turn it on in Payments → Methods.
          </p>
        )}

        {status?.configured && !editing && (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-app-text-muted">Mode</dt><dd className="text-app-text">{status.environment === 'production' ? 'Live' : 'Test (staging)'}</dd>
              <dt className="text-app-text-muted">Country</dt><dd className="text-app-text">{status.country} · {status.currency}</dd>
              {status.clientIdHint && (<><dt className="text-app-text-muted">Client ID</dt><dd className="text-app-text font-mono">{status.clientIdHint}</dd></>)}
              <dt className="text-app-text-muted">Merchant code</dt><dd className="text-app-text">{status.merchantCode || 'Not set'}</dd>
            </dl>

            {status.callbackUrl && (
              <div>
                <span className={label}>Callback URL (paste it into your app on the Airtel developer portal)</span>
                <div className="flex gap-2">
                  <input readOnly value={status.callbackUrl} className={`${input} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" onClick={() => void copy(status.callbackUrl!)} className="min-h-10 px-3 border border-app-border rounded-xl text-app-text cursor-pointer" aria-label="Copy callback URL">
                    <Copy size={14} />
                  </button>
                </div>
                <p className="text-xs text-app-text-muted mt-1">Keep this private: it identifies your business to the app.</p>
              </div>
            )}

            {canConfigure && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing(true)} className="min-h-10 px-4 border border-app-border rounded-xl text-sm font-semibold text-app-text cursor-pointer">
                  Change keys or settings
                </button>
                {!confirmRemove ? (
                  <button type="button" onClick={() => setConfirmRemove(true)} className="min-h-10 px-4 border border-red-500/40 text-red-500 rounded-xl text-sm font-semibold cursor-pointer">
                    Disconnect
                  </button>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-app-text-muted">Disconnect Airtel Money?</span>
                    <button type="button" disabled={busy === 'remove'} onClick={() => void remove()} className="min-h-10 px-4 bg-red-600 text-white rounded-xl text-sm font-bold cursor-pointer disabled:opacity-40">
                      {busy === 'remove' ? 'Removing…' : 'Yes, disconnect'}
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(false)} className="text-xs text-app-text-muted hover:underline cursor-pointer">Keep it</button>
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {status && editing && canConfigure && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
          >
            <p className="text-xs text-app-text-muted">
              Paste your keys from developers.airtel.africa.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className={label}>Client ID</span>
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={status.configured ? 'Leave empty to keep the current one' : ''} className={input} autoComplete="off" />
              </label>
              <label>
                <span className={label}>Client secret</span>
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={status.configured ? 'Leave empty to keep the current one' : ''} className={input} autoComplete="new-password" />
              </label>
              <label>
                <span className={label}>Mode</span>
                <SearchableDropdown
                  items={[{ id: 'staging', label: 'Test (staging)' }, { id: 'production', label: 'Live' }]}
                  selectedValue={environment}
                  onChange={(v) => setEnvironment(v as 'staging' | 'production')}
                  placeholder="Choose"
                />
              </label>
              <label>
                <span className={label}>Airtel merchant code (optional)</span>
                <input value={merchantCode} onChange={(e) => setMerchantCode(e.target.value.replace(/\s/g, ''))} placeholder="Shown to staff so customers can pay it" className={input} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy === 'save' || (!status.configured && (!clientId.trim() || !clientSecret.trim()))}
                className="min-h-10 px-5 bg-amber-500 text-slate-950 font-bold rounded-xl text-sm disabled:opacity-40 cursor-pointer"
              >
                {busy === 'save' ? 'Checking with Airtel…' : 'Save and check'}
              </button>
              {status.configured && (
                <button type="button" onClick={() => setEditing(false)} className="min-h-10 px-4 text-sm text-app-text-muted hover:underline cursor-pointer">Cancel</button>
              )}
            </div>
          </form>
        )}

        {status && !status.configured && !canConfigure && (
          <p className="text-sm text-app-text-muted">Ask the admin to connect Airtel Money.</p>
        )}
      </section>

      <section className={card}>
        <h3 className="text-sm font-bold text-app-text flex items-center gap-2 mb-2">
          <Smartphone size={16} className="text-red-500" /> Taking Airtel Money
        </h3>
        <ul className="text-sm text-app-text-muted flex flex-col gap-2">
          <li className="flex gap-2"><Send size={14} className="shrink-0 mt-0.5 text-app-text" />
            <span><strong className="text-app-text">Send a prompt:</strong> the customer enters their PIN on their phone.</span>
          </li>
          <li className="flex gap-2"><CheckCircle2 size={14} className="shrink-0 mt-0.5 text-app-text" />
            <span><strong className="text-app-text">They paid on their own{status?.merchantCode ? ` to ${status.merchantCode}` : ''}:</strong> record it on the Payments tab with the transaction ID.</span>
          </li>
        </ul>
        {canOpenScreen(role, 'prompt') && (
          <button
            type="button"
            onClick={() => setActiveTab('prompt')}
            className="mt-4 min-h-10 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 cursor-pointer"
          >
            <Send size={14} /> Open payment prompts
          </button>
        )}
      </section>
    </div>
  );
}
