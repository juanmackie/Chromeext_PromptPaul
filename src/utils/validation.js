/**
 * @fileoverview Input validation utilities
 * @module validation
 */

/**
 * Validate that a string is a valid URL
 * @param {string} string - URL string to validate
 * @returns {boolean} - True if the string is a valid URL
 */
export function isValidURL(string) {
  if (!string) return false;
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}
