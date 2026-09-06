/**
 * @fileoverview Regression tests for site-suggestion persistence (P2-02).
 * A stored bare-hostname site key must survive normalization on read so that
 * add/add/reload/remove round-trips keep suggestions present.
 * @module suggestionStorage.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAllSuggestions,
  getSuggestionsForSite,
  addSuggestion,
  removeSuggestion,
  extractSiteKey,
} from '../src/utils/suggestionStorage.js';

const store = {};
const chromeMock = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') return { [key]: store[key] };
        const out = {};
        for (const k of key) out[k] = store[k];
        return out;
      },
      async set(values) {
        Object.assign(store, values);
      },
    },
  },
};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  globalThis.chrome = chromeMock;
});

afterEach(() => {
  delete globalThis.chrome;
});

describe('extractSiteKey canonical normalizer (P2-02)', () => {
  it('accepts a full URL', () => {
    expect(extractSiteKey('https://www.Example.com/path?q=1')).toBe('example.com');
  });

  it('accepts a bare hostname that matches a stored site key', () => {
    expect(extractSiteKey('example.com')).toBe('example.com');
    expect(extractSiteKey('  sub.example.org  ')).toBe('sub.example.org');
  });

  it('rejects empty/invalid inputs', () => {
    expect(extractSiteKey('')).toBeNull();
    expect(extractSiteKey('   ')).toBeNull();
  });
});

describe('suggestion persistence round-trip (P2-02)', () => {
  it('keeps a suggestion after add, read, another add, and removal', async () => {
    const added = await addSuggestion('https://www.example.com', 'Example', '/go', 'Do the thing');
    expect(added.siteKey).toBe('example.com');

    // Add: present immediately.
    const afterAdd = await getSuggestionsForSite('example.com');
    expect(afterAdd).toHaveLength(1);
    expect(afterAdd[0].prompt).toBe('Do the thing');

    // Reload: normalize-on-read must keep the bare store hostname.
    const justStored = store.customSiteSuggestions;
    expect(Array.isArray(justStored)).toBe(true);
    expect(justStored[0].siteKey).toBe('example.com');
    const afterReload = await getAllSuggestions();
    expect(afterReload).toHaveLength(1);
    expect(afterReload[0].siteKey).toBe('example.com');

    // Another add with a subtly different prompt dedupes/keeps both distinct.
    await addSuggestion('https://www.example.com', 'Example', '/go', 'A different prompt');
    expect(await getAllSuggestions()).toHaveLength(2);

    // Removal drops only the target.
    await removeSuggestion(added.id);
    const afterRemove = await getAllSuggestions();
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove.some((s) => s.id === added.id)).toBe(false);
  });

  it('accepts a bare hostname as the add input', async () => {
    const added = await addSuggestion('example.org', 'Example', '/sum', 'Summarize');
    expect(added.siteKey).toBe('example.org');
    expect(await getSuggestionsForSite('example.org')).toHaveLength(1);
  });
});
