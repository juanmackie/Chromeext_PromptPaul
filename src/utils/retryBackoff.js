/**
 * @fileoverview Bounded retry delays for browser bridge recovery.
 * @module retryBackoff
 */

/**
 * Calculate one bounded exponential delay with optional jitter.
 *
 * This helper only schedules recovery work. It must not be used to retry a
 * state-changing page action after delivery is uncertain.
 *
 * @param {number} attempt Zero-based retry attempt.
 * @param {object} [options]
 * @param {number} [options.baseMs=100] Initial delay.
 * @param {number} [options.maxMs=1500] Maximum delay.
 * @param {number} [options.jitter=0.2] Random variation from zero to one.
 * @param {() => number} [options.random=Math.random] Random source for tests.
 * @returns {number} Delay in milliseconds.
 */
export function getRetryDelay(attempt, options = {}) {
  const baseMs = Math.max(0, Number(options.baseMs ?? 100));
  const maxMs = Math.max(baseMs, Number(options.maxMs ?? 1_500));
  const jitter = Math.min(1, Math.max(0, Number(options.jitter ?? 0.2)));
  const normalizedAttempt = Math.max(0, Math.floor(Number(attempt) || 0));
  const exponential = Math.min(maxMs, baseMs * 2 ** normalizedAttempt);
  const randomSource = typeof options.random === 'function' ? options.random : Math.random;
  const randomValue = Math.min(1, Math.max(0, Number(randomSource())));
  const factor = 1 - jitter + randomValue * jitter * 2;
  return Math.min(maxMs, Math.max(0, Math.round(exponential * factor)));
}

/**
 * Wait for a bounded retry delay, with abort support.
 * @param {number} attempt Zero-based retry attempt.
 * @param {object} [options] Delay options plus an optional AbortSignal.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<void>}
 */
export function waitForRetry(attempt, options = {}) {
  const delay = getRetryDelay(attempt, options);
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(finish, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
