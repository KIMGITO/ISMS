// src/utils/stringUtils.ts

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
