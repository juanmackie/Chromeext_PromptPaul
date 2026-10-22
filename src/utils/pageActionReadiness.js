/**
 * @fileoverview Bounded, document-scoped cache for page-action bridge readiness.
 * @module pageActionReadiness
 */

const normalizeDocumentKey = (url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return '';
  }
};

/**
 * Create a small TTL cache for verified page-action content-script bridges.
 * @param {{ttlMs?: number, maxEntries?: number}} [options]
 */
export function createPageActionReadinessCache({ ttlMs = 60_000, maxEntries = 32 } = {}) {
  const entries = new Map();
  const capacity = Math.max(1, Math.floor(Number(maxEntries) || 32));
  const ttl = Math.max(1, Number(ttlMs) || 60_000);

  const pruneExpired = (now) => {
    for (const [tabId, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(tabId);
    }
  };

  return {
    get(tabId, documentUrl, now = Date.now()) {
      pruneExpired(now);
      const entry = entries.get(Number(tabId));
      const documentKey = normalizeDocumentKey(documentUrl);
      if (!entry || !documentKey || entry.documentKey !== documentKey) return false;
      entries.delete(Number(tabId));
      entries.set(Number(tabId), entry);
      return true;
    },
    mark(tabId, documentUrl, now = Date.now()) {
      const id = Number(tabId);
      const documentKey = normalizeDocumentKey(documentUrl);
      if (!Number.isInteger(id) || id < 0 || !documentKey) return false;
      entries.delete(id);
      entries.set(id, { documentKey, expiresAt: now + ttl });
      pruneExpired(now);
      while (entries.size > capacity) entries.delete(entries.keys().next().value);
      return true;
    },
    invalidate(tabId) {
      return entries.delete(Number(tabId));
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
