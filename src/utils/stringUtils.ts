import { formatReceiptNumber, getShortId } from "./idUtils";
// src/utils/stringUtils.ts

/**
 * A customer's name as it is stored and shown: every word starts with a capital letter and the
 * rest is kept ("mary wanjiku" -> "Mary Wanjiku", "mcdonald o'neil" -> "Mcdonald O'neil",
 * "JOHN" stays "JOHN"). The database applies the same rule (fn_capitalize_words).
 */
export function customerName(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Capitalizes the first letter of a string.
 */
export function capitalize(str: string | null | undefined): string {
  if (!str) return "";
  const s = str.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Automatically converts a string to proper Title Case.
 * Handles conjunctions, hyphenated words, and apostrophes.
 */
export function titleCase(str: string | null | undefined): string {
  if (!str) return "";
  const smallWords = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|vs?\.?|via)$/i;

  return str
    .trim()
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((word, index, array) => {
      if (index > 0 && array[index - 1] === "-") {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      if (smallWords.test(word) && index !== 0 && index !== array.length - 1) {
        return word.toLowerCase();
      }
      return word.replace(/\b\w/g, (match) => match.toUpperCase());
    })
    .join("");
}

/**
 * Semantic alias for titleCase.
 */
export function displayName(str: string | null | undefined): string {
  return titleCase(str);
}

/**
 * Semantic alias for sentenceCase.
 */
export function displayDescription(str: string | null | undefined): string {
  return sentenceCase(str);
}

/**
 * Automatically converts a string to Sentence Case.
 * Handles cases like "LOW STOCK REPORT" -> "Low stock report"
 */
export function sentenceCase(str: string | null | undefined): string {
  if (!str) return "";
  const s = str.trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Normalizes text for database storage (lowercase and trimmed).
 */
export function normalizeForStorage(str: string | null | undefined): string {
  if (!str) return "";
  return str.trim().toLowerCase();
}

/**
 * Normalizes text for search, comparisons, filtering.
 */
export function normalizeForSearch(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Remove accents
}

/**
 * Checks if search query matches the target string under normalization.
 */
export function searchMatch(target: string | null | undefined, query: string | null | undefined): boolean {
  if (!query) return true;
  if (!target) return false;
  const normalizedTarget = normalizeForSearch(target);
  const normalizedQuery = normalizeForSearch(query);
  return normalizedTarget.includes(normalizedQuery);
}

/**
 * Compares two strings case-insensitively/normalized.
 */
export function compareNormalized(str1: string | null | undefined, str2: string | null | undefined): boolean {
  return normalizeForSearch(str1) === normalizeForSearch(str2);
}

/**
 * Sorts strings alphabetically under normalization.
 */
export function sortAlphabetical(
  a: string | null | undefined,
  b: string | null | undefined,
  ascending = true
): number {
  const normA = normalizeForSearch(a);
  const normB = normalizeForSearch(b);
  if (normA < normB) return ascending ? -1 : 1;
  if (normA > normB) return ascending ? 1 : -1;
  return 0;
}

/**
 * Formats a name to be either uppercase (if entered that way) or capitalized (Title Case).
 */
export function formatName(str: string | null | undefined): string {
  if (!str) return "";
  const trimmed = str.trim();
  if (!trimmed) return "";
  
  // If it is already fully uppercase (and has alphabetic chars), preserve it
  if (trimmed === trimmed.toUpperCase() && /[a-zA-Z]/.test(trimmed)) {
    return trimmed;
  }
  
  // Otherwise, proper Title Case (capitalized)
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Extracts the first name from a full name string and formats it properly.
 * Example: "James Mwangi" -> "James", "jane doe" -> "Jane"
 */
export function getFirstName(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  
  // Split by whitespace and take the first part
  const firstPart = trimmed.split(/\s+/)[0];
  
  // Return formatted
  return formatName(firstPart);
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Text written by the server sometimes carries a database ID ("Sold via order #3f2a9c1e-…").
 * Shows the sale's receipt number instead (as the Sales Log does), and any other ID in short.
 * The database does the same since migration 20261108004.
 */
export function readableIds(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/^Sold via order #?([0-9a-f]{8}[0-9a-f-]{28})$/i, (_m, id: string) => `Sold · receipt ${formatReceiptNumber(id)}`)
    .replace(/order #?([0-9a-f]{8}[0-9a-f-]{28})/gi, (_m, id: string) => `receipt ${formatReceiptNumber(id)}`)
    .replace(UUID_RE, (id) => getShortId(id));
}
