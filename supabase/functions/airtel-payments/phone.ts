// supabase/functions/airtel-payments/phone.ts
// Kenyan mobile numbers for Airtel Money, and a guess at which network a number is on.
// Shared by the edge functions and the app (the prompt screen suggests the right provider).

/** Airtel wants the number without the country code: 7XXXXXXXX or 1XXXXXXXX. */
export function toAirtelMsisdn(phone: string): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const local = digits.startsWith("254") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[17]\d{8}$/.test(local) ? local : null;
}

export type KenyaNetwork = "safaricom" | "airtel" | "telkom";

// Prefixes as allocated by the Communications Authority. Numbers can be ported, so this is a
// hint shown to staff, never a reason to refuse a number.
const RANGES: Array<[number, number, KenyaNetwork]> = [
  [700, 729, "safaricom"], [740, 743, "safaricom"], [745, 746, "safaricom"], [748, 748, "safaricom"],
  [757, 759, "safaricom"], [768, 769, "safaricom"], [790, 799, "safaricom"], [110, 115, "safaricom"],
  [730, 739, "airtel"], [750, 756, "airtel"], [762, 762, "airtel"], [780, 789, "airtel"], [100, 102, "airtel"],
  [770, 779, "telkom"],
];

export function networkOf(phone: string): KenyaNetwork | null {
  const local = toAirtelMsisdn(phone);
  if (!local) return null;
  const prefix = Number(local.slice(0, 3));
  return RANGES.find(([from, to]) => prefix >= from && prefix <= to)?.[2] ?? null;
}
