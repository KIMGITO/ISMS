/**
 * Validates that a phone number starts with '+' followed by the country code and digits.
 * Example: +254712345678, +14155552671
 */
export function isValidPhoneWithCountryCode(phone: string): boolean {
  const cleaned = phone.trim().replace(/\s+/g, "");
  // Must start with + followed by 9 to 15 digits
  return /^\+[1-9]\d{8,14}$/.test(cleaned);
}

/**
 * Normalizes a phone number to standard international format (without spaces).
 */
export function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, "");
}
