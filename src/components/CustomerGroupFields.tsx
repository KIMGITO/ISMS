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
}

const FIELDS = [
  { key: 'customerType', label: 'Customer Type', options: CUSTOMER_TYPE_LABELS },
  { key: 'paymentTerms', label: 'Payment Terms', options: PAYMENT_TERMS_LABELS },
  { key: 'deliveryFrequency', label: 'Delivery Schedule', options: DELIVERY_FREQUENCY_LABELS },
] as const;

interface Props {
  values: CustomerGroupValues;
  onChange: (key: keyof CustomerGroupValues, value: string) => void;
}

export default function CustomerGroupFields({ values, onChange }: Props) {
  return (
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
  );
}
