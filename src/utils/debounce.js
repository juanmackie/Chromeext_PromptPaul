/**
 * @fileoverview Debounce and throttle utility functions
 *
 * Responsibilities:
 * - Debounce function calls with configurable delay
 * - Throttle function calls to limit execution rate
 *
 * @module debounce
 */

/**
 * Create a debounced function.
 * Delays invoking fn until after `delay` ms since the last invocation.
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds (default: 300)
 * @returns {Function} - Debounced function with cancel() method
 */
export function debounce(fn, delay = 300) {
  let timer = null;

  const debounced = function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  return debounced;
}

/**
 * Create a throttled function.
 * Ensures fn is called at most once per `limit` ms.
 * @param {Function} fn - Function to throttle
 * @param {number} limit - Throttle interval in milliseconds (default: 100)
 * @returns {Function} - Throttled function
 */
export function throttle(fn, limit = 100) {
  let inThrottle = false;

  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}
