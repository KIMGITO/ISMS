// Business & branches: storage used / available, modules the company can add (request once paid),
// and messages to platform support. Managers only (business.update, enforced in the DB too).

import React, { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../../services/supabaseClient';
import { useNotificationStore } from '../../stores/notificationStore';
import { toUserMessage } from '../../utils/userError';
import { TextInput, Field } from '../shared/Input';
import { formatMoney } from '../../utils/money';
import { StorageUsage, ConfirmButton, Note, Tabs, card, when, btnSave } from '../../features/console/common';

interface Mod { key: string; name: string; addable: boolean; addon_monthly_price: number | null }
interface Req { id: string; module_key: string; status: string; decision_note: string | null; created_at: string }
interface Msg { id: string; from_platform: boolean; sender_name: string | null; body: string; created_at: string }

export default function ModulesSupportCard({ businessId }: { businessId: string }) {
  const toast = useNotificationStore((s) => s.showToast);
  const [tab, setTab] = useState<'storage' | 'modules' | 'messages'>('storage');
  const [mods, setMods] = useState<Mod[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ref, setRef] = useState('');
  const [text, setText] = useState('');
  const load = useCallback(async () => {
    const sb = getSupabase();
    const [m, r, s] = await Promise.all([
      sb.from('plan_modules').select('key, name, addable, addon_monthly_price').order('sort'),
      sb.from('module_requests').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
      sb.from('support_messages').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
    ]);
    setMods((m.data as Mod[]) ?? []);
    setReqs((r.data as Req[]) ?? []);
    setMsgs((s.data as Msg[]) ?? []);
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error } = await getSupabase().rpc(fn, args);
    if (error) return toast('Support', toUserMessage(error, 'That did not work.'), undefined, 'error');
    toast('Support', ok, undefined, 'success');
    load();
  };
  const tone = (s: string) => (s === 'approved' ? 'text-emerald-600' : s === 'rejected' ? 'text-red-600' : 'text-amber-600');

  return (
    <section className={`${card} space-y-3`}>
      <h3 className="font-semibold">Plan, storage and support</h3>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'storage', label: 'Storage' }, { id: 'modules', label: 'Add modules', badge: reqs.filter((r) => r.status === 'pending').length }, { id: 'messages', label: 'Messages' }]} />
      {tab === 'storage' && <StorageUsage businessId={businessId} />}
      {tab === 'modules' && (
        <div className="space-y-2">
          <Note tone="info">Pay first, then request. Platform support turns the module on once your payment is recorded.</Note>
          <Field label="Payment reference (e.g. M-Pesa code)"><TextInput value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          {mods.filter((m) => m.addable).map((m) => {
            const r = reqs.find((x) => x.module_key === m.key);
            return (
              <div key={m.key} className="flex flex-wrap items-center gap-2 rounded-xl bg-app-bg p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{m.name}</p>
                  <p className="text-xs text-app-text-muted">{m.addon_monthly_price != null ? `${formatMoney(Number(m.addon_monthly_price))} a month` : 'Price not set yet, cannot be requested'}</p>
                  {r && <p className={`text-xs font-semibold ${tone(r.status)}`}>{r.status === 'pending' ? 'Waiting for approval' : r.status === 'approved' ? 'Approved' : `Turned down${r.decision_note ? `: ${r.decision_note}` : ''}`}</p>}
                </div>
                {m.addon_monthly_price != null && r?.status !== 'pending' && r?.status !== 'approved' && (
                  <ConfirmButton tone="info" label="Request" question={`Request ${m.name}?`} details="Platform support checks your payment, then turns it on."
                    onConfirm={() => rpc('request_module', { p_business_id: businessId, p_module: m.key, p_payment_reference: ref || null }, 'Request sent.')} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {tab === 'messages' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Write to platform support" className="flex-1" />
            <button type="button" className={btnSave} disabled={!text.trim()} onClick={async () => { await rpc('send_support_message', { p_business_id: businessId, p_body: text }, 'Sent.'); setText(''); }}>Send</button>
          </div>
          {msgs.map((m) => (
            <div key={m.id} className={`rounded-xl p-2.5 text-sm ${m.from_platform ? 'bg-sky-500/10' : 'bg-app-bg'}`}>
              <p className="text-[11px] text-app-text-muted">{m.from_platform ? 'Platform support' : m.sender_name ?? 'You'} · {when(m.created_at)}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
