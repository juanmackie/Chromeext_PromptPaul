import { describe, expect, it, vi } from 'vitest';
import { getRetryDelay, waitForRetry } from '../src/utils/retryBackoff.js';

describe('retryBackoff', () => {
  it('calculates capped exponential delays with deterministic jitter', () => {
    const options = { baseMs: 100, maxMs: 500, jitter: 0.2, random: () => 0.5 };
    expect(getRetryDelay(0, options)).toBe(100);
    expect(getRetryDelay(1, options)).toBe(200);
    expect(getRetryDelay(3, options)).toBe(500);
    expect(getRetryDelay(-4, options)).toBe(100);
  });

  it('resolves after the bounded delay and rejects on abort', async () => {
    vi.useFakeTimers();
    try {
      const finished = waitForRetry(0, { baseMs: 20, maxMs: 20, jitter: 0 });
      await vi.advanceTimersByTimeAsync(20);
      await expect(finished).resolves.toBeUndefined();

      const controller = new AbortController();
      const aborted = waitForRetry(0, {
        baseMs: 20,
        maxMs: 20,
        jitter: 0,
        signal: controller.signal,
      });
      controller.abort();
      await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      vi.useRealTimers();
    }
  });
});
