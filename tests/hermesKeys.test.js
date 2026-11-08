import { describe, expect, it } from 'vitest';
import {
  HERMES_API_KEYS_KEY,
  HERMES_SESSIONS_KEY,
  HERMES_SESSION_KEYS_KEY,
  validateHermesKey,
  removeProfileHermesState,
} from '../src/utils/hermesKeys.js';

/**
 * In-memory chrome.storage.local stand-in keyed by storage object, so each
 * cleanup test starts from the same shared state it seeds.
 */
function makeChrome(seed = {}) {
  const store = {
    ...(seed[HERMES_API_KEYS_KEY]
      ? { [HERMES_API_KEYS_KEY]: { ...seed[HERMES_API_KEYS_KEY] } }
      : {}),
    ...(seed[HERMES_SESSIONS_KEY]
      ? { [HERMES_SESSIONS_KEY]: { ...seed[HERMES_SESSIONS_KEY] } }
      : {}),
    ...(seed[HERMES_SESSION_KEYS_KEY]
      ? { [HERMES_SESSION_KEYS_KEY]: { ...seed[HERMES_SESSION_KEYS_KEY] } }
      : {}),
  };
  return {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: store[key] };
          throw new Error('unsupported get');
        },
        async set(obj) {
          Object.assign(store, obj);
        },
      },
    },
    readAll: () => store,
  };
}

describe('validateHermesKey', () => {
  it('accepts a well-formed non-empty key and trims surrounding whitespace', () => {
    expect(validateHermesKey('  sk-prompt-paul-1234567890  ')).toEqual({
      ok: true,
      value: 'sk-prompt-paul-1234567890',
    });
  });

  it('rejects non-string values', () => {
    expect(validateHermesKey(undefined).ok).toBe(false);
    expect(validateHermesKey(42).ok).toBe(false);
  });

  it('rejects empty and whitespace-only keys', () => {
    expect(validateHermesKey('').ok).toBe(false);
    expect(validateHermesKey('   ').ok).toBe(false);
  });

  it('rejects keys that are too short or too long', () => {
    expect(validateHermesKey('short').ok).toBe(false);
    expect(validateHermesKey('x'.repeat(600)).ok).toBe(false);
    expect(validateHermesKey('x'.repeat(8)).ok).toBe(true);
  });

  it('rejects keys containing whitespace or control characters', () => {
    expect(validateHermesKey('key with space').ok).toBe(false);
    expect(validateHermesKey('key\nnewline').ok).toBe(false);
    expect(validateHermesKey('key\u0000null').ok).toBe(false);
  });
});

describe('removeProfileHermesState', () => {
  it('drops credential, session, and session-key records for the deleted profile', async () => {
    const chrome = makeChrome({
      [HERMES_API_KEYS_KEY]: { p1: 'secret-value', p2: 'other-value' },
      [HERMES_SESSIONS_KEY]: { p1: { sessionId: 's1' }, p2: { sessionId: 's2' } },
      [HERMES_SESSION_KEYS_KEY]: { p1: 'k1', p2: 'k2' },
    });
    await removeProfileHermesState('p1', chrome);
    const all = chrome.readAll();
    expect(all[HERMES_API_KEYS_KEY]).toEqual({ p2: 'other-value' });
    expect(all[HERMES_SESSIONS_KEY]).toEqual({ p2: { sessionId: 's2' } });
    expect(all[HERMES_SESSION_KEYS_KEY]).toEqual({ p2: 'k2' });
  });

  it('is a no-op when the profile has no Hermes records', async () => {
    const chrome = makeChrome({
      [HERMES_API_KEYS_KEY]: { p2: 'other-value' },
    });
    await removeProfileHermesState('p1', chrome);
    expect(chrome.readAll()[HERMES_API_KEYS_KEY]).toEqual({ p2: 'other-value' });
  });
});
