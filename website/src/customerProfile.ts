// The customer details every part of the business uses, shared by the website and the ISMS app
// (the app imports this file, like heroSlides.ts). The database applies the same rules
// (fn_normalize_phone, fn_customer_standard in 20261128001_customer_profile.sql).
//
// Needed to sign up: full name and phone number. Everything else can be added later.

/** Labels and examples, so both apps ask in the same words. */
export const CUSTOMER_FIELDS = {
  name: { label: 'Full name', placeholder: 'e.g. Jane Wanjiru' },
  phone: { label: 'Phone number', placeholder: '0712 345 678' },
  email: { label: 'Email', placeholder: 'e.g. jane@gmail.com' },
  zone: { label: 'Delivery area', placeholder: 'Choose your area' },
  address: { label: 'Estate, street or road', placeholder: 'e.g. Kahawa West, Kamiti Road' },
  building: { label: 'Building and house no.', placeholder: 'e.g. Baraka Flats, House B4' },
  landmark: { label: 'Nearby landmark', placeholder: 'e.g. Opposite Shell petrol station' },
  notes: { label: 'Delivery instructions', placeholder: 'e.g. Call when you arrive at the gate' },
} as const;

export const NAME_MAX = 100;
export const LIMITS = { address: 200, building: 120, landmark: 120, notes: 300 } as const;

export const MESSAGES = {
  name: 'Please enter your full name.',
  phone: 'Please enter a valid phone number, like 0712 345 678.',
} as const;

/** One space between words, trimmed, at most 100 characters. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
}

/** A Kenyan mobile number (Safaricom, Airtel, Telkom; 07… or 01…) as +254…, or null. */
function kenyan(digits: string): string | null {
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  return null;
}

/**
 * Any phone number in the one stored form, or null when it can't be used.
 * Kenyan numbers work in every usual form. A number typed with its country code (+256…, 00256…)
 * is kept when it has 9 to 15 digits. `countryCode` is the country picked beside the box in the app.
 */
export function normalizePhone(input: string, countryCode = '+254'): string | null {
  let raw = (input ?? '').trim().replace(/^00/, '+');
  if (!raw.startsWith('+') && countryCode !== '+254') {
    raw = `${countryCode}${raw.replace(/\D/g, '').replace(/^0/, '')}`;
  }
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) {
    if (digits.startsWith('254')) return kenyan(digits);
    return /^[1-9]\d{8,14}$/.test(digits) ? `+${digits}` : null;
  }
  return kenyan(digits);
}

export const isValidPhone = (input: string, countryCode = '+254') => normalizePhone(input, countryCode) !== null;

/** Shows +254712345678 as 0712 345 678; other countries as stored. */
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = phone.match(/^\+254(\d{3})(\d{3})(\d{3})$/);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : phone;
}

export interface DeliveryLocation {
  zoneName?: string | null;
  address?: string | null;
  building?: string | null;
  landmark?: string | null;
}

/** The delivery location as one line for orders, receipts and riders. */
export function formatLocation(loc: DeliveryLocation): string {
  return [loc.building, loc.address, loc.zoneName, loc.landmark]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** True when there is enough to find the door. */
export const hasLocation = (loc: DeliveryLocation) => Boolean((loc.address ?? '').trim() || (loc.building ?? '').trim());
