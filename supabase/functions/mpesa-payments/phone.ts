// supabase/functions/mpesa-payments/phone.ts

/** Daraja wants 2547XXXXXXXX or 2541XXXXXXXX. */
export function toMsisdn(phone: string): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const local = digits.startsWith("254") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null;
}
