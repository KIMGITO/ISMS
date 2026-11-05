// src/components/CustomerGroupFields.tsx
// The customer type, payment terms and delivery rhythm selects, shared by the add and edit forms.

import React from 'react';
import {
  CUSTOMER_TYPE_LABELS,
  CustomerType,
  DELIVERY_FREQUENCY_LABELS,
  DeliveryFrequency,
  PAYMENT_TERMS_LABELS,
  PaymentTerms,
} from '../types';

export interface CustomerGroupValues {
  customerType: CustomerType;
  paymentTerms: PaymentTerms;
  deliveryFrequency: DeliveryFrequency;
  notifyService: boolean;
  notifyPromotions: boolean;
}

const FIELDS = [
  { key: 'customerType', label: 'Customer Type', options: CUSTOMER_TYPE_LABELS },
  { key: 'paymentTerms', label: 'Payment Terms', options: PAYMENT_TERMS_LABELS },
  { key: 'deliveryFrequency', label: 'Delivery Schedule', options: DELIVERY_FREQUENCY_LABELS },
] as const;

interface Props {
  values: CustomerGroupValues;
  onChange: (key: keyof CustomerGroupValues, value: string | boolean) => void;
}

export default function CustomerGroupFields({ values, onChange }: Props) {
  return (
    <div className="flex flex-col gap-3">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {FIELDS.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-[10px] font-bold text-app-text-muted uppercase">
          {field.label}
          <select
            value={values[field.key]}
            onChange={(e) => onChange(field.key, e.target.value)}
            className="bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs font-medium normal-case text-app-text"
          >
            {Object.entries(field.options).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
    <div className="flex flex-col gap-2 text-xs text-app-text">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={values.notifyService} onChange={(e) => onChange('notifyService', e.target.checked)} className="accent-amber-500" />
        Send order updates and reminders
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={values.notifyPromotions} onChange={(e) => onChange('notifyPromotions', e.target.checked)} className="accent-amber-500" />
        Customer agreed to receive offers
      </label>
    </div>
    </div>
  );
}
