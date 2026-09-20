/**
 * @fileoverview Shared identifier helpers: deterministic hashing and random IDs.
 * @module ids
 */

/**
 * Compute a stable djb2 hash of a value, returned as a base-36 unsigned integer.
 * Not cryptographically secure; used only to derive deterministic IDs.
 * @param {unknown} value - Value to hash (coerced to string).
 * @returns {string} Base-36 hash.
 */
export function hashString(value) {
  let hash = 5381;
  for (const character of String(value || '')) {
    hash = (hash * 33) ^ character.codePointAt(0);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Generate a random identifier, preferring the native UUID v4 generator.
 * The fallback runs only on runtimes without `crypto.randomUUID`, which no
 * supported Chrome version lacks, so generated IDs are UUID v4 strings.
 * @returns {string} A random identifier.
 */
export function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Prefix a random identifier, e.g. `inst_<uuid>`.
 * @param {string} prefix - Prefix to place before the identifier.
 * @returns {string} A prefixed random identifier.
 */
export function createUniqueId(prefix) {
  return `${prefix}_${randomId()}`;
}
