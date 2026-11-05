// src/components/DuplicateCustomers.tsx
// Lets staff review customers who may be the same person, then merge or dismiss them.

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Globe, X } from 'lucide-react';
import { Customer } from '../types';
import SearchableDropdown from './SearchableDropdown';
import {
  defaultKeepId,
  dismissDuplicateCustomers,
  DuplicateGroup,
  findDuplicateCustomers,
  mergeCustomers,
  NO_EMAIL_PLACEHOLDER,
  previewMerge,
} from '../services/customerMerge';
import { CustomerRepository } from '../services/repositories';
import { useAppStore } from '../stores/appStore';
import { useCustomerStore } from '../stores/customerStore';
import { toUserMessage } from '../utils/userError';

interface Props {
  businessId: string;
  customers: Customer[];
  onClose: () => void;
  onMerged: (keepId: string) => void;
}

const money = (amount: number) => `KSh ${amount.toLocaleString()}`;
const purchases = (count: number) => `${count} ${count === 1 ? 'purchase' : 'purchases'}`;

function Choice({ label, name, options, value, onChange }: {
  label: string;
  name: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const unique = [...new Set(options)];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-bold text-app-text mb-1">{label}</legend>
      {unique.map((option) => (
        <label key={option} className="flex items-center gap-2 text-sm text-app-text break-all">
          <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} className="accent-amber-500" />
          {option || 'No email'}
        </label>
      ))}
    </fieldset>
  );
}

function MergeReview({ first, second, accountIds, onBack, onDone }: {
  first: Customer;
  second: Customer;
  accountIds: string[];
  onBack: () => void;
  onDone: (keepId: string) => void;
}) {
  const { showToast } = useAppStore();
  const [keepId, setKeepId] = useState(() => defaultKeepId(first, second, accountIds));
  const keep = keepId === first.id ? first : second;
  const merge = keepId === first.id ? second : first;
  const realEmail = (c: Customer) => (c.email === NO_EMAIL_PLACEHOLDER ? '' : c.email ?? '');

  const [name, setName] = useState(keep.name);
  const [phone, setPhone] = useState(keep.phone);
  const [email, setEmail] = useState(realEmail(keep) || realEmail(merge));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const result = previewMerge(keep, merge);

  const chooseKeep = (id: string) => {
    const kept = id === first.id ? first : second;
    const other = id === first.id ? second : first;
    setKeepId(id);
    setName(kept.name);
    setPhone(kept.phone);
    setEmail(realEmail(kept) || realEmail(other));
    setConfirming(false);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await mergeCustomers(keepId, merge.id, name, phone, email);
      onDone(keepId);
    } catch (err) {
      showToast('Could Not Merge', toUserMessage(err, 'Nothing changed. Please try again.'), undefined, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="self-start flex items-center gap-1 text-xs font-bold text-app-text-muted hover:text-app-text cursor-pointer">
        <ArrowLeft size={14} /> Back
      </button>

      <div>
        <h4 className="text-xs font-bold text-app-text mb-2">Which record do you keep?</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[first, second].map((c) => (
            <label key={c.id} className={`rounded-2xl border p-3 cursor-pointer flex flex-col gap-1 text-xs text-app-text ${keepId === c.id ? 'border-amber-500 bg-amber-500/10' : 'border-app-border'}`}>
              <span className="flex items-center gap-2 font-bold text-sm">
                <input type="radio" name="keep" checked={keepId === c.id} onChange={() => chooseKeep(c.id)} className="accent-amber-500" />
                {c.name}
              </span>
              {accountIds.includes(c.id) && (
                <span className="flex items-center gap-1 text-app-text-muted"><Globe size={12} /> Has an online account</span>
              )}
              <span className="text-app-text-muted">{c.phone}</span>
              <span>Debt {money(c.debtBalance ?? 0)} · Wallet {money(c.walletBalance ?? 0)}</span>
              <span>{c.loyaltyPoints} points · {purchases(c.purchasesCount)} · {c.tier}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-app-text-muted mt-2">
          The kept record's customer type, payment terms, delivery schedule and notes stay.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Choice label="Name" name="merge-name" options={[keep.name, merge.name]} value={name} onChange={setName} />
        <Choice label="Phone" name="merge-phone" options={[keep.phone, merge.phone]} value={phone} onChange={setPhone} />
        <Choice label="Email" name="merge-email" options={[realEmail(keep), realEmail(merge)]} value={email} onChange={setEmail} />
      </div>

      <div className="rounded-2xl bg-app-bg p-3 text-xs text-app-text flex flex-col gap-1">
        <p className="font-bold">After merging</p>
        <p>Debt {money(result.debt)} · Wallet {money(result.wallet)}</p>
        <p>{result.points} points · {purchases(result.purchases)} · {result.tier}</p>
        {result.offset > 0 && <p className="text-app-text-muted">{money(result.offset)} of wallet money clears debt.</p>}
        <p className="text-app-text-muted">All sales, payments and online logins move to the kept record.</p>
      </div>

      {confirming ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 flex flex-col gap-2">
          <p className="flex items-start gap-2 text-xs text-app-text">
            <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
            {merge.name}'s record will close and this can't be undone from the app. Make sure they are the same person.
          </p>
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy} className="flex-1 py-2.5 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs disabled:opacity-40 cursor-pointer">
              {busy ? 'Merging…' : 'Yes, merge them'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className="flex-1 py-2.5 border border-app-border text-app-text font-bold rounded-xl text-xs cursor-pointer">
              Go back
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="py-2.5 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs cursor-pointer">
          Merge records
        </button>
      )}
    </div>
  );
}

export default function DuplicateCustomers({ businessId, customers, onClose, onMerged }: Props) {
  const { showToast } = useAppStore();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pair, setPair] = useState<{ first: Customer; second: Customer; accountIds: string[] } | null>(null);
  const [manualFirst, setManualFirst] = useState('');
  const [manualSecond, setManualSecond] = useState('');

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setGroups(await findDuplicateCustomers(businessId));
    } catch (err) {
      console.error('Could not load duplicate customers:', err);
      setLoadFailed(true);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const byId = (id: string) => customers.find((c) => c.id === id);

  const dismiss = async (group: DuplicateGroup) => {
    try {
      await dismissDuplicateCustomers(businessId, group.customerIds);
      load();
    } catch (err) {
      showToast('Could Not Dismiss', toUserMessage(err, 'Please try again.'), undefined, 'error');
    }
  };

  const merged = async (keepId: string, mergedId: string) => {
    const fresh = await CustomerRepository.getById(keepId);
    useCustomerStore.setState((state) => ({
      customers: state.customers
        .filter((c) => c.id !== mergedId)
        .map((c) => (c.id === keepId && fresh ? fresh : c)),
    }));
    showToast('Customers Merged', `${fresh?.name ?? 'The customer'} now has one record.`, undefined, 'success');
    onMerged(keepId);
    setPair(null);
    setManualFirst('');
    setManualSecond('');
    load();
  };

  const customerItems = customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.phone }));
  const manualA = byId(manualFirst);
  const manualB = byId(manualSecond);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate customers"
        onClick={(e) => e.stopPropagation()}
        className="bg-app-card border border-app-border rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col"
      >
        <div className="shrink-0 px-5 py-4 border-b border-app-border flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-app-text">Duplicate customers</h3>
            <p className="text-[11px] text-app-text-muted">Check that they are the same person before merging.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-full hover:bg-app-bg text-app-text cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {pair ? (
            <MergeReview
              key={`${pair.first.id}-${pair.second.id}`}
              first={pair.first}
              second={pair.second}
              accountIds={pair.accountIds}
              onBack={() => setPair(null)}
              onDone={(keepId) => merged(keepId, keepId === pair.first.id ? pair.second.id : pair.first.id)}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {loadFailed && (
                <div className="text-xs text-app-text-muted">
                  Duplicates could not be loaded.{' '}
                  <button onClick={load} className="font-bold text-amber-500 underline cursor-pointer">Try again</button>
                </div>
              )}
              {!groups && !loadFailed && <p className="text-xs text-app-text-muted">Checking your customers…</p>}
              {groups?.length === 0 && (
                <p className="text-xs text-app-text-muted">No customers share a phone number or email.</p>
              )}

              {groups?.map((group) => {
                const members = group.customerIds.map(byId).filter(Boolean) as Customer[];
                if (members.length < 2) return null;
                return (
                  <div key={group.customerIds.join()} className="rounded-2xl border border-app-border p-3 flex flex-col gap-2">
                    <p className="text-[11px] font-bold text-app-text-muted">
                      Same {group.matchOn}: {group.matchOn === 'phone' ? members[0].phone : group.matchValue}
                    </p>
                    {members.map((c) => (
                      <div key={c.id} className="text-xs text-app-text flex flex-wrap items-center gap-x-2">
                        <span className="font-bold">{c.name}</span>
                        {group.accountCustomerIds.includes(c.id) && (
                          <span className="flex items-center gap-1 text-app-text-muted"><Globe size={12} /> Online account</span>
                        )}
                        <span className="text-app-text-muted">
                          Debt {money(c.debtBalance ?? 0)} · {c.loyaltyPoints} points · {purchases(c.purchasesCount)}
                        </span>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2 mt-1">
                      <button
                        onClick={() => setPair({ first: members[0], second: members[1], accountIds: group.accountCustomerIds })}
                        className="px-3 py-2 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs cursor-pointer"
                      >
                        {members.length > 2 ? `Review first two of ${members.length}` : 'Review and merge'}
                      </button>
                      <button
                        onClick={() => dismiss(group)}
                        className="px-3 py-2 border border-app-border text-app-text font-bold rounded-xl text-xs cursor-pointer"
                      >
                        Different people
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-2xl bg-app-bg p-3 flex flex-col gap-2">
                <p className="text-xs font-bold text-app-text">Merge two customers yourself</p>
                <p className="text-[11px] text-app-text-muted">For someone who signed up with a different number or email.</p>
                <SearchableDropdown items={customerItems} selectedValue={manualFirst} onChange={setManualFirst} placeholder="First customer" searchPlaceholder="Search customers" />
                <SearchableDropdown items={customerItems} selectedValue={manualSecond} onChange={setManualSecond} placeholder="Second customer" searchPlaceholder="Search customers" />
                <button
                  disabled={!manualA || !manualB || manualA.id === manualB.id}
                  onClick={() => manualA && manualB && setPair({ first: manualA, second: manualB, accountIds: [] })}
                  className="self-start px-3 py-2 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs disabled:opacity-40 cursor-pointer"
                >
                  Review and merge
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
