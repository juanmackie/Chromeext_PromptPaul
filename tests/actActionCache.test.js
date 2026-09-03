import { describe, expect, it } from 'vitest';
import {
  buildActActionCacheKey,
  clearActActionCache,
  getActActionCache,
  getCachedActAction,
  setCachedActAction,
} from '../src/orchestrator/ActActionCache.js';

describe('ActActionCache', () => {
  it('generalizes input values but rejects sensitive values and risky actions', () => {
    const base = {
      actionName: 'page_input',
      risk: 'low',
      origin: 'https://example.test/form',
      fingerprint: 'abc',
      target: { tag: 'input', label: 'Search' },
    };
    expect(buildActActionCacheKey({ ...base, args: { text: 'alice' } })).toBe(
      buildActActionCacheKey({ ...base, args: { text: 'bob' } })
    );
    expect(buildActActionCacheKey({ ...base, args: { text: 'password=secret' } })).toBeNull();
    expect(buildActActionCacheKey({ ...base, actionName: 'page_click', risk: 'high' })).toBeNull();
  });

  it('keeps entries live on the run and evicts the oldest entry', () => {
    const run = { pageActions: {} };
    for (let index = 0; index < 51; index += 1) {
      setCachedActAction(run, `key-${index}`, { actionName: 'page_get_state' });
    }
    expect(getActActionCache(run).size).toBe(50);
    expect(getCachedActAction(run, 'key-0')).toBeNull();
    expect(getCachedActAction(run, 'key-50')).toMatchObject({ actionName: 'page_get_state' });
    clearActActionCache(run);
    expect(getActActionCache(run).size).toBe(0);
  });
});
