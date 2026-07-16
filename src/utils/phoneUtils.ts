/**
 * Supported countries for phone number verification.
 */
export const SUPPORTED_COUNTRIES = [
  { code: "+254", flag: "🇰🇪", name: "Kenya" },
  { code: "+256", flag: "🇺🇬", name: "Uganda" },
  { code: "+255", flag: "🇹🇿", name: "Tanzania" },
  { code: "+250", flag: "🇷🇼", name: "Rwanda" },
  { code: "+252", flag: "🇸🇴", name: "Somalia" },
];

/**
 * Normalizes phone numbers to standard E.164 format.
 * Accepts an optional countryCode prefix (defaults to +254).
 */
export function normalizePhone(phone: string, countryCode: string = "+254"): string {
  if (!phone) return "";
  
  // Strip all non-numeric characters except +
  let cleaned = phone.trim().replace(/[^\d+]/g, "");

  // If already starts with +, return as-is
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  const prefix = countryCode.startsWith("+") ? countryCode : `+${countryCode}`;
  const rawPrefix = prefix.replace("+", "");

  // Handle local format starting with 0 (e.g. 0712345678 -> +254712345678)
  if (cleaned.startsWith("0")) {
    return `${prefix}${cleaned.substring(1)}`;
  }

  // Handle format starting with the prefix (e.g. 254712345678 -> +254712345678)
  if (cleaned.startsWith(rawPrefix)) {
    return `+${cleaned}`;
  }

  // Otherwise, assume it is a local number without a leading zero (e.g. 712345678 -> +254712345678)
  return `${prefix}${cleaned}`;
}

/**
 * Normalizes phone numbers to E.164 format (alias for compatibility).
 */
export function formatToE164(phone: string, defaultCountryPrefix: string = "+254"): string {
  return normalizePhone(phone, defaultCountryPrefix);
}

/**
 * Validates whether a phone number matches E.164 format.
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{8,14}$/.test(phone);
}

/**
 * Validates whether a phone number is valid (alias for compatibility).
 */
export function validatePhone(phone: string): boolean {
  return isValidE164(phone);
}
