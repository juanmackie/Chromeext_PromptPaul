/**
 * @fileoverview Small keyed operation locks for browser runtime concurrency.
 * @module keyedOperationLock
 */

function normalizeKey(key) {
  return String(key ?? '').trim();
}

/**
 * Create keyed locks that either coalesce or reject concurrent operations.
 * @returns {{run: Function, tryRun: Function, isLocked: Function}}
 */
export function createKeyedOperationLock() {
  const active = new Map();

  function isLocked(key) {
    const normalizedKey = normalizeKey(key);
    return Boolean(normalizedKey && active.has(normalizedKey));
  }

  function start(key, operation) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || typeof operation !== 'function') {
      throw new Error('A keyed operation requires a key and function.');
    }
    if (active.has(normalizedKey)) return null;

    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (active.get(normalizedKey) === promise) active.delete(normalizedKey);
      });
    active.set(normalizedKey, promise);
    return promise;
  }

  function run(key, operation) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || typeof operation !== 'function') {
      throw new Error('A keyed operation requires a key and function.');
    }
    return active.get(normalizedKey) || start(normalizedKey, operation);
  }

  return { run, tryRun: start, isLocked };
}
