import { describe, expect, it } from 'vitest';
import { createPageActionReadinessCache } from '../src/utils/pageActionReadiness.js';

describe('page-action readiness cache', () => {
  it('matches a verified document, ignores query and fragment, and rejects other paths', () => {
    const cache = createPageActionReadinessCache();
    expect(cache.mark(4, 'https://example.test/page?token=secret#section', 100)).toBe(true);
    expect(cache.get(4, 'https://example.test/page?changed=yes#other', 101)).toBe(true);
    expect(cache.get(4, 'https://example.test/other', 101)).toBe(false);
    expect(cache.get(5, 'https://example.test/page', 101)).toBe(false);
    expect(cache.get(4, 'chrome://settings', 101)).toBe(false);
  });

  it('expires entries and invalidates by tab', () => {
    const cache = createPageActionReadinessCache({ ttlMs: 10 });
    cache.mark(1, 'https://example.test/a', 100);
    expect(cache.get(1, 'https://example.test/a', 109)).toBe(true);
    expect(cache.get(1, 'https://example.test/a', 110)).toBe(false);
    cache.mark(1, 'https://example.test/a', 120);
    expect(cache.invalidate(1)).toBe(true);
    expect(cache.get(1, 'https://example.test/a', 121)).toBe(false);
  });

  it('bounds entries and clears all entries', () => {
    const cache = createPageActionReadinessCache({ maxEntries: 2 });
    cache.mark(1, 'https://example.test/1', 1);
    cache.mark(2, 'https://example.test/2', 1);
    cache.mark(3, 'https://example.test/3', 1);
    expect(cache.size).toBe(2);
    expect(cache.get(1, 'https://example.test/1', 2)).toBe(false);
    expect(cache.get(2, 'https://example.test/2', 2)).toBe(true);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
