/**
 * @fileoverview Always-on local action-template cache for Act runs.
 * Session-memory only: entries live on the live run object, never persist to
 * storage, journals, or events. Cached templates reuse the resolved policy
 * verdict and semantic target key without another LLM reasoning step, then
 * rebind to the current snapshotId and re-validate ownership before dispatch.
 * Secrets, high-risk actions, and navigation are never cached.
 * @module ActActionCache
 */

export const ACT_ACTION_CACHE_CAPS = Object.freeze({
  maxEntries: 50,
  maxLabelChars: 120,
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function cacheHash(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
function capCacheText(value, maxLength = ACT_ACTION_CACHE_CAPS.maxLabelChars) {
  return String(value ?? '')
    .replace(/\u0000/gu, '') // eslint-disable-line no-control-regex
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, Math.max(0, maxLength));
}

const SECRET_CACHE_PATTERN =
  /password|passcode|one[-_ ]?time|otp|2fa|secret|api[-_ ]?key|access[-_ ]?token|bearer|\btoken\b|credential|payment|credit\s+card|debit\s+card|cvv|cvc|ssn/i;

/**
 * Build a stable cache key for a validated page action. Snapshot IDs rotate
 * every inspection, so they are excluded; values are generalized so the same
 * template reuses across runs on a stable page.
 * @param {object} input
 * @returns {string|null} Null when the action must not be cached.
 */
export function buildActActionCacheKey(input = {}) {
  const actionName = String(input.actionName || '');
  if (!actionName) return null;
  if (input.prohibited === true) return null;
  if (input.navigation === true) return null;
  if (input.risk === 'high' || input.risk === 'prohibited') return null;
  const target = input.target || {};
  if (target.sensitive === true) return null;
  const labelKey = capCacheText(
    [target.tag, target.role, target.label || target.name, target.type].filter(Boolean).join('|')
  );
  const args = input.args || {};
  if (typeof args.text === 'string' && SECRET_CACHE_PATTERN.test(args.text)) return null;
  if (typeof args.option === 'string' && SECRET_CACHE_PATTERN.test(args.option)) return null;
  const argKey =
    actionName === 'page_find_text'
      ? `q=${capCacheText(args.query, 160)}`
      : actionName === 'page_wait'
        ? `w=${capCacheText(args.condition, 32)}|${capCacheText(args.text, 160)}`
        : actionName === 'page_scroll'
          ? `s=${capCacheText(args.direction, 16)}|${Number(args.pages) || 0}`
          : actionName === 'page_input'
            ? 'input-template'
            : actionName === 'page_select'
              ? 'select-template'
              : 'control-template';
  const regionKey = typeof args.regionId === 'string' ? args.regionId : '';
  const origin = capCacheText(input.origin, 160);
  const fingerprint = capCacheText(input.fingerprint, 128);
  return cacheHash(`${actionName}|${labelKey}|${argKey}|${regionKey}|${origin}|${fingerprint}`);
}

/**
 * Get the live-run cache map, creating it when missing.
 * @param {object} run
 * @returns {Map}
 */
export function getActActionCache(run) {
  if (!run.pageActions) run.pageActions = {};
  if (!(run.pageActions.actionCache instanceof Map)) run.pageActions.actionCache = new Map();
  return run.pageActions.actionCache;
}

/**
 * Look up a reusable template for the current page state.
 * @param {object} run
 * @param {string} key
 * @returns {object|null}
 */
export function getCachedActAction(run, key) {
  if (!key) return null;
  const cache = getActActionCache(run);
  return cache.get(String(key)) || null;
}

/**
 * Store a successful action template. Evicts oldest entries beyond the cap.
 * @param {object} run
 * @param {string} key
 * @param {object} template
 */
export function setCachedActAction(run, key, template = {}) {
  if (!key) return;
  const cache = getActActionCache(run);
  cache.set(String(key), {
    actionName: String(template.actionName || '').slice(0, 64),
    targetKey: capCacheText(template.targetKey),
    risk: String(template.risk || '').slice(0, 32),
    regionId: typeof template.regionId === 'string' ? template.regionId.slice(0, 32) : undefined,
    fingerprint: capCacheText(template.fingerprint, 128),
    origin: capCacheText(template.origin, 160),
    snapshot: template.snapshot || null,
    hits: 0,
    createdAt: Date.now(),
  });
  while (cache.size > ACT_ACTION_CACHE_CAPS.maxEntries) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/**
 * Clear the live-run cache without touching checkpoints or journals.
 * @param {object} run
 */
export function clearActActionCache(run) {
  if (run?.pageActions) run.pageActions.actionCache = new Map();
}
