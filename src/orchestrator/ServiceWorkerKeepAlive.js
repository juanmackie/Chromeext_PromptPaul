/**
 * @fileoverview Keep the extension worker alive during an executing run.
 * @module ServiceWorkerKeepAlive
 */

/**
 * Reset Chrome's idle timer until the operation settles. Run budgets and user
 * decision timeouts remain authoritative; idle workers receive no heartbeat.
 * @param {Function} operation
 * @returns {Promise<*>}
 */
export async function withServiceWorkerKeepAlive(operation) {
  const runtime = globalThis.chrome?.runtime;
  const timer =
    typeof runtime?.getPlatformInfo === 'function'
      ? setInterval(async () => {
          try {
            await runtime.getPlatformInfo();
          } catch (_) {
            // Shutdown can invalidate the runtime while a heartbeat is pending.
          }
        }, 20_000)
      : null;
  try {
    return await operation();
  } finally {
    if (timer !== null) clearInterval(timer);
  }
}
