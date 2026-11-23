// src/utils/passwordRule.ts
// Same rule as the live Supabase Auth settings (Authentication → Policies → Password):
// at least 8 characters, with a lowercase letter, an uppercase letter and a digit.
// If that setting changes, change this too, or sign-up fails with a password error.

export const PASSWORD_HINT = "8+ characters, with a capital, a small letter and a number";

/** Returns what is wrong with the password, or null when it meets the rule. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password needs a capital letter, a small letter and a number.";
  }
  return null;
}
