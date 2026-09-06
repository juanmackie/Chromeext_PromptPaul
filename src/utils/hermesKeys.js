/**
 * @fileoverview Background-owned Hermes credential validation and per-profile cleanup.
 * @module hermesKeys
 */

export const HERMES_API_KEYS_KEY = 'hermesApiKeys';
export const HERMES_SESSIONS_KEY = 'hermesSessions';
export const HERMES_SESSION_KEYS_KEY = 'hermesSessionKeys';

const HERMES_KEY_MIN_LENGTH = 8;
const HERMES_KEY_MAX_LENGTH = 512;
const INVALID_KEY_CHARS = /\s/;

/**
 * True when a string contains a control character (C0 or DEL). Scanned by
 * code point to keep the check out of a regex class that lint treats as a
 * literal control-character match.
 * @param {string} value
 * @returns {boolean}
 */
function hasControlCharacter(value) {
  return [...value].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/**
 * Validate a Hermes gateway API key before it is stored by the background owner.
 * Rejects empty, over/under-length, and whitespace/control-character keys so a
 * malformed or accidentally pasted value never reaches the key store.
 *
 * @param {unknown} value - The key value supplied by the caller.
 * @returns {{ok: boolean, error?: string, value?: string}} The validation result.
 *   On success the trimmed key is returned in `value`.
 */
export function validateHermesKey(value) {
  if (typeof value !== 'string') {
    return { ok: false, error: 'The Hermes API key must be a string.' };
  }
  const key = value.trim();
  if (!key) {
    return { ok: false, error: 'The Hermes API key cannot be empty.' };
  }
  if (key.length < HERMES_KEY_MIN_LENGTH) {
    return {
      ok: false,
      error: `The Hermes API key must be at least ${HERMES_KEY_MIN_LENGTH} characters.`,
    };
  }
  if (key.length > HERMES_KEY_MAX_LENGTH) {
    return {
      ok: false,
      error: `The Hermes API key cannot exceed ${HERMES_KEY_MAX_LENGTH} characters.`,
    };
  }
  if (hasControlCharacter(key) || INVALID_KEY_CHARS.test(key)) {
    return {
      ok: false,
      error: 'The Hermes API key cannot contain spaces or control characters.',
    };
  }
  return { ok: true, value: key };
}

/**
 * Remove a single profile id from a background-owned keyed storage map.
 *
 * @param {object} chrome - The chrome.storage namespace (injected for tests).
 * @param {string} storageKey - The map storage key.
 * @param {string} profileId - The profile id to drop.
 */
async function removeStoredKey(chrome, storageKey, profileId) {
  const result = await chrome.storage.local.get(storageKey);
  const map = { ...(result?.[storageKey] || {}) };
  if (!(profileId in map)) return;
  delete map[profileId];
  await chrome.storage.local.set({ [storageKey]: map });
}

/**
 * Remove every background-owned Hermes record (credential, session, session key)
 * for a profile id. Used when a profile is deleted so no secrets or orphaned
 * session records remain. Never returns or exposes the credential value.
 *
 * @param {string} profileId - The deleted profile id.
 * @param {object} chrome - The chrome.storage namespace (injected for tests).
 * @returns {Promise<void>}
 */
export async function removeProfileHermesState(profileId, chrome) {
  await removeStoredKey(chrome, HERMES_API_KEYS_KEY, profileId);
  await removeStoredKey(chrome, HERMES_SESSIONS_KEY, profileId);
  await removeStoredKey(chrome, HERMES_SESSION_KEYS_KEY, profileId);
}
