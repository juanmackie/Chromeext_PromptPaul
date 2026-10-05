/**
 * @fileoverview Bounded persistent origin policies for Act consent and blocking.
 * @module pageActionSitePolicies
 */
export const PAGE_ACTION_SITE_POLICY_KEY = 'pageActionSitePolicies';
export const MAX_PAGE_ACTION_SITE_POLICIES = 200;

export function getPageActionSiteOrigin(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.origin
      : '';
  } catch (_) {
    return '';
  }
}

export function normalizePageActionOrigin(value) {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch (_) {
    return null;
  }
}

export function normalizePageActionSitePolicies(raw = {}) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).length > MAX_PAGE_ACTION_SITE_POLICIES
  )
    return { valid: false, error: 'Site policies must contain at most 200 HTTP(S) origins.' };
  const value = {};
  for (const [key, rule] of Object.entries(raw)) {
    const origin = normalizePageActionOrigin(key);
    if (!origin || !['block', 'allow_low_risk'].includes(rule))
      return {
        valid: false,
        error: 'Each site policy needs a HTTP(S) origin and block or allow_low_risk.',
      };
    value[origin] = rule;
  }
  return { valid: true, value };
}

/** The worker owns serialized read/modify/write operations; failure never reports a save. */
export function createPageActionSitePolicyStore(storage) {
  let queue = Promise.resolve();
  const read = async () => {
    const stored = await storage.get([PAGE_ACTION_SITE_POLICY_KEY]);
    const normalized = normalizePageActionSitePolicies(stored[PAGE_ACTION_SITE_POLICY_KEY] ?? {});
    if (!normalized.valid) throw new Error(normalized.error);
    return normalized.value;
  };
  const update = (rawOrigin, rule) => {
    const operation = () => {
      const origin = normalizePageActionOrigin(rawOrigin);
      if (!origin || (rule !== null && !['block', 'allow_low_risk'].includes(rule)))
        throw new Error('A valid site origin and policy are required.');
      return read().then((policies) => {
        if (rule === null) delete policies[origin];
        else policies[origin] = rule;
        if (Object.keys(policies).length > MAX_PAGE_ACTION_SITE_POLICIES)
          throw new Error('The 200-site policy limit was reached. Remove an entry first.');
        return storage.set({ [PAGE_ACTION_SITE_POLICY_KEY]: policies }).then(() => policies);
      });
    };
    const pending = queue.then(operation, operation);
    queue = pending.catch(() => {});
    return pending;
  };
  return { read, update };
}
