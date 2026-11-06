// src/components/CustomerGroupFields.tsx
// The customer type, payment terms and delivery rhythm choices, shared by the add and edit forms.

import React from 'react';
import {
  CUSTOMER_TYPE_LABELS,
  CustomerType,
  DELIVERY_FREQUENCY_LABELS,
  DeliveryFrequency,
  PAYMENT_TERMS_LABELS,
  PaymentTerms,
} from '../types';
import SearchableDropdown from './SearchableDropdown';
import { Checkbox } from './shared/Checkbox';

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
        <div key={field.key} className="flex flex-col gap-1 text-xs font-medium text-app-text">
          <span>{field.label}</span>
          <SearchableDropdown
            items={Object.entries(field.options).map(([value, label]) => ({ id: value, label }))}
            selectedValue={values[field.key]}
            onChange={(value) => onChange(field.key, value)}
            placeholder={field.label}
          />
        </div>
      ))}
    </div>
    <div className="flex flex-col gap-2 text-xs text-app-text">
      <Checkbox
        checked={values.notifyService}
        onChange={(on) => onChange('notifyService', on)}
        label="Send order updates and reminders"
      />
      <Checkbox
        checked={values.notifyPromotions}
        onChange={(on) => onChange('notifyPromotions', on)}
        label="Customer agreed to receive offers"
      />
    </div>
    </div>
  );
}
