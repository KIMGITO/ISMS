import type { LocationDraft } from '../api';
import { CUSTOMER_FIELDS as F, LIMITS } from '../customerProfile';
import { useStorefront } from '../store';
import { fieldClass, formatPrice } from '../ui';

/**
 * The delivery location in parts, the same parts staff see in the app: area, estate or street,
 * building and house number, a landmark and instructions for the rider.
 */
export default function DeliveryLocationFields({ value, onChange, required = false, showNotes = true }: {
  value: LocationDraft;
  onChange: (next: LocationDraft) => void;
  /** At checkout the area and street are needed; on the profile everything can wait. */
  required?: boolean;
  showNotes?: boolean;
}) {
  const { business, deliveryZones } = useStorefront();
  const set = (key: keyof LocationDraft) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  const optional = <span className="font-normal text-muted"> (optional)</span>;

  return (
    <div className="space-y-4">
      {deliveryZones.length > 0 && (
        <label className="block font-medium">
          {F.zone.label}
          <select required={required} value={deliveryZones.some((z) => z.id === value.zoneId) ? value.zoneId : ''} onChange={set('zoneId')} className={fieldClass}>
            <option value="">{F.zone.placeholder}</option>
            {deliveryZones.map((z) => <option key={z.id} value={z.id}>{z.name} ({formatPrice(business.currency, z.fee)})</option>)}
          </select>
        </label>
      )}
      <label className="block font-medium">
        {F.address.label}
        <input required={required} maxLength={LIMITS.address} autoComplete="street-address" value={value.address} onChange={set('address')} placeholder={F.address.placeholder} className={fieldClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block font-medium">
          {F.building.label}{optional}
          <input maxLength={LIMITS.building} autoComplete="address-line2" value={value.building} onChange={set('building')} placeholder={F.building.placeholder} className={fieldClass} />
        </label>
        <label className="block font-medium">
          {F.landmark.label}{optional}
          <input maxLength={LIMITS.landmark} value={value.landmark} onChange={set('landmark')} placeholder={F.landmark.placeholder} className={fieldClass} />
        </label>
      </div>
      {showNotes && (
        <label className="block font-medium">
          {F.notes.label}{optional}
          <input maxLength={LIMITS.notes} value={value.notes} onChange={set('notes')} placeholder={F.notes.placeholder} className={fieldClass} />
        </label>
      )}
    </div>
  );
}
