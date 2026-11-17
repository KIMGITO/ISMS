// src/components/CustomerDetailsFields.tsx
// A customer's contact details and delivery location: the same fields, words and rules as the
// website's sign-up and profile (website/src/customerProfile.ts). Used by Add and Edit customer.

import React, { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { CUSTOMER_FIELDS as F, LIMITS, MESSAGES, NAME_MAX, normalizePhone } from '../../website/src/customerProfile';
import { SUPPORTED_COUNTRIES } from '../utils/phoneUtils';
import { Field, TextInput } from './shared/Input';
import SearchableDropdown from './SearchableDropdown';
import { DeliveryZone, fetchActiveZones } from './DeliveryZonesEditor';
import type { Customer } from '../types';

export interface CustomerDetailsDraft {
  name: string;
  countryCode: string;
  phone: string;
  email: string;
  deliveryZoneId: string;
  deliveryAddress: string;
  deliveryBuilding: string;
  deliveryLandmark: string;
  deliveryNotes: string;
}

export const emptyDetails = (): CustomerDetailsDraft => ({
  name: '', countryCode: '+254', phone: '', email: '',
  deliveryZoneId: '', deliveryAddress: '', deliveryBuilding: '', deliveryLandmark: '', deliveryNotes: '',
});

/** A saved customer as the form edits it: Kenyan numbers shown as 07…, others split from their code. */
export function detailsOf(c: Customer): CustomerDetailsDraft {
  const country = SUPPORTED_COUNTRIES.find((x) => x.code !== '+254' && c.phone.startsWith(x.code));
  const kenyan = c.phone.match(/^\+254(\d{9})$/);
  return {
    name: c.name,
    countryCode: country?.code ?? '+254',
    phone: country ? c.phone.slice(country.code.length) : kenyan ? `0${kenyan[1]}` : c.phone,
    email: c.email && c.email !== 'no-email@kaykays.com' ? c.email : '',
    deliveryZoneId: c.deliveryZoneId ?? '',
    deliveryAddress: c.deliveryAddress ?? '',
    deliveryBuilding: c.deliveryBuilding ?? '',
    deliveryLandmark: c.deliveryLandmark ?? '',
    deliveryNotes: c.deliveryNotes ?? '',
  };
}

export type DetailsErrors = Partial<Record<'name' | 'phone' | 'email', string>>;

export function checkDetails(d: CustomerDetailsDraft): DetailsErrors {
  const errors: DetailsErrors = {};
  if (!d.name.trim()) errors.name = MESSAGES.name;
  if (!normalizePhone(d.phone, d.countryCode)) errors.phone = MESSAGES.phone;
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) errors.email = 'Please check the email address.';
  return errors;
}

/** The values to save. Call only after checkDetails found nothing. */
export function detailsToCustomer(d: CustomerDetailsDraft): Partial<Customer> {
  return {
    name: d.name.trim().replace(/\s+/g, ' '),
    phone: normalizePhone(d.phone, d.countryCode) ?? d.phone,
    email: d.email.trim().toLowerCase(),
    deliveryZoneId: d.deliveryZoneId || null,
    deliveryAddress: d.deliveryAddress.trim(),
    deliveryBuilding: d.deliveryBuilding.trim(),
    deliveryLandmark: d.deliveryLandmark.trim(),
    deliveryNotes: d.deliveryNotes.trim(),
  };
}

/** The branch's delivery areas, loaded once per form. */
export function useDeliveryZones(businessId: string | null | undefined): DeliveryZone[] {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  useEffect(() => {
    if (!businessId) return;
    fetchActiveZones(businessId).then(setZones).catch(() => setZones([]));
  }, [businessId]);
  return zones;
}

export default function CustomerDetailsFields({ value, onChange, errors = {}, zones, phoneExtra }: {
  value: CustomerDetailsDraft;
  onChange: (next: CustomerDetailsDraft) => void;
  errors?: DetailsErrors;
  zones: DeliveryZone[];
  /** Shown under the phone box, e.g. "Jane already has this number". */
  phoneExtra?: React.ReactNode;
}) {
  const set = (key: keyof CustomerDetailsDraft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });

  return (
    <div className="flex flex-col gap-3">
      <Field label={`${F.name.label} *`} error={errors.name}>
        <TextInput autoComplete="off" maxLength={NAME_MAX} placeholder={F.name.placeholder} value={value.name} onChange={set('name')} invalid={!!errors.name} />
      </Field>

      <Field label={`${F.phone.label} *`} error={errors.phone} group>
        <div className="flex gap-2">
          <div className="w-24 shrink-0">
            <SearchableDropdown
              items={SUPPORTED_COUNTRIES.map((c) => ({ id: c.code, label: c.code }))}
              selectedValue={value.countryCode}
              onChange={(code) => onChange({ ...value, countryCode: code })}
              placeholder="Code"
            />
          </div>
          <TextInput type="tel" inputMode="tel" autoComplete="off" placeholder={F.phone.placeholder} value={value.phone} onChange={set('phone')} invalid={!!errors.phone} inputClassName="tabular-nums" aria-label={F.phone.label} />
        </div>
        {phoneExtra}
      </Field>

      <Field label={F.email.label} error={errors.email}>
        <TextInput type="email" inputMode="email" autoComplete="off" placeholder={F.email.placeholder} value={value.email} onChange={set('email')} invalid={!!errors.email} />
      </Field>

      <div className="flex items-center gap-1.5 pt-1 text-xs font-semibold text-app-text">
        <MapPin size={14} className="text-amber-500" /> Delivery location
      </div>
      {zones.length > 0 && (
        <Field label={F.zone.label} group>
          <SearchableDropdown
            items={[{ id: '', label: 'No area' }, ...zones.map((z) => ({ id: z.id, label: z.name }))]}
            selectedValue={value.deliveryZoneId}
            onChange={(id) => onChange({ ...value, deliveryZoneId: id })}
            placeholder={F.zone.placeholder}
          />
        </Field>
      )}
      <Field label={F.address.label}>
        <TextInput maxLength={LIMITS.address} placeholder={F.address.placeholder} value={value.deliveryAddress} onChange={set('deliveryAddress')} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={F.building.label}>
          <TextInput maxLength={LIMITS.building} placeholder={F.building.placeholder} value={value.deliveryBuilding} onChange={set('deliveryBuilding')} />
        </Field>
        <Field label={F.landmark.label}>
          <TextInput maxLength={LIMITS.landmark} placeholder={F.landmark.placeholder} value={value.deliveryLandmark} onChange={set('deliveryLandmark')} />
        </Field>
      </div>
      <Field label={F.notes.label}>
        <TextInput maxLength={LIMITS.notes} placeholder={F.notes.placeholder} value={value.deliveryNotes} onChange={set('deliveryNotes')} />
      </Field>
    </div>
  );
}
