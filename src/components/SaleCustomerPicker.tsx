// "Add customer" for a finished walk-in sale: choose who bought it, and they get the points.
import { useMemo, useState } from 'react';
import { RefreshCw, UserPlus } from 'lucide-react';
import type { Transaction } from '../types';
import SearchableDropdown from './SearchableDropdown';
import { useCustomerStore } from '../stores/customerStore';
import { useNotificationStore } from '../stores/notificationStore';
import { attachSaleToCustomer, cannotAttachReason } from '../services/saleCustomer';
import { toUserMessage } from '../utils/userError';
import { usePointsEnabled } from '../services/loyalty/pointValue';

interface Props {
  transaction: Transaction;
  onAttached: (tx: Transaction) => void;
  /** Smaller button, for the Quick Sale banner. */
  compact?: boolean;
  className?: string;
}

export function SaleCustomerPicker({ transaction, onAttached, compact, className = '' }: Props) {
  const customers = useCustomerStore((s) => s.customers);
  const showToast = useNotificationStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [saving, setSaving] = useState(false);
  const pointsOn = usePointsEnabled(transaction.businessId);

  const items = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: [c.phone, c.accountNumber && `Acc ${c.accountNumber}`, pointsOn && `${(c.loyaltyPoints || 0).toLocaleString()} pts`].filter(Boolean).join(' · '),
      })),
    [customers, pointsOn],
  );

  if (cannotAttachReason(transaction)) return null;

  const save = async () => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer || saving) return;
    setSaving(true);
    try {
      const result = await attachSaleToCustomer(transaction, customer);
      const total = (customer.loyaltyPoints || 0) + (result.points || 0);
      const pts = !pointsOn ? '' : result.points > 0 ? ` +${result.points.toLocaleString()} points (${total.toLocaleString()} in total).` : ` ${total.toLocaleString()} points in total.`;
      showToast(
        'Customer added',
        result.offline ? `${customer.name}${pts} when the sale syncs.` : `Sale is on ${customer.name}'s account.${pts}`,
        undefined,
        'success',
      );
      setOpen(false);
      setCustomerId('');
      onAttached(result.transaction);
    } catch (err) {
      showToast('Add customer', toUserMessage(err, 'Could not add the customer. Please try again.'), undefined, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-shortcut="add-customer"
        className={
          compact
            ? `shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-app-card text-app-text text-xs font-semibold hover:bg-app-bg cursor-pointer ${className}`
            : `w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 cursor-pointer ${className}`
        }
      >
        <UserPlus size={compact ? 14 : 16} aria-hidden="true" /> Add customer
      </button>
    );
  }

  return (
    // Keeps the host screen's shortcuts (arrows, Enter, Esc, letters) out of the picker.
    <div className={`space-y-2 ${className}`} onKeyDown={(e) => e.stopPropagation()}>
      <p className="text-xs text-app-text-muted">Who bought this? They get the points for it.</p>
      <SearchableDropdown
        items={items}
        selectedValue={customerId}
        onChange={setCustomerId}
        placeholder="Choose a customer"
        searchPlaceholder="Name, phone or account"
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setCustomerId(''); }}
          className="py-2 rounded-lg text-sm bg-app-bg text-app-text-muted hover:text-app-text cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!customerId || saving}
          className="py-2 rounded-lg text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving && <RefreshCw size={14} className="animate-spin" />} Save
        </button>
      </div>
    </div>
  );
}

export default SaleCustomerPicker;
